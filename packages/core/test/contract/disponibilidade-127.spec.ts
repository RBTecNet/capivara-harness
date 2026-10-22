/**
 * §127 — quando cada fluxo pode ser cobrado: a derivação única que o plano usa
 * para escrever e auditar e o build usa para decidir o G4.
 *
 * Os textos são os do Parallel Lab com Luna (0.7.0): a arquitetura e o
 * esqueleto que o `plan` publicou no run `init-dc741f0d7b92`, guardados em
 * `test/fixtures/luna-127.*`. A fase 4 cobria o workflow 3 e dizia "pronta para
 * a integração … na fase 6"; o G4 o cobrou na fase 4.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocoDaDisponibilidade,
  contradicoesTemporais,
  disponibilidadeDaArquitetura,
  disponibilidadeDosFluxos,
  entradaTemporal,
  fasesNomeadas,
  parseArchitecture,
  tabelaDaDisponibilidade,
} from "../../src/contract/index.js";
import type { Architecture, Skeleton } from "../../src/contract/index.js";
import { arquiteturaSemTestes } from "../support/sem-testes.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
// O goal das fases 3–5 do Luna trazia "o módulo possui testes automatizados"; desde a §129 o contrato o recusa (`sem-testes.ts`).
const LUNA_ARQ = JSON.parse(arquiteturaSemTestes(readFileSync(join(FIXTURES, "luna-127.architecture.json"), "utf8"))) as Architecture;
const LUNA_ESQ = JSON.parse(readFileSync(join(FIXTURES, "luna-127.skeleton.json"), "utf8")) as Skeleton;
const LIMITES = { maxTasksPerPhase: 8 };

/** Uma arquitetura mínima de CRUD: fundação, shell, um módulo por entidade, e o que mais o caso pedir. */
function crud(fases: Architecture["phases"], extra: Partial<Architecture> = {}): Architecture {
  return {
    contract: "capivara-architecture/v1",
    overview: "monólito modular",
    components: [
      { name: "dados", responsibility: "persistência", areas: ["dados"], dependsOn: [], contracts: ["getDb()"], files: ["server/dados/"], owns: [] },
      { name: "api", responsibility: "servidor e registro de rotas", areas: ["backend"], dependsOn: ["dados"], contracts: ["registrarModulo(prefixo, roteador)"], files: ["server/api/"], owns: [] },
      { name: "shell", responsibility: "navegação e páginas", areas: ["frontend"], dependsOn: [], contracts: ["/tarefas", "/categorias"], files: ["src/app/"], owns: [] },
      { name: "tarefas", responsibility: "CRUD de tarefas", areas: ["backend", "frontend"], dependsOn: ["api", "shell", "dados"], contracts: ["GET /api/tarefas"], files: ["server/modulos/tarefas/", "src/modulos/tarefas/"], owns: ["tarefas"] },
      { name: "categorias", responsibility: "CRUD de categorias", areas: ["backend", "frontend"], dependsOn: ["api", "shell", "dados"], contracts: ["GET /api/categorias"], files: ["server/modulos/categorias/", "src/modulos/categorias/"], owns: ["categorias"] },
    ],
    dataDecisions: [],
    flows: [
      { workflow: "1", components: ["shell", "api", "tarefas", "dados"], notes: "" },
      { workflow: "2", components: ["shell", "api", "categorias", "dados"], notes: "" },
    ],
    infrastructure: { runtimes: [{ name: "Node.js", version: "", purpose: "runtime", basis: "stack" }], tools: [], packageManagers: [], dependencies: [], services: [], databases: [], compatibility: [], preconditions: [], requirements: [] },
    phases: fases,
    mvpCutPhase: fases.length,
    ...extra,
  };
}

const ESQUELETO: Skeleton = {
  contract: "capivara-skeleton/v2",
  projectName: "Lab",
  stack: [{ component: "linguagem", decision: "TypeScript" }],
  environment: [],
  entities: [
    { name: "tarefas", fields: [{ name: "titulo", type: "texto" }], relations: [] },
    { name: "categorias", fields: [{ name: "nome", type: "texto" }], relations: [] },
  ],
  stories: [{ id: "US-1.1", statement: "Como pessoa usuária, quero a aplicação de pé com navegação." }],
  workflows: [
    { number: "1", name: "Gestão de tarefas", steps: ["cadastrar uma tarefa", "consultar tarefas"] },
    { number: "2", name: "Gestão de categorias", steps: ["cadastrar uma categoria", "consultar categorias"] },
  ],
  rules: [],
  phases: [],
  mvpCutPhase: 1,
};

