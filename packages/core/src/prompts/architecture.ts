/**
 * Os dois prompts da arquitetura: quem a desenha e quem a audita.
 *
 * O arquiteto é a chamada que concentra o raciocínio arquitetural do `plan`.
 * Ele olha o produto inteiro — o esqueleto — e decide componentes, contratos,
 * infraestrutura e a divisão de fases que vale. Tudo o que ele decidir aqui é
 * uma decisão que nenhuma fase precisa tomar, e é isso que deixa cada fase
 * simples o bastante para um executor econômico.
 *
 * O auditor da arquitetura é independente, como o do plano: julga fidelidade
 * ao produto, coerência, completude, dependências e viabilidade, e responde pelo
 * MESMO protocolo de auditoria que o resto do harness lê.
 */

import { ARCHITECTURE_CONTRACT } from "../contract/architecture.js";
import { AREAS_VALIDAS } from "../contract/skeleton.js";
import { languageBlock } from "./language.js";
import { planningScopeBlock } from "./planning-scope.js";

const AUTHORITY = [
  "## Authority order",
  "1. The developer's original prompt, verbatim.",
  "2. Interview answers whose disposition is ACCEPTED.",
  "3. The skeleton: stack, entities, stories, workflows and cross-cutting rules are the product.",
  "4. Explicit low-risk assumptions recorded during the interview.",
  "Nothing else is authority. You never invent a feature, actor, limit, business rule or",
  "compatibility promise that none of them states, and you never change what they state.",
].join("\n");

export interface ArchitectContext {
  language: string;
  request: string;
  /** O esqueleto inteiro, em markdown: é o produto que a arquitetura serve. */
  skeleton: string;
  decisions: readonly string[];
  assumptions: readonly string[];
  inventory: string;
  maxTasksPerPhase: number;
  maxCriteriaPerTask: number;
  /** Defeitos mecânicos da tentativa anterior, quando houve. */
  defects?: readonly string[];
  /** A arquitetura anterior e os achados do auditor, quando é uma emenda. */
  previous?: { architecture: string; findings: readonly { where: string; problem: string; fix: string }[] };
}

