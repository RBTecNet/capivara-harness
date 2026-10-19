/**
 * O contrato da arquitetura: o que o `plan` decide antes de escrever fases.
 *
 * A divisão de fases do esqueleto é proposta; a arquitetura pode reorganizá-la,
 * e a única coisa que não pode acontecer é cobertura perdida. Isto é conferido
 * em código, e é o que torna a reorganização segura.
 */

import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_CONTRACT,
  architectureSliceForPhase,
  parseArchitecture,
  parseSkeleton,
  phasesFromArchitecture,
  renderArchitecture,
  requirementsFromArchitecture,
} from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { SKELETON } from "../support/fake-agent.js";

const esqueleto = (): Skeleton => {
  const lido = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 });
  if (!lido.ok) throw new Error("fixture inválida");
  return lido.skeleton;
};

const base = () => ({
  contract: ARCHITECTURE_CONTRACT,
  overview: "Monólito modular: um pacote de dados e um de API, servidos pela mesma aplicação.",
  components: [
    { name: "dados", responsibility: "migrações e acesso às tabelas", areas: ["dados"], dependsOn: [], contracts: ["módulo db: query(sql, params) → linhas"], files: ["src/db.ts"], owns: ["statuses", "reservations"] },
    { name: "api", responsibility: "rotas HTTP das reservas", areas: ["backend"], dependsOn: ["dados"], contracts: ["POST /reservas → 201 {id}", "POST /reservas com datas sobrepostas → 409"], files: [], owns: [] },
  ],
  dataDecisions: [{ subject: "reservations.id", statement: "inteiro autoincremento" }],
  flows: [{ workflow: "1", components: ["api", "dados"], notes: "" }],
  infrastructure: {
    runtimes: [{ name: "Node.js", version: "22", purpose: "executar a aplicação", basis: "stack do esqueleto: Node 22 com TypeScript" }],
    tools: [{ name: "TypeScript", version: "", purpose: "tipagem", basis: "stack do esqueleto" }],
    packageManagers: [{ name: "npm", version: "", purpose: "dependências", basis: "padrão do runtime Node.js" }],
    dependencies: [{ name: "pg", version: "", purpose: "cliente PostgreSQL", kind: "app", basis: "banco decidido: PostgreSQL 16" }],
    services: [],
    databases: [{ name: "PostgreSQL", version: "16", purpose: "persistência", basis: "stack do esqueleto: PostgreSQL 16" }],
    compatibility: ["Node 22 ou superior"],
    preconditions: ["PostgreSQL acessível pela DATABASE_URL do .env"],
  },
  phases: [
    { number: 1, title: "Fundação de dados", goal: "migrations e seeds existem", dependsOn: "none", covers: ["statuses", "reservations"], areas: ["dados"], components: ["dados"], taskCount: 2, rationale: "tudo depende das tabelas" },
    { number: 2, title: "Criar reserva", goal: "o hóspede cria uma reserva", dependsOn: "Phase 1", covers: ["US-1.1", "workflow 1"], areas: ["backend"], components: ["api"], taskCount: 2, rationale: "" },
  ],
  mvpCutPhase: 2,
});

