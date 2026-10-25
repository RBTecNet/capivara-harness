/**
 * A prova de aptidão: o modelo consegue operar dentro do harness?
 *
 * Antes de qualquer `init`, `plan` ou `build`, cada papel configurado recebe uma
 * tarefa de um ou dois minutos, numa bancada descartável, pelo MESMO caminho de
 * invocação do trabalho real (`createAgentBridge`: adapter, transcrito,
 * credenciais e limites). O Core confere o resultado por conta própria, sem
 * perguntar a nenhum modelo.
 *
 * O veredito separa duas falhas que um run longo confunde:
 * - `inapto`: a sessão terminou normalmente e o modelo não fez o que foi pedido.
 *   O modelo está abaixo do piso para aquele papel.
 * - `instavel`: a sessão não terminou normalmente (tempo esgotado, erro da CLI,
 *   saída cortada). O problema é do momento, não necessariamente do modelo.
 * - `configuracao`: a CLI recusou por cota ou configuração.
 *
 * Um modelo `apto` que depois não fecha o projeto aponta para o harness.
 *
 * A forma da linha de protocolo é tolerada (negrito, crase, marcador de lista,
 * caixa da chave, bloco de raciocínio): embalagem é responsabilidade do parser.
 * O que se exige é o conteúdo. Quando o modelo embrulha a linha, isso vira um
 * alerta, para que se saiba o hábito dele antes do run.
 */

import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BridgeRequest, BridgeResponse } from "../commands/agent.js";
import { ROLES, type RoleConfig, type RoleName } from "../provider/roles.js";
import { isDirectProvider } from "../provider/registry.js";
import type { SupervisorLimits } from "../provider/supervisor.js";

export type Ponte = (request: BridgeRequest) => Promise<BridgeResponse>;

export type VereditoDaAptidao = "apto" | "inapto" | "instavel" | "configuracao";

/** O que o papel pode fazer, e portanto o que a prova pede. */
export type ModoDaAptidao =
  /** Lê, edita, roda comando e responde: o executor e o reparo. */
  | "escrita"
  /** Lê arquivo pela CLI e responde, sem tocar em nada. */
  | "leitura"
  /** API direta: não lê arquivo; o conteúdo vai no prompt. */
  | "direta";

export interface Checagem {
  nome: "sessao" | "protocolo" | "leitura" | "edicao" | "comando";
  ok: boolean;
  detalhe: string;
}

export interface ResultadoDaAptidao {
  papel: RoleName;
  modo: ModoDaAptidao;
  veredito: VereditoDaAptidao;
  checagens: Checagem[];
  /** Não reprovam: dizem algo que vale saber antes do run. */
  alertas: string[];
  /** Do envio do prompt ao primeiro byte; `null` quando a CLI não transmite. */
  primeiraSaidaMs: number | null;
  duracaoMs: number;
  tentativas: number;
}

export interface OpcoesDaAptidao {
  papel: RoleName;
  modo: ModoDaAptidao;
  /** A ponte para a bancada; a mesma fábrica do trabalho real, apontada para outra raiz. */
  criarPonte: (raiz: string) => Ponte;
  /** Onde as bancadas nascem. Cada tentativa usa uma subpasta nova, apagada no fim. */
  pastaBase: string;
  /** Tentativas quando a sessão é instável. Inapto não se repete: a resposta já veio. */
  tentativas?: number;
  /** Acima disto, a primeira saída vira alerta de lentidão. */
  alertaPrimeiraSaidaMs?: number;
  /** Acima disto, a duração vira alerta de lentidão. */
  alertaDuracaoMs?: number;
  /** Relógio injetável, para teste. */
  agora?: () => number;
  /** Sementes injetáveis, para teste. */
  sementes?: () => Sementes;
}

export interface Sementes {
  codigo: string;
  segredo: string;
}

/** Limites da sessão de aptidão: a tarefa é de um ou dois minutos. */
export const LIMITES_DA_APTIDAO: SupervisorLimits = {
  firstOutputSeconds: 180,
  idleSeconds: 180,
  wallSeconds: 420,
  maxOutputBytes: 2 * 1024 * 1024,
};

const CHAVE = "CAPIVARA_APTIDAO";
const ARQUIVOS = { entrada: "entrada.txt", config: "config.json", gerador: "gerar.mjs", resultado: "resultado.txt" } as const;
const CONFIG_INICIAL = { nome: "capivara", versao: 1 };

