import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARQUIVO_DE_EXECUCAO,
  aceitaEffort,
  agenteComoFlag,
  conferirAgentes,
  gravarArquivoDeExecucao,
  lerAgenteDaFlag,
  lerArquivoDeExecucao,
  lerEstrategia,
  papeisDosAgentes,
  resolverEstrategia,
  SERIAL,
  type LeituraDoArquivo,
} from "../../src/config/execucao.js";
import type { RoleConfig } from "../../src/provider/index.js";

const BUILDER: RoleConfig = { provider: "codex", model: "gpt-5.5", effort: "high", credential: "", command: "" };
const AUSENTE: LeituraDoArquivo = { estado: "ausente" };

describe("o arquivo de execução", () => {
  let raiz: string;
  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "capivara-execucao-"));
  });
  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it("projeto sem arquivo é serial", async () => {
    expect(await lerArquivoDeExecucao(raiz)).toEqual({ estado: "ausente" });
    const resolvida = resolverEstrategia({}, await lerArquivoDeExecucao(raiz));
    expect(resolvida).toMatchObject({ ok: true, estrategia: SERIAL, origem: "padrão" });
  });

  it("grava e lê de volta a mesma estratégia", async () => {
    const estrategia = {
      mode: "parallel" as const,
      maxConcurrency: 3,
      workers: [{ provider: "claude", model: "opus", effort: "", systemInstall: false }],
    };
    await gravarArquivoDeExecucao(raiz, estrategia);
    expect(await lerArquivoDeExecucao(raiz)).toEqual({ estado: "ok", estrategia });
    expect(JSON.parse(await readFile(join(raiz, ARQUIVO_DE_EXECUCAO), "utf8"))).toMatchObject({ version: 1, mode: "parallel" });
  });

  it("JSON quebrado é inválido, não ausente", async () => {
    await mkdir(join(raiz, ".capivara"), { recursive: true });
    await writeFile(join(raiz, ARQUIVO_DE_EXECUCAO), "{ mode: parallel", "utf8");
    expect(await lerArquivoDeExecucao(raiz)).toEqual({ estado: "inválido", erros: ["o arquivo não é JSON válido"] });
  });
});

describe("a forma da estratégia", () => {
  it("recusa o que não sabe ler, em vez de adivinhar", () => {
    const casos: [unknown, string][] = [
      [{ version: 2, mode: "serial" }, "version deve ser 1"],
      [{ version: 1, mode: "turbo" }, 'mode deve ser "serial" ou "parallel"'],
      [{ version: 1, mode: "parallel", maxConcurrency: 1 }, "maxConcurrency deve ser um inteiro de 2 a 8"],
      [{ version: 1, mode: "parallel", maxConcurrency: 99 }, "maxConcurrency deve ser um inteiro de 2 a 8"],
      [{ version: 1, mode: "parallel", maxConcurrency: 2, workers: [{ model: "x" }] }, "agente 1: provider ausente"],
      [{ version: 1, mode: "parallel", maxConcurrency: 2, workers: [{ provider: "codex", modelo: "x" }] }, 'agente 1: campo desconhecido "modelo"'],
      [{ version: 1, mode: "parallel", maxConcurrency: 2, workers: [{ provider: "codex", model: "a b" }] }, "agente 1: model inválido"],
      [{ version: 1, mode: "parallel", maxConcurrency: 2, workers: [{ provider: "a" }, { provider: "b" }, { provider: "c" }] }, "há 3 agentes configurados para no máximo 2 ao mesmo tempo"],
      [{ version: 1, mode: "serial", maxConcurrency: 3 }, "o modo serial não leva maxConcurrency nem workers"],
      [{ version: 1, mode: "serial", extra: true }, 'campo desconhecido "extra"'],
    ];
    for (const [valor, erro] of casos) {
      const lido = lerEstrategia(valor);
      expect(lido.ok, JSON.stringify(valor)).toBe(false);
      if (!lido.ok) expect(lido.erros).toContain(erro);
    }
  });
});

