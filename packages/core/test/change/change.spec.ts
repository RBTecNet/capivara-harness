import { certifyCurrentPlan } from "../support/current-plan.js";
/**
 * A mudança numa aplicação que já roda.
 *
 * O `MCP_teste` fechou cinco fases e ficou sem edição de cliente — porque
 * ninguém pediu. Pedir depois não pode significar redesenhar o produto: o que
 * existe é autoridade, e o texto das fases já construídas não pode ser tocado.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANGE_CONTRACT, SKELETON_CONTRACT, applyChange, parseChange } from "../../src/contract/index.js";
import type { Change, Skeleton } from "../../src/contract/index.js";
import { ChangeBlockedError, lerResposta, runChange } from "../../src/change/index.js";

const ESQUELETO: Skeleton = {
  contract: SKELETON_CONTRACT,
  environment: [],
  projectName: "Locadora",
  stack: [{ component: "linguagem", decision: "TypeScript" }],
  entities: [{ name: "cliente", fields: [{ name: "id", type: "int" }], relations: [] }],
  stories: [{ id: "US-1.1", statement: "o atendente cadastra um cliente" }],
  workflows: [{ number: "1", name: "Cadastrar cliente", steps: ["abre a tela", "salva"] }],
  rules: [{ subject: "interface.tema", statement: "A cor de destaque é amarela." }],
  phases: [
    { number: 1, title: "Dados", goal: "tabelas", dependsOn: "none", covers: ["cliente"], areas: ["dados"], taskCount: 2 },
    { number: 2, title: "Cadastro", goal: "tela", dependsOn: "Phase 1", covers: ["workflow 1"], areas: ["frontend"], taskCount: 2 },
  ],
  mvpCutPhase: 2,
};

describe("o contrato da mudança", () => {
  const delta = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      contract: CHANGE_CONTRACT,
      summary: "edição de clientes",
      touches: ["a tela de cadastro"],
      entities: [],
      rules: [],
      workflows: [],
      phases: [{ title: "Edição de clientes", goal: "alterar e remover", dependsOn: "Phase 2", covers: ["cliente"], areas: ["frontend"], taskCount: 3 }],
      questions: [],
      ...overrides,
    });

  it("aceita uma mudança de uma fase", () => {
    const lido = parseChange(delta(), { maxTasksPerPhase: 12 });
    if (!lido.ok) throw new Error(lido.defects.map((defeito) => defeito.problem).join("; "));
    expect(lido.change.phases).toHaveLength(1);
  });

  /*
   * Acima de três fases não é mudança, é projeto — e projeto se faz com init,
   * onde há entrevista, auditoria e ensaio.
   */
  it("recusa mudança grande demais para ser mudança", () => {
    const quatro = Array.from({ length: 4 }, (_, indice) => ({
      title: `fase ${indice}`,
      goal: "x",
      dependsOn: "none",
      covers: [],
      areas: [],
      taskCount: 1,
    }));
    const lido = parseChange(delta({ phases: quatro }), { maxTasksPerPhase: 12 });
    expect(lido.ok).toBe(false);
    if (!lido.ok) expect(lido.defects[0]?.hint).toContain("init");
  });

  it("recusa fase sem meta e fase que não cabe numa sessão", () => {
    expect(parseChange(delta({ phases: [{ title: "x", goal: "", dependsOn: "none", covers: [], areas: [], taskCount: 2 }] }), { maxTasksPerPhase: 12 }).ok).toBe(false);
    expect(parseChange(delta({ phases: [{ title: "x", goal: "y", dependsOn: "none", covers: [], areas: [], taskCount: 99 }] }), { maxTasksPerPhase: 12 }).ok).toBe(false);
  });

  /*
   * Perguntar e planejar no mesmo lote seria planejar sobre a suposição que a
   * pergunta ainda vai desfazer.
   */
  it("aceita perguntas sem fase, e recusa o lote vazio", () => {
    const perguntando = parseChange(
      delta({ phases: [], questions: [{ id: "M-01", topic: "escopo", decision: "Remover também apaga o histórico?", why: "muda o modelo de dados", options: [], recommended: "" }] }),
      { maxTasksPerPhase: 12 },
    );
    expect(perguntando.ok).toBe(true);
    expect(parseChange(delta({ phases: [], questions: [] }), { maxTasksPerPhase: 12 }).ok).toBe(false);
  });
});

