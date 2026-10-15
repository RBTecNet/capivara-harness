/**
 * A estratégia de execução do build, do jeito que o CLI a entrega ao loop (§97).
 *
 * Junta as três fontes — flags, `.capivara/execucao.json`, padrão serial —, monta
 * o pool de agentes sobre o papel `builder`, confere cada agente contra a
 * máquina, e escreve o resumo que aparece ANTES da primeira chamada de modelo.
 *
 * Fora do `cli-program.ts` para ter teste: é aqui que uma precedência trocada
 * ligaria o paralelo num projeto que nunca o pediu.
 */

import {
  conferirAgentes,
  lerArquivoDeExecucao,
  papeisDosAgentes,
  resolverEstrategia,
  type EstrategiaDeExecucao,
  type FlagsDeExecucao,
  type OrigemDaEstrategia,
} from "../config/execucao.js";
import { ARQUIVO_DE_EXECUCAO } from "../config/execucao.js";
import type { RoleConfig, RoleName } from "../provider/index.js";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isRepository } from "../loop/git.js";
import { suportaWorktree } from "../loop/worktree.js";
import { splitPhases } from "../loop/split.js";
import { larguraDoPlano } from "../loop/escalonador.js";

const run = promisify(execFile);

export interface AgentePreparado {
  config: RoleConfig;
  systemInstall: boolean;
  /** `codex/gpt-5.5 · high`. */
  label: string;
}

export type ExecucaoPreparada =
  | { ok: false; erros: string[] }
  | {
      ok: true;
      estrategia: EstrategiaDeExecucao;
      origem: OrigemDaEstrategia;
      /** Vazio no serial: quem constrói é o `builder`, como sempre. */
      agentes: AgentePreparado[];
      /** As linhas do resumo, na ordem em que vão à tela. Vazio no serial padrão. */
      resumo: string[];
    };

export function rotuloDoAgente(config: RoleConfig): string {
  return `${config.provider}/${config.model || "padrão"}${config.effort ? ` · ${config.effort}` : ""}`;
}

const DE_ONDE: Record<OrigemDaEstrategia, string> = {
  padrão: "padrão",
  arquivo: `de ${ARQUIVO_DE_EXECUCAO}`,
  flags: "pedida na linha de comando",
};

export async function prepararExecucao(options: {
  projectRoot: string;
  flags: FlagsDeExecucao;
  roles: Record<RoleName, RoleConfig>;
  /** O build permite instalar no sistema (`--no-system-install` desliga). */
  systemInstall: boolean;
  instalado?: (provider: string) => Promise<boolean>;
}): Promise<ExecucaoPreparada> {
  const resolvida = resolverEstrategia(options.flags, await lerArquivoDeExecucao(options.projectRoot));
  if (!resolvida.ok) return { ok: false, erros: resolvida.erros };

  const { estrategia, origem } = resolvida;
  const avisos = resolvida.avisos.map((aviso) => `aviso: ${aviso}`);
  if (estrategia.mode === "serial") {
    return {
      ok: true,
      estrategia,
      origem,
      agentes: [],
      resumo: origem === "padrão" ? avisos : [`execução: serial, uma fase por vez (${DE_ONDE[origem]})`, ...avisos],
    };
  }

  const pool = papeisDosAgentes(estrategia, options.roles.builder);
  const conferencia = await conferirAgentes(pool, options.instalado);
  if (conferencia.erros.length > 0) {
    return {
      ok: false,
      erros: [
        "a execução paralela não pode começar com estes agentes:",
        ...conferencia.erros.map((erro) => `  · ${erro}`),
        "",
        `Ajuste com --worker, no wizard, ou em ${ARQUIVO_DE_EXECUCAO}; ou rode com --serial.`,
      ],
    };
  }

  // Um agente nunca ganha mais acesso que o build: a restrição dele só tira.
  const agentes = pool.map((agente) => ({
    config: agente.config,
    systemInstall: options.systemInstall && agente.systemInstall !== false,
    label: rotuloDoAgente(agente.config),
  }));
  const verificador = options.roles.verifier;
  const resumo = [
    `execução: paralela, até ${estrategia.maxConcurrency} agentes ao mesmo tempo (${DE_ONDE[origem]})`,
    ...agentes.map(
      (agente, indice) =>
        `  agente ${indice + 1}: ${agente.label}${options.systemInstall && !agente.systemInstall ? " · sem instalar no sistema" : ""}` +
        `${estrategia.workers[indice] ? "" : " (o executor)"}`,
    ),
    `  o verificador continua um só, independente de quem construiu: ${rotuloDoAgente(verificador)}`,
    "  quem decide qual fase vai para qual agente é o escalonador, pelo Depends on do plano",
    ...conferencia.limitacoes.map((limitacao) => `limitação: ${limitacao}`),
    ...avisos,
  ];
  return { ok: true, estrategia, origem, agentes, resumo };
}

/** O que o wizard precisa saber da pasta para oferecer o paralelo (§97). */
export async function estrategiaSalva(projectRoot: string): Promise<EstrategiaDeExecucao | null> {
  const lido = await lerArquivoDeExecucao(projectRoot);
  return lido.estado === "ok" ? lido.estrategia : null;
}

/**
 * O paralelo roda nesta pasta?
 *
 * Com repositório, a pergunta é a do próprio git: ele cria worktree? Sem
 * repositório ainda não há o que perguntar — o build cria um na pasta nova, ou
 * pergunta antes de criar sobre trabalho que já existe —, e o que pode faltar é
 * o git.
 */
export async function disponibilidadeDoParalelo(projectRoot: string): Promise<{ disponivel: boolean; motivo: string }> {
  if (await isRepository(projectRoot)) {
    return (await suportaWorktree(projectRoot))
      ? { disponivel: true, motivo: "" }
      : { disponivel: false, motivo: "o git desta máquina não cria worktree (exige git 2.5 ou maior)" };
  }
  try {
    const { stdout } = await run("git", ["--version"]);
    const [maior, menor] = (/(\d+)\.(\d+)/.exec(stdout) ?? []).slice(1).map(Number);
    if (maior === undefined || menor === undefined || maior > 2 || (maior === 2 && menor >= 5)) return { disponivel: true, motivo: "" };
    return { disponivel: false, motivo: `git ${maior}.${menor} não cria worktree (exige 2.5 ou maior)` };
  } catch {
    return { disponivel: false, motivo: "o git não está instalado, e cada agente precisa de um worktree" };
  }
}

/** Quantas fases o plano da pasta deixa rodar juntas; nulo sem plano legível. */
export async function larguraDoPlanoNaPasta(projectRoot: string): Promise<number | null> {
  const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8").catch(() => null);
  if (plano === null) return null;
  const dividido = splitPhases(plano, projectRoot, "wizard");
  return dividido.ok ? larguraDoPlano(dividido.sessions) : null;
}
