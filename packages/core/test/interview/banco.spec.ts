import { describe, expect, it } from "vitest";

import { ID_DO_BANCO, PERGUNTA_DO_BANCO, decisaoDeBanco, regrasDeBanco } from "../../src/interview/banco.js";
import { classifyLocally } from "../../src/interview/classify.js";
import type { Answer } from "../../src/interview/types.js";

function responder(raw: string, id = ID_DO_BANCO): Answer[] {
  const local = classifyLocally(PERGUNTA_DO_BANCO, raw);
  return [{ questionId: id, round: 1, raw, disposition: local.disposition, decision: local.decision, open: local.open, answeredAt: new Date().toISOString() }];
}

describe("a pergunta de banco", () => {
  it("oferece as três origens possíveis mais a ausência de banco", () => {
    expect(PERGUNTA_DO_BANCO.options).toHaveLength(4);
    expect(PERGUNTA_DO_BANCO.options.map((opcao) => opcao.label)).toContain(PERGUNTA_DO_BANCO.recommended);
  });

  it("diz na própria pergunta que credencial nenhuma é versionada", () => {
    expect(PERGUNTA_DO_BANCO.why).toContain(".env");
    expect(PERGUNTA_DO_BANCO.why).toContain("descartável");
  });

  it("lê a escolha feita pelo número", () => {
    expect(decisaoDeBanco([PERGUNTA_DO_BANCO], responder("1"))).toBe("embutido");
    expect(decisaoDeBanco([PERGUNTA_DO_BANCO], responder("2"))).toBe("informado");
    expect(decisaoDeBanco([PERGUNTA_DO_BANCO], responder("3"))).toBe("instalado");
    expect(decisaoDeBanco([PERGUNTA_DO_BANCO], responder("4"))).toBe("sem-banco");
  });

  it("aceita a pergunta já escopada pelo documento", () => {
    const escopada = { ...PERGUNTA_DO_BANCO, id: `skeleton:${ID_DO_BANCO}` };
    expect(decisaoDeBanco([escopada], responder("1", escopada.id))).toBe("embutido");
  });

  it("não decide nada quando a resposta não fechou", () => {
    expect(decisaoDeBanco([PERGUNTA_DO_BANCO], responder("não sei"))).toBe("indefinida");
    expect(decisaoDeBanco([], [])).toBe("indefinida");
  });
});

describe("as regras que a escolha implica", () => {
  it("escreve as quatro regras comuns em qualquer banco", () => {
    for (const decisao of ["embutido", "informado", "instalado"] as const) {
      const regras = regrasDeBanco(decisao);
      const assuntos = regras.map((regra) => regra.subject);
      expect(assuntos).toContain("configuração do banco");
      expect(assuntos).toContain(".env.example");
      expect(assuntos).toContain("comando de migração");
      expect(assuntos).toContain("banco dos testes");
      expect(assuntos).toContain("origem do banco");
    }
  });

  it("nunca manda o teste tocar o banco do desenvolvedor", () => {
    const testes = regrasDeBanco("informado").find((regra) => regra.subject === "banco dos testes");
    expect(testes?.statement).toContain("descartável");
    expect(testes?.statement).toContain("nenhum teste");
  });

  it("proíbe credencial em arquivo versionado", () => {
    const config = regrasDeBanco("informado").find((regra) => regra.subject === "configuração do banco");
    expect(config?.statement).toContain(".gitignore");
    expect(config?.statement).toContain("nenhum arquivo versionado");
  });

  it("exige migração que cria o esquema do zero", () => {
    const migracao = regrasDeBanco("embutido").find((regra) => regra.subject === "comando de migração");
    expect(migracao?.statement).toContain("banco vazio");
  });

  it("manda parar, e não contornar, quando a instalação não é permitida", () => {
    const origem = regrasDeBanco("instalado").find((regra) => regra.subject === "origem do banco");
    expect(origem?.statement).toContain("pára dizendo o que falta");
  });

  it("não escreve regra nenhuma sem banco ou sem decisão", () => {
    expect(regrasDeBanco("sem-banco")).toEqual([]);
    expect(regrasDeBanco("indefinida")).toEqual([]);
  });
});
