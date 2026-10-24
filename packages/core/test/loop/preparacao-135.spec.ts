/**
 * A preparação que a própria Capivara pediu, executou e registrou não pode
 * parar o build (§135), no cenário do `build-e3a468a74631` (laravel/codex2).
 *
 * Lá, faltavam Vite e o Chromium do Playwright. A sessão de preparação terminou
 * com `status: complete`, `pendentesAntes: []` e os dois arquivos que criou —
 * `package.json` e `package-lock.json` — registrados com o sha256 que ainda
 * tinham na árvore. As sondas passaram. E a adoção recusou: o manifesto declara
 * `vite` e `@vitejs/plugin-react`, que o contrato de infraestrutura do PLAN
 * lista, mas que nenhuma sonda NOMEIA — a do Vite é `npm exec --no -- vite
 * --version`, que não diz pacote, e a única que diz é a do Chromium
 * (`@playwright/test`). A adoção usava as sondas como a lista do que era
 * permitido. A mensagem, genérica, ainda sugeria uma sessão interrompida.
 *
 * As sondas comprovam prontidão; quem autoriza dependência é o contrato do PLAN.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha12, type EnvironmentRequirement } from "../../src/contract/index.js";
import { runIdFor } from "../../src/state/index.js";
import { runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import { autoridadePublicada, dependenciasContratadas, type AutoridadeDaAdocao } from "../../src/loop/environment-plan.js";
import { adoptPreparedDependencies, conteudoDe, criadosPelaPreparacao, explicarPreparacaoNaoAdotada } from "../../src/loop/prepared-dependencies.js";
import { certifyCurrentPlan } from "../support/current-plan.js";

const run = promisify(execFile);
let root: string;
let cache: string;
const git = async (args: string[], cwd = root) => (await run("git", args, { cwd })).stdout.trim();

/* ------------------------------------------------------------ o cenário real */

/** As duas sondas que faltavam no incidente, na forma que o PLAN as escreveu. */
const VITE: EnvironmentRequirement = { technology: "Vite", binary: "npm", systemLevel: false, checkArgs: ["exec", "--no", "--", "vite", "--version"], installHint: "Instalar Vite e sua integração React localmente." };
const CHROMIUM: EnvironmentRequirement = { technology: "Chromium local", binary: "node", systemLevel: false, checkArgs: ["-e", "require('@playwright/test')"], installHint: "Instalar Chromium pelo Playwright com PLAYWRIGHT_BROWSERS_PATH=0." };
const SONDAS = [VITE, CHROMIUM];

/** O `infrastructure.dependencies` do environment.json do incidente, na ordem em que o PLAN o publicou. */
const CONTRATO = ["react", "react-dom", "react-router-dom", "express", "dotenv", "typescript", "vite", "@vitejs/plugin-react", "tsx",
  "concurrently", "@types/node", "@types/express", "@types/react", "@types/react-dom", "vitest", "@playwright/test"];
/** A autoridade da adoção no incidente, sem o commit com que comparar. */
const AUTORIDADE: AutoridadeDaAdocao = { requisitos: SONDAS, dependencias: CONTRATO, publicadas: null };
const INFRAESTRUTURA = { dependencies: CONTRATO.map((name) => ({ name, version: "", purpose: "…", basis: "…", kind: "dev" })) };

/** O manifesto que a sessão do incidente criou, byte a byte. */
const MANIFESTO = `{
  "devDependencies": {
    "@playwright/test": "^1.64.1",
    "@vitejs/plugin-react": "^6.1.2",
    "vite": "^8.3.5"
  }
}
`;
const DECLARADAS = { "@playwright/test": "^1.64.1", "@vitejs/plugin-react": "^6.1.2", vite: "^8.3.5" };
const LOCK = (declaradas: Record<string, string> = DECLARADAS) => JSON.stringify({ name: "codex2", lockfileVersion: 3, requires: true, packages: {
  "": { devDependencies: declaradas },
  "node_modules/vite": { version: "8.3.5", dev: true },
  "node_modules/@vitejs/plugin-react": { version: "6.1.2", dev: true },
  "node_modules/@playwright/test": { version: "1.64.1", dev: true },
} }, null, 2);

/** Um pacote instalado como o npm deixa: a pasta, o manifesto e, havendo ferramenta, o link em `.bin`. */
async function pacote(nome: string, versao: string, bin?: string): Promise<void> {
  const pasta = join(root, "node_modules", nome);
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, "package.json"), JSON.stringify({ name: nome, version: versao, ...(bin ? { bin: { [bin]: `bin/${bin}` } } : {}) }));
  await writeFile(join(pasta, "index.js"), "module.exports = 42;\n");
  if (!bin) return;
  const alvo = join(pasta, "bin", bin);
  await mkdir(dirname(alvo), { recursive: true });
  await writeFile(alvo, `#!${process.execPath}\nconsole.log(${JSON.stringify(`${nome} ${versao}`)});\n`);
  await chmod(alvo, 0o755);
  const link = join(root, "node_modules/.bin", bin);
  await mkdir(dirname(link), { recursive: true });
  await rm(link, { force: true });
  await symlink(relative(dirname(link), alvo), link);
}

