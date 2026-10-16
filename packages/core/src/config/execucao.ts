/**
 * A estratégia de execução do build: serial ou paralela (§97).
 *
 * Serial é o padrão e continua sendo o build de sempre. Paralela é escolha
 * EXPLÍCITA de quem roda — pelo wizard, por flag, ou pelo arquivo que um dos
 * dois gravou — e nunca é ligada por inferência: um projeto antigo, sem arquivo
 * e sem flag, roda serial.
 *
 * O que se configura é o POOL: quantos agentes podem trabalhar ao mesmo tempo e
 * com que provider, modelo e intensidade cada um. Quem decide qual fase vai para
 * qual agente é o escalonador (`loop/escalonador.ts`), e ninguém configura
 * "agente de frontend" ou "agente de banco".
 *
 * O papel `builder` continua existindo e é a base dos agentes: um agente sem
 * configuração própria é o builder. O `verifier` NÃO entra no pool — a
 * verificação de cada fase continua independente de quem a construiu.
 *
 * Precedência, da mais forte para a mais fraca: flags do comando, o arquivo
 * `.capivara/execucao.json`, e o padrão serial. Arquivo malformado não é
 * ignorado em silêncio: sem flag que o substitua, o build não começa.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CLI_CATALOG, isCliProvider, isDirectProvider } from "../provider/index.js";
import { CLI_ADAPTERS, contratoDoWorkspace } from "../provider/cli/index.js";
import type { RoleConfig } from "../provider/index.js";
import { writeAtomic } from "../state/atomic.js";

const run = promisify(execFile);

export const ARQUIVO_DE_EXECUCAO = join(".capivara", "execucao.json");

/** Acima disto, mais agentes viram disputa de máquina, não velocidade. */
export const MAX_AGENTES = 8;
export const MIN_AGENTES_PARALELOS = 2;

export interface AgenteConfigurado {
  provider: string;
  /** Vazio é o padrão do provider. */
  model: string;
  /** Vazio é raciocínio desligado, como em todo papel. */
  effort: string;
  /**
   * Restrição do agente: `false` o mantém dentro do workspace mesmo quando o
   * build permite instalar pacotes de sistema. Ausente herda o build.
   */
  systemInstall?: boolean;
}

export type EstrategiaDeExecucao =
  | { mode: "serial" }
  | { mode: "parallel"; maxConcurrency: number; workers: AgenteConfigurado[] };

export const SERIAL: EstrategiaDeExecucao = { mode: "serial" };

export type LeituraDoArquivo =
  | { estado: "ausente" }
  | { estado: "ok"; estrategia: EstrategiaDeExecucao }
  | { estado: "inválido"; erros: string[] };

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

const CHAVES_DO_AGENTE = new Set(["provider", "model", "effort", "systemInstall"]);
const CHAVES_DO_ARQUIVO = new Set(["version", "mode", "maxConcurrency", "workers"]);

/** Nome de modelo e effort vão para argv de CLI: nada de espaço nem controle. */
const IDENTIFICADOR = /^[A-Za-z0-9._:/@+-]*$/;

function lerAgente(valor: unknown, posicao: number, erros: string[]): AgenteConfigurado | null {
  const onde = `agente ${posicao}`;
  if (!objeto(valor)) {
    erros.push(`${onde}: esperava um objeto com provider, model e effort`);
    return null;
  }
  for (const chave of Object.keys(valor)) {
    if (!CHAVES_DO_AGENTE.has(chave)) erros.push(`${onde}: campo desconhecido "${chave}"`);
  }
  const provider = valor.provider;
  if (typeof provider !== "string" || provider.trim() === "") {
    erros.push(`${onde}: provider ausente`);
    return null;
  }
  const model = valor.model ?? "";
  const effort = valor.effort ?? "";
  if (typeof model !== "string" || !IDENTIFICADOR.test(model)) erros.push(`${onde}: model inválido`);
  if (typeof effort !== "string" || !IDENTIFICADOR.test(effort)) erros.push(`${onde}: effort inválido`);
  if (valor.systemInstall !== undefined && typeof valor.systemInstall !== "boolean") {
    erros.push(`${onde}: systemInstall deve ser true ou false`);
  }
  return {
    provider: provider.trim(),
    model: typeof model === "string" ? model : "",
    effort: typeof effort === "string" ? effort : "",
    ...(typeof valor.systemInstall === "boolean" ? { systemInstall: valor.systemInstall } : {}),
  };
}