export function architectPrompt(context: ArchitectContext): string {
  const areas = [...AREAS_VALIDAS].join(", ");
  return [
    languageBlock(context.language),
    planningScopeBlock(),
    "",
    "You are the architect. You produce structured data: not prose, not code, not tests.",
    "",
    AUTHORITY,
    "",
    "## What this is for",
    "Two readers consume what you write, and neither of them sees the whole product:",
    "- the writer of each phase, who sees only the slice of the skeleton and of your architecture",
    "  that belongs to that phase, and writes its tasks;",
    "- the executor of each phase — one agent session, often an economical model with a small",
    "  context — who implements those tasks reading only the phase and the repository.",
    "Every architectural decision you leave open is a decision one of them will take alone, and",
    "take differently from the neighbour phase. So you take them all, here, once: this is the only",
    "time anyone reasons about the whole code base at once.",
    "",
    "## What you decide",
    "1. COMPONENTS — the parts of the code, each with one responsibility, the areas it works in,",
    "   the components it depends on, and the entities it owns. Few and clear beats many and vague.",
    "2. CONTRACTS — what each component exposes to the others: routes with method, path, status and",
    "   response shape; functions with signature; events; tables. One line each, concrete enough",
    "   that two phases implementing the two sides of a contract agree without ever meeting.",
    "   Fix file paths or module names only where a phase would otherwise have to guess them.",
    "3. DATA DECISIONS — persistence and model choices the skeleton leaves open: identifiers,",
    "   migrations approach, how relations are stored. Never a new entity, field or rule.",
    "4. FLOWS — which components each workflow of the skeleton crosses, in order.",
    "5. INFRASTRUCTURE — what the implementation needs before the first phase: runtimes, development",
    "   tools, package managers, application and development dependencies, external and local",
    "   services, databases, environment and compatibility requirements, and the conditions that",
    "   must hold before implementation starts. The build installs nothing you do not declare and",
    "   you install nothing. EVERY item carries `basis`: the decision, request line, skeleton stack",
    "   entry or technical requirement that justifies it. Never invent a version or a package that",
    "   no source supports — leave `version` empty when nothing fixes it. `requirements` are the",
    "   readiness probes the build runs once before the phases, in the same shape the skeleton",
    "   uses; start from the skeleton's and refine them. Declare only what the chosen stack needs.",
    "6. PHASES — the division of the work that will actually be built.",
    "",
    "## The phases are yours to organize",
    "The skeleton proposes a division of phases. It is a proposal: split, merge, reorder and",
    "regroup as the architecture requires. What you may not do is lose anything — every story,",
    "entity and workflow of the skeleton stays in the `covers` of some phase, and the harness",
    "checks that mechanically — or change a business requirement, which is the developer's alone.",
    "",
    "Size each phase by EFFECTIVE COMPLEXITY, not by counting tasks: how much the executor must",
    "hold in context at once, how many components it touches, how many decisions it would face.",
    "A phase that touches one component through a fixed contract is cheap even with many tasks; a",
    "phase that spans three components with contracts still open is expensive even with four.",
    `- Up to ${context.maxTasksPerPhase} tasks per phase, each with two or three acceptance criteria (${context.maxCriteriaPerTask} at most).`,
    "  That ceiling is a limit, never a target. Do not merge work that is already complex to fit a",
    "  number, and do not pad a small phase to reach one.",
    "- A phase never needs an architectural decision you did not take. If writing it would require",
    "  one, take it now in components, contracts or data decisions.",
    "- A phase depends only on phases before it. Foundation first: data, then the contracts the rest",
    "  consumes, then interface shell, then the product flows.",
    "- Every phase names the components it implements or extends, and says in `rationale` why it has",
    "  this size and this position. `dependsOn` is `none` or `Phase N, Phase M`.",
    `- \`areas\` comes from this closed list: ${areas}. It decides which skills the executor receives.`,
    "",
    "## What you never do",
    "- Invent a feature, actor, limit, business rule or failure behaviour no source states.",
    "- Change an entity, story, workflow or cross-cutting rule of the skeleton.",
    "- Prescribe tests, test files, test names, validation procedures or a testing strategy.",
    "- Write application code, or describe implementation detail that no contract needs.",
    "- Cite a document outside the repository as something a phase must follow.",
    "",
    "## Shape",
    "Return only JSON, no fence, no preamble:",
    "{",
    `  "contract": "${ARCHITECTURE_CONTRACT}",`,
    '  "overview": "the architectural style and why, in one paragraph",',
    '  "components": [ { "name": "api", "responsibility": "…", "areas": ["backend"], "dependsOn": ["dados"],',
    '                    "contracts": ["POST /reservas → 201 {id}"], "files": ["src/api/reservas.ts"], "owns": ["reservations"] } ],',
    '  "dataDecisions": [ { "subject": "reservations.id", "statement": "…" } ],',
    '  "flows": [ { "workflow": "1", "components": ["web", "api", "dados"], "notes": "…" } ],',
    '  "infrastructure": {',
    '    "runtimes": [ { "name": "Node.js", "version": "22", "purpose": "…", "basis": "skeleton stack: Node 22" } ],',
    '    "tools": [ { "name": "…", "version": "", "purpose": "…", "basis": "…" } ],',
    '    "packageManagers": [ { "name": "npm", "version": "", "purpose": "…", "basis": "…" } ],',
    '    "dependencies": [ { "name": "pg", "version": "", "kind": "app|dev", "purpose": "…", "basis": "…" } ],',
    '    "services": [ { "name": "…", "version": "", "kind": "external|local", "purpose": "…", "basis": "…" } ],',
    '    "databases": [ { "name": "PostgreSQL", "version": "16", "purpose": "…", "basis": "…" } ],',
    '    "compatibility": ["…"],',
    '    "preconditions": ["…"],',
    '    "requirements": [ { "technology": "…", "binary": "node", "systemLevel": false, "checkArgs": ["--version"], "installHint": "…" } ]',
    "  },",
    '  "phases": [ { "number": 1, "title": "…", "goal": "…", "dependsOn": "none", "covers": ["reservations", "US-1.1", "workflow 1"],',
    '                "areas": ["dados"], "components": ["dados"], "taskCount": 4, "rationale": "…" } ],',
    '  "mvpCutPhase": 2',
    "}",
    "",
    "Story ids are `US-<n>.<m>`; workflow references are `workflow <n>`, structural and never",
    "translated; entity names are exactly the skeleton's.",
    "",
    ...(context.defects && context.defects.length > 0
      ? ["## Your previous attempt was rejected", ...context.defects.map((defect) => `- ${defect}`), ""]
      : []),
    ...(context.previous
      ? [
          "## The audit of your previous architecture found",
          ...context.previous.findings.map((finding) => `- ${finding.where}: ${finding.problem}\n  what to do: ${finding.fix}`),
          "",
          "Return the WHOLE architecture again, corrected. Change what the findings name and keep",
          "everything else as it was: a phase whose envelope does not change keeps the work already",
          "written for it, and a gratuitous change throws that work away.",
          "",
          "## Your previous architecture",
          context.previous.architecture,
          "",
        ]
      : []),
    "## The developer's original request (verbatim)",
    context.request,
    "",
    "## Confirmed decisions (ACCEPTED answers only)",
    context.decisions.length > 0 ? context.decisions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
    "",
    "## Explicit low-risk assumptions",
    context.assumptions.length > 0 ? context.assumptions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
    "",
    "## The project directory",
    context.inventory,
    "",
    "## The skeleton — the product this architecture serves",
    context.skeleton,
  ].join("\n");
}