/** O que a sessão de preparação do incidente deixou: o manifesto mínimo, o lock e a instalação. */
async function preparar(manifesto = MANIFESTO, lock = LOCK()): Promise<void> {
  await writeFile(join(root, "package.json"), manifesto);
  await writeFile(join(root, "package-lock.json"), lock);
  await pacote("vite", "8.3.5", "vite");
  await pacote("@vitejs/plugin-react", "6.1.2");
  await pacote("@playwright/test", "1.64.1", "playwright");
}

/** O que uma sessão registra ao terminar (§131): cada caminho com o conteúdo que ela deixou. */
async function atestar(caminhos = ["package.json", "package-lock.json"]): Promise<Map<string, Set<string>>> {
  const atestados = new Map<string, Set<string>>();
  for (const caminho of caminhos) {
    const conteudo = await conteudoDe(join(root, caminho));
    if (conteudo) atestados.set(caminho, new Set([conteudo]));
  }
  return atestados;
}

/** A pasta dos registros de um run, fora da árvore do produto como a do build. */
const PREPARACAO = () => join(root, ".capivara/runs/build-teste/preparation");

/** O registro em `preparation/`, como o build o escreve. */
async function registrar(pasta: string, nome: string, registro: Record<string, unknown>): Promise<void> {
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, `${nome}.json`), JSON.stringify({ stage: "preflight", role: "builder", ...registro }, null, 2));
}
async function criadosAgora(caminhos = ["package.json", "package-lock.json"]): Promise<{ caminho: string; sha256: string }[]> {
  return Promise.all(caminhos.map(async (caminho) => ({ caminho, sha256: (await conteudoDe(join(root, caminho)))! })));
}

