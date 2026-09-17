/**
 * Os quatro gates.
 *
 * Uma fase nunca fecha por afirmação do agente. Fecha quando quatro verificações
 * mecânicas ficam verdes, e uma delas roda fora da sessão dele.
 *
 * G0 — o engine terminou de verdade
 * G1 — a sessão escreveu código (SINAL, não veredito)
 * G2 — a suíte do projeto, rodada PELO LOOP
 * G3 — verificador independente, read-only, task a task
 */

import { execFile } from "node:child_process";
import { BUILDER_COMPLETE_MARKER, parseVerification } from "../prompts/index.js";

export type GateName = "gate 0 — engine" | "gate 1 — escrita" | "gate 2 — suíte do projeto" | "gate 3 — verificação independente";

export type GateResult =
  | { green: true }
  | { green: false; gate: GateName; cause: string; toolMissing?: boolean };

const green: GateResult = { green: true };

/** G0 — o processo terminou de verdade, e não por morte ou erro estrutural. */
export function gate0(result: { exitCode: number; stdout: string; stderr: string; timedOut: string | null }, engine: string): GateResult {
  if (result.timedOut) {
    return { green: false, gate: "gate 0 — engine", cause: `o engine estourou o timeout (${result.timedOut}). Últimas linhas:\n${tail(result.stdout || result.stderr)}` };
  }
  if (engine === "claude" && !/"type"\s*:\s*"result"/.test(result.stdout)) {
    return { green: false, gate: "gate 0 — engine", cause: `o engine terminou sem emitir um resultado. Últimas linhas:\n${tail(result.stdout)}` };
  }
  if (engine === "claude" && /"is_error"\s*:\s*true/.test(result.stdout)) {
    return { green: false, gate: "gate 0 — engine", cause: `o engine reportou is_error=true. Últimas linhas:\n${tail(result.stdout)}` };
  }
  if (result.exitCode !== 0) {
    return { green: false, gate: "gate 0 — engine", cause: `o engine saiu com código ${result.exitCode}. Últimas linhas:\n${tail(result.stdout || result.stderr)}` };
  }
  return green;
}

/** O executor declarou conclusão? Informação, não gate: G3 é quem decide. */
export function declaredComplete(stdout: string): boolean {
  return stdout.includes(BUILDER_COMPLETE_MARKER);
}

/**
 * G1 — a sessão escreveu código?
 *
 * SINAL, não veredito. Uma fase já implementada faz o engine corretamente não
 * escrever nada, e reprovar aqui seria um falso negativo. O sinal alimenta a
 * causa do ciclo seguinte e força o gate 3.
 */
export function gate1(signatureBefore: string, signatureAfter: string): boolean {
  return signatureBefore !== signatureAfter;
}

export interface TestRun {
  exitCode: number;
  output: string;
}

export type TestRunner = (command: string, projectRoot: string) => Promise<TestRun>;

/** Roda a suíte com stdin fechado: um runner que anexa stdin travaria o loop. */
export const defaultTestRunner: TestRunner = async (command, projectRoot) =>
  new Promise((resolve) => {
    const child = execFile(
      "bash",
      ["-c", command],
      { cwd: projectRoot, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        resolve({ exitCode: code, output: `${stdout}${stderr}` });
      },
    );
    child.stdin?.end();
  });

/**
 * Código 127 é "comando não encontrado", não "teste falhou".
 *
 * São falhas de naturezas diferentes e exigem correções diferentes: uma pede
 * mudança de código, a outra pede instalar uma ferramenta. O piloto 2 queimou os
 * três ciclos porque recebia a causa genérica — o executor tem acesso de
 * sistema e podia ter instalado o pytest na primeira tentativa, mas nada dizia
 * isso a ele.
 */
function ferramentaAusente(exitCode: number, output: string): boolean {
  return exitCode === 127 || /command not found|comando n[ãa]o encontrado|No such file or directory/i.test(output);
}

/** G2 — a suíte do projeto, rodada PELO LOOP, fora da sessão do agente. */
export async function gate2(
  projectRoot: string,
  testCommand: string | null,
  runner: TestRunner = defaultTestRunner,
): Promise<GateResult & { skipped?: boolean }> {
  if (!testCommand) return { green: true, skipped: true };
  const result = await runner(testCommand, projectRoot);
  if (ferramentaAusente(result.exitCode, result.output)) {
    return {
      green: false,
      gate: "gate 2 — suíte do projeto",
      toolMissing: true,
      cause:
        `O runner de testes do projeto NÃO ESTÁ INSTALADO neste ambiente: '${testCommand}' terminou com código ` +
        `${result.exitCode}. Isto não é um teste vermelho — é uma ferramenta ausente, e a correção é instalá-la, ` +
        `não mexer no código nem trocar o runner. Você tem acesso de sistema: instale o runner declarado pelo ` +
        `projeto (por exemplo, criando e populando o ambiente do projeto, ou instalando o pacote correspondente) ` +
        `e garanta que '${testCommand}' passe a funcionar a partir da raiz do projeto. Saída:\n${tail(result.output, 60)}`,
    };
  }

  if (result.exitCode !== 0) {
    return {
      green: false,
      gate: "gate 2 — suíte do projeto",
      cause: `O comando de teste do projeto ('${testCommand}') falhou com código ${result.exitCode}. Saída:\n${tail(result.output, 200)}`,
    };
  }
  return green;
}

/** G3 — o verificador cobriu todas as tasks e nenhuma ficou incompleta. */
export function gate3(output: string, expectedTasks: number): GateResult {
  const verdicts = parseVerification(output);

  if (verdicts.length === 0) {
    return {
      green: false,
      gate: "gate 3 — verificação independente",
      cause: `O verificador independente não emitiu nenhuma linha 'TASK <n>: DONE|INCOMPLETE' — não foi possível confirmar que a fase está completa. Últimas linhas:\n${tail(output)}`,
    };
  }

  if (verdicts.length !== expectedTasks) {
    return {
      green: false,
      gate: "gate 3 — verificação independente",
      cause: `O verificador cobriu ${verdicts.length} de ${expectedTasks} tasks — cobertura incompleta. Linhas emitidas:\n${verdicts.map((verdict) => `TASK ${verdict.index}: ${verdict.done ? "DONE" : "INCOMPLETE"}`).join("\n")}`,
    };
  }

  const incomplete = verdicts.filter((verdict) => !verdict.done);
  if (incomplete.length > 0) {
    return {
      green: false,
      gate: "gate 3 — verificação independente",
      cause: `O verificador independente encontrou tasks incompletas:\n${incomplete.map((verdict) => `TASK ${verdict.index}: INCOMPLETE — ${verdict.missing}`).join("\n")}`,
    };
  }

  return green;
}

function tail(value: string, lines = 40): string {
  return value.split("\n").slice(-lines).join("\n").trim();
}