describe("--worker", () => {
  it("provider sozinho, ou chave=valor", () => {
    expect(lerAgenteDaFlag("codex")).toEqual({ ok: true, agente: { provider: "codex", model: "", effort: "" } });
    expect(lerAgenteDaFlag("provider=opencode,model=anthropic/claude:beta,effort=high,system-install=no")).toEqual({
      ok: true,
      agente: { provider: "opencode", model: "anthropic/claude:beta", effort: "high", systemInstall: false },
    });
  });

  it("recusa chave desconhecida, repetida ou sem provider", () => {
    expect(lerAgenteDaFlag("provider=codex,modelo=x")).toMatchObject({ ok: false });
    expect(lerAgenteDaFlag("provider=codex,provider=claude")).toMatchObject({ ok: false });
    expect(lerAgenteDaFlag("model=x")).toMatchObject({ ok: false });
    expect(lerAgenteDaFlag("provider=codex,system-install=talvez")).toMatchObject({ ok: false });
  });

  it("o que o wizard imprime é o que a flag lê", () => {
    for (const agente of [
      { provider: "codex", model: "", effort: "" },
      { provider: "claude", model: "opus", effort: "high", systemInstall: false },
    ]) {
      expect(lerAgenteDaFlag(agenteComoFlag(agente))).toEqual({ ok: true, agente });
    }
  });
});

describe("precedência", () => {
  const ARQUIVO_PARALELO: LeituraDoArquivo = {
    estado: "ok",
    estrategia: { mode: "parallel", maxConcurrency: 3, workers: [{ provider: "claude", model: "opus", effort: "" }] },
  };

  it("flag vence arquivo", () => {
    expect(resolverEstrategia({ serial: true }, ARQUIVO_PARALELO)).toMatchObject({ ok: true, estrategia: SERIAL, origem: "flags" });
    expect(resolverEstrategia({ parallel: "2" }, ARQUIVO_PARALELO)).toMatchObject({
      ok: true,
      estrategia: { mode: "parallel", maxConcurrency: 2, workers: [{ provider: "claude" }] },
      origem: "flags",
    });
  });

  it.each([{}, { parallel: "2" }])("todos como o builder limpa overrides salvos com flags %j", flags => {
    const original = JSON.stringify(ARQUIVO_PARALELO);
    expect(resolverEstrategia({ ...flags, workersAsBuilder: true }, ARQUIVO_PARALELO)).toMatchObject({
      ok: true, origem: "flags", estrategia: { mode: "parallel", maxConcurrency: flags.parallel ? 2 : 3, workers: [] },
    });
    expect(JSON.stringify(ARQUIVO_PARALELO)).toBe(original);
  });

  it("todos como o builder exige paralelo e não pode contradizer workers próprios", () => {
    expect(resolverEstrategia({ workersAsBuilder: true }, AUSENTE)).toMatchObject({ ok: false });
    expect(resolverEstrategia({ workersAsBuilder: true, serial: true }, ARQUIVO_PARALELO)).toMatchObject({ ok: false });
    expect(resolverEstrategia({ workersAsBuilder: true, parallel: "2", worker: ["codex"] }, ARQUIVO_PARALELO)).toMatchObject({ ok: false });
  });

  it("arquivo vence o padrão", () => {
    expect(resolverEstrategia({}, ARQUIVO_PARALELO)).toMatchObject({ ok: true, origem: "arquivo", estrategia: { mode: "parallel" } });
  });

  it("--worker troca os agentes do arquivo e só vale com paralelo", () => {
    expect(resolverEstrategia({ worker: ["codex"] }, ARQUIVO_PARALELO)).toMatchObject({
      ok: true,
      estrategia: { maxConcurrency: 3, workers: [{ provider: "codex" }] },
    });
    expect(resolverEstrategia({ worker: ["codex"] }, AUSENTE)).toMatchObject({ ok: false });
    expect(resolverEstrategia({ serial: true, worker: ["codex"] }, AUSENTE)).toMatchObject({ ok: false });
  });

  it("flags contraditórias ou fora da faixa param antes de começar", () => {
    expect(resolverEstrategia({ serial: true, parallel: "2" }, AUSENTE)).toMatchObject({ ok: false });
    expect(resolverEstrategia({ parallel: "1" }, AUSENTE)).toMatchObject({ ok: false });
    expect(resolverEstrategia({ parallel: "três" }, AUSENTE)).toMatchObject({ ok: false });
    expect(resolverEstrategia({ parallel: "2", worker: ["a", "b", "c"] }, AUSENTE)).toMatchObject({ ok: false });
  });

  it("arquivo malformado não vira serial em silêncio", () => {
    const quebrado: LeituraDoArquivo = { estado: "inválido", erros: ["version deve ser 1"] };
    const sem = resolverEstrategia({}, quebrado);
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(sem.erros.join("\n")).toContain("--serial");
    // Com a estratégia dita na linha de comando, o arquivo quebrado é aviso.
    const com = resolverEstrategia({ serial: true }, quebrado);
    expect(com).toMatchObject({ ok: true, estrategia: SERIAL });
    if (com.ok) expect(com.avisos[0]).toContain("malformado");
  });
});

