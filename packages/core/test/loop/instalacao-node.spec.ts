import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { falhaDeDependenciasNode, falhaDeInstalacaoNode, inspecionarInstalacaoNode, MARCA_DE_INSTALACAO_NODE, registrarInstalacaoNode, runtimeNode } from "../../src/loop/instalacao-node.js";

let raiz: string;
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), "capivara-runtime-")); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });
const manifesto = () => writeFile(join(raiz, "package.json"), JSON.stringify({ dependencies: { sqlite: "1.0" }, devDependencies: { vitest: "1.0" } }));
const ABI = "The module '/x/sqlite.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 141. This version of Node.js requires NODE_MODULE_VERSION 137.";

describe("identidade das dependências Node", () => {
  it("mudança de runtime invalida a instalação mesmo com manifesto idêntico", async () => {
    await manifesto();
    await mkdir(join(raiz, "node_modules"));
    const runtime = { ...runtimeNode(), node: "v25.9.0", abi: "141" };
    await registrarInstalacaoNode(raiz, runtime);
    expect((await inspecionarInstalacaoNode(raiz, { runtime })).estado).toBe("compativel");
    const outro = await inspecionarInstalacaoNode(raiz, { runtime: { ...runtime, node: "v24.22.0", abi: "137" } });
    expect(outro.estado).toBe("incompativel");
    expect(outro.motivo).toContain("ABI 141");
    expect(outro.motivo).toContain("ABI 137");
  });

  it("mudança só no lockfile invalida a marca, inclusive após rollback", async () => {
    await manifesto();
    await mkdir(join(raiz, "node_modules"));
    await writeFile(join(raiz, "package-lock.json"), "versão integrada");
    await registrarInstalacaoNode(raiz);
    await writeFile(join(raiz, "package-lock.json"), "versão anterior restaurada");
    expect((await inspecionarInstalacaoNode(raiz)).estado).toBe("incompativel");
  });

  it("instalação anterior sem marca detecta ABI explícita num addon isolado", async () => {
    await manifesto();
    await mkdir(join(raiz, "node_modules", "sqlite", "build"), { recursive: true });
    await writeFile(join(raiz, "node_modules", "sqlite", "build", "sqlite.node"), "fixture nativa");
    const sondar = vi.fn(async () => ABI);
    const estado = await inspecionarInstalacaoNode(raiz, { sondar });
    expect(estado.estado).toBe("incompativel");
    expect(sondar).toHaveBeenCalledOnce();
    expect(await readFile(join(raiz, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8").catch(() => null)).toBeNull();
  });

  it("outro erro de addon não é confundido com mudança ABI", async () => {
    await manifesto();
    await mkdir(join(raiz, "node_modules", "sqlite"), { recursive: true });
    await writeFile(join(raiz, "node_modules", "sqlite", "plugin.node"), "fixture");
    expect((await inspecionarInstalacaoNode(raiz, { sondar: async () => "Module did not self-register" })).estado).toBe("compativel");
    expect(falhaDeDependenciasNode("AssertionError: expected label to equal português")).toBe(false);
  });

  it("não confunde prebuilds de ABIs alternativas com a instalação ativa", async () => {
    await manifesto();
    await mkdir(join(raiz, "node_modules", "sqlite", "prebuilds", "linux-x64"), { recursive: true });
    await writeFile(join(raiz, "node_modules", "sqlite", "prebuilds", "linux-x64", "node.abi-antiga.node"), "distribuição alternativa");
    const sondar = vi.fn(async () => ABI);
    expect((await inspecionarInstalacaoNode(raiz, { sondar })).estado).toBe("compativel");
    expect(sondar).not.toHaveBeenCalled();
  });

  it("rebuild externo incompatível é detectado mesmo quando mantém a marca anterior", async () => {
    await manifesto();
    await mkdir(join(raiz, "node_modules", "sqlite", "build", "Release"), { recursive: true });
    await registrarInstalacaoNode(raiz);
    await writeFile(join(raiz, "node_modules", "sqlite", "build", "Release", "sqlite.node"), "rebuild posterior");
    expect((await inspecionarInstalacaoNode(raiz, { sondar: async () => ABI })).estado).toBe("incompativel");
  });

  it("somente pacote declarado ausente autoriza o reparo de instalação", async () => {
    await manifesto();
    expect(await falhaDeInstalacaoNode(raiz, "Cannot find module 'vitest'")).toBe(true);
    expect(await falhaDeInstalacaoNode(raiz, "sh: 1: vitest: not found")).toBe(true);
    expect(await falhaDeInstalacaoNode(raiz, "Cannot find module './src/api.js'")).toBe(false);
    expect(await falhaDeInstalacaoNode(raiz, "Cannot find package 'pacote-nao-declarado'")).toBe(false);
    expect(await falhaDeInstalacaoNode(raiz, ABI)).toBe(true);
  });

  it("sem manifesto ou dependências, não exige instalação nem cria pastas", async () => {
    await registrarInstalacaoNode(raiz);
    expect((await inspecionarInstalacaoNode(raiz)).estado).toBe("nao-se-aplica");
    await writeFile(join(raiz, "package.json"), '{"scripts":{"test":"node --test"}}');
    expect((await inspecionarInstalacaoNode(raiz)).estado).toBe("nao-se-aplica");
    await manifesto();
    expect((await inspecionarInstalacaoNode(raiz)).estado).toBe("ausente");
  });
});
