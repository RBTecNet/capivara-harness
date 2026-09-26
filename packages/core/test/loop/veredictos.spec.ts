/**
 * O que o verificador já declarou DONE não volta à fila.
 *
 * A medição que trouxe isto está no P01 do `assitencia`: três ciclos, seis tasks
 * diferentes incompletas, nunca mais de duas por vez, todas fechadas pelo executor
 * e substituídas por outras duas que o verificador já havia aprovado. A fase não
 * estava piorando — era amostragem, o mesmo defeito que o §73 corrigiu no `plan`.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TasksAprovadas, tasksDaFase } from "../../src/loop/veredictos.js";
import { gate3 } from "../../src/loop/gates.js";
import { verifyPrompt } from "../../src/prompts/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-veredictos-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const FASE = `## Phase 1: Fundação

**Goal:** base · **Depends on:** none · **Covers:** statuses

- [ ] **Task:** Criar a migration de statuses
  - **Acceptance criteria:**
    - A tabela statuses existe com as três linhas
  - **Feature tests:** statuses_seed -> as três linhas existem
  - **Traces:** statuses

- [ ] **Task:** Criar a migration de reservas
  - **Acceptance criteria:**
    - A tabela reservations referencia statuses
  - **Feature tests:** reservations_migration -> a FK aponta para statuses
  - **Traces:** reservations
`;

describe("o registro de tasks verificadas", () => {
  /*
   * O teste acima só tinha uma "Phase 1", e foi assim que o defeito passou: o
   * parser exige a numeração a partir de 1, e toda fase depois da primeira saía
   * sem tasks. No `assistencia2` as memórias ficaram mudas da P02 à P12, e a
   * task 9 da P05, aprovada num ciclo, foi julgada de novo no seguinte.
   */
  it("lê as tasks de QUALQUER fase, não só da primeira", async () => {
    const { parsePhaseFragment } = await import("../../src/contract/index.js");
    const quinta = FASE.replace("## Phase 1: Fundação", "## Phase 5: Configurações").replace(
      "**Depends on:** none",
      "**Depends on:** Phase 4",
    );
    expect(tasksDaFase(quinta).map((task) => task.index)).toEqual([1, 2]);
    // A fase volta com o número e a dependência DELA, não com os do envelope.
    const lida = parsePhaseFragment(quinta);
    expect(lida?.number).toBe(5);
    expect(lida?.dependsOn).toBe("Phase 4");

    const registro = await TasksAprovadas.abrir(projectRoot, "build-1");
    await registro.aprovar("P05", tasksDaFase(quinta), [1, 2], 2);
    const retomado = await TasksAprovadas.abrir(projectRoot, "build-1");
    expect([...retomado.indicesAprovados("P05", tasksDaFase(quinta))]).toEqual([1, 2]);
  });

  it("lê as tasks da fase pelo contrato, sem regex própria", () => {
    const tasks = tasksDaFase(FASE);
    expect(tasks.map((task) => task.index)).toEqual([1, 2]);
    expect(tasks[0]?.title).toContain("statuses");
  });

  it("guarda o que passou e sobrevive a outra execução do build", async () => {
    const tasks = tasksDaFase(FASE);
    const primeira = await TasksAprovadas.abrir(projectRoot, "build-1");
    await primeira.aprovar("P01", tasks, [1], 1);

    // Outro processo, outro run: o registro é do projeto, e é o caso que doeu —
    // rodar `capivara build` de novo recomeçava a verificação do zero.
    const segunda = await TasksAprovadas.abrir(projectRoot, "build-2");
    expect([...segunda.indicesAprovados("P01", tasks)]).toEqual([1]);
  });

  it("task de OUTRA fase não é confundida com esta", async () => {
    const tasks = tasksDaFase(FASE);
    const registro = await TasksAprovadas.abrir(projectRoot, "build-1");
    await registro.aprovar("P02", tasks, [1, 2], 1);
    expect(registro.indicesAprovados("P01", tasks).size).toBe(0);
  });

  /*
   * A chave é o TEXTO, não o número. Editar um critério no plano faz a task voltar
   * a ser verificada, que é exatamente o que quem editou está pedindo.
   */
  it("critério editado no plano derruba a aprovação daquela task", async () => {
    const tasks = tasksDaFase(FASE);
    const registro = await TasksAprovadas.abrir(projectRoot, "build-1");
    await registro.aprovar("P01", tasks, [1, 2], 1);

    const editada = tasksDaFase(FASE.replace("com as três linhas", "com as três linhas e um índice único"));
    expect([...registro.indicesAprovados("P01", editada)]).toEqual([2]);
  });

  it("`--rebuild-all` abre o registro vazio: quem pede para refazer tudo pede isso", async () => {
    const tasks = tasksDaFase(FASE);
    await (await TasksAprovadas.abrir(projectRoot, "build-1")).aprovar("P01", tasks, [1, 2], 1);
    const refazendo = await TasksAprovadas.abrir(projectRoot, "build-2", true);
    expect(refazendo.indicesAprovados("P01", tasks).size).toBe(0);
  });
});

