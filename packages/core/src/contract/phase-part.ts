/**
 * Normalização de uma parte de fase.
 *
 * O escritor recebe a instrução de emitir uma fase e só ela, com os metadados
 * que o ledger alocou. Ele nem sempre obedece: o piloto 1 devolveu partes com
 * `## Open Questions` dentro (que encerra a captura e faz o resto da fase
 * desaparecer) e com `**Depends on:** none` em fases que dependem da fundação.
 *
 * Os dois são verificáveis em código, então são corrigidos em código. A lição
 * custou três impasses: o que o runtime pode garantir não se pede ao modelo.
 */

import { phaseHeading } from "./templates.js";

export interface PhasePartExpectation {
  phaseNumber: number;
  /** Valor de `Depends on` alocado pelo ledger; é a autoridade. */
  dependsOn: string;
}

export interface NormalizedPart {
  markdown: string;
  applied: string[];
}

const LEVEL_2 = /^##\s+(.*)$/;

/**
 * `workflow <n>` é rótulo estrutural, não palavra do texto.
 *
 * O piloto 3 saiu com o plano inteiro rastreando "fluxo 1", "fluxo 9" — o
 * documento é em português e o modelo traduziu o rótulo junto com a prosa. A
 * cobertura procura `workflow <n>`, não achou nenhum, e o run terminou NOT READY
 * depois de três horas por causa de uma palavra.
 *
 * A lista é curta e explícita de propósito: são as traduções que já apareceram,
 * não uma tentativa de cobrir todos os idiomas. O que o runtime reconhece, ele
 * conserta; o que não reconhecer vira finding de cobertura antes do gate.
 */
const TRANSLATED_WORKFLOW = /\b(?:fluxos?|flujos?|flows?|workflows)\s+0*(\d+)\b/gi;
const TRACES_LINE = /^(\s*-\s*\*\*Traces:\*\*\s*)(.*)$/;
const DEPENDS_TOKEN = /(?:phase\s*)?0*(\d+)/gi;
const DEPENDS_ON = /(\*\*Depends on:\*\*\s*)([^·\n]*)/;

/**
 * Forma canônica de `Depends on`.
 *
 * O ledger devolve o que o modelo escreveu: "1", "Phase 1", "P01", "fase 1" ou
 * vazio. O documento precisa de `none` ou `Phase N` — publicar "1" é trocar um
 * valor errado mas bem-formado por um errado e malformado.
 */
export function canonicalDependsOn(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || /^(?:none|nenhuma?|nenhum)$/i.test(trimmed)) return "none";
  const phases = [...trimmed.matchAll(DEPENDS_TOKEN)].map((match) => Number(match[1]));
  if (phases.length === 0) return "none";
  return [...new Set(phases)].sort((left, right) => left - right).map((phase) => `Phase ${phase}`).join(", ");
}

export function normalizePhasePart(markdown: string, expectation: PhasePartExpectation): NormalizedPart {
  const applied: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  const start = lines.findIndex((line) => line.startsWith(phaseHeading(expectation.phaseNumber)));
  if (start === -1) {
    // Sem o heading esperado não há como saber onde a fase começa. Recortar no
    // escuro esvaziaria o conteúdo em silêncio, que é pior do que devolvê-lo
    // como veio e deixar o parser e o auditor reclamarem com evidência.
    return { markdown, applied: [`a parte não traz o heading "${phaseHeading(expectation.phaseNumber)}"; devolvida sem normalizar`] };
  }
  if (start > 0) {
    lines.splice(0, start);
    applied.push("removeu o que vinha antes do heading da fase");
  }

  // Qualquer nível 2 depois do heading da fase encerra a captura no parser: o
  // restante da fase sumiria do run sem aviso.
  const cut = lines.findIndex((line, index) => index > 0 && LEVEL_2.test(line));
  if (cut > 0) {
    lines.splice(cut);
    applied.push("removeu uma seção de nível 2 escrita dentro da fase, que encerraria a captura");
  }

  let content = lines.join("\n").replace(/\s+$/, "");

  const traduzidos = canonicalWorkflowTraces(content);
  if (traduzidos.applied) {
    content = traduzidos.content;
    applied.push("traduziu de volta a referência de workflow nos Traces, que é rótulo estrutural");
  }

  const esperado = canonicalDependsOn(expectation.dependsOn);
  const metadata = DEPENDS_ON.exec(content);
  if (metadata && canonicalDependsOn(metadata[2] ?? "") !== esperado) {
    content = content.replace(DEPENDS_ON, `$1${esperado} `);
    applied.push(`corrigiu Depends on para "${esperado}", conforme o ledger`);
  }

  return { markdown: `${content}\n`, applied };
}

/**
 * Devolve `workflow <n>` às linhas de Traces que o traduziram.
 *
 * Só mexe em linha de Traces: "fluxo" no meio de um critério é prosa legítima e
 * continua prosa. O rótulo estrutural é o que a cobertura lê, e só ele.
 */
export function canonicalWorkflowTraces(markdown: string): { content: string; applied: boolean } {
  let applied = false;
  const content = markdown
    .split("\n")
    .map((line) => {
      const traces = TRACES_LINE.exec(line);
      if (!traces) return line;
      const corrigido = (traces[2] ?? "").replace(TRANSLATED_WORKFLOW, (inteiro, numero: string) => {
        const canonico = `workflow ${Number(numero)}`;
        if (inteiro.toLowerCase() !== canonico) applied = true;
        return canonico;
      });
      return `${traces[1]}${corrigido}`;
    })
    .join("\n");
  return { content, applied };
}
