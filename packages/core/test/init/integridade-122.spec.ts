/**
 * Integridade do PLAN, autoridade técnica e proteção contra regressões (§122).
 *
 * No `minimax` (DeepSeek-Flash, 0.6.2, run `init-dc741f0d7b92`) o PLAN chegou
 * a RALPH READY em 151 chamadas — e o relatório trazia "decisões confirmadas"
 * que ninguém deveria ter perguntado ao desenvolvedor: como o `rotas.ts`
 * obtém a instância `Database`; se o módulo escreve `router.get('/')` ou
 * `router.get('/tarefas')`; quem declara o script `test`. Quatro delas foram
 * respondidas "fica como está", e duas contradições materiais entre contratos
 * do próprio plano — o módulo Categorias sem o `export const prefixo` que a
 * fundação exige; o `npm test` que nenhuma fase cria — foram publicadas como
 * decididas. Os textos reais são as fixtures.
 *
 * O que se prova: a escolha de engenharia não vai ao desenvolvedor, nem como
 * decisão do auditor nem como arbitragem; a decisão genuína de produto
 * continua indo; a decisão dele no impasse vale para o que ele decidiu, e não
 * promove achado posterior a ressalva; a não-resposta não aprova; quem reparou
 * não lê o próprio reparo nem quando o verifier falha no protocolo; o plano
 * não prescreve trabalho de teste sem citar ferramenta; o mesmo achado
 * reescrito não é progresso; um arquivo com dois donos é defeito da
 * arquitetura; e o caminho sem defeito não ganhou chamada nenhuma.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoridadeDaDecisao, autoridadeDoAchado, balancoDaRodada, mesmoPonto, parseAudit, rodadaAvancou, sinaisDeEngenharia } from "../../src/audit/index.js";
import type { AuditAttempt, Finding } from "../../src/audit/index.js";
import { assemblePhasesDocument, checkTestPrescription, parseArchitecture, parsePhases, parseSkeleton, testPrescriptions } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { runInit, runPlan } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_1, PHASE_2, SKELETON, approve, fakeAgent, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-122-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas e testes automatizados com banco isolado", origin: "text" as const, path: null, sha12: "abc123abc123" };
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

const P2 = "project-phases.md#P2";
const COERENCIA = "project-phases.md#coerência";

/* ---------- as fixtures reais do `minimax` ---------- */

/** Q-72: a decisão de engenharia que o auditor levou ao desenvolvedor (leituras reais, encurtadas). */
const DECISAO_DB = [
  "P2.T1",
  "Como o roteador do módulo deve obter a instância `Database` sem editar arquivos de fundação, já que `registrarRotasCategorias(router)` não recebe `db` e `abrirBanco` exige um caminho explícito?",
  "(A) O `rotas.ts` chama `abrirBanco(process.env.PARALLEL_LAB_DB!)` na inicialização do módulo e mantém a instância em escopo de módulo",
  "(B) A fundação exporta uma função `obterBanco()` em `src/backend/db/connection.ts` que devolve a instância singleton já aberta; o `rotas.ts` importa e chama `obterBanco()`",
  "(C) O `rotas.ts` recebe `db` como segundo argumento opcional de `registrarRotasCategorias(router, db?)`",
].join(" | ");

/** Q-74: o registro de rotas, idem. */
const DECISAO_ROTAS = [
  "P2.T1",
  "Um `rotas.ts` de módulo deve preencher rotas relativas ao próprio prefixo ou rotas já com o caminho completo a partir de `/api`?",
  "O módulo escreve `router.get('/', ...)` e `router.get('/:id', ...)`; a fundação monta esse Router em `app.use('/api/<prefixo-do-modulo>', router)`",
  "O módulo escreve `router.get('/tarefas', ...)` e `router.get('/tarefas/:id', ...)`; a fundação monta tudo em `app.use('/api', router)`",
].join(" | ");

/** Q-73: a decisão genuína de produto, que continua indo ao desenvolvedor. */
const DECISAO_STATUS = [
  "P2.T1",
  "O formulário de criação de tarefa deve permitir escolher o status inicial, ou o status inicial é sempre `pendente` e o select só aparece na edição? A regra `tarefas.status` diz que o valor inicial ao criar é pendente, e P2.T3 aceita `status` opcional no POST",
  "O select de status aparece apenas na edição; a criação sempre envia `status: 'pendente'` e o backend rejeita status diferente na criação",
  "O select de status aparece também na criação, e a regra é lida como default quando não informado",
].join(" | ");

