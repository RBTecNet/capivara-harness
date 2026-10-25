/**
 * §128 — os contratos que o Parallel Lab (0.7.1, run `init-dc741f0d7b92`)
 * mostrou incompletos, com os textos reais do run.
 *
 * - `preserveUnaddressedTasks` desfazia a correção que o achado alcançava
 *   pelos caminhos que citava, porque só olhava o endereço;
 * - o I-16 não lia o verbo de trabalho de teste depois de "e": "implementar a
 *   exclusão com confirmação e concluir a cobertura automatizada própria do
 *   módulo" passou pelo contrato e pela triagem;
 * - a reorganização não sabia quais fases ela não tinha tocado.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assemblePhase,
  checkTestPrescription,
  fasesIntactas,
  parseArchitecture,
  parsePhases,
  parseSkeleton,
  preserveUnaddressedTasks,
  testPrescriptions,
  testRequirements,
} from "../../src/contract/index.js";
import type { Architecture } from "../../src/contract/index.js";
import { arquiteturaSemTestes, faseSemTestes } from "../support/sem-testes.js";
import type { AuditVerdict } from "../../src/audit/index.js";
import { planningScopeBlock } from "../../src/prompts/index.js";

const fixture = (nome: string): string => readFileSync(join(import.meta.dirname, "..", "fixtures", nome), "utf8");
const FASES = JSON.parse(fixture("parallel-lab-128.fases.json")) as { r1: Record<string, string>; r3: Record<string, string> };
const PEDIDO = fixture("parallel-lab-128.pedido.md");

const envelope = (numero: number) => ({ number: numero, title: `Fase ${numero}`, goal: "objetivo", dependsOn: numero === 1 ? "none" : `Phase ${numero - 1}`, covers: ["tarefas"], areas: ["frontend"] });
const fase = (numero: number, tasks: string): string => assemblePhase(envelope(numero), tasks).trim();

/** O achado da coerência, rodada 1 do run, com as palavras exatas. */
const ACHADO_DO_MAIN = {
  where: "P1.T1.C3 vs P2.T4.C1",
  problem: "A fundação exige que `index.html` monte `src/web/main.tsx`, enquanto a estrutura da interface exige que `src/main.tsx` monte o React. O contrato de `web-shell` em architecture.md e P2.T4.C1 sustentam `src/main.tsx`.",
  fix: "Em P1, use `src/main.tsx` como ponto de entrada e mantenha a descoberta de páginas nos caminhos `src/App.tsx` e `src/modules/*/page.tsx` previstos para a interface.",
};

const blocos = (markdown: string): string[] => markdown.split(/\n(?=- \[ \] \*\*Task:\*\*)/).filter((parte) => parte.startsWith("- [ ] **Task:**"));

