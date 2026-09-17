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
const DEPENDS_ON = /(\*\*Depends on:\*\*\s*)([^·\n]*)/;

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

  const metadata = DEPENDS_ON.exec(content);
  if (metadata && metadata[2]?.trim() !== expectation.dependsOn) {
    content = content.replace(DEPENDS_ON, `$1${expectation.dependsOn} `);
    applied.push(`corrigiu Depends on para "${expectation.dependsOn}", conforme o ledger`);
  }

  return { markdown: `${content}\n`, applied };
}
