/**
 * O commit automático publica exatamente a árvore que a admissão conferiu (§101).
 *
 * Com Git de verdade: o disco muda depois do `add`, o HEAD muda no meio do
 * commit, e um commit com arquivo sensível chega à integração por fora.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { admitirIntervalo, commitAdmitido } from "../../src/loop/admissao.js";

const run = promisify(execFile);
const CHAVE_PRIVADA = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANsegredo\n-----END PRIVATE KEY-----\n";

let raiz: string;

async function git(args: string[]): Promise<string> {
  return (await run("git", args, { cwd: raiz })).stdout.trim();
}

async function escrever(caminho: string, conteudo: string): Promise<void> {
  await mkdir(join(raiz, caminho, ".."), { recursive: true });
  await writeFile(join(raiz, caminho), conteudo, "utf8");
}

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "capivara-commit-admitido-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await escrever("README.md", "inicial\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "inicial"]);
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("commitAdmitido", () => {
  it.each(["server/dist/index.js", "node_modules/pkg/index.js", "server/dist/file [1]*.js"])("preserva alteração em %s já versionado quando um novo gitignore passa a ignorá-lo", async tracked => {
    await escrever(tracked, "versão anterior\n");
    await escrever("server/dist/removido.js", "remover depois\n");
    await git(["add", "-A"]);
    await git(["commit", "-qm", "artefatos já versionados"]);
    await escrever(".gitignore", "node_modules\ndist\n");
    await escrever(tracked, "alteração a preservar\n");
    await rm(join(raiz, "server/dist/removido.js"));
    await escrever("server/dist/ignorado-novo.js", "não incluir\n");
    await escrever("src/app.ts", "export const app = 1;\n");
    await escrever("outro.txt", "preparado pelo usuário\n");
    await git(["add", "outro.txt"]);

    const result = await commitAdmitido(raiz, {
      caminhos: [tracked, "server/dist/removido.js", ".gitignore", "src/app.ts"], mensagem: "recuperação",
    });

    expect(result.status).toBe("commitado");
    expect(await git(["show", `HEAD:${tracked}`])).toBe("alteração a preservar");
    expect(await git(["show", "HEAD:src/app.ts"])).toBe("export const app = 1;");
    await expect(git(["cat-file", "-e", "HEAD:server/dist/removido.js"])).rejects.toThrow();
    await expect(git(["cat-file", "-e", "HEAD:server/dist/ignorado-novo.js"])).rejects.toThrow();
    expect(await readFile(join(raiz, "server/dist/ignorado-novo.js"), "utf8")).toBe("não incluir\n");
    expect(await git(["diff", "--cached", "--name-only"])).toBe("outro.txt");
  });

  it("não força arquivo novo ignorado, mesmo preparado no índice do usuário", async () => {
    await escrever(".gitignore", "dist\n");
    await escrever("dist/novo.js", "novo ignorado\n");
    await git(["add", "-f", "dist/novo.js"]);
    const head = await git(["rev-parse", "HEAD"]);
    const index = await git(["write-tree"]);
    await expect(commitAdmitido(raiz, { caminhos: ["dist/novo.js"], mensagem: "não deve publicar" })).rejects.toThrow();
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await git(["write-tree"])).toBe(index);
    expect(await readFile(join(raiz, "dist/novo.js"), "utf8")).toBe("novo ignorado\n");
  });

  it("vale o conteúdo PREPARADO, não o do disco: a chave que entrou no índice bloqueia, mesmo com o disco já limpo", async () => {
    await escrever("config/app.txt", CHAVE_PRIVADA);
    const resultado = await commitAdmitido(raiz, {
      caminhos: ["config/app.txt"],
      mensagem: "feat(phase-1): Fundação",
      // Depois do `add`, o disco volta a parecer inocente — uma conferência do disco aprovaria.
      depoisDoAdd: () => escrever("config/app.txt", "porta=3000\n"),
    });

    expect(resultado.status).toBe("bloqueado");
    expect(await git(["log", "--format=%s"])).toBe("inicial");
    expect(await git(["log", "--all", "-p", "--format=%H"])).not.toContain("PRIVATE KEY");
    // O disco não foi tocado pelo bloqueio.
    expect(await readFile(join(raiz, "config", "app.txt"), "utf8")).toBe("porta=3000\n");
  });

  it("o disco que muda depois do add não muda o commit: publica-se a árvore conferida", async () => {
    await escrever("src/app.ts", "export const app = 1;\n");
    const resultado = await commitAdmitido(raiz, {
      caminhos: ["src/app.ts"],
      mensagem: "feat(phase-1): Fundação",
      depoisDoAdd: () => escrever("src/app.ts", CHAVE_PRIVADA),
    });

    expect(resultado.status).toBe("commitado");
    expect(await git(["show", "HEAD:src/app.ts"])).toBe("export const app = 1;");
  });

  it("HEAD que muda no meio: nada é publicado por cima, e o commit de quem mudou fica", async () => {
    await escrever("src/app.ts", "export const app = 1;\n");
    const tentativa = commitAdmitido(raiz, {
      caminhos: ["src/app.ts"],
      mensagem: "feat(phase-1): Fundação",
      depoisDoAdd: async () => {
        await git(["commit", "-q", "--allow-empty", "-m", "outro, no meio"]);
      },
    });

    await expect(tentativa).rejects.toThrow();
    expect((await git(["log", "--format=%s"])).split("\n")).toEqual(["outro, no meio", "inicial"]);
  });

  it("o índice de quem chamou: só os caminhos commitados mudam; o resto preparado continua preparado", async () => {
    await escrever("outro.txt", "preparado por alguém\n");
    await git(["add", "outro.txt"]);
    await escrever("src/app.ts", "export const app = 1;\n");

    const resultado = await commitAdmitido(raiz, { caminhos: ["src/app.ts"], mensagem: "feat(phase-1): Fundação" });

    expect(resultado.status).toBe("commitado");
    expect((await git(["show", "--name-only", "--format=", "HEAD"])).split("\n")).toEqual(["src/app.ts"]);
    expect(await git(["diff", "--cached", "--name-only"])).toBe("outro.txt");
    expect(await git(["status", "--porcelain", "--", "src/app.ts"])).toBe("");
  });
});

describe("admitirIntervalo — a segunda barreira da integração", () => {
  it("um commit com .env, feito por fora da Capivara, é bloqueado pelos objetos do Git", async () => {
    const base = await git(["rev-parse", "HEAD"]);
    await git(["switch", "-q", "-c", "fase"]);
    await escrever(".env", "SENHA=valor-real\n");
    await escrever("src/app.ts", "export const app = 1;\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "do agente"]);
    // O disco pode até não ter mais o arquivo: o que conta é o objeto.
    await rm(join(raiz, ".env"));

    const bloqueios = await admitirIntervalo(raiz, base, "fase");
    expect(bloqueios.map((bloqueio) => bloqueio.caminho)).toEqual([".env"]);
    expect(JSON.stringify(bloqueios)).not.toContain("valor-real");
  });
});