async function repositorio(): Promise<void> {
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await git(["commit", "--allow-empty", "-qm", "base"]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-preparacao-135-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-preparacao-135-cache-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

/* -------------------------------------------------- o contrato como autoridade */

describe("o contrato de dependências do PLAN", () => {
  it("são os nomes de infrastructure.dependencies; o resto da infraestrutura não autoriza pacote", () => {
    expect(dependenciasContratadas({ infrastructure: INFRAESTRUTURA })).toEqual(CONTRATO);
    expect(dependenciasContratadas({ infrastructure: { tools: [{ name: "vite" }], runtimes: [{ name: "Node.js" }] } })).toEqual([]);
    expect(dependenciasContratadas({})).toEqual([]);
    // O npm distingue maiúsculas: o nome é o que o PLAN escreveu, sem os espaços.
    expect(dependenciasContratadas({ infrastructure: { dependencies: [{ name: " React " }, { name: "" }, { nome: "x" }, null, "vite"] } })).toEqual(["React"]);
  });

  it("o contrato de um projeto sem npm entre os gerenciadores não autoriza nada num package.json", () => {
    const dependencies = [{ name: "xunit" }, { name: "Avalonia" }];
    expect(dependenciasContratadas({ infrastructure: { packageManagers: [{ name: "NuGet" }, { name: "dotnet CLI" }], dependencies } })).toEqual([]);
    expect(dependenciasContratadas({ infrastructure: { packageManagers: [{ name: "NuGet" }, { name: "npm" }], dependencies } })).toEqual(["xunit", "Avalonia"]);
    // Sem gerenciador declarado não há como saber: o contrato vale, como no incidente sem esse campo.
    expect(dependenciasContratadas({ infrastructure: { dependencies } })).toEqual(["xunit", "Avalonia"]);
    for (const nome of ["npm (Node.js)", "npm@10", "NPM", "npm/npx", "Node Package Manager"]) {
      expect(dependenciasContratadas({ infrastructure: { packageManagers: [{ name: nome }], dependencies } })).toEqual(["xunit", "Avalonia"]);
    }
  });
});

describe("a adoção da preparação (§135)", () => {
  it("1 e 2: o manifesto e o lock do incidente são adotados — dependências que o PLAN contrata e as sondas não nomeiam", async () => {
    await repositorio();
    await preparar();
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await atestar(), CONTRATO)).toBe(true);
    expect(await git(["ls-tree", "-r", "--name-only", "HEAD"])).toBe("package-lock.json\npackage.json");
    expect(await git(["log", "-1", "--format=%s"])).toBe("chore(capivara): prepara dependências do ambiente");
    expect(await git(["rev-parse", "HEAD~1"])).toBe(head);
    expect(await git(["status", "--porcelain"])).toBe("");
    // Os bytes adotados são os que a sessão deixou.
    expect(await git(["show", "HEAD:package.json"])).toBe(MANIFESTO.trimEnd());
  });

  it("sem o contrato, as sondas continuam sendo tudo o que autoriza, como antes", async () => {
    await repositorio();
    await preparar();
    expect(await adoptPreparedDependencies(root, SONDAS, await atestar())).toBe(false);
    expect(await adoptPreparedDependencies(root, SONDAS, await atestar(), [])).toBe(false);
  });

  it("3: dependência que o PLAN não contrata continua impedindo a adoção, e o motivo a nomeia", async () => {
    await repositorio();
    const comAlheia = { ...DECLARADAS, "left-pad": "^1.3.0" };
    await preparar(JSON.stringify({ devDependencies: comAlheia }, null, 2), LOCK(comAlheia));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toContain("package.json");
    expect(motivo).toContain("left-pad");
    expect(motivo).toContain("infrastructure.dependencies");
    expect(motivo).not.toMatch(/\bvite\b.*não autoriza/u);
  });

  it.each([
    ["alias", "npm:left-pad@1.3.0"],
    ["caminho", "file:../fora"],
    ["Git", "git+https://example.invalid/vite.git"],
    ["atalho do GitHub", "usuario/vite"],
    ["pasta acima", ".."],
    ["pasta do harness", ".capivara"],
    ["tarball", "vite-8.3.5.tgz"],
    ["tar", "x.tar"],
    ["pasta do usuário", "~/vite"],
    ["tarball com cara de pré-lançamento", "1.0.0-a.tgz"],
    ["tar com cara de pré-lançamento", "1.0.0-x.tar"],
    ["tar.gz com cara de metadado", "1.0.0+b.tar.gz"],
  ])("o nome contratado com versão fora do registro (%s) não é adotado: instala outra coisa sob o nome", async (_caso, versao) => {
    await repositorio();
    const disfarcadas = { ...DECLARADAS, vite: versao };
    await preparar(JSON.stringify({ devDependencies: disfarcadas }, null, 2), LOCK(disfarcadas));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE)).toContain(`\`vite\` como "${versao}"`);
  });

  it("manifesto que só declara o que nada autoriza é diagnosticado pelo que declara", async () => {
    await repositorio();
    await preparar(JSON.stringify({ dependencies: { "left-pad": "^1.3.0" } }, null, 2), LOCK({ "left-pad": "^1.3.0" }));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toMatch(/package\.json — [^\n]*declara só `left-pad`/u);
    expect(motivo).toMatch(/package-lock\.json — [^\n]*não acompanha um manifesto que a preparação adote/u);
  });

  it("um campo além do manifesto mínimo continua impedindo, nomeado", async () => {
    await repositorio();
    await preparar(JSON.stringify({ devDependencies: DECLARADAS, scripts: { dev: "vite" } }, null, 2));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE)).toContain("scripts");
  });

  it("4: o arquivo mudou depois da sessão: não adota, e o motivo é a comparação dos hashes", async () => {
    await repositorio();
    await preparar();
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const registrado = (await conteudoDe(join(root, "package.json")))!;
    await writeFile(join(root, "package.json"), MANIFESTO.replace("^8.3.5", "^8.3.6"));
    const atual = (await conteudoDe(join(root, "package.json")))!;
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toContain(atual.slice(0, 12));
    expect(motivo).toContain(registrado.slice(0, 12));
    expect(motivo).toContain("mudou depois");
  });

  it("5: manifesto do desenvolvedor que já estava pendente antes da sessão não é adotado, e o motivo diz que a sessão não o criou", async () => {
    await repositorio();
    await writeFile(join(root, "package.json"), MANIFESTO);
    await preparar();
    const pasta = PREPARACAO();
    // A sessão só criou o lock: o manifesto já estava pendente antes dela.
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: ["package.json"], criados: await criadosAgora(["package-lock.json"]), response: { exitCode: 0 } });
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(MANIFESTO);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toMatch(/package\.json[^\n]*nenhuma sessão de preparação deste run o registrou/u);
  });

  it("6: lock que não corresponde ao manifesto não é adotado, e o motivo diz a divergência", async () => {
    await repositorio();
    await preparar(MANIFESTO, LOCK({ ...DECLARADAS, vite: "^8.0.0" }));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toMatch(/package-lock\.json[^\n]*não corresponde/u);
    expect(motivo).toContain("vite");
  });

  it("7: registro ausente ou de sessão que não terminou não autoriza, e a mensagem diz o que o registro mostra", async () => {
    await repositorio();
    await preparar();
    expect(await adoptPreparedDependencies(root, SONDAS, null, CONTRATO)).toBe(false);
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "started", pendentesAntes: [] });
    expect(await criadosPelaPreparacao(pasta)).toBeNull();
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toContain("environment-install-a.json");
    expect(motivo).toContain("não terminou");
  });

  it("11: sessão que terminou normalmente não é apresentada como interrompida", async () => {
    await repositorio();
    const comAlheia = { ...DECLARADAS, "left-pad": "^1.3.0" };
    await preparar(JSON.stringify({ devDependencies: comAlheia }, null, 2), LOCK(comAlheia));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).not.toMatch(/interrompid/u);
    expect(motivo).not.toContain("ou o registro é de antes desta versão");
    expect(motivo).toContain("environment-install-a.json");
    expect(motivo).toMatch(/terminou[^\n]*complete/u);
    // Arquivo, situação Git, proveniência, hash, condição e a ação para continuar.
    expect(motivo).toContain("não versionado");
    expect(motivo).toContain("registrado como criado");
    expect(motivo).toContain("conteúdo igual ao registrado");
    expect(motivo).toContain("Para continuar");
  });

  it("8: o que sessões do mesmo run deixaram é reconhecido, inclusive o manifesto que a segunda reescreveu", async () => {
    await repositorio();
    const pasta = PREPARACAO();
    // A primeira sessão instala o Chromium e cria o manifesto só com ele.
    await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { "@playwright/test": "^1.64.1" } }, null, 2));
    await registrar(pasta, "environment-install-a", { status: "failed", pendentesAntes: [], criados: await criadosAgora(["package.json"]) });
    // A segunda acrescenta o Vite e gera o lock.
    await preparar();
    await registrar(pasta, "environment-install-b", { status: "complete", pendentesAntes: ["package.json"], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(true);
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
  });

  it("alteração alheia junto da preparação: nada é adotado, e o motivo nomeia o arquivo alheio", async () => {
    await repositorio();
    await preparar();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/app.ts"), "export {};\n");
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "src/app.ts"), "utf8")).toBe("export {};\n");
    expect(await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE)).toMatch(/src\/app\.ts[^\n]*não é manifesto/u);
  });

  it("12: depois de adotado, o manifesto é versionado; o que uma fase muda nele nunca é adotado como preparação", async () => {
    await repositorio();
    await preparar();
    const atestados = await atestar();
    expect(await adoptPreparedDependencies(root, SONDAS, atestados, CONTRATO)).toBe(true);
    const adotado = await git(["rev-parse", "HEAD"]);
    // A fase reescreve o manifesto com o conteúdo de antes — o mesmo sha que a preparação registrou — e acrescenta o script.
    await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: DECLARADAS, scripts: { dev: "vite" } }, null, 2));
    expect(await adoptPreparedDependencies(root, SONDAS, atestados, CONTRATO)).toBe(false);
    await writeFile(join(root, "package.json"), MANIFESTO.replace("^8.3.5", "^8.4.0"));
    expect(await adoptPreparedDependencies(root, SONDAS, new Map([...atestados, ["package.json", new Set([(await conteudoDe(join(root, "package.json")))!])]]), CONTRATO)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(adotado);
  });

  it.each(["^8.3.5", "8.3.5", "~8.3", ">=8.0.0 <9", ">= 8.0.0", "8.x", "*", "", "latest", "^1.0.0 || ^2.0.0", "1.2.3 - 2.3.4", "^8.0.0-beta.1"])(
    "a versão do registro %j continua aceita", async (versao) => {
      await repositorio();
      const declaradas = { ...DECLARADAS, vite: versao };
      await preparar(JSON.stringify({ devDependencies: declaradas }, null, 2), LOCK(declaradas));
      expect(await adoptPreparedDependencies(root, SONDAS, await atestar(), CONTRATO)).toBe(true);
    });

  it("a mesma dependência em duas chaves não é adotada: o npm escolhe por uma precedência que a conferência não vê", async () => {
    await repositorio();
    const manifesto = JSON.stringify({ devDependencies: { ...DECLARADAS, vite: "file:./fora" }, optionalDependencies: { vite: "^8.3.5" } }, null, 2);
    await preparar(manifesto, LOCK());
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE)).toContain("`vite` em mais de uma chave");
  });

  it.each([
    ["link", { link: true, resolved: "../fora" }],
    ["arquivo", { version: "8.3.5", resolved: "file:../vite-8.3.5.tgz" }],
    ["Git", { version: "8.3.5", resolved: "git+ssh://git@example.invalid/vite.git#abc" }],
  ])("o lock que manda instalar de fora do registro (%s) não é adotado", async (_caso, entrada) => {
    await repositorio();
    const lock = JSON.parse(LOCK());
    lock.packages["node_modules/vite"] = { ...entrada, dev: true };
    await preparar(MANIFESTO, JSON.stringify(lock, null, 2));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    expect(await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE)).toMatch(/package-lock\.json — [^\n]*`node_modules\/vite` de fora do registro/u);
  });

  it("o nome é comparado como o npm o compara: o legado com maiúscula da sonda continua adotado, e `VITE` não passa por `vite`", async () => {
    await repositorio();
    const LEGADO: EnvironmentRequirement = { technology: "Stream", binary: "node", systemLevel: false, checkArgs: ["-e", "require('JSONStream')"] };
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { JSONStream: "^1.3.5" } }, null, 2));
    await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { JSONStream: "^1.3.5" } } } }));
    expect(await adoptPreparedDependencies(root, [LEGADO], await atestar())).toBe(true);
    await rm(join(root, ".git"), { recursive: true, force: true });
    await repositorio();
    const maiusculas = { ...DECLARADAS, VITE: "^8.3.5" };
    await preparar(JSON.stringify({ devDependencies: maiusculas }, null, 2), LOCK(maiusculas));
    expect(await adoptPreparedDependencies(root, SONDAS, await atestar(), CONTRATO)).toBe(false);
  });

  it("versão que não é texto é dita pelo que é, e não como pasta que a busca não percorre", async () => {
    await repositorio();
    await preparar(JSON.stringify({ devDependencies: { vite: { versao: "8" } } }, null, 2), LOCK({}));
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toMatch(/package\.json — [^\n]*`vite` como \{"versao":"8"\}/u);
    expect(motivo).not.toContain("não percorre");
  });

  it("arquivo novo só no índice não é dito versionado no histórico", async () => {
    await repositorio();
    await preparar();
    await git(["add", "package.json"]);
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toMatch(/package\.json — no índice ou no histórico do Git/u);
    expect(motivo).not.toContain("versionado e alterado");
  });

  it("lock ao lado de um manifesto do desenvolvedor já versionado: o motivo é o do manifesto, e a ação não manda apagar o versionado", async () => {
    await repositorio();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "meu", scripts: { dev: "vite" }, devDependencies: DECLARADAS }, null, 2));
    await git(["add", "package.json"]);
    await git(["commit", "-qm", "manifesto do desenvolvedor"]);
    await writeFile(join(root, "package-lock.json"), LOCK());
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(["package-lock.json"]), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(false);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE))!;
    expect(motivo).toMatch(/package-lock\.json — [^\n]*acompanha package\.json, que não pode ser adotado: tem `scripts`/u);
    expect(motivo).toContain("apague os não versionados listados");
    expect(motivo).not.toContain("apague-os");
  });

  it("a preparação já adotada não explica a árvore que alguém sujou depois", async () => {
    await repositorio();
    await preparar();
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    expect(await adoptPreparedDependencies(root, SONDAS, await criadosPelaPreparacao(pasta), CONTRATO)).toBe(true);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/app.ts"), "export {};\n");
    expect(await explicarPreparacaoNaoAdotada(root, pasta, AUTORIDADE)).toBeNull();
  });

  it("o nome do contrato vale também na forma minúscula do npm, e só nela: `React` autoriza `react`", async () => {
    await repositorio();
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }, null, 2));
    await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { react: "^19.0.0" } } } }));
    expect(await adoptPreparedDependencies(root, [], await atestar(), ["React"])).toBe(true);
  });

  it("15: nada da adoção depende de provider ou modelo", async () => {
    const fonte = await readFile(new URL("../../src/loop/prepared-dependencies.ts", import.meta.url), "utf8");
    expect(fonte).not.toMatch(/codex|astra|minimax|claude|opencode|openrouter|gemini|luna/iu);
  });
});