/** Q-99: a contradição material entre contratos, respondida "fica como está" no run real. */
const PREFIXO_PROBLEMA =
  "O contrato de montagem do roteador de Reservas não declara o `export const prefixo = '/reservas'`, enquanto P1.T2.C1 exige que todo `rotas.ts` exporte `prefixo: string` sob pena de `registrarRotasApi` lançar erro";
const PREFIXO_FIX = "acrescente em P2.T1.C1 a obrigação de `src/api/reservas.ts` declarar `export const prefixo = '/reservas'`, como P1.T2.C1 exige";
const PREFIXO = reject("P2.T1.C1", PREFIXO_PROBLEMA, PREFIXO_FIX);

/** Q-910: quem declara o script `test`. */
const NPM_TEST_PROBLEMA =
  "A fronteira de quem declara o script `test` é contraditória entre fases: P2.T9.C1 afirma que o dono único do script `test` agregado é a fase consolidada, que o declara em `package.json`, e a fase consolidada afirma que só edita README.md e não declara o script";
const NPM_TEST_FIX = "fixe em uma fase a declaração do script `test` no `package.json` e faça as outras fases citarem essa fase, sem contradição";

/** Q-97: a correção do auditor que pede uma task de testes. */
const TASK_DE_TESTES_FIX = "Acrescentar em Phase 2 uma task equivalente a P2.T9/P4.T8 (a suíte automatizada de Reservas como requisito do módulo, com banco descartável via DATABASE_PATH)";

/* ---------- as versões da fase 2 ---------- */

const COM_PREFIXO = PHASE_2.replace(
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada",
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada\n    - `src/api/reservas.ts` declara `export const prefixo = '/reservas'` e a fundação monta o Router em `/api` + `prefixo`",
);
const COM_PREFIXO_E_409 = COM_PREFIXO.replace("devolvem erro e não persistem nada", "respondem 409 e nada é persistido");
const COM_STATUS = PHASE_2.replace("Uma reserva nova nasce com status pendente", "A resposta 201 traz status pendente");
const revisao = (base: string, n: number) => base.replace("Uma reserva nova nasce com status pendente", `Uma reserva nova nasce com status pendente (revisão ${n})`);

/** A fase como o DeepSeek a escreveu: uma task que É a suíte, sem ferramenta e sem arquivo. */
const COM_TASK_DE_SUITE = `${PHASE_2.trimEnd()}

- [ ] **Task:** Entregar a suíte automatizada do módulo Reservas como requisito do próprio módulo: a execução automatizada deve usar um banco descartável apontado por DATABASE_PATH, criado e destruído pela própria execução
  - **Acceptance criteria:**
    - A suíte cobre os cenários de criação, edição e exclusão de reservas
    - O banco configurado no .env não é lido nem migrado pela execução automatizada
  - **Traces:** US-1.1, reservations, workflow 1
`;

/** O mesmo requisito escrito como critério: até a §128 era o que ficava; desde a §129 é do build, e a I-16 o conta. */
const COM_REQUISITO = PHASE_2.replace(
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada",
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada\n    - O módulo possui testes automatizados, executados contra um banco descartável apontado por DATABASE_PATH, sem ler nem migrar o banco do .env",
);

/** O lado da APLICAÇÃO, que é produto e fica: a aplicação aceita o banco descartável (§126, §129). */
const COM_LADO_DA_APLICACAO = PHASE_2.replace(
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada",
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada\n    - A aplicação aceita um banco descartável apontado por DATABASE_PATH, sem ler nem migrar o banco do .env",
);

const COM_MARCADOR = PHASE_2.replace(
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada",
  "    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada\n    - [NEEDS DECISION] o `rotas.ts` do módulo exporta `prefixo` ou `registrarRotasApi(app)` deriva o prefixo do diretório?",
);

async function init(pedido = request) {
  await runInit({ projectRoot, request: pedido, language: "português do Brasil", stage: "init", call: fakeAgent(skeletonPath()).call, ask: responde, announce: () => undefined });
}

async function plan(steps: ScriptStep[], extras: Partial<Parameters<typeof runPlan>[0]> = {}, resposta: (question: Question) => string = () => "1") {
  const dito: string[] = [];
  const perguntadas: Question[] = [];
  const impasses: string[] = [];
  const agent = fakeAgent(steps);
  const run = runPlan({
    projectRoot, request, language: "português do Brasil", call: agent.call,
    ask: async (question) => { perguntadas.push(question); return resposta(question); },
    announce: (linha) => void dito.push(linha), sleep: async () => undefined,
    decideStandoff: async (rendered) => { impasses.push(rendered); return "publicar"; },
    ...extras,
  });
  return { run, agent, perguntadas, anunciado: () => dito.join("\n"), impasses };
}