describe("parseArchitecture", () => {
  it("lê a arquitetura válida e herda do esqueleto as sondas que ela não repetiu", () => {
    const lido = parseArchitecture(JSON.stringify(base()), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
    if (!lido.ok) return;
    expect(lido.architecture.components.map((c) => c.name)).toEqual(["dados", "api"]);
    expect(requirementsFromArchitecture(lido.architecture).map((r) => r.binary)).toEqual(["node", "psql"]);
    expect(lido.applied.join(" ")).toContain("herdou do esqueleto");
  });

  it("aceita sondas próprias no mesmo formato do esqueleto", () => {
    const arquitetura = { ...base(), infrastructure: { ...base().infrastructure, requirements: [{ technology: "Node.js", binary: "node", systemLevel: false, checkArgs: ["--version"] }] } };
    const lido = parseArchitecture(JSON.stringify(arquitetura), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok).toBe(true);
    if (lido.ok) expect(requirementsFromArchitecture(lido.architecture)).toHaveLength(1);
  });

  it("pode reorganizar as fases do esqueleto: dividir, reordenar — desde que nada perca cobertura", () => {
    const reorganizada = {
      ...base(),
      phases: [
        { number: 1, title: "Tabelas", goal: "statuses existe", dependsOn: "none", covers: ["statuses"], areas: ["dados"], components: ["dados"], taskCount: 1, rationale: "menor" },
        { number: 2, title: "Reservas na base", goal: "reservations existe", dependsOn: "Phase 1", covers: ["reservations"], areas: ["dados"], components: ["dados"], taskCount: 1, rationale: "" },
        { number: 3, title: "Criar reserva", goal: "o hóspede cria", dependsOn: "Phase 2", covers: ["US-1.1", "workflow 1"], areas: ["backend"], components: ["api"], taskCount: 2, rationale: "" },
      ],
      mvpCutPhase: 3,
    };
    const lido = parseArchitecture(JSON.stringify(reorganizada), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
    if (lido.ok) expect(phasesFromArchitecture(lido.architecture).map((fase) => fase.number)).toEqual([1, 2, 3]);
  });

  it("recusa a divisão que perde cobertura: o esqueleto é a autoridade sobre o que o produto tem", () => {
    const perdida = { ...base(), phases: [base().phases[0]!] };
    const lido = parseArchitecture(JSON.stringify(perdida), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok).toBe(false);
    if (!lido.ok) {
      const problemas = lido.defects.map((d) => d.problem).join(" ");
      expect(problemas).toContain("perdeu cobertura");
      expect(problemas).toContain("story US-1.1");
      expect(problemas).toContain("workflow 1");
    }
  });

  it("recusa componente desconhecido, fluxo sem componente e fase sem componente", () => {
    const errada = {
      ...base(),
      flows: [],
      phases: [{ ...base().phases[0]!, components: ["fantasma"] }, { ...base().phases[1]!, components: [] }],
    };
    const lido = parseArchitecture(JSON.stringify(errada), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok).toBe(false);
    if (!lido.ok) {
      const problemas = lido.defects.map((d) => d.problem).join(" | ");
      expect(problemas).toContain('"fantasma"');
      expect(problemas).toContain("workflow 1");
      expect(problemas).toContain("a fase 2 não cita componente nenhum");
    }
  });

  it("recusa escolha de infraestrutura sem autoridade: sem fonte, a escolha é invenção", () => {
    const semFonte = { ...base(), infrastructure: { ...base().infrastructure, dependencies: [{ name: "lodash", version: "4", purpose: "utilidades", kind: "app", basis: "" }] } };
    const lido = parseArchitecture(JSON.stringify(semFonte), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok).toBe(false);
    if (!lido.ok) expect(lido.defects.map((d) => d.problem).join(" ")).toContain("lodash");
  });

  it("conserta contando o que não exige julgamento: numeração por posição e grafia dos rótulos", () => {
    const torta = {
      ...base(),
      phases: [
        { ...base().phases[0]!, number: 7, covers: ["Statuses", "reservations"] },
        { ...base().phases[1]!, number: 9, dependsOn: "1", covers: ["us-1.1", "Workflow 1"] },
      ],
    };
    const lido = parseArchitecture(JSON.stringify(torta), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
    if (!lido.ok) return;
    expect(lido.architecture.phases.map((fase) => fase.number)).toEqual([1, 2]);
    expect(lido.architecture.phases[1]?.dependsOn).toBe("Phase 1");
    expect(lido.architecture.phases[1]?.covers).toEqual(["US-1.1", "workflow 1"]);
    expect(lido.applied.some((nota) => nota.includes("renumerou"))).toBe(true);
  });

  it("recusa fase que depende do futuro e fase acima do teto", () => {
    const errada = { ...base(), phases: [{ ...base().phases[0]!, dependsOn: "Phase 2" }, { ...base().phases[1]!, taskCount: 40 }] };
    const lido = parseArchitecture(JSON.stringify(errada), esqueleto(), { maxTasksPerPhase: 15 });
    expect(lido.ok).toBe(false);
    if (!lido.ok) {
      const problemas = lido.defects.map((d) => d.problem).join(" | ");
      expect(problemas).toContain("depende da fase 2, que não vem antes");
      expect(problemas).toContain("aloca 40 tasks");
    }
  });

  it("recusa o que não é JSON e o contrato errado, com a orientação", () => {
    expect(parseArchitecture("não é json", esqueleto(), { maxTasksPerPhase: 15 }).ok).toBe(false);
    const outro = parseArchitecture(JSON.stringify({ ...base(), contract: "x" }), esqueleto(), { maxTasksPerPhase: 15 });
    expect(outro.ok).toBe(false);
    if (!outro.ok) expect(outro.defects[0]?.hint).toContain(ARCHITECTURE_CONTRACT);
  });
});

describe("a fatia e o documento", () => {
  const lida = () => {
    const lido = parseArchitecture(JSON.stringify(base()), esqueleto(), { maxTasksPerPhase: 15 });
    if (!lido.ok) throw new Error(JSON.stringify(lido.defects));
    return lido.architecture;
  };

  it("a fatia de uma fase traz os componentes dela inteiros e só o contrato dos que ela consome", () => {
    const fatia = architectureSliceForPhase(lida(), 2);
    expect(fatia).toContain("### api");
    expect(fatia).toContain("POST /reservas → 201 {id}");
    expect(fatia).toContain("Componentes de que esta fase depende");
    expect(fatia).toContain("### dados (fase 1)");
    expect(fatia).toContain("módulo db: query(sql, params) → linhas");
    expect(fatia).toContain("workflow 1: api → dados");
    expect(fatia).toContain("### Sondas de prontidão");
    expect(fatia).not.toContain("Feature tests");
  });

  it("a fase sem dependências não ganha a seção de consumo", () => {
    expect(architectureSliceForPhase(lida(), 1)).not.toContain("Componentes de que esta fase depende");
    expect(architectureSliceForPhase(lida(), 9)).toBe("");
  });

  it("o documento inteiro carrega as seções que o BUILD e o desenvolvedor leem", () => {
    const documento = renderArchitecture(lida(), esqueleto());
    for (const secao of ["## Visão geral", "## Componentes", "## Decisões de dados", "## Fluxos e componentes", "## Infraestrutura", "### Runtimes", "### Dependências", "### Condições para iniciar a implementação", "### Sondas de prontidão", "## Fases"]) {
      expect(documento).toContain(secao);
    }
    expect(documento).toContain("(autoridade: stack do esqueleto: PostgreSQL 16)");
    expect(documento).toContain("MVP fecha na fase 2.");
  });
});