/** A forma do arquivo, sem consultar a máquina. Provider indisponível é outra checagem. */
export function lerEstrategia(valor: unknown): { ok: true; estrategia: EstrategiaDeExecucao } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  if (!objeto(valor)) return { ok: false, erros: ["o arquivo não é um objeto JSON"] };
  for (const chave of Object.keys(valor)) {
    if (!CHAVES_DO_ARQUIVO.has(chave)) erros.push(`campo desconhecido "${chave}"`);
  }
  if (valor.version !== 1) erros.push("version deve ser 1");

  if (valor.mode === "serial") {
    if (valor.maxConcurrency !== undefined || valor.workers !== undefined) {
      erros.push("o modo serial não leva maxConcurrency nem workers");
    }
    return erros.length > 0 ? { ok: false, erros } : { ok: true, estrategia: SERIAL };
  }
  if (valor.mode !== "parallel") {
    erros.push('mode deve ser "serial" ou "parallel"');
    return { ok: false, erros };
  }

  const maximo = valor.maxConcurrency;
  if (typeof maximo !== "number" || !Number.isInteger(maximo) || maximo < MIN_AGENTES_PARALELOS || maximo > MAX_AGENTES) {
    erros.push(`maxConcurrency deve ser um inteiro de ${MIN_AGENTES_PARALELOS} a ${MAX_AGENTES}`);
  }
  const lista = valor.workers ?? [];
  const workers: AgenteConfigurado[] = [];
  if (!Array.isArray(lista)) {
    erros.push("workers deve ser uma lista");
  } else {
    lista.forEach((item, indice) => {
      const agente = lerAgente(item, indice + 1, erros);
      if (agente) workers.push(agente);
    });
    if (typeof maximo === "number" && lista.length > maximo) {
      erros.push(`há ${lista.length} agentes configurados para no máximo ${maximo} ao mesmo tempo`);
    }
  }

  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, estrategia: { mode: "parallel", maxConcurrency: maximo as number, workers } };
}

export async function lerArquivoDeExecucao(projectRoot: string): Promise<LeituraDoArquivo> {
  let texto: string;
  try {
    texto = await readFile(join(projectRoot, ARQUIVO_DE_EXECUCAO), "utf8");
  } catch {
    return { estado: "ausente" };
  }
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return { estado: "inválido", erros: ["o arquivo não é JSON válido"] };
  }
  const lido = lerEstrategia(valor);
  return lido.ok ? { estado: "ok", estrategia: lido.estrategia } : { estado: "inválido", erros: lido.erros };
}

export function serializarEstrategia(estrategia: EstrategiaDeExecucao): string {
  const corpo =
    estrategia.mode === "serial"
      ? { version: 1, mode: "serial" }
      : { version: 1, mode: "parallel", maxConcurrency: estrategia.maxConcurrency, workers: estrategia.workers };
  return `${JSON.stringify(corpo, null, 2)}\n`;
}

export async function gravarArquivoDeExecucao(projectRoot: string, estrategia: EstrategiaDeExecucao): Promise<void> {
  await writeAtomic(join(projectRoot, ARQUIVO_DE_EXECUCAO), serializarEstrategia(estrategia));
}

/**
 * `--worker provider=codex,model=gpt-5.5,effort=high,system-install=no`.
 *
 * Chave=valor, e não `codex:gpt-5.5:high`: nome de modelo leva `:` e `/` com
 * frequência (`llama3:8b`, `anthropic/claude-sonnet`), e uma posição lida errado
 * vira modelo trocado sem erro nenhum. Só o provider pode vir sozinho.
 */
