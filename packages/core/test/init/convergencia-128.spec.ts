/**
 * §128 — a convergência do PLAN no Parallel Lab (0.7.1, run `init-dc741f0d7b92`).
 *
 * O plano saiu RALPH READY, mas em 64 chamadas: seis escritas da arquitetura,
 * cinco auditorias dela, dezessete escritas de fase, uma reorganização que
 * reescreveu as cinco fases do zero. Os cenários abaixo repetem, com os textos
 * reais do run (`test/fixtures/parallel-lab-128.*`), os pontos em que o harness
 * — não o modelo — fez a conta crescer:
 *
 * - a emenda da fase 1 corrigiu a Task 1 E as Tasks 7 e 8, que o achado
 *   alcançava pelos caminhos que citava; o harness restaurou as duas, porque o
 *   endereço do achado só nomeava `P1.T1.C3`, e a coerência devolveu o mesmo
 *   conflito à arquitetura;
 * - a reorganização que se seguiu mudou o envelope das fases 1 e 2, e as fases
 *   3, 4 e 5 — mesmo envelope, mesmos componentes — foram reescritas do zero,
 *   porque o cache da escrita é o prompt inteiro e a visão geral mudou;
 * - a Task 10 da fase 3 mandava "concluir a cobertura automatizada própria do
 *   módulo", o I-16 não reconhecia o verbo depois de "e", e a triagem descartou
 *   o achado citando a própria frase acusada: ela não recebia a regra do
 *   planejamento entre as fontes.
 *
 * As respostas dos papéis falsos são as do run, casadas pelo conteúdo que o
 * papel recebe: o auditor de coerência acusa `src/web/main.tsx` enquanto ele
 * estiver na fase 1, e a descoberta em `src/web/app.tsx` enquanto ela estiver
 * lá, com as palavras exatas dos achados do run. O que não aconteceu no run não
 * é inventado: onde um cenário precisa de uma resposta que o run não teve, o
 * comentário diz qual e por quê.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { NO_QUESTIONS, approve, fakeAgent, materialityKeeps, rehearsalApproves, reject } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

const fixture = (nome: string): string => readFileSync(join(import.meta.dirname, "..", "fixtures", nome), "utf8");

const PEDIDO = fixture("parallel-lab-128.pedido.md");
const ESQUELETO = fixture("parallel-lab-128.skeleton.json");
const V5 = fixture("parallel-lab-128.architecture-v5.json");
const V6 = fixture("parallel-lab-128.architecture-v6.json");
const FASES = JSON.parse(fixture("parallel-lab-128.fases.json")) as { r1: Record<string, string>; r3: Record<string, string> };
const EMENDA_P1 = fixture("parallel-lab-128.p1-emenda-rodada2.md");

/** A oração da Task 10 da fase 3 que o I-16 deixava passar. */
const ORACAO_DE_TESTE = " e concluir a cobertura automatizada própria do módulo";
/**
 * A fase 3 da rodada 1 sem a oração de teste: os cenários de outros mecanismos
 * não podem depender de como o I-16 lê aquela frase. É também a emenda que o
 * cenário do I-16 usa — o run nunca chegou a emendar a Task 10 (a
 * reorganização veio antes), então essa resposta é a mínima: a oração sai, o
 * resto da fase volta igual.
 */
const P3_SEM_TESTE = FASES.r1["3"]!.replace(ORACAO_DE_TESTE, "");

/** Os achados do run, com as palavras exatas (logs da coerência, rodadas 1 e 2, e da fase 3, rodada 1). */
const ACHADO_DO_MAIN = reject(
  "P1.T1.C3 vs P2.T4.C1",
  "A fundação exige que `index.html` monte `src/web/main.tsx`, enquanto a estrutura da interface exige que `src/main.tsx` monte o React. O contrato de `web-shell` em architecture.md e P2.T4.C1 sustentam `src/main.tsx`.",
  "Em P1, use `src/main.tsx` como ponto de entrada e mantenha a descoberta de páginas nos caminhos `src/App.tsx` e `src/modules/*/page.tsx` previstos para a interface.",
);
const ACHADO_DA_DESCOBERTA = reject(
  "Architecture (P1.T7.C1 vs P2.T5.C1; P3.T6.C1; P4.T9.C1; P5.T9.C3)",
  "P1 estabelece a descoberta de páginas em `src/web/app.tsx` e `src/web/modules/*/page.tsx`, mas as fases seguintes e a arquitetura exigem `src/App.tsx` e `src/modules/*/page.tsx`. Assim, os módulos não usam o ponto de descoberta que a fundação diz entregar.",
  "Reorganize Phase 1 e Phase 2 para entregar e usar o contrato da arquitetura: descoberta em `src/App.tsx` de páginas em `src/modules/*/page.tsx`; mantenha as fases dos módulos nesse caminho.",
);
const ACHADO_DA_TASK_10 = reject(
  "Task 10",
  "A tarefa inclui “concluir a cobertura automatizada própria do módulo”, prescrevendo a entrega de uma suíte de testes, o que contraria a responsabilidade do planejamento.",
  "Restrinja a tarefa à exclusão com confirmação e mantenha o requisito de testes automatizados isolados apenas como critério do produto, sem atribuir a esta tarefa a entrega ou cobertura da suíte.",
);