/** Um roteiro com passos próprios para a fase 2 e a coerência; o resto é o caminho por esqueleto. */
function roteiro(papeis: {
  auditor?: (call: AgentCall) => string;
  coerencia?: (call: AgentCall) => string;
  writer: (call: AgentCall) => string;
  reparador?: (call: AgentCall) => string;
  verifier?: (call: AgentCall) => string;
  leitorEscritor?: (call: AgentCall) => string;
}): ScriptStep[] {
  return [
    ...(papeis.auditor ? [{ match: { role: "auditor" as const, stage: "audit", subject: P2 }, respond: { stdout: papeis.auditor }, repeat: true }] : []),
    ...(papeis.coerencia ? [{ match: { role: "auditor" as const, stage: "audit", subject: COERENCIA }, respond: { stdout: papeis.coerencia }, repeat: true }] : []),
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: papeis.writer }, repeat: true },
    ...(papeis.reparador ? [{ match: { role: "auditor" as const, stage: "authoring", subject: "phase-p02" }, respond: { stdout: papeis.reparador }, repeat: true }] : []),
    ...(papeis.verifier ? [{ match: { role: "verifier" as const, stage: "audit", subject: P2 }, respond: { stdout: papeis.verifier }, repeat: true }] : []),
    ...(papeis.leitorEscritor ? [{ match: { role: "writer" as const, stage: "audit", subject: P2 }, respond: { stdout: papeis.leitorEscritor }, repeat: true }] : []),
    ...skeletonPath().filter((passo) => passo.match.subject !== "phase-p02"),
  ];
}

const deAuditoria = (perguntadas: Question[]) => perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"));
const plano = () => readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");

describe("a autoridade: quem decide o quê, classificado pela forma do ponto", () => {
  it("as decisões reais do DeepSeek: engenharia nas duas de código, produto na do formulário", () => {
    const ler = (linha: string) => {
      const parsed = parseAudit(`CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_DECISION: ${linha}\nCAPIVARA_REASON: ok`);
      if (!parsed.ok) throw new Error(parsed.defects.join("; "));
      return parsed.verdict.decisions![0]!;
    };
    expect(autoridadeDaDecisao(ler(DECISAO_DB))).toBe("engenharia");
    expect(autoridadeDaDecisao(ler(DECISAO_ROTAS))).toBe("engenharia");
    expect(autoridadeDaDecisao(ler(DECISAO_STATUS))).toBe("indefinida");
    // Uma leitura em prosa basta para a pendência ser preservada.
    expect(autoridadeDaDecisao({ where: "P2.T1", decision: "x", options: ["`abrirBanco(caminho)` no módulo", "o status inicial é pendente"] })).toBe("indefinida");
  });

  it("os achados reais: a contradição de contrato e o script são engenharia; a verificabilidade de um critério não é", () => {
    expect(autoridadeDoAchado({ where: "P2.T1.C1 vs P1.T2.C1", problem: PREFIXO_PROBLEMA, fix: PREFIXO_FIX })).toBe("engenharia");
    expect(autoridadeDoAchado({ where: "P2.T9 / P4.T8 vs P5.T1.C1", problem: NPM_TEST_PROBLEMA, fix: NPM_TEST_FIX })).toBe("engenharia");
    // Q-91: a redação do critério mistura procedimento e asserção — não é código em disputa.
    expect(autoridadeDoAchado({
      where: "Task 3 (Phase 5.1)",
      problem: "A primeira acceptance criterion exige que o processo seja encerrado e reiniciado — descreve uma sequência de execução manual do verificador, não um estado do repositório",
      fix: "descrever a persistência como registros criados via POST que permanecem acessíveis por GET após reabrir o arquivo indicado por PARALLEL_LAB_DB",
    })).toBe("indefinida");
    expect(autoridadeDoAchado({ where: "P2.T1.C1", problem: "o status inicial não é observável na resposta", fix: "diga que a resposta 201 traz status pendente" })).toBe("indefinida");
    expect(autoridadeDoAchado({ where: "P2", problem: "a task declara 5 critérios em `src/x.ts`", fix: "corte para 4 em `src/x.ts`", mechanical: true })).toBe("indefinida");
    expect(sinaisDeEngenharia("o `rotas.ts` exporta `prefixo` e `registrarRotasApi(app)` o lê; `npm test`; PARALLEL_LAB_DB")).toEqual(
      expect.arrayContaining(["rotas.ts", "`registrarRotasApi(app)`", "npm test", "PARALLEL_LAB_DB"]),
    );
  });
});