export function lerAgenteDaFlag(texto: string): { ok: true; agente: AgenteConfigurado } | { ok: false; erro: string } {
  const bruto = texto.trim();
  if (bruto === "") return { ok: false, erro: "--worker vazio" };
  if (!bruto.includes("=")) {
    return IDENTIFICADOR.test(bruto) ? { ok: true, agente: { provider: bruto, model: "", effort: "" } } : { ok: false, erro: `--worker ${bruto}: provider inválido` };
  }
  const campos = new Map<string, string>();
  for (const parte of bruto.split(",")) {
    const igual = parte.indexOf("=");
    if (igual <= 0) return { ok: false, erro: `--worker ${bruto}: "${parte}" não é chave=valor` };
    const chave = parte.slice(0, igual).trim();
    if (campos.has(chave)) return { ok: false, erro: `--worker ${bruto}: "${chave}" repetido` };
    campos.set(chave, parte.slice(igual + 1).trim());
  }
  for (const chave of campos.keys()) {
    if (!["provider", "model", "effort", "system-install"].includes(chave)) {
      return { ok: false, erro: `--worker ${bruto}: chave desconhecida "${chave}" (use provider, model, effort, system-install)` };
    }
  }
  const provider = campos.get("provider") ?? "";
  if (provider === "") return { ok: false, erro: `--worker ${bruto}: falta provider=` };
  const model = campos.get("model") ?? "";
  const effort = campos.get("effort") ?? "";
  if (!IDENTIFICADOR.test(provider) || !IDENTIFICADOR.test(model) || !IDENTIFICADOR.test(effort)) {
    return { ok: false, erro: `--worker ${bruto}: provider, model e effort não levam espaço` };
  }
  const sistema = campos.get("system-install");
  if (sistema !== undefined && !["yes", "no", "sim", "nao", "não"].includes(sistema)) {
    return { ok: false, erro: `--worker ${bruto}: system-install é yes ou no` };
  }
  return {
    ok: true,
    agente: {
      provider,
      model,
      effort,
      ...(sistema !== undefined ? { systemInstall: sistema === "yes" || sistema === "sim" } : {}),
    },
  };
}

/** O inverso de `lerAgenteDaFlag`: o que o wizard imprime e reexecuta. */
export function agenteComoFlag(agente: AgenteConfigurado): string {
  const partes = [`provider=${agente.provider}`];
  if (agente.model !== "") partes.push(`model=${agente.model}`);
  if (agente.effort !== "") partes.push(`effort=${agente.effort}`);
  if (agente.systemInstall !== undefined) partes.push(`system-install=${agente.systemInstall ? "yes" : "no"}`);
  return partes.length === 1 ? agente.provider : partes.join(",");
}

export interface FlagsDeExecucao {
  /** `--parallel <n>`: o teto de agentes. */
  parallel?: string;
  serial?: boolean;
  /** `--worker`, repetível. */
  worker?: string[];
}

export type OrigemDaEstrategia = "padrão" | "arquivo" | "flags";

export type EstrategiaResolvida =
  | { ok: true; estrategia: EstrategiaDeExecucao; origem: OrigemDaEstrategia; avisos: string[] }
  | { ok: false; erros: string[] };

/** Flags vencem o arquivo; o arquivo vence o padrão; arquivo quebrado não passa calado. */
export function resolverEstrategia(flags: FlagsDeExecucao, arquivo: LeituraDoArquivo): EstrategiaResolvida {
  const erros: string[] = [];
  const avisos: string[] = [];
  const workersDasFlags: AgenteConfigurado[] = [];
  for (const texto of flags.worker ?? []) {
    const lido = lerAgenteDaFlag(texto);
    if (lido.ok) workersDasFlags.push(lido.agente);
    else erros.push(lido.erro);
  }

  if (flags.serial === true && flags.parallel !== undefined) erros.push("--serial e --parallel se contradizem; escolha um");
  if (flags.serial === true && workersDasFlags.length > 0) erros.push("--worker só vale com execução paralela");

  let maximo: number | null = null;
  if (flags.parallel !== undefined) {
    const numero = /^\d+$/.test(flags.parallel.trim()) ? Number(flags.parallel.trim()) : Number.NaN;
    if (!Number.isInteger(numero) || numero < MIN_AGENTES_PARALELOS || numero > MAX_AGENTES) {
      erros.push(`--parallel recebe de ${MIN_AGENTES_PARALELOS} a ${MAX_AGENTES} agentes (veio "${flags.parallel}"); para uma fase por vez, use --serial`);
    } else {
      maximo = numero;
    }
  }
  if (erros.length > 0) return { ok: false, erros };

  const explicita = flags.serial === true || flags.parallel !== undefined;
  if (arquivo.estado === "inválido") {
    if (!explicita) {
      return {
        ok: false,
        erros: [
          `${ARQUIVO_DE_EXECUCAO} está malformado:`,
          ...arquivo.erros.map((erro) => `  · ${erro}`),
          "Corrija o arquivo, apague-o para voltar ao serial, ou diga a estratégia nesta execução com --serial ou --parallel <n>.",
        ],
      };
    }
    avisos.push(`${ARQUIVO_DE_EXECUCAO} está malformado e foi ignorado nesta execução: as flags decidem`);
  }
  const doArquivo = arquivo.estado === "ok" ? arquivo.estrategia : null;

  if (flags.serial === true) return { ok: true, estrategia: SERIAL, origem: "flags", avisos };

  if (maximo !== null) {
    const herdados = doArquivo?.mode === "parallel" ? doArquivo.workers : [];
    const workers = (workersDasFlags.length > 0 ? workersDasFlags : herdados).slice(0, maximo);
    if (workersDasFlags.length > maximo) {
      return { ok: false, erros: [`${workersDasFlags.length} --worker para no máximo ${maximo} agentes ao mesmo tempo`] };
    }
    return { ok: true, estrategia: { mode: "parallel", maxConcurrency: maximo, workers }, origem: "flags", avisos };
  }

  if (workersDasFlags.length > 0) {
    if (doArquivo?.mode !== "parallel") {
      return { ok: false, erros: ["--worker só vale com execução paralela: acrescente --parallel <n>"] };
    }
    if (workersDasFlags.length > doArquivo.maxConcurrency) {
      return { ok: false, erros: [`${workersDasFlags.length} --worker para no máximo ${doArquivo.maxConcurrency} agentes ao mesmo tempo`] };
    }
    return { ok: true, estrategia: { ...doArquivo, workers: workersDasFlags }, origem: "flags", avisos };
  }

  if (doArquivo) return { ok: true, estrategia: doArquivo, origem: "arquivo", avisos };
  return { ok: true, estrategia: SERIAL, origem: "padrão", avisos };
}

