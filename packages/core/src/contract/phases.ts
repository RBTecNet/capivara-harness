/**
 * ★ AUTORIDADE ÚNICA da gramática `capivara-phases/v1`.
 *
 * `capivara init` valida o documento com `parsePhases`. `capivara build` divide
 * o documento em sessões com o MESMO `parsePhases`, lendo `PhaseBlock.markdown`.
 * Não existe um segundo parser: divergir entre o que se valida e o que se
 * executa é mecanicamente impossível, e é essa a tese do produto.
 *
 * Nenhum outro módulo de `src/` pode conter uma expressão regular de fase ou de
 * task. Um teste de arquitetura falha se isso acontecer.
 *
 * O parser é puro: recebe texto, devolve árvore ou erros, e nunca lança.
 */

import { type InvariantCode, PHASES_CONTRACT } from "./invariants.js";

export { PHASES_CONTRACT };

export interface ContractError {
  code: InvariantCode;
  /** Linha 1-based no documento original. 0 quando o defeito não tem linha. */
  line: number;
  /** O que está errado. */
  message: string;
  /** O que fazer. Uma mensagem que só descreve o defeito não ajuda quem corrige. */
  hint: string;
}

export interface TaskBlock {
  /** Índice 1-based dentro da fase. É o `<n>` das linhas `TASK <n>: DONE`. */
  index: number;
  done: boolean;
  title: string;
  acceptanceCriteria: string[];
  featureTests: string[];
  designRef: string | null;
  traces: string[];
  line: number;
}

export interface SubPhaseBlock {
  phase: number;
  number: number;
  title: string;
  line: number;
}

export interface PhaseBlock {
  number: number;
  title: string;
  goal: string;
  dependsOn: string;
  covers: string;
  subPhases: SubPhaseBlock[];
  /** Todas as tasks da fase, em ordem de leitura, atravessando as sub-fases. */
  tasks: TaskBlock[];
  line: number;
  /** O recorte exato entregue ao agente. O divisor do loop não corta de novo. */
  markdown: string;
}

export interface InputStamp {
  raw: string;
  line: number;
  inputs: { name: string; sha12: string }[];
}

export interface PhasesDocument {
  contract: typeof PHASES_CONTRACT;
  projectName: string;
  stamp: InputStamp | null;
  phases: PhaseBlock[];
}

export type ParseResult =
  | { ok: true; document: PhasesDocument }
  | { ok: false; errors: ContractError[] };

const TITLE = /^# (.+) — Project Phases$/;
const STAMP = /^<!-- inputs:((?: [A-Za-z0-9._-]+@sha256:[0-9a-f]{12})+) -->$/;
const STAMP_ENTRY = /([A-Za-z0-9._-]+)@sha256:([0-9a-f]{12})/g;
const HEADING_2 = /^## (.*)$/;
const HEADING_3 = /^### (.*)$/;
const PHASE_HEADING = /^Phase (\d+): (\S.*)$/;
const SUBPHASE_HEADING = /^Phase (\d+)\.(\d+): (\S.*)$/;
const PHASE_WORD = /^Phase\b/;
const METADATA = /\*\*Goal:\*\*\s*(.*?)\s*·\s*\*\*Depends on:\*\*\s*(.*?)\s*·\s*\*\*Covers:\*\*\s*(.*?)\s*$/;
const TASK = /^- \[([ xX])\] \*\*Task:\*\* (\S.*)$/;
const CRITERIA_LABEL = "- **Acceptance criteria:**";
const FEATURE_TESTS = /^- \*\*Feature tests:\*\* (\S.*)$/;
const DESIGN_REF = /^- \*\*Design ref:\*\* (\S.*)$/;
const TRACES = /^- \*\*Traces:\*\* (\S.*)$/;
const CRITERION = /^- (\S.*)$/;
/** Um rótulo de task sem conteúdo na linha: introduz uma lista, não afirma nada. */
const STRUCTURAL_ONLY = /^-?\s*\*\*(?:Acceptance criteria|Feature tests|Traces|Design ref):\*\*\s*$/;
const NEEDS_DECISION = "[NEEDS DECISION]";

interface PhaseDraft {
  number: number;
  title: string;
  goal: string | null;
  dependsOn: string;
  covers: string;
  subPhases: SubPhaseBlock[];
  tasks: TaskBlock[];
  line: number;
  startIndex: number;
  endIndex: number;
}

