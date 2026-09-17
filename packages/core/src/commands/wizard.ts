/**
 * O wizard interativo.
 *
 * Ele existe para quem ainda não sabe quais flags passar, e termina imprimindo o
 * comando equivalente justamente para não precisar existir da próxima vez.
 *
 * Duas regras o governam:
 *
 * 1. Toda escolha fechada é NUMÉRICA. O wizard do harness anterior perguntava
 *    "digitar ou arquivo" num campo livre; quem colava o pedido ali tinha a
 *    primeira linha lida como se fosse o modo, e o resto da colagem era
 *    consumido uma linha por pergunta seguinte. Número não aceita colagem por
 *    engano.
 * 2. O comando impresso e o comando executado saem do MESMO lugar — `toArgv` e
 *    `renderCommand` leem a mesma resposta, e o CLI reexecuta o próprio programa
 *    com esse argv. Um wizard que executa por um caminho e ensina outro mente.
 */

import { CLI_PROVIDERS, DIRECT_PROVIDERS, ROLES, ROLE_NAMES } from "../provider/index.js";
import type { RoleName } from "../provider/index.js";
import { readChoice, renderChoices, renderCommand, toArgv } from "../tui/index.js";
import type { Choice, WizardAnswers } from "../tui/index.js";

export interface WizardIO {
  ask: (prompt: string) => Promise<string>;
  write: (text: string) => void;
}

/** O mínimo que o leitor de linhas precisa: serve readline e serve um fake. */
export interface LineSource {
  on: (event: "line" | "close", listener: (line: string) => void) => unknown;
}

/**
 * Enfileira as linhas em vez de pedir uma por vez.
 *
 * `question()` só enxerga o que chega ENQUANTO ele espera. Com a entrada vinda
 * de um pipe, todas as linhas chegam de uma vez, antes de a segunda pergunta
 * existir: a primeira é respondida, o resto evapora e o readline fecha — foi o
 * que derrubou o wizard no primeiro teste com entrada roteirizada.
 *
 * Com fila, linha que chega cedo espera a pergunta, e pergunta que chega cedo
 * espera a linha. É a mesma correção que o pedido colado exigia, feita no lugar
 * certo: o buffer de entrada, não cada pergunta.
 */
export function createLineIO(source: LineSource, write: (text: string) => void): WizardIO {
  const buffered: string[] = [];
  const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
  let closed = false;

  source.on("line", (line) => {
    const next = waiting.shift();
    if (next) next.resolve(line);
    else buffered.push(line);
  });
  source.on("close", () => {
    closed = true;
    while (waiting.length > 0) waiting.shift()?.reject(new Error("a entrada terminou"));
  });

  return {
    write,
    ask: (prompt) => {
      write(prompt);
      const pronto = buffered.shift();
      if (pronto !== undefined) return Promise.resolve(pronto);
      if (closed) return Promise.reject(new Error("a entrada terminou"));
      return new Promise<string>((resolve, reject) => waiting.push({ resolve, reject }));
    },
  };
}

export interface WizardDeps {
  io: WizardIO;
  cwd: string;
  /** Existe e é arquivo. Usado para validar o pedido e detectar documentação pronta. */
  fileExists: (path: string) => Promise<boolean>;
  directoryExists: (path: string) => Promise<boolean>;
}

export interface WizardResult {
  answers: WizardAnswers;
  argv: string[];
  command: string;
  /** Falso quando o desenvolvedor escolheu não executar agora. */
  execute: boolean;
}

const EFFORTS: Choice[] = [
  { label: "desligado", hint: "nem todo provider aceita raciocínio estendido" },
  { label: "minimal" },
  { label: "low" },
  { label: "medium" },
  { label: "high" },
];

const PROVIDERS: Choice[] = [
  ...CLI_PROVIDERS.map((id) => ({ label: id, hint: id === "custom" ? "adapter próprio" : "usa a CLI instalada nesta máquina" })),
  ...DIRECT_PROVIDERS.map((id) => ({ label: id, hint: "API direta; exige credencial" })),
];

/**
 * A entrada acabou antes das respostas.
 *
 * Acontece com Ctrl-D e com wizard alimentado por pipe. Não é erro de programa:
 * é o desenvolvedor dizendo que não vai responder o resto. Morrer aqui com stack
 * trace do readline seria o mesmo defeito que o provider ausente tinha.
 */
class InputEnded extends Error {}

async function pergunta(io: WizardIO, prompt: string): Promise<string> {
  try {
    return await io.ask(prompt);
  } catch {
    throw new InputEnded();
  }
}

/** Pergunta até vir um número válido. Vazio aceita o padrão. */
async function choose(io: WizardIO, title: string, choices: readonly Choice[], defaultIndex: number): Promise<number> {
  io.write(`\n${renderChoices(title, choices, defaultIndex)}\n`);
  for (;;) {
    const reading = readChoice(await pergunta(io, `Escolha [${defaultIndex + 1}]: `), choices.length, defaultIndex);
    if (reading.ok) return reading.index;
    io.write(`${reading.message}\n`);
  }
}

async function text(io: WizardIO, prompt: string, fallback = ""): Promise<string> {
  const answer = (await pergunta(io, prompt)).trim();
  return answer === "" ? fallback : answer;
}