describe("§128 · A2 — a emenda guarda o que o achado alcança pelo que cita", () => {
  const antes = fase(1, FASES.r1["1"]!);
  const emendada = fase(1, fixture("parallel-lab-128.p1-emenda-rodada2.md"));

  it("a correção das Tasks 7 e 8 do run fica; as tasks que o achado não toca voltam byte a byte", () => {
    const resultado = preserveUnaddressedTasks(antes, emendada, 1, [ACHADO_DO_MAIN]);
    expect(resultado).toContain("`index.html` monta a aplicação React a partir de `src/main.tsx`");
    expect(resultado).toContain("`src/App.tsx` descobre páginas em `src/modules/*/page.tsx`");
    expect(resultado).toContain("`src/modules/painel/page.tsx`");
    expect(resultado).not.toContain("src/web/");
    // Tasks 2 a 6: o achado não cita nada delas, e elas voltam como estavam.
    const [r, a] = [blocos(resultado), blocos(antes)];
    expect(r.slice(1, 6)).toEqual(a.slice(1, 6));
  });

  it("uma reescrita não pedida numa task que o achado não alcança continua sendo desfeita", () => {
    const comDeriva = emendada.replace("crie migrações versionadas", "crie migrações QUE NINGUÉM PEDIU");
    expect(comDeriva).not.toBe(emendada);
    const resultado = preserveUnaddressedTasks(antes, comDeriva, 1, [ACHADO_DO_MAIN]);
    expect(resultado).not.toContain("QUE NINGUÉM PEDIU");
    expect(resultado).toContain("crie migrações versionadas");
  });

  it("um trecho genérico (`/api`) não alcança task nenhuma", () => {
    const tasks = [
      "- [ ] **Task:** Em `server/rotas.ts`, montar o roteador em `/api`.\n  - **Acceptance criteria:**\n    - `GET /api/tarefas` responde 200\n  - **Traces:** tarefas",
      "- [ ] **Task:** Em `server/erros.ts`, padronizar erros sob `/api`.\n  - **Acceptance criteria:**\n    - erros saem em JSON\n  - **Traces:** tarefas",
    ].join("\n\n");
    const antesGenerico = fase(1, tasks);
    const depois = antesGenerico.replace("padronizar erros sob", "REESCRITA sob").replace("responde 200", "responde 200 com lista");
    const resultado = preserveUnaddressedTasks(antesGenerico, depois, 1, [
      { where: "P1.T1.C1", problem: "o critério de `/api` não diz o corpo", fix: "diga que `/api` devolve a lista" },
    ]);
    expect(resultado).toContain("responde 200 com lista");
    expect(resultado).not.toContain("REESCRITA");
  });

  it("o padrão escrito com placeholder (`src/pages/<módulo>/page.tsx`) alcança as tasks que movem a página", () => {
    const tasks = [
      "- [ ] **Task:** Em `src/modules/tarefas/page.tsx`, listar as tarefas.\n  - **Acceptance criteria:**\n    - `src/modules/tarefas/page.tsx` mostra a lista\n  - **Traces:** tarefas",
      "- [ ] **Task:** Em `src/modules/tarefas/form.tsx`, cadastrar a tarefa pela página `src/modules/tarefas/page.tsx`.\n  - **Acceptance criteria:**\n    - o formulário valida o título\n  - **Traces:** tarefas",
    ].join("\n\n");
    const antesPaginas = fase(3, tasks);
    const depois = antesPaginas.replaceAll("src/modules/tarefas/page.tsx", "src/pages/tarefas/page.tsx");
    const resultado = preserveUnaddressedTasks(antesPaginas, depois, 3, [
      { where: "P3.T1", problem: "a página do módulo fica em `src/modules/`, mas o contrato descobre páginas em `src/pages/*/page.tsx`", fix: "mova a página do módulo para `src/pages/<módulo>/page.tsx`" },
    ]);
    expect(resultado).not.toContain("src/modules/tarefas/page.tsx");
    expect(resultado).toContain("pela página `src/pages/tarefas/page.tsx`");
  });

  it("outra convenção de caminhos: um projeto Laravel com `routes/web.php`", () => {
    const tasks = [
      "- [ ] **Task:** Em `app/Http/Controllers/TarefaController.php`, implementar o CRUD.\n  - **Acceptance criteria:**\n    - `GET /tarefas` lista as tarefas\n  - **Traces:** tarefas",
      "- [ ] **Task:** Registrar as rotas do módulo em `routes/api.php`.\n  - **Acceptance criteria:**\n    - `routes/api.php` declara `Route::resource('tarefas')`\n  - **Traces:** tarefas",
      "- [ ] **Task:** Em `resources/views/tarefas/index.blade.php`, listar as tarefas.\n  - **Acceptance criteria:**\n    - a página mostra a lista\n  - **Traces:** tarefas",
    ].join("\n\n");
    const antesLaravel = fase(2, tasks);
    const depois = antesLaravel.replaceAll("routes/api.php", "routes/web.php").replace("listar as tarefas.", "listar as tarefas DE OUTRO JEITO.");
    const resultado = preserveUnaddressedTasks(antesLaravel, depois, 2, [
      { where: "P2.T1.C1", problem: "as páginas do módulo são registradas em `routes/api.php`, mas a arquitetura fixa `routes/web.php`", fix: "registre as rotas de página em `routes/web.php`" },
    ]);
    expect(resultado).toContain("Registrar as rotas do módulo em `routes/web.php`");
    expect(resultado).not.toContain("routes/api.php");
    expect(resultado).not.toContain("DE OUTRO JEITO");
  });
});