/**
 * A configuração de papel de cada agente do pool, do primeiro ao último.
 *
 * O agente sem configuração própria É o builder — mesmo provider, modelo,
 * effort, credencial e adapter. O que o agente declara substitui só o que
 * declara: um modelo próprio não apaga o adapter custom do builder.
 */
export function papeisDosAgentes(estrategia: EstrategiaDeExecucao, builder: RoleConfig): { config: RoleConfig; systemInstall?: boolean }[] {
  if (estrategia.mode === "serial") return [{ config: builder }];
  return Array.from({ length: estrategia.maxConcurrency }, (_, indice) => {
    const proprio = estrategia.workers[indice];
    if (!proprio) return { config: builder };
    const mesmoProvider = proprio.provider === builder.provider;
    return {
      config: {
        ...builder,
        provider: proprio.provider,
        // Provider trocado não herda o modelo do builder: nome de modelo é de um provider só.
        model: proprio.model !== "" ? proprio.model : mesmoProvider ? builder.model : "",
        effort: proprio.effort !== "" ? proprio.effort : mesmoProvider ? builder.effort : "",
      },
      ...(proprio.systemInstall !== undefined ? { systemInstall: proprio.systemInstall } : {}),
    };
  });
}

export interface ConferenciaDosAgentes {
  /** Impedem o build: provider que não pode ser executor, ou que não está aqui. */
  erros: string[];
  /** Não impedem, mas quem roda precisa saber. */
  limitacoes: string[];
}

/** O binário do provider existe nesta máquina? */
export async function providerInstalado(provider: string, environment: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const catalogo = CLI_CATALOG.find((item) => item.id === provider);
  if (!catalogo) return false;
  if (provider === "custom") return true;
  const binario = environment[catalogo.binaryEnv]?.trim() || catalogo.defaultBinary;
  try {
    await run("which", [binario]);
    return true;
  } catch {
    return false;
  }
}

/** O binário está no PATH desta máquina? */
export async function binarioNoPath(binario: string): Promise<boolean> {
  try {
    await run("which", [binario]);
    return true;
  } catch {
    return false;
  }
}

/**
 * O nível `workspace` deste executor cumpre o contrato (§106)?
 *
 * Só olha quem constrói sem acesso de sistema: com ele, o agente tem a máquina,
 * por decisão explícita do operador. No workspace o contrato é rodar comandos,
 * alcançar a internet e instalar dependências sem escrever fora do projeto. O
 * provider que comprovadamente não entrega as duas metades juntas é recusado
 * aqui, antes da primeira chamada — nem a rede é tirada, nem o acesso é
 * promovido, em silêncio. O que não pôde ser verificado segue, e é dito.
 */
