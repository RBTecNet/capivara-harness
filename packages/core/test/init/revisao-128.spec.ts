/**
 * §128 — os defeitos que a revisão adversarial reproduziu na primeira versão,
 * de ponta a ponta (`runInit` + `runPlan`, provider falso, textos do run).
 *
 * - a fase mantida pela reorganização (F2) perdia a decisão que o
 *   desenvolvedor tinha acabado de tomar sobre ela, na mesma rodada: o achado
 *   de fase "fica para a próxima auditoria", e a próxima auditoria de uma
 *   fase aprovada e intacta não acontece;
 * - a fase mantida não comparava as decisões de dados: o status trocado na
 *   arquitetura publicada saía com os valores antigos na fase;
 * - a emenda que tira uma task e acrescenta outra (mesma contagem) perdia a
 *   task das migrações e duplicava outras, e o plano saía RALPH READY.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { NO_QUESTIONS, approve, fakeAgent } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";
import { arquiteturaSemTestes, faseSemTestes } from "../support/sem-testes.js";

const fixture = (nome: string): string => readFileSync(join(import.meta.dirname, "..", "fixtures", nome), "utf8");
const PEDIDO = fixture("parallel-lab-128.pedido.md");
const ESQUELETO = fixture("parallel-lab-128.skeleton.json");
// O texto do run sem o "o módulo possui testes automatizados próprios" que a §129 recusa (`sem-testes.ts`).
const V5 = arquiteturaSemTestes(fixture("parallel-lab-128.architecture-v5.json"));
const FASES = { r1: Object.fromEntries(Object.entries((JSON.parse(fixture("parallel-lab-128.fases.json")) as { r1: Record<string, string> }).r1).map(([numero, texto]) => [numero, faseSemTestes(texto)])) };
const P3_SEM_TESTE = FASES.r1["3"]!.replace(" e concluir a cobertura automatizada própria do módulo", "");
const faseR1 = (numero: number): string => (numero === 3 ? P3_SEM_TESTE : FASES.r1[String(numero)]!);

const ehEmenda = (prompt: string): boolean => prompt.includes("## The phase to amend");
const ehReorganizacao = (prompt: string): boolean => prompt.includes("## The audit of your previous architecture found");

let projectRoot = "";
beforeEach(async () => { projectRoot = await mkdtemp(join(tmpdir(), "capivara-rev128-")); });
afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });

const request = { text: PEDIDO, origin: "text" as const, path: null, sha12: "parallellab128" };
const language = "português do Brasil" as const;

interface Papeis {
  arquitetoReorganizado: string;
  fase: (numero: number, call: AgentCall) => string;
  emenda?: (numero: number, call: AgentCall) => string;
  /** A auditoria do plano inteiro. */
  coerencia: (call: AgentCall) => string;
}

function roteiro(papeis: Papeis): ScriptStep[] {
  return [
    { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: ESQUELETO }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: (call) => (ehReorganizacao(call.prompt) ? papeis.arquitetoReorganizado : V5) }, repeat: true },
    ...[1, 2, 3, 4, 5].map((numero): ScriptStep => ({
      match: { role: "writer", stage: "authoring", subject: `phase-p0${numero}` },
      respond: {
        stdout: (call) => {
          if (!ehEmenda(call.prompt)) return papeis.fase(numero, call);
          if (papeis.emenda) return papeis.emenda(numero, call);
          return call.prompt.slice(call.prompt.indexOf("## The phase to amend") + "## The phase to amend".length).trim();
        },
      },
      repeat: true,
    })),
    // O plano é auditado inteiro, numa chamada (etapa 2 da redução).
    { match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, respond: { stdout: papeis.coerencia }, repeat: true },
    { match: { role: "auditor", stage: "audit" }, respond: { stdout: approve() }, repeat: true },
  ];
}