export function parsePhases(source: string): ParseResult {
  const lines = source.split(/\r?\n/);
  const errors: ContractError[] = [];
  const drafts: PhaseDraft[] = [];

  const projectName = readTitle(lines, errors);
  const stamp = readStamp(lines, errors);

  let phase: PhaseDraft | null = null;
  let task: TaskBlock | null = null;
  let inCriteria = false;

  const closePhase = (endIndex: number): void => {
    if (!phase) return;
    phase.endIndex = endIndex;
    drafts.push(phase);
    phase = null;
    task = null;
    inCriteria = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = index + 1;

    if (raw.includes(NEEDS_DECISION)) {
      errors.push({
        code: "I-13",
        line,
        message: "o documento contém um marcador [NEEDS DECISION]",
        hint: "resolva a decisão na entrevista e reescreva o trecho; um gap aberto não pode entrar no loop",
      });
    }

    const heading2 = HEADING_2.exec(raw);
    if (heading2) {
      const rest = heading2[1] ?? "";
      const phaseHeading = PHASE_HEADING.exec(rest);
      if (phaseHeading) {
        closePhase(index);
        phase = {
          number: Number(phaseHeading[1]),
          title: (phaseHeading[2] ?? "").trim(),
          goal: null,
          dependsOn: "",
          covers: "",
          subPhases: [],
          tasks: [],
          line,
          startIndex: index,
          endIndex: lines.length,
        };
        continue;
      }
      if (PHASE_WORD.test(rest)) {
        errors.push({
          code: "I-04",
          line,
          message: `heading de fase fora do formato: "${raw.trim()}"`,
          hint: "use exatamente `## Phase <N>: <título>`, com N inteiro e título não vazio; um heading fora do formato some do run sem aviso",
        });
      }
      closePhase(index);
      continue;
    }

    const heading3 = HEADING_3.exec(raw);
    if (heading3) {
      const rest = heading3[1] ?? "";
      task = null;
      inCriteria = false;
      const subPhase = SUBPHASE_HEADING.exec(rest);
      if (subPhase) {
        const major = Number(subPhase[1]);
        if (!phase) {
          errors.push({
            code: "I-05",
            line,
            message: `sub-fase "${rest}" aparece fora de qualquer fase`,
            hint: "mova a sub-fase para dentro de uma `## Phase <N>:` ou promova-a a fase própria",
          });
        } else if (major !== phase.number) {
          errors.push({
            code: "I-05",
            line,
            message: `sub-fase ${major}.${subPhase[2]} está dentro da Phase ${phase.number}`,
            hint: `renumere para ${phase.number}.${subPhase[2]} ou mova o bloco para a Phase ${major}`,
          });
        } else {
          phase.subPhases.push({
            phase: major,
            number: Number(subPhase[2]),
            title: (subPhase[3] ?? "").trim(),
            line,
          });
        }
        continue;
      }
      if (PHASE_WORD.test(rest)) {
        errors.push({
          code: "I-05",
          line,
          message: `sub-fase fora do formato: "${raw.trim()}"`,
          hint: "use exatamente `### Phase <N>.<M>: <título>`; nível 2 transformaria a sub-fase numa sessão própria",
        });
      }
      continue;
    }

    if (!phase) continue;

    if (phase.goal === null) {
      const metadata = METADATA.exec(raw);
      if (metadata) {
        phase.goal = (metadata[1] ?? "").trim();
        phase.dependsOn = (metadata[2] ?? "").trim();
        phase.covers = (metadata[3] ?? "").trim();
        continue;
      }
    }

    const trimmed = raw.trim();

    const taskMatch = TASK.exec(trimmed);
    if (taskMatch) {
      task = {
        index: phase.tasks.length + 1,
        done: (taskMatch[1] ?? " ").toLowerCase() === "x",
        title: (taskMatch[2] ?? "").trim(),
        acceptanceCriteria: [],
        featureTests: [],
        designRef: null,
        traces: [],
        line,
      };
      phase.tasks.push(task);
      inCriteria = false;
      continue;
    }

    if (!task) continue;

    if (trimmed === "") {
      task = null;
      inCriteria = false;
      continue;
    }

    if (trimmed === CRITERIA_LABEL) {
      inCriteria = true;
      continue;
    }

    const featureTests = FEATURE_TESTS.exec(trimmed);
    if (featureTests) {
      task.featureTests.push((featureTests[1] ?? "").trim());
      inCriteria = false;
      continue;
    }

    const designRef = DESIGN_REF.exec(trimmed);
    if (designRef) {
      task.designRef = (designRef[1] ?? "").trim();
      inCriteria = false;
      continue;
    }

    const traces = TRACES.exec(trimmed);
    if (traces) {
      task.traces = (traces[1] ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      inCriteria = false;
      continue;
    }

    if (inCriteria) {
      /*
       * Rótulo estrutural nunca é critério.
       *
       * `- **Feature tests:**` sem texto na mesma linha não casa com o rótulo
       * inline, e caía aqui: virava um critério de aceitação que não afirma nada
       * sobre o sistema. No piloto 6 foram exatamente os 20 critérios que o
       * ensaio reprovou como UNOBSERVABLE — o verificador estava certo, e o
       * defeito era desta leitura.
       */
      if (STRUCTURAL_ONLY.test(trimmed)) {
        inCriteria = false;
        continue;
      }
      const criterion = CRITERION.exec(trimmed);
      if (criterion) task.acceptanceCriteria.push((criterion[1] ?? "").trim());
    }
  }

  closePhase(lines.length);

  checkNumbering(drafts, errors);
  checkPhaseBodies(drafts, errors);

  if (errors.length > 0) return { ok: false, errors: sortErrors(errors) };

  return {
    ok: true,
    document: {
      contract: PHASES_CONTRACT,
      projectName,
      stamp,
      phases: drafts.map((draft) => ({
        number: draft.number,
        title: draft.title,
        goal: draft.goal ?? "",
        dependsOn: draft.dependsOn,
        covers: draft.covers,
        subPhases: draft.subPhases,
        tasks: draft.tasks,
        line: draft.line,
        markdown: lines.slice(draft.startIndex, draft.endIndex).join("\n").replace(/\s+$/, "") + "\n",
      })),
    },
  };
}

function readTitle(lines: string[], errors: ContractError[]): string {
  const first = lines[0] ?? "";
  const match = TITLE.exec(first);
  if (match) return (match[1] ?? "").trim();
  errors.push({
    code: "I-01",
    line: 1,
    message: `a linha 1 não é o título do plano: "${first.trim()}"`,
    hint: "a primeira linha deve ser exatamente `# <nome do projeto> — Project Phases`, com travessão (—), não hífen",
  });
  return "";
}

function readStamp(lines: string[], errors: ContractError[]): InputStamp | null {
  const raw = (lines[2] ?? "").trim();
  const match = STAMP.exec(raw);
  if (!match) {
    errors.push({
      code: "I-02",
      line: 3,
      message: raw === "" ? "a linha 3 não traz o stamp de inputs" : `a linha 3 não é um stamp válido: "${raw}"`,
      hint: "escreva `<!-- inputs: <arquivo>@sha256:<12 hex> ... -->` com os 12 primeiros caracteres do sha256 de cada documento de entrada",
    });
    return null;
  }
  const inputs: { name: string; sha12: string }[] = [];
  for (const entry of (match[1] ?? "").matchAll(STAMP_ENTRY)) {
    inputs.push({ name: entry[1] ?? "", sha12: entry[2] ?? "" });
  }
  return { raw, line: 3, inputs };
}

function checkNumbering(drafts: PhaseDraft[], errors: ContractError[]): void {
  if (drafts.length === 0) {
    errors.push({
      code: "I-03",
      line: 0,
      message: "o documento não declara nenhuma fase",
      hint: "adicione ao menos uma `## Phase 1: <título>`; sem fase o loop não tem o que executar",
    });
    return;
  }
  drafts.forEach((draft, position) => {
    const expected = position + 1;
    if (draft.number !== expected) {
      errors.push({
        code: "I-03",
        line: draft.line,
        message: `esperava Phase ${expected} e encontrou Phase ${draft.number}`,
        hint: `renumere as fases para uma sequência contígua a partir de 1; a referência por número é como o operador seleciona uma fase`,
      });
    }
  });
}

function checkPhaseBodies(drafts: PhaseDraft[], errors: ContractError[]): void {
  for (const draft of drafts) {
    if (draft.goal === null) {
      errors.push({
        code: "I-03",
        line: draft.line,
        message: `a Phase ${draft.number} não declara a linha de metadados`,
        hint: "adicione `**Goal:** <resultado observável> · **Depends on:** <none | Phase N> · **Covers:** <stories/entidades/workflows>` logo abaixo do heading",
      });
    }
    if (draft.tasks.length === 0) {
      errors.push({
        code: "I-07",
        line: draft.line,
        message: `a Phase ${draft.number} não declara nenhuma task`,
        hint: "adicione ao menos uma `- [ ] **Task:** <o que construir>` ou remova a fase",
      });
    }
    for (const task of draft.tasks) {
      if (task.acceptanceCriteria.length === 0) {
        errors.push({
          code: "I-08",
          line: task.line,
          message: `a task ${task.index} da Phase ${draft.number} não declara critério de aceitação`,
          hint: "adicione `- **Acceptance criteria:**` seguido de ao menos uma condição observável; sem critério o verificador não consegue decidir DONE ou INCOMPLETE",
        });
      }
      if (task.traces.length === 0) {
        errors.push({
          code: "I-09",
          line: task.line,
          message: `a task ${task.index} da Phase ${draft.number} não declara Traces`,
          hint: "adicione `- **Traces:** <US-N.M / entidade / workflow>` citando a origem desta task",
        });
      }
    }
  }
}

function sortErrors(errors: ContractError[]): ContractError[] {
  return [...errors].sort((left, right) => left.line - right.line || left.code.localeCompare(right.code));
}

/**
 * I-14. O acesso ao disco fica no chamador: `exists` responde se um caminho
 * relativo ao projeto existe, e a verificação continua pura.
 */
export function checkDesignRefs(
  document: PhasesDocument,
  designRoot: string,
  exists: (path: string) => boolean,
): ContractError[] {
  const errors: ContractError[] = [];
  for (const phase of document.phases) {
    for (const task of phase.tasks) {
      if (task.designRef === null) continue;
      if (exists(task.designRef)) continue;
      errors.push({
        code: "I-14",
        line: task.line,
        message: `a task ${task.index} da Phase ${phase.number} aponta para um design inexistente: ${task.designRef}`,
        hint: `crie o artefato em ${designRoot} ou remova o **Design ref:**; referência morta faz o executor implementar por conta própria achando que seguiu um design`,
      });
    }
  }
  return errors;
}
