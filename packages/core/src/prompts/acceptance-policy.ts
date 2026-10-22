/** Critério comum aos papéis: entregar comportamento com verificação proporcional. */
export function functionalAcceptanceBlock(): string {
  return [
    "## Functional acceptance and user cost",
    "Every return costs the user time and money. Aim to deliver the phase in one construction cycle.",
    "Judge required behaviour and operational usability. Equivalent working implementations are acceptable.",
    "The plan defines observable product requirements. The independent validator selects the smallest sufficient proof.",
    "Legacy prescriptions of test names, files, counts or organization are advisory, unless explicitly requested by the developer.",
    "The executor implements concrete verification requested by the validator; do not generate a speculative suite from the plan.",
    "A blocker needs a specific unmet requirement and concrete evidence of an observable failure or missing capability.",
    "Wrong results, data loss, security, validation, persistence and inability to build or start remain blockers.",
    "Follow shared clients and helpers through to their final effect: judge the final request URL, not a relative fragment.",
    "Do not demand a preferred folder, layer, helper, extra assertion or duplicate test when the required behaviour is established.",
    "Missing test names alone are not a functional defect. Reuse equivalent coverage; do not demand the same scenario at every layer.",
    "Collect ALL substantiated functional defects in the first pass, with evidence, an exact correction and a regression check.",
    "Do not invent extra requirements or progressively expand acceptance after earlier findings were fixed.",
    "Do not approve missing functionality or assume an essential behaviour works without examining evidence.",
    "Do not delete or skip failing scenarios, hide errors or replace required real interactions with fake success.",
    "An assertion coupled to an internal implementation may be corrected to check the same public behaviour; explain why it was wrong.",
    "Tests must use their own temporary data and preserve existing local databases and caches. Do not assert a user's runtime file is absent; verify the test did not change its previous state.",
    "An optional local file may be absent: represent its pre-test snapshot as null instead of unconditionally calling stat/readFile. Put ALL setup, backup and snapshots inside try/finally so an early assertion or ENOENT still restores configuration.",
    "Environment readiness belongs to the build preflight, before development. Do not repeat runtime, tool-presence or service-readiness checks in every phase's tests.",
    "The tests the developer asked for are the shared contract's rules about tests (subject starting with \"testes\") and its stack entry about tests.",
    "The plan does not carry them — no phase lists test tasks or test criteria — so the build honours them, for what each phase delivers and under the conditions they state.",
  ].join("\n");
}

/** O G4 exercita a entrega publicada, sem criar outra especificação. */
export function flowScopeBlock(): string {
  return [
    "## G4 scope and user cost",
    "Test only the delivered workflow and the observable outcomes required by its published steps and acceptance criteria.",
    "Do not add scenarios, edge cases or assertions beyond the declared steps and acceptance criteria.",
    "Use ONE test and exactly ONE test.step for each declared step, in order; no extra tests or steps.",
    "The shared contract supplies facts and URLs, not permission to test future phases or unrelated features.",
    "Do not duplicate unit tests, environment checks or an unchanged passing scenario.",
    "Do not assert incidental DOM structure, intermediate messages, exact copy or visual details unless explicitly required.",
    "A failure must identify a required observable outcome that is missing. An invented expectation is a script defect (ROTEIRO).",
    "Keep explicitly required validation, security, persistence and error handling; do not expand them into speculative cases.",
    "Fix all evidenced script defects together, preserve the working coverage and return promptly; every extra session costs the user.",
    "A fresh isolated database has no pre-existing rows. Create the minimum prerequisite data through the real API when a step needs an existing record.",
    "Identify a list record by the exact text element that contains its name: row.filter({ has: page.getByText(name, { exact: true }) }), or an equivalent selector verified in source.",
    "String hasText is partial and case-insensitive: names may share a prefix or differ only in case. A row also contains colour, dates and buttons; /^name$/ on its aggregated text does not identify its name child.",
    "Use the same precise identity in creation, duplicate checks, editing and deletion. Correct all occurrences of a faulty selector strategy together.",
    "To test declared loading or API-unavailability states, the returned script may delay and continue a real GET or abort that GET; continue non-GET requests unchanged. Never fabricate product responses with fulfill or HAR.",
  ].join("\n");
}

/** Preserva os fatos publicados; não tenta deduzir endpoints de nomes de telas. */
export function sharedContractFromSkeleton(markdown: string): string {
  const lines: string[] = [];
  let include = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ")) include = /^## (?:Stack|Regras|Contratos)/.test(line);
    if (include) lines.push(line);
  }
  return lines.join("\n").trim();
}

export function interfaceContractBlock(sharedContract: string | undefined, phaseMarkdown?: string): string {
  return [
    "## Published interface contract — concrete input, not a naming convention",
    ...(sharedContract ? [sharedContract] : ["No shared contract was supplied. Read the declared routes and shared HTTP client before writing network assertions; never invent an endpoint."]),
    ...(phaseMarkdown ? ["## Acceptance criteria of this phase", phaseMarkdown.trim()] : []),
    "Navigation paths and API endpoints are different contracts. Use the exact published API method and final pathname, including the shared client's base prefix.",
    "Before response.json(), match the exact API pathname and method and exclude navigation requests (request.isNavigationRequest()); verify the JSON content-type.",
    "Never broaden an API matcher to accept the screen URL as an alternative. A SPA document is HTML, not an API response.",
  ].join("\n");
}

export function proportionateChecksBlock(): string {
  return [
    "## Proportionate checks",
    "Prefer focused regression checks for the changed behaviour while implementing or repairing.",
    "The harness runs the complete gate command independently after your handoff and again after integration.",
    "Do not repeat an unchanged passing suite merely to confirm the same result or inflate the test count.",
    "Run browser checks when relevant; do not run separate e2e again when the same command already includes them.",
    "Report the exact checks performed and finish when the required behaviour is delivered; do not build speculative test infrastructure.",
    "The harness supplies E2E_PORT privately for this session. Preserve it in browser-test commands; project test configuration must read it instead of fixing a shared port.",
  ].join("\n");
}

export function transientStateBlock(flowOnly = false): string {
  return [
    "## Transient states and correct test timing",
    "A loading indicator may disappear before page.goto resolves when the real API is fast.",
    "Never add artificial latency to the product to satisfy a test, including test-only delays.",
    "Arrange observations before the triggering action. If the fast response prevents observing the pending state,",
    flowOnly
      ? "use evidence from the existing focused tests and keep the real flow's final-result assertions; do not add a new scenario."
      : "prove that state in a focused test with a controlled pending request and keep the real flow's final-result assertions.",
    "Do not fabricate a backend response or skip the actual create/edit/delete/persistence operation in the real flow.",
  ].join("\n");
}
