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
const TASK_LINE = /^\s*-\s*\[[ xX]\]\s*\*\*Task:\*\*/;
const SUB_PHASE = /^###\s+Phase\s+\d+\.\d+\s*:/;
/** O rótulo de critérios com texto colado na mesma linha. */
const INLINE_CRITERIA = /^-\s*\*\*Acceptance criteria:\*\*\s+(\S.*)$/;
/** Um rótulo de task na margem, sem o traço que o faz item de lista. */
const NAKED_LABEL = /^(\s*)(\*\*(?:Acceptance criteria|Feature tests|Traces|Design ref):\*\*.*)$/;
/** Um heading de fase com qualquer número, para reconhecer o número errado. */
const OUTRA_FASE = /^##\s+Phase\s+(\d+)\s*:/;

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
/*
 * Traces E Covers.
 *
 * O normalizador nasceu olhando só para Traces, e a tradução reapareceu em
 * Covers — onde sobreviveu até o documento publicado. As duas linhas carregam o
 * mesmo rótulo estrutural, e a cobertura lê o rótulo, não a prosa.
 */
const LABEL_LINE = /\*\*(?:Traces|Covers):\*\*/;

/**
 * A linha de metadados da fase é UMA, com os campos separados por `·`.
 *
 * O modelo às vezes escreve os três em linhas separadas, com quebra de markdown
 * no fim. O parser recusa — `I-03: a fase não declara a linha de metadados` — e
 * o run inteiro morre no gate por causa de duas quebras de linha. Isso é
 * verificável e consertável em código, então não se pede ao modelo.
 */
