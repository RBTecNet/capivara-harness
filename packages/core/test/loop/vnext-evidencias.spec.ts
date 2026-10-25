/**
 * BUILD vNext, checkpoint B (§125): evidências persistentes e mapa de impacto.
 *
 * Uma prova vale enquanto o que ela leu não mudou — documentos e conteúdo do
 * código. Estes cenários conferem o registro append-only (substituição sem
 * apagar, retomada depois de reabrir, linha truncada), a identidade de conteúdo
 * do código (estável num commit de WIP, cega ao plano de controle) e a
 * classificação determinística NONE / AFFECTED / UNKNOWN.
 */

import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tasksDaFase } from "../../src/loop/index.js";
import { LivroDeEvidencias, emptyScope, evidenciasDoRun, localizarArtefato, referenciaDeArtefato } from "../../src/loop/evidencias.js";
import { arquivosMudados, estadoDoCodigo } from "../../src/loop/git.js";
import { escopoDaTask, impactoNaSuite, impactoNaTask } from "../../src/loop/impacto.js";
import { MARCA_DO_HARNESS } from "../../src/loop/ambiente.js";

const run = promisify(execFile);
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-vnext-ev-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function repo(): Promise<void> {
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "t@t"], { cwd: root });
  await run("git", ["config", "user.name", "t"], { cwd: root });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, ".gitignore"), "node_modules/\n.env\n");
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-q", "-m", "inicial"], { cwd: root });
}

const PASS = (checkId: string, tree: string | null) => ({
  phaseId: "P01",
  gate: "G2" as const,
  checkId,
  claim: "a suíte do projeto passa",
  outcome: "PASS" as const,
  inputs: { documents: [{ name: "fase", sha12: "aaaaaaaaaaaa" }], code: { head: null, tree }, command: "npm test" },
  scope: emptyScope({ components: ["api"] }),
  supports: [],
  artifactRefs: [],
});

describe("o registro de evidências", () => {
  it("é append-only: a prova nova substitui a aplicabilidade da anterior sem apagá-la, e sobrevive a reabrir", async () => {
    const runRoot = join(root, ".capivara", "runs", "build-x");
    const livro = await LivroDeEvidencias.abrir(runRoot, "build-x");
    const primeira = await livro.registrar(PASS("suite", "t1"));
    const segunda = await livro.registrar({ ...PASS("suite", "t2"), outcome: "REPAIR_REQUIRED" });
    expect(primeira.evidenceId).toBe("P01.suite.1");
    expect(segunda.evidenceId).toBe("P01.suite.2");
    expect(livro.validadeDe(primeira.evidenceId)).toMatchObject({ state: "INVALIDATED", reason: "substituída por P01.suite.2" });
    expect(livro.atual("P01", "suite")?.evidence.outcome).toBe("REPAIR_REQUIRED");

    await livro.alterarValidade(segunda.evidenceId, "UNKNOWN", "reparo mudou src/a.ts", "reparo D1");
    const reaberto = await LivroDeEvidencias.abrir(runRoot, "build-x");
    expect(reaberto.historico().map((e) => e.evidenceId)).toEqual(["P01.suite.1", "P01.suite.2"]);
    expect(reaberto.validadeDe("P01.suite.1")?.state).toBe("INVALIDATED");
    expect(reaberto.validadeDe("P01.suite.2")).toMatchObject({ state: "UNKNOWN", event: "reparo D1" });
    const linhas = (await readFile(evidenciasDoRun(runRoot), "utf8")).trim().split("\n");
    expect(linhas.map((l) => (JSON.parse(l) as { kind: string }).kind)).toEqual(["evidence", "evidence", "validity", "validity"]);
  });

  it("uma linha truncada por queda não derruba o histórico anterior", async () => {
    const runRoot = join(root, "run");
    const livro = await LivroDeEvidencias.abrir(runRoot, "build-x");
    await livro.registrar(PASS("suite", "t1"));
    await appendFile(evidenciasDoRun(runRoot), '{"kind":"evidence","contract":"capivara-evid');
    const reaberto = await LivroDeEvidencias.abrir(runRoot, "build-x");
    expect(reaberto.historico()).toHaveLength(1);
    expect(reaberto.atual("P01", "suite")?.validity.state).toBe("VALID");
  });

  it("o artefato citado é achado depois de o log ir para attempts/, e só pelo mesmo conteúdo", async () => {
    const runRoot = join(root, "run");
    await mkdir(join(runRoot, "logs"), { recursive: true });
    await writeFile(join(runRoot, "logs", "P01.verify-1.log"), "TASK 1: DONE\n");
    const ref = (await referenciaDeArtefato(runRoot, "logs/P01.verify-1.log"))!;
    await mkdir(join(runRoot, "attempts", "2026-10-21T00-00-00-abcd1234"), { recursive: true });
    await run("mv", [join(runRoot, "logs"), join(runRoot, "attempts", "2026-10-21T00-00-00-abcd1234", "logs")]);
    expect(await localizarArtefato(runRoot, ref)).toBe(join(runRoot, "attempts", "2026-10-21T00-00-00-abcd1234", "logs", "P01.verify-1.log"));
    await mkdir(join(runRoot, "logs"), { recursive: true });
    await writeFile(join(runRoot, "logs", "P01.verify-1.log"), "outro conteúdo, mesmo nome\n");
    expect(await localizarArtefato(runRoot, ref)).toBe(join(runRoot, "attempts", "2026-10-21T00-00-00-abcd1234", "logs", "P01.verify-1.log"));
    expect(await localizarArtefato(runRoot, { ...ref, sha12: "000000000000" })).toBeNull();
  });
});

