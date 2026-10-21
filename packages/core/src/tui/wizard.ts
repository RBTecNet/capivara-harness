/**
 * Modo wizard.
 *
 * Monta o comando interativamente e, no fim, IMPRIME O COMANDO EQUIVALENTE.
 * Um wizard que não ensina o comando obriga a passar por ele toda vez; este
 * existe para ser usado uma vez e abandonado.
 */

import { ROLE_NAMES, ROLES } from "../provider/roles.js";
import type { RoleName } from "../provider/roles.js";
import { agenteComoFlag, type EstrategiaDeExecucao } from "../config/execucao.js";

export interface WizardAnswers {
  command: "survey" | "init" | "plan" | "build" | "change" | "prompt-engineer";
  request?: string;
  global: { provider?: string; model?: string; effort?: string };
  roles: Partial<Record<RoleName, { provider?: string; model?: string; effort?: string }>>;
  /** Caminho do pedido, quando ele vem de arquivo em vez de digitado. */
  requestFile?: string;
  /** A base documental e o projeto, quando o pedido vem de lá. */
  mcpUrl?: string;
  mcpProject?: string;
  projectRoot?: string;
  testCommand?: string;
  maxCycles?: number;
  /** Ações de reparo por ciclo de cada fase (§125 D); ausente é o padrão. */
  repairsPerCycle?: number;
  noSplash?: boolean;
  /** Onde gravar o levantamento do `survey` ou o prompt do `prompt-engineer`. */
  saida?: string;
  /** Idioma do prompt reutilizável; o `prompt-engineer` usa inglês por padrão. */
  language?: "en" | "pt";
  /**
   * Serial ou paralelo, quando o build precisa dizer (§97). Ausente é o padrão
   * serial — o comando impresso de quem nunca escolheu paralelo não muda.
   */
  execution?: EstrategiaDeExecucao;
  /** Gravar a estratégia em `.capivara/execucao.json`, para as próximas execuções. */
  saveExecution?: boolean;
}

/** As flags da estratégia, iguais no argv executado e no comando impresso. */
function flagsDeExecucao(answers: WizardAnswers): string[] {
  if (answers.command !== "build" || !answers.execution) return [];
  const flags =
    answers.execution.mode === "serial"
      ? ["--serial"]
      : [
          "--parallel",
          String(answers.execution.maxConcurrency),
          ...(answers.execution.workers.length === 0
            ? ["--workers-as-builder"]
            : answers.execution.workers.flatMap((agente) => ["--worker", agenteComoFlag(agente)])),
        ];
  return answers.saveExecution === true ? [...flags, "--save-execution"] : flags;
}

function quote(value: string): string {
  return /^[A-Za-z0-9._:/-]+$/.test(value) ? value : `"${value.replace(/([\\"$`])/g, "\\$1")}"`;
}

/**
 * O argv equivalente ao que o wizard montou.
 *
 * Existe para que o comando impresso e o comando executado saiam do MESMO lugar.
 * Um wizard que monta a execução por um caminho e a linha de exemplo por outro
 * ensina um comando que não é o que rodou — e a diferença só aparece quando o
 * desenvolvedor tenta repetir sozinho.
 */
