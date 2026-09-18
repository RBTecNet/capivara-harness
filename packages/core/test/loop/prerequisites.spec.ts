/**
 * A resolução de pré-requisitos, exercitada sem tocar na máquina.
 *
 * O laço e as três saídas são a parte que importa; `which` entra por parâmetro
 * nos testes de ponta a ponta do build.
 */

import { describe, expect, it } from "vitest";
import {
  detectPrerequisites,
  readPrerequisiteChoice,
  renderPrerequisiteChoice,
  resolvePrerequisites,
  unverifiedTechnologies,
} from "../../src/loop/index.js";
import type { PrerequisiteStatus } from "../../src/loop/index.js";

const ausente = (technology: string, binary: string): PrerequisiteStatus => ({
  technology,
  binary,
  systemLevel: true,
  present: false,
  path: null,
});

const DESCRICAO = [
  "# Projeto — Project Description",
  "",
  "## Tech Stack",
  "",
  "| Componente | Decisão |",
  "|---|---|",
  "| Linguagem | Node.js 26 |",
  "| Banco | PostgreSQL 16 |",
  "| Interface | React 19.1.0 |",
  "| Estilos | CSS Modules |",
  "",
  "## Core Workflows",
].join("\n");

describe("o que o catálogo não reconhece é dito, não escondido", () => {
  it("lista as decisões que ninguém verificou", () => {
    const naoVerificadas = unverifiedTechnologies(DESCRICAO);
    expect(naoVerificadas).toContain("React 19.1.0");
    expect(naoVerificadas).toContain("CSS Modules");
  });

  it("o que o catálogo reconhece não entra na lista de não verificadas", () => {
    const naoVerificadas = unverifiedTechnologies(DESCRICAO);
    expect(naoVerificadas).not.toContain("PostgreSQL 16");
    expect(naoVerificadas).not.toContain("Node.js 26");
    expect(detectPrerequisites(DESCRICAO).map((item) => item.binary)).toContain("psql");
  });

  it("descrição sem Tech Stack não inventa lista", () => {
    expect(unverifiedTechnologies("# Projeto\n\ntexto solto")).toEqual([]);
  });
});

describe("a escolha é numérica", () => {
  it("lê 1, 2 e 3", () => {
    expect(readPrerequisiteChoice("1")).toBe("instalar");
    expect(readPrerequisiteChoice(" 2 ")).toBe("verificar");
    expect(readPrerequisiteChoice("3")).toBe("abortar");
  });

  it("qualquer outra coisa é recusada, nunca adivinhada", () => {
    expect(readPrerequisiteChoice("sim")).toBeNull();
    expect(readPrerequisiteChoice("")).toBeNull();
    expect(readPrerequisiteChoice("instalar")).toBeNull();
  });

  it("a tela nomeia o que falta e as três saídas", () => {
    const tela = renderPrerequisiteChoice([ausente("PostgreSQL", "psql")]);
    expect(tela).toContain("PostgreSQL (psql)");
    expect(tela).toContain("1) instalar agora");
    expect(tela).toContain("2) já instalei");
    expect(tela).toContain("3) abortar");
  });
});

describe("resolução", () => {
  it("abortar não instala nada e diz por que parou", async () => {
    let instalou = false;
    const resultado = await resolvePrerequisites([ausente("Redis", "redis-server")], {
      choose: async () => "abortar",
      install: async () => void (instalou = true),
      announce: () => undefined,
    });

    expect(instalou).toBe(false);
    expect(resultado.resolved).toBe(false);
    if (!resultado.resolved) expect(resultado.reason).toContain("optou por não seguir");
  });

  it("nada faltando resolve sem perguntar", async () => {
    let perguntou = false;
    const presente: PrerequisiteStatus = { ...ausente("Node.js", "node"), present: true, path: "/usr/bin/node" };
    const resultado = await resolvePrerequisites([presente], {
      choose: async () => {
        perguntou = true;
        return "abortar";
      },
      install: async () => undefined,
      announce: () => undefined,
    });

    expect(perguntou).toBe(false);
    expect(resultado.resolved).toBe(true);
  });

  it("a palavra de quem instalou não conta: o que decide é a reverificação", async () => {
    // O executor diz ter instalado, mas `which` continua não achando: o build
    // não pode começar. É o mesmo erro do gate 1 — escrever arquivo não é fazer
    // o trabalho — aplicado a instalar.
    const ditas: string[] = [];
    const resultado = await resolvePrerequisites(
      [ausente("MongoDB", "mongod")],
      {
        choose: async () => "instalar",
        install: async () => undefined,
        announce: (message) => void ditas.push(message),
      },
      2,
    );

    expect(resultado.resolved).toBe(false);
    if (!resultado.resolved) expect(resultado.missing[0]?.technology).toBe("MongoDB");
    expect(ditas.join("\n")).toContain("continua ausente");
  });

  it("o teto de rodadas existe para o laço não ser infinito", async () => {
    let vezes = 0;
    await resolvePrerequisites(
      [ausente("Redis", "redis-server")],
      {
        choose: async () => {
          vezes += 1;
          return "verificar";
        },
        install: async () => undefined,
        announce: () => undefined,
      },
      3,
    );
    expect(vezes).toBe(3);
  });
});
