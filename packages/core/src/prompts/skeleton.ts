/**
 * Os dois prompts do caminho por esqueleto.
 *
 * O primeiro pensa o produto inteiro, uma vez. O segundo escreve uma fase vendo
 * apenas a fatia dela. É a troca que o desenvolvedor pediu depois de ver a
 * medição: hoje o modelo reconstrói o entendimento do projeto todo em cada uma
 * das ~50 chamadas do plano, e 77% do que ele processa é esse contexto, não a
 * tarefa.
 */

import { languageBlock } from "./language.js";
import { planningScopeBlock } from "./planning-scope.js";

const AUTHORITY = [
  "## Authority order",
  "1. The developer's original prompt, verbatim.",
  "2. Interview answers whose disposition is ACCEPTED.",
  "3. Explicit low-risk assumptions recorded during the interview.",
  "Nothing else is authority. Never invent a feature, actor, limit, number, platform or failure",
  "behaviour that none of them states.",
].join("\n");

export interface SkeletonContext {
  language: string;
  request: string;
  decisions: string[];
  assumptions: string[];
  inventory: string;
  /** Tetos que o plano precisa respeitar para o loop conseguir executá-lo. */
  maxTasksPerPhase: number;
  maxCriteriaPerTask: number;
  /** Defeitos da tentativa anterior, quando houve. */
  defects?: string[];
}

