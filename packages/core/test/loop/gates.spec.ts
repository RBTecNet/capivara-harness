import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitPhase,
  detectRateLimit,
  gate0,
  gate1,
  gate2,
  gate3,
  isRepository,
  planWait,
  treeSignature,
} from "../../src/loop/index.js";

const run = promisify(execFile);
let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-gates-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const engineOk = { exitCode: 0, stdout: "pronto", stderr: "", timedOut: null };

describe("G0 — o engine terminou de verdade", () => {
  it("aceita saída limpa", () => {
    expect(gate0(engineOk, "codex").green).toBe(true);
  });

  it("reprova exit code diferente de zero com a saída real", () => {
    const result = gate0({ ...engineOk, exitCode: 2, stdout: "erro de compilação" }, "codex");
    expect(result.green).toBe(false);
    if (!result.green) expect(result.cause).toContain("erro de compilação");
  });

  /*
   * "estourou o timeout (first-output)" não diz nada a quem lê o log de
   * madrugada, e soa como defeito do código. Nenhum dos três limites é: são do
   * harness, e a causa precisa dizer isso — senão o ciclo seguinte manda o
   * executor consertar o que não está quebrado (§34.8).
   */
  it("reprova timeout dizendo o que aconteceu e de quem é o defeito", () => {
    const parado = gate0({ ...engineOk, timedOut: "idle" }, "codex");
    if (parado.green) throw new Error("deveria reprovar");
    expect(parado.cause).toContain("parou de produzir");
    expect(parado.cause).toContain("não defeito do produto");

    const calado = gate0({ ...engineOk, timedOut: "first-output" }, "claude");
    if (calado.green) throw new Error("deveria reprovar");
    expect(calado.cause).toContain("não escrever nada");
    expect(calado.cause).toContain("limite do harness");

    const longa = gate0({ ...engineOk, timedOut: "wall" }, "claude");
    if (longa.green) throw new Error("deveria reprovar");
    expect(longa.cause).toContain("passou do tempo máximo");
  });

  /*
   * O teste antigo alimentava o gate com o envelope cru do claude — exatamente o
   * que a produção nunca entrega, porque a ponte desembrulha antes. Ele ficou
   * verde enquanto o build travava em toda volta bem-sucedida.
   */
  it("julga pelo resultado lido, não pelo nome do provider", () => {
    expect(gate0({ ...engineOk, stdout: "a fase está pronta", resultRead: true }, "claude").green).toBe(true);
    expect(gate0({ ...engineOk, resultRead: false }, "claude").green).toBe(false);
    expect(gate0({ ...engineOk, resultRead: false }, "opencode").green).toBe(false);
    // Texto puro, sem envelope: o gate 0 continua julgando pelo código de saída.
    expect(gate0(engineOk, "claude").green).toBe(true);
  });

  it("separa a CLI que falhou da CLI que não respondeu", () => {
    const erro = gate0({ ...engineOk, resultRead: false, engineError: true }, "claude");
    if (erro.green) throw new Error("deveria reprovar");
    expect(erro.cause).toContain("reportou a volta como erro");

    const mudo = gate0({ ...engineOk, resultRead: false }, "claude");
    if (mudo.green) throw new Error("deveria reprovar");
    expect(mudo.cause).toContain("sem emitir um resultado");
  });
});