const fase = (number: number, title: string, goal: string, dependsOn: string, covers: string[], components: string[]): Architecture["phases"][number] => ({
  number, title, goal, dependsOn, covers, components, areas: ["backend"], taskCount: 3, rationale: "",
});
const FUNDACAO = fase(1, "Fundação", "persistência, servidor com registro de rotas e shell com navegação", "none", ["US-1.1"], ["dados", "api", "shell"]);

describe("§127 · a disponibilidade dos fluxos do Luna, derivada da arquitetura publicada", () => {
  it("a fase 4 deixa o workflow 3 para a fase 6 pelo próprio texto; a 3 e a 5 cobram os seus; a 6 cobra os quatro", () => {
    const disponibilidade = disponibilidadeDaArquitetura(LUNA_ARQ, LUNA_ESQ);
    expect(disponibilidade.cobrados(3)).toEqual(["2"]);
    expect(disponibilidade.cobrados(4)).toEqual([]);
    expect(disponibilidade.cobrados(5)).toEqual(["4"]);
    expect(disponibilidade.cobrados(6)).toEqual(["1", "2", "3", "4"]);
    const [adiado] = disponibilidade.adiados(4);
    expect(adiado).toMatchObject({ workflow: "3", fase: 4, para: 6, motivo: { tipo: "texto" } });
    expect(adiado!.motivo.tipo === "texto" && adiado!.motivo.trecho).toContain("na fase 6");
  });

  it("a fase 2 cobre o workflow 1 (abrir cada módulo) antes de os módulos existirem: fica para a 6, que completa o caminho", () => {
    const disponibilidade = disponibilidadeDaArquitetura(LUNA_ARQ, LUNA_ESQ);
    expect(disponibilidade.cobrados(2)).toEqual([]);
    expect(disponibilidade.adiados(2)).toEqual([
      expect.objectContaining({ workflow: "1", para: 6, motivo: { tipo: "caminho", faltam: ["modulo-tarefas", "modulo-categorias", "modulo-anotacoes"] } }),
    ]);
  });

  it("a arquitetura do Luna passa no contrato: os dois adiamentos são explícitos e esperam pela fase que completa", () => {
    const resultado = parseArchitecture(JSON.stringify(LUNA_ARQ), LUNA_ESQ, LIMITES);
    expect(resultado.ok, resultado.ok ? "" : JSON.stringify(resultado.defects)).toBe(true);
  });

  it("a fase 3 é revisitada pela 6, que mexe em api-central e interface-base no caminho do workflow 2: o auditor vê a pergunta", () => {
    const disponibilidade = disponibilidadeDaArquitetura(LUNA_ARQ, LUNA_ESQ);
    expect(disponibilidade.revisitados(3)).toEqual([{ workflow: "2", fase: 3, por: 6, componentes: ["api-central", "interface-base"] }]);
    const tabela = tabelaDaDisponibilidade(disponibilidade, [1, 2, 3, 4, 5, 6], new Map(LUNA_ESQ.workflows.map((workflow) => [workflow.number, workflow.name])));
    expect(tabela.join("\n")).toContain("Phase 4: covers workflow 3 (Gestão de categorias) but leaves it to Phase 6");
    expect(tabela.join("\n")).toContain("Phase 6 covers workflow 2 (Gestão de tarefas) again and changes api-central, interface-base");
  });
});

