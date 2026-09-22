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
 * G4 — os fluxos declarados, percorridos na aplicação de pé (ver flows.ts)
 */

import { execFile } from "node:child_process";
import { BUILDER_COMPLETE_MARKER, parseVerification } from "../prompts/index.js";

export type GateName =
  | "gate 0 — engine"
  | "gate 1 — escrita"
  | "gate 2 — suíte do projeto"
  | "gate 3 — verificação independente"
  | "gate 4 — fluxos na aplicação";

export type GateResult =
  | { green: true }
  | { green: false; gate: GateName; cause: string; toolMissing?: boolean };

const green: GateResult = { green: true };

/**
 * G0 — o processo terminou de verdade, e não por morte ou erro estrutural.
 *
 * Quem lê o envelope da CLI é a ponte, e é ela quem diz aqui se houve resultado.
 * Este gate já tentou descobrir o mesmo fato por regex sobre o stdout, e a regex
 * procurava o envelope num texto de onde a ponte já o tinha retirado: toda volta
 * BEM-SUCEDIDA do claude era reprovada, e só as que falhavam passavam no teste —
 * porque aí o texto cru voltava inteiro. O `cron5` morreu assim, com o executor
 * entregando a fase 1 completa três vezes seguidas.
 *
 * O fato também não é do claude: qualquer CLI com envelope pode terminar sem
 * resultado. Perguntar pelo fato, e não pelo nome do provider, cobre todas.
 */
export function gate0(
  result: { exitCode: number; stdout: string; stderr: string; timedOut: string | null; resultRead?: boolean; engineError?: boolean },
  engine: string,
): GateResult {
  if (result.timedOut) {
    return { green: false, gate: "gate 0 — engine", cause: `${explicarTimeout(result.timedOut, engine)} Últimas linhas:\n${tail(result.stdout || result.stderr)}` };
  }
  if (result.engineError === true) {
    return { green: false, gate: "gate 0 — engine", cause: `o engine ${engine} reportou a volta como erro. Últimas linhas:\n${tail(result.stdout)}` };
  }
  if (result.resultRead === false) {
    return { green: false, gate: "gate 0 — engine", cause: `o engine ${engine} terminou sem emitir um resultado. Últimas linhas:\n${tail(result.stdout)}` };
  }
  if (result.exitCode !== 0) {
    return { green: false, gate: "gate 0 — engine", cause: `o engine saiu com código ${result.exitCode}. Últimas linhas:\n${tail(result.stdout || result.stderr)}` };
  }
  return green;
}

/**
 * O que o timeout quer dizer — e de quem é o defeito.
 *
 * "estourou o timeout (first-output)" não diz nada a quem lê o log às três da
 * manhã, e o pior: soa como defeito do código. Nenhum dos três é. O limite é do
 * harness, e a frase precisa dizer isso (§34.8), senão o ciclo seguinte manda o
 * executor consertar o que não está quebrado.
 */
function explicarTimeout(kind: string, engine: string): string {
  if (kind === "first-output") {
    return `o engine ${engine} foi encerrado por não escrever nada dentro do limite de primeira saída (first-output) — é limite do harness, não defeito do produto.`;
  }
  if (kind === "idle") {
    return `o engine ${engine} parou de produzir saída e foi encerrado por inatividade (idle) — é limite do harness, não defeito do produto.`;
  }
  if (kind === "wall") {
    return `a chamada ao engine ${engine} passou do tempo máximo (wall) e foi encerrada — é limite do harness, não defeito do produto.`;
  }
  return `o engine ${engine} foi encerrado por um limite do harness (${kind}), não por defeito do produto.`;
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
  systemInstall = false,
): Promise<GateResult & { skipped?: boolean }> {
  if (!testCommand) return { green: true, skipped: true };
  const result = await runner(testCommand, projectRoot);
  if (ferramentaAusente(result.exitCode, result.output)) {
    /*
     * A instrução tem de caber no que o executor pode fazer.
     *
     * Ela dizia "você tem acesso de sistema" sempre, inclusive rodando com
     * `--no-system-install`. O executor então tentava instalar fora do projeto,
     * era negado, e gastava o ciclo seguindo uma ordem impossível — três
     * executores do piloto 6 queimaram a fase 1 assim.
     */
    const comoInstalar = systemInstall
      ? "Você tem acesso de sistema: instale o runner declarado pelo projeto, " +
        "por exemplo criando e populando o ambiente do projeto ou instalando o pacote correspondente."
      : "Você NÃO tem acesso de sistema neste run: instale o runner como dependência DO PROJETO, " +
        "dentro desta pasta (por exemplo `npm install -D <runner>`, ou o equivalente do gerenciador que o " +
        "projeto usa), e deixe-o declarado no manifesto. Não tente instalar nada fora do projeto.";

    return {
      green: false,
      gate: "gate 2 — suíte do projeto",
      toolMissing: true,
      cause:
        `O runner de testes do projeto NÃO ESTÁ INSTALADO neste ambiente: '${testCommand}' terminou com código ` +
        `${result.exitCode}. Isto não é um teste vermelho — é uma ferramenta ausente, e a correção é instalá-la, ` +
        `não mexer no código nem trocar o runner. ${comoInstalar} ` +
        `Garanta que '${testCommand}' passe a funcionar a partir da raiz do projeto. Saída:\n${tail(result.output, 60)}`,
    };
  }

  if (result.exitCode !== 0) {
    return {
      green: false,
      gate: "gate 2 — suíte do projeto",
      cause:
        `O comando de teste do projeto ('${testCommand}') falhou com código ${result.exitCode}.` +
        `${raizComum(result.output)} Saída:\n${tail(result.output, 200)}`,
    };
  }
  return green;
}

/**
 * Quando muitas falhas têm a MESMA mensagem, dizê-lo antes da saída bruta.
 *
 * Quinze testes vermelhos parecem quinze problemas. No piloto 6 eram um só —
 * `localStorage.clear is not a function` em todos, um ambiente de teste mal
 * configurado —, e o executor gastou cinco ciclos tratando sintoma. A saída
 * completa continua logo abaixo; o que muda é a primeira coisa que ele lê.
 *
 * A regra é conservadora de propósito: só fala quando há pelo menos três falhas e
 * a mesma mensagem responde por dois terços delas. Abaixo disso, apontar uma
 * "causa comum" seria palpite.
 */
export function raizComum(output: string): string {
  const mensagens = [...output.matchAll(/^\s*(?:→|Error:|AssertionError:)\s*(\S.*)$/gm)]
    .map((match) => (match[1] ?? "").trim())
    .filter((mensagem) => mensagem !== "");
  if (mensagens.length < 3) return "";

  const contagem = new Map<string, number>();
  for (const mensagem of mensagens) contagem.set(mensagem, (contagem.get(mensagem) ?? 0) + 1);

  const [maior, vezes] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (vezes < 3 || vezes / mensagens.length < 2 / 3) return "";

  return (
    ` ATENÇÃO: ${vezes} das ${mensagens.length} falhas trazem a MESMA mensagem — "${maior}". ` +
    "Uma causa única repetida em testes que verificam coisas diferentes costuma ser configuração do ambiente " +
    "de teste, não defeito de lógica. Verifique o setup do runner antes de mexer no código de produto."
  );
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
