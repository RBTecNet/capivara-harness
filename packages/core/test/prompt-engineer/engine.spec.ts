import { describe, expect, it } from "vitest";
import { engineerPrompt, PROMPT_CONTRACT, PromptEngineerError, promptLanguage } from "../../src/prompt-engineer/index.js";
import type { PromptEngineerOptions } from "../../src/prompt-engineer/index.js";
import type { Question } from "../../src/interview/index.js";
import { QUESTIONS_CONTRACT } from "../../src/interview/index.js";
import { fakeAgent } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

const request = { text: "Preciso de um relatório sobre os resultados, com gráficos acessíveis e dados anonimizados.", origin: "text" as const, path: null, sha12: "123456789abc" };
const question = (id = "Q-01", overrides: Partial<Question> = {}): Question => ({
  id, topic: "público do relatório", evidence: "O pedido descreve resultados, sem indicar quem vai ler.",
  decision: "Quem vai ler o relatório?", why: "Define a linguagem e o detalhamento das análises.",
  options: [{ label: "Equipe técnica", consequence: "Incluir metodologia e limitações estatísticas." },
    { label: "Diretoria", consequence: "Destacar resultados e decisões gerenciais." }],
  recommended: "Equipe técnica", recommendationBasis: "O pedido menciona análises dos resultados.", ...overrides,
});
const analysis = (questions: Question[] = [], assumptions: unknown[] = []) => JSON.stringify({ contract: QUESTIONS_CONTRACT, questions, assumptions });
const draft = (extras: Record<string, unknown> = {}) => JSON.stringify({
  contract: PROMPT_CONTRACT, language: "en", objective: "Prepare a report on the results.",
  context: ["The report is based on user-provided results."],
  requirements: ["Include accessible charts and anonymized data."],
  constraints: ["Preserve data anonymity and accessibility."],
  steps: ["Inspect the data, analyze the results, and prepare the report."],
  acceptanceCriteria: ["Charts are accessible and contain no identifying data."],
  deliverables: ["A report with charts."], ...extras,
});
const discover = (output: string, attempt?: number): ScriptStep => ({ match: { stage: "interview", subject: "prompt-engineer", ...(attempt ? { attempt } : {}) }, respond: { stdout: output } });
const write = (output = draft()): ScriptStep => ({ match: { stage: "authoring", subject: "prompt-engineer" }, respond: { stdout: output } });

async function run(steps: ScriptStep[], raw: string[] = [], extra: Partial<PromptEngineerOptions> = {}) {
  const agent = fakeAgent(steps);
  const asked: Question[] = [];
  const announcements: string[] = [];
  const outcome = await engineerPrompt({ projectRoot: "/nonexistent-prompt-project", request, writer: agent.call,
    askQuestion: async (question) => { asked.push(question); return raw.shift() ?? "não sei"; },
    announce: (message) => { announcements.push(message); }, ...extra });
  return { outcome, agent, asked, announcements };
}