describe("§127 · as duas integrações válidas, sem regra universal", () => {
  it("17 — integração progressiva: a fase do módulo integra e cobre o fluxo; o G4 o percorre nela", () => {
    const arquitetura = crud([
      FUNDACAO,
      fase(2, "Tarefas", "CRUD de tarefas registrado no servidor e na navegação", "Phase 1", ["tarefas", "workflow 1"], ["tarefas"]),
      fase(3, "Categorias", "CRUD de categorias registrado no servidor e na navegação", "Phase 1", ["categorias", "workflow 2"], ["categorias"]),
    ]);
    const resultado = parseArchitecture(JSON.stringify(arquitetura), ESQUELETO, LIMITES);
    expect(resultado.ok, resultado.ok ? "" : JSON.stringify(resultado.defects)).toBe(true);
    const disponibilidade = disponibilidadeDaArquitetura(arquitetura, ESQUELETO);
    expect(disponibilidade.cobrados(2)).toEqual(["1"]);
    expect(disponibilidade.cobrados(3)).toEqual(["2"]);
    expect(disponibilidade.todosAdiados()).toEqual([]);
  });

  it("18 — integração posterior, sem cobrir o fluxo no módulo: nada a adiar, o G4 percorre os dois na fase de integração", () => {
    const arquitetura = crud([
      FUNDACAO,
      fase(2, "Tarefas", "módulo de tarefas exportado", "Phase 1", ["tarefas"], ["tarefas"]),
      fase(3, "Categorias", "módulo de categorias exportado", "Phase 1", ["categorias"], ["categorias"]),
      fase(4, "Integração", "conecta os módulos ao servidor e à navegação", "Phase 2, Phase 3", ["workflow 1", "workflow 2"], ["api", "shell"]),
    ]);
    expect(parseArchitecture(JSON.stringify(arquitetura), ESQUELETO, LIMITES).ok).toBe(true);
    const disponibilidade = disponibilidadeDaArquitetura(arquitetura, ESQUELETO);
    expect([2, 3].map((numero) => disponibilidade.cobrados(numero))).toEqual([[], []]);
    expect(disponibilidade.cobrados(4)).toEqual(["1", "2"]);
  });

  it("18 — integração posterior, com o módulo cobrindo o fluxo e nomeando a fase que integra: adiado, só esse fluxo", () => {
    const arquitetura = crud([
      FUNDACAO,
      fase(2, "Tarefas", "CRUD de tarefas registrado no servidor e na navegação", "Phase 1", ["tarefas", "workflow 1"], ["tarefas"]),
      fase(3, "Categorias", "CRUD de categorias, com a página pronta para a integração na fase 4", "Phase 1", ["categorias", "workflow 2"], ["categorias"]),
      fase(4, "Integração", "conecta categorias ao servidor e à navegação", "Phase 3", ["workflow 2"], ["api", "shell"]),
    ]);
    expect(parseArchitecture(JSON.stringify(arquitetura), ESQUELETO, LIMITES).ok).toBe(true);
    const disponibilidade = disponibilidadeDaArquitetura(arquitetura, ESQUELETO);
    // Só o que depende da integração futura: o workflow 1 continua cobrado na fase 2.
    expect(disponibilidade.cobrados(2)).toEqual(["1"]);
    expect(disponibilidade.cobrados(3)).toEqual([]);
    expect(disponibilidade.adiados(3)).toEqual([expect.objectContaining({ workflow: "2", para: 4 })]);
    expect(disponibilidade.cobrados(4)).toEqual(["2"]);
  });
});

describe("§127 · elegibilidade desconhecida não vira dispensa", () => {
  it("6 — a fase proíbe a integração em prosa, sem nomear fase: o fluxo continua cobrado nela", () => {
    const disponibilidade = disponibilidadeDosFluxos({
      fases: [
        { number: 1, dependsOn: "none", covers: [], texto: "Fundação" },
        { number: 2, dependsOn: "Phase 1", covers: ["workflow 2"], texto: "Categorias\nO roteador é exportado sem registro no servidor central." },
        { number: 3, dependsOn: "Phase 2", covers: ["workflow 2"], texto: "Integração\nConectar os módulos." },
      ],
      workflows: ["2"],
    });
    expect(disponibilidade.cobrados(2)).toEqual(["2"]);
    expect(disponibilidade.adiados(2)).toEqual([]);
  });

  it("6 — o caminho não está de pé e nenhuma fase posterior o completa: cobrado, incerto, e defeito do plano", () => {
    const arquitetura = crud([
      fase(1, "Fundação", "persistência e servidor", "none", ["US-1.1", "workflow 1"], ["dados", "api"]),
      fase(2, "Tarefas", "CRUD de tarefas", "Phase 1", ["tarefas"], ["tarefas", "shell"]),
      fase(3, "Categorias", "CRUD de categorias", "Phase 1", ["categorias", "workflow 2"], ["categorias", "shell"]),
    ]);
    const disponibilidade = disponibilidadeDaArquitetura(arquitetura, ESQUELETO);
    expect(disponibilidade.cobrados(1)).toEqual(["1"]);
    expect(disponibilidade.incertos(1)).toEqual([{ workflow: "1", fase: 1, faltam: ["shell", "tarefas"] }]);
  });

  it("a referência para trás (o Depends on de quem depende) nunca adia nada", () => {
    const disponibilidade = disponibilidadeDosFluxos({
      fases: [
        { number: 1, dependsOn: "none", covers: ["workflow 1"], texto: "Tarefas" },
        { number: 2, dependsOn: "Phase 1", covers: ["workflow 1"], texto: "**Depends on:** Phase 1 · revisão da fase 1" },
      ],
      workflows: ["1"],
    });
    expect(disponibilidade.cobrados(1)).toEqual(["1"]);
    expect(disponibilidade.cobrados(2)).toEqual(["1"]);
  });
});