/* -------------------------------------------------------------- o build inteiro */

const FASE = (numero: number, titulo: string, depende: string): string => [
  `## Phase ${numero}: ${titulo}`, "",
  `**Goal:** ${titulo} funciona · **Depends on:** ${depende} · **Covers:** workflow ${numero}`, "",
  `- [ ] **Task:** Entregar ${titulo.toLowerCase()}`,
  "  - **Acceptance criteria:**",
  `    - O arquivo de ${titulo.toLowerCase()} existe`,
  `  - **Traces:** US-${numero}.1`, "",
].join("\n");
const PLANO = ["# Lab — Project Phases", "", "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->", "", "## Overview", "", "Fundação e um módulo.", "",
  FASE(1, "Fundação", "none"), FASE(2, "Cadastro", "Phase 1"), "## Open Questions", "", "Nenhuma.", ""].join("\n");

/** O plano publicado, com as sondas e o contrato de infraestrutura no environment.json, e commitado como o PLAN faz. */
async function projetoPublicado(infraestrutura: unknown = INFRAESTRUTURA): Promise<void> {
  await repositorio();
  await mkdir(join(root, ".capivara/init"), { recursive: true });
  await writeFile(join(root, ".capivara/init/project-phases.md"), PLANO);
  await certifyCurrentPlan(root, SONDAS);
  const arquivo = join(root, ".capivara/init/environment.json");
  const ambiente = JSON.parse(await readFile(arquivo, "utf8"));
  await writeFile(arquivo, JSON.stringify({ ...ambiente, ...(infraestrutura === null ? {} : { infrastructure: infraestrutura }) }, null, 2) + "\n");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "docs(capivara): especificação RALPH READY"]);
}

