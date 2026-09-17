import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveAcceptance, runAcceptance } from "../../src/loop/index.js";
import { acceptancePrompt } from "../../src/prompts/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-aceite-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

async function manifest(scripts: Record<string, string>): Promise<void> {
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "app", scripts }), "utf8");
}

describe("derivação dos passos", () => {
  it("deriva do que o projeto declara, sem adivinhar", () => {
    const steps = deriveAcceptance(JSON.stringify({ scripts: { build: "vite build", migrate: "node migrate.js", start: "node server.js" } }));
    expect(steps.map((step) => step.id)).toEqual(["install", "build", "migrate", "start"]);
    expect(steps.find((step) => step.id === "start")?.service).toBe(true);
  });

  it("projeto que não declara nada não tem o que aceitar", () => {
    expect(deriveAcceptance(JSON.stringify({ scripts: { test: "vitest" } }))).toEqual([]);
    expect(deriveAcceptance(null)).toEqual([]);
    expect(deriveAcceptance("não é json")).toEqual([]);
  });
});

describe("aceitação operacional", () => {
  it("aprova quando cada passo sai com zero e o serviço fica de pé", async () => {
    await manifest({ build: "x", start: "y" });
    const executados: string[] = [];
    const result = await runAcceptance({
      projectRoot,
      cleanRoom: false,
      runner: async (command) => {
        executados.push(command);
        return { exitCode: 0, output: "ok" };
      },
      service: async (command) => {
        executados.push(command);
        return { exitCode: 0, output: "escutando na porta 3000" };
      },
    });
    expect(result.accepted).toBe(true);
    expect(executados).toEqual(["npm install --no-audit --no-fund", "npm run build", "npm start"]);
  });

  it("reprova com a saída real do passo que falhou", async () => {
    await manifest({ migrate: "x", start: "y" });
    const result = await runAcceptance({
      projectRoot,
      cleanRoom: false,
      runner: async (command) =>
        command.includes("migrate")
          ? { exitCode: 1, output: "error: connect ECONNREFUSED 127.0.0.1:5432" }
          : { exitCode: 0, output: "" },
      service: async () => ({ exitCode: 0, output: "" }),
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.failure.id).toBe("migrate");
    expect(result.failure.cause).toContain("ECONNREFUSED");
    expect(result.failure.cause).toContain("cópia limpa");
  });

  it("serviço que morre sozinho reprova — é a aplicação que não sobe", async () => {
    await manifest({ start: "y" });
    const result = await runAcceptance({
      projectRoot,
      cleanRoom: false,
      runner: async () => ({ exitCode: 0, output: "" }),
      service: async () => ({ exitCode: 1, output: "Error: getaddrinfo ENOTFOUND db" }),
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.failure.id).toBe("start");
    expect(result.failure.cause).toContain("ENOTFOUND");
  });

  it("para no primeiro passo vermelho, sem gastar os seguintes", async () => {
    await manifest({ build: "x", migrate: "y", start: "z" });
    const executados: string[] = [];
    await runAcceptance({
      projectRoot,
      cleanRoom: false,
      runner: async (command) => {
        executados.push(command);
        return { exitCode: command.includes("build") ? 2 : 0, output: "falhou" };
      },
      service: async (command) => {
        executados.push(command);
        return { exitCode: 0, output: "" };
      },
    });
    expect(executados).toEqual(["npm install --no-audit --no-fund", "npm run build"]);
  });

  it("projeto sem entrypoint é aprovado dizendo que não há o que aceitar", async () => {
    await manifest({ test: "vitest" });
    const result = await runAcceptance({ projectRoot, cleanRoom: false });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.skipped).toContain("nada a aceitar");
  });

  it("a cópia limpa não leva node_modules nem .git", async () => {
    await manifest({ start: "y" });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, "node_modules", "lixo"), { recursive: true });
    await writeFile(join(projectRoot, "node_modules", "lixo", "a.js"), "x", "utf8");

    const vistos: string[] = [];
    await runAcceptance({
      projectRoot,
      runner: async (_command, cwd) => {
        const { readdir } = await import("node:fs/promises");
        vistos.push(...(await readdir(cwd)));
        return { exitCode: 0, output: "" };
      },
      service: async () => ({ exitCode: 0, output: "" }),
    });

    expect(vistos).toContain("package.json");
    expect(vistos).not.toContain("node_modules");
  });
});

describe("prompt de correção da aceitação", () => {
  const context = {
    language: "português do Brasil",
    testCommand: "npm test",
    containerized: false,
    phaseMarkdown: "",
    cause: "npm run migrate falhou: ECONNREFUSED 127.0.0.1:5432",
    attempt: 1,
  };

  it("carrega a causa real e explica a diferença entre suíte e produto", () => {
    const prompt = acceptancePrompt(context);
    expect(prompt).toContain("ECONNREFUSED");
    expect(prompt).toContain("A green suite proves the rules");
  });

  it("proíbe enfraquecer a aceitação ou apagar teste", () => {
    const prompt = acceptancePrompt(context);
    expect(prompt).toContain("Do not weaken the acceptance");
    expect(prompt).toContain("Never delete, skip or disable a test");
  });

  it("lembra que pré-requisito de sistema é instalável", () => {
    expect(acceptancePrompt(context)).toContain("you have system access");
  });
});