describe("no orquestrador: a escolha de engenharia não chega ao desenvolvedor", () => {
  it("1, 13, 14. o auditor levanta as duas decisões de código do DeepSeek: nenhuma pergunta; o escritor escolhe; o plano fecha sem chamada a mais", async () => {
    await init();
    let auditorias = 0;
    const { run, agent, perguntadas, impasses, anunciado } = await plan(roteiro({
      auditor: () => ((auditorias += 1) === 1 ? `${approve()}\nCAPIVARA_DECISION: ${DECISAO_DB}\nCAPIVARA_DECISION: ${DECISAO_ROTAS}` : approve()),
      writer: (call) => (call.prompt.includes("escolha de engenharia") ? COM_PREFIXO : PHASE_2),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(deAuditoria(perguntadas)).toEqual([]);
    expect(impasses).toEqual([]);
    expect(anunciado()).toContain("o plano decide, não você");
    // O escritor recebeu as leituras do auditor e a nota de quem decide — uma emenda, uma reauditoria.
    const emendas = por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" });
    expect(emendas).toHaveLength(2);
    expect(emendas[1]?.prompt).toContain("é o plano que decide");
    expect(emendas[1]?.prompt).toContain("obterBanco()");
    expect(emendas[1]?.prompt).toContain("cabe ao plano, não ao desenvolvedor");
    expect(por(agent, { stage: "audit", subject: P2 })).toHaveLength(2);
    expect(await plano()).toContain("export const prefixo");
  });

  it("2. a decisão genuína de produto do DeepSeek continua chegando ao desenvolvedor, sem leitura recomendada", async () => {
    await init();
    let auditorias = 0;
    const { run, perguntadas } = await plan(roteiro({
      auditor: () => ((auditorias += 1) === 1 ? `${approve()}\nCAPIVARA_DECISION: ${DECISAO_STATUS}` : approve()),
      writer: () => PHASE_2,
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const perguntas = deAuditoria(perguntadas);
    expect(perguntas).toHaveLength(1);
    expect(perguntas[0]?.decision).toContain("O formulário de criação de tarefa deve permitir escolher o status inicial");
    expect(perguntas[0]?.recommended).toBe("");
  });

  it("3, 12. a contradição de contrato (prefixo) que voltou pela segunda vez não é arbitrada: o escritor a fecha e o plano é coerente", async () => {
    await init();
    let escritas = 0;
    const { run, agent, perguntadas, impasses, anunciado } = await plan(roteiro({
      coerencia: (call) => (call.prompt.includes("export const prefixo") ? approve() : PREFIXO),
      writer: () => { escritas += 1; return escritas === 1 ? PHASE_2 : escritas === 2 ? revisao(PHASE_2, 2) : COM_PREFIXO; },
    }), {}, (pergunta) => (pergunta.topic.startsWith("auditoria ·") ? "2" : "1")); // "fica como está", como no run real
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(deAuditoria(perguntadas)).toEqual([]);
    expect(impasses).toEqual([]);
    expect(anunciado()).toContain("são de engenharia");
    expect(await plano()).toContain("export const prefixo = '/reservas'");
    expect(outcome.rendered).not.toContain("fica como está");
    // A emenda levou a nota: o escritor sabe que não há decisão a esperar.
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })[2]?.prompt).toContain("cabe ao plano, não ao desenvolvedor");
  });

  it("o marcador [NEEDS DECISION] de engenharia volta ao escritor, uma vez; não vira pergunta", async () => {
    await init();
    let escritas = 0;
    const { run, agent, perguntadas } = await plan(roteiro({
      writer: () => ((escritas += 1) === 1 ? COM_MARCADOR : COM_PREFIXO),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntadas.filter((pergunta) => pergunta.topic === "decisão pendente na fase")).toEqual([]);
    expect(por(agent, { role: "writer", stage: "interview", subject: "project-phases.md:gaps" })).toEqual([]);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })[1]?.prompt).toContain("pede uma decisão de engenharia");
    expect(await plano()).not.toContain("NEEDS DECISION");
  });
});

describe("no orquestrador: a decisão do desenvolvedor vale para o que ele decidiu, e a não-resposta não aprova", () => {
  /** Um auditor que insiste num ponto de engenharia até o impasse; o escritor só muda a revisão. */
  const insistente = () => (call: AgentCall) => (call.prompt.includes("export const prefixo") ? approve() : PREFIXO);

  it("4. a ausência de resposta no impasse não publica: a correção recomeça, o escritor fecha, e o plano sai coerente", async () => {
    await init();
    let escritas = 0;
    const { run, perguntadas, impasses, anunciado } = await plan(roteiro({
      auditor: insistente(),
      writer: () => { escritas += 1; return escritas >= 4 ? COM_PREFIXO : revisao(PHASE_2, escritas); },
    }), { maxAuditReturns: 1, decideStandoff: async (rendered) => { impasses.push(rendered); return "não sei"; } });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses).toHaveLength(1);
    expect(deAuditoria(perguntadas)).toEqual([]);
    expect(anunciado()).toContain("recomeçando a correção e a auditoria");
    expect(anunciado()).not.toContain("ninguém decidiu o impasse; publicando");
    expect(outcome.rendered).not.toContain("segue em aberto");
    expect(await plano()).toContain("export const prefixo");
  });

  it("4b. duas não-respostas com o achado material aberto param o run com o diagnóstico; nada é publicado", async () => {
    await init();
    let escritas = 0;
    const { run, impasses } = await plan(roteiro({
      auditor: insistente(),
      writer: () => revisao(PHASE_2, (escritas += 1)),
    }), { maxAuditReturns: 1, decideStandoff: async (rendered) => { impasses.push(rendered); return "tanto faz"; } });
    const erro = await run.then(() => null, (e: Error) => e.message);
    expect(erro).toContain("Ninguém decidiu o impasse duas vezes");
    expect(erro).toContain("Estratégias tentadas, nesta ordem:");
    expect(erro).toContain("impasse sem decisão do desenvolvedor: correção e auditoria recomeçadas");
    expect(impasses).toHaveLength(2);
    await expect(plano()).rejects.toThrow();
  });

  it("5. a decisão dele no impasse não promove a ressalva um achado posterior sobre outra coisa: o novo achado é corrigido", async () => {
    await init();
    const { run, perguntadas, impasses } = await plan(roteiro({
      auditor: (call) => (!call.prompt.includes("export const prefixo")
        ? PREFIXO
        : !call.prompt.includes("respondem 409") ? reject("P2.T1.C2", "o critério de datas não diz a resposta HTTP", "diga que a resposta é 409 e nada é persistido") : approve()),
      writer: (call) => (call.prompt.includes("o desenvolvedor decidiu") || call.prompt.includes("respondem 409") || call.prompt.includes("resposta é 409")
        ? (call.prompt.includes("409") ? COM_PREFIXO_E_409 : COM_PREFIXO)
        : revisao(PHASE_2, Math.random())),
    }), { maxAuditReturns: 1, decideStandoff: async (rendered) => { impasses.push(rendered); return "declare o prefixo em src/api/reservas.ts como a fundação exige"; } });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses).toHaveLength(1);
    expect(deAuditoria(perguntadas)).toEqual([]);
    const publicado = await plano();
    expect(publicado).toContain("export const prefixo");
    expect(publicado).toContain("respondem 409");
    expect(outcome.rendered).not.toContain("mantido por decisão do desenvolvedor");
  });

  it("5b. o auditor que insiste contra a decisão dele perde: o ponto decidido vira ressalva, e só ele", async () => {
    await init();
    let escritas = 0;
    const { run, impasses } = await plan(roteiro({
      auditor: () => PREFIXO, // insiste mesmo depois da decisão
      writer: () => revisao(PHASE_2, (escritas += 1)),
    }), { maxAuditReturns: 1, decideStandoff: async (rendered) => { impasses.push(rendered); return "o prefixo é derivado do diretório pela fundação; o módulo não o exporta"; } });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses).toHaveLength(1);
    expect(outcome.rendered).toContain("mantido por decisão do desenvolvedor");
  });

  it("publicar é decisão explícita, e o que ficou aberto vai ao relatório em vez de sumir", async () => {
    await init();
    let escritas = 0;
    const { run, impasses } = await plan(roteiro({
      auditor: () => PREFIXO,
      writer: () => revisao(PHASE_2, (escritas += 1)),
    }), { maxAuditReturns: 1 });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses).toHaveLength(1);
    expect(outcome.rendered).toContain("publicado por decisão explícita do desenvolvedor, com o achado em aberto");
  });
});