function motor() {
  const chamadas: EngineCall[] = [];
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    if (chamada.role === "verifier") return { exitCode: 0, stdout: Array.from({ length: chamada.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null };
    const raiz = chamada.root ?? root;
    await mkdir(join(raiz, "src"), { recursive: true });
    await writeFile(join(raiz, "src", `${chamada.phase.id.toLowerCase()}.ts`), `export const fase = ${JSON.stringify(chamada.phase.id)};\n`);
    return { exitCode: 0, stdout: "feito", stderr: "", timedOut: null };
  };
  return { call, chamadas };
}

const PARALELO = { maxConcurrency: 2, agentes: [{ engine: "codex" as const, label: "a", systemInstall: false }, { engine: "codex" as const, label: "b", systemInstall: false }], resumo: [] };

async function construir(opcoes: { engine?: "codex" | "opencode" | "claude"; paralelo?: boolean; instalar?: () => Promise<void>; perguntar?: boolean } = {}) {
  const install = vi.fn(async () => { await (opcoes.instalar ?? (() => preparar()))(); return { exitCode: 0, stdout: "instalado", stderr: "", timedOut: null, resultRead: true }; });
  const engine = motor();
  const anuncios: string[] = [];
  const outcome = await runBuild({
    projectRoot: root, language: "português do Brasil", engine: opcoes.engine ?? "codex", call: engine.call, sleep: async () => undefined,
    environment: { XDG_CACHE_HOME: cache }, skipAcceptance: true, skipFlows: true, explicitTestCommand: "npm test",
    testRunner: async () => ({ exitCode: 0, output: "1 passed" }),
    installPrerequisites: install, announce: (mensagem) => anuncios.push(mensagem),
    // Sem acesso de sistema, quem decide instalar é a pergunta respondida; com ele, o build instala sozinho.
    ...(opcoes.perguntar ? { systemInstall: false, askPrerequisite: async () => "1" } : { systemInstall: true }),
    ...(opcoes.paralelo ? { parallel: PARALELO } : {}),
  });
  return { outcome, install, engine, anuncios };
}

describe("o build com a preparação do incidente (§135)", () => {
  it.each([
    { modo: "serial", paralelo: false },
    { modo: "paralelo", paralelo: true },
  ])("10 e 13: a preparação é adotada, a P01 começa e a árvore principal fica íntegra — $modo", async ({ paralelo }) => {
    await projetoPublicado();
    const { outcome, install, engine } = await construir({ paralelo });
    expect(install).toHaveBeenCalledOnce();
    expect(outcome.errors).toEqual([]);
    expect(outcome.exitCode).toBe(0);
    expect(engine.chamadas.some((chamada) => chamada.phase.id === "P01" && chamada.role !== "verifier")).toBe(true);
    expect(outcome.phases.map((fase) => fase.outcome.status)).toEqual(["complete", "complete"]);
    const historico = (await git(["log", "--format=%s"])).split("\n");
    const preparacao = historico.indexOf("chore(capivara): prepara dependências do ambiente");
    expect(preparacao).toBeGreaterThan(-1);
    // A preparação entrou antes do primeiro commit de fase: a P01 partiu dela.
    expect(preparacao).toBeGreaterThan(historico.findIndex((assunto) => assunto.startsWith("feat(phase-1)")));
    expect(await git(["show", `HEAD~${preparacao}:package.json`])).toBe(MANIFESTO.trimEnd());
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
    // O node_modules continua no disco, fora do histórico.
    expect(await git(["ls-tree", "-r", "--name-only", "HEAD"])).not.toContain("node_modules");
    expect(await readFile(join(root, "node_modules/vite/package.json"), "utf8")).toContain("8.3.5");
  });

  it.each(["codex", "opencode", "claude"] as const)("15: o mesmo resultado com o executor %s", async (engine) => {
    await projetoPublicado();
    const { outcome } = await construir({ engine });
    expect(outcome.exitCode).toBe(0);
    expect((await git(["log", "--format=%s"])).split("\n")).toContain("chore(capivara): prepara dependências do ambiente");
  });

  it("11: a preparação que foi além do contrato para antes da P01, sem commitar nem apagar, e diz o motivo exato", async () => {
    await projetoPublicado();
    const head = await git(["rev-parse", "HEAD"]);
    const comAlheia = { ...DECLARADAS, "left-pad": "^1.3.0" };
    const { outcome, engine } = await construir({ instalar: () => preparar(JSON.stringify({ devDependencies: comAlheia }, null, 2), LOCK(comAlheia)) });
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    const erros = outcome.errors.join("\n");
    expect(erros).toContain("o Core não pôde adotar");
    expect(erros).toContain("left-pad");
    expect(erros).toContain("infrastructure.dependencies");
    expect(erros).not.toMatch(/interrompid/u);
    expect(erros).toMatch(/terminou[^\n]*complete/u);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "package.json"), "utf8")).toContain("left-pad");
  });

  it("a retomada do incidente: o registro da execução anterior do mesmo run adota, sem nova sessão de preparação", async () => {
    await projetoPublicado();
    // O estado em que o build-e3a468a74631 parou: a preparação registrada, os arquivos pendentes.
    await preparar();
    const runId = runIdFor("build", sha12(PLANO));
    await registrar(join(root, ".capivara/runs", runId, "preparation"), "environment-install-e9297220", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const { outcome, install } = await construir();
    expect(install).not.toHaveBeenCalled();
    expect(outcome.exitCode).toBe(0);
    expect(outcome.phases.map((fase) => fase.outcome.status)).toEqual(["complete", "complete"]);
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
  });

  it("9: o registro de outro run, com o mesmo conteúdo, não autoriza nada", async () => {
    await projetoPublicado();
    await preparar();
    await registrar(join(root, ".capivara/runs/build-000000000000/preparation"), "environment-install-x", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    const head = await git(["rev-parse", "HEAD"]);
    const { outcome, install, engine } = await construir();
    expect(install).not.toHaveBeenCalled();
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    expect(outcome.errors.join("\n")).toContain("alterações não commitadas");
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
  });

  it.each([
    { caso: "com acesso de sistema", perguntar: false },
    { caso: "pela pergunta, que relê o plano numa segunda passada", perguntar: true },
  ])("a sessão que reescreve o próprio contrato não se autoriza, nem nesta execução nem na seguinte — $caso", async ({ perguntar }) => {
    await projetoPublicado();
    const head = await git(["rev-parse", "HEAD"]);
    const comAlheia = { ...DECLARADAS, "left-pad": "^1.3.0" };
    const instalar = async (): Promise<void> => {
      await preparar(JSON.stringify({ devDependencies: comAlheia }, null, 2), LOCK(comAlheia));
      const arquivo = join(root, ".capivara/init/environment.json");
      const ambiente = JSON.parse(await readFile(arquivo, "utf8"));
      ambiente.infrastructure.dependencies.push({ name: "left-pad", version: "", purpose: "…", basis: "…", kind: "dev" });
      await writeFile(arquivo, JSON.stringify(ambiente, null, 2) + "\n");
    };
    const primeira = await construir({ instalar, perguntar });
    expect(primeira.outcome.exitCode).toBe(1);
    expect(primeira.engine.chamadas).toHaveLength(0);
    expect(primeira.outcome.errors.join("\n")).toContain("`left-pad`");
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    // A execução seguinte lê o contrato da árvore reescrita, e o do commit não o tem.
    const segunda = await construir({ perguntar });
    expect(segunda.outcome.exitCode).toBe(1);
    expect(segunda.engine.chamadas).toHaveLength(0);
    expect(segunda.outcome.errors.join("\n")).toContain("lista `left-pad`, que o do commit da HEAD não tem: só vale o que está nos dois");
    // A ação não manda apagar e preparar de novo, que daria na mesma recusa: manda decidir sobre o contrato.
    expect(segunda.outcome.errors.join("\n")).toMatch(/Para continuar: se a mudança no contrato da árvore é sua[^\n]*commite a especificação em `\.capivara\/init`/u);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
  });

  it("o contrato que o change reescreveu sem commitar, com a mesma infraestrutura, continua autorizando", async () => {
    await projetoPublicado();
    const arquivo = join(root, ".capivara/init/environment.json");
    const ambiente = JSON.parse(await readFile(arquivo, "utf8"));
    await writeFile(arquivo, JSON.stringify({ ...ambiente, harnessVersion: "0.7.10" }, null, 2) + "\n");
    expect((await autoridadePublicada(root, SONDAS)).dependencias).toEqual(CONTRATO);
    const { outcome } = await construir();
    expect(outcome.exitCode).toBe(0);
  });

  it("a especificação nunca versionada não tem com que comparar: vale a árvore, lida antes de qualquer sessão", async () => {
    await projetoPublicado();
    await git(["rm", "-q", "--cached", ".capivara/init/environment.json"]);
    await git(["commit", "-qm", "sem o metadado no histórico"]);
    expect((await autoridadePublicada(root, SONDAS)).dependencias).toEqual(CONTRATO);
  });

  it.each([
    { caso: "com acesso de sistema", perguntar: false },
    { caso: "pela pergunta, que relê o plano numa segunda passada", perguntar: true },
  ])("a sessão que acrescenta uma sonda com o require da dependência não se autoriza na execução em que roda — $caso", async ({ perguntar }) => {
    await projetoPublicado();
    const head = await git(["rev-parse", "HEAD"]);
    const comAlheia = { ...DECLARADAS, "left-pad": "^1.3.0" };
    const { outcome, engine } = await construir({ perguntar, instalar: async () => {
      await preparar(JSON.stringify({ devDependencies: comAlheia }, null, 2), LOCK(comAlheia));
      await pacote("left-pad", "1.3.0");
      const arquivo = join(root, ".capivara/init/environment.json");
      const ambiente = JSON.parse(await readFile(arquivo, "utf8"));
      ambiente.requirements.push({ technology: "Pad", binary: "node", systemLevel: false, checkArgs: ["-e", "require('left-pad')"] });
      await writeFile(arquivo, JSON.stringify(ambiente, null, 2) + "\n");
    } });
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(outcome.errors.join("\n")).toContain("sonda que nomeia `left-pad`, e essa sonda não estava nele quando o build o leu, antes de qualquer sessão desta execução: não vale nesta execução, e na próxima passa a valer");
    expect(outcome.errors.join("\n")).toContain("se a mudança não é sua, desfaça-a antes de rodar de novo");
  });

  it("14: a sonda que o change escreveu sem commitar continua autorizando o pacote dela, como na 0.7.9", async () => {
    await projetoPublicado({ dependencies: [{ name: "vite", version: "", purpose: "…", basis: "…", kind: "dev" }] });
    // No commit, só a sonda do Vite; o change refaz as sondas a partir do esqueleto, acrescenta a do Chromium e não commita.
    const arquivo = join(root, ".capivara/init/environment.json");
    const ambiente = JSON.parse(await readFile(arquivo, "utf8"));
    await writeFile(arquivo, JSON.stringify({ ...ambiente, requirements: [VITE] }, null, 2) + "\n");
    await git(["commit", "-qam", "especificação com uma sonda"]);
    await writeFile(arquivo, JSON.stringify({ ...ambiente, requirements: [VITE, CHROMIUM] }, null, 2) + "\n");
    const autoridade = await autoridadePublicada(root, SONDAS);
    expect(autoridade.requisitos).toEqual(SONDAS);
    expect(autoridade.dependencias).toEqual(["vite"]);
    // `@playwright/test` só a sonda nova nomeia; `@vitejs/plugin-react` fica de fora do manifesto.
    const declaradas = { "@playwright/test": "^1.64.1", vite: "^8.3.5" };
    await preparar(JSON.stringify({ devDependencies: declaradas }, null, 2), LOCK(declaradas));
    expect(await adoptPreparedDependencies(root, autoridade.requisitos, await atestar(), autoridade.dependencias)).toBe(true);
  });



  it("especificação nunca versionada: o nome que a sessão acrescentou não vale, e a explicação não fala de um commit que não existe", async () => {
    await projetoPublicado();
    await git(["rm", "-q", "--cached", ".capivara/init/environment.json"]);
    await git(["commit", "-qm", "sem o metadado no histórico"]);
    const comAlheia = { ...DECLARADAS, "left-pad": "^1.3.0" };
    const { outcome } = await construir({ perguntar: true, instalar: async () => {
      await preparar(JSON.stringify({ devDependencies: comAlheia }, null, 2), LOCK(comAlheia));
      const arquivo = join(root, ".capivara/init/environment.json");
      const ambiente = JSON.parse(await readFile(arquivo, "utf8"));
      ambiente.infrastructure.dependencies.push({ name: "left-pad", version: "", purpose: "…", basis: "…", kind: "dev" });
      await writeFile(arquivo, JSON.stringify(ambiente, null, 2) + "\n");
    } });
    expect(outcome.exitCode).toBe(1);
    const erros = outcome.errors.join("\n");
    expect(erros).toContain("lista `left-pad`, que não estava nele quando o build o leu");
    expect(erros).not.toContain("commit da HEAD");
  });

  it("a sessão de preparação que commita é parada como as chamadas das fases (§101), e nada dela é adotado", async () => {
    await projetoPublicado();
    const head = await git(["rev-parse", "HEAD"]);
    const { outcome, engine } = await construir({ instalar: async () => {
      await preparar();
      await git(["add", "package.json", "package-lock.json"]);
      await git(["commit", "-qm", "a sessão commitou"]);
    } });
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    expect(outcome.errors.join("\n")).toContain("referências do Git mudaram durante a sessão de preparação");
    expect(outcome.errors.join("\n")).toContain("HEAD");
    expect((await git(["log", "--format=%s"])).split("\n")).not.toContain("chore(capivara): prepara dependências do ambiente");
    // O que ela fez não é desfeito: o commit dela fica, para o desenvolvedor decidir.
    expect(await git(["rev-parse", "HEAD~1"])).toBe(head);
  });

  it("a ação sobre o contrato só aparece quando é ele que recusa: a recusa por hash não manda commitar a especificação", async () => {
    await projetoPublicado();
    const arquivo = join(root, ".capivara/init/environment.json");
    const ambiente = JSON.parse(await readFile(arquivo, "utf8"));
    ambiente.infrastructure.dependencies.push({ name: "zod", version: "", purpose: "…", basis: "…", kind: "app" });
    await writeFile(arquivo, JSON.stringify(ambiente, null, 2) + "\n");
    await preparar();
    const pasta = PREPARACAO();
    await registrar(pasta, "environment-install-a", { status: "complete", pendentesAntes: [], criados: await criadosAgora(), response: { exitCode: 0 } });
    await writeFile(join(root, "package.json"), MANIFESTO.replace("^8.3.5", "^8.3.6"));
    const autoridade = await autoridadePublicada(root, SONDAS);
    const motivo = (await explicarPreparacaoNaoAdotada(root, pasta, autoridade))!;
    expect(motivo).toContain("lista `zod`, que o do commit da HEAD não tem");
    expect(motivo).toContain("mudou depois da sessão");
    expect(motivo).not.toContain("commite a especificação");
  });

  it("14: plano sem contrato de infraestrutura segue a regra das sondas, como antes", async () => {
    await projetoPublicado(null);
    const { outcome, engine } = await construir();
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    expect(outcome.errors.join("\n")).toContain("o Core não pôde adotar");
    // O motivo é o exato: as dependências que nada autoriza, e não a lista de hipóteses.
    expect(outcome.errors.join("\n")).toContain("@vitejs/plugin-react");
  });
});
