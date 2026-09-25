/**
 * A memória do julgamento, na granularidade em que ele foi feito.
 *
 * O `assitencia` mediu o custo de não ter isso: dezenove achados fechados,
 * dezenove novos, cinco rodadas, nenhum progresso. O escritor nunca falhou em
 * fechar; o auditor nunca ficou sem achar, porque relia a fase inteira sempre que
 * uma task mudava.
 */

import { describe, expect, it } from "vitest";

import { TasksJulgadas, chaveDaTask, shaDaAutoridade, textoDaTask } from "../../src/audit/tasks.js";
import type { TaskBlock } from "../../src/contract/index.js";

const task = (overrides: Partial<TaskBlock> = {}): TaskBlock => ({
  index: 1,
  done: false,
  title: "Persistir usuários",
  acceptanceCriteria: ["o e-mail é único", "a senha é resumo criptográfico"],
  featureTests: ["usuarios_unicos -> recusa duplicado"],
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

describe("a chave é o par: texto e autoridade", () => {
  const autoridade = shaDaAutoridade(["e-mail único por tenant"]);

  it("a mesma task sob a mesma autoridade tem a mesma chave", () => {
    expect(chaveDaTask(task(), autoridade)).toBe(chaveDaTask(task(), autoridade));
  });

  it("decisão nova muda a autoridade, e a chave junto", () => {
    const outra = shaDaAutoridade(["e-mail único por tenant", "exclusão é lógica em todos os casos"]);
    expect(chaveDaTask(task(), outra)).not.toBe(chaveDaTask(task(), autoridade));
  });

  it("a ordem em que as decisões foram tomadas não conta", () => {
    expect(shaDaAutoridade(["a", "b"])).toBe(shaDaAutoridade(["b", "a"]));
  });
});

describe("o que volta ao julgamento", () => {
  const autoridade = shaDaAutoridade(["uma decisão"]);

  it("task aprovada e intacta não volta", () => {
    const julgadas = new TasksJulgadas();
    const tasks = [task({ title: "A" }), task({ title: "B" })];
    julgadas.aprovar(tasks, autoridade);

    expect(julgadas.jaAprovadas(tasks, autoridade).map((entrada) => entrada.title)).toEqual(["A", "B"]);
  });

  it("a task que mudou volta sozinha, sem arrastar as vizinhas", () => {
    const julgadas = new TasksJulgadas();
    const antes = [task({ title: "A" }), task({ title: "B" })];
    julgadas.aprovar(antes, autoridade);

    const depois = [task({ title: "A" }), task({ title: "B", acceptanceCriteria: ["critério novo"] })];
    expect(julgadas.jaAprovadas(depois, autoridade).map((entrada) => entrada.title)).toEqual(["A"]);
  });

  it("decisão nova derruba TODAS as aprovações — e isso é o certo", () => {
    const julgadas = new TasksJulgadas();
    const tasks = [task({ title: "A" }), task({ title: "B" })];
    julgadas.aprovar(tasks, autoridade);

    const depoisDeDecidir = shaDaAutoridade(["uma decisão", "outra decisão"]);
    expect(julgadas.jaAprovadas(tasks, depoisDeDecidir)).toEqual([]);
  });
});