describe("a independência do reparo: quem reparou não lê, nem quando o verifier falha no protocolo", () => {
  const F1 = reject("Tarefa «Implementar a criação de reserva com recusa de datas sobrepostas»", "o status inicial não é observável na resposta", "diga que a resposta 201 traz status pendente");

  it("6, 7. o verifier devolve saída inválida duas vezes depois do reparo: a terceira leitura é do escritor, nunca do auditor que reparou", async () => {
    await init();
    const { run, agent, impasses, anunciado } = await plan(roteiro({
      auditor: () => F1,
      writer: () => PHASE_2,
      reparador: () => COM_STATUS,
      verifier: () => "não entendi o protocolo",
      leitorEscritor: () => approve(),
    }), { roles: { auditor: { provider: "deepseek", model: "flash", effort: "" }, verifier: { provider: "deepseek", model: "flash", effort: "" }, writer: { provider: "deepseek", model: "flash", effort: "" } } });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses).toEqual([]);
    const leituras = por(agent, { stage: "audit", subject: P2 }).map((call) => call.role);
    expect(leituras).toEqual(["auditor", "auditor", "verifier", "verifier", "writer"]);
    expect(anunciado()).toContain("o auditor reparou este documento e não lê o próprio reparo");
    // A independência disponível é só de sessão, e isso é dito.
    expect(anunciado()).toContain("a independência entre verifier e auditor é só de sessão: os dois rodam em deepseek/flash");
    expect(await plano()).toContain("A resposta 201 traz status pendente");
  });

  it("7b. sem leitor elegível, o run para com o diagnóstico e o estado em disco; nada é aprovado", async () => {
    await init();
    const { run } = await plan(roteiro({
      auditor: () => F1,
      writer: () => PHASE_2,
      reparador: () => COM_STATUS,
      verifier: () => "não entendi o protocolo",
      leitorEscritor: () => "também não",
    }));
    const erro = await run.then(() => null, (e: Error) => e.message);
    expect(erro).toContain("(verifier, verifier, writer)");
    expect(erro).toContain("Estratégias tentadas, nesta ordem:");
    await expect(plano()).rejects.toThrow();
  });
});

