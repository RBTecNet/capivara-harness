/**
 * A memória do julgamento, na granularidade em que ele foi feito.
 *
 * O `assitencia` mediu o custo de não ter isso: dezenove achados fechados,
 * dezenove novos, cinco rodadas, nenhum progresso. O escritor nunca falhou em
 * fechar; o auditor nunca ficou sem achar, porque relia a fase inteira sempre que
 * uma task mudava.
 */

import { describe, expect, it } from "vitest";

import { shaDaAutoridade, textoDaTask } from "../../src/audit/tasks.js";
import type { TaskBlock } from "../../src/contract/index.js";

const task = (overrides: Partial<TaskBlock> = {}): TaskBlock => ({
  index: 1,
  done: false,
  title: "Persistir usuários",
  acceptanceCriteria: ["o e-mail é único", "a senha é resumo criptográfico"],
  designRef: null,
  traces: ["US-1.1"],
  line: 10,
  ...overrides,
});

describe("o texto canônico de uma task", () => {
  it("ignora o que não é conteúdo: espaço, ordem de campo, bullet", () => {
    expect(textoDaTask(task())).toBe(textoDaTask(task({ title: "  Persistir usuários  ", line: 99, index: 7 })));
  });

  it("muda quando o conteúdo muda", () => {
    expect(textoDaTask(task())).not.toBe(textoDaTask(task({ acceptanceCriteria: ["o e-mail é único em todo o sistema"] })));
  });
});



describe("a autoridade das aprovações", () => {
  it("a ordem em que as decisões foram tomadas não conta", () => {
    expect(shaDaAutoridade(["a", "b"])).toBe(shaDaAutoridade(["b", "a"]));
  });
});
