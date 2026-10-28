import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedCapabilities, contextForTask, packetText, runInit, runPlan } from "../../src/domain/index.js";
import type { DomainAgentRequest, ProductBrief, Requirement, SelectedDocument, Verification } from "../../src/domain/types.js";
import { checkInputHash } from "../../src/execution/checks.js";

const discovered = (questions: unknown[] = []) => JSON.stringify({ name: "Tarefas", summary: "Gerenciar tarefas locais", requirements: [], questions });
const gap = (fact: string, question: string) => ({ fact, question, reason: "O pedido não define esse comportamento.", impact: "Altera o efeito persistido ao remover um registro.", category: "data", modes: ["cli"], options: ["Preservar histórico", "Excluir definitivamente"], blocks: [] });

describe("o pedido governa entrevista e instrumentos", () => {
  it("a TUI pedida pelo usuário prevalece sobre Bootstrap e Playwright de um documento selecionado", async () => {
    const request = "Crie uma TUI no terminal para consultar clientes. Sem interface web e sem servidor HTTP.";
    const quote = "Use Bootstrap para a interface e Playwright para testar no navegador.";
    let questions = 0;
    const brief = await runInit({ request, documents: [{ reference: "capivara://clientes/docs/exemplo-web", text: quote, localPath: ".project-inputs/exemplo-web.md" }],
      agent: async call => call.prompt.includes("Selected document fragment") ? JSON.stringify({ requirements: [{ statement: "Usar Bootstrap e Playwright", quote, mode: "web" }], questions: [{ ...gap("aparência da interface", "Qual tema do Bootstrap usar?"), category: "appearance", modes: ["web"] }] }) : discovered(),
      ask: async () => { questions += 1; return "Tema padrão"; },
    });
    expect(brief.modes).toEqual(["tui"]);
    expect(brief.requirements).toHaveLength(1);
    expect(brief.requirements[0]?.source).toMatchObject({ kind: "request", text: request });
    expect(questions).toBe(0);
    expect(brief.status).toBe("ready");
  });

  it("mantém código como referência e leva somente requisitos documentais literais e pertinentes ao planejamento", async () => {
    const request = "Crie uma CLI para importar clientes CSV e consultar clientes; sem servidor HTTP.";
    const quote = "A importação de clientes CSV deve recusar CPF duplicado.";
    const reference = "capivara://clientes/docs/regras-importacao";
    const codePath = ".project-inputs/importar-clientes.ts";
    const skillPath = ".project-inputs/padroes/SKILL.md";
    const documentText = `${quote}\nSem navegador.\nimport { exemplo } from './modulo.js';\nconst exemploNaoObrigatorio = 1;`;
    const attachmentText = "ANEXO_REFERENCIA_NAO_REQUISITO\nexport const parseCsv = (clientes) => clientes;";
    const calls: DomainAgentRequest[] = [];
    const agent = async (call: DomainAgentRequest): Promise<string> => {
      calls.push(call);
      if (call.operation === "discover") return call.prompt.includes("Selected document fragment") ? JSON.stringify({ requirements: [{ statement: "Recusar CPF duplicado ao importar clientes CSV", quote, mode: "cli" }, { statement: "Permitir CPF duplicado", quote: "Esta frase não existe na fonte" }], questions: [] }) : discovered();
      if (call.operation === "environment") return JSON.stringify({ environment: [] });
      const requirements = JSON.parse(call.prompt.split("Requirements of this slice:\n")[1]?.split("\n\n")[0] ?? "[]") as Requirement[];
      return JSON.stringify({ tasks: requirements.map(requirement => ({ id: `task-${requirement.id}`, title: requirement.statement, goal: requirement.statement, requirementIds: [requirement.id], dependsOn: [], criteria: [requirement.statement] })) });
    };
    const binaryReference = "capivara://clientes/files/clientes-avatar";
    const documents: SelectedDocument[] = [
      { reference, title: "Regras de importação de clientes", text: documentText, localPath: ".project-inputs/regras.md" },
      { reference: "capivara://clientes/files/importar-clientes", title: "importar-clientes.ts", text: attachmentText, localPath: codePath, kind: "reference" },
      { reference: "capivara://padroes/skill", title: "SKILL.md", text: "PADRAO_GLOBAL_NAO_REQUISITO: estilo do código existente", localPath: skillPath, kind: "reference", scope: "global" },
      { reference: "capivara://estatistica/graficos", title: "grafico.py", text: "numpy histograma estatística", localPath: ".project-inputs/grafico.py", kind: "reference" },
      { reference: "capivara://browser/traces", title: "Playwright CSV clients", text: "trace browser", localPath: ".project-inputs/playwright.ts", kind: "reference" },
      { reference: binaryReference, title: "clientes-avatar.png", text: "", localPath: ".project-inputs/clientes-avatar.png", kind: "reference", contentHash: "a".repeat(64) },
    ];
    const brief = await runInit({ request, contextChars: 12_000, agent, repositoryConstraints: [], documents });
    const plan = await runPlan({ brief, contextChars: 12_000, agent, repositoryConstraints: [] });
    const documentary = brief.requirements.filter(requirement => requirement.source.kind === "repository");
    expect(documentary).toHaveLength(1);
    expect(documentary[0]?.source).toMatchObject({ reference, text: quote, localPath: ".project-inputs/regras.md" });
    expect(brief.requirements.some(requirement => requirement.source.kind === "request" && requirement.source.text === request)).toBe(true);
    expect(brief.requirements.every(requirement => !/exemploNaoObrigatorio|import \{|ANEXO_REFERENCIA|PADRAO_GLOBAL|Esta frase/.test(requirement.source.text))).toBe(true);
    expect(brief.constraints.some(constraint => constraint.source.reference === reference && constraint.source.localPath === ".project-inputs/regras.md" && constraint.forbiddenCapabilities.includes("browser"))).toBe(true);
    expect(calls.some(call => call.operation === "environment" && call.prompt.includes(skillPath))).toBe(true);
    expect(calls.filter(call => call.operation === "discover").every(call => !call.prompt.includes(attachmentText) && !call.prompt.includes("PADRAO_GLOBAL_NAO_REQUISITO"))).toBe(true);
    const task = plan.tasks.find(task => task.requirementIds.includes(documentary[0]!.id))!;
    const packet = packetText(contextForTask(brief, plan, task, 8_000));
    expect(packet).toContain(codePath); expect(packet).toContain(skillPath);
    expect(packet).not.toContain(".project-inputs/grafico.py"); expect(packet).not.toContain(".project-inputs/playwright.ts");
    expect(packet).not.toContain(attachmentText); expect(packet.length).toBeLessThanOrEqual(8_000);
    const changed = await runInit({ request, contextChars: 12_000, agent, existing: brief, repositoryConstraints: [], documents: documents.map(document => document.reference === binaryReference ? { ...document, contentHash: "b".repeat(64) } : document) });
    expect(changed.materialRevision).not.toBe(brief.materialRevision);
    expect(changed.references?.find(reference => reference.reference === binaryReference)?.contentHash).toBe("b".repeat(64));
    const unrelated = structuredClone(brief);
    unrelated.references!.find(reference => reference.title === "grafico.py")!.contentHash = "c".repeat(64);
    const workspace = await mkdtemp(join(tmpdir(), "capivara-input-hash-"));
    const check: Verification = { id: "reference-proof", kind: "cli", command: "node", requirementIds: task.requirementIds, requiredCapabilities: [] };
    try {
      const before = await checkInputHash(workspace, plan, task, check, brief);
      expect(await checkInputHash(workspace, plan, task, check, changed)).not.toBe(before);
      expect(await checkInputHash(workspace, plan, task, check, unrelated)).toBe(before);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });

  it("consome só documentos selecionados em fatias, preserva a proveniência e reutiliza o mesmo material", async () => {
    const request = "Crie uma CLI no terminal para registrar clientes.";
    const reference = "capivara://clientes/docs/decisao/regras";
    const localPath = ".project-inputs/selected/regras.md";
    const text = `Persistência JSON. Sem servidor HTTP e sem navegador.\n${Array.from({ length: 90 }, (_, index) => `Regra ${index}: registrar e consultar o dado local de cada cliente com uma operação própria e um resultado observável.`).join("\n")}`;
    const documents = [
      { reference, title: "Regras selecionadas", text, localPath },
      { reference: "capivara://clientes/historico/antigo", text: "HISTORICO_NAO_APROVADO exige um servidor HTTP." },
      { reference: "capivara://geral/docs/decisao/outra", text: "ACERVO_NAO_SELECIONADO exige navegador." },
      { reference: "capivara://clientes/rascunho/novo", text: "RASCUNHO_NAO_APROVADO exige persistência SQLite." },
    ];
    const calls: DomainAgentRequest[] = [];
    let questions = 0;
    const agent = async (call: DomainAgentRequest): Promise<string> => {
      calls.push(call);
      if (call.operation === "discover") return JSON.stringify({ name: "Clientes", summary: "Registrar clientes na CLI", requirements: call.prompt.includes("Selected document fragment") && call.prompt.includes("Persistência JSON.") ? [{ statement: "Persistir os dados de clientes em JSON", quote: "Persistência JSON.", mode: "cli" }, { statement: "Registrar e consultar o dado local de cada cliente", quote: "Regra 0: registrar e consultar o dado local de cada cliente com uma operação própria e um resultado observável.", mode: "cli" }] : [], questions: [gap("persistência dos dados", "Os dados ficam em JSON ou em SQLite?"), gap("remoção de cliente", "Remover cliente preserva o histórico?")] });
      if (call.operation === "environment") return JSON.stringify({ environment: [] });
      const section = call.prompt.split("Requirements of this slice:\n")[1]?.split("\n\n")[0] ?? "[]";
      const requirements = JSON.parse(section) as Requirement[];
      return JSON.stringify({ tasks: requirements.map((requirement) => ({ id: `task-${requirement.id}`, title: requirement.statement.slice(0, 40), goal: requirement.statement, instructions: `Implementar ${requirement.id}`, requirementIds: [requirement.id], dependsOn: [], criteria: [requirement.statement] })) });
    };
    const ask = async () => { questions += 1; return "Preservar registros removidos"; };
    const brief = await runInit({ request, documents, agent, ask, contextChars: 6_000, repositoryConstraints: [] });
    const plan = await runPlan({ brief, agent, contextChars: 6_000, repositoryConstraints: [] });
    expect(brief.request).toBe(request);
    expect(brief.materialRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(questions).toBe(1);
    const documentary = brief.requirements.filter((requirement) => requirement.source.kind === "repository");
    expect(documentary).toHaveLength(2);
    expect(documentary.every((requirement) => requirement.source.reference === reference && requirement.source.localPath === localPath && text.includes(requirement.source.text))).toBe(true);
    expect(brief.constraints.some((constraint) => constraint.source.reference === reference && constraint.forbiddenCapabilities.includes("http-server"))).toBe(true);
    expect(allowedCapabilities(brief, ["http-server"])).toBe(false);
    expect(plan.tasks.flatMap((task) => task.requirementIds)).toEqual(expect.arrayContaining(documentary.map((requirement) => requirement.id)));
    const documentTask = plan.tasks.find((task) => task.requirementIds.includes(documentary[0]!.id))!;
    const requestTask = plan.tasks.find((task) => task.requirementIds.includes(brief.requirements.find((requirement) => requirement.source.kind === "request")!.id))!;
    expect(packetText(contextForTask(brief, plan, documentTask, 3_000))).toContain(localPath);
    expect(packetText(contextForTask(brief, plan, requestTask, 3_000))).not.toContain(text);
    expect(Math.max(...calls.map((call) => call.prompt.length))).toBeLessThanOrEqual(6_000);
    expect(calls.every((call) => !call.prompt.includes(text) && !/HISTORICO_NAO_APROVADO|ACERVO_NAO_SELECIONADO|RASCUNHO_NAO_APROVADO/.test(call.prompt))).toBe(true);
    const before = calls.length;
    const reused = await runInit({ request, documents: documents.map((document) => ({ ...document, title: "Título cosmético" })).reverse(), existing: brief, agent, ask, contextChars: 6_000 });
    expect(calls).toHaveLength(before);
    expect(reused.materialRevision).toBe(brief.materialRevision);
    const changed = await runInit({ request, documents: [{ reference, text: `${text}\nPermitir exportação CSV.` }], existing: reused, agent, ask, contextChars: 6_000 });
    expect(changed.materialRevision).not.toBe(brief.materialRevision);
    expect(changed.revision).toBeGreaterThan(brief.revision);
    expect(changed.decisions).toEqual(brief.decisions);
    expect(changed.requirements.some((requirement) => requirement.source.kind === "answer" && requirement.source.text === "Preservar registros removidos")).toBe(true);
    expect(questions).toBe(1);
  });

  it("não pergunta sobre Bootstrap ou persistência já definida e não permite navegador/HTTP em TUI", async () => {
    let questions = 0;
    const brief = await runInit({ request: "Crie uma TUI no terminal com persistência JSON. Sem interface web e sem servidor HTTP.",
      agent: async () => discovered([
        { ...gap("aparência", "Você prefere Bootstrap ou Tailwind?"), category: "appearance", modes: ["web"] },
        gap("persistência dos dados", "Os dados ficam em JSON ou em SQLite?"),
      ]), ask: async () => { questions += 1; return "1"; },
    });
    expect(questions).toBe(0);
    expect(brief.modes).toEqual(["tui"]);
    expect(brief.status).toBe("ready");
    expect(allowedCapabilities(brief, ["browser"])).toBe(false);
    expect(allowedCapabilities(brief, ["http-server"])).toBe(false);
    const web = await runInit({ request: "Crie uma aplicação web Node.js com servidor HTTP.", agent: async () => discovered() });
    expect(web.modes).toEqual(["web"]);
    expect(allowedCapabilities(web, ["http-server", "browser"])).toBe(true);
  });

  it("persiste resposta material antes da próxima pergunta e não a transforma em timeout autorizado", async () => {
    const snapshots: ProductBrief[] = [];
    let asked = 0;
    const brief = await runInit({ request: "Crie uma CLI para cadastrar e remover clientes.",
      agent: async () => discovered([gap("remoção de cliente", "Remover cliente preserva o histórico?"), gap("remoção com pendências", "Pode remover cliente com pendências?")]),
      save: async (state) => { if (state.brief) snapshots.push(structuredClone(state.brief)); },
      ask: async () => {
        asked += 1;
        if (asked === 1) return "Preservar todo o histórico";
        expect(snapshots.at(-1)?.decisions[0]?.answer).toBe("Preservar todo o histórico");
        return null;
      },
    });
    expect(brief.decisions).toHaveLength(1);
    expect(brief.gaps.map((question) => question.status)).toEqual(["resolved", "pending"]);
    expect(brief.status).toBe("waiting");
  });
});

describe("planejamento executável", () => {
  it("publica ambiente primeiro, recupera ciclo na origem e não trata plano parcial salvo como pronto", async () => {
    const brief = await runInit({ request: "Crie uma CLI Node.js que lista tarefas.", agent: async () => discovered() });
    const operations: string[] = [];
    const snapshots: string[] = [];
    const env = (id: string, dependsOn: string[]) => ({ id, name: id, kind: "tool", dependsOn, check: { command: "node", args: ["--version"] }, prepare: [] });
    const plan = await runPlan({ brief, existing: { schema: "capivara/plan/1", status: "planning", revision: 1, briefId: brief.id, briefRevision: brief.revision, environment: [], tasks: [], contracts: [] },
      save: async (state) => { if (state.plan) snapshots.push(`${state.plan.status}:${state.plan.environment.length}:${state.plan.tasks.length}`); },
      agent: async (request) => {
        operations.push(request.operation);
        if (request.operation === "environment") return JSON.stringify({ environment: [env("node", ["npm"]), env("npm", ["node"])] });
        if (request.operation === "repair") return JSON.stringify({ updates: [{ id: "node", dependsOn: [] }, { id: "npm", dependsOn: ["node"] }] });
        return JSON.stringify({ tasks: [{ id: "list", title: "Listar", goal: "Listar tarefas", requirementIds: brief.requirements.map((requirement) => requirement.id), dependsOn: [], environmentIds: ["node"], criteria: ["A CLI lista tarefas"] }] });
      },
    });
    expect(operations).toEqual(["environment", "repair", "outline"]);
    expect(snapshots.some((snapshot) => snapshot === "planning:2:0")).toBe(true);
    expect(snapshots.slice(0, -1).every((snapshot) => snapshot.startsWith("planning:"))).toBe(true);
    expect(plan.environment.map((node) => node.id)).toEqual(["node", "npm"]);
    expect(plan.environment[1]?.dependsOn).toEqual(["node"]);
    expect(plan.status).toBe("ready");
  });

  it("constrói pacotes pequenos a partir de pedido grande sem reenviar o contexto global por tarefa", async () => {
    const request = `Crie uma TUI no terminal. ${Array.from({ length: 70 }, (_, index) => `Funcionalidade ${index}: permite registrar e consultar dados locais com uma operação própria e resultado observável`).join("; ")}; sem servidor HTTP e sem navegador.`;
    const sizes: number[] = [];
    const agent = async (call: DomainAgentRequest): Promise<string> => {
      sizes.push(call.prompt.length);
      if (call.operation === "discover") return discovered();
      if (call.operation === "environment") return JSON.stringify({ environment: [] });
      const section = call.prompt.split("Requirements of this slice:\n")[1]?.split("\n\n")[0] ?? "[]";
      const requirements = JSON.parse(section) as Requirement[];
      return JSON.stringify({ tasks: requirements.map((requirement) => ({ id: `task-${requirement.id}`, title: requirement.statement.slice(0, 40), goal: requirement.statement, instructions: `Implementar ${requirement.id}`, requirementIds: [requirement.id], dependsOn: [], criteria: [requirement.statement] })) });
    };
    const brief = await runInit({ request, agent, contextChars: 6_000 });
    const plan = await runPlan({ brief, agent, contextChars: 6_000 });
    expect(plan.tasks.length).toBeGreaterThan(3);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(6_000);
    const packets = plan.tasks.map((task) => packetText(contextForTask(brief, plan, task, 3_000)));
    expect(packets.every((packet) => packet.length <= 3_000 && !packet.includes(request))).toBe(true);
    expect(plan.tasks.flatMap((task) => task.requirementIds)).toEqual(expect.arrayContaining(brief.requirements.map((requirement) => requirement.id)));
  });
});