export async function conferirWorkspace(
  executores: readonly { nome: string; provider: string; systemInstall: boolean }[],
  opcoes: { platform?: NodeJS.Platform; noPath?: (binario: string) => Promise<boolean> } = {},
): Promise<{ erros: string[]; limitacoes: string[] }> {
  const platform = opcoes.platform ?? process.platform;
  const noPath = opcoes.noPath ?? binarioNoPath;
  const erros: string[] = [];
  const limitacoes: string[] = [];
  for (const executor of executores) {
    if (executor.systemInstall) continue;
    const contrato = contratoDoWorkspace(executor.provider, platform);
    if (!contrato) continue;
    if (contrato.estado === "insuficiente") {
      erros.push(
        `${executor.nome}: ${executor.provider} não cumpre o nível workspace — ${contrato.motivo}. ` +
          "Dê acesso de sistema a este executor de forma explícita (systemInstall: true, sem --no-system-install) " +
          "ou use um provider que cumpra o workspace (claude, no Linux)",
      );
      continue;
    }
    if (contrato.estado === "nao-verificado") {
      limitacoes.push(`${executor.nome}: ${contrato.motivo}; rede, instalação de dependências e confinamento não são garantidos pelo harness`);
      continue;
    }
    const faltam: string[] = [];
    for (const binario of contrato.dependencias ?? []) if (!(await noPath(binario))) faltam.push(binario);
    if (faltam.length > 0) {
      erros.push(
        `${executor.nome}: o nível workspace do ${executor.provider} depende de ${faltam.join(" e ")}, que não estão no PATH ` +
          `(${contrato.motivo}). Instale-os ou dê acesso de sistema ao executor de forma explícita`,
      );
    }
  }
  return { erros, limitacoes };
}

/**
 * A intensidade chega à CLI?
 *
 * Perguntado ao próprio adaptador, e não a uma lista: monta-se a chamada com e
 * sem effort, e se os argumentos saem iguais, a CLI não tem onde recebê-lo — o
 * cursor, por exemplo, põe a intensidade no nome do modelo.
 */
export function aceitaEffort(provider: string): boolean {
  const adaptador = CLI_ADAPTERS.find((item) => item.id === provider);
  if (!adaptador) return false;
  const base = { projectRoot: "/projeto", platform: "linux" as const, gitDir: null, model: "", access: "workspace" as const, binary: adaptador.defaultBinary || "x", env: {}, command: "x" };
  return JSON.stringify(adaptador.build({ ...base, effort: "high" }).args) !== JSON.stringify(adaptador.build({ ...base, effort: "" }).args);
}

export async function conferirAgentes(
  agentes: readonly { config: RoleConfig; systemInstall?: boolean }[],
  instalado: (provider: string) => Promise<boolean> = (provider) => providerInstalado(provider),
): Promise<ConferenciaDosAgentes> {
  const erros: string[] = [];
  const limitacoes: string[] = [];
  const conferidos = new Map<string, boolean>();

  for (const [indice, agente] of agentes.entries()) {
    const nome = `agente ${indice + 1}`;
    const provider = agente.config.provider;
    if (isDirectProvider(provider)) {
      erros.push(`${nome}: ${provider} é API direta e não pode construir — o executor escreve arquivos e roda comandos, e isso exige uma CLI`);
      continue;
    }
    if (!isCliProvider(provider)) {
      erros.push(`${nome}: provider desconhecido "${provider}"`);
      continue;
    }
    if (provider === "custom" && agente.config.command.trim() === "") {
      erros.push(`${nome}: o provider custom precisa de --adapter <caminho>`);
      continue;
    }
    if (!conferidos.has(provider)) conferidos.set(provider, await instalado(provider).catch(() => false));
    if (conferidos.get(provider) !== true) {
      erros.push(`${nome}: ${provider} não está instalado nesta máquina (\`capivara doctor\` mostra o que falta)`);
      continue;
    }
    if (agente.config.effort !== "" && !aceitaEffort(provider)) {
      limitacoes.push(`${nome}: ${provider} não recebe intensidade de raciocínio por parâmetro; "${agente.config.effort}" será ignorado`);
    }
  }

  const providers = new Set(agentes.map((agente) => agente.config.provider));
  if (agentes.length > 1 && providers.size === 1) {
    limitacoes.push(`os ${agentes.length} agentes usam ${[...providers][0]}: o limite de uso da conta é um só, e esgota ${agentes.length} vezes mais rápido`);
  }
  return { erros, limitacoes };
}
