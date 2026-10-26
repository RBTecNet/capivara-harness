/**
 * O relatório do run (§125 G; spec §9).
 *
 * A TUI mostra a linha da transição; o relatório guarda o detalhe técnico — e
 * os dois saem da mesma fonte, para nunca contarem histórias diferentes: as
 * linhas de recuperação vêm do `events.tsv` (as mesmas que o narrador mandou
 * à tela), os defeitos do instantâneo de cada fase, as provas do livro de
 * evidências. Nada é recalculado, nada é inferido por modelo, e o que não
 * está registrado não aparece como se estivesse.
 *
 * Grava `relatorio.md` (para ler) e `relatorio.json` (para ferramenta) na
 * pasta do run, a cada fim de execução do build, por cima do anterior — o
 * relatório é derivado; a autoridade continua sendo o que ele lê.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../state/atomic.js";
import { readEvents } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { readRunState, type RunBudgets } from "../state/run-store.js";
import { DEFECTS_CONTRACT, defeitosDoRun, type EstadoDaRecuperacao } from "./defeitos.js";
import { LivroDeEvidencias } from "./evidencias.js";
import { lerTransicoes } from "./narrador.js";

export const REPORT_CONTRACT = "capivara-build-report/v1" as const;

export interface DefeitoNoRelatorio {
  id: string;
  natureza: string;
  gates: string[];
  severidade: string;
  status: string;
  resumo: string;
  tentativas: { acao: number; ciclo: number; gate: string; estrategia: string; resultado: string; sessao?: string; retomada?: boolean }[];
  estrategiasQueFalharam: string[];
  handoffs: string[];
}

export interface FaseNoRelatorio {
  id: string;
  /** O último status da fase no `events.tsv`; sem evento, "sem evento" (fechada antes, bloqueada pela dependência, ou não começou). */
  status: string;
  detalhe: string;
  /** O ciclo absoluto em que a fase está (do instantâneo de defeitos), quando a recuperação a registrou. */
  ciclo: number | null;
  defeitos: DefeitoNoRelatorio[];
  evidencias: { checkId: string; gate: string; resultado: string; validade: string; motivo?: string }[];
  transicoes: string[];
}

export interface ResumoDoRun {
  contract: typeof REPORT_CONTRACT;
  runId: string;
  geradoEm: string;
  status: string;
  budgets?: RunBudgets;
  fases: FaseNoRelatorio[];
  /** As chamadas de agente DESTA execução, por papel, quando o CLI as registrou (`logs/calls.jsonl`). */
  chamadas: Record<string, number> | null;
  /**
   * O que o Core desfez de um agente e seguiu: o commit do executor absorvido,
   * o manifesto acima do projeto devolvido pela preparação. Vêm dos eventos com
   * o detalhe começando por `alerta:`, na ordem em que aconteceram.
   */
  alertas: string[];
}

async function instantaneos(runRoot: string): Promise<Map<string, EstadoDaRecuperacao>> {
  const pasta = defeitosDoRun(runRoot);
  const nomes = await readdir(pasta).catch(() => [] as string[]);
  const porFase = new Map<string, EstadoDaRecuperacao>();
  // Só o instantâneo vigente de cada fase: os arquivados pelo --rebuild-all têm a data no nome.
  for (const nome of nomes.filter((cada) => /^[A-Za-z]\d+\.json$/u.test(cada)).sort()) {
    const lido = await readFile(join(pasta, nome), "utf8").then((bruto) => JSON.parse(bruto) as EstadoDaRecuperacao, () => null);
    if (lido && lido.contract === DEFECTS_CONTRACT) porFase.set(lido.phaseId, lido);
  }
  return porFase;
}

async function chamadasDoLog(logs: string): Promise<Record<string, number> | null> {
  const bruto = await readFile(join(logs, "calls.jsonl"), "utf8").catch(() => null);
  if (bruto === null) return null;
  const contagem: Record<string, number> = {};
  for (const linha of bruto.split("\n").filter(Boolean)) {
    try {
      const chamada = JSON.parse(linha) as { role?: string; repair?: boolean; purpose?: string | null };
      const chave = chamada.purpose ? `verifier:${chamada.purpose}` : chamada.repair ? "verifier:reparo" : chamada.role ?? "desconhecido";
      contagem[chave] = (contagem[chave] ?? 0) + 1;
    } catch {
      contagem["ilegível"] = (contagem["ilegível"] ?? 0) + 1;
    }
  }
  return contagem;
}