describe("§127 · 7 — o contrato da arquitetura recusa a contradição temporal antes do build", () => {
  it("fluxo cobrado antes do caminho existir, sem fase que o complete: defeito ao arquiteto", () => {
    const arquitetura = crud([
      fase(1, "Fundação", "persistência e servidor", "none", ["US-1.1", "workflow 1"], ["dados", "api"]),
      fase(2, "Tarefas", "CRUD de tarefas", "Phase 1", ["tarefas"], ["tarefas", "shell"]),
      fase(3, "Categorias", "CRUD de categorias", "Phase 1", ["categorias", "workflow 2"], ["categorias", "shell"]),
    ]);
    const resultado = parseArchitecture(JSON.stringify(arquitetura), ESQUELETO, LIMITES);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? [] : resultado.defects.map((defeito) => defeito.problem)).toEqual([
      expect.stringContaining("o workflow 1 é cobrado pelo gate 4 ao fim da fase 1, que o cobre, mas atravessa shell, tarefas"),
    ]);
  });

  it("a fase deixa o fluxo para uma posterior que não espera por ela: defeito ao arquiteto", () => {
    const arquitetura = crud([
      FUNDACAO,
      fase(2, "Tarefas", "CRUD de tarefas registrado", "Phase 1", ["tarefas", "workflow 1"], ["tarefas"]),
      fase(3, "Categorias", "CRUD de categorias, pronta para a integração na fase 4", "Phase 1", ["categorias", "workflow 2"], ["categorias"]),
      fase(4, "Integração", "conecta categorias", "Phase 2", ["workflow 2"], ["api", "shell"]),
    ]);
    const resultado = parseArchitecture(JSON.stringify(arquitetura), ESQUELETO, LIMITES);
    expect(resultado.ok).toBe(false);
    const problemas = resultado.ok ? [] : resultado.defects.map((defeito) => defeito.problem);
    expect(problemas.some((problema) => problema.includes("a fase 3 deixa para a fase 4") && problema.includes("a fase 4 não depende da fase 3"))).toBe(true);
  });

  it("a mesma checagem, chamada direto, não acusa nada nas duas integrações válidas", () => {
    for (const fases of [
      [FUNDACAO, fase(2, "Tarefas", "registrado", "Phase 1", ["tarefas", "workflow 1"], ["tarefas"]), fase(3, "Categorias", "registrado", "Phase 1", ["categorias", "workflow 2"], ["categorias"])],
      [FUNDACAO, fase(2, "Tarefas", "exportado", "Phase 1", ["tarefas"], ["tarefas"]), fase(3, "Categorias", "exportado", "Phase 1", ["categorias"], ["categorias"]), fase(4, "Integração", "conecta", "Phase 2, Phase 3", ["workflow 1", "workflow 2"], ["api", "shell"])],
    ]) {
      expect(contradicoesTemporais(entradaTemporal(crud(fases), ESQUELETO))).toEqual([]);
    }
  });
});