export function skeletonPrompt(context: SkeletonContext): string {
  return [
    languageBlock(context.language),
    planningScopeBlock(),
    "",
    "You are designing the execution skeleton of a product. You produce structured data, not prose.",
    "",
    AUTHORITY,
    "",
    "## What this is for",
    "Nobody reads this as a document. It is consumed by a loop that implements the product phase by",
    "phase, one agent session per phase. Everything you write is judged by a single question: can",
    "that loop execute it? Not whether it reads well, whether it is complete as literature, or",
    "whether it explains itself. Executable, or not.",
    "",
    "Each phase is written later seeing only its own slice of what you produce here, so whatever",
    "the product requires across phases — a field, a rule, a behaviour — has to be stated by you,",
    "now. What you do NOT decide is how the code is organised: the plan's architect reads this",
    "skeleton whole, after you, and decides components, contracts, files, infrastructure and the",
    "final division of phases.",
    "",
    "## Product, not implementation",
    "You describe the PRODUCT: what it does, which data it holds, which rules must hold, how the",
    "user interacts with it, what must be observable, and which constraints the request states.",
    "The architect decides the IMPLEMENTATION, and a decision you take here reaches him as a",
    "requirement he cannot question. So, unless the developer's request or a confirmed decision",
    "states it, never write:",
    "- a file or directory path, or a folder structure (`src/nucleo/api.ts`, `server/modulos/<modulo>/`);",
    "- the name of an environment variable, a port variable or a default file path;",
    "- a command, a script name or how the schema is created or migrated (`npm run migrar`,",
    "  `CREATE TABLE IF NOT EXISTS` at connection open);",
    "- a function, a signature, how modules register into the server or the router;",
    "- which files each phase owns, or which phases run at the same time;",
    "- anything about how the product is tested — it goes to the rules about tests, below.",
    "Write the behaviour the mechanism would serve instead. Not \"the schema is created with CREATE",
    "TABLE IF NOT EXISTS before the server accepts requests\" but \"the data of the three modules",
    "persists in a local SQLite file and is available after the application restarts\". Not \"the",
    "server reads APP_DB_PATH\" but \"the location of the database file can be changed by configuration\".",
    "A technology the request names (the language, the",
    "framework, the database engine) is the developer's choice: keep it in the stack, as stated.",
    "When the request itself fixes a path, a variable or a command, that is authority: keep it.",
    "The harness checks this mechanically and returns the terms it finds, so a mechanism you write",
    "costs a rewrite; a behaviour costs nothing.",
    "",
    "## Development environment — declared before implementation",
    "List every required runtime, package manager, compiler, external service and browser tool in environment.",
    "environment is mandatory in capivara-skeleton/v2. Use [] only when there is no external prerequisite; never omit it or use an older contract.",
    "Each entry names technology, binary, systemLevel and checkArgs for a finite read-only readiness check (exit 0 means ready); installHint says how to prepare it.",
    "Use argument arrays, never shell pipelines. Check actual service readiness where relevant, not only executable presence.",
    "When the request does not fix a version, adopt the version installed on the machine: the inventory names the Node.js and npm the harness runs.",
    "A version probe checks a minimum (>=), never an exact series nor a ceiling, unless the request demands it.",
    "The build cannot change the Node.js and npm the harness runs: requiring another version makes the build impossible.",
    "Declare only prerequisites needed by the chosen product stack, never tools needed just to satisfy a probe.",
    "The stack and the environment never name a test tool (a runner, a browser-automation framework): how the",
    "product is tested is decided in the build.",
    "",
    "## What the request says about tests is the build's",
    "A request for tests — automated tests, tests per module, tests against an isolated database, every test",
    "approved, a test tool the developer names — is an instruction to the build, like \"compile without errors\".",
    "Record it in `rules` whose subject starts with `testes.` (`testes.requisito`, `testes.banco`): one rule",
    "per demand, in the developer's terms, nothing invented. The build reads those rules; the plan never",
    "does. So nothing else in the skeleton mentions tests: no other stack entry, story, rule, phase title or",
    "goal — not \"each module has its own routes, services and tests\", only \"each module has its own",
    "routes and services\". The product side stays where it is: that the database location can be changed",
    "by configuration is product behaviour, and a rule.",
    "Use project-local compilers and dependencies; do not require global installations for convenience.",
    "Browser tooling used exclusively by the harness flow gate is prepared privately by the harness; do not require another global playwright CLI.",
    "Do not use screenshot-to-/dev/null probes: they fail because the destination has no image extension.",
    "Read secrets from environment without printing values. Never embed credentials in requirements or probe output.",
    "Do not probe application code that has not been built yet. Do not invent services or compatibility promises.",
    "The build prepares and approves this environment before development; phases must not recreate these checks as tasks.",
    "For HTTP products, shared rules must enumerate navigation paths separately from complete API endpoints, HTTP methods, response formats and the shared client's base prefix.",
    "The executor and independent workflow author receive these exact rules. Never leave either to guess an endpoint from a screen name.",
    "That is the interface contract of the product — routes and shapes — not its code: which file serves a route, which module holds the client, is the architect's.",
    "",
    "## The shared vocabulary is the part that cannot be vague",
    "If phase 3 creates a field and phase 7 reads it, they never see each other. They agree only",
    "through what you write. A name you leave loose becomes two different names; a rule you leave",
    "implicit becomes two different rules, and the loop discovers it when implementing one breaks",
    "the tests of the other.",
    "",
    "So `rules` carries every rule that crosses phases, and each one NAMES ITS TARGET AND ITS",
    "MOMENT. Not \"trim whitespace\" — say what is trimmed, when, and what is left untouched:",
    '  "cartoes.titulo: stored trimmed at both ends on save; comparison for search and uniqueness',
    '   ignores case and accents and does not alter the stored value; inner spaces are preserved"',
    "A rule that names an operation without naming what it operates on is the single defect that",
    "cost this harness the most: three phases each guessed differently about the same field.",
    "",
    "And every rule is CHECKED BY READING THIS REPOSITORY. Never write a rule as \"according to the",
    "<name> base\", \"as the design guide defines\" or \"following the supplied documentation\". Those",
    "documents guide HOW the product is built and are handed to whoever builds it — they are applied,",
    "never cited. A rule that points outside the repository becomes a criterion nobody can prove: the",
    "verifier looks for the document, does not find it, and rejects a phase that is correct. Say what",
    "must be TRUE in the code instead.",
    "",
    "## Sizing",
    `- One phase is ONE agent session: up to ${context.maxTasksPerPhase} tasks.`,
    `- Later, each task gets one or two acceptance criteria, at most ${context.maxCriteriaPerTask}.`,
    `  So a phase carries at most about ${context.maxTasksPerPhase * 3} criteria of real work. Size`,
    "  `taskCount` with that in mind: a phase that would need more is two phases.",
    "- Foundation first: data, then the relationships wired up front, then interface shell, then the",
    "  product flows. Never defer a relationship to a later feature phase.",
    "- `areas` says WHERE the phase works, from this closed list: frontend, backend, dados, infra,",
    "  qualidade. It decides which skills the builder receives in that phase — a frontend skill",
    "  loaded to build a database migration is paid context competing with what matters. A phase",
    "  may declare more than one. Use only these words; anything else is dropped.",
    "- Every story, entity and workflow you declare appears in the `covers` of some phase. What is",
    "  not covered will not be built.",
    "- The phases are a preliminary division by functional delivery — what each one leaves working —",
    "  and the architect may split, merge, reorder, serialize or regroup them. A phase's goal names",
    "  the capability delivered, never the files it creates, the contracts it implements, how it",
    "  plugs into the others or whether it runs alongside another.",
    "",
    "## Shape",
    "Return only JSON, no fence, no preamble:",
    "{",
    '  "contract": "capivara-skeleton/v2",',
    '  "projectName": "…",',
    '  "stack": [ { "component": "Linguagem", "decision": "TypeScript 5.8" } ],',
    '  "environment": [ { "technology": "Node.js compatível com a stack escolhida", "binary": "node", "systemLevel": false, "checkArgs": ["--version"], "installHint": "Instalar a versão escolhida na stack" } ],',
    '  "entities": [ { "name": "cartoes", "fields": [ { "name": "titulo", "type": "text, obrigatório" } ],',
    '                  "relations": ["pertence a colunas"] } ],',
    '  "stories": [ { "id": "US-1.1", "statement": "…" } ],',
    '  "workflows": [ { "number": "1", "name": "…", "steps": ["…"] } ],',
    '  "rules": [ { "subject": "cartoes.titulo", "statement": "…" } ],',
    '  "phases": [ { "number": 1, "title": "…", "goal": "…", "dependsOn": "none",',
    '                "covers": ["cartoes", "US-1.1", "workflow 1"], "areas": ["backend"], "taskCount": 8 } ],',
    '  "mvpCutPhase": 3',
    "}",
    "",
    "`dependsOn` is `none` or `Phase N, Phase M`. Story ids are `US-<n>.<m>`. Workflow numbers are",
    "plain numbers; the label `workflow <n>` is structural and is never translated.",
    "",
    ...(context.defects && context.defects.length > 0
      ? ["## Your previous attempt was rejected", ...context.defects.map((defect) => `- ${defect}`), ""]
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
  ].join("\n");
}

/**
 * O pedido do desenvolvedor, para quem escreve a fase.
 *
 * O auditor da fase recebe o pedido verbatim desde sempre. O escritor da fase
 * nunca recebeu — ele vê a fatia do esqueleto, e mais nada. Num pedido
 * prescritivo isso é uma assimetria que garante retrabalho: o do `assistencia2`
 * tem 16.752 caracteres e fala de "rolagem" ou "linhas" nove vezes, até o tamanho
 * dos campos, e nada disso sobrevive à compressão do esqueleto em stack,
 * entidades e regras.
 *
 * O resultado, medido: dos 25 achados de uma tentativa de auditoria, 18 eram
 * detalhes que o pedido exige e que a fase não podia conhecer. O escritor fechava
 * o que era apontado, o auditor achava o próximo, e o laço não convergia — não por
 * amostragem, por AUSÊNCIA. A informação que fecharia o ponto não estava na mão de
 * quem escreve.
 *
 * O risco do outro lado é real e está dito com todas as letras abaixo: com o
 * pedido inteiro na frente, a tentação é escrever a fase do vizinho.
 */
const PEDIDO_NA_FASE = [
  "## The developer's original request (verbatim)",
  "",
  "This is the authority above everything, including the slice below. It is here for ONE reason: the",
  "slice is a compression of it, and a compression loses detail. When the request demands something",
  "specific about what THIS phase covers — a field's size, a scrollbar, an exact list of values, what",
  "a screen shows after an action — that demand is real even when the slice does not repeat it, and",
  "the phase that omits it will be returned by an auditor who DOES read the request.",
  "",
  "And the hard limit, which matters more now that you can see everything: you write ONLY this phase.",
  "The request describes the whole product; most of it belongs to phases you are not writing. Never",
  "bring work from another phase into this one because you read about it here. What this phase covers",
  "is stated in the slice, and only there. Use the request to get the DETAIL of your own work right.",
].join("\n");

export interface PhaseFromSliceContext {
  language: string;
  /** O pedido do desenvolvedor, verbatim. O auditor da fase sempre o teve. */
  request: string;
  /** A fatia: só o que esta fase cobre, mais stack e regras transversais. */
  slice: string;
  phaseNumber: number;
  totalPhases: number;
  grammar: string;
  maxCriteriaPerTask: number;
  /** O teto que o harness conta e recusa. Passar dele é defeito só ele pode fechar. */
  maxTasksPerPhase: number;
  /**
   * A fatia da arquitetura desta fase: componentes, contratos, infraestrutura.
   *
   * É o que deixa a fase simples para um executor econômico: as decisões de
   * onde e como o código se organiza já foram tomadas, e a task só precisa
   * nomeá-las. Opcional porque o `change` ainda escreve fases sem arquitetura.
   */
  architecture?: string;
  /**
   * Quando o build percorre os workflows desta fase (§127), derivado da
   * arquitetura: o contrato que o G4 vai cobrar, entregue antes de o escritor
   * escrever o primeiro critério — e não descoberto pelo auditor depois.
   */
  tempo?: string;
  /**
   * Decisões fechadas DEPOIS de o esqueleto existir.
   *
   * O esqueleto é escrito das decisões e por isso as carrega — na stack, nas
   * entidades, nas regras transversais. Mas há decisões que nascem depois dele:
   * a que ficou em aberto na entrevista e a insistência fechou, e a que o auditor
   * levantou num run anterior. Sem este bloco elas chegavam à fase apenas como
   * achado de auditoria, uma reescrita depois — o escritor escrevia sem saber, e
   * o auditor cobrava com razão.
   */
  decisions?: readonly string[];
}

export function phaseFromSlicePrompt(context: PhaseFromSliceContext): string {
  return [
    languageBlock(context.language),
    planningScopeBlock(),
    "",
    `You are writing phase ${context.phaseNumber} of ${context.totalPhases}, and only it.`,
    "",
    "## What you can see, and why that is all",
    "Below is this phase's slice: the stack, the entities and stories it delivers, and the rules that",
    "cross every phase. You are not seeing the other phases and you do not need to — what had to be",
    "agreed between them was decided in the skeleton, and the cross-cutting rules are reproduced here",
    "in full.",
    "",
    "Do not restate the rules as if they were yours to decide, and do not contradict them. A phase",
    "that redefines a shared rule breaks a phase you cannot see.",
    "",
    "## What a task is",
    "One agent session implements this whole phase, task by task, and an independent verifier reads",
    "the real code afterwards and says DONE or INCOMPLETE for each. Write for those two readers.",
    "",
    `- One or two acceptance criteria per task, ${context.maxCriteriaPerTask} at the very most. A task needing more is`,
    "  doing more than one thing: split it.",
    "- Every criterion is something a person can observe in the code or in a command's output. If two",
    "  honest verifiers could read the same code and disagree, the criterion decides nothing.",
    "- A criterion is proven by reading THIS REPOSITORY, and nothing else. Never make one depend on a",
    "  document that is not in it — a skill from the documentation library, a design base, a style",
    "  guide, a wiki page — not even when a rule above phrases itself that way. Such guidance is",
    "  already in the hands of whoever builds: it is applied, never cited. \"The visual system follows",
    "  the frontend-design base\" cannot be verified; \"the palette, spacing scale and typography are",
    "  defined in one shared module and every screen imports them from there\" can.",
    "- Never assert the presence of something the skeleton says does not exist. A criterion demanding",
    "  what cannot exist can never be proven: the verifier looks, does not find, and rejects a phase",
    "  that was correct.",
    "- Environment readiness is approved once by build preflight. Do not write tasks that re-check runtime versions, installed tools or external-service availability.",
    "  A new dependency or migration is application setup, not a reason to repeat already-approved environment probes.",
    "- Copy the shared API method, complete endpoint and response shape into the relevant criteria. Keep screen navigation paths distinct from API paths.",
    "- A criterion describes behaviour, never a test: no test file, test name, test count or validation procedure.",
    "  How the product is proven is decided later, by the build's evaluator, over the real code.",
    "",
    "## Writing for an economical executor",
    "The executor of this phase may be a small model with a short context, reading only this phase",
    "and the repository. Write so that it never has to decide anything architectural:",
    "- every task says WHERE (the component, file or module from the architecture slice), WHAT",
    "  (the behaviour) and what observable condition proves it;",
    "- when the slice fixes a contract — a route, a function signature, a shape, a path — the task",
    "  and its criteria state it literally, never \"as defined in the architecture\";",
    "- a task never asks the executor to choose a library, a storage strategy or a layout: the slice",
    "  decided, and where it is silent you pick the simplest choice consistent with it and write it",
    "  down in the task. Only a BUSINESS decision nobody took becomes [NEEDS DECISION];",
    "- a shared file owned by a component this phase only CONSUMES (listed under the contracts to",
    "  consume: a route table, a navigation list, a registry, the app entry point) is consumed, never",
    "  re-registered. When the foundation delivers the extension point already carrying this module's",
    "  entry, this phase implements its own files and its criteria verify that the entry exists and",
    "  points at them. When the shared component is among THIS phase's own components, the",
    "  architecture ordered this phase after the others that edit it, and the task does write the",
    "  registration. When this phase's goal leaves the integration of this module to a later phase",
  "  (it names that phase), this phase builds and exports its own parts and its criteria verify",
  "  them in isolation: it never wires them into the application and never demands them through",
  "  the running application. A task that says to add, register or edit in a file that another phase without an",
    "  order between them also edits is rejected mechanically (I-18): phases without a dependency",
    "  between them may run at the same time, and an executor following both texts literally would",
    "  duplicate the entry or clobber the file. The order between phases is the architecture's",
    "  decision, not this phase's;",
    "- order the tasks so that each one can be implemented with the previous ones in place.",
    "",
    "## The set with no edge",
    "A criterion says something is true of a SET of things, and that set has to have an edge you can",
    "point at. \"Every deletion operation in scope\", \"all the shared services\", \"each flow foreseen\",",
    "\"the versioned files\" — none of those has one. Each observation is easy; what nobody can decide",
    "is when the list is COMPLETE.",
    "",
    "This is not pedantry, it is the shape of a phase that never closes. The verifier reads the code,",
    "finds one case the criterion covers and the implementation does not, and rejects the phase. The",
    "next cycle fixes it and the verifier finds another. Measured on a real build: three cycles, six",
    "different tasks, two at a time, every one of them fixed and replaced by two others.",
    "",
    "So quantify only over what the slice ENUMERATES — the entities this phase covers, the operations",
    "you list in the criterion itself, the files you name. \"Deleting a user and deleting a profile mark",
    "the record as deleted and keep it in the database\" has an edge: two operations, both named. \"All",
    "deletions in the system\" does not, and the system is not even built yet.",
    "",
    "The same goes for anything outside the working tree. A criterion is decided by opening files in",
    "THIS directory: version-control metadata, a CI run, a remote server or a colleague's machine are",
    "not there when the verifier looks. Name the file and what must be in it.",
    "",
    "## The adjective that invents a rule",
    "A criterion is written to be precise, and the fastest way to sound precise is to add a word:",
    "the \"normalized\" e-mail, the \"random\" password, \"equivalent indexes\", \"validated\" data,",
    "\"sanitized\" input. Each of those words is a RULE — it says a transformation happens, and it does",
    "not say to what, when, or what is left alone. If no source states that rule, you just invented",
    "one, and nobody can implement or verify what you meant.",
    "",
    "So: write what the sources state, AT THE PRECISION THEY STATE IT. `usuarios.email is unique` is",
    "faithful; `the normalized e-mail is unique` is a normalization rule nobody decided. When you",
    "catch yourself reaching for an adjective, either the slice already defines it — then name the",
    "rule, not the adjective — or nobody defined it, and you must not.",
    "",
    "And when a task genuinely cannot be written without deciding something material — what happens",
    "when the billing day does not exist in the month, whether a deleted e-mail can be reused — write",
    "",
    "  [NEEDS DECISION] <the open decision, in one line>",
    "",
    "on its own line, inside the task it belongs to. That line goes to the DEVELOPER before anything",
    "is audited, and comes back answered. It is the only legal way to leave something open: an",
    "invented default looks like a decision, gets built, and nobody ever learns it was a guess.",
    "",
    "The marker ADDS a line; it never replaces one. The task still carries its acceptance criteria,",
    "and its traces — written for the part that IS decided. A task that is only a",
    "marker is a task the contract rejects, and it takes the whole plan down with it.",
    "",
    "Keep them few. One phase with several open decisions usually means you stopped writing and",
    "started asking: write everything the sources do settle, and mark only what truly cannot be",
    "written without an answer.",
    "",
    "## How many tasks",
    "The slice states how many tasks the skeleton allocated to this phase. That number is a budget:",
    `stay at it or below, and NEVER go past ${context.maxTasksPerPhase}. The harness counts and refuses the phase`,
    "above that, and you are the only one who can fix it — you cannot create a phase. The phases were",
    "decided once, in the skeleton, and nothing after it splits one.",
    "",
    "So if the work does not fit, make the tasks BIGGER: two tasks that deliver the same capability",
    "are one task. Never drop a capability the slice covers to fit the count — coverage is checked",
    "too, and a phase that fits by forgetting something fails a different way.",
    "",
    "## What you emit, and what you do not",
    "You emit the TASKS of this phase, and nothing else. The phase heading, its number, its title,",
    "its Goal, its Depends on and its Covers are already decided and are assembled around what you",
    "write. Writing them yourself is not needed and is not read.",
    "",
    "## Grammar of a task",
    context.grammar,
    "",
    "`Design ref` is the one optional field, and it is USUALLY ABSENT. It points at an artifact the",
    "developer put in the design directory by hand — a mockup, a spec, a screenshot — and that",
    "directory almost never exists. A path you invent there is a dead reference: the harness looks for",
    "the file, does not find it, and rejects the phase. When there is no artifact, the task simply",
    "carries no Design ref, and that is the normal case.",
    "",
    "Emit the raw bytes of the tasks and nothing else: no phase heading, no Goal line, no document",
    "header, no other phase, no preamble, no fence.",
    "",
    PEDIDO_NA_FASE,
    "",
    context.request,
    "",
    ...(context.decisions && context.decisions.length > 0
      ? [
          "## Decisions taken after the skeleton was written",
          "The developer settled these after the skeleton existed, so the slice below does not reflect them.",
          "They are authority, at the same level as the rest: where one of them and the slice disagree, the",
          "decision wins, and you write the decision.",
          ...context.decisions.map((entry) => `- ${entry}`),
          "",
        ]
      : []),
    "## This phase's slice",
    context.slice,
    ...(context.architecture
      ? [
          "",
          "## This phase's architecture slice",
          "The components this phase implements, the contracts it must honour and the ones it may",
          "consume from earlier phases, and the infrastructure the build prepares. Write the tasks",
          "against these components; name their files, routes and functions in the task text.",
          context.architecture,
        ]
      : []),
    ...(context.tempo ? ["", context.tempo] : []),
  ].join("\n");
}