export function toArgv(answers: WizardAnswers): string[] {
  const argv: string[] = [answers.command];

  // Os comandos com pedido recebem o texto como argumento, ou uma das origens abaixo.
  if ((answers.command === "init" || answers.command === "change" || answers.command === "prompt-engineer") && answers.request) argv.push(answers.request);

  if (answers.global.provider) argv.push("--provider", answers.global.provider);
  if (answers.global.model) argv.push("--model", answers.global.model);
  if (answers.global.effort) argv.push("--effort", answers.global.effort);

  for (const role of ROLE_NAMES) {
    const configured = answers.roles[role];
    if (!configured) continue;
    if (configured.provider) argv.push(`--${role}-provider`, configured.provider);
    if (configured.model) argv.push(`--${role}-model`, configured.model);
    if (configured.effort) argv.push(`--${role}-effort`, configured.effort);
  }

  if (answers.requestFile) argv.push("--file", answers.requestFile);
  /*
   * No `init` as duas andam juntas — a URL diz onde é a base, o projeto diz o
   * que ler dela. No `survey` não há o que ler: o projeto ainda não existe, e o
   * nome dele sai da aplicação levantada. Ali a URL sozinha basta.
   */
  if (answers.mcpUrl && answers.mcpProject) argv.push("--mcp", answers.mcpUrl, "--mcp-project", answers.mcpProject);
  else if (answers.mcpUrl && answers.command === "survey") argv.push("--mcp", answers.mcpUrl);
  if (answers.saida) argv.push("--saida", answers.saida);
  if (answers.command === "prompt-engineer" && answers.language) argv.push("--language", answers.language);
  if (answers.projectRoot) argv.push("--project", answers.projectRoot);
  if (answers.testCommand) argv.push("--test-cmd", answers.testCommand);
  if (answers.maxCycles !== undefined) argv.push("--max-cycles", String(answers.maxCycles));
  if (answers.repairsPerCycle !== undefined) argv.push("--repairs-per-cycle", String(answers.repairsPerCycle));
  argv.push(...flagsDeExecucao(answers));
  if (answers.noSplash) argv.push("--no-splash");

  return argv;
}

/** O comando equivalente ao que o wizard montou. */
export function renderCommand(answers: WizardAnswers): string {
  const parts = ["capivara", answers.command];

  if ((answers.command === "init" || answers.command === "change" || answers.command === "prompt-engineer") && answers.request) parts.push(quote(answers.request));

  if (answers.global.provider) parts.push("--provider", answers.global.provider);
  if (answers.global.model) parts.push("--model", quote(answers.global.model));
  if (answers.global.effort) parts.push("--effort", answers.global.effort);

  for (const role of ROLE_NAMES) {
    const configured = answers.roles[role];
    if (!configured) continue;
    if (configured.provider) parts.push(`--${role}-provider`, configured.provider);
    if (configured.model) parts.push(`--${role}-model`, quote(configured.model));
    if (configured.effort) parts.push(`--${role}-effort`, configured.effort);
  }

  if (answers.requestFile) parts.push("--file", quote(answers.requestFile));
  if (answers.mcpUrl && answers.mcpProject) parts.push("--mcp", quote(answers.mcpUrl), "--mcp-project", quote(answers.mcpProject));
  else if (answers.mcpUrl && answers.command === "survey") parts.push("--mcp", quote(answers.mcpUrl));
  if (answers.saida) parts.push("--saida", quote(answers.saida));
  if (answers.command === "prompt-engineer" && answers.language) parts.push("--language", answers.language);
  if (answers.projectRoot) parts.push("--project", quote(answers.projectRoot));
  if (answers.testCommand) parts.push("--test-cmd", quote(answers.testCommand));
  if (answers.maxCycles !== undefined) parts.push("--max-cycles", String(answers.maxCycles));
  if (answers.repairsPerCycle !== undefined) parts.push("--repairs-per-cycle", String(answers.repairsPerCycle));
  parts.push(...flagsDeExecucao(answers).map(quote));
  if (answers.noSplash) parts.push("--no-splash");

  return parts.join(" ");
}

export interface WizardStep {
  id: string;
  prompt: string;
  hint: string;
}

/**
 * O que dizer sobre cada papel na hora de escolher o modelo.
 *
 * Somente-leitura não quer dizer barato. Auditor e verificador julgam o que
 * outro modelo produziu, e um juiz abaixo do autor não reprova menos: ele
 * carimba, porque não enxerga o defeito.
 */
export function roleHint(role: RoleName, requiresCli: boolean): string {
  if (requiresCli) return "escreve arquivos e roda comandos: exige uma CLI";
  if (role === "auditor" || role === "verifier") return "julga o trabalho de outro modelo: não coloque abaixo do executor";
  return "escreve os documentos: é a base de tudo o que vem depois";
}

