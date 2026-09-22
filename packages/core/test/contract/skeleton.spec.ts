/**
 * O esqueleto substitui três documentos em prosa.
 *
 * O critério de aceitação da documentação deixou de ser "bem escrita" e passou a
 * ser "o loop consegue executar": nada ambíguo a ponto de impedir a execução,
 * nada que exija do loop o que ele não pode fazer. O parser recusa aqui o que o
 * gate recusaria no fim.
 */

import { describe, expect, it } from "vitest";
import { SKELETON_CONTRACT, parseSkeleton, renderSkeleton, sliceForPhase, workflowsForPhase } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";

const LIMITES = { maxTasksPerPhase: 15 };

const COMPLETO = {
  contract: SKELETON_CONTRACT,
  projectName: "Quadro Kanban",
  stack: [
    { component: "Linguagem", decision: "TypeScript 5.8" },
    { component: "Interface", decision: "React 19.1" },
  ],
  entities: [
    { name: "cartoes", fields: [{ name: "titulo", type: "text, obrigatório" }], relations: ["pertence a colunas"] },
    { name: "colunas", fields: [{ name: "nome", type: "text, único no quadro" }], relations: [] },
  ],
  stories: [
    { id: "US-1.1", statement: "Como usuário, crio um cartão" },
    { id: "US-2.1", statement: "Como usuário, movo um cartão" },
  ],
  workflows: [{ number: "1", name: "Criar cartão", steps: ["abrir o formulário", "salvar"] }],
  rules: [{ subject: "cartoes.titulo", statement: "gravado aparado nas extremidades; comparação ignora caixa e acentos" }],
  phases: [
    { number: 1, title: "Fundação", goal: "o modelo existe", dependsOn: "none", covers: ["cartoes", "colunas"], taskCount: 8 },
    { number: 2, title: "Criar cartão", goal: "o usuário cria", dependsOn: "Phase 1", covers: ["US-1.1", "workflow 1"], taskCount: 10 },
  ],
  mvpCutPhase: 2,
};

const comoTexto = (valor: unknown): string => JSON.stringify(valor);

describe("leitura do esqueleto", () => {
  it("lê um esqueleto completo", () => {
    const lido = parseSkeleton(comoTexto(COMPLETO), LIMITES);
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;
    expect(lido.skeleton.phases).toHaveLength(2);
    expect(lido.skeleton.entities[0]?.fields[0]?.name).toBe("titulo");
    expect(lido.skeleton.rules[0]?.subject).toBe("cartoes.titulo");
  });

  it("aceita cerca de código em volta, como o resto do harness", () => {
    expect(parseSkeleton("```json\n" + comoTexto(COMPLETO) + "\n```", LIMITES).ok).toBe(true);
  });

  it("nunca lança: entrada inválida vira defeito reportado", () => {
    expect(() => parseSkeleton("isto não é json", LIMITES)).not.toThrow();
    expect(parseSkeleton("isto não é json", LIMITES).ok).toBe(false);
  });

  it("entidade sem campo é recusada: o implementador inventaria o modelo", () => {
    const semCampo = { ...COMPLETO, entities: [{ name: "cartoes", fields: [], relations: [] }] };
    const lido = parseSkeleton(comoTexto(semCampo), LIMITES);
    expect(lido.ok).toBe(false);
    if (lido.ok) return;
    expect(lido.defects.map((d) => d.problem).join(" ")).toContain("não declara campo");
  });

  it("fase que não cobre nada é recusada", () => {
    const semCobertura = { ...COMPLETO, phases: [{ ...COMPLETO.phases[0], covers: [] }, COMPLETO.phases[1]] };
    const lido = parseSkeleton(comoTexto(semCobertura), LIMITES);
    expect(lido.ok).toBe(false);
  });

  it("fase acima do teto não cabe numa sessão de agente", () => {
    const grande = { ...COMPLETO, phases: [{ ...COMPLETO.phases[0], taskCount: 40 }, COMPLETO.phases[1]] };
    const lido = parseSkeleton(comoTexto(grande), LIMITES);
    expect(lido.ok).toBe(false);
    if (lido.ok) return;
    expect(lido.defects.map((d) => d.hint).join(" ")).toContain("sessão de agente");
  });

  it("stack vazia é recusada: o preflight lê os pré-requisitos dali", () => {
    expect(parseSkeleton(comoTexto({ ...COMPLETO, stack: [] }), LIMITES).ok).toBe(false);
  });
});

