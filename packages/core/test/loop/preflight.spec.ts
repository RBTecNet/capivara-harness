import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materializeSessions, phaseId, preflight, resolveTestCommand, splitPhases } from "../../src/loop/index.js";
import { VALID_PHASES } from "../contract/fixture.js";

let projectRoot = "";
const RUN = "build-abc123abc123";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-loop-"));
  await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const git = { repository: true, clean: true };

async function plan(content = VALID_PHASES): Promise<void> {
  await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), content, "utf8");
}

describe("divisor de fases", () => {
  it("uma fase = um arquivo = uma sessão", () => {
    const split = splitPhases(VALID_PHASES, projectRoot, RUN);
    if (!split.ok) throw new Error("plano deveria ser válido");
    expect(split.sessions.map((session) => session.id)).toEqual(["P01", "P02"]);
    expect(split.sessions[0]?.taskCount).toBe(2);
  });

  it("o recorte vem do parser, não de uma segunda leitura do texto", () => {
    const split = splitPhases(VALID_PHASES, projectRoot, RUN);
    if (!split.ok) throw new Error("plano deveria ser válido");
    expect(split.sessions[0]?.markdown.startsWith("## Phase 1:")).toBe(true);
    expect(split.sessions[0]?.markdown).not.toContain("## Phase 2");
    expect(split.sessions[1]?.markdown).not.toContain("Open Questions");
  });

  it("plano inválido não vira sessão nenhuma", () => {
    const split = splitPhases("lixo", projectRoot, RUN);
    expect(split.ok).toBe(false);
  });

  it("materializa uma sessão por arquivo", async () => {
    const split = splitPhases(VALID_PHASES, projectRoot, RUN);
    if (!split.ok) throw new Error("plano deveria ser válido");
    await materializeSessions(split.sessions);
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(split.sessions[0]!.file, "utf8")).toContain("## Phase 1:");
  });

  it("o id da fase é P + dois dígitos", () => {
    expect(phaseId(1)).toBe("P01");
    expect(phaseId(12)).toBe("P12");
  });
});