describe("G1 — sinal, não veredito", () => {
  it("detecta que a árvore mudou", async () => {
    const before = await treeSignature(projectRoot);
    await writeFile(join(projectRoot, "novo.ts"), "export const x = 1;", "utf8");
    expect(gate1(before, await treeSignature(projectRoot))).toBe(true);
  });

  it("árvore intacta devolve falso, e isso NÃO reprova a fase sozinho", async () => {
    await writeFile(join(projectRoot, "a.ts"), "x", "utf8");
    const before = await treeSignature(projectRoot);
    expect(gate1(before, await treeSignature(projectRoot))).toBe(false);
  });

  it("funciona sem repositório Git", async () => {
    expect(await isRepository(projectRoot)).toBe(false);
    expect((await treeSignature(projectRoot)).length).toBe(16);
  });

  it("funciona dentro de um repositório Git", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "a.ts"), "x", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const before = await treeSignature(projectRoot);
    await writeFile(join(projectRoot, "b.ts"), "y", "utf8");
    expect(gate1(before, await treeSignature(projectRoot))).toBe(true);
  });

  it("ignora .capivara sem git: o plano de controle não conta como trabalho", async () => {
    const before = await treeSignature(projectRoot);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, ".capivara", "runs"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/runs/log.txt"), "evento", "utf8");
    expect(gate1(before, await treeSignature(projectRoot))).toBe(false);
  });

  it("ignora .capivara DENTRO de um repositório Git também", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const before = await treeSignature(projectRoot);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, ".capivara", "runs", "build-x", "prompts"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/runs/build-x/prompts/P01.txt"), "prompt inteiro", "utf8");
    expect(gate1(before, await treeSignature(projectRoot))).toBe(false);
  });

  it("o commit da fase nunca leva o plano de controle junto", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, ".capivara", "runs", "build-x"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/runs/build-x/events.tsv"), "evento", "utf8");
    await writeFile(join(projectRoot, "src.ts"), "export const x = 1;", "utf8");

    await commitPhase(projectRoot, 1, "Fundação");
    const { stdout } = await run("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: projectRoot });
    expect(stdout).toContain("src.ts");
    expect(stdout).not.toContain(".capivara");
  });
});

describe("G2 — a suíte roda fora da sessão do agente", () => {
  it("verde quando o comando sai com zero", async () => {
    const result = await gate2(projectRoot, "npm test", async () => ({ exitCode: 0, output: "3 passed" }));
    expect(result.green).toBe(true);
  });

  it("reprova com a saída real da suíte, nunca 'os testes falharam'", async () => {
    const result = await gate2(projectRoot, "npm test", async () => ({ exitCode: 1, output: "FAIL reserva.spec.ts\n  esperava 409, recebeu 500" }));
    if (result.green) throw new Error("deveria reprovar");
    expect(result.cause).toContain("esperava 409, recebeu 500");
    expect(result.cause).toContain("npm test");
  });

  it("código 127 é ferramenta ausente, não suíte vermelha", async () => {
    const result = await gate2(projectRoot, "pytest", async () => ({
      exitCode: 127,
      output: "bash: linha 1: pytest: comando não encontrado",
    }));
    if (result.green) throw new Error("deveria reprovar");
    expect((result as { toolMissing?: boolean }).toolMissing).toBe(true);
    expect(result.cause).toContain("NÃO ESTÁ INSTALADO");
    expect(result.cause).toContain("não é um teste vermelho");
    expect(result.cause).toContain("acesso de sistema");
  });

  it("reconhece a ferramenta ausente também pela saída, não só pelo código", async () => {
    const result = await gate2(projectRoot, "pytest", async () => ({
      exitCode: 1,
      output: "pytest: command not found",
    }));
    if (result.green) throw new Error("deveria reprovar");
    expect((result as { toolMissing?: boolean }).toolMissing).toBe(true);
  });

  it("suíte vermelha de verdade não é confundida com ferramenta ausente", async () => {
    const result = await gate2(projectRoot, "pytest", async () => ({
      exitCode: 1,
      output: "FAILED test_resumo.py::test_total - assert 10 == 11",
    }));
    if (result.green) throw new Error("deveria reprovar");
    expect((result as { toolMissing?: boolean }).toolMissing).toBeUndefined();
    expect(result.cause).toContain("assert 10 == 11");
  });

  it("sem comando resolvido, é pulado e marcado como tal", async () => {
    const result = await gate2(projectRoot, null);
    expect(result.green).toBe(true);
    expect((result as { skipped?: boolean }).skipped).toBe(true);
  });

  it("o runner real fecha o stdin — um runner que o consome travaria o loop", async () => {
    const result = await gate2(projectRoot, "cat; echo fim");
    expect(result.green).toBe(true);
  }, 10000);
});

