/** Integração real de Git com instalação e suíte substituídas, sem rede ou addon externo. */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executarEmParalelo, type ParaleloOptions } from "../../src/loop/paralelo.js";
import { MARCA_DE_INSTALACAO_NODE, registrarInstalacaoNode, runtimeNode } from "../../src/loop/instalacao-node.js";
import { runPaths } from "../../src/state/paths.js";
import { comandoDeInstalacao } from "../../src/loop/worktree.js";

const run = promisify(execFile);
const ABI = "The module 'sqlite.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 141. This version of Node.js requires NODE_MODULE_VERSION 137.";
let raiz: string;
let cache: string;
const git = async (args: string[], cwd = raiz) => (await run("git", args, { cwd })).stdout.trim();
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "capivara-integracao-env-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-integracao-cache-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await writeFile(join(raiz, ".gitignore"), "node_modules/\n.capivara/runs/\n");
  await writeFile(join(raiz, "package.json"), '{"dependencies":{"sqlite":"1"}}');
  await writeFile(join(raiz, "package-lock.json"), '{"lockfileVersion":3}');
  await mkdir(join(raiz, "node_modules"));
  await registrarInstalacaoNode(raiz);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "base"]);
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

function opcoes(extra: Partial<ParaleloOptions> = {}) {
  const rodar = vi.fn<ParaleloOptions["rodar"]>(async (_session, execucao) => {
    await writeFile(join(execucao.workRoot, "entrega.txt"), "correção já aprovada, preservar\n");
    await git(["add", "entrega.txt"], execucao.workRoot);
    await git(["commit", "-q", "-m", "feat: entrega"], execucao.workRoot);
    return { status: "complete", committed: true, message: "entregue", cycles: 1 };
  });
  const instalar = vi.fn<NonNullable<ParaleloOptions["instalar"]>>(async () => ({ exitCode: 0, output: "instalado" }));
  const testRunner = vi.fn<NonNullable<ParaleloOptions["testRunner"]>>(async () => ({ exitCode: 0, output: "suite completa" }));
  const esquecer = vi.fn(async () => undefined);
  const anuncios: string[] = [];
  const options: ParaleloOptions = {
    projectRoot: raiz, runId: "build-runtime", sessions: [{ id: "P07", number: 7, title: "Entrega", taskCount: 1, markdown: "fase", file: "fase.md", areas: "", dependsOn: [] }],
    agentes: [{ engine: "codex", label: "luna", systemInstall: false }], maxConcurrency: 1, keepGoing: false,
    jaFechada: () => false, rodar, aposIntegrar: async () => undefined, esquecer,
    isolamento: async () => ({ ok: true, impedimentos: [], motivos: [], limitacoes: [] }), comandoDeTeste: async () => "npm test", instalar, testRunner,
    systemInstall: false, portaBase: 3300, announce: (mensagem) => anuncios.push(mensagem), environment: { XDG_CACHE_HOME: cache }, now: () => new Date("2026-10-17T10:00:00Z"),
    ...extra,
  };
  return { options, rodar, instalar, testRunner, esquecer, anuncios };
}