const executar = promisify(execFile);

function sementesAleatorias(): Sementes {
  return { codigo: `CPV-${randomBytes(4).toString("hex").toUpperCase()}`, segredo: randomBytes(16).toString("hex") };
}

/**
 * O valor que só quem roda `node gerar.mjs` obtém.
 *
 * Um sha256 não se calcula de cabeça: se o valor aparece em `resultado.txt`, o
 * comando foi executado. O segredo está no próprio script, e isso é aceitável:
 * ler o script e calcular o hash à mão também seria executar.
 */
export function saidaEsperadaDoGerador(segredo: string): string {
  return createHash("sha256").update(segredo).digest("hex").slice(0, 16);
}

/** Monta a bancada: quatro arquivos pequenos e, quando há Git, um repositório. */
export async function montarBancada(raiz: string, sementes: Sementes): Promise<void> {
  await mkdir(raiz, { recursive: true });
  await writeFile(join(raiz, ARQUIVOS.entrada), `codigo: ${sementes.codigo}\n`);
  await writeFile(join(raiz, ARQUIVOS.config), `${JSON.stringify(CONFIG_INICIAL, null, 2)}\n`);
  await writeFile(
    join(raiz, ARQUIVOS.gerador),
    [
      'import { createHash } from "node:crypto";',
      `console.log(createHash("sha256").update("${sementes.segredo}").digest("hex").slice(0, 16));`,
      "",
    ].join("\n"),
  );
  // Algumas CLIs (o codex, por exemplo) se comportam diferente fora de um
  // repositório. A bancada imita o projeto real; sem Git, segue sem ele.
  try {
    await executar("git", ["init", "--quiet"], { cwd: raiz });
  } catch {
    /* sem Git disponível: a prova continua valendo */
  }
}

export function promptDaAptidao(modo: ModoDaAptidao, sementes: Sementes): string {
  const final = `Finish your answer with exactly one line: ${CHAVE}: <the code>`;
  if (modo === "direta") {
    return [
      "This is a short capability check of the Capivara harness.",
      `The file \`${ARQUIVOS.entrada}\` contains this line:`,
      "",
      `codigo: ${sementes.codigo}`,
      "",
      "Find the code in that line.",
      final,
    ].join("\n");
  }
  if (modo === "leitura") {
    return [
      "This is a short capability check of the Capivara harness. Work only inside the current directory.",
      `1. Read the file \`${ARQUIVOS.entrada}\`. It contains a code.`,
      "2. Do not create, edit or delete any file.",
      `3. ${final}`,
    ].join("\n");
  }
  return [
    "This is a short capability check of the Capivara harness. Work only inside the current directory.",
    `1. Read the file \`${ARQUIVOS.entrada}\`. It contains a code.`,
    `2. Edit \`${ARQUIVOS.config}\`: change "versao" from 1 to 2. Keep every other field as it is.`,
    `3. Run the command \`node ${ARQUIVOS.gerador}\` and write its exact output to a new file \`${ARQUIVOS.resultado}\`.`,
    `4. ${final}`,
    "Do nothing else.",
  ].join("\n");
}

/** O que não é resposta: o raciocínio que alguns modelos devolvem no texto. */
const RACIOCINIO = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;

/**
 * A linha de protocolo, tolerando a embalagem.
 *
 * Aceita negrito, crase, marcador de lista ou de título, citação e a chave em
 * qualquer caixa. Devolve o código e se a linha veio exata, para o alerta.
 */