describe("comando de teste", () => {
  it("--test-cmd tem a maior precedência", async () => {
    await writeFile(join(projectRoot, "package.json"), '{"scripts":{"test":"vitest"}}', "utf8");
    const resolved = await resolveTestCommand(projectRoot, { explicit: "npm run test:ci" });
    expect(resolved?.command).toBe("npm run test:ci");
  });

  it("a variável de ambiente vem depois da flag", async () => {
    const resolved = await resolveTestCommand(projectRoot, { environment: { CAPIVARA_TEST_CMD: "make test" } });
    expect(resolved?.source).toBe("CAPIVARA_TEST_CMD");
  });

  it("Sail tem precedência sobre composer: a suíte roda no container", async () => {
    await writeFile(join(projectRoot, "artisan"), "", "utf8");
    await mkdir(join(projectRoot, "vendor", "bin"), { recursive: true });
    await writeFile(join(projectRoot, "vendor/bin/sail"), "", "utf8");
    await writeFile(join(projectRoot, "composer.json"), '{"scripts":{"test":"phpunit"}}', "utf8");
    const resolved = await resolveTestCommand(projectRoot, { environment: {} });
    expect(resolved).toMatchObject({ command: "vendor/bin/sail test", containerized: true });
  });

  it("detecta as stacks comuns", async () => {
    const casos: [string, string, string][] = [
      ["package.json", '{"scripts":{"test":"vitest"}}', "npm test"],
      ["go.mod", "module x", "go test ./..."],
      ["Cargo.toml", "[package]", "cargo test"],
      ["pytest.ini", "[pytest]", "python3 -m pytest"],
    ];
    for (const [file, content, expected] of casos) {
      const root = await mkdtemp(join(tmpdir(), "capivara-stack-"));
      await writeFile(join(root, file), content, "utf8");
      expect((await resolveTestCommand(root, { environment: {} }))?.command, file).toBe(expected);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projeto sem suíte devolve null em vez de inventar comando", async () => {
    expect(await resolveTestCommand(projectRoot, { environment: {} })).toBeNull();
  });
});

describe("preflight", () => {
  it("plano ausente aborta dizendo o que fazer", async () => {
    const result = await preflight({ projectRoot, runId: RUN, git });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("capivara init");
  });

  it("plano inválido aborta antes de qualquer chamada de modelo", async () => {
    await plan("isso não é um plano");
    const result = await preflight({ projectRoot, runId: RUN, git });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("nenhuma chamada de modelo");
      expect(result.contractErrors.length).toBeGreaterThan(0);
    }
  });

  it("árvore suja aborta explicando por quê E como sair", async () => {
    await plan();
    const result = await preflight({ projectRoot, runId: RUN, git: { repository: true, clean: false } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const erro = result.errors[0] ?? "";
    expect(erro).toContain("não commitadas");
    // Sem as duas saídas concretas, o operador cai num beco: o loop para por
    // causa do trabalho parcial e recusa retomar por causa do mesmo trabalho.
    expect(erro).toContain("git commit");
    expect(erro).toContain("git clean -fd");
    expect(erro).toContain("revalida a fase");
  });

  it("sem git, o loop roda e avisa que não haverá commit", async () => {
    await plan();
    const result = await preflight({ projectRoot, runId: RUN, git: { repository: false, clean: true }, environment: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commitsEnabled).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain("sem-git");
  });

  it("sem comando de teste, avisa alto que o gate 2 será pulado", async () => {
    await plan();
    const result = await preflight({ projectRoot, runId: RUN, git, environment: {} });
    if (!result.ok) throw new Error("preflight deveria passar");
    expect(result.warnings.map((warning) => warning.code)).toContain("sem-suite");
    expect(result.testCommand).toBeNull();
  });

  it("plano stale é aviso, não bloqueio", async () => {
    await plan();
    await writeFile(join(projectRoot, ".capivara/init/project-description.md"), "mudou depois", "utf8");
    const result = await preflight({ projectRoot, runId: RUN, git, environment: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((warning) => warning.code === "stale")).toBe(true);
  });

  it("plano válido devolve as sessões prontas", async () => {
    await plan();
    const result = await preflight({ projectRoot, runId: RUN, git, environment: {} });
    if (!result.ok) throw new Error("preflight deveria passar");
    expect(result.sessions).toHaveLength(2);
  });
});

/**
 * Dependência ausente é aviso, nunca bloqueio.
 *
 * A primeira versão desta conferência reprovava o build e mandava rodar `npm
 * install`. Está errado: instalar o que o projeto declara é trabalho do
 * executor, e exigir que o desenvolvedor prepare o ambiente antes troca o
 * problema de lugar — o harness existe para dar munição a quem executa, não
 * para pedir preparação a quem chama.
 */
describe("o projeto sem as dependências instaladas", () => {
  it("avisa o que vem pela frente e deixa o build correr", async () => {
    await plan();
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "x", devDependencies: { tsx: "^4" } }), "utf8");

    const resultado = await preflight({ projectRoot, runId: RUN, git, environment: {} });

    if (!resultado.ok) throw new Error(`não devia bloquear: ${resultado.errors.join("; ")}`);
    const aviso = resultado.warnings.find((entrada) => entrada.code === "instala-dependencias");
    expect(aviso?.message).toContain("O executor instala na primeira sessão");
  });

  it("com as dependências instaladas, não há aviso nenhum", async () => {
    await plan();
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "x", dependencies: { next: "^15" } }), "utf8");
    await mkdir(join(projectRoot, "node_modules"), { recursive: true });

    const resultado = await preflight({ projectRoot, runId: RUN, git, environment: {} });
    if (!resultado.ok) throw new Error(resultado.errors.join("; "));
    expect(resultado.warnings.some((entrada) => entrada.code === "instala-dependencias")).toBe(false);
  });
});