describe("o estado do código é conteúdo", () => {
  it("um commit de WIP não muda o estado; plano de controle e .env do harness também não; o produto muda", async () => {
    await repo();
    await writeFile(join(root, "src", "b.ts"), "export const b = 2;\n");
    const sujo = await estadoDoCodigo(root);
    await run("git", ["add", "-A"], { cwd: root });
    await run("git", ["commit", "-q", "-m", "wip: trabalho parcial"], { cwd: root });
    const commitado = await estadoDoCodigo(root);
    expect(commitado.tree).toBe(sujo.tree);
    expect(commitado.head).not.toBe(sujo.head);

    await mkdir(join(root, ".capivara", "flows"), { recursive: true });
    await writeFile(join(root, ".capivara", "flows", "workflow-1.spec.ts"), "// roteiro\n");
    await writeFile(join(root, ".env"), `${MARCA_DO_HARNESS}\nDATABASE_URL=file:./dev.db\n`);
    expect((await estadoDoCodigo(root)).tree).toBe(sujo.tree);

    await writeFile(join(root, "src", "a.ts"), "export const a = 3;\n");
    const depois = await estadoDoCodigo(root);
    expect(depois.tree).not.toBe(sujo.tree);
    expect(await arquivosMudados(root, sujo.tree, depois.tree)).toEqual(["src/a.ts"]);
    expect(await arquivosMudados(root, sujo.tree, sujo.tree)).toEqual([]);
    // O índice de quem chamou não foi tocado.
    expect((await run("git", ["diff", "--cached", "--name-only"], { cwd: root })).stdout.trim()).toBe("");
  });

  it("sem Git, igualdade ainda vale e o que mudou é desconhecido", async () => {
    await writeFile(join(root, "a.txt"), "1");
    const antes = await estadoDoCodigo(root);
    expect(antes.tree?.startsWith("sem-git:")).toBe(true);
    expect((await estadoDoCodigo(root)).tree).toBe(antes.tree);
    await writeFile(join(root, "a.txt"), "2");
    const depois = await estadoDoCodigo(root);
    expect(depois.tree).not.toBe(antes.tree);
    expect(await arquivosMudados(root, antes.tree, depois.tree)).toBeNull();
  });

});

describe("o impacto de uma mudança", () => {
  const FASE = `## Phase 1: Reservas

**Goal:** criar reservas · **Depends on:** none · **Covers:** reservations

- [ ] **Task:** Implementar POST /reservas em \`src/api/reservas.ts\`
  - **Acceptance criteria:**
    - A rota devolve 201
  - **Traces:** reservations

- [ ] **Task:** Semear os status
  - **Acceptance criteria:**
    - Os três status existem
  - **Traces:** statuses
`;

  it("a suíte é atingida por qualquer arquivo; o mesmo conteúdo não atinge nada (§13 item 1)", () => {
    expect(impactoNaSuite([]).impacto).toBe("NONE");
    expect(impactoNaSuite(["src/x.ts"]).impacto).toBe("AFFECTED");
    expect(impactoNaSuite(null).impacto).toBe("UNKNOWN");
  });

  it("a task é atingida pelo que cita ou pelo que a arquitetura fixa; o resto fica desconhecido, nunca aprovado", () => {
    const [primeira, segunda] = tasksDaFase(FASE);
    expect(impactoNaTask(["src/api/reservas.ts"], escopoDaTask(primeira!)).impacto).toBe("AFFECTED");
    const outra = impactoNaTask(["src/api/reservas.ts"], escopoDaTask(segunda!));
    expect(outra.impacto).toBe("UNKNOWN");
    expect(outra.motivo).toContain("src/api/reservas.ts");
    expect(impactoNaTask(["src/db.ts"], escopoDaTask(segunda!, ["src/db.ts"])).impacto).toBe("AFFECTED");
    expect(impactoNaTask([], escopoDaTask(segunda!)).impacto).toBe("NONE");
  });

});