export function lerLinhaDeAptidao(saida: string): { codigo: string; exata: boolean } | null {
  const linhas = saida.replace(RACIOCINIO, "").split(/\r?\n/);
  let achado: { codigo: string; exata: boolean } | null = null;
  for (const bruta of linhas) {
    const linha = bruta.trim();
    const exata = new RegExp(`^${CHAVE}:\\s*(\\S+)$`).exec(linha);
    if (exata) {
      achado = { codigo: exata[1] ?? "", exata: true };
      continue;
    }
    const limpa = linha
      .replace(/^(?:[-*+>]|#{1,6}|\d+[.)])\s+/, "")
      .replace(/[`*]/g, "")
      .trim();
    const embrulhada = new RegExp(`^${CHAVE}\\s*:\\s*(\\S+?)[.]?$`, "i").exec(limpa);
    if (embrulhada) achado = { codigo: embrulhada[1] ?? "", exata: false };
  }
  // A última ocorrência vale: é a resposta final, não um rascunho anterior.
  return achado;
}

async function lerTexto(caminho: string): Promise<string | null> {
  try {
    return await readFile(caminho, "utf8");
  } catch {
    return null;
  }
}

function sessaoInstavel(resposta: BridgeResponse): string | null {
  if (resposta.timedOut) return `tempo esgotado (${resposta.timedOut})`;
  if (resposta.engineError) return "a CLI declarou a volta como erro";
  if (resposta.exitCode !== 0) return `a CLI terminou com código ${resposta.exitCode}`;
  if (resposta.partialOutput !== undefined) return "a saída chegou incompleta";
  if (resposta.resultRead === false && resposta.stdout.trim() === "") return "a CLI não devolveu resultado legível";
  return null;
}

/** Julga uma sessão que terminou: só arquivos e texto, sem perguntar a modelo. */
export async function julgarBancada(
  modo: ModoDaAptidao,
  raiz: string,
  sementes: Sementes,
  saida: string,
): Promise<{ checagens: Checagem[]; alertas: string[] }> {
  const checagens: Checagem[] = [];
  const alertas: string[] = [];

  const linha = lerLinhaDeAptidao(saida);
  checagens.push(
    linha
      ? { nome: "protocolo", ok: true, detalhe: `linha ${CHAVE} encontrada` }
      : { nome: "protocolo", ok: false, detalhe: `nenhuma linha ${CHAVE}: <código> na resposta` },
  );
  if (linha && !linha.exata) alertas.push(`formato: a linha ${CHAVE} veio embrulhada (negrito, crase, lista ou caixa); o harness tolera, mas é o hábito deste modelo`);
  if (linha) {
    checagens.push(
      linha.codigo === sementes.codigo
        ? { nome: "leitura", ok: true, detalhe: "o código lido confere" }
        : { nome: "leitura", ok: false, detalhe: `código ${JSON.stringify(linha.codigo)} não é o do arquivo` },
    );
  }

  if (modo === "escrita") {
    const config = await lerTexto(join(raiz, ARQUIVOS.config));
    let edicao: Checagem;
    try {
      const lido = JSON.parse(config ?? "") as Record<string, unknown>;
      const ok = lido.versao === 2 && lido.nome === CONFIG_INICIAL.nome && Object.keys(lido).length === 2;
      edicao = ok
        ? { nome: "edicao", ok: true, detalhe: `${ARQUIVOS.config} com versao 2 e o resto intacto` }
        : { nome: "edicao", ok: false, detalhe: `${ARQUIVOS.config} ficou ${JSON.stringify(lido)}` };
    } catch {
      edicao = { nome: "edicao", ok: false, detalhe: `${ARQUIVOS.config} ausente ou não é JSON válido` };
    }
    checagens.push(edicao);

    const resultado = await lerTexto(join(raiz, ARQUIVOS.resultado));
    const esperado = saidaEsperadaDoGerador(sementes.segredo);
    checagens.push(
      resultado === null
        ? { nome: "comando", ok: false, detalhe: `${ARQUIVOS.resultado} não foi criado` }
        : resultado.trim() === esperado
          ? { nome: "comando", ok: true, detalhe: `node ${ARQUIVOS.gerador} foi executado e a saída gravada` }
          : { nome: "comando", ok: false, detalhe: `${ARQUIVOS.resultado} não contém a saída de node ${ARQUIVOS.gerador}` },
    );
  }

  if (modo === "leitura") {
    // Papel de leitura que escreve não reprova o modelo: diz que a CLI deixou.
    const config = await lerTexto(join(raiz, ARQUIVOS.config));
    const criado = await lerTexto(join(raiz, ARQUIVOS.resultado));
    if (config !== `${JSON.stringify(CONFIG_INICIAL, null, 2)}\n` || criado !== null) {
      alertas.push("permissão: um papel somente leitura alterou a bancada; confira o sandbox desta CLI");
    }
  }

  return { checagens, alertas };
}

/** Roda a prova de um papel. Repete só a sessão instável, nunca a inapta. */
export async function provarAptidao(opcoes: OpcoesDaAptidao): Promise<ResultadoDaAptidao> {
  const agora = opcoes.agora ?? Date.now;
  const gerarSementes = opcoes.sementes ?? sementesAleatorias;
  const maximo = Math.max(1, opcoes.tentativas ?? 2);
  const alertaPrimeira = opcoes.alertaPrimeiraSaidaMs ?? 60_000;
  const alertaDuracao = opcoes.alertaDuracaoMs ?? 180_000;

  let ultimo: ResultadoDaAptidao | null = null;
  for (let tentativa = 1; tentativa <= maximo; tentativa += 1) {
    const sementes = gerarSementes();
    const raiz = join(opcoes.pastaBase, `${opcoes.papel}-${sementes.codigo.toLowerCase()}`);
    try {
      await montarBancada(raiz, sementes);
      const inicio = agora();
      let primeira: number | null = null;
      const resposta = await opcoes.criarPonte(raiz)({
        role: opcoes.papel,
        stage: "aptidao",
        prompt: promptDaAptidao(opcoes.modo, sementes),
        onOutput: () => {
          if (primeira === null) primeira = agora() - inicio;
        },
      });
      const duracaoMs = agora() - inicio;
      const base = { papel: opcoes.papel, modo: opcoes.modo, primeiraSaidaMs: primeira, duracaoMs, tentativas: tentativa };

      if (resposta.providerFailure) {
        return {
          ...base,
          veredito: "configuracao",
          checagens: [{ nome: "sessao", ok: false, detalhe: resposta.providerFailure === "quota" ? "a CLI recusou por cota" : "a CLI recusou por configuração" }],
          alertas: [],
        };
      }

      const instavel = sessaoInstavel(resposta);
      if (instavel) {
        ultimo = { ...base, veredito: "instavel", checagens: [{ nome: "sessao", ok: false, detalhe: instavel }], alertas: [] };
        continue;
      }

      const julgado = await julgarBancada(opcoes.modo, raiz, sementes, resposta.stdout);
      const alertas = [...julgado.alertas];
      if (primeira !== null && primeira > alertaPrimeira) alertas.push(`lentidão: o primeiro byte levou ${Math.round(primeira / 1000)}s`);
      if (duracaoMs > alertaDuracao) alertas.push(`lentidão: a tarefa levou ${Math.round(duracaoMs / 1000)}s`);
      if (tentativa > 1) alertas.push(`instabilidade: precisou de ${tentativa} tentativas`);
      const checagens: Checagem[] = [{ nome: "sessao", ok: true, detalhe: "a sessão terminou normalmente" }, ...julgado.checagens];
      return { ...base, veredito: checagens.every((c) => c.ok) ? "apto" : "inapto", checagens, alertas };
    } finally {
      await rm(raiz, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  // Todas as tentativas foram instáveis.
  return ultimo as ResultadoDaAptidao;
}

/** Uma linha por papel, para o terminal. */
export function resumirAptidao(resultado: ResultadoDaAptidao, rotulo: string): string {
  const marca = { apto: "APTO", inapto: "INAPTO", instavel: "INSTÁVEL", configuracao: "CONFIGURAÇÃO" }[resultado.veredito];
  const tempo = `${(resultado.duracaoMs / 1000).toFixed(1)}s`;
  const falhas = resultado.checagens.filter((c) => !c.ok).map((c) => `  ✗ ${c.nome}: ${c.detalhe}`);
  const alertas = resultado.alertas.map((a) => `  ! ${a}`);
  return [`${marca.padEnd(12)} ${rotulo} (${resultado.modo}, ${tempo})`, ...falhas, ...alertas].join("\n");
}

/**
 * O modo que a prova usa para um papel: o que o papel faz no trabalho real.
 * Quem escreve no workspace prova escrita; quem só lê prova leitura pela CLI;
 * API direta não lê arquivo, e o conteúdo vai no prompt.
 */
export function modoDoPapel(papel: RoleName, config: RoleConfig): ModoDaAptidao {
  if (ROLES[papel].permission === "workspace-write") return "escrita";
  return isDirectProvider(config.provider) ? "direta" : "leitura";
}

/**
 * Os papéis que valem uma prova cada: dois papéis com o mesmo provider, modelo,
 * effort e modo fariam a mesma prova duas vezes.
 */
export function papeisParaProvar(roles: Record<RoleName, RoleConfig>, papeis: readonly RoleName[]): RoleName[] {
  const vistos = new Set<string>();
  const escolhidos: RoleName[] = [];
  for (const papel of papeis) {
    const config = roles[papel];
    if (!config.provider) continue;
    const chave = [config.provider, config.model, config.effort, config.command, modoDoPapel(papel, config)].join("|");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    escolhidos.push(papel);
  }
  return escolhidos;
}
