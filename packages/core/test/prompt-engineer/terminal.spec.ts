/** O usuário real: PTY, CLI, escritor falso lento e uma resposta digitada. */
import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUESTIONS_CONTRACT } from "../../src/interview/index.js";

const execute = promisify(execFile);
// O produto roda também no Windows. PTY é verificado onde a stdlib o oferece;
// não adicionamos uma biblioteca nativa só para exercitar o terminal em CI.
const hasPty = process.platform !== "win32"
  && spawnSync("python3", ["-c", "import pty, fcntl, termios"], { stdio: "ignore" }).status === 0;

const EMPTY_ANALYSIS = { contract: QUESTIONS_CONTRACT, questions: [], assumptions: [], omissions: [] };
const QUESTION_ANALYSIS = {
  ...EMPTY_ANALYSIS,
  questions: [{
    id: "Q-01", topic: "público", evidence: "O pedido não identifica quem opera as reservas.",
    decision: "Quem é o público inicial?", why: "Define os fluxos e o vocabulário da interface.",
    options: [
      { label: "Recepcionistas", consequence: "Priorizar a operação interna da pousada." },
      { label: "Hóspedes", consequence: "Priorizar reservas feitas pelo próprio hóspede." },
    ],
    recommended: "Recepcionistas", recommendationBasis: "O pedido descreve a operação da pousada.",
  }],
};
const LONG_ANALYSIS = {
  ...QUESTION_ANALYSIS,
  questions: QUESTION_ANALYSIS.questions.map((question) => ({
    ...question,
    evidence: Array.from({ length: 8 }, () => question.evidence).join("\n"),
    options: [...question.options,
      { label: "Gerentes", consequence: "Priorizar a visão de gestão da pousada, indicadores de ocupação e receita, com níveis de acesso e relatórios antes dos fluxos operacionais de reserva." },
      { label: "Agentes de viagem", consequence: "Priorizar reservas intermediadas por parceiros externos, com regras comerciais próprias e acompanhamento de disponibilidade antes da operação interna da pousada." },
    ],
  })),
};
const DRAFT = {
  contract: "capivara-prompt/v1", language: "en", objective: "Design a booking system for a small inn.",
  context: ["The inn currently manages room bookings manually."],
  requirements: ["Prevent overlapping bookings for the same room."],
  constraints: ["Preserve the user's explicit requirements."],
  steps: ["Describe the booking workflow and validate its edge cases."],
  acceptanceCriteria: ["Two bookings for the same room cannot overlap."],
  deliverables: ["A documented booking workflow with observable acceptance criteria."],
  confirmedDecisions: [{ id: "Q-01", statement: "Receptionists are the initial audience." }],
};

// Um PTY de verdade mantém isTTY e readline reais. A tecla é enviada só depois
// do campo abrir; espera-se mais de um pulso antes de enviar Enter para revelar
// qualquer redesenho que apague a pergunta ou o texto em edição.
const PTY_DRIVER = String.raw`
import codecs, fcntl, json, os, pty, re, select, struct, subprocess, sys, termios, time
rows, columns = int(sys.argv[1]), int(sys.argv[2])
wizard_answers, wizard_output, wizard_frames = json.loads(sys.argv[3]), "", 1
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
question_pattern = sys.argv[4]
process = subprocess.Popen(sys.argv[5:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
decoder = codecs.getincrementaldecoder("utf-8")("replace")
output, before, typing, after = "", "", "", ""
typed_at, submitted_at, question_found = None, None, False
deadline = time.monotonic() + 20
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunk = decoder.decode(data)
            output += chunk
            if submitted_at is not None:
                after += chunk
            elif typed_at is not None:
                typing += chunk
            if wizard_answers:
                wizard_output += chunk
                # O wizard em TTY é a tela por tecla: cada desenho termina no
                # rodapé "Ctrl-C sai". Cada resposta diz quantos desenhos ela
                # provoca até a pergunta seguinte estar na tela; tecla mandada
                # antes disso seria descartada, de propósito, pelo key-io.
                if wizard_output.count("Ctrl-C sai") >= wizard_frames:
                    keys, wizard_frames = wizard_answers.pop(0)
                    os.write(master, keys.encode())
                    wizard_output = ""
                continue
            if typed_at is None and re.search(question_pattern, output, re.IGNORECASE):
                before = output
                question_found = True
                os.write(master, b"1")
                typed_at = time.monotonic()
        if typed_at is not None and submitted_at is None and time.monotonic() - typed_at >= 1.3:
            os.write(master, b"\r")
            submitted_at = time.monotonic()
        if process.poll() is not None and not ready:
            break
    if process.poll() is None:
        process.kill()
    exit_code = process.wait(timeout=5)
finally:
    os.close(master)
print(json.dumps({"exitCode": exit_code, "questionFound": question_found, "before": before,
                  "typing": typing, "after": after, "output": output}, ensure_ascii=False))
`;