describe("§128 · A4 — o I-16 lê o trabalho de teste também depois de \"e\"", () => {
  const autoridade = [PEDIDO];

  it("a Task 10 da fase 3 do run é prescrição de teste", () => {
    const termos = testPrescriptions("Em `src/modules/tarefas/components`, implementar a exclusão com confirmação e concluir a cobertura automatizada própria do módulo.", autoridade);
    expect(termos).toHaveLength(1);
    expect(termos[0]).toMatch(/^concluir a cobertura automatizada/);
    const plano = parsePhases(["# Parallel Lab — Project Phases", "", "<!-- inputs: a.md@sha256:000000000000 -->", "", fase(1, FASES.r1["3"]!)].join("\n"));
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    const erros = checkTestPrescription(plano.document, autoridade);
    expect(erros).toHaveLength(1);
    expect(erros[0]!.message).toContain("concluir a cobertura automatizada");
  });

  it("as mesmas formas, em inglês e com outros verbos de conclusão", () => {
    expect(testPrescriptions("Build the delete dialog and complete the test coverage of the module.")[0]).toMatch(/^complete the test coverage/);
    expect(testPrescriptions("Criar a página, e finalizar a suíte automatizada do módulo.")[0]).toMatch(/^finalizar a suíte automatizada/);
    expect(testPrescriptions("Implementar o formulário e escrever os testes de unidade.").length).toBeGreaterThan(0);
  });

  it("verbo de conclusão sem objeto de teste não é nada; o requisito de teste, desde a §129, é o pedido de testes dentro do plano", () => {
    // Até a §128 o requisito ficava no plano como critério; agora é do build, e a I-16 o conta (`testes-no-build-129.spec.ts`).
    expect(testPrescriptions("O módulo possui testes automatizados próprios executados com banco SQLite isolado do banco normal da aplicação.", autoridade)).toContain("módulo possui testes automatizados");
    expect(testPrescriptions("Implementar o cadastro e concluir a edição da tarefa pela interface.", autoridade)).toEqual([]);
    expect(testPrescriptions("Salvar a anotação e completar o formulário com a data de atualização.", autoridade)).toEqual([]);
  });

  it("o domínio que o pedido nomeia continua sendo produto", () => {
    expect(testPrescriptions("Cadastrar o paciente e criar os testes laboratoriais solicitados.", ["Sistema para cadastrar testes laboratoriais de pacientes"])).toEqual([]);
  });

  it("nenhuma task das cinco fases da rodada 3 do run, nem as outras da rodada 1, vira prescrição de TRABALHO; só o requisito de teste conta", () => {
    for (const [rodada, fases] of Object.entries(FASES)) {
      for (const [numero, texto] of Object.entries(fases)) {
        if (rodada === "r1" && numero === "3") continue;
        const plano = parsePhases(["# Parallel Lab — Project Phases", "", "<!-- inputs: a.md@sha256:000000000000 -->", "", fase(1, texto)].join("\n"));
        expect(plano.ok, `${rodada} fase ${numero}`).toBe(true);
        if (!plano.ok) continue;
        // O que a I-16 conta no texto do run é o critério "o módulo possui testes automatizados próprios" (§129), e nada mais.
        const termos = checkTestPrescription(plano.document, autoridade).flatMap((erro) => erro.message.split(" prescreve teste: ")[1]!.split(", "));
        for (const termo of termos) expect(testRequirements(termo), `${rodada} fase ${numero}: ${termo}`).not.toEqual([]);
        // Sem a frase, a fase é limpa.
        const limpa = parsePhases(["# Parallel Lab — Project Phases", "", "<!-- inputs: a.md@sha256:000000000000 -->", "", fase(1, faseSemTestes(texto))].join("\n"));
        if (limpa.ok) expect(checkTestPrescription(limpa.document, autoridade), `${rodada} fase ${numero}`).toEqual([]);
      }
    }
  });
});