describe("a fatia de uma fase", () => {
  const skeleton = (parseSkeleton(comoTexto(COMPLETO), LIMITES) as { ok: true; skeleton: Skeleton }).skeleton;

  it("leva só o que a fase cobre", () => {
    const fatia = sliceForPhase(skeleton, 2);
    expect(fatia).toContain("US-1.1");
    expect(fatia).toContain("workflow 1");
    expect(fatia).not.toContain("US-2.1");
  });

  it("entidade de outra fase não viaja junto", () => {
    const fatia = sliceForPhase(skeleton, 2);
    expect(fatia).not.toContain("pertence a colunas");
  });

  it("as regras transversais vão inteiras para toda fase", () => {
    // É delas que nascem as contradições entre fases: cada uma decidindo por
    // conta decide diferente.
    for (const numero of [1, 2]) {
      const fatia = sliceForPhase(skeleton, numero);
      expect(fatia).toContain("gravado aparado nas extremidades");
      expect(fatia).toContain("valem para todas as fases");
    }
  });

  it("a stack vai em toda fase: é o que decide como se implementa", () => {
    expect(sliceForPhase(skeleton, 1)).toContain("TypeScript 5.8");
  });

  /*
   * O gate 4 pergunta a mesma coisa que a fatia já perguntava. Perguntar por
   * fora seria responder diferente: é a forma de defeito mais comum aqui.
   */
  it("os fluxos da fase são os mesmos que a fatia mostra", () => {
    const fluxos = workflowsForPhase(skeleton, 2);
    expect(fluxos.map((workflow) => workflow.number)).toEqual(["1"]);
    expect(fluxos[0]?.steps.length).toBeGreaterThan(0);
    for (const passo of fluxos[0]?.steps ?? []) expect(sliceForPhase(skeleton, 2)).toContain(passo);
  });

  it("fase sem fluxo declarado devolve lista vazia, não o esqueleto inteiro", () => {
    expect(workflowsForPhase(skeleton, 1)).toEqual([]);
    expect(workflowsForPhase(skeleton, 99)).toEqual([]);
  });

  it("fase inexistente devolve vazio em vez de quebrar", () => {
    expect(sliceForPhase(skeleton, 99)).toBe("");
  });

  it("a fatia é uma fração do esqueleto inteiro", () => {
    const inteiro = renderSkeleton(skeleton);
    expect(sliceForPhase(skeleton, 2).length).toBeLessThan(inteiro.length);
  });
});

/**
 * O que ficou de fora, escrito.
 *
 * Sem esta seção, quem lê o esqueleto seis meses depois não distingue "não tem
 * edição de cliente porque decidimos que não tem" de "ninguém pensou nisso" — e
 * a segunda leitura é a que faz alguém implementar o que o pedido não pediu.
 */
describe("os não-objetivos do esqueleto", () => {
  const esqueleto = (parseSkeleton(comoTexto(COMPLETO), LIMITES) as { ok: true; skeleton: Skeleton }).skeleton;
  const base = { ...esqueleto, nonGoals: ["edição de clientes — fora do escopo por decisão do desenvolvedor: correções saem pelo banco"] };

  it("aparecem numa seção própria, depois das fases", () => {
    const markdown = renderSkeleton(base);
    expect(markdown).toContain("## Fora do escopo");
    expect(markdown).toContain("edição de clientes");
    expect(markdown.indexOf("## Fora do escopo")).toBeGreaterThan(markdown.indexOf("## Fases"));
  });

  it("esqueleto sem não-objetivo não ganha seção vazia", () => {
    expect(renderSkeleton(esqueleto)).not.toContain("## Fora do escopo");
  });

  /*
   * O esqueleto é retomado do estado em todo `plan` e pode voltar de um zip: se
   * a leitura perdesse o campo, a decisão sumiria na primeira retomada.
   */
  it("sobrevivem à ida e volta pelo JSON", () => {
    const lido = parseSkeleton(JSON.stringify(base), LIMITES);
    if (!lido.ok) throw new Error(lido.defects.map((defeito) => defeito.problem).join("; "));
    expect(lido.skeleton.nonGoals).toEqual(base.nonGoals);
  });
});
