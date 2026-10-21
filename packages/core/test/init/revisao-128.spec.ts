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
import { NO_QUESTIONS, approve, fakeAgent, materialityKeeps, rehearsalApproves, reject } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

const fixture = (nome: string): string => readFileSync(join(import.meta.dirname, "..", "fixtures", nome), "utf8");
const PEDIDO = fixture("parallel-lab-128.pedido.md");
const ESQUELETO = fixture("parallel-lab-128.skeleton.json");
const V5 = fixture("parallel-lab-128.architecture-v5.json");
const FASES = JSON.parse(fixture("parallel-lab-128.fases.json")) as { r1: Record<string, string> };
const P3_SEM_TESTE = FASES.r1["3"]!.replace(" e concluir a cobertura automatizada própria do módulo", "");
const faseR1 = (numero: number): string => (numero === 3 ? P3_SEM_TESTE : FASES.r1[String(numero)]!);

const ehEmenda = (prompt: string): boolean => prompt.includes("## The phase to amend");
const ehReorganizacao = (prompt: string): boolean => prompt.includes("## The audit of your previous architecture found");

/** Um achado de coerência endereçado à arquitetura: pede reorganização. */
const ACHADO_DE_ARQUITETURA = reject(
  "Architecture (P1 vs P2)",
  "A fase 2 promete a inicialização integrada da interface com a API, que a fase 1 já entrega.",
  "Reorganize o goal da Phase 2 para não prometer a inicialização que a Phase 1 entrega.",
);

let projectRoot = "";
beforeEach(async () => { projectRoot = await mkdtemp(join(tmpdir(), "capivara-rev128-")); });
afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });

const request = { text: PEDIDO, origin: "text" as const, path: null, sha12: "parallellab128" };
const language = "português do Brasil" as const;

