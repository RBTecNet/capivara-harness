/**
 * O handoff do verificador (§125 E; spec §6).
 *
 * Quem acha um defeito material sabe onde ele está, por que acontece e o que
 * provaria a correção — e isso morria na string `lastCause`, sobrescrita a cada
 * ciclo. Agora toda falha material vista pelo verificador vira, NA HORA e antes
 * de qualquer reparo, um pacote persistido com a identidade run + fase + gate +
 * ciclo + defeito. O diagnóstico original é gravado uma vez e nunca mais
 * reescrito; o que acontece depois (tentativas, progresso, rediagnósticos)
 * fica no registro do defeito, separado do original.
 *
 * É montado do que já existe — a linha INCOMPLETE do verificador, a triagem do
 * G4, a orientação da integração —, sem chamada de sumarização. E não
 * substitui ler o código atual: quem recebe o handoff recebe também o que mudou
 * desde o diagnóstico.
 */

import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { defeitosDoRun, type Defect, type DefectGate } from "./defeitos.js";
import type { CodeState } from "./evidencias.js";

export const HANDOFF_CONTRACT = "capivara-verifier-handoff/v1" as const;

export interface HandoffIdentity {
  runId: string;
  phaseId: string;
  gate: DefectGate;
  cycle: number;
  defectId: string;
}

export interface CamposDoDiagnostico {
  criterion: string;
  observed: string;
  expected: string;
  evidence: string;
  location: string;
  hypothesis: string;
  minimalRepair: string;
  requiredProof: string;
}

export interface VerifierHandoff extends CamposDoDiagnostico {
  contract: typeof HANDOFF_CONTRACT;
  identity: HandoffIdentity;
  createdAt: string;
  diagnosedBy: { role: "verifier"; purpose?: string; sessionId?: string; log?: string };
  /** O texto que o verificador escreveu, inteiro. */
  raw: string;
  code: CodeState | null;
  documents: { name: string; sha12: string }[];
}

const ROTULOS: Record<keyof CamposDoDiagnostico, readonly string[]> = {
  criterion: ["CRITERION", "CRITÉRIO", "CRITERIO", "REQUIREMENT"],
  observed: ["OBSERVED", "OBSERVADO", "ACTUAL"],
  expected: ["EXPECTED", "ESPERADO"],
  evidence: ["EVIDENCE", "EVIDÊNCIA", "EVIDENCIA"],
  location: ["LOCATION", "WHERE", "ONDE", "LOCAL"],
  hypothesis: ["HYPOTHESIS", "CAUSE", "CAUSA", "HIPÓTESE", "HIPOTESE"],
  minimalRepair: ["FIX", "CORRECTION", "CORREÇÃO", "CORRECAO"],
  requiredProof: ["CHECK", "PROOF", "PROVA", "VERIFICAÇÃO", "VERIFICACAO"],
};

/**
 * Os campos rotulados de um diagnóstico em texto, quando vierem.
 *
 * O verificador escreve `CRITERION: …; EVIDENCE: …; FIX: …; CHECK: …` (o prompt
 * pede os quatro, e a orientação da integração pede CAUSE/EVIDENCE/FIX/CHECK).
 * Rótulo ausente fica vazio — o texto bruto continua no handoff, e é ele que
 * vale quando nada vier rotulado.
 */