describe("o gate 3 honra o que já foi verificado", () => {
  const veredito = (linhas: string[]): string => linhas.join("\n");

  /*
   * Decisão do desenvolvedor depois da P05 do `assistencia2`: o termo invisível a
   * quem só consulta foi reaberto com razão. A memória evita PERGUNTAR de novo;
   * ela não cala o verificador que achou algo.
   */
  it("INCOMPLETE sobre task já aprovada reprova a fase, e a causa diz que foi reaberta", () => {
    const resultado = gate3(
      veredito(["TASK 1: INCOMPLETE — falta o índice", "TASK 2: DONE"]),
      2,
      new Set([1]),
    );
    expect(resultado.green).toBe(false);
    expect(resultado.reabertas.map((task) => task.index)).toEqual([1]);
    expect(resultado.done).toEqual([2]);
    if (!resultado.green) {
      expect(resultado.cause).toContain("TASK 1: INCOMPLETE — falta o índice");
      expect(resultado.cause).toContain("o verificador a reabriu");
    }
  });

  it("a task reaberta sai do registro e volta a ser verificada", async () => {
    const tasks = tasksDaFase(FASE);
    const registro = await TasksAprovadas.abrir(projectRoot, "build-1");
    await registro.aprovar("P01", tasks, [1, 2], 1);
    await registro.revogar("P01", tasks, [1]);
    expect([...registro.indicesAprovados("P01", tasks)]).toEqual([2]);
    // E fica assim na próxima execução.
    const outra = await TasksAprovadas.abrir(projectRoot, "build-2");
    expect([...outra.indicesAprovados("P01", tasks)]).toEqual([2]);
  });

  it("INCOMPLETE sobre task ainda não aprovada reprova, como sempre", () => {
    const resultado = gate3(veredito(["TASK 1: DONE", "TASK 2: INCOMPLETE — falta a FK"]), 2, new Set([1]));
    expect(resultado.green).toBe(false);
    if (resultado.green) return;
    expect(resultado.cause).toContain("TASK 2");
    expect(resultado.done).toEqual([1]);
  });

  it("sem registro nenhum, o gate é o de antes", () => {
    const resultado = gate3(veredito(["TASK 1: INCOMPLETE — falta tudo", "TASK 2: DONE"]), 2);
    expect(resultado.green).toBe(false);
    expect(resultado.reabertas).toEqual([]);
    expect(resultado.done).toEqual([2]);
  });

  it("cobertura incompleta continua reprovando antes de qualquer contabilidade", () => {
    const resultado = gate3(veredito(["TASK 1: DONE"]), 2, new Set([1, 2]));
    expect(resultado.green).toBe(false);
    if (!resultado.green) expect(resultado.cause).toContain("1 de 2");
    expect(resultado.done).toEqual([]);
  });
});

describe("o verificador SABE o que já aprovou", () => {
  it("o prompt lista as tasks aprovadas e diz para não rejulgá-las", () => {
    const prompt = verifyPrompt({
      language: "português do Brasil",
      phaseMarkdown: FASE,
      taskCount: 2,
      tasksJaAprovadas: [{ index: 1, title: "Criar a migration de statuses" }],
    });
    expect(prompt).toContain("Already DONE — not under verification now");
    expect(prompt).toContain("task 1: Criar a migration de statuses");
    expect(prompt).toContain("Re-reading them is not thoroughness");
    // A saída explícita: o que ele VIU quebrado se marca na própria task, e volta ao executor.
    expect(prompt).toContain("mark THAT task `TASK <n>: INCOMPLETE");
    expect(prompt).toContain("Report what you ran into, not what you hunted.");
  });

  it("sem task aprovada, o prompt é o de antes", () => {
    const prompt = verifyPrompt({ language: "português do Brasil", phaseMarkdown: FASE, taskCount: 2 });
    expect(prompt).not.toContain("Already DONE");
  });
});
