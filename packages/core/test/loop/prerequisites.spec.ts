import { describe, expect, it } from "vitest";
import {
  checkPrerequisites,
  describeMissing,
  detectPrerequisites,
  readPrerequisiteChoice,
  renderPrerequisiteChoice,
  resolvePrerequisites,
  unverifiedTechnologies,
} from "../../src/loop/index.js";
import type { PrerequisiteStatus } from "../../src/loop/index.js";
import { ROLES, buildInvocation } from "../../src/provider/index.js";

const ESQUELETO = [
  "# Pousada — Skeleton",
  "",
  "## Stack",
  "- Frontend: React 18",
  "- Backend: Node.js 20 com TypeScript 5",
  "- Banco: PostgreSQL 16",
  "",
  "## Entidades",
  "### reservations",
  "- id: bigint",
].join("\n");

describe("detecção de pré-requisitos", () => {
  it("lê a seção Stack do esqueleto e deduz os executáveis", () => {
    const encontrados = detectPrerequisites(ESQUELETO).map((prerequisite) => prerequisite.binary).sort();
    expect(encontrados).toEqual(["node", "psql"]);
  });

  it("distingue serviço de sistema de runtime do projeto", () => {
    const prerequisites = detectPrerequisites(ESQUELETO);
    expect(prerequisites.find((entry) => entry.binary === "psql")?.systemLevel).toBe(true);
    expect(prerequisites.find((entry) => entry.binary === "node")?.systemLevel).toBe(false);
  });

  it("não inventa pré-requisito para stack que não reconhece", () => {
    expect(detectPrerequisites("## Stack\n- Tudo: Elixir")).toEqual([]);
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

const ausente = (technology: string, binary: string): PrerequisiteStatus => ({
  technology,
  binary,
  systemLevel: true,
  present: false,
  path: null,
});

const COM_NAO_RECONHECIDAS = [
  "# Projeto — Skeleton",
  "",
  "## Stack",
  "- Linguagem: Node.js 26",
  "- Banco: PostgreSQL 16",
  "- Interface: React 19.1.0",
  "- Estilos: CSS Modules",
  "",
  "## Entidades",
].join("\n");

describe("o que o catálogo não reconhece é dito, não escondido", () => {
  it("lista as decisões que ninguém verificou", () => {
    const naoVerificadas = unverifiedTechnologies(COM_NAO_RECONHECIDAS);
    expect(naoVerificadas).toContain("React 19.1.0");
    expect(naoVerificadas).toContain("CSS Modules");
  });

  it("o que o catálogo reconhece não entra na lista de não verificadas", () => {
    const naoVerificadas = unverifiedTechnologies(COM_NAO_RECONHECIDAS);
    expect(naoVerificadas).not.toContain("PostgreSQL 16");
    expect(naoVerificadas).not.toContain("Node.js 26");
    expect(detectPrerequisites(COM_NAO_RECONHECIDAS).map((item) => item.binary)).toContain("psql");
  });

  it("esqueleto sem seção de stack não inventa lista", () => {
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

describe("o aviso do que não foi verificado precisa caber num aviso", () => {
  /** A stack do piloto 5, com as frases que o esqueleto de fato escreveu. */
  const ESQUELETO_REAL = [
    "# Gastos — Skeleton",
    "",
    "## Stack",
    "- Plataforma: Aplicação web executada no navegador, em uma máquina só, sem conta e sem servidor",
    "- Persistência: Armazenamento local do navegador para lancamentos, categorias e limites_mensais",
    "- Visual: Sistema visual próprio enxuto com tokens de cor centralizados, escala de espaçamento, tipografia definida, estados de passar o cursor, foco, vazio e carregamento, e temas claro e escuro",
    "",
    "## Entidades",
  ].join("\n");

  it("cada decisão vira um rótulo curto, não a frase inteira do esqueleto", () => {
    for (const entrada of unverifiedTechnologies(ESQUELETO_REAL)) {
      expect(entrada.length, entrada).toBeLessThanOrEqual(48);
    }
  });

  it("o aviso inteiro continua cabendo numa linha de terminal", () => {
    const aviso = `não verifiquei, o catálogo não reconhece: ${unverifiedTechnologies(ESQUELETO_REAL).join(", ")}`;
    // Antes desta correção o mesmo esqueleto produzia 373 caracteres.
    expect(aviso.length, aviso).toBeLessThan(200);
  });

  it("ainda diz o suficiente para a pessoa reconhecer do que se trata", () => {
    const entradas = unverifiedTechnologies(ESQUELETO_REAL);
    expect(entradas.some((entrada) => entrada.includes("Aplicação web"))).toBe(true);
    expect(entradas.some((entrada) => entrada.includes("Armazenamento local"))).toBe(true);
  });

  it("decisão que já é curta passa intacta", () => {
    expect(unverifiedTechnologies("## Stack\n- Estilos: CSS Modules")).toEqual(["CSS Modules"]);
  });
});

describe("a seção de stack é lida mesmo sendo a última do esqueleto", () => {
  it("sem seção depois dela, ainda deduz os executáveis", () => {
    const esqueleto = "# X — Skeleton\n\n## Stack\n- Banco: PostgreSQL 16\n- Runtime: Node.js 22\n";
    expect(detectPrerequisites(esqueleto).map((p) => p.binary).sort()).toEqual(["node", "psql"]);
  });

  it("sem seção depois dela, ainda lista o que não reconhece", () => {
    expect(unverifiedTechnologies("## Stack\n- Estilos: CSS Modules\n")).toEqual(["CSS Modules"]);
  });
});

describe("um build só reclama da árvore depois de saber que ninguém está escrevendo nela", () => {
  it("com outro build vivo, a mensagem nomeia o pid em vez de culpar a árvore", async () => {
    const { runBuild } = await import("../../src/loop/index.js");
    const { acquireLock, runIdFor } = await import("../../src/state/index.js");
    const { sha12 } = await import("../../src/contract/index.js");
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const projectRoot = await mkdtemp(join(tmpdir(), "capivara-build-vivo-"));
    await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
    const plano = "# X — Project Phases\n\n<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->\n\n## Overview\n\ntexto\n";
    await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), plano, "utf8");

    // Alguém já está rodando este mesmo plano.
    const lock = await acquireLock({ projectRoot, runId: runIdFor("build", sha12(plano)), command: "build" });
    try {
      const ditas: string[] = [];
      const resultado = await runBuild({
        projectRoot,
        language: "português do Brasil",
        engine: "codex",
        call: async () => {
          throw new Error("nenhuma chamada de modelo devia acontecer");
        },
        announce: (linha: string) => void ditas.push(linha),
        environment: {},
      });

      expect(resultado.exitCode).toBe(1);
      expect(resultado.errors.join(" ")).toContain(`pid ${process.pid}`);
      // E não manda descartar o trabalho de quem está escrevendo agora.
      expect(ditas.join(" ")).not.toContain("git clean");
    } finally {
      await lock.release();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("o gate 2 explica a causa, não só o sintoma", () => {
  /** A saída real do piloto 6: quinze testes vermelhos, uma causa só. */
  const QUINZE_FALHAS = [
    "❯ src/test/storage.test.ts (2 tests | 2 failed)",
    "  × persistência localStorage > salvar dados → recarregar → dados existem",
    "    → localStorage.clear is not a function",
    "  × persistência localStorage > update e delete funcionam",
    "    → localStorage.clear is not a function",
    "❯ src/test/types.test.ts (2 tests | 2 failed)",
    "  × tipos compilam e satisfazem regras transversais",
    "    → localStorage.clear is not a function",
    "  × enums de status estão definidos",
    "    → localStorage.clear is not a function",
    "Tests  15 failed (15)",
  ].join("\n");

  it("aponta a mensagem repetida e diz onde procurar", async () => {
    const { raizComum } = await import("../../src/loop/gates.js");
    const aviso = raizComum(QUINZE_FALHAS);
    expect(aviso).toContain("localStorage.clear is not a function");
    expect(aviso).toContain("configuração do ambiente");
    expect(aviso).toContain("4 das 4");
  });

  it("cala quando as falhas têm causas diferentes: apontar uma seria palpite", async () => {
    const { raizComum } = await import("../../src/loop/gates.js");
    const variadas = ["→ esperava 3, recebeu 2", "→ não encontrou o elemento", "→ timeout após 5000ms"].join("\n");
    expect(raizComum(variadas)).toBe("");
  });

  it("cala com poucas falhas, onde repetição não é evidência", async () => {
    const { raizComum } = await import("../../src/loop/gates.js");
    expect(raizComum("→ mesma coisa\n→ mesma coisa")).toBe("");
  });
});

describe("o gate 2 pede o que o executor pode fazer", () => {
  const runnerAusente = async () => ({ exitCode: 127, output: "sh: 1: vitest: not found" });

  it("sem acesso de sistema, manda instalar como dependência do projeto", async () => {
    const { gate2 } = await import("../../src/loop/gates.js");
    const resultado = await gate2("/tmp/p", "npm test", runnerAusente, false);
    if (resultado.green) throw new Error("esperava o gate reprovando");
    expect(resultado.cause).toContain("NÃO tem acesso de sistema");
    expect(resultado.cause).toContain("dependência DO PROJETO");
    expect(resultado.cause).not.toContain("Você tem acesso de sistema:");
  });

  /*
   * A instrução afirmava acesso de sistema sempre, inclusive com
   * `--no-system-install`. O executor tentava instalar fora do projeto, era
   * negado, e gastava o ciclo seguindo uma ordem impossível.
   */
  it("com acesso de sistema, aí sim manda instalar o runner do ambiente", async () => {
    const { gate2 } = await import("../../src/loop/gates.js");
    const resultado = await gate2("/tmp/p", "npm test", runnerAusente, true);
    if (resultado.green) throw new Error("esperava o gate reprovando");
    expect(resultado.cause).toContain("Você tem acesso de sistema");
  });

  it("os dois caminhos deixam claro que não é teste vermelho", async () => {
    const { gate2 } = await import("../../src/loop/gates.js");
    for (const sistema of [true, false]) {
      const resultado = await gate2("/tmp/p", "npm test", runnerAusente, sistema);
      if (resultado.green) throw new Error("esperava o gate reprovando");
      expect(resultado.toolMissing, String(sistema)).toBe(true);
      expect(resultado.cause, String(sistema)).toContain("não é um teste vermelho");
    }
  });
});