describe("G3 — verificação task a task", () => {
  it("verde quando todas as tasks estão DONE", () => {
    expect(gate3("TASK 1: DONE\nTASK 2: DONE", 2).green).toBe(true);
  });

  it("reprova cobertura parcial", () => {
    const result = gate3("TASK 1: DONE", 3);
    if (result.green) throw new Error("deveria reprovar");
    expect(result.cause).toContain("cobriu 1 de 3");
  });

  it("reprova quando alguma task está INCOMPLETE, dizendo o que falta", () => {
    const result = gate3("TASK 1: DONE\nTASK 2: INCOMPLETE — falta o teste de sobreposição", 2);
    if (result.green) throw new Error("deveria reprovar");
    expect(result.cause).toContain("falta o teste de sobreposição");
  });

  it("reprova quando o verificador não emitiu nenhuma linha TASK", () => {
    const result = gate3("Acho que está tudo certo!", 2);
    if (result.green) throw new Error("deveria reprovar");
    expect(result.cause).toContain("não emitiu nenhuma linha");
  });
});

describe("limite de uso", () => {
  it("detecta no fim do log", () => {
    expect(detectRateLimit("trabalhando...\nusage limit reached", "claude")).not.toBeNull();
  });

  it("um 429 na saída de teste NÃO dispara espera", () => {
    const log = ["FAIL http.spec.ts", "  esperava 200, recebeu 429 Too Many Requests", ...Array(30).fill("ok"), "pronto"].join("\n");
    expect(detectRateLimit(log, "codex")).toBeNull();
  });

  it("lê o horário de reset quando informado", () => {
    const limit = detectRateLimit("usage limit reached 1789000000", "claude");
    expect(limit?.resetAt).toBe(1789000000);
    expect(planWait(limit!, 1788999000 * 1000).seconds).toBeGreaterThan(1000);
  });

  it("sem horário, cai no padrão de meia hora", () => {
    const limit = detectRateLimit("rate limit reached", "codex");
    expect(planWait(limit!).seconds).toBe(1800);
  });
});

describe("commit por fase", () => {
  it("sem repositório, não commita e diz por quê", async () => {
    const result = await commitPhase(projectRoot, 1, "Fundação");
    expect(result).toMatchObject({ committed: false });
    expect(result.message).toContain("sem repositório");
  });

  it("com árvore suja, cria um commit por fase", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    await writeFile(join(projectRoot, "src.ts"), "export const x = 1;", "utf8");
    const result = await commitPhase(projectRoot, 2, "Cadastro");
    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(phase-2): Cadastro");

    const { stdout } = await run("git", ["log", "--format=%s", "-1"], { cwd: projectRoot });
    expect(stdout.trim()).toBe("feat(phase-2): Cadastro");
  });

  it("com árvore limpa, não commita: a fase já estava em HEAD", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const result = await commitPhase(projectRoot, 1, "Fundação");
    expect(result.committed).toBe(false);
    expect(result.message).toContain("já estava implementada");
  });
});

/**
 * O gate 1 nunca reprova.
 *
 * Ele pergunta se a sessão escreveu alguma coisa, e "não" é informação: numa
 * fase já implementada — o caso comum de todo build retomado e de todo `change`
 * — não escrever é o comportamento certo. Num run real do MCP_teste as três
 * primeiras fases fecharam inteiras com o G1 vermelho na tela, e quem olhou
 * leu isso como falha.
 */
describe("o que o gate 1 responde", () => {
  it("árvore igual antes e depois significa que a sessão não escreveu", () => {
    expect(gate1("abc", "abc")).toBe(false);
    expect(gate1("abc", "def")).toBe(true);
  });
});