async function yesNo(io: WizardIO, prompt: string, defaultYes: boolean): Promise<boolean> {
  const answer = (await pergunta(io, `${prompt} [${defaultYes ? "S/n" : "s/N"}]: `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return /^(?:s|sim|y|yes)$/.test(answer);
}

/**
 * Lê um pedido de várias linhas.
 *
 * Uma pergunta comum termina na primeira quebra de linha, e tudo o que vem
 * depois fica no buffer para ser respondido às perguntas seguintes. Um pedido é
 * quase sempre um parágrafo colado, então ele precisa de um fim explícito.
 */
async function multiline(io: WizardIO, title: string): Promise<string> {
  io.write(`\n${title}\n`);
  io.write("Cole ou digite quantas linhas quiser. Termine com uma linha contendo só um ponto, ou Ctrl-D.\n");
  const lines: string[] = [];
  for (;;) {
    let line: string;
    try {
      line = await io.ask("> ");
    } catch {
      break; // Ctrl-D fecha a entrada.
    }
    if (line.trim() === ".") break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

export async function runWizard(deps: WizardDeps): Promise<WizardResult | null> {
  try {
    return await conduct(deps);
  } catch (error) {
    if (error instanceof InputEnded) {
      deps.io.write("\nA entrada terminou antes do fim das perguntas. Nada foi executado.\n");
      return null;
    }
    throw error;
  }
}

async function conduct(deps: WizardDeps): Promise<WizardResult | null> {
  const { io } = deps;
  io.write("capivara · monta o comando com você e imprime o equivalente no fim\n");

  const projectRoot = await text(io, `\nPasta do projeto [${deps.cwd}]: `, deps.cwd);
  if (!(await deps.directoryExists(projectRoot))) {
    io.write(`A pasta ${projectRoot} não existe. Crie-a e rode de novo.\n`);
    return null;
  }

  // Documentação pronta na pasta é o sinal mais forte de qual comando vem agora.
  const documentado = await deps.fileExists(`${projectRoot}/.capivara/init/project-phases.md`);
  const comandos: Choice[] = [
    { label: "init", hint: "entrevista, escreve e audita os quatro documentos até RALPH READY" },
    { label: "build", hint: "constrói a aplicação a partir da documentação pronta" },
  ];
  const command = (["init", "build"] as const)[await choose(io, "O que você quer fazer?", comandos, documentado ? 1 : 0)] ?? "init";

  const answers: WizardAnswers = { command, global: {}, roles: {} };
  if (projectRoot !== deps.cwd) answers.projectRoot = projectRoot;

  if (command === "init") {
    const fontes: Choice[] = [
      { label: "escrever agora", hint: "cole ou digite; várias linhas" },
      { label: "ler de um arquivo", hint: "um .md ou .txt já escrito" },
    ];
    if (await choose(io, "De onde vem o pedido?", fontes, 0) === 1) {
      for (;;) {
        const caminho = await text(io, "Caminho do arquivo: ");
        if (caminho === "") {
          io.write("O caminho não pode ficar vazio.\n");
          continue;
        }
        if (!(await deps.fileExists(caminho.startsWith("/") ? caminho : `${projectRoot}/${caminho}`))) {
          io.write(`Não encontrei ${caminho} dentro de ${projectRoot}.\n`);
          continue;
        }
        answers.requestFile = caminho;
        break;
      }
    } else {
      const pedido = await multiline(io, "O que você quer construir?");
      if (pedido === "") {
        io.write("Sem pedido não há o que documentar.\n");
        return null;
      }
      answers.request = pedido;
    }
  }

  const provider = PROVIDERS[await choose(io, "Qual provider usar em todos os papéis?", PROVIDERS, 0)]?.label ?? "codex";
  answers.global.provider = provider;

  const model = await text(io, "\nModelo (vazio usa o padrão do provider): ");
  if (model !== "") answers.global.model = model;

  const effort = EFFORTS[await choose(io, "Intensidade de raciocínio?", EFFORTS, 0)]?.label ?? "desligado";
  if (effort !== "desligado") answers.global.effort = effort;

  // Papéis: só os que ESTE comando chama. Perguntar pelo executor num init é
  // pedir uma decisão que não vai ser usada.
  const usados: RoleName[] = command === "init" ? ["writer", "auditor", "verifier"] : ["builder", "verifier"];
  if (await yesNo(io, "\nAjustar algum papel separadamente?", false)) {
    for (const role of usados) {
      const definition = ROLES[role];
      const opcoes: Choice[] = [
        { label: `manter ${provider}`, hint: "o padrão escolhido acima" },
        ...PROVIDERS,
      ];
      const escolhido = await choose(
        io,
        `${definition.label} — ${definition.requiresCli ? "escreve arquivos e roda comandos: exige uma CLI" : "somente leitura; um modelo mais barato costuma bastar"}`,
        opcoes,
        0,
      );
      if (escolhido === 0) continue;
      const proprio: { provider?: string; model?: string } = { provider: opcoes[escolhido]?.label ?? provider };
      const modeloDoPapel = await text(io, `Modelo do ${role} (vazio usa o padrão do provider): `);
      if (modeloDoPapel !== "") proprio.model = modeloDoPapel;
      answers.roles[role] = proprio;
    }
  }

  if (command === "build") {
    const comandoDeTeste = await text(io, "\nComando de teste do projeto (vazio detecta pelo manifesto): ");
    if (comandoDeTeste !== "") answers.testCommand = comandoDeTeste;

    const ciclos = await text(io, "Ciclos de correção por fase [3]: ", "3");
    if (/^\d+$/.test(ciclos) && Number(ciclos) !== 3) answers.maxCycles = Number(ciclos);
  }

  const rendered = renderCommand(answers);
  io.write(`\nComando equivalente:\n\n  ${rendered}\n\n`);

  return { answers, argv: toArgv(answers), command: rendered, execute: await yesNo(io, "Executar agora?", true) };
}