describe("fundir a mudança no esqueleto", () => {
  const mudanca = (overrides: Partial<Change> = {}): Change => ({
    contract: CHANGE_CONTRACT,
    summary: "x",
    entities: [],
    rules: [],
    workflows: [],
    phases: [{ title: "Edição de clientes", goal: "alterar e remover", dependsOn: "Phase 2", covers: ["cliente"], areas: ["frontend"], taskCount: 3 }],
    touches: [],
    questions: [],
    ...overrides,
  });

  it("as fases novas vão para o fim, numeradas na sequência", () => {
    const aplicada = applyChange(ESQUELETO, mudanca());
    expect(aplicada.novas.map((fase) => fase.number)).toEqual([3]);
    expect(aplicada.skeleton.phases).toHaveLength(3);
    // As que já existiam não mudam de número: o plano publicado é a ordem em
    // que o build executou, e renumerar quebraria o que já foi commitado.
    expect(aplicada.skeleton.phases.slice(0, 2)).toEqual(ESQUELETO.phases);
  });

  /*
   * Deixar duas regras contraditórias no esqueleto é pior que qualquer uma
   * delas sozinha: a próxima fase a ser implementada escolhe a errada.
   */
  it("regra que substitui outra ocupa o lugar dela, pelo texto exato", () => {
    const aplicada = applyChange(
      ESQUELETO,
      mudanca({ rules: [{ subject: "interface.tema", statement: "A cor de destaque é azul.", replaces: "A cor de destaque é amarela." }] }),
    );

    expect(aplicada.skeleton.rules).toHaveLength(1);
    expect(aplicada.skeleton.rules[0]?.statement).toBe("A cor de destaque é azul.");
    expect(aplicada.avisos).toEqual([]);
  });

  it("texto que não bate vira acréscimo e aviso, nunca apagamento silencioso", () => {
    const aplicada = applyChange(
      ESQUELETO,
      mudanca({ rules: [{ subject: "interface.tema", statement: "A cor é azul.", replaces: "a cor de destaque é amarela" }] }),
    );

    expect(aplicada.skeleton.rules).toHaveLength(2);
    expect(aplicada.avisos[0]).toContain("não foi encontrada");
  });

  it("entidade existente é atualizada; nova é criada", () => {
    const aplicada = applyChange(
      ESQUELETO,
      mudanca({
        entities: [
          { name: "cliente", fields: [{ name: "id", type: "int" }, { name: "telefone", type: "text" }], relations: [] },
          { name: "auditoria", fields: [{ name: "id", type: "int" }], relations: [] },
        ],
      }),
    );

    expect(aplicada.skeleton.entities).toHaveLength(2);
    expect(aplicada.skeleton.entities[0]?.fields).toHaveLength(2);
    expect(aplicada.aplicados).toContain("entidade cliente atualizada");
    expect(aplicada.aplicados).toContain("entidade auditoria criada");
  });

  it("fluxo novo ganha o próximo número; fluxo existente é reescrito no lugar", () => {
    const novo = applyChange(ESQUELETO, mudanca({ workflows: [{ number: "", name: "Editar cliente", steps: ["abre", "altera", "salva"] }] }));
    expect(novo.skeleton.workflows.map((fluxo) => fluxo.number)).toEqual(["1", "2"]);

    const reescrito = applyChange(ESQUELETO, mudanca({ workflows: [{ number: "1", name: "Cadastrar cliente", steps: ["abre", "preenche", "salva"] }] }));
    expect(reescrito.skeleton.workflows).toHaveLength(1);
    expect(reescrito.skeleton.workflows[0]?.steps).toHaveLength(3);
  });
});