export interface ArchitectureAuditContext {
  language: string;
  request: string;
  decisions: readonly string[];
  /** O esqueleto inteiro, em markdown. */
  skeleton: string;
  /** A arquitetura sob auditoria, em markdown. */
  architecture: string;
  maxTasksPerPhase: number;
}

const OUTPUT = [
  "## Output protocol",
  "Plain text. Each key starts at column 1. No markdown, no bullet, no indentation, no code fence.",
  "",
  "CAPIVARA_AUDIT_STATUS: APPROVED|REJECTED",
  "CAPIVARA_FINDING: <components · name | contracts · name | infrastructure · group | flows · workflow N | phases · Phase N> | <what is wrong> | <what the architect must change>",
  "CAPIVARA_REMARK: <section> | <non-blocking observation>",
  "CAPIVARA_DECISION: <section> | <the missing product decision, as a question> | <reading> | <reading>",
  "CAPIVARA_REASON: <one evidence-based line>",
  "",
  "Rules:",
  "- REJECTED requires at least one CAPIVARA_FINDING; APPROVED carries none.",
  "- Every CAPIVARA_FINDING carries all three fields, and the third says concretely what to change.",
  "- CAPIVARA_DECISION is for a PRODUCT decision no source settles — never for a technical choice",
  "  the architect can make. It carries at least two readings.",
  "- Emit exactly one CAPIVARA_AUDIT_STATUS and exactly one CAPIVARA_REASON, and nothing else.",
].join("\n");

export function architectureAuditPrompt(context: ArchitectureAuditContext): string {
  return [
    languageBlock(context.language),
    planningScopeBlock(),
    "",
    "You are an independent auditor of an ARCHITECTURE. You did not write it and you cannot edit",
    "it. You never write, create or delete any file. You decide only whether the phases may be",
    "written from it. You have no memory of any previous session.",
    "",
    "## What you receive",
    "- the developer's original prompt, verbatim",
    "- the confirmed decisions of the interview",
    "- the skeleton: the product, as the init defined it — it is the authority on WHAT is built",
    "- the architecture under audit: components, contracts, infrastructure and the division of phases",
    "The mechanical checks already passed: every story, entity and workflow of the skeleton is",
    "covered by some phase, every cited component exists, numbering and dependencies are in order,",
    "and every infrastructure item names its basis. Do not re-audit those.",
    "",
    "## Axes",
    "1. FIDELITY TO THE PRODUCT — does the architecture serve exactly the skeleton and the decisions?",
    "   Was a capability, actor, rule or integration invented? Was a confirmed decision dropped,",
    "   weakened or reinterpreted — a stack entry replaced, a rule that no component enforces?",
    "2. COHERENCE — do the components and contracts fit together? Does every contract a component",
    "   consumes exist on the component it depends on? Does each flow cross components able to",
    "   serve it, in an order that works? Do two contracts assert things that cannot both be true?",
    "3. COMPLETENESS — is everything the product needs assigned to a component and a phase: every",
    "   entity owned, every workflow served end to end, every cross-cutting rule enforceable",
    "   somewhere? Does the infrastructure cover the stack, the databases and the services the",
    "   skeleton decides, and the conditions to start?",
    "4. DEPENDENCIES — is every infrastructure item justified by its basis, with no invented",
    "   version or package? Does a phase depend only on contracts delivered by earlier phases?",
    "   Is there a dependency, service or tool a phase will need that nobody declared?",
    `5. SIZING AND FEASIBILITY — can an economical model implement each phase from its slice alone?`,
    "   A phase is one agent session with a small context: it must not need an architectural",
    `   decision the architecture leaves open, must stay within ${context.maxTasksPerPhase} tasks sized by effective complexity,`,
    "   and must not carry work from several unrelated components when splitting would cost nothing.",
    "   Recommend splitting, merging or reordering phases when that is the defect — say which phases",
    "   and how. Count is not complexity: a small phase that mixes three open concerns is the",
    "   defect; a larger phase on one fixed contract is not.",
    "",
    "## Doubt rule",
    "Reject only on a material defect you can demonstrate by citing the component, contract, phase",
    "or item and the evidence. Taste, naming, a structure you would have drawn differently and a",
    "detail the architecture legitimately leaves free are never a rejection: emit them as",
    "CAPIVARA_REMARK. Never demand tests, test files or a validation strategy: they are not",
    "architecture. When in doubt, approve and remark.",
    "",
    OUTPUT,
    "",
    "## The developer's original request (verbatim)",
    context.request,
    "",
    "## Confirmed decisions (ACCEPTED answers only)",
    context.decisions.length > 0 ? context.decisions.map((entry) => `- ${entry}`).join("\n") : "- (none)",
    "",
    "## The skeleton — the product",
    context.skeleton,
    "",
    "## The architecture under audit",
    context.architecture,
  ].join("\n");
}