describe("I-16 sem ferramenta: o plano não aloca trabalho de teste", () => {
  it("8. as cinco formas observadas no DeepSeek são prescrição; as quatro exigências legítimas não são", () => {
    const pedido = [request.text, "Cada módulo deve ter suas próprias rotas, componentes, serviços e testes. Os testes precisam utilizar banco isolado."];
    for (const prescricao of [
      "Implementar a suíte automatizada do módulo",
      "Cobrir os cenários de criação, edição e exclusão",
      "Acrescentar uma task de testes de Categorias",
      "Configurar a execução de testes por módulo",
      "Definir como os testes de integração serão executados",
      "Entregar a suíte automatizada do módulo Tarefas como requisito do próprio módulo",
      TASK_DE_TESTES_FIX,
      // Até a §128 estes eram "exigências legítimas" que ficavam no plano; desde a §129 o pedido de testes é do build.
      "O produto deve possuir testes automatizados",
      "O módulo possui testes automatizados, executados contra um banco descartável apontado pela variável de ambiente",
      "A execução de testes deve utilizar banco descartável",
      "a suíte automatizada roda contra um banco descartável, criado e destruído pela própria execução",
    ]) {
      expect(testPrescriptions(prescricao, pedido), prescricao).not.toEqual([]);
    }
    for (const legitimo of [
      "O produto deve preservar dados entre reinicializações",
      "O produto deve respeitar contratos observáveis",
      "A aplicação aceita um banco descartável apontado por DATABASE_PATH, sem ler nem migrar o banco do .env",
      "README.md menciona `npm test` como o comando documentado",
    ]) {
      expect(testPrescriptions(legitimo, pedido), legitimo).toEqual([]);
    }
    // O domínio do produto que o pedido contém é o produto, não a prova; o tipo de teste que o pedido nomeia é dele.
    expect(testPrescriptions("Criar a tabela de testes de laboratório", ["cadastro de testes de laboratório"])).toEqual([]);
    expect(testPrescriptions("Criar a tabela de testes de laboratório", [])).not.toEqual([]);
    expect(testPrescriptions("os testes de integração rodam contra a API", ["quero testes de integração contra a API"])).toEqual([]);
    // "testes automatizados" no pedido autoriza o requisito, não a task de escrevê-los.
    expect(testPrescriptions("Criar os testes automatizados do módulo Tarefas", pedido)).not.toEqual([]);
    expect(testPrescriptions("Implementar a suíte presidencial no cadastro de quartos", [])).toEqual([]);
  });

  it("8. no plano, a task que é a suíte sai como I-16 com a linha; o esqueleto e a arquitetura recusam a fase que aloca os testes", () => {
    const documento = assemblePhasesDocument({ projectName: "Pousada", stamp: "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa architecture.md@sha256:bbbbbbbbbbbb -->", overview: "Base", phases: [PHASE_1, COM_TASK_DE_SUITE], openQuestions: [] });
    const lido = parsePhases(documento);
    if (!lido.ok) throw new Error(lido.errors.map((erro) => erro.message).join("; "));
    const erros = checkTestPrescription(lido.document, [request.text]);
    expect(erros).toHaveLength(1);
    expect(erros[0]?.message).toContain("Entregar a suíte automatizada");
    expect(erros[0]?.hint).toContain("executado pelo build");
    expect(checkTestPrescription(parsePhases(assemblePhasesDocument({ projectName: "Pousada", stamp: "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa architecture.md@sha256:bbbbbbbbbbbb -->", overview: "Base", phases: [PHASE_1, COM_LADO_DA_APLICACAO], openQuestions: [] })).ok ? (parsePhases(assemblePhasesDocument({ projectName: "Pousada", stamp: "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa architecture.md@sha256:bbbbbbbbbbbb -->", overview: "Base", phases: [PHASE_1, COM_LADO_DA_APLICACAO], openQuestions: [] })) as { ok: true; document: Parameters<typeof checkTestPrescription>[0] }).document : (() => { throw new Error("fixture"); })(), [request.text])).toEqual([]);

    const esqueleto = JSON.parse(SKELETON);
    esqueleto.phases[1].goal = "o hóspede cria uma reserva; incluir, também neste módulo, os testes automatizados de Reservas executados contra banco isolado";
    const lidoEsqueleto = parseSkeleton(JSON.stringify(esqueleto), { maxTasksPerPhase: 15, authority: [request.text] });
    expect(lidoEsqueleto.ok).toBe(false);
    if (!lidoEsqueleto.ok) expect(lidoEsqueleto.defects.map((d) => d.problem).join(" ")).toContain("a fase 2 prescreve teste");

    const base: Skeleton = (() => { const s = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 }); if (!s.ok) throw new Error("fixture"); return s.skeleton; })();
    const arquitetura = JSON.parse(ARCHITECTURE);
    arquitetura.phases[1].goal = "Entregar o CRUD de reservas; incluir, também neste módulo, os testes automatizados de Reservas";
    const lidaArquitetura = parseArchitecture(JSON.stringify(arquitetura), base, { maxTasksPerPhase: 15, authority: [request.text] });
    expect(lidaArquitetura.ok).toBe(false);
    if (!lidaArquitetura.ok) expect(lidaArquitetura.defects.map((d) => d.problem).join(" ")).toContain("a fase 2 prescreve teste");
  });

  it("8, 9. no orquestrador: a task que é a suíte é devolvida mecanicamente, e o plano publicado fica com o lado da aplicação, sem teste (§129)", async () => {
    await init();
    let escritas = 0;
    const { run, agent, perguntadas } = await plan(roteiro({
      writer: () => ((escritas += 1) === 1 ? COM_TASK_DE_SUITE : COM_LADO_DA_APLICACAO),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(deAuditoria(perguntadas)).toEqual([]);
    const emenda = por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })[1]?.prompt ?? "";
    expect(emenda).toContain("I-16");
    expect(emenda).toContain("executado pelo build");
    expect(emenda).not.toContain("Não apague o requisito");
    const publicado = await plano();
    expect(publicado).not.toContain("Entregar a suíte automatizada");
    expect(publicado).not.toContain("testes automatizados");
    expect(publicado).toContain("A aplicação aceita um banco descartável apontado por DATABASE_PATH");
  });

  it("8. a correção do auditor que pede uma task de testes chega ao escritor sem o teste: o achado fica, a correção fica no produto (§129)", async () => {
    await init();
    let auditorias = 0;
    const { run, agent, anunciado } = await plan(roteiro({
      auditor: () => ((auditorias += 1) === 1 ? reject("P2.T1", "a fase não entrega o que P2.T9 e P4.T8 entregam nos outros módulos", TASK_DE_TESTES_FIX) : approve()),
      writer: (call) => (call.prompt.includes("I-16") ? COM_REQUISITO : PHASE_2),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado()).toContain("traziam teste na correção");
    const emenda = por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })[1]?.prompt ?? "";
    expect(emenda).toContain("sem acrescentar nada sobre testes");
    expect(emenda).not.toContain("a suíte automatizada de Reservas");
    expect(await plano()).not.toContain("task de testes");
  });
});