const GOAL_LINE = /^\s*\*\*Goal:\*\*\s*(.*?)\s*$/;
const DEPENDS_LINE = /^\s*\*\*Depends on:\*\*\s*(.*?)\s*$/;
const COVERS_LINE = /^\s*\*\*Covers:\*\*\s*(.*?)\s*$/;
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

  let start = lines.findIndex((line) => line.startsWith(phaseHeading(expectation.phaseNumber)));

  /*
   * Fase certa, número errado.
   *
   * O escritor recebeu "escreva a fase 1" e devolveu "## Phase 4: ...". O número
   * correto não é palpite: quem pediu a parte sabe qual ela é. Enquanto isto não
   * era corrigido aqui, a parte voltava sem normalizar, o documento era montado
   * com a fase fora de posição, e o parser reclamava I-03 — uma rodada inteira de
   * auditoria gasta num erro que se conserta contando.
   *
   * No piloto 6 foram três das sete fases de uma vez, com um escritor mais fraco.
   *
   * Só com UM heading de fase no texto: com vários, não se sabe qual é a fase
   * pedida, e aí devolver como veio continua sendo melhor do que recortar no
   * escuro e esvaziar o conteúdo em silêncio.
   */
  if (start === -1) {
    const cabecalhos = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => OUTRA_FASE.test(entry.line));

    if (cabecalhos.length === 1) {
      const alvo = cabecalhos[0]!;
      const errado = OUTRA_FASE.exec(alvo.line)?.[1] ?? "?";
      lines[alvo.index] = alvo.line.replace(OUTRA_FASE, `## Phase ${expectation.phaseNumber}:`);
      applied.push(`corrigiu o número da fase no heading: veio ${errado}, esta parte é a ${expectation.phaseNumber}`);
      start = alvo.index;
    }
  }

  if (start === -1) {
    // Sem heading de fase nenhum não há como saber onde ela começa. Recortar no
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

  const metadados = joinPhaseMetadata(content);
  if (metadados.applied) {
    content = metadados.content;
    applied.push("juntou os metadados da fase numa linha só, como o contrato exige");
  }

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
 * Só mexe nas linhas de Traces e Covers: "fluxo" no meio de um critério é prosa
 * legítima e continua prosa. O rótulo estrutural é o que a cobertura lê.
 */
export function canonicalWorkflowTraces(markdown: string): { content: string; applied: boolean } {
  let applied = false;
  const content = markdown
    .split("\n")
    .map((line) => {
      // `Covers` vive no meio da linha de metadados, entre Goal e Depends on:
      // por isso a linha inteira é considerada, e não só o que vem depois do
      // rótulo. Linha de metadados é estrutural de ponta a ponta.
      if (!LABEL_LINE.test(line)) return line;
      return line.replace(TRANSLATED_WORKFLOW, (inteiro, numero: string) => {
        const canonico = `workflow ${Number(numero)}`;
        if (inteiro.toLowerCase() !== canonico) applied = true;
        return canonico;
      });
    })
    .join("\n");
  return { content, applied };
}

/**
 * Junta `Goal`, `Depends on` e `Covers` numa linha, quando vieram separados.
 *
 * O contrato exige os três numa linha só, separados por `·`. Escritos em linhas
 * distintas — com ou sem quebra de markdown no fim — o parser não reconhece a
 * fase e o run inteiro para no gate. Duas quebras de linha derrubando três horas
 * de trabalho é exatamente o tipo de coisa que o runtime tem obrigação de
 * consertar sozinho.
 */
export function joinPhaseMetadata(markdown: string): { content: string; applied: boolean } {
  const lines = markdown.split("\n");

  const goalAt = lines.findIndex((line) => GOAL_LINE.test(line));
  if (goalAt === -1) return { content: markdown, applied: false };

  // Já está numa linha só quando a própria linha do Goal carrega os outros dois.
  const goalLine = lines[goalAt] ?? "";
  if (/\*\*Depends on:\*\*/.test(goalLine) && /\*\*Covers:\*\*/.test(goalLine)) {
    return { content: markdown, applied: false };
  }

  const goal = GOAL_LINE.exec(goalLine)?.[1] ?? "";
  let dependsAt = -1;
  let coversAt = -1;
  let depends = "";
  let covers = "";

  // Procura só logo abaixo: metadados de outra fase não são desta.
  for (let index = goalAt + 1; index < Math.min(lines.length, goalAt + 5); index += 1) {
    const line = lines[index] ?? "";
    const comDepends = DEPENDS_LINE.exec(line);
    if (comDepends && dependsAt === -1) {
      dependsAt = index;
      depends = comDepends[1] ?? "";
      continue;
    }
    const comCovers = COVERS_LINE.exec(line);
    if (comCovers && coversAt === -1) {
      coversAt = index;
      covers = comCovers[1] ?? "";
    }
  }

  if (dependsAt === -1 || coversAt === -1) return { content: markdown, applied: false };

  const junta = `**Goal:** ${goal.replace(/\s+$/, "")} · **Depends on:** ${depends.replace(/\s+$/, "")} · **Covers:** ${covers.replace(/\s+$/, "")}`;
  const restantes = lines.filter((_line, index) => index !== dependsAt && index !== coversAt);
  restantes[goalAt] = junta;

  return { content: restantes.join("\n"), applied: true };
}

/**
 * Só as tasks, do que o modelo devolveu.
 *
 * Ele foi instruído a emitir apenas as tasks, mas um escritor barato escreve o
 * heading assim mesmo, ou um "Claro! Aqui vai:" antes. Nada disso é erro que
 * precise voltar para ele: o envelope é montado em código e o que sobra é
 * descartável. Descartar é mecânico, então é feito aqui.
 *
 * O corte começa na primeira linha que é task ou sub-fase, e termina antes de
 * qualquer nível 2 — que encerraria a captura do parser e sumiria com o resto da
 * fase sem aviso.
 */
export function extractTasks(markdown: string): { tasks: string; applied: string[] } {
  const applied: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  const inicio = lines.findIndex((line) => TASK_LINE.test(line) || SUB_PHASE.test(line));
  if (inicio === -1) return { tasks: markdown.trim(), applied: ["não achei task nenhuma; devolvido como veio"] };
  if (inicio > 0) {
    lines.splice(0, inicio);
    applied.push("descartou o que vinha antes da primeira task");
  }

  const corte = lines.findIndex((line) => LEVEL_2.test(line));
  if (corte > 0) {
    lines.splice(corte);
    applied.push("descartou uma seção de nível 2, que encerraria a captura da fase");
  }

  const traduzidos = canonicalWorkflowTraces(lines.join("\n"));
  if (traduzidos.applied) applied.push("traduziu de volta a referência de workflow nos Traces");

  const rotulos = repairMissingBullets(traduzidos.content);
  if (rotulos.applied > 0) applied.push(`devolveu o traço a ${rotulos.applied} rótulo(s) de task escritos na margem`);

  const criterios = repairInlineCriteria(rotulos.content);
  if (criterios.applied > 0) {
    applied.push(`abriu os critérios de ${criterios.applied} task(s) que vieram colados na linha do rótulo`);
  }

  return { tasks: criterios.content.replace(/\s+$/, ""), applied };
}

/**
 * Critérios escritos na mesma linha do rótulo.
 *
 * A gramática quer o rótulo sozinho e os critérios como itens abaixo dele. Um
 * escritor barato escreve tudo numa linha, separado por ponto e vírgula:
 *
 *     - **Acceptance criteria:** a tabela existe; o índice existe; o seed roda
 *
 * O parser então não vê critério nenhum e reprova a task com I-08. No piloto 6
 * isso sozinho foram 39 dos 49 defeitos do plano — quatro quintos de um run
 * perdido, numa diferença de formatação que não muda o que foi decidido.
 *
 * Quebrar por ponto e vírgula é heurística, e é a heurística certa: o texto veio
 * de uma lista e o separador é o que a lista usou. Sem ponto e vírgula, vira um
 * critério só — que é exatamente o que foi escrito.
 */
export function repairInlineCriteria(markdown: string): { content: string; applied: number } {
  let applied = 0;
  const saida: string[] = [];

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const inline = INLINE_CRITERIA.exec(line.trim());
    if (!inline) {
      saida.push(line);
      continue;
    }

    const criterios = (inline[1] ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    if (criterios.length === 0) {
      saida.push(line);
      continue;
    }

    applied += 1;
    saida.push("  - **Acceptance criteria:**");
    for (const criterio of criterios) saida.push(`    - ${criterio}`);
  }

  return { content: saida.join("\n"), applied };
}

/**
 * Rótulo de task escrito sem o traço da lista.
 *
 * O parser casa `- **Traces:** …` como item de lista. O mesmo rótulo sem o
 * traço — `**Traces:** …` — não casa com nada e a task fica sem o campo, embora
 * ele esteja escrito ali, legível, uma coluna à esquerda.
 *
 * É a irmã de `repairInlineCriteria`: as duas são a mesma task, escrita com
 * markdown ligeiramente diferente do que o contrato pede. Nenhuma das duas muda
 * o que foi decidido, e por isso nenhuma das duas deveria custar uma devolução.
 */
export function repairMissingBullets(markdown: string): { content: string; applied: number } {
  let applied = 0;
  const saida = markdown.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const rotulo = NAKED_LABEL.exec(line);
    if (!rotulo) return line;
    applied += 1;
    return `${rotulo[1] ?? ""}- ${(rotulo[2] ?? "").trim()}`;
  });
  return { content: saida.join("\n"), applied };
}