describe("ambiente da árvore integrada", () => {
  it("cache ignorado já versionado não interrompe a integração nem a fase seguinte", async () => {
    const generated = ["node_modules/better-sqlite3/build/Makefile", "server/node_modules/.vite/vitest/results.json"];
    for (const path of generated) {
      await mkdir(join(raiz, path, ".."), { recursive: true });
      await writeFile(join(raiz, path), "versão legada\n");
      await git(["add", "-f", "--", path]);
    }
    await git(["commit", "-qm", "dependências versionadas anteriormente"]);
    const cenario = opcoes();
    cenario.options.sessions = [cenario.options.sessions[0]!, { ...cenario.options.sessions[0]!, id: "P08", number: 8 }];
    cenario.rodar.mockImplementation(async (session, execucao) => {
      expect(await execucao.conferirPrincipal()).toEqual([]);
      const file = `entrega-${session.id}.txt`;
      await writeFile(join(execucao.workRoot, file), "entrega aprovada\n");
      await git(["add", "--", file], execucao.workRoot);
      await git(["commit", "-qm", `feat: ${session.id}`], execucao.workRoot);
      return { status: "complete", committed: true, message: "entregue", cycles: 1 };
    });
    let checks = 0;
    cenario.testRunner.mockImplementation(async () => {
      checks += 1;
      for (const path of generated) await writeFile(join(raiz, path), `gerado pela suíte ${checks}\n`);
      return { exitCode: 0, output: "suite completa" };
    });
    const result = await executarEmParalelo(cenario.options);
    expect(result.parada, cenario.anuncios.join("\n")).toBeNull();
    expect(cenario.rodar).toHaveBeenCalledTimes(2);
    expect(cenario.testRunner).toHaveBeenCalledTimes(2);
    expect(await git(["log", "-2", "--format=%s"])).toBe("feat: P08\nfeat: P07");
    expect(await git(["show", `HEAD:${generated[0]}`])).toBe("versão legada");
    expect(await readFile(join(raiz, generated[0]!), "utf8")).toBe("gerado pela suíte 2\n");
    expect(cenario.anuncios.join("\n")).toContain("dependências locais ignoradas");
  });

  it.each(["package-lock.json", "npm-shrinkwrap.json"])("lockfile %s ignorado não vira autoridade da instalação", async (lockfile) => {
    await git(["rm", "--cached", "package-lock.json"]);
    await rm(join(raiz, "package-lock.json"));
    await writeFile(join(raiz, lockfile), "lockfile local obsoleto");
    await writeFile(join(raiz, ".gitignore"), `node_modules/\n.capivara/\n${lockfile}\n`);
    expect(await comandoDeInstalacao(raiz)).toBe("npm install --no-audit --no-fund --no-package-lock --engine-strict");
    expect(await readFile(join(raiz, lockfile), "utf8")).toBe("lockfile local obsoleto");
  });

  it("lockfile rastreado continua usando ci mesmo casando com o ignore", async () => {
    await writeFile(join(raiz, ".gitignore"), "node_modules/\npackage-lock.json\n");
    expect(await comandoDeInstalacao(raiz)).toBe("npm ci --no-audit --no-fund --engine-strict");
  });

  it("sem Git mantém ci para um lockfile existente; sem lockfile instala sem criá-lo", async () => {
    expect(await comandoDeInstalacao(cache)).toBe("npm install --no-audit --no-fund --no-package-lock --engine-strict");
    await writeFile(join(cache, "package-lock.json"), "lockfile");
    expect(await comandoDeInstalacao(cache)).toBe("npm ci --no-audit --no-fund --engine-strict");
  });

  it("integra manifesto novo com lockfile ignorado antigo sem refazer a fase aprovada", async () => {
    await git(["rm", "--cached", "package-lock.json"]);
    await writeFile(join(raiz, ".gitignore"), "node_modules/\n.capivara/\npackage-lock.json\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-qm", "política sem lockfile versionado"]);
    const lockAntes = await readFile(join(raiz, "package-lock.json"), "utf8");
    const cenario = opcoes();
    const original = cenario.options.rodar;
    cenario.options.rodar = async (session, execucao) => {
      await writeFile(join(execucao.workRoot, "package.json"), '{"dependencies":{"sqlite":"1","router":"2"}}');
      await git(["add", "package.json"], execucao.workRoot);
      return original(session, execucao);
    };
    cenario.instalar.mockImplementation(async (command) => command.startsWith("npm ci")
      ? { exitCode: 1, output: "npm error Missing: router@2 from lock file" }
      : { exitCode: 0, output: "dependências instaladas sem usar lockfile local" });
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada).toBeNull();
    expect(cenario.instalar).toHaveBeenCalledExactlyOnceWith("npm install --no-audit --no-fund --no-package-lock --engine-strict", raiz);
    expect(cenario.rodar).toHaveBeenCalledOnce();
    expect(cenario.testRunner).toHaveBeenCalledOnce();
    expect(await readFile(join(raiz, "package-lock.json"), "utf8")).toBe(lockAntes);
    expect(await git(["status", "--porcelain"])).toBe("");
    expect(await git(["log", "--format=%s", "-1"])).toBe("feat: entrega");
  });

  it("runtime mudou sem alterar manifesto: não copia instalação antiga e instala antes de G2", async () => {
    await registrarInstalacaoNode(raiz, { ...runtimeNode(), node: "v25.9.0", abi: "runtime-antigo" });
    let copiou = true;
    const cenario = opcoes();
    const original = cenario.options.rodar;
    cenario.options.rodar = async (session, execucao) => {
      copiou = await readFile(join(execucao.workRoot, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8").then(() => true, () => false);
      return original(session, execucao);
    };
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada).toBeNull();
    expect(copiou).toBe(false);
    expect(cenario.rodar).toHaveBeenCalledOnce();
    expect(cenario.instalar).toHaveBeenCalledExactlyOnceWith("npm ci --no-audit --no-fund --engine-strict", raiz);
    expect(cenario.testRunner).toHaveBeenCalledOnce();
    expect(await readFile(join(raiz, "entrega.txt"), "utf8")).toContain("já aprovada");
  });

  it("G2 sem comando não atesta uma instalação anterior não validada", async () => {
    await rm(join(raiz, "node_modules", MARCA_DE_INSTALACAO_NODE));
    const cenario = opcoes({ comandoDeTeste: async () => null });
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada).toBeNull();
    expect(cenario.instalar).not.toHaveBeenCalled();
    expect(cenario.testRunner).not.toHaveBeenCalled();
    expect(await readFile(join(raiz, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8").catch(() => null)).toBeNull();
  });

  it("ABI só aparece no G2: repara uma vez e testa o MESMO commit sem chamar novamente a construção", async () => {
    const cenario = opcoes();
    cenario.testRunner.mockResolvedValueOnce({ exitCode: 1, output: `${"log inicial\n".repeat(240)}${ABI}\nstack completa` });
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada).toBeNull();
    expect(cenario.rodar).toHaveBeenCalledOnce();
    expect(cenario.instalar).toHaveBeenCalledOnce();
    expect(cenario.testRunner).toHaveBeenCalledTimes(2);
    expect(await git(["log", "--format=%s"])).toBe("feat: entrega\nbase");
    const log = await readFile(join(runPaths(raiz, "build-runtime").logs, "P07.g2-integracao-1.log"), "utf8");
    expect(log).toContain("log inicial\n".repeat(240));
    expect(log).toContain("stack completa");
  });

  it("infraestrutura continua quebrada: preserva árvore e commit aprovado; retomada não chama construtor", async () => {
    const cenario = opcoes();
    cenario.testRunner.mockResolvedValue({ exitCode: 1, output: ABI });
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada?.outcome.status).toBe("failed");
    expect(cenario.instalar).toHaveBeenCalledOnce();
    expect(cenario.testRunner).toHaveBeenCalledTimes(2);
    expect(cenario.rodar).toHaveBeenCalledOnce();
    expect(cenario.esquecer).not.toHaveBeenCalled();
    expect(await git(["log", "--format=%s"])).toBe("base");
    const checkpoint = JSON.parse(await readFile(join(runPaths(raiz, "build-runtime").root, "integracoes", "P07.json"), "utf8")) as { commit: string; worktree: { dir: string; branch: string } };
    expect(await readFile(join(checkpoint.worktree.dir, "entrega.txt"), "utf8")).toContain("já aprovada");
    expect(await git(["rev-parse", checkpoint.worktree.branch])).toBe(checkpoint.commit);
    cenario.testRunner.mockResolvedValue({ exitCode: 0, output: "agora válido" });
    const retomada = await executarEmParalelo(cenario.options);
    expect(retomada.parada).toBeNull();
    expect(cenario.rodar).toHaveBeenCalledOnce();
    expect(await git(["log", "--format=%s"])).toBe("feat: entrega\nbase");
    expect(await readFile(join(runPaths(raiz, "build-runtime").root, "integracoes", "P07.json"), "utf8").catch(() => null)).toBeNull();
  });

  it("instalação malsucedida não gasta ciclos de construção; registra saída completa", async () => {
    await registrarInstalacaoNode(raiz, { ...runtimeNode(), abi: "antiga" });
    const cenario = opcoes();
    cenario.instalar.mockResolvedValue({ exitCode: 1, output: "npm ERR! EAI_AGAIN\nregistry indisponível\nfim" });
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada?.outcome.status).toBe("failed");
    expect(cenario.rodar).toHaveBeenCalledOnce();
    expect(cenario.instalar).toHaveBeenCalledOnce();
    expect(cenario.testRunner).not.toHaveBeenCalled();
    expect(await readFile(join(runPaths(raiz, "build-runtime").logs, "P07.install-integracao-1.log"), "utf8")).toContain("registry indisponível\nfim");
    expect(await git(["show", "capivara/build-runtime/P07:entrega.txt"])).toContain("já aprovada");
  });

  it("--rebuild-all inicia construção nova e invalida a retomada aprovada, preservando seu branch", async () => {
    const cenario = opcoes();
    cenario.testRunner.mockResolvedValue({ exitCode: 1, output: ABI });
    await executarEmParalelo(cenario.options);
    const aprovado = await git(["rev-parse", "capivara/build-runtime/P07"]);
    cenario.testRunner.mockResolvedValue({ exitCode: 0, output: "ambiente reparado" });
    cenario.rodar.mockImplementationOnce(async (_sessao, execucao) => {
      await writeFile(join(execucao.workRoot, "entrega.txt"), "construção solicitada com --rebuild-all");
      await git(["add", "entrega.txt"], execucao.workRoot);
      await git(["commit", "-q", "-m", "feat: reconstrução explícita"], execucao.workRoot);
      return { status: "complete", committed: true, message: "reconstruída", cycles: 1 };
    });
    const retomada = await executarEmParalelo({ ...cenario.options, rebuildAll: true });
    expect(retomada.parada).toBeNull();
    expect(cenario.rodar).toHaveBeenCalledTimes(2);
    expect(await git(["rev-parse", `capivara/build-runtime/P07-parcial-${aprovado.slice(0, 7)}`])).toBe(aprovado);
    expect(await readFile(join(raiz, "entrega.txt"), "utf8")).toContain("--rebuild-all");
    expect(await readFile(join(runPaths(raiz, "build-runtime").root, "integracoes", "P07.json"), "utf8").catch(() => null)).toBeNull();
  });

  it("erro funcional não é ocultado por reinstalação nem aprovado", async () => {
    const cenario = opcoes();
    cenario.testRunner.mockResolvedValue({ exitCode: 1, output: "AssertionError: expected English to equal Português" });
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada?.outcome.status).toBe("failed");
    expect(cenario.instalar).not.toHaveBeenCalled();
    expect(cenario.rodar).toHaveBeenCalledTimes(2);
    expect(await git(["log", "--format=%s"])).toBe("base");
  });

  it("correção funcional parte do parcial aprovado e preserva os acertos anteriores", async () => {
    const cenario = opcoes();
    let rodadas = 0;
    let recuperou = false;
    cenario.options.rodar = async (_sessao, execucao) => {
      rodadas += 1;
      if (rodadas === 1) await writeFile(join(execucao.workRoot, "correcao-rede.txt"), "mensagens em português já aprovadas");
      else recuperou = await readFile(join(execucao.workRoot, "correcao-rede.txt"), "utf8").then((texto) => texto.includes("português"), () => false);
      await writeFile(join(execucao.workRoot, "entrega.txt"), `implementação ${rodadas}`);
      await git(["add", "entrega.txt", "correcao-rede.txt"], execucao.workRoot);
      await git(["commit", "-q", "-m", "feat: entrega"], execucao.workRoot);
      return { status: "complete", committed: true, message: "entregue", cycles: 1 };
    };
    cenario.testRunner.mockResolvedValueOnce({ exitCode: 1, output: "AssertionError: outra regra precisa de ajuste" });
    const resultado = await executarEmParalelo(cenario.options);
    expect(resultado.parada).toBeNull();
    expect(recuperou).toBe(true);
    expect(rodadas).toBe(2);
    expect(await readFile(join(raiz, "correcao-rede.txt"), "utf8")).toContain("português");
    expect(cenario.instalar).not.toHaveBeenCalled();
  });
});