describe("a convergência por evidência: identidade sem exigir texto idêntico", () => {
  const rodada = (attempt: number, findings: Finding[], sha: string): AuditAttempt => ({ attempt, verdict: { status: "REJECTED", findings, remarks: [], reason: "r" }, contentSha: sha });
  const original: Finding = { where: "P2.T1.C1", problem: PREFIXO_PROBLEMA, fix: PREFIXO_FIX };
  const reescrito: Finding = { where: "P2.T1 (rotas.ts de Reservas)", problem: "O `rotas.ts` do módulo Reservas continua sem o `export const prefixo = '/reservas'` que a fundação exige em P1.T2.C1, sob pena de `registrarRotasApi` lançar erro para módulo sem prefixo", fix: "declare o prefixo" };
  const outro: Finding = { where: "P2.T1.C2", problem: "o critério de datas sobrepostas não diz a resposta HTTP nem o que é persistido", fix: "diga 409 e nada persistido" };

  it("10. o mesmo achado reformulado não é progresso artificial: persiste, e a rodada gasta o teto", () => {
    expect(mesmoPonto(original, reescrito)).toBe("sim");
    const history = [rodada(1, [original], "a"), rodada(2, [reescrito], "b")];
    expect(balancoDaRodada(history, 1)).toEqual({ fechados: 0, persistentes: 1, novos: 0, regressoes: 0, incertos: 0, mesmoTexto: false });
    expect(rodadaAvancou(history, 1)).toBe(false);
  });

  it("11. a correção legítima com um achado novo é progresso, e a regressão reescrita ainda é regressão", () => {
    expect(mesmoPonto(original, outro)).toBe("nao");
    const avanco = [rodada(1, [original], "a"), rodada(2, [outro], "b")];
    expect(balancoDaRodada(avanco, 1)).toEqual({ fechados: 1, persistentes: 0, novos: 1, regressoes: 0, incertos: 0, mesmoTexto: false });
    expect(rodadaAvancou(avanco, 1)).toBe(true);
    const regressao = [rodada(1, [original], "a"), rodada(2, [outro], "b"), rodada(3, [reescrito], "c")];
    expect(balancoDaRodada(regressao, 2).regressoes).toBe(1);
    expect(rodadaAvancou(regressao, 2)).toBe(false);
  });

  it("o parecido pela metade, em outro endereço, é incerto: nem progresso nem regressão", () => {
    const meio: Finding = { where: "P3.T4", problem: "O contrato de montagem do roteador de Categorias não declara o prefixo, enquanto a fundação exige que todo módulo exporte um prefixo obrigatório lido no registro", fix: "x" };
    const identidade = mesmoPonto({ ...original, where: "P2.T1.C1" }, meio);
    expect(["incerto", "nao"]).toContain(identidade);
    if (identidade === "incerto") {
      const history = [rodada(1, [original], "a"), rodada(2, [meio], "b")];
      expect(balancoDaRodada(history, 1).incertos).toBeGreaterThan(0);
      expect(rodadaAvancou(history, 1)).toBe(false);
    }
  });
});

