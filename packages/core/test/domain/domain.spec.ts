import { describe, expect, it } from "vitest";
import { allowedCapabilities, contextForTask, packetText, runInit, runPlan } from "../../src/domain/index.js";
import type { DomainAgentRequest, ProductBrief, Requirement } from "../../src/domain/types.js";

const discovered = (questions: unknown[] = []) => JSON.stringify({ name: "Tarefas", summary: "Gerenciar tarefas locais", requirements: [], questions });
const gap = (fact: string, question: string) => ({ fact, question, reason: "O pedido não define esse comportamento.", impact: "Altera o efeito persistido ao remover um registro.", category: "data", modes: ["cli"], options: ["Preservar histórico", "Excluir definitivamente"], blocks: [] });

describe("o pedido governa entrevista e instrumentos", () => {
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