describe("a resposta a uma pergunta da mudança", () => {
  const question = {
    id: "M-01",
    topic: "remoção",
    decision: "Remover um cliente apaga o histórico?",
    why: "muda o modelo de dados",
    options: [
      { label: "apaga tudo", consequence: "mais simples" },
      { label: "marca como removido", consequence: "preserva o histórico" },
    ],
    recommended: "marca como removido",
  };

  it("número escolhe a opção", () => {
    expect(lerResposta(question, "2")).toBe("marca como removido");
  });

  it("vazio aceita a recomendada", () => {
    expect(lerResposta(question, "")).toBe("marca como removido");
  });

  it("texto livre vale como está", () => {
    expect(lerResposta(question, "só se não tiver locação em aberto")).toBe("só se não tiver locação em aberto");
  });
});

/**
 * O comando inteiro, com um modelo falso.
 *
 * O que estes testes protegem é a propriedade que faz o `change` valer: o texto
 * das fases já construídas volta LETRA POR LETRA. É ele que o registro de fases
 * fechadas usa para reconhecer o que não precisa ser refeito — reescrevê-lo,
 * mesmo para melhor, faria o build reconstruir a aplicação inteira para
 * acrescentar um formulário.
 */
describe("o comando change", () => {
  let projectRoot = "";

  const PLANO = [
    "# Locadora — Project Phases",
    "",
    "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
    "",
    "## Overview",
    "",
    "2 fases, fundação primeiro. O MVP fecha na fase 2.",
    "",
    "**Conventions:**",
    "- `[ ]` pendente · `[x]` concluído",
    "",
    "## Phase 1: Dados",
    "",
    "**Goal:** tabelas · **Depends on:** none · **Covers:** cliente · **Areas:** dados",
    "",
    "- [ ] **Task:** Criar a tabela de clientes",
    "  - **Acceptance criteria:**",
    "    - A tabela clientes existe com id e nome",
    "  - **Traces:** cliente",
    "",
    "## Phase 2: Cadastro",
    "",
    "**Goal:** tela · **Depends on:** Phase 1 · **Covers:** workflow 1 · **Areas:** frontend",
    "",
    "- [ ] **Task:** Construir a tela de cadastro",
    "  - **Acceptance criteria:**",
    "    - O formulário grava um cliente novo",
    "  - **Traces:** workflow 1",
    "",
  ].join("\n");

  const DELTA = JSON.stringify({
    contract: CHANGE_CONTRACT,
    summary: "edição e remoção de clientes",
    touches: ["a tela de cadastro de clientes"],
    entities: [],
    rules: [],
    workflows: [{ number: "", name: "Editar cliente", steps: ["abre a lista", "altera o telefone", "salva"] }],
    phases: [{ title: "Edição de clientes", goal: "alterar e remover clientes", dependsOn: "Phase 2", covers: ["workflow 2"], areas: ["frontend"], taskCount: 2 }],
    questions: [],
  });

  const TASKS = [
    "- [ ] **Task:** Implementar a edição de um cliente",
    "  - **Acceptance criteria:**",
    "    - Alterar o telefone grava e mostra o valor novo na lista",
    "  - **Traces:** workflow 2",
  ].join("\n");

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-change-"));
    await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
    await mkdir(join(projectRoot, ".capivara", "handoffs"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), PLANO, "utf8");
    await certifyCurrentPlan(projectRoot);
    await writeFile(join(projectRoot, ".capivara/init/skeleton.md"), "# Locadora — Skeleton\n", "utf8");
    await certifyCurrentPlan(projectRoot);
    await writeFile(join(projectRoot, "package.json"), '{"name":"locadora"}', "utf8");

    const { writeRequestState, writeSkeletonState } = await import("../../src/init/index.js");
    const { runIdFor } = await import("../../src/state/index.js");
    const { sha12 } = await import("../../src/contract/index.js");
    const pedido = { text: "uma locadora", origin: "text" as const, path: null, sha12: sha12("uma locadora") };
    await writeRequestState(projectRoot, pedido);
    await writeSkeletonState(projectRoot, runIdFor("init", pedido.sha12), ESQUELETO);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const modelo = (respostas: string[]) => {
    const chamadas: { subject: string; prompt: string }[] = [];
    let posicao = 0;
    return {
      chamadas,
      call: async (request: { subject: string; prompt: string }) => {
        chamadas.push({ subject: request.subject, prompt: request.prompt });
        return { exitCode: 0, stdout: respostas[posicao++] ?? "", stderr: "", timedOut: null };
      },
    };
  };

  it("acrescenta a fase e preserva o texto das que já existiam", async () => {
    const { call, chamadas } = modelo([DELTA, TASKS]);
    const resultado = await runChange({ projectRoot, language: "pt", request: "quero editar clientes", call });

    expect(resultado.novas.map((fase) => fase.number)).toEqual([3]);
    expect(chamadas.map((chamada) => chamada.subject)).toEqual(["delta", "phase-p03"]);

    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    // Letra por letra: é isto que o registro de fases fechadas reconhece.
    expect(plano).toContain("## Phase 1: Dados\n\n**Goal:** tabelas · **Depends on:** none · **Covers:** cliente · **Areas:** dados");
    expect(plano).toContain("- [ ] **Task:** Construir a tela de cadastro");
    expect(plano).toContain("## Phase 3: Edição de clientes");
    expect(plano).toContain("Alterar o telefone grava e mostra o valor novo na lista");
  });

  /*
   * Propriedade de escrita também aqui (I-18, §124). O `change` não passa pelo
   * ciclo de auditoria do `plan`; duas fases novas sem ordem entre si que
   * mandam registrar no mesmo arquivo compartilhado seriam executadas em
   * paralelo pelo build, editando o mesmo arquivo — o defeito do `haiku`,
   * publicado pelo estágio irmão.
   */
  const DELTA_DOIS_MODULOS = JSON.stringify({
    contract: CHANGE_CONTRACT,
    summary: "dois módulos novos sobre a mesma fundação",
    touches: ["a lista de montagem das rotas"],
    entities: [],
    rules: [],
    workflows: [
      { number: "", name: "Emitir relatório", steps: ["abre relatórios", "gera"] },
      { number: "", name: "Consultar auditoria", steps: ["abre auditoria", "lê"] },
    ],
    phases: [
      { title: "Relatórios", goal: "o atendente emite relatórios", dependsOn: "Phase 1", covers: ["workflow 2"], areas: ["backend"], taskCount: 1 },
      { title: "Auditoria", goal: "o atendente consulta a auditoria", dependsOn: "Phase 1", covers: ["workflow 3"], areas: ["backend"], taskCount: 1 },
    ],
    questions: [],
  });
  const registra = (modulo: string, fluxo: string) => [
    `- [ ] **Task:** Criar \`src/servidor/modulos/${modulo}/rotas.ts\` e registrar o módulo em \`src/servidor/modulos.ts\`, acrescentando a entrada \`/${modulo}\``,
    "  - **Acceptance criteria:**",
    `    - \`GET /api/${modulo}\` responde 200`,
    `  - **Traces:** ${fluxo}`,
  ].join("\n");
  const consome = (modulo: string, fluxo: string) => [
    `- [ ] **Task:** Criar \`src/servidor/modulos/${modulo}/rotas.ts\`, o stub registrado em \`src/servidor/modulos.ts\` pela fundação sob \`/${modulo}\``,
    "  - **Acceptance criteria:**",
    `    - \`GET /api/${modulo}\` responde 200`,
    `  - **Traces:** ${fluxo}`,
  ].join("\n");

  it("duas fases novas sem ordem entre si que escrevem no mesmo arquivo voltam ao escritor com o I-18, e o plano sai sem a escrita", async () => {
    const { call, chamadas } = modelo([DELTA_DOIS_MODULOS, registra("relatorios", "workflow 2"), registra("auditoria", "workflow 3"), consome("relatorios", "workflow 2"), consome("auditoria", "workflow 3")]);
    const resultado = await runChange({ projectRoot, language: "pt", request: "relatórios e auditoria", call });
    expect(resultado.novas.map((fase) => fase.number)).toEqual([3, 4]);
    expect(chamadas.map((chamada) => chamada.subject)).toEqual(["delta", "phase-p03", "phase-p04", "phase-p03", "phase-p04"]);
    expect(chamadas[3]?.prompt).toContain("## Your previous attempt was rejected (I-18)");
    expect(chamadas[3]?.prompt).toContain("ordena escrever em `src/servidor/modulos.ts`");
    expect(chamadas[3]?.prompt).toContain("a fase 4 — sem dependência com ela, que o build pode executar ao mesmo tempo");
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).not.toContain("registrar o módulo em `src/servidor/modulos.ts`");
    expect(plano).toContain("o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/relatorios`");
    expect(plano).toContain("## Phase 4: Auditoria");
    // As fases antigas continuam letra por letra.
    expect(plano).toContain("- [ ] **Task:** Construir a tela de cadastro");
  });

  it("se o escritor insistir na escrita concorrente, o change para dizendo o arquivo e as fases, e não publica", async () => {
    const { call } = modelo([DELTA_DOIS_MODULOS, registra("relatorios", "workflow 2"), registra("auditoria", "workflow 3"), registra("relatorios", "workflow 2"), registra("auditoria", "workflow 3")]);
    await expect(runChange({ projectRoot, language: "pt", request: "relatórios e auditoria", call })).rejects.toThrow(/I-18[\s\S]*src\/servidor\/modulos\.ts/u);
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).toBe(PLANO);
  });

  it("o esqueleto republicado carrega o fluxo novo", async () => {
    const { call } = modelo([DELTA, TASKS]);
    await runChange({ projectRoot, language: "pt", request: "quero editar clientes", call });

    const esqueleto = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");
    expect(esqueleto).toContain("workflow 2 — Editar cliente");
    expect(esqueleto).toContain("Phase 3: Edição de clientes");
  });

  /*
   * O texto das fases antigas é a chave do registro. Se o `change` o reescrevesse,
   * o build não reconheceria mais o que já construiu — e refaria tudo.
   */
  it("as fases antigas continuam com o mesmo sha que o build registrou", async () => {
    const { shaDaFase } = await import("../../src/loop/index.js");
    const { splitPhases } = await import("../../src/loop/index.js");

    const antes = splitPhases(PLANO, projectRoot, "build-x");
    if (!antes.ok) throw new Error("plano de teste inválido");
    const shasAntes = antes.sessions.map((sessao) => shaDaFase(sessao.markdown));

    const { call } = modelo([DELTA, TASKS]);
    const outcome = await runChange({ projectRoot, language: "pt", request: "editar clientes", call });

    const depois = splitPhases(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8"), projectRoot, "build-y");
    if (!depois.ok) throw new Error("plano republicado inválido");

    expect(depois.sessions.slice(0, 2).map((sessao) => shaDaFase(sessao.markdown))).toEqual(shasAntes);
    expect(depois.sessions).toHaveLength(3);
    const { readEnvironmentPlan } = await import("../../src/loop/environment-plan.js");
    await expect(readEnvironmentPlan(projectRoot,
      await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8"),
      await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8"),
    )).resolves.toEqual(ESQUELETO.environment);
    expect(outcome.written).toContain(join(projectRoot, ".capivara/init/environment.json"));
  });

  /*
   * Desde o §116 o plano cita a arquitetura no stamp. O `change` não a
   * reescreve, mas precisa citá-la com os bytes em disco e carregar o metadado
   * de infraestrutura adiante — senão o preflight do build lê um stamp que
   * esqueceu um input, e o build perde a infraestrutura que o plan declarou.
   */
  it("carimba a arquitetura publicada e preserva o metadado de infraestrutura", async () => {
    const arquitetura = "# Locadora — Arquitetura e infraestrutura\n\n## Componentes\n### api\n";
    await writeFile(join(projectRoot, ".capivara/init/architecture.md"), arquitetura, "utf8");
    const { sha12, parsePhases, checkStamp } = await import("../../src/contract/index.js");
    const metadado = JSON.parse(await readFile(join(projectRoot, ".capivara/init/environment.json"), "utf8"));
    await writeFile(join(projectRoot, ".capivara/init/environment.json"), JSON.stringify({ ...metadado, architectureSha12: sha12(arquitetura), infrastructure: { runtimes: [{ name: "Node.js" }] } }), "utf8");

    const { call } = modelo([DELTA, TASKS]);
    await runChange({ projectRoot, language: "pt", request: "editar clientes", call });

    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    const lido = parsePhases(plano);
    expect(lido.ok).toBe(true);
    if (lido.ok) {
      const esqueleto = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");
      expect(checkStamp(lido.document, [{ name: "skeleton.md", content: esqueleto }, { name: "architecture.md", content: arquitetura }])).toEqual([]);
    }
    const renovado = JSON.parse(await readFile(join(projectRoot, ".capivara/init/environment.json"), "utf8"));
    expect(renovado.architectureSha12).toBe(sha12(arquitetura));
    expect(renovado.infrastructure).toEqual({ runtimes: [{ name: "Node.js" }] });
    expect(await readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).toBe(arquitetura);
  });

  it("a pergunta vai à tela antes de virar fase, e a resposta volta ao planejador", async () => {
    const PERGUNTANDO = JSON.stringify({
      contract: CHANGE_CONTRACT,
      summary: "",
      touches: [],
      entities: [],
      rules: [],
      workflows: [],
      phases: [],
      questions: [
        {
          id: "M-01",
          topic: "remoção",
          decision: "Remover um cliente apaga o histórico de locações?",
          why: "muda o modelo de dados",
          options: [
            { label: "apaga tudo", consequence: "mais simples" },
            { label: "marca como removido", consequence: "preserva o histórico" },
          ],
          recommended: "marca como removido",
        },
      ],
    });

    const { call, chamadas } = modelo([PERGUNTANDO, DELTA, TASKS]);
    const perguntadas: string[] = [];

    await runChange({
      projectRoot,
      language: "pt",
      request: "quero editar e remover clientes",
      call,
      ask: async (question) => {
        perguntadas.push(question.decision);
        return "2";
      },
    });

    expect(perguntadas).toEqual(["Remover um cliente apaga o histórico de locações?"]);
    expect(chamadas[1]?.prompt).toContain("marca como removido");
  });

  it("sem ninguém para responder, não planeja sobre suposição", async () => {
    const PERGUNTANDO = JSON.stringify({
      contract: CHANGE_CONTRACT,
      summary: "",
      touches: [],
      entities: [],
      rules: [],
      workflows: [],
      phases: [],
      questions: [{ id: "M-01", topic: "x", decision: "Apaga o histórico?", why: "y", options: [], recommended: "" }],
    });

    const { call } = modelo([PERGUNTANDO]);
    await expect(runChange({ projectRoot, language: "pt", request: "x", call })).rejects.toThrow(/ninguém está aqui para tomar/);
  });

  it("projeto sem esqueleto manda rodar o init, não tenta adivinhar", async () => {
    const vazio = await mkdtemp(join(tmpdir(), "capivara-sem-plano-"));
    const { call } = modelo([DELTA]);
    await expect(runChange({ projectRoot: vazio, language: "pt", request: "x", call })).rejects.toThrow(ChangeBlockedError);
    await expect(runChange({ projectRoot: vazio, language: "pt", request: "x", call })).rejects.toThrow(/survey/);
    await rm(vazio, { recursive: true, force: true });
  });
});