interface Capture {
  exitCode: number;
  questionFound: boolean;
  before: string;
  typing: string;
  after: string;
  output: string;
}

/** Reconstitui só o viewport ANSI: encontrar texto no histórico não prova que se vê. */
function viewport(text: string, rows: number, columns: number): string {
  const screen: string[][] = Array.from({ length: rows }, () => []);
  let x = 0;
  let y = 0;
  const down = (): void => {
    y += 1;
    if (y >= rows) { screen.shift(); screen.push([]); y = rows - 1; }
  };
  for (let index = 0; index < text.length;) {
    const control = /^\x1b\[([0-?]*)(?:[ -/]*)([@-~])/.exec(text.slice(index));
    if (control) {
      index += control[0].length;
      const values = control[1]!.split(";").map(Number);
      const amount = values[0] || 1;
      switch (control[2]) {
        case "A": y = Math.max(0, y - amount); break;
        case "B": y = Math.min(rows - 1, y + amount); break;
        case "C": x = Math.min(columns - 1, x + amount); break;
        case "D": x = Math.max(0, x - amount); break;
        case "G": x = amount - 1; break;
        case "H": case "f": y = Math.max(0, amount - 1); x = (values[1] || 1) - 1; break;
        case "J":
          if (values[0] === 2) screen.forEach((line) => { line.length = 0; });
          else { screen[y]!.length = x; for (let row = y + 1; row < rows; row += 1) screen[row] = []; }
          break;
        case "K": if (values[0] === 2) screen[y] = []; else screen[y]!.length = x; break;
      }
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(index)!);
    index += char.length;
    if (char === "\r") x = 0;
    else if (char === "\n") down();
    else if (char === "\b") x = Math.max(0, x - 1);
    else if (char >= " ") {
      if (x >= columns) { down(); x = 0; }
      screen[y]![x] = char;
      x += 1;
    }
  }
  return screen.map((line) => Array.from({ length: line.length }, (_, index) => line[index] ?? " ").join("")).join("\n");
}

const plain = (text: string): string => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");

describe.skipIf(!hasPty)("Prompt Engineer no terminal", () => {
  let directory: string;
  let cli: string;
  let adapter: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "capivara-prompt-pty-"));
    cli = join(directory, "cli.mjs");
    adapter = join(directory, "codex.mjs");
    await build({
      entryPoints: [fileURLToPath(new URL("../../src/cli.ts", import.meta.url))], outfile: cli,
      bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent",
      define: { __CAPIVARA_VERSION__: JSON.stringify("terminal-test") },
    });
    await writeFile(adapter, `#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
if (process.argv.includes("debug") && process.argv.includes("models")) {
  process.stdout.write(JSON.stringify({ models: [] }));
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += String(chunk);
const callsPath = join(process.env.CAPIVARA_PROJECT_ROOT, "calls.jsonl");
const calls = (await readFile(callsPath, "utf8").catch(() => "")).trim().split("\\n").filter(Boolean).map(JSON.parse);
const stage = process.env.CAPIVARA_STAGE?.replace(/^prompt-engineer:/, "");
await appendFile(callsPath, JSON.stringify({ stage, prompt }) + "\\n");
const event = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
event({ type: "turn.started" });
await new Promise((resolve) => setTimeout(resolve, 1400));
const response = stage === "interview"
  ? (calls.some((call) => call.stage === "interview") ? ${JSON.stringify(EMPTY_ANALYSIS)} : JSON.parse(await readFile(join(process.env.CAPIVARA_PROJECT_ROOT, "analysis.json"), "utf8")))
  : ${JSON.stringify(DRAFT)};
event({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(response) } });
event({ type: "turn.completed", usage: { input_tokens: 200, output_tokens: 30 } });
`, "utf8");
    await chmod(adapter, 0o755);
  });

  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  /*
   * Com o painel, a resposta é escolhida por tecla dentro da caixa da pergunta
   * (§93); `lineInput` força a linha embaixo do painel, que continua existindo
   * para quem pede `CAPIVARA_LINE_INPUT=1`.
   */
  async function run(rows: number, columns: number, dashboard = true, analysis = QUESTION_ANALYSIS, wizard = false, lineInput = false): Promise<{ capture: Capture; published: string; calls: { stage: string; prompt: string }[] }> {
    const project = await mkdtemp(join(directory, "project-"));
    await mkdir(join(project, "global-config"));
    await writeFile(join(project, "analysis.json"), JSON.stringify(analysis), "utf8");
    /*
     * [teclas, desenhos até a próxima pergunta]. Digitar move o cursor e
     * redesenha; colar redesenha uma vez; o Enter que confirma não redesenha — o
     * desenho seguinte já é a pergunta nova.
     */
    const colar = (texto: string): string => `\x1b[200~${texto}\x1b[201~`;
    const wizardAnswers: [string, number][] = wizard ? [
      [`${colar(project)}\r`, 2], // pasta do projeto
      ["6\r", 2], // prompt-engineer
      ["1\r", 2], // escrever agora
      [`${colar("Um sistema de reservas.")}\r.\r`, 4], // o pedido, o ponto que fecha
      ["\r", 1], // onde gravar: o padrão
      ["1\r", 2], // codex
      [`${colar("terminal-fake-model")}\r`, 2], // modelo
      ["1\r", 2], // sem effort
      ["2\r", 2], // sem ajuste por papel
      ["1\r", 0], // executar
    ] : [];
    const command = wizard ? ["wizard"] : [
      "prompt-engineer", "Organizar um sistema de reservas para uma pousada.", "--project", project,
      "--writer-provider", "codex", "--writer-model", "terminal-fake-model", "--no-splash", "--no-modal",
      ...(dashboard ? [] : ["--no-dashboard"]),
    ];
    const keys = dashboard && !lineInput;
    const questionPattern = keys ? String.raw`PERGUNTA \d+/\d+[^\n]*\n[\s\S]*Enter confirma` : String.raw`sua resposta[^\r\n]*: `;
    const result = await execute("python3", ["-c", PTY_DRIVER, String(rows), String(columns), JSON.stringify(wizardAnswers), questionPattern, process.execPath, cli,
      ...command,
    ], {
      env: { ...process.env, TERM: "xterm", NO_COLOR: "1", CAPIVARA_BG: "none",
        CAPIVARA_CODEX_BIN: adapter, CAPIVARA_CONFIG_DIR: join(project, "global-config"), CAPIVARA_LINE_INPUT: lineInput ? "1" : "",
        CAPIVARA_MCP_URL: "", CAPIVARA_MCP_TOKEN: "", DOC_CENTER_URL: "", DOC_CENTER_TOKEN: "" },
      timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
    });
    const capture = JSON.parse(result.stdout) as Capture;
    expect(capture.questionFound, plain(capture.output)).toBe(true);
    expect(capture.exitCode, plain(capture.output)).toBe(0);
    return {
      capture,
      published: await readFile(join(project, "prompt-engineered.md"), "utf8"),
      calls: (await readFile(join(project, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { stage: string; prompt: string }),
    };
  }

  it.each([{ rows: 40, columns: 100 }, { rows: 24, columns: 80 }])(
    "mostra a pergunta, preserva a digitação e retoma o painel em $columns×$rows",
    async ({ rows, columns }) => {
      const { capture, published, calls } = await run(rows, columns);
      const waiting = viewport(capture.before, rows, columns);
      expect(waiting).toContain("Quem é o público inicial?");
      expect(waiting).toContain("Recepcionistas");
      expect(waiting).toContain("Hóspedes");
      expect(waiting).toContain("não identifica quem opera");
      expect(waiting).toContain("responder com texto livre");
      expect(waiting).toContain("Enter confirma");
      // A tecla move o cursor DENTRO da caixa; a pergunta continua na tela.
      const typed = viewport(capture.before + capture.typing, rows, columns);
      expect(typed).toContain("Quem é o público inicial?");
      expect(typed).toMatch(/❯ 1\) Recepcionistas/);
      expect(typed).toContain("Priorizar a operação interna da pousada.");

      expect(plain(capture.before)).toMatch(/PROMPT ENGINEER/i);
      expect(capture.before).toContain("\x1b[0J");
      expect(plain(capture.before)).toContain("análise de lacunas");
      expect(plain(capture.before)).toContain("terminal-fake-model");
      expect(plain(capture.before)).toContain("pensando");
      expect(plain(capture.before)).toMatch(/há 0m 01s nesta chamada/);
      expect(plain(capture.after)).toMatch(/organizando|escrita/i);
      expect(plain(capture.after)).toMatch(/há 0m 01s nesta chamada/);
      expect(plain(capture.after)).toMatch(/CHAMADAS/);
      expect(plain(capture.after)).toContain("200");
      expect(calls.map((call) => call.stage)).toEqual(["interview", "interview", "authoring"]);
      expect(calls.at(-1)?.prompt).toContain("Recepcionistas");
      expect(published).toContain("Receptionists are the initial audience.");
      expect(published).toContain(DRAFT.objective);
      expect(capture.output).toContain("Prompt salvo em");
    },
  );

  it("mantém decisão e alternativas visíveis em pergunta longa num terminal de 24 linhas", async () => {
    const { capture } = await run(24, 80, true, LONG_ANALYSIS);
    const waiting = viewport(capture.before, 24, 80);
    expect(waiting).toContain("Quem é o público inicial?");
    for (const option of LONG_ANALYSIS.questions[0]!.options) expect(waiting).toContain(option.label);
    expect(waiting).toContain("Enter confirma");
  });

  it("CAPIVARA_LINE_INPUT=1 mantém a resposta digitada embaixo do painel, sem redesenho durante a digitação", async () => {
    const { capture, published } = await run(24, 80, true, QUESTION_ANALYSIS, false, true);
    const waiting = viewport(capture.before, 24, 80);
    expect(waiting).toContain("Quem é o público inicial?");
    expect(waiting).toMatch(/sua resposta.*número.*texto/i);
    expect(capture.typing).toContain("1");
    expect(capture.typing).not.toMatch(/\x1b\[\d*A|\x1b\[[02]J/);
    expect(published).toContain("Receptionists are the initial audience.");
  });

  it("a opção 6 do wizard chega ao painel, aceita a resposta e salva o prompt em TTY real", async () => {
    const { capture, published, calls } = await run(24, 80, true, QUESTION_ANALYSIS, true);
    const waiting = viewport(capture.before, 24, 80);
    expect(plain(capture.before)).toContain("Comando equivalente");
    expect(capture.before).toContain("\x1b[0J");
    expect(waiting).toContain("Quem é o público inicial?");
    expect(waiting).toContain("Recepcionistas");
    expect(waiting).toContain("Enter confirma");
    expect(plain(capture.after)).toMatch(/há 0m 01s nesta chamada/);
    expect(calls.map((call) => call.stage)).toEqual(["interview", "interview", "authoring"]);
    expect(published).toContain("Receptionists are the initial audience.");
  });

  it("--no-dashboard mantém pergunta explícita e saída reutilizável", async () => {
    const { capture, published } = await run(40, 100, false);
    expect(capture.output).not.toContain("ETAPA ATUAL");
    expect(capture.output).not.toMatch(/\x1b\[\d*A|\x1b\[[02]J/);
    expect(plain(capture.before)).toContain("Quem é o público inicial?");
    expect(plain(capture.before)).toContain("Recepcionistas");
    expect(plain(capture.before)).toMatch(/sua resposta.*número.*texto/i);
    expect(plain(capture.after)).toContain(published.trim());
  });
});