describe("integração verificável sem julgamento: um arquivo, um dono", () => {
  it("12. o mesmo caminho em dois componentes é defeito da arquitetura; caminhos distintos passam", () => {
    const base: Skeleton = (() => { const s = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 }); if (!s.ok) throw new Error("fixture"); return s.skeleton; })();
    const arquitetura = JSON.parse(ARCHITECTURE);
    arquitetura.components[1].files = ["src/api/reservas.ts", "src/db.ts"];
    const lida = parseArchitecture(JSON.stringify(arquitetura), base, { maxTasksPerPhase: 15 });
    expect(lida.ok).toBe(false);
    if (!lida.ok) expect(lida.defects.map((d) => d.problem).join(" ")).toContain("o arquivo src/db.ts pertence a 2 componentes (dados, api)");
    expect(parseArchitecture(ARCHITECTURE, base, { maxTasksPerPhase: 15 }).ok).toBe(true);
  });
});

describe("o caminho normal não fica mais caro", () => {
  it("15. o plano correto não ganha chamada nenhuma: nenhum verifier, nenhum reparo, nenhuma pergunta", async () => {
    await init();
    const { run, agent, perguntadas, anunciado } = await plan(skeletonPath());
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(por(agent, { role: "auditor", stage: "authoring" })).toHaveLength(0);
    expect(por(agent, { role: "verifier", stage: "audit", subject: P2 })).toHaveLength(0);
    expect(por(agent, { role: "writer", stage: "audit" })).toHaveLength(0);
    expect(perguntadas.filter((pergunta) => pergunta.id !== ID_DO_BANCO)).toEqual([]);
    expect(anunciado()).not.toContain("engenharia");
    // O mesmo número de chamadas da 0.6.2: entrevista, esqueleto não (é do init), arquitetura, duas fases, duas auditorias de fase, coerência, triagem não (sem bloqueio), ensaio.
    expect(agent.calls.map((call) => `${call.role}:${call.stage}:${call.subject}`)).toEqual([
      "writer:authoring:architecture",
      "auditor:audit:architecture",
      "writer:authoring:phase-p01",
      "writer:authoring:phase-p02",
      "auditor:audit:project-phases.md#P1",
      "auditor:audit:project-phases.md#P2",
      "auditor:audit:project-phases.md#coerência",
      "verifier:verify:project-phases.md",
      "verifier:verify:project-phases.md",
    ]);
  });
});