/** O prompt de uma fase escrita sobre a arquitetura reorganizada (v6): a visão geral dela é outra. */
const daV6 = (prompt: string): boolean => prompt.includes("a interface React descobre páginas em");
const ehEmenda = (prompt: string): boolean => prompt.includes("## The phase to amend");
const ehReorganizacao = (prompt: string): boolean => prompt.includes("## The audit of your previous architecture found");

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-128-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: PEDIDO, origin: "text" as const, path: null, sha12: "parallellab128" };
const language = "português do Brasil" as const;

interface Papeis {
  /** A fase N escrita do zero; por padrão, a da rodada 1 sobre a v5 e a da rodada 3 sobre a v6. */
  fase?: (numero: number, call: AgentCall) => string;
  /** A emenda da fase N; por padrão, a do run para a fase 1, e falha para as outras. */
  emenda?: (numero: number, call: AgentCall) => string;
  auditorDaFase?: (numero: number, call: AgentCall) => string;
  coerencia?: (call: AgentCall) => string;
  arquiteto?: (call: AgentCall) => string;
  auditorDaArquitetura?: (call: AgentCall) => string;
  triagem?: ScriptStep;
}

function faseDoRun(numero: number, call: AgentCall): string {
  if (daV6(call.prompt)) return FASES.r3[String(numero)]!;
  return numero === 3 ? P3_SEM_TESTE : FASES.r1[String(numero)]!;
}

/** O auditor de coerência do run: acusa o que estava na fase 1, e só isso. */
function coerenciaDoRun(call: AgentCall): string {
  if (call.prompt.includes("monta a aplicação React a partir de `src/web/main.tsx`")) return ACHADO_DO_MAIN;
  if (call.prompt.includes("`src/web/app.tsx` descobre páginas")) return ACHADO_DA_DESCOBERTA;
  return approve();
}