/** Os passos, como dados: a TUI apenas os apresenta. */
export function wizardSteps(command: "init" | "build" | "prompt-engineer"): WizardStep[] {
  const steps: WizardStep[] = [];

  if (command === "init") {
    steps.push({ id: "request", prompt: "O que você quer construir?", hint: "uma frase basta; a entrevista cuida do resto" });
  } else if (command === "prompt-engineer") {
    steps.push({ id: "request", prompt: "Qual prompt cru você quer organizar?", hint: "digite, aponte um arquivo ou escolha na base MCP; a entrevista esclarece as lacunas" });
    steps.push({ id: "saida", prompt: "Onde gravar o prompt?", hint: "padrão prompt-engineered.md no projeto; formato Ponytail, em inglês, para outra LLM ou para a capivara" });
  }

  steps.push({
    id: "provider",
    prompt: "Qual provider usar por padrão?",
    hint: "codex, claude ou opencode usam a CLI instalada; as APIs diretas pedem credencial",
  });
  steps.push({ id: "model", prompt: "Qual modelo?", hint: "deixe vazio para o padrão do provider" });

  const roles: readonly RoleName[] = command === "prompt-engineer" ? ["writer"] : ROLE_NAMES;
  for (const role of roles) {
    const definition = ROLES[role];
    steps.push({
      id: `${role}-override`,
      prompt: `Configurar ${definition.label} separadamente?`,
      hint: roleHint(role, definition.requiresCli),
    });
  }

  if (command === "build") {
    steps.push({ id: "test-cmd", prompt: "Comando de teste do projeto?", hint: "deixe vazio para detectar pelo manifesto" });
    steps.push({ id: "max-cycles", prompt: "Ciclos de correção por fase?", hint: "padrão 3" });
    steps.push({ id: "repairs-per-cycle", prompt: "Reparos por ciclo de cada fase?", hint: "padrão 6; esgotado, abre o ciclo seguinte" });
  }

  return steps;
}

/**
 * Escolha fechada, sempre numérica.
 *
 * O wizard antigo perguntava "digitar ou arquivo" num campo livre, e quem colava
 * o pedido ali via a primeira linha ser lida como se fosse o modo — o resto da
 * colagem ia sendo consumido, uma linha por pergunta seguinte, até o comando
 * sair montado com pedaços de texto nos campos errados. Número não tem esse
 * problema: ou é uma das opções, ou não é resposta.
 */
export interface Choice {
  label: string;
  hint?: string;
}

/** A lista numerada, com o padrão marcado. */
export function renderChoices(title: string, choices: readonly Choice[], defaultIndex: number): string {
  const lines = [title];
  choices.forEach((choice, index) => {
    const marca = index === defaultIndex ? " (padrão)" : "";
    lines.push(`  ${index + 1}) ${choice.label}${marca}${choice.hint ? ` — ${choice.hint}` : ""}`);
  });
  return lines.join("\n");
}

export type ChoiceReading = { ok: true; index: number } | { ok: false; message: string };

/** Vazio aceita o padrão; qualquer outra coisa é o número de uma opção, ou nada. */
export function readChoice(answer: string, count: number, defaultIndex: number): ChoiceReading {
  const text = answer.trim();
  if (text === "") return { ok: true, index: defaultIndex };

  if (/^\d+$/.test(text)) {
    const chosen = Number(text);
    if (chosen >= 1 && chosen <= count) return { ok: true, index: chosen - 1 };
    return { ok: false, message: `Responda com um número entre 1 e ${count} — ${chosen} não é uma das opções.` };
  }

  // A pista que importa: quase todo texto longo aqui é um pedido colado.
  const colado =
    text.length > 40 || text.includes("\n")
      ? " Se você colou o pedido aqui, escolha primeiro a opção de escrever; o texto inteiro é pedido na pergunta seguinte."
      : "";
  return { ok: false, message: `Responda com o número da opção, de 1 a ${count}.${colado}` };
}
