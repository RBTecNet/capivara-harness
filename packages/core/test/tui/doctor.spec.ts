import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnose, renderDiagnosis } from "../../src/commands/doctor.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-doctor-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const ausente = "/caminho/que/nao/existe.json";

describe("doctor", () => {
  it("reprova Node antigo com o requisito explícito", async () => {
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, nodeVersion: "v20.19.5", environment: {} });
    const runtime = diagnoses.find((diagnosis) => diagnosis.area === "runtime");
    expect(runtime?.health).toBe("ausente");
    expect(runtime?.detail).toContain("Node 22");
  });

  it("aceita o Node atual", async () => {
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, environment: {} });
    expect(diagnoses.find((diagnosis) => diagnosis.area === "runtime")?.health).toBe("ok");
  });

  it("verifica as três CLIs e diz o que fazer quando faltam", async () => {
    const diagnoses = await diagnose({
      projectRoot,
      credentialsFile: ausente,
      environment: { CAPIVARA_CODEX_BIN: "binario-que-nao-existe" },
    });
    const cli = diagnoses.filter((diagnosis) => diagnosis.area === "providers de CLI");
    expect(cli).toHaveLength(3);
    const codex = cli.find((diagnosis) => diagnosis.item.includes("Codex"));
    expect(codex?.health).toBe("ausente");
    expect(codex?.detail).toContain("CAPIVARA_CODEX_BIN");
  });

  it("sem credencial é aviso, não bloqueio", async () => {
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, environment: {} });
    const api = diagnoses.filter((diagnosis) => diagnosis.area === "providers de API");
    expect(api).toHaveLength(6);
    expect(api.every((diagnosis) => diagnosis.health === "aviso")).toBe(true);
  });

  it("sem git avisa que não haverá commit por fase", async () => {
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, environment: {} });
    expect(diagnoses.find((diagnosis) => diagnosis.item === "repositório Git")?.detail).toContain("pula os commits");
  });

  it("detecta o comando de teste do projeto", async () => {
    await writeFile(join(projectRoot, "package.json"), '{"scripts":{"test":"vitest"}}', "utf8");
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, environment: {} });
    expect(diagnoses.find((diagnosis) => diagnosis.item === "comando de teste")?.detail).toContain("npm test");
  });

  it("projeto sem documentação manda rodar o init", async () => {
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, environment: {} });
    const documentacao = diagnoses.find((diagnosis) => diagnosis.item === "documentação");
    expect(documentacao?.health).toBe("aviso");
    expect(documentacao?.detail).toContain("capivara init");
  });

  it("esqueleto sem plano é passo pendente: manda rodar o plan, não bloqueia", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/init/skeleton.md"), "# X", "utf8");
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, environment: {} });
    const documentacao = diagnoses.find((diagnosis) => diagnosis.item === "documentação");
    expect(documentacao?.health).toBe("aviso");
    expect(documentacao?.detail).toContain("capivara plan");
  });

  it("plano sem o esqueleto que ele diz ter lido é bloqueio", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), "# X", "utf8");
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, environment: {} });
    const documentacao = diagnoses.find((diagnosis) => diagnosis.item === "documentação");
    expect(documentacao?.health).toBe("ausente");
    expect(documentacao?.detail).toContain("capivara init");
  });

  it("o resumo diz o que bloqueia", async () => {
    const diagnoses = await diagnose({ projectRoot, credentialsFile: ausente, nodeVersion: "v20.0.0", environment: {} });
    expect(renderDiagnosis(diagnoses)).toContain("bloqueiam");
  });
});
