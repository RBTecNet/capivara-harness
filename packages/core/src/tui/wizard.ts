/**
 * Modo wizard.
 *
 * Monta o comando interativamente e, no fim, IMPRIME O COMANDO EQUIVALENTE.
 * Um wizard que não ensina o comando obriga a passar por ele toda vez; este
 * existe para ser usado uma vez e abandonado.
 */

import { ROLE_NAMES, ROLES } from "../provider/roles.js";
import type { RoleName } from "../provider/roles.js";

export interface WizardAnswers {
  command: "init" | "build";
  request?: string;
  global: { provider?: string; model?: string; effort?: string };
  roles: Partial<Record<RoleName, { provider?: string; model?: string; effort?: string }>>;
  testCommand?: string;
  maxCycles?: number;
  noSplash?: boolean;
}

function quote(value: string): string {
  return /^[A-Za-z0-9._:/-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/** O comando equivalente ao que o wizard montou. */
export function renderCommand(answers: WizardAnswers): string {
  const parts = ["capivara", answers.command];

  if (answers.command === "init" && answers.request) parts.push(quote(answers.request));

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

  if (answers.testCommand) parts.push("--test-cmd", quote(answers.testCommand));
  if (answers.maxCycles !== undefined) parts.push("--max-cycles", String(answers.maxCycles));
  if (answers.noSplash) parts.push("--no-splash");

  return parts.join(" ");
}

export interface WizardStep {
  id: string;
  prompt: string;
  hint: string;
}

/** Os passos, como dados: a TUI apenas os apresenta. */
export function wizardSteps(command: "init" | "build"): WizardStep[] {
  const steps: WizardStep[] = [];

  if (command === "init") {
    steps.push({ id: "request", prompt: "O que você quer construir?", hint: "uma frase basta; a entrevista cuida do resto" });
  }

  steps.push({
    id: "provider",
    prompt: "Qual provider usar por padrão?",
    hint: "codex, claude ou opencode usam a CLI instalada; as APIs diretas pedem credencial",
  });
  steps.push({ id: "model", prompt: "Qual modelo?", hint: "deixe vazio para o padrão do provider" });

  for (const role of ROLE_NAMES) {
    const definition = ROLES[role];
    steps.push({
      id: `${role}-override`,
      prompt: `Configurar ${definition.label} separadamente?`,
      hint:
        definition.requiresCli
          ? "este papel escreve arquivos e roda comandos: exige uma CLI"
          : "papel somente leitura; um modelo mais barato costuma bastar",
    });
  }

  if (command === "build") {
    steps.push({ id: "test-cmd", prompt: "Comando de teste do projeto?", hint: "deixe vazio para detectar pelo manifesto" });
    steps.push({ id: "max-cycles", prompt: "Ciclos de correção por fase?", hint: "padrão 3" });
  }

  return steps;
}