function roteiro(papeis: Papeis = {}): ScriptStep[] {
  return [
    { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: ESQUELETO }, repeat: true },
    {
      match: { role: "writer", stage: "authoring", subject: "architecture" },
      respond: { stdout: papeis.arquiteto ?? ((call) => (ehReorganizacao(call.prompt) ? V6 : V5)) },
      repeat: true,
    },
    ...[1, 2, 3, 4, 5].map((numero): ScriptStep => ({
      match: { role: "writer", stage: "authoring", subject: `phase-p0${numero}` },
      respond: {
        stdout: (call) => {
          if (!ehEmenda(call.prompt)) return (papeis.fase ?? faseDoRun)(numero, call);
          if (papeis.emenda) return papeis.emenda(numero, call);
          if (numero === 1) return EMENDA_P1;
          // A fase 2 também é citada pelo achado do `main.tsx`; no run, a emenda dela voltou byte a byte igual.
          if (numero === 2) return FASES.r1["2"]!;
          throw new Error(`emenda sem roteiro para a fase ${numero}`);
        },
      },
      repeat: true,
    })),
    { match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" }, respond: { stdout: papeis.coerencia ?? coerenciaDoRun }, repeat: true },
    ...(papeis.auditorDaArquitetura ? [{ match: { role: "auditor" as const, stage: "audit" as const, subject: "architecture" }, respond: { stdout: papeis.auditorDaArquitetura }, repeat: true }] : []),
    {
      match: { role: "auditor", stage: "audit" },
      respond: {
        stdout: (call) => {
          const numero = Number(/#P(\d+)$/.exec(call.subject)?.[1] ?? "0");
          return numero > 0 && papeis.auditorDaFase ? papeis.auditorDaFase(numero, call) : approve();
        },
      },
      repeat: true,
    },
    papeis.triagem ?? materialityKeeps(),
    rehearsalApproves(),
  ];
}

async function planejar(papeis: Papeis = {}) {
  const agentDoInit = fakeAgent(roteiro(papeis));
  await runInit({ projectRoot, request, language, stage: "init", call: agentDoInit.call, ask: async () => "1", announce: () => undefined });
  const perguntadas: Question[] = [];
  const avisos: string[] = [];
  const agent = fakeAgent(roteiro(papeis));
  const outcome = await runPlan({
    projectRoot, request, language, call: agent.call,
    ask: async (question) => { perguntadas.push(question); return "1"; },
    announce: (linha) => { avisos.push(linha); },
    sleep: async () => undefined,
    decideStandoff: async () => "publicar",
  });
  const publicado = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8").catch(() => "");
  return { outcome, agent, perguntadas, avisos, publicado };
}

const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

/** O retrato do custo de um cenário, para a medição antes/depois (§128, fase E). */
function custo(agent: { calls: AgentCall[] }) {
  const conta = (filtro: (call: AgentCall) => boolean): number => agent.calls.filter(filtro).length;
  const escritaDeFase = (call: AgentCall) => call.stage === "authoring" && call.subject.startsWith("phase-p");
  const medida = {
    total: agent.calls.length,
    arquiteto: conta((call) => call.stage === "authoring" && call.subject === "architecture"),
    auditorDaArquitetura: conta((call) => call.stage === "audit" && call.subject === "architecture"),
    fasesEscritasDoZero: conta((call) => escritaDeFase(call) && !ehEmenda(call.prompt)),
    emendasDeFase: conta((call) => escritaDeFase(call) && ehEmenda(call.prompt)),
    auditoresDeFase: conta((call) => call.stage === "audit" && /#P\d+$/.test(call.subject)),
    coerencia: conta((call) => call.subject === "project-phases.md#coerência"),
    triagem: conta((call) => call.subject === "project-phases.md#materialidade"),
    ensaio: conta((call) => call.stage === "verify"),
    reorganizacoes: conta((call) => call.stage === "authoring" && call.subject === "architecture" && ehReorganizacao(call.prompt)),
  };
  if (process.env.CAPIVARA_MEDIR) console.log(`MEDIDA ${expect.getState().currentTestName}: ${JSON.stringify(medida)}`);
  return medida;
}

describe("§128 · o caminho limpo com os textos do run", () => {
  it("arquitetura v5 e fases da rodada 1, todos aprovando: as mesmas chamadas de sempre", async () => {
    const { outcome, agent } = await planejar({ coerencia: () => approve() });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const medida = custo(agent);
    expect(medida).toMatchObject({ arquiteto: 1, auditorDaArquitetura: 1, fasesEscritasDoZero: 5, emendasDeFase: 0, auditoresDeFase: 5, coerencia: 1, triagem: 0, reorganizacoes: 0 });
  });
});

describe("§128 · A2 — a correção que o achado alcança pelos caminhos que cita não é desfeita", () => {
  it("a emenda da fase 1 fica com as Tasks 7 e 8 corrigidas, e a coerência não devolve o conflito à arquitetura", async () => {
    const { outcome, agent, publicado } = await planejar();
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const medida = custo(agent);
    // A reorganização do run (arquiteto + auditor + cinco fases do zero) não acontece.
    expect(medida.reorganizacoes).toBe(0);
    expect(medida.arquiteto).toBe(1);
    expect(medida.fasesEscritasDoZero).toBe(5);
    // As fases 1 e 2, que o achado do `main.tsx` cita — como no run.
    expect(medida.emendasDeFase).toBe(2);
    // O plano publicado tem a descoberta onde a arquitetura a fixou, e nenhum `src/web/`.
    expect(publicado).toContain("`src/App.tsx` descobre páginas em `src/modules/*/page.tsx`");
    expect(publicado).not.toContain("src/web/");
  });
});

describe("§128 · A6 — a reorganização não reescreve a fase que ela não tocou", () => {
  /** A coerência do run, rodada 2: a descoberta em `src/web/app.tsx` vai à arquitetura — aqui, já na rodada 1. */
  const soADescoberta = (call: AgentCall): string =>
    call.prompt.includes("`src/web/app.tsx` descobre páginas") ? ACHADO_DA_DESCOBERTA : approve();

  it("as fases 3, 4 e 5 (mesmo envelope, mesmos componentes) mantêm o texto; 1 e 2 são reescritas", async () => {
    const { outcome, agent, publicado } = await planejar({ coerencia: soADescoberta });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const medida = custo(agent);
    expect(medida.reorganizacoes).toBe(1);
    // Cinco da primeira divisão e duas da segunda: só as fases cujo envelope a reorganização mudou.
    expect(medida.fasesEscritasDoZero).toBe(7);
    const escritas = (numero: number) => por(agent, { role: "writer", stage: "authoring", subject: `phase-p0${numero}` }).length;
    expect([1, 2, 3, 4, 5].map(escritas)).toEqual([2, 2, 1, 1, 1]);
    // O plano publicado tem as fases 3–5 que existiam, e as 1–2 reescritas sobre a arquitetura nova.
    expect(publicado).toContain(P3_SEM_TESTE.split("\n")[0]!);
    expect(publicado).toContain(FASES.r1["4"]!.split("\n")[0]!);
    expect(publicado).toContain(FASES.r3["1"]!.split("\n")[0]!);
  });

  it("a fase mantida é relida contra a fatia nova: nenhuma aprovação dada contra a arquitetura anterior a dispensa", async () => {
    const { outcome, agent } = await planejar({ coerencia: soADescoberta });
    custo(agent);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    for (const numero of [3, 4, 5]) {
      const auditorias = por(agent, { stage: "audit", subject: `project-phases.md#P${numero}` });
      // Aprovada na rodada 1 com o mesmo texto — e auditada de novo depois da reorganização.
      expect(auditorias, `fase ${numero}`).toHaveLength(2);
      const depois = auditorias[1]!.prompt;
      expect(depois).toContain("a interface React descobre páginas em");
      expect(depois).not.toContain("## Already approved — NOT under audit now");
    }
  });

  it("a fase mantida que a arquitetura nova deixou velha volta como emenda, nunca aprovada por herança", async () => {
    // A v6 com a descoberta noutro diretório: o contrato que as fases 3–5 consomem mudou, o envelope delas não.
    const v6Paginas = V6.replace("src/App.tsx descobre e monta as páginas dos módulos em src/modules/*/page.tsx", "src/App.tsx descobre e monta as páginas dos módulos em src/pages/*/page.tsx");
    expect(v6Paginas).not.toBe(V6);
    const emendas: number[] = [];
    const { outcome, agent } = await planejar({
      coerencia: soADescoberta,
      arquiteto: (call) => (ehReorganizacao(call.prompt) ? v6Paginas : V5),
      // O auditor de cada fase de módulo confere o diretório das páginas contra o contrato que recebeu.
      auditorDaFase: (numero, call) =>
        numero >= 3 && call.prompt.includes("src/pages/*/page.tsx") && /^- \[ \] \*\*Task:\*\*.*src\/modules\/[a-z]+\/page\.tsx/m.test(call.prompt)
          ? reject(`P${numero}.T1`, "a página do módulo fica em `src/modules/`, mas o contrato do `web-shell` descobre páginas em `src/pages/*/page.tsx`", "mova a página do módulo para `src/pages/<módulo>/page.tsx`")
          : approve(),
      emenda: (numero, call) => {
        emendas.push(numero);
        const atual = call.prompt.slice(call.prompt.indexOf("## The phase to amend") + "## The phase to amend".length).trim();
        return atual.replaceAll(/src\/modules\/([a-z]+)\/page\.tsx/g, "src/pages/$1/page.tsx");
      },
    });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    // As três fases mantidas foram devolvidas ao escritor pelo auditor delas, sobre a fatia nova.
    expect([...new Set(emendas)].sort()).toEqual([3, 4, 5]);
    // Uma emenda por fase: a correção do auditor ("`src/pages/<módulo>/page.tsx`") alcança todas as tasks que movem a página.
    expect(emendas).toHaveLength(3);
    expect(custo(agent).fasesEscritasDoZero).toBe(7);
  });
});

describe("§128 · A4/A5 — o trabalho de teste numa task não chega à auditoria, nem sai dela pela triagem", () => {
  /**
   * A triagem do run, rodada 1: o achado da Task 10 saiu ADVISORY citando a
   * própria frase acusada ("a fonte não proíbe atribuir testes à fase"); os
   * outros, KEEP.
   */
  const triagemDoRun: ScriptStep = {
    match: { role: "verifier", stage: "audit", subject: "project-phases.md#materialidade" },
    respond: {
      stdout: (call) => {
        const marker = "## Review input (JSON)\n";
        const input = JSON.parse(call.prompt.slice(call.prompt.indexOf(marker) + marker.length)) as { items: { id: string; claim: string }[] };
        return JSON.stringify({
          reviews: input.items.map((item) =>
            item.claim.includes("concluir a cobertura automatizada")
              ? {
                  id: item.id, disposition: "ADVISORY",
                  reason: "A fonte não proíbe atribuir testes à fase; a própria tarefa inclui essa entrega, em linha com o requisito de testes automatizados do produto.",
                  evidence: [{ source: "P3", quote: "implementar a exclusão com confirmação e concluir a cobertura automatizada própria do módulo" }],
                }
              : { id: item.id, disposition: "KEEP" }),
        });
      },
    },
    repeat: true,
  };

  it("a Task 10 da fase 3 do run volta ao escritor pelo I-16, antes de qualquer auditor, e o plano publicado não a carrega", async () => {
    const { outcome, agent, publicado } = await planejar({
      coerencia: () => approve(),
      fase: (numero, call) => (numero === 3 && !daV6(call.prompt) ? FASES.r1["3"]! : faseDoRun(numero, call)),
      auditorDaFase: (numero, call) => (numero === 3 && call.prompt.includes(ORACAO_DE_TESTE) ? ACHADO_DA_TASK_10 : approve()),
      emenda: (numero) => {
        if (numero !== 3) throw new Error(`emenda inesperada da fase ${numero}`);
        return P3_SEM_TESTE;
      },
      triagem: triagemDoRun,
    });
    const medida = custo(agent);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(publicado).not.toContain("concluir a cobertura automatizada");
    // O requisito do pedido continua na task, como critério do produto.
    expect(publicado).toContain("O módulo possui testes automatizados próprios executados com banco SQLite isolado");
    expect(medida.emendasDeFase).toBe(1);
    // Nenhum auditor leu a Task 10 com a oração de teste, e a triagem não foi chamada.
    expect(por(agent, { stage: "audit", subject: "project-phases.md#P3" }).every((call) => !call.prompt.includes(ORACAO_DE_TESTE))).toBe(true);
    expect(medida.triagem).toBe(0);
  });
});

describe("§128 · A1 — o auditor da arquitetura confere o que as rodadas anteriores fecharam", () => {
  /** A validação dos formulários, pedida na rodada 1 do run, escrita na 2 e perdida na 3 (v3 → v4). */
  const COM_VALIDACAO = V5.replaceAll("os formulários enviam as operações", "os formulários validam os campos obrigatórios antes do envio, enviam as operações");
  const ACHADO_DA_VALIDACAO = reject(
    "components · tarefas, categorias, anotacoes",
    "Os contratos das interfaces não exigem validação nos formulários; descrevem operações e confirmação de exclusão, enquanto a validação citada está na API.",
    "Acrescentar aos contratos de interface dos três módulos que os formulários validam os campos obrigatórios e as regras próprias antes do envio.",
  );
  const ACHADO_DO_ENV = reject(
    "infrastructure · Requisitos de ambiente e compatibilidade",
    "A arquitetura não preserva a regra de que somente o `.env` pode conter credenciais e de que nenhum outro arquivo do projeto pode conter senha, token ou string de conexão real.",
    "Registre essa restrição como requisito da configuração e do ambiente do projeto.",
  );

  it("a validação que a terceira escrita desfez chega à terceira leitura, ao lado do achado da segunda", async () => {
    let desenhos = 0;
    let leituras = 0;
    const { outcome, agent } = await planejar({
      coerencia: () => approve(),
      arquiteto: () => [V5, COM_VALIDACAO, V5][Math.min((desenhos += 1) - 1, 2)]!,
      auditorDaArquitetura: () => [ACHADO_DA_VALIDACAO, ACHADO_DO_ENV, approve()][Math.min((leituras += 1) - 1, 2)]!,
    });
    custo(agent);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const auditorias = por(agent, { stage: "audit", subject: "architecture" });
    expect(auditorias).toHaveLength(3);
    const terceira = auditorias[2]!.prompt;
    expect(terceira).toContain("## Your previous reading of this architecture found\n- infrastructure · Requisitos de ambiente e compatibilidade");
    expect(terceira).toContain("## Fixed in earlier readings — check it is still fixed\n- components · tarefas, categorias, anotacoes: Os contratos das interfaces não exigem validação nos formulários");
    // A segunda leitura só tinha a primeira para conferir: não há rodada antes dela.
    expect(auditorias[1]!.prompt).not.toContain("## Fixed in earlier readings");
  });
});

describe("§128 · C1/C2 — o que o harness sabe chega a quem escreve antes da primeira auditoria", () => {
  it("o arquiteto, o auditor e o escritor de fase recebem as regras que o run só descobriu devolvendo", async () => {
    const { agent } = await planejar({ coerencia: () => approve() });
    const arquiteto = por(agent, { stage: "authoring", subject: "architecture" })[0]!.prompt;
    // "a fase 2 não cobre nada" custou uma escrita: a regra do contrato não estava no prompt.
    expect(arquiteto).toContain("Every phase covers at least one story, entity or workflow of the skeleton");
    // O goal da fase 1 prometia a descoberta de páginas sem nomear o `web-shell`.
    expect(arquiteto).toContain("A phase's goal promises only what its own components deliver.");
    // Os testes de cada módulo, que o pedido exige, têm lugar: o componente e o critério — nunca a task.
    for (const prompt of [arquiteto, por(agent, { stage: "authoring", subject: "phase-p03" })[0]!.prompt]) {
      expect(prompt).toContain("When the developer requires automated tests — for the product, or for each module — that requirement");
    }
    const auditor = por(agent, { stage: "audit", subject: "architecture" })[0]!.prompt;
    expect(auditor).toContain("The developer's own requirement that the product, or each module, has automated");
    expect(auditor).toContain("and so is a goal that promises the work of a");
  });
});

describe("§128 · as garantias que ficam", () => {
  it("11 — o escritor que só corrige a Task 1 não é salvo pela regra nova: a coerência ainda acusa, e a arquitetura é refeita", async () => {
    // A emenda que o harness antigo deixava: a Task 1 corrigida, as Tasks 7 e 8 com `src/web/`.
    const soATask1 = FASES.r1["1"]!.replace("`index.html` monta a aplicação React a partir de `src/web/main.tsx`", "`index.html` monta a aplicação React a partir de `src/main.tsx`");
    const { outcome, agent } = await planejar({ emenda: (numero) => (numero === 1 ? soATask1 : FASES.r1[String(numero)]!) });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(custo(agent).reorganizacoes).toBe(1);
  });

  it("10 — depois da reorganização, a coerência relê o índice inteiro: nenhum par aprovado contra a arquitetura anterior fica de fora", async () => {
    let p1 = 0;
    const { outcome, agent } = await planejar({
      coerencia: () => approve(),
      // O auditor da fase 1, na primeira leitura, pede a reorganização que no run veio da coerência.
      auditorDaFase: (numero, call) => (numero === 1 && call.prompt.includes("`src/web/app.tsx` descobre páginas") && (p1 += 1) === 1 ? ACHADO_DA_DESCOBERTA : approve()),
    });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(custo(agent).reorganizacoes).toBe(1);
    const coerencias = por(agent, { subject: "project-phases.md#coerência" });
    expect(coerencias).toHaveLength(2);
    expect(coerencias[1]!.prompt).not.toContain("## Coherence already approved under these same decisions");
  });

  it("9 — a decisão de produto que o auditor levanta continua indo ao desenvolvedor, e só ela", async () => {
    let p4 = 0;
    const decisao = `${approve()}\nCAPIVARA_DECISION: Task 2 | Uma categoria pode ser excluída enquanto tarefas antigas ainda citam o nome dela? | Sim, a exclusão é livre | Não, a exclusão é recusada`;
    const { outcome, perguntadas } = await planejar({
      coerencia: () => approve(),
      // A resposta do desenvolvedor volta à fase 4 como emenda; o roteiro devolve a fase como estava.
      emenda: (_numero, call) => call.prompt.slice(call.prompt.indexOf("## The phase to amend") + "## The phase to amend".length).trim(),
      auditorDaFase: (numero) => (numero === 4 && (p4 += 1) === 1 ? decisao : approve()),
    });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toHaveLength(1);
  });
});