describe("§128 · A6 — a reorganização sabe quais fases ela não tocou", () => {
  const esqueleto = parseSkeleton(fixture("parallel-lab-128.skeleton.json"), { maxTasksPerPhase: 15, authority: [PEDIDO] });
  const ler = (nome: string): Architecture => {
    if (!esqueleto.ok) throw new Error("esqueleto do run não lido");
    // A v5 e a v6 traziam "o módulo possui testes automatizados próprios" nos contratos; desde a §129 o contrato o recusa (`sem-testes.ts`).
    const lida = parseArchitecture(arquiteturaSemTestes(fixture(nome)), esqueleto.skeleton, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    if (!lida.ok) throw new Error(lida.defects.map((defeito) => defeito.problem).join("; "));
    return lida.architecture;
  };
  const v5 = ler("parallel-lab-128.architecture-v5.json");
  const v6 = ler("parallel-lab-128.architecture-v6.json");

  it("v5 → v6 do run: o goal das fases 1 e 2 e o contrato do `web-shell` mudaram; as fases 3, 4 e 5 não", () => {
    expect(fasesIntactas(v5, v6)).toEqual([3, 4, 5]);
  });

  it("o contrato do componente da própria fase mudou: a fase não está intacta", () => {
    const tarefas = v6.components.find((componente) => componente.name === "tarefas")!;
    const outra: Architecture = { ...v6, components: v6.components.map((componente) => (componente === tarefas ? { ...tarefas, contracts: [...tarefas.contracts, "PATCH /api/tarefas/{id}/status → 200"] } : componente)) };
    expect(fasesIntactas(v5, outra)).toEqual([4, 5]);
  });

  it("covers, dependências, componentes ou fluxos da fase mudaram: a fase não está intacta", () => {
    const comFase = (numero: number, mudanca: object): Architecture => ({ ...v6, phases: v6.phases.map((entrada) => (entrada.number === numero ? { ...entrada, ...mudanca } : entrada)) });
    expect(fasesIntactas(v5, comFase(4, { covers: ["categorias", "US-2.1"] }))).toEqual([3, 5]);
    expect(fasesIntactas(v5, comFase(5, { dependsOn: "Phase 1, Phase 2, Phase 4" }))).toEqual([3, 4]);
    expect(fasesIntactas(v5, comFase(3, { components: ["tarefas", "web-shell"] }))).toEqual([4, 5]);
    const fluxo = v6.flows.find((entrada) => entrada.components.includes("anotacoes"))!;
    expect(fasesIntactas(v5, { ...v6, flows: v6.flows.map((entrada) => (entrada === fluxo ? { ...entrada, components: [...entrada.components, "categorias"] } : entrada)) })).toEqual([3]);
  });

  it("integração posterior (a arquitetura do Luna da §127): o contrato do componente que a fase 6 integra muda — 2 e 6 são reescritas, os módulos ficam", () => {
    const luna = JSON.parse(arquiteturaSemTestes(fixture("luna-127.architecture.json"))) as Architecture;
    const outra: Architecture = {
      ...luna,
      components: luna.components.map((componente) => (componente.name === "interface-base" ? { ...componente, contracts: [...componente.contracts, "A navegação lateral marca a página ativa."] } : componente)),
    };
    expect(fasesIntactas(luna, outra)).toEqual([1, 3, 4, 5]);
  });

  it("decisão de dados ou infraestrutura mudada vale para todas as fases: nenhuma fica intacta (revisão)", () => {
    const status = v6.dataDecisions.map((decisao) => (decisao.subject === "tarefas.status" ? { ...decisao, statement: "aceitar somente aberta, fazendo ou feita" } : decisao));
    expect(fasesIntactas(v5, { ...v6, dataDecisions: status })).toEqual([]);
    expect(fasesIntactas(v5, { ...v6, infrastructure: { ...v6.infrastructure, compatibility: [...v6.infrastructure.compatibility, "Node 22"] } })).toEqual([]);
  });

  it("o caminho que saiu da fatia e que a fase cita a tira da lista; o que ela não cita, não", () => {
    const textos = [1, 2, 3, 4, 5].map((numero) => FASES.r1[String(numero)]!);
    // O run: o contrato do `web-shell` mudou de redação, e `src/modules/*/page.tsx` continua nele.
    expect(fasesIntactas(v5, v6, textos)).toEqual([3, 4, 5]);
    // A descoberta muda de diretório: as fases de módulo citam `src/modules/<módulo>/page.tsx`.
    const paginas: Architecture = {
      ...v6,
      overview: v6.overview.replace("src/modules/*/page.tsx", "src/pages/*/page.tsx"),
      components: v6.components.map((componente) => (componente.name === "web-shell"
        ? { ...componente, contracts: componente.contracts.map((contrato) => contrato.replace("src/modules/*/page.tsx", "src/pages/*/page.tsx")) }
        : componente)),
    };
    expect(fasesIntactas(v5, paginas, textos)).toEqual([]);
    // Sem os textos, só a estrutura conta.
    expect(fasesIntactas(v5, paginas)).toEqual([3, 4, 5]);
    // O que sai e ninguém cita não tira ninguém: a porta da API, que as fases 3–5 não mencionam.
    const porta: Architecture = {
      ...v6,
      components: v6.components.map((componente) => (componente.name === "api-base"
        ? { ...componente, contracts: [...componente.contracts, "Os logs do servidor ficam em logs/servidor.log."] }
        : componente)),
    };
    expect(fasesIntactas(porta, v6, textos)).toEqual([3, 4, 5]);
  });

  it("a justificativa e a visão geral não reescrevem fase nenhuma", () => {
    expect(fasesIntactas(v6, { ...v6, overview: "outra visão", phases: v6.phases.map((entrada) => ({ ...entrada, rationale: "outra razão" })) })).toEqual([1, 2, 3, 4, 5]);
  });
});