describe("§127 · o escritor da fase recebe o contrato que o G4 vai cobrar", () => {
  it("a fase que adia não cobra o fluxo inteiro pela aplicação, e o que ela liga é o goal que diz; a que percorre tem de deixar de pé", () => {
    const disponibilidade = disponibilidadeDaArquitetura(LUNA_ARQ, LUNA_ESQ);
    const nomes = new Map(LUNA_ESQ.workflows.map((workflow) => [workflow.number, workflow.name]));
    const daQuatro = blocoDaDisponibilidade(disponibilidade, 4, nomes).join("\n");
    expect(daQuatro).toContain("workflow 3 (Gestão de categorias) is covered here but walked only at the end of Phase 6");
    // O que a fase liga é o goal dela que diz (revisão C5): o bloco só proíbe cobrar o fluxo inteiro pela aplicação.
    expect(daQuatro).toContain("what it leaves to that phase, is what this phase's goal says");
    expect(daQuatro).toContain("No criterion here may demand the whole workflow through the running application");
    const daDois = blocoDaDisponibilidade(disponibilidade, 2, nomes).join("\n");
    expect(daDois).toContain("This phase delivers its own part of the workflow's path");
    expect(daDois).not.toContain("wires");
    const daTres = blocoDaDisponibilidade(disponibilidade, 3, nomes).join("\n");
    expect(daTres).toContain("Walked at the end of THIS phase: workflow 2 (Gestão de tarefas)");
    expect(daTres).toContain("Phase 6 covers workflow 2 (Gestão de tarefas) again");
  });
});

describe("§127 · revisão adversarial — o contrato", () => {
  it("C3 — só 'fase N' e 'Phase N' nomeiam fase: rótulos de prioridade, `p5.js` e endereços soltos não", () => {
    expect(fasesNomeadas("O campo prioridade aceita P1, P2 ou P3")).toEqual([]);
    expect(fasesNomeadas("o gráfico usa `p5.js` e `Phase 9` no código")).toEqual([]);
    expect(fasesNomeadas("pronta para a integração da navegação na fase 6")).toEqual([6]);
    expect(fasesNomeadas("connected to the application in Phase 6")).toEqual([6]);
    expect(fasesNomeadas("na fase 10, não na fase 1")).toEqual([10, 1]);
  });

  it("C7 — um componente que nenhuma fase constrói (serviço externo) não é caminho que falta: a arquitetura passa, sem dica impossível", () => {
    const arquitetura = crud([
      FUNDACAO,
      fase(2, "Tarefas", "registrado", "Phase 1", ["tarefas", "workflow 1"], ["tarefas"]),
      fase(3, "Categorias", "registrado", "Phase 1", ["categorias", "workflow 2"], ["categorias"]),
    ], {});
    arquitetura.components.push({ name: "provedor-email", responsibility: "serviço externo de e-mail", areas: ["backend"], dependsOn: [], contracts: ["POST /enviar"], files: [], owns: [] });
    arquitetura.flows = arquitetura.flows.map((flow) => flow.workflow === "2" ? { ...flow, components: [...flow.components, "provedor-email"] } : flow);
    expect(contradicoesTemporais(entradaTemporal(arquitetura, ESQUELETO))).toEqual([]);
    expect(disponibilidadeDaArquitetura(arquitetura, ESQUELETO).cobrados(3)).toEqual(["2"]);
  });

  it("C4 — a fase sem componentes conhecidos torna desconhecido só o que depende dela", () => {
    const disponibilidade = disponibilidadeDosFluxos({
      fases: [
        { number: 1, dependsOn: "none", covers: [], texto: "Fundação", componentes: ["shell"] },
        { number: 2, dependsOn: "Phase 1", covers: ["workflow 1"], texto: "Navegação", componentes: ["shell"] },
        { number: 3, dependsOn: "Phase 2", covers: ["workflow 1"], texto: "Módulo", componentes: ["tarefas"] },
        { number: 4, dependsOn: "Phase 3", covers: [], texto: "Exportação" },
      ],
      workflows: ["1"],
      caminhos: new Map([["1", ["shell", "tarefas"]]]),
    });
    expect(disponibilidade.adiados(2)).toEqual([expect.objectContaining({ workflow: "1", para: 3, motivo: { tipo: "caminho", faltam: ["tarefas"] } })]);
    expect(disponibilidade.cobrados(3)).toEqual(["1"]);
  });
});
