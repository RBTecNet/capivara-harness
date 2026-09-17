import { describe, expect, it } from "vitest";
import { checkPrerequisites, describeMissing, detectPrerequisites } from "../../src/loop/index.js";
import { ROLES, buildInvocation } from "../../src/provider/index.js";

const DESCRICAO = [
  "# Pousada — Project Description",
  "",
  "## Overview",
  "",
  "Reservas.",
  "",
  "## Tech Stack",
  "",
  "| Camada | Tecnologia |",
  "| --- | --- |",
  "| Frontend | React 18 |",
  "| Backend | Node.js 20 com TypeScript 5 |",
  "| Banco | PostgreSQL 16 |",
  "",
  "## Core Workflows",
  "",
  "### 1. Criar reserva",
].join("\n");

describe("detecção de pré-requisitos", () => {
  it("lê a seção Tech Stack e deduz os executáveis", () => {
    const encontrados = detectPrerequisites(DESCRICAO).map((prerequisite) => prerequisite.binary).sort();
    expect(encontrados).toEqual(["node", "psql"]);
  });

  it("distingue serviço de sistema de runtime do projeto", () => {
    const prerequisites = detectPrerequisites(DESCRICAO);
    expect(prerequisites.find((entry) => entry.binary === "psql")?.systemLevel).toBe(true);
    expect(prerequisites.find((entry) => entry.binary === "node")?.systemLevel).toBe(false);
  });

  it("não inventa pré-requisito para stack que não reconhece", () => {
    expect(detectPrerequisites("## Tech Stack\n\n| Camada | Tecnologia |\n| --- | --- |\n| Tudo | Elixir |")).toEqual([]);
  });

  it("verifica de verdade contra o PATH", async () => {
    const statuses = await checkPrerequisites([
      { technology: "Node.js", binary: "node", systemLevel: false },
      { technology: "Inexistente", binary: "binario-que-nao-existe-mesmo", systemLevel: true },
    ]);
    expect(statuses[0]?.present).toBe(true);
    expect(statuses[1]?.present).toBe(false);
  });
});

describe("mensagem do que falta", () => {
  const faltando = [{ technology: "PostgreSQL", binary: "psql", systemLevel: true, present: false, path: null }];

  it("com instalação de sistema ligada, é aviso e diz quem vai instalar", () => {
    expect(describeMissing(faltando, true)).toContain("o executor tem permissão de sistema e vai instalar");
  });

  it("com ela desligada, diz o que fazer", () => {
    const mensagem = describeMissing(faltando, false);
    expect(mensagem).toContain("Instale");
    expect(mensagem).toContain("--allow-system-install");
  });

  it("nada faltando, nada a dizer", () => {
    expect(describeMissing([{ ...faltando[0]!, present: true, path: "/usr/bin/psql" }], false)).toBe("");
  });
});

describe("acesso de sistema é só do executor", () => {
  const config = { provider: "codex", model: "gpt-5", effort: "", credential: "", command: "" };
  const context = { projectRoot: "/tmp/p", runId: "r", stage: "implement", language: "pt-BR", environment: {} as NodeJS.ProcessEnv };

  it("somente o executor declara systemInstall no catálogo", () => {
    expect(Object.values(ROLES).filter((role) => role.systemInstall).map((role) => role.name)).toEqual(["builder"]);
  });

  it("ligado, o executor recebe sandbox de acesso total", () => {
    const invocation = buildInvocation("builder", config, { ...context, systemInstall: true });
    expect(invocation.args.join(" ")).toContain("--sandbox danger-full-access");
    expect(invocation.env.CAPIVARA_SYSTEM_INSTALL).toBe("1");
  });

  it("desligado, o executor fica no workspace", () => {
    const invocation = buildInvocation("builder", config, { ...context, systemInstall: false });
    expect(invocation.args.join(" ")).toContain("--sandbox workspace-write");
    expect(invocation.env.CAPIVARA_SYSTEM_INSTALL).toBeUndefined();
  });

  it("nenhum papel read-only ganha acesso de sistema, nem se pedirem", () => {
    for (const role of ["writer", "auditor", "verifier"] as const) {
      const invocation = buildInvocation(role, config, { ...context, systemInstall: true });
      expect(invocation.args.join(" "), role).toContain("--sandbox read-only");
      expect(invocation.env.CAPIVARA_SYSTEM_INSTALL, role).toBeUndefined();
    }
  });
});