export function camposDoDiagnostico(texto: string): CamposDoDiagnostico {
  const nomes = Object.keys(ROTULOS) as (keyof CamposDoDiagnostico)[];
  const alternativa = nomes.flatMap((nome) => ROTULOS[nome]).map((rotulo) => rotulo.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  // Só rótulo em maiúsculas: "to fix: the bug" em prosa não é campo.
  const marcador = new RegExp(`(^|[;\\n|]|\\s)(${alternativa})\\s*:`, "gu");
  const achados = [...texto.matchAll(marcador)].map((match) => ({
    rotulo: match[2] ?? "",
    rotuloComeca: (match.index ?? 0) + (match[1]?.length ?? 0),
    valorComeca: (match.index ?? 0) + match[0].length,
  }));
  const campos: CamposDoDiagnostico = { criterion: "", observed: "", expected: "", evidence: "", location: "", hypothesis: "", minimalRepair: "", requiredProof: "" };
  achados.forEach((achado, indice) => {
    const fim = achados[indice + 1]?.rotuloComeca ?? texto.length;
    const valor = texto.slice(achado.valorComeca, fim).replace(/[;\s|]+$/u, "").trim();
    const chave = nomes.find((nome) => ROTULOS[nome].includes(achado.rotulo));
    if (chave && campos[chave] === "") campos[chave] = valor;
  });
  return campos;
}

function pastaDoDefeito(runRoot: string, identidade: HandoffIdentity): string {
  return join(defeitosDoRun(runRoot), identidade.phaseId, identidade.defectId);
}

export function caminhoDoHandoff(runRoot: string, identidade: HandoffIdentity): string {
  return join(pastaDoDefeito(runRoot, identidade), `handoff-${identidade.gate}-c${identidade.cycle}.json`);
}

/**
 * Grava o diagnóstico original uma vez, e nunca o reescreve.
 *
 * `link` é atômico e falha se o destino existe: um handoff com a mesma
 * identidade já gravado é o original, e o novo texto fica como rediagnóstico
 * no registro do defeito. Uma queda no meio deixa no máximo o temporário,
 * nunca um handoff pela metade.
 */
export async function gravarHandoff(runRoot: string, handoff: VerifierHandoff): Promise<{ caminho: string; original: boolean }> {
  const caminho = caminhoDoHandoff(runRoot, handoff.identity);
  await mkdir(dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temporario, `${JSON.stringify(handoff, null, 2)}\n`, { flag: "wx" });
  try {
    await link(temporario, caminho);
    return { caminho, original: true };
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
    return { caminho, original: false };
  } finally {
    await rm(temporario, { force: true });
  }
}

export async function lerHandoff(caminho: string): Promise<VerifierHandoff | null> {
  try {
    const lido = JSON.parse(await readFile(caminho, "utf8")) as VerifierHandoff;
    return lido.contract === HANDOFF_CONTRACT ? lido : null;
  } catch {
    return null;
  }
}

/**
 * O handoff como quem repara o recebe.
 *
 * O diagnóstico original vem intacto; depois, o que mudou no código desde ele,
 * as tentativas e as estratégias que falharam — para que o próximo não repita o
 * que já se sabe que não funciona. Determinístico, sem modelo.
 */
export function renderHandoff(handoff: VerifierHandoff, defeito: Defect, mudancasDesde: readonly string[] | null): string {
  const campo = (rotulo: string, valor: string): string[] => (valor.trim() === "" ? [] : [`- ${rotulo}: ${valor.trim()}`]);
  const linhas = [
    `### ${defeito.defectId} — ${handoff.identity.gate}, ciclo ${handoff.identity.cycle}: ${defeito.summary}`,
    "Original diagnosis (verbatim, immutable):",
    "````",
    handoff.raw.trim(),
    "````",
    ...campo("criterion", handoff.criterion),
    ...campo("observed", handoff.observed),
    ...campo("expected", handoff.expected),
    ...campo("evidence", handoff.evidence),
    ...campo("location", handoff.location),
    ...campo("hypothesis", handoff.hypothesis),
    ...campo("smallest repair", handoff.minimalRepair),
    ...campo("proof required", handoff.requiredProof),
  ];
  if (mudancasDesde === null) linhas.push("- code changed since the diagnosis: unknown — read the current files before acting");
  else if (mudancasDesde.length === 0) linhas.push("- code changed since the diagnosis: nothing");
  else linhas.push(`- code changed since the diagnosis: ${mudancasDesde.slice(0, 20).join(", ")}${mudancasDesde.length > 20 ? ` and ${mudancasDesde.length - 20} more` : ""}`);
  const tentativas = defeito.attempts.filter((tentativa) => tentativa.result !== "pending");
  if (tentativas.length > 0) {
    linhas.push("- attempts so far:");
    for (const tentativa of tentativas) {
      linhas.push(`  - cycle ${tentativa.cycle}, ${tentativa.strategy}: ${tentativa.result === "no-progress" ? "no progress (same failure)" : tentativa.result === "progress" ? "progress (the failure changed)" : tentativa.result}`);
    }
  }
  const ultimo = defeito.rediagnoses.at(-1);
  if (ultimo) linhas.push(`- latest re-diagnosis (cycle ${ultimo.cycle}): ${ultimo.excerpt.split("\n").slice(0, 6).join(" ").slice(0, 800)}`);
  const falhas = [...new Set(defeito.failedStrategies.map((falha) => falha.strategy))];
  if (falhas.length > 0) linhas.push(`- strategies that already failed without progress: ${falhas.join(", ")} — do not repeat what they did`);
  return linhas.join("\n");
}
