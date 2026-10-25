import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import { PHASE_1, PHASE_2, approve, fakeAgent, reject, skeletonPath } from "../support/fake-agent.js";

let projectRoot: string;
const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };
const language = "português do Brasil" as const;
const ask = async () => "use as recomendações";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-plan-convergence-"));
  await runInit({ projectRoot, request, language, stage: "init", call: fakeAgent(skeletonPath()).call, ask });
});
afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });

const original = "A tabela statuses existe e contém exatamente pendente, confirmada e cancelada";
const corrected = original + "; o seed pode ser executado duas vezes";
const correctedPhase = PHASE_1.replace(original, corrected);

it("decisão técnica compatível não vai ao usuário nem muda a autoridade", async () => {
  const questions: string[] = [];
  const agent = fakeAgent([
    { match: { stage: "audit", subject: "project-phases.md#coerência" }, repeat: true, respond: { stdout: approve() +
      "\nCAPIVARA_DECISION: P1.T1.C1 | O seed deve usar uma função ou uma classe? | Uma função que semeia as linhas. | Uma classe que semeia as linhas." } },
    { match: { role: "verifier", subject: "project-phases.md#materialidade" }, repeat: true, respond: {
      stdout: JSON.stringify({ reviews: [{ id: "D1", disposition: "ADVISORY", reason: "As duas técnicas entregam os mesmos estados exigidos; não falta regra de negócio.",
        evidence: [{ source: "P1", quote: original }] }] }),
    } },
    ...skeletonPath(),
  ]);
  const outcome = await runPlan({ projectRoot, request, language, call: agent.call, ask: async question => {
    questions.push(question.decision);
    return ask();
  } });
  expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  expect(questions.some(question => question.includes("função ou uma classe"))).toBe(false);
  expect(agent.calls.filter(c => c.prompt.includes("amending a phase"))).toHaveLength(0);
});

it("emenda recebe os contratos citados e preserva a task não citada sem outra chamada", async () => {
  let global = 0;
  const agent = fakeAgent([
    { match: { stage: "audit", subject: "project-phases.md" }, repeat: true, respond: { stdout: () => ++global === 1
      ? reject("P1.T1.C1 vs P2.T1.C1", "seed deve combinar com a criação", "explicite a idempotência do seed") : approve() } },
    { match: { stage: "authoring", subject: "phase-p01" }, repeat: true, respond: { stdout: call => {
      if (!call.prompt.includes("amending a phase")) return PHASE_1;
      expect(call.prompt).toContain("## Related phases (read-only)");
      expect(call.prompt).toContain("Uma reserva nova nasce com status pendente");
      return correctedPhase.replace("status_id referenciando statuses", "status_id sem chave estrangeira");
    } } },
    { match: { stage: "authoring", subject: "phase-p02" }, repeat: true, respond: { stdout: call => {
      if (call.prompt.includes("amending a phase")) {
        expect(call.prompt).toContain("## Related phases (read-only)");
        expect(call.prompt).toContain(original);
      }
      return PHASE_2;
    } } },
    ...skeletonPath(),
  ]);
  const outcome = await runPlan({ projectRoot, request, language, ask, call: agent.call });
  expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  const content = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
  expect(content).toContain(corrected);
  expect(content).toContain("status_id referenciando statuses");
  expect(content).not.toContain("sem chave estrangeira");
  expect(agent.calls.filter(c => c.prompt.includes("amending a phase"))).toHaveLength(2);
});