async function planejar(papeis: Papeis) {
  const agentDoInit = fakeAgent(roteiro(papeis));
  await runInit({ projectRoot, request, language, stage: "init", call: agentDoInit.call, ask: async () => "1", announce: () => undefined });
  const perguntadas: Question[] = [];
  const avisos: string[] = [];
  const agent = fakeAgent(roteiro(papeis));
  const outcome = await runPlan({
    projectRoot, request, language, call: agent.call,
    ask: async (question) => { perguntadas.push(question); return "1"; },
    announce: (linha) => { avisos.push(linha); },
    sleep: async () => undefined,
  });
  const publicado = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8").catch(() => "");
  return { outcome, agent, perguntadas, avisos, publicado };
}

const secaoDaFase = (plano: string, numero: number): string => {
  const inicio = plano.indexOf(`## Phase ${numero}:`);
  const fim = plano.indexOf(`## Phase ${numero + 1}:`);
  return inicio < 0 ? "" : plano.slice(inicio, fim < 0 ? undefined : fim);
};

/** A v5 com SÓ o goal da fase 2 mudado: visão geral, componentes, decisões e infraestrutura iguais. */
const v5ComGoalDaFase2 = (): string => {
  const arquitetura = JSON.parse(V5) as { phases: { number: number; goal: string }[] };
  arquitetura.phases.find((fase) => fase.number === 2)!.goal = "Entregar a interface responsiva em português brasileiro, a navegação lateral, as páginas de entrada dos módulos e o painel inicial com totais reais obtidos pela API.";
  return JSON.stringify(arquitetura);
};



describe("§128 · revisão — a emenda que tira uma task e acrescenta outra", () => {
  it("a fase 1 publicada mantém a task das migrações e não duplica tasks", async () => {
    let coerencias = 0;
    // As duas passagens citadas existem nas fases 1 e 2 do run: o Core as confere antes de devolver o plano.
    const ACHADO = [
      "CAPIVARA_AUDIT_STATUS: REJECTED",
      "CAPIVARA_FINDING: CONTRADICTION | P1.T1.C3 vs P2.T1.C1 | A fundação diz «`index.html` monta a aplicação React a partir de `src/web/main.tsx`»; a interface diz «Em `src/main.tsx` e `src/styles`, montar» | Em P1, use `src/main.tsx` como ponto de entrada.",
      "CAPIVARA_REASON: pontos de entrada incompatíveis",
    ].join("\n");
    const nova = "- [ ] **Task:** Em `src/server/health.ts`, expor `GET /api/saude` para o painel.\n  - **Acceptance criteria:**\n    - `GET /api/saude` responde 200 com `{\"ok\":true}`.\n  - **Traces:** workflow 4";
    const { outcome, publicado, agent } = await planejar({
      arquitetoReorganizado: V5,
      fase: (numero) => faseR1(numero),
      emenda: (numero, call) => {
        const atual = call.prompt.slice(call.prompt.indexOf("## The phase to amend") + "## The phase to amend".length).trim();
        if (numero !== 1) return atual;
        const tasks = faseR1(1).split(/\n(?=- \[ \] \*\*Task:\*\*)/);
        // O escritor corrige a Task 1, tira a Task 3 (migrações) e acrescenta uma no fim: mesma contagem.
        return [tasks[0]!.replace("a partir de `src/web/main.tsx`", "a partir de `src/main.tsx`"), tasks[1]!, ...tasks.slice(3).map((t) => t.trimEnd() + "\n"), nova].join("\n");
      },
      coerencia: () => ((coerencias += 1) === 1 ? ACHADO : approve()),
    });
    const fase1 = secaoDaFase(publicado, 1);
    const titulos = [...fase1.matchAll(/^- \[[ x]\] \*\*Task:\*\* (.{0,50})/gm)].map((m) => m[1]);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(agent.calls.some((call) => call.subject === "phase-p01" && call.prompt.includes("## The phase to amend")), "a contradição citada não chegou à emenda").toBe(true);
    expect(fase1, "a task das migrações sumiu do plano publicado").toContain("Em `src/migrations`, crie migrações versionadas");
    expect(new Set(titulos).size, "tasks duplicadas no plano publicado").toBe(titulos.length);
  });
});