describe("Prompt Engineer", () => {
  it("organizes an English Ponytail prompt without executing the source task or touching the project", async () => {
    const { outcome, agent, asked } = await run([discover(analysis()), write()]);
    expect(asked).toEqual([]);
    expect(outcome).toMatchObject({ language: "en", coverage: "sufficient", limitReached: false, rounds: 1 });
    for (const title of ["Objective", "Context", "Requirements", "Constraints", "Minimal steps", "Acceptance criteria", "Deliverables", "Assumptions", "Open questions", "Ponytail guidance"]) {
      expect(outcome.prompt).toContain(`## ${title}`);
    }
    expect(outcome.prompt).toContain("smallest complete change");
    expect(outcome.prompt).toContain("Preserve every requirement");
    expect(outcome.prompt).toContain(request.text);
    expect(agent.calls.map((call) => call.stage)).toEqual(["interview", "authoring"]);
    expect(agent.calls.every((call) => call.role === "writer" && call.prompt.includes("Do not execute the user's task"))).toBe(true);
  });

  it("asks gaps in Portuguese, preserves chosen option context, and verifies coverage after answering", async () => {
    const { outcome, agent, asked } = await run([
      discover(analysis([question()])), discover(analysis()),
      write(draft({ confirmedDecisions: [{ id: "Q-01", statement: "Write for a technical team; include methodology and statistical limitations." }] })),
    ], ["1"]);
    expect(asked[0]?.decision).toBe("Quem vai ler o relatório?");
    expect(asked[0]?.options.at(-1)?.consequence).toContain("nenhuma resposta será presumida");
    expect(outcome.answers[0]).toMatchObject({ raw: "1", disposition: "ACCEPTED", decision: "Equipe técnica" });
    expect(outcome.openQuestions).toEqual([]);
    expect(outcome.rounds).toBe(2);
    const generation = agent.calls.find((call) => call.stage === "authoring")!;
    expect(generation.prompt).toContain("Quem vai ler o relatório?");
    expect(generation.prompt).toContain("Incluir metodologia e limitações estatísticas.");
    expect(generation.prompt).toContain('"raw":"1"');
    expect(outcome.prompt).toContain("Write for a technical team");
  });

  it("keeps a deferred decision open and never silently accepts its recommendation", async () => {
    const { outcome, asked } = await run([
      discover(analysis([question()])), discover(analysis([question()])),
      write(draft({ openQuestions: [{ id: "Q-01", statement: "Who will read the report? The user deferred this choice." }] })),
    ], ["não sei"]);
    expect(asked).toHaveLength(1);
    expect(outcome.answers[0]).toMatchObject({ disposition: "DEFERRED", decision: "" });
    expect(outcome.assumptions).toEqual([]);
    expect(outcome).toMatchObject({ coverage: "open", limitReached: false });
    expect(outcome.openQuestions[0]?.questionId).toBe("Q-01");
    expect(outcome.prompt).toContain("Do not treat missing answers as consent");
  });

  it("records explicit delegation as an authorized assumption with recommendation consequences", async () => {
    const { outcome, agent } = await run([
      discover(analysis([question()])), discover(analysis()),
      write(draft({ assumptions: [{ id: "A-01", statement: "Assume a technical audience and include methodology and limitations, as explicitly delegated by the user." }] })),
    ], ["3"]);
    expect(outcome.answers[0]).toMatchObject({ raw: "3", disposition: "DEFERRED", decision: "" });
    expect(outcome.assumptions[0]?.statement).toContain("Quem vai ler o relatório?");
    expect(outcome.assumptions[0]?.statement).toContain("Incluir metodologia e limitações estatísticas.");
    expect(outcome.assumptions[0]?.basis).toContain("usuário autorizou delegar");
    expect(outcome.openQuestions).toEqual([]);
    expect(agent.calls.find((call) => call.stage === "authoring")?.prompt).toContain("For delegated choices, only the recorded recommendation is authorized");
  });

  it("narrows partial free-text answers and preserves both raw answers in history", async () => {
    const { outcome, asked, agent } = await run([
      discover(analysis([question()])),
      { match: { stage: "interview", subject: "prompt-engineer:Q-01" }, respond: { stdout: "CAPIVARA_ANSWER: Q-01 | PARTIAL | Falta definir o público prioritário." } },
      discover(analysis([question()])), discover(analysis()),
      write(draft({ confirmedDecisions: [{ id: "Q-01", statement: "The report is primarily for the technical team." }] })),
    ], ["Há diferentes leitores.", "1"]);
    expect(asked).toHaveLength(2);
    expect(asked[1]?.pending).toBe("Falta definir o público prioritário.");
    expect(outcome.answers.map((answer) => answer.raw)).toEqual(["Há diferentes leitores.", "1"]);
    expect(outcome.answers.map((answer) => answer.disposition)).toEqual(["PARTIAL", "ACCEPTED"]);
    expect(agent.calls.find((call) => call.subject.endsWith(":Q-01"))?.prompt).toContain("without inventing precision");
  });

  it("does not hide questions when the presentation budget is reached", async () => {
    const { outcome, asked } = await run([
      discover(analysis([question(), question("Q-02", { topic: "período", decision: "Qual período o relatório cobre?" })])),
      write(draft({ confirmedDecisions: [{ id: "Q-01", statement: "Use a technical audience." }], openQuestions: [
        { id: "Q-02", statement: "What period should the report cover?" },
        { id: "DISCOVERY-LIMIT", statement: "The interview safety budget was reached; remaining coverage must be checked." },
      ] })),
    ], ["1"], { maxQuestions: 1 });
    expect(asked).toHaveLength(1);
    expect(outcome).toMatchObject({ coverage: "open", limitReached: true });
    expect(outcome.questions).toHaveLength(2);
    expect(outcome.openQuestions.map((question) => question.questionId)).toEqual(["Q-02", "DISCOVERY-LIMIT"]);
  });

  it("reports the discovery limit even if its last question was accepted", async () => {
    const { outcome } = await run([
      discover(analysis([question()])), write(draft({ confirmedDecisions: [{ id: "Q-01", statement: "Use a technical audience." }],
        openQuestions: [{ id: "DISCOVERY-LIMIT", statement: "A final coverage check is still required." }] })),
    ], ["1"], { maxRounds: 1 });
    expect(outcome.limitReached).toBe(true);
    expect(outcome.coverage).toBe("open");
    expect(outcome.openQuestions[0]?.statement).toContain("1 rodadas");
  });

  it("corrects collisions with settled question IDs so a new material gap is not discarded", async () => {
    const second = question("Q-01", { topic: "período", decision: "Qual período o relatório cobre?" });
    const { outcome, asked, agent } = await run([
      discover(analysis([question()])), discover(analysis([second])),
      discover(analysis([{ ...second, id: "Q-02" }])), discover(analysis()),
      write(draft({ confirmedDecisions: [
        { id: "Q-01", statement: "Use a technical audience." }, { id: "Q-02", statement: "Use the selected period." },
      ] })),
    ], ["1", "1"]);
    expect(asked.map((item) => item.id)).toEqual(["Q-01", "Q-02"]);
    expect(outcome.answers).toHaveLength(2);
    expect(agent.calls.some((call) => call.prompt.includes("atribua um novo id ao novo tema"))).toBe(true);
  });

  it("supports Portuguese output while the default remains English", async () => {
    const { outcome, agent } = await run([discover(analysis()), write(draft({ language: "pt", objective: "Preparar relatório." }))], [], { language: "pt-BR" });
    expect(outcome.prompt).toContain("## Critérios de aceite");
    expect(outcome.prompt).toContain("## Orientação Ponytail");
    expect(outcome.language).toBe("pt");
    expect(agent.calls.find((call) => call.stage === "authoring")?.prompt).toContain("Brazilian Portuguese");
    expect(promptLanguage()).toBe("en");
    expect(promptLanguage("português do Brasil")).toBe("pt");
  });

  it("passes selected MCP documents and keeps request provenance independent of input mode", async () => {
    const library = [{ uri: "capivara://relatorio/docs/regra/privacidade", name: "privacidade", text: "Nunca exibir dados identificáveis." }];
    const { agent, outcome } = await run([discover(analysis()), write()], [], {
      request: { ...request, origin: "mcp", path: "capivara://relatorio/pedido" }, library,
    });
    expect(agent.calls.every((call) => call.prompt.includes("Nunca exibir dados identificáveis."))).toBe(true);
    expect(outcome.prompt).toContain(request.text);
    expect(outcome.prompt).toContain("Nunca exibir dados identificáveis.");
    expect(outcome.prompt).toContain("capivara://relatorio/pedido");
  });

  it("retries malformed discovery once and refuses to call generation if it stays invalid", async () => {
    const agent = fakeAgent([discover("invalid JSON"), discover("invalid JSON")]);
    await expect(engineerPrompt({ projectRoot: "/unused", request, writer: agent.call, askQuestion: async () => "1" }))
      .rejects.toMatchObject({ name: "PromptEngineerError", code: "invalid-interview" });
    expect(agent.calls).toHaveLength(2);
  });

  it("rejects final drafts that turn deferred decisions into confirmations", async () => {
    const wrong = draft({ confirmedDecisions: [{ id: "Q-01", statement: "Use the recommended technical audience." }] });
    const agent = fakeAgent([discover(analysis([question()])), discover(analysis()), write(wrong), write(wrong)]);
    await expect(engineerPrompt({ projectRoot: "/unused", request, writer: agent.call, askQuestion: async () => "não sei" }))
      .rejects.toMatchObject({ code: "invalid-prompt" });
    expect(agent.calls.at(-1)?.prompt).toContain("adicionou ou removeu itens da entrevista");
  });

  it("repairs malformed generation once and checks the output language and complete sections", async () => {
    const { outcome, agent } = await run([
      discover(analysis()), write(draft({ language: "pt", acceptanceCriteria: [] })), write(),
    ]);
    expect(outcome.language).toBe("en");
    expect(agent.calls.filter((call) => call.stage === "authoring")).toHaveLength(2);
    expect(agent.calls.at(-1)?.prompt).toContain("Your previous draft was rejected");
    expect(agent.calls.at(-1)?.prompt).toContain("language en");
  });

  it("stops when the provider fails and preserves callback errors such as EOF", async () => {
    const agent = fakeAgent([{ match: { stage: "interview" }, respond: { stdout: "", exitCode: 7 } }]);
    await expect(engineerPrompt({ projectRoot: "/unused", request, writer: agent.call, askQuestion: async () => "1" }))
      .rejects.toMatchObject({ code: "provider-failed" });
    const eof = new PromptEngineerError("a entrada terminou durante a entrevista");
    const asks = fakeAgent([discover(analysis([question()]))]);
    await expect(engineerPrompt({ projectRoot: "/unused", request, writer: asks.call, askQuestion: async () => { throw eof; } }))
      .rejects.toBe(eof);
  });

  it("validates limits and language before consulting a provider", async () => {
    for (const extra of [{ maxRounds: 0 }, { maxQuestions: 1.5 }, { language: "fr" }]) {
      const agent = fakeAgent([]);
      await expect(engineerPrompt({ projectRoot: "/unused", request, writer: agent.call, askQuestion: async () => "1", ...extra }))
        .rejects.toMatchObject({ code: "invalid-options" });
      expect(agent.calls).toEqual([]);
    }
  });
});
