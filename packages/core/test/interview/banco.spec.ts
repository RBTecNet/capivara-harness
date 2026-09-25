import { describe, expect, it } from "vitest";

import { ID_DO_BANCO, PERGUNTA_DO_BANCO, bancoNoPedido, decisaoDeBanco, perguntaDoBanco, regrasDeBanco } from "../../src/interview/banco.js";
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

  /*
   * A regra dizia "nenhum arquivo VERSIONADO contém credencial", e isso não se
   * verifica sem git. No `assitencia` o verificador do gate 3 devolveu exatamente
   * isso — "a árvore não contém metadados de versionamento para confirmar…" — e
   * reprovou uma task correta por uma pergunta que nós escrevemos sem resposta
   * possível. A proibição continua; o que mudou é que agora se confere abrindo
   * arquivo.
   */
  it("proíbe credencial em qualquer arquivo menos o .env, e isso se confere sem git", () => {
    const config = regrasDeBanco("informado").find((regra) => regra.subject === "configuração do banco");
    expect(config?.statement).toContain(".gitignore");
    expect(config?.statement).toContain("ÚNICO arquivo do projeto que pode");
    expect(config?.statement).toContain("abrindo os arquivos");
    expect(config?.statement).not.toContain("arquivo versionado");
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

/*
 * O `assitencia`. O pedido dizia, com todas as letras: "vamos usar banco de
 * dados mysql remoto ou seja, não será instalado localmente, para testes o
 * agente deverá usar SQLite". A pergunta — fixa, escrita sem olhar o pedido —
 * ofereceu "o projeto cria o dele, embutido em arquivo" COMO RECOMENDADA.
 *
 * O desenvolvedor respondeu "1", que é aceitar a recomendação. O esqueleto saiu
 * com MySQL na stack, porque o pedido manda, e banco embutido nas regras
 * transversais, porque a decisão mandava. Dezoito fases foram escritas sobre
 * essa contradição.
 */
describe("a pergunta lê o pedido antes de recomendar", () => {
  const pedidoReal =
    "Vamos usar banco de dados mysql remoto ou seja, não será instalado localmente, " +
    "para testes o agente deverá usar SQLite ou qualquer outra ferramenta disponível";

  it("reconhece o servidor que o pedido nomeia", () => {
    expect(bancoNoPedido(pedidoReal)).toBe("MySQL");
    expect(bancoNoPedido("um sistema com PostgreSQL")).toBe("PostgreSQL");
    expect(bancoNoPedido("guardar tudo no Mongo")).toBe("MongoDB");
    expect(bancoNoPedido("uma agenda de consultas")).toBeNull();
  });

  it("recomenda o que o pedido escolheu, e não o contrário dele", () => {
    const pergunta = perguntaDoBanco(pedidoReal);
    expect(pergunta.recommended).toContain("Já existe um servidor");
    expect(pergunta.evidence).toContain("MySQL");
    expect(pergunta.recommendationBasis).toContain("o pedido é a autoridade");
  });

  it("sem banco no pedido, continua recomendando o embutido", () => {
    const pergunta = perguntaDoBanco("uma agenda de consultas para uma clínica");
    expect(pergunta.recommended).toContain("Ainda não existe");
  });

  it("diz na própria pergunta que a resposta não pode contrariar o pedido", () => {
    expect(perguntaDoBanco("").why).toContain("precisa ser a que combina com ele");
  });

  it("a pergunta sem pedido é a base, com o mesmo id", () => {
    expect(perguntaDoBanco("").id).toBe(ID_DO_BANCO);
    expect(perguntaDoBanco(pedidoReal).id).toBe(ID_DO_BANCO);
    expect(PERGUNTA_DO_BANCO.id).toBe(ID_DO_BANCO);
  });
});
