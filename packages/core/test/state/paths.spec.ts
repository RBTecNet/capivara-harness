import { describe, expect, it } from "vitest";
import { artifactPaths, isControlPlane, runPaths, safeProjectPath } from "../../src/state/index.js";

const ROOT = "/tmp/projeto";

describe("árvore de artefatos", () => {
  it("deriva os caminhos do projeto", () => {
    const paths = artifactPaths(ROOT);
    expect(paths.root).toBe("/tmp/projeto/.capivara");
    expect(paths.init).toBe("/tmp/projeto/.capivara/init");
    expect(paths.design).toBe("/tmp/projeto/.capivara/init/design");
  });

  it("dá a um run o seu próprio diretório", () => {
    const paths = runPaths(ROOT, "init-abc123abc123");
    expect(paths.state).toBe("/tmp/projeto/.capivara/runs/init-abc123abc123/run.json");
    expect(paths.lock).toBe("/tmp/projeto/.capivara/runs/init-abc123abc123/.lock");
  });
});

describe("safeProjectPath", () => {
  it("aceita caminho relativo dentro do projeto", () => {
    expect(safeProjectPath(ROOT, ".capivara/init/PROJECT.md")).toBe("/tmp/projeto/.capivara/init/PROJECT.md");
  });

  it("recusa escape por ..", () => {
    expect(() => safeProjectPath(ROOT, "../fora.md")).toThrow(/escapa do projeto/);
    expect(() => safeProjectPath(ROOT, ".capivara/../../fora.md")).toThrow(/escapa do projeto/);
  });

  it("recusa caminho absoluto", () => {
    expect(() => safeProjectPath(ROOT, "/etc/passwd")).toThrow(/relativo ao projeto/);
  });

  it("recusa byte nulo", () => {
    expect(() => safeProjectPath(ROOT, "a\0b")).toThrow(/inválido/);
  });

  it("recusa o próprio root", () => {
    expect(() => safeProjectPath(ROOT, ".")).toThrow(/escapa do projeto/);
  });
});

describe("isControlPlane", () => {
  it("reconhece o plano de controle", () => {
    expect(isControlPlane(ROOT, "/tmp/projeto/.capivara/runs/init-x/logs/a.log")).toBe(true);
  });

  it("não confunde os documentos com o plano de controle", () => {
    expect(isControlPlane(ROOT, "/tmp/projeto/.capivara/init/project-phases.md")).toBe(false);
  });

  it("não confunde um diretório de nome parecido", () => {
    expect(isControlPlane(ROOT, "/tmp/projeto/.capivara/runs-antigos/x")).toBe(false);
  });
});