/** Monta o resumo do run a partir do que está gravado; não escreve nada. */
export async function resumirRun(projectRoot: string, runId: string, now: () => Date = () => new Date(), planejadas: readonly string[] = []): Promise<ResumoDoRun> {
  const paths = runPaths(projectRoot, runId);
  const [estado, eventos, transicoes, defeitos, livro, chamadas] = await Promise.all([
    readRunState(projectRoot, runId),
    readEvents(paths.events),
    lerTransicoes(projectRoot, runId),
    instantaneos(paths.root),
    LivroDeEvidencias.abrir(paths.root, runId),
    chamadasDoLog(paths.logs),
  ]);
  // As fases do plano entram mesmo sem evento: a que não rodou também é parte do que aconteceu.
  const ids = new Set<string>(planejadas);
  for (const evento of eventos) if (/^[A-Za-z]\d+$/u.test(evento.subject)) ids.add(evento.subject);
  for (const id of defeitos.keys()) ids.add(id);
  for (const transicao of transicoes) ids.add(transicao.fase);
  const fases: FaseNoRelatorio[] = [...ids].sort().map((id) => {
    const ultimo = eventos.filter((evento) => evento.subject === id).at(-1);
    const instantaneo = defeitos.get(id);
    return {
      id,
      status: ultimo?.status ?? "sem evento nesta execução (fechada antes, bloqueada por dependência, ou não começou)",
      detalhe: ultimo?.detail ?? "",
      ciclo: instantaneo?.cycle ?? null,
      defeitos: (instantaneo?.defects ?? []).map((defeito) => ({
        id: defeito.defectId,
        natureza: defeito.nature,
        gates: defeito.gates,
        severidade: defeito.severity,
        status: defeito.status,
        resumo: defeito.summary,
        tentativas: defeito.attempts.map((tentativa) => ({
          acao: tentativa.action,
          ciclo: tentativa.cycle,
          gate: tentativa.gate,
          estrategia: tentativa.strategy,
          resultado: tentativa.result,
          ...(tentativa.agent.sessionId ? { sessao: tentativa.agent.sessionId } : {}),
          ...(tentativa.agent.resumed !== undefined ? { retomada: tentativa.agent.resumed } : {}),
        })),
        estrategiasQueFalharam: defeito.failedStrategies.map((falha) => `${falha.strategy} (ciclo ${falha.cycle})`),
        handoffs: defeito.handoffs,
      })),
      evidencias: livro.daFase(id).map(({ evidence, validity }) => ({
        checkId: evidence.checkId,
        gate: evidence.gate,
        resultado: evidence.outcome,
        validade: validity.state,
        ...(validity.reason ? { motivo: validity.reason } : {}),
      })),
      transicoes: transicoes.filter((transicao) => transicao.fase === id).map((transicao) => transicao.linha),
    };
  });
  return {
    contract: REPORT_CONTRACT,
    runId,
    geradoEm: now().toISOString(),
    status: estado?.status ?? "desconhecido",
    ...(estado?.budgets ? { budgets: estado.budgets } : {}),
    fases,
    chamadas,
    alertas: eventos.filter((evento) => evento.detail.startsWith("alerta:")).map((evento) => `${evento.subject} · ${evento.detail.slice("alerta:".length).trim()}`),
  };
}

export function renderRelatorio(resumo: ResumoDoRun): string {
  const linhas = [`# Relatório do build ${resumo.runId}`, "", `Gerado em ${resumo.geradoEm} · status do run: ${resumo.status}`, ""];
  if (resumo.budgets) {
    const b = resumo.budgets;
    linhas.push(
      "## Orçamentos desta execução",
      "",
      `ciclos ${b.cycles} · reparos por ciclo ${b.repairsPerCycle} · por gate ${b.repairsPerGate} · por defeito ${b.repairsPerDefect} · reparos do verificador por gate ${b.verifierRepairs} · retomada de sessão: ${b.verifierResume}`,
      "",
    );
  }
  if (resumo.chamadas) {
    linhas.push("## Chamadas de agente desta execução", "", ...Object.entries(resumo.chamadas).map(([papel, n]) => `- ${papel}: ${n}`), "");
  }
  if (resumo.alertas.length > 0) {
    linhas.push("## Alertas", "", ...resumo.alertas.map((alerta) => `- ${alerta}`), "");
  }
  for (const fase of resumo.fases) {
    linhas.push(`## ${fase.id} — ${fase.status}${fase.ciclo !== null ? ` · ciclo ${fase.ciclo}` : ""}`, "");
    if (fase.detalhe) linhas.push(fase.detalhe.split("\n")[0] ?? "", "");
    if (fase.defeitos.length > 0) {
      linhas.push("### Defeitos", "");
      for (const defeito of fase.defeitos) {
        linhas.push(`- **${defeito.id}** (${defeito.natureza}, ${defeito.severidade}, ${defeito.gates.join("→")}) — ${defeito.status}: ${defeito.resumo}`);
        for (const tentativa of defeito.tentativas) {
          linhas.push(
            `  - ação ${tentativa.acao} · ciclo ${tentativa.ciclo} · ${tentativa.gate} · ${tentativa.estrategia} → ${tentativa.resultado}` +
              `${tentativa.sessao ? ` · sessão ${tentativa.sessao}${tentativa.retomada ? " (retomada)" : ""}` : ""}`,
          );
        }
        if (defeito.estrategiasQueFalharam.length > 0) linhas.push(`  - sem progresso: ${defeito.estrategiasQueFalharam.join(", ")}`);
        for (const handoff of defeito.handoffs) linhas.push(`  - handoff: ${handoff}`);
      }
      linhas.push("");
    }
    if (fase.evidencias.length > 0) {
      linhas.push("### Evidências", "", "| prova | gate | resultado | validade |", "|---|---|---|---|");
      for (const evidencia of fase.evidencias) {
        linhas.push(`| ${evidencia.checkId} | ${evidencia.gate} | ${evidencia.resultado} | ${evidencia.validade}${evidencia.motivo ? ` — ${evidencia.motivo.replace(/\|/gu, "/")}` : ""} |`);
      }
      linhas.push("");
    }
    if (fase.transicoes.length > 0) linhas.push("### Transições", "", ...fase.transicoes.map((linha) => `- ${linha}`), "");
  }
  return `${linhas.join("\n").trimEnd()}\n`;
}

/** Grava `relatorio.md` e `relatorio.json` na pasta do run; devolve o caminho do markdown. */
export async function gravarRelatorio(projectRoot: string, runId: string, now: () => Date = () => new Date(), planejadas: readonly string[] = []): Promise<string> {
  const paths = runPaths(projectRoot, runId);
  const resumo = await resumirRun(projectRoot, runId, now, planejadas);
  const caminho = join(paths.root, "relatorio.md");
  await writeAtomic(join(paths.root, "relatorio.json"), `${JSON.stringify(resumo, null, 2)}\n`);
  await writeAtomic(caminho, renderRelatorio(resumo));
  return caminho;
}