interface Papeis {
  arquitetoReorganizado: string;
  fase: (numero: number, call: AgentCall) => string;
  emenda?: (numero: number, call: AgentCall) => string;
  auditorDaFase: (numero: number, call: AgentCall) => string;
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
    { match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" }, respond: { stdout: papeis.coerencia }, repeat: true },
    {
      match: { role: "auditor", stage: "audit" },
      respond: {
        stdout: (call) => {
          const numero = Number(/#P(\d+)$/.exec(call.subject)?.[1] ?? "0");
          return numero > 0 ? papeis.auditorDaFase(numero, call) : approve();
        },
      },
      repeat: true,
    },
    materialityKeeps(),
    rehearsalApproves(),
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
    decideStandoff: async () => "publicar",
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

describe("§128 · revisão — a decisão do desenvolvedor na mesma rodada de uma reorganização", () => {
  it("a decisão levantada pelo auditor da fase 4 chega ao texto publicado da fase 4", async () => {
    let p4 = 0;
    let coerencias = 0;
    const decisao = `${approve()}\nCAPIVARA_DECISION: Task 2 | Uma categoria pode ser excluída enquanto tarefas antigas ainda citam o nome dela? | Sim, a exclusão é livre | Não, a exclusão é recusada`;
    const { outcome, agent, perguntadas, publicado } = await planejar({
      arquitetoReorganizado: v5ComGoalDaFase2(),
      // O escritor aplica a decisão quando ela está no prompt (escrita do zero ou emenda).
      fase: (numero, call) => (call.prompt.includes("a exclusão é livre") ? faseR1(numero).replace("- **Traces:**", "- DECISAO-APLICADA: a exclusão é livre.\n  - **Traces:**") : faseR1(numero)),
      emenda: (numero, call) => {
        const atual = call.prompt.slice(call.prompt.indexOf("## The phase to amend") + "## The phase to amend".length).trim();
        return call.prompt.includes("a exclusão é livre") && !atual.includes("DECISAO-APLICADA") ? atual.replace("- **Traces:**", "- DECISAO-APLICADA: a exclusão é livre.\n  - **Traces:**") : atual;
      },
      auditorDaFase: (numero) => (numero === 4 && (p4 += 1) === 1 ? decisao : approve()),
      coerencia: () => ((coerencias += 1) === 1 ? ACHADO_DE_ARQUITETURA : approve()),
    });
    // A fase 4 tinha achado aberto (a decisão) quando a reorganização veio: ela é escrita de novo, com a decisão no prompt.
    expect(agent.calls.filter((call) => call.subject === "phase-p04" && !ehEmenda(call.prompt))).toHaveLength(2);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toHaveLength(1);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    // Seguro: a decisão que o desenvolvedor tomou está na fase que a levantou.
    expect(secaoDaFase(publicado, 4), "decisão do desenvolvedor ausente da fase 4 publicada").toContain("DECISAO-APLICADA");
  });
});

describe("§128 · revisão — a decisão de dados muda na reorganização", () => {
  it("o status trocado na decisão de dados chega à fase 3 publicada: ela não é mantida", async () => {
    // Reorganização que, além do goal da fase 2, troca os valores de status (decisão de dados, fora da comparação).
    const arquitetura = JSON.parse(v5ComGoalDaFase2()) as { dataDecisions: { subject: string; statement: string }[] };
    arquitetura.dataDecisions = arquitetura.dataDecisions.map((entrada) => entrada.subject === "tarefas.status"
      ? { ...entrada, statement: "Armazenar status como texto e aceitar somente aberta, fazendo ou feita ao criar ou atualizar." }
      : entrada);
    let coerencias = 0;
    const { outcome, publicado } = await planejar({
      arquitetoReorganizado: JSON.stringify(arquitetura),
      // O escritor segue a fatia que recebe.
      fase: (numero, call) => (call.prompt.includes("aberta, fazendo ou feita") ? faseR1(numero).replaceAll("pendente", "aberta").replaceAll("em andamento", "fazendo").replaceAll("concluída", "feita") : faseR1(numero)),
      auditorDaFase: () => approve(),
      coerencia: () => ((coerencias += 1) === 1 ? ACHADO_DE_ARQUITETURA : approve()),
    });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const arquiteturaPublicada = await readFile(join(projectRoot, ".capivara", "init", "architecture.md"), "utf8").catch(() => "");
    expect(arquiteturaPublicada).toContain("aberta, fazendo ou feita");
    const fase3 = secaoDaFase(publicado, 3);
    expect(fase3, "fase 3 publicada contradiz a decisão de dados publicada").not.toContain("pendente");
  });
});

describe("§128 · revisão — a emenda que tira uma task e acrescenta outra", () => {
  it("a fase 1 publicada mantém a task das migrações e não duplica tasks", async () => {
    let coerencias = 0;
    const ACHADO = reject(
      "P1.T1.C3 vs P2.T1.C1",
      "A fundação exige que `index.html` monte `src/web/main.tsx`; a interface exige `src/main.tsx`, e o script `dev` precisa iniciar `src/server/index.ts`.",
      "Em P1, use `src/main.tsx` como ponto de entrada.",
    );
    const nova = "- [ ] **Task:** Em `src/server/health.ts`, expor `GET /api/saude` para o painel.\n  - **Acceptance criteria:**\n    - `GET /api/saude` responde 200 com `{\"ok\":true}`.\n  - **Traces:** workflow 4";
    const promptsP1: string[] = [];
    const { outcome, publicado } = await planejar({
      arquitetoReorganizado: V5,
      fase: (numero) => faseR1(numero),
      emenda: (numero, call) => {
        const atual = call.prompt.slice(call.prompt.indexOf("## The phase to amend") + "## The phase to amend".length).trim();
        if (numero !== 1) return atual;
        const tasks = faseR1(1).split(/\n(?=- \[ \] \*\*Task:\*\*)/);
        // O escritor corrige a Task 1, tira a Task 3 (migrações) e acrescenta uma no fim: mesma contagem.
        return [tasks[0]!.replace("a partir de `src/web/main.tsx`", "a partir de `src/main.tsx`"), tasks[1]!, ...tasks.slice(3).map((t) => t.trimEnd() + "\n"), nova].join("\n");
      },
      auditorDaFase: (numero, call) => { if (numero === 1) promptsP1.push(call.prompt); return approve(); },
      coerencia: () => ((coerencias += 1) === 1 ? ACHADO : approve()),
    });
    const fase1 = secaoDaFase(publicado, 1);
    const titulos = [...fase1.matchAll(/^- \[[ x]\] \*\*Task:\*\* (.{0,50})/gm)].map((m) => m[1]);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(fase1, "a task das migrações sumiu do plano publicado").toContain("Em `src/migrations`, crie migrações versionadas");
    expect(new Set(titulos).size, "tasks duplicadas no plano publicado").toBe(titulos.length);
  });
});