describe("os agentes do pool", () => {
  it("modelo próprio usa seu padrão, sem herdar a variante de outro modelo da mesma CLI", () => {
    const builder = { ...BUILDER, provider: "opencode", model: "openrouter/moonshotai/kimi-k3", effort: "none" };
    const agentes = papeisDosAgentes({ mode: "parallel", maxConcurrency: 3, workers: [
      { provider: "opencode", model: "openrouter/z-ai/glm-5.3-prime", effort: "" },
      { provider: "opencode", model: "openrouter/moonshotai/kimi-k3", effort: "" },
      { provider: "opencode", model: "openrouter/z-ai/glm-5.3-prime", effort: "high" },
    ] }, builder);
    expect(agentes.map(a => a.config.effort)).toEqual(["", "none", "high"]);
  });

  it("agente sem configuração própria é o builder; o declarado substitui só o que declara", () => {
    const agentes = papeisDosAgentes(
      { mode: "parallel", maxConcurrency: 3, workers: [{ provider: "codex", model: "", effort: "low" }, { provider: "claude", model: "", effort: "" }] },
      BUILDER,
    );
    expect(agentes.map((agente) => agente.config)).toEqual([
      { ...BUILDER, effort: "low" },
      // Outro provider não herda o nome de modelo, que é de um provider só.
      { ...BUILDER, provider: "claude", model: "", effort: "" },
      BUILDER,
    ]);
  });

  it("serial é o builder, sozinho", () => {
    expect(papeisDosAgentes(SERIAL, BUILDER)).toEqual([{ config: BUILDER }]);
  });

  it("API direta não constrói; provider ausente da máquina é erro", async () => {
    const conferencia = await conferirAgentes(
      [
        { config: { ...BUILDER, provider: "anthropic" } },
        { config: { ...BUILDER, provider: "agy" } },
        { config: { ...BUILDER, provider: "inventado" } },
        { config: { ...BUILDER, provider: "custom", command: "" } },
      ],
      async (provider) => provider !== "agy",
    );
    expect(conferencia.erros).toHaveLength(4);
    expect(conferencia.erros[0]).toContain("API direta");
    expect(conferencia.erros[1]).toContain("não está instalado");
  });

  it("intensidade ignorada pela CLI é limitação dita, e não erro", async () => {
    expect(aceitaEffort("codex")).toBe(true);
    expect(aceitaEffort("opencode")).toBe(true);
    expect(aceitaEffort("cursor")).toBe(false);
    const conferencia = await conferirAgentes([{ config: { ...BUILDER, provider: "cursor", effort: "high" } }, { config: BUILDER }], async () => true);
    expect(conferencia.erros).toEqual([]);
    expect(conferencia.limitacoes.some((linha) => linha.includes("cursor") && linha.includes("ignorado"))).toBe(true);
  });

  it("todos no mesmo provider: o limite de uso é um só", async () => {
    const conferencia = await conferirAgentes([{ config: BUILDER }, { config: BUILDER }], async () => true);
    expect(conferencia.limitacoes.join("\n")).toContain("limite de uso");
  });
});
