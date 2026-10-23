/**
 * O ensaio lê o veredito que vem logo depois do espelho do colchete (§132).
 *
 * O PLAN do `laravel/mmax` (MiniMax-M3.1-Flash pela API direta, run
 * `init-dc741f0d7b92`) parou em NOT READY com quatro critérios "não ensaiados"
 * — e o verificador tinha julgado os dezoito da fase 4. O prompt lista cada
 * critério como `P4.T2.C1 [fase · task] texto`, e o MiniMax espelhou o colchete
 * e pôs o veredito logo depois:
 *
 *     CRITERION P4.T2.C1 [Phase 4: Módulo independente de anotações · Expor …] OBSERVABLE — …
 *
 * A chave do ensaio exige que o PRIMEIRO dois-pontos da linha venha colado ao
 * veredito. Aqui não há dois-pontos depois do colchete, e há um dentro dele
 * ("Phase 4:", `obterAnotacao(id: number)`): zero de dezoito linhas lidas. A
 * segunda chance renumerou os endereços, e o plano parou.
 *
 * A correção é uma extensão da chave, não outra chave. Estes testes provam três
 * coisas, com o parser anterior congelado aqui para a comparação:
 *  1. tudo o que a chave antiga lia continua lido igual — endereço, veredito,
 *     justificativa e ordem;
 *  2. tudo o que ela recusava continua recusado, exceto o espelho do colchete
 *     seguido do veredito, que as saídas reais abaixo demonstram;
 *  3. nada vira veredito sem o verificador ter escrito um: critério sem linha
 *     continua não ensaiado, e UNOBSERVABLE continua bloqueando.
 *
 * As fixtures são bytes reais dos runs, sem edição.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { desgrudarChaves } from "../../src/contract/protocolo.js";
import { assessRehearsal, parseRehearsal, type CriterionRef, type CriterionRuling, type CriterionVerdict } from "../../src/prompts/rehearsal.js";

const PASTA = join(import.meta.dirname, "..", "fixtures", "ensaio-132");
const fixture = (nome: string): string => readFileSync(join(PASTA, nome), "utf8");

/** O parser como estava antes da §132, congelado para a comparação. */
const LINHA_ANTERIOR = /^CRITERION\s+(P\d+\.T\d+\.C\d+)\b[^:]*:\s*(OBSERVABLE|UNSATISFIABLE|UNOBSERVABLE)\b\s*(?:[—:-]\s*(.*))?$/;
function parseAnterior(output: string): CriterionVerdict[] {
  const verdicts = new Map<string, CriterionVerdict>();
  for (const rawLine of desgrudarChaves(output, String.raw`CRITERION\s+P\d+\.T\d+\.C\d+`).split("\n")) {
    const match = LINHA_ANTERIOR.exec(rawLine.replace(/\r$/, "").trim());
    if (!match) continue;
    const address = match[1] ?? "";
    if (!verdicts.has(address)) verdicts.set(address, { address, ruling: match[2] as CriterionRuling, reason: (match[3] ?? "").trim() });
  }
  return [...verdicts.values()];
}

/** Critérios só com endereço: `assessRehearsal` cruza por endereço e nada mais. */
const criterios = (enderecos: string[]): CriterionRef[] =>
  enderecos.map((address) => {
    const [, phase, task, index] = /^P(\d+)\.T(\d+)\.C(\d+)$/.exec(address) ?? [];
    return { address, phase: Number(phase), task: Number(task), index: Number(index), phaseTitle: "", taskTitle: "", text: "" };
  });

/** Os endereços que o prompt do lote da fase 4 pediu, na ordem do prompt real. */
const PEDIDOS_P4 = [
  "P4.T1.C1", "P4.T1.C2", "P4.T1.C3", "P4.T1.C4", "P4.T2.C1", "P4.T2.C2", "P4.T2.C3",
  "P4.T3.C1", "P4.T3.C2", "P4.T3.C3", "P4.T3.C4", "P4.T4.C1", "P4.T4.C2", "P4.T4.C3", "P4.T4.C4",
  "P4.T5.C1", "P4.T5.C2", "P4.T5.C3",
];

/** A linha que a extensão lê: espelho com o ` · ` do prompt, e o veredito logo depois do `]`. */
const FORMA_DO_ESPELHO = /^CRITERION\s+P\d+\.T\d+\.C\d+\s+\[.*? · .*?\](?::\s*|\s+)(?:OBSERVABLE|UNSATISFIABLE|UNOBSERVABLE)\b/;

describe("o que a chave antiga lia continua lido igual", () => {
  const ACEITAS: [string, string, CriterionVerdict[]][] = [
    ["canônica", "CRITERION P1.T1.C1: OBSERVABLE — abro a migração", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "abro a migração" }]],
    ["UNSATISFIABLE", "CRITERION P1.T1.C2: UNSATISFIABLE — o projeto foi decidido sem dependências", [{ address: "P1.T1.C2", ruling: "UNSATISFIABLE", reason: "o projeto foi decidido sem dependências" }]],
    ["UNOBSERVABLE", "CRITERION P1.T1.C3: UNOBSERVABLE — \"código limpo\" não se olha", [{ address: "P1.T1.C3", ruling: "UNOBSERVABLE", reason: "\"código limpo\" não se olha" }]],
    ["dois-pontos como separador", "CRITERION P1.T1.C1: OBSERVABLE: abro a migração", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "abro a migração" }]],
    ["hífen como separador", "CRITERION P1.T1.C1: OBSERVABLE - abro a migração", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "abro a migração" }]],
    ["sem justificativa", "CRITERION P1.T1.C1: OBSERVABLE", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "" }]],
    ["indentação e CRLF", "  CRITERION P1.T1.C1: OBSERVABLE — olho\r\n", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "olho" }]],
    ["prosa em volta", "Segue a análise:\nCRITERION P1.T1.C1: OBSERVABLE — olho\nFim.", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "olho" }]],
    ["chave grudada na prosa", "Vou ler as decisões.CRITERION P1.T1.C1: OBSERVABLE — olho", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "olho" }]],
    ["duas chaves numa linha", "CRITERION P1.T1.C1: OBSERVABLE — dá CRITERION P1.T2.C1: UNOBSERVABLE — não dá", [
      { address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "dá" },
      { address: "P1.T2.C1", ruling: "UNOBSERVABLE", reason: "não dá" },
    ]],
    ["espelho sem dois-pontos dentro, com dois-pontos depois", "CRITERION P2.T1.C1 [Casca visual · Definir os tokens.]: OBSERVABLE — inspeciono os tokens", [{ address: "P2.T1.C1", ruling: "OBSERVABLE", reason: "inspeciono os tokens" }]],
    ["eco do texto sem dois-pontos dentro", "CRITERION P8.T7.C3 sem o cookie `sessao`, a linha fica igual.: OBSERVABLE — a linha permanece", [{ address: "P8.T7.C3", ruling: "OBSERVABLE", reason: "a linha permanece" }]],
    ["repetição: a primeira linha vale", "CRITERION P1.T1.C1: OBSERVABLE — a\nCRITERION P1.T1.C1: OBSERVABLE — b", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "a" }]],
    ["repetição em conflito: a primeira vale, como antes", "CRITERION P1.T1.C1: UNSATISFIABLE — a\nCRITERION P1.T1.C1: OBSERVABLE — b", [{ address: "P1.T1.C1", ruling: "UNSATISFIABLE", reason: "a" }]],
    ["justificativa que cita outro veredito", "CRITERION P1.T1.C1: OBSERVABLE — não é UNSATISFIABLE porque nada nega", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "não é UNSATISFIABLE porque nada nega" }]],
    // Comportamento anterior, preservado como está: o meio sem dois-pontos é tolerado por inteiro.
    ["meio sem dois-pontos tolerado (anterior)", "CRITERION P1.T1.C1 talvez UNSATISFIABLE, mas: OBSERVABLE — olho", [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "olho" }]],
  ];

  for (const [nome, entrada, esperado] of ACEITAS) {
    it(nome, () => {
      expect(parseAnterior(entrada)).toEqual(esperado);
      expect(parseRehearsal(entrada)).toEqual(esperado);
    });
  }
});

describe("o que a chave antiga recusava continua recusado", () => {
  const RECUSADAS: [string, string][] = [
    ["veredito sem dois-pontos e sem colchete", "CRITERION P1.T1.C1 OBSERVABLE — olho"],
    ["veredito em minúsculas", "CRITERION P1.T1.C1: observable — olho"],
    ["veredito desconhecido", "CRITERION P1.T1.C1: APPROVED — olho"],
    ["dois vereditos: ambíguo", "CRITERION P1.T1.C1: OBSERVABLE / UNSATISFIABLE — olho"],
    ["veredito com alternativa: ambíguo", "CRITERION P1.T1.C1: OBSERVABLE ou UNSATISFIABLE"],
    ["endereço incompleto", "CRITERION P1.T1: OBSERVABLE — olho"],
    ["sem veredito", "CRITERION P1.T1.C1:"],
    ["só o endereço", "CRITERION P1.T1.C1"],
    ["sem a chave", "P1.T1.C1: OBSERVABLE — olho"],
    ["colchete que não é o espelho do prompt", "CRITERION P1.T1.C1 [nota] OBSERVABLE — olho"],
    ["espelho sem veredito", "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela]"],
    ["espelho com veredito sem separador", "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] OBSERVABLE porque olho"],
    ["espelho com dois vereditos: ambíguo", "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] OBSERVABLE / UNSATISFIABLE — olho"],
    ["espelho com veredito em minúsculas", "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] observable — olho"],
    ["dois lugares em que um veredito segue um colchete: ambíguo", "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] OBSERVABLE — mas [revisão] UNSATISFIABLE"],
    ["espelho seguido do texto do critério com dois-pontos", "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] `GET /api/x/:id` responde 200.: OBSERVABLE — olho"],
    ["espelho, texto do critério e travessão", "CRITERION P1.T1.C1 [Fase · Criar a tabela] A tabela existe. — OBSERVABLE — olho"],
    ["eco do critério, sem veredito", "CRITERION P2.T1.C1 [Phase 2: Tarefas · Implementar o serviço] `servico.ts` exporta `listar(): Tarefa[]`."],
    ["espelho sem a chave", "P3.T6.C1 [Phase 3: Categorias · Implementar a listagem] OBSERVABLE — olho"],
    ["nada", ""],
  ];

  for (const [nome, entrada] of RECUSADAS) {
    it(nome, () => {
      expect(parseAnterior(entrada)).toEqual([]);
      expect(parseRehearsal(entrada)).toEqual([]);
    });
  }
});

describe("a variação real do MiniMax é lida (RED antes da §132)", () => {
  it("o lote da fase 4 do mmax: dezoito vereditos sem dois-pontos depois do colchete, todos lidos", () => {
    const saida = fixture("mmax-p4-sem-dois-pontos.txt");
    expect(parseAnterior(saida)).toEqual([]);

    const lidos = parseRehearsal(saida);
    expect(lidos.map((veredito) => veredito.address)).toEqual(PEDIDOS_P4);
    expect(lidos.every((veredito) => veredito.ruling === "OBSERVABLE")).toBe(true);
    // A justificativa é o texto depois do travessão, inteiro, e de cada linha a sua.
    const linhas = saida.trim().split("\n");
    lidos.forEach((veredito, posicao) => expect(linhas[posicao]?.endsWith(`OBSERVABLE — ${veredito.reason}`)).toBe(true));
    expect(lidos.find((veredito) => veredito.address === "P4.T5.C1")?.reason).toMatch(/^Solicitar a exclusão de uma anotação e observar a confirmação explícita/);

    // O que parou o run: com a leitura certa, nenhum dos dezoito fica sem julgamento.
    expect(assessRehearsal(criterios(PEDIDOS_P4), parseAnterior(saida)).unrehearsed).toHaveLength(18);
    expect(assessRehearsal(criterios(PEDIDOS_P4), lidos)).toEqual({ blocking: [], unrehearsed: [] });
  });

  it("o lote da fase 1 do mmax: o título traz \"Phase 1:\" dentro do colchete, e os vinte são lidos", () => {
    const saida = fixture("mmax-p1-colchete-com-dois-pontos.txt");
    expect(parseAnterior(saida)).toEqual([]);
    const lidos = parseRehearsal(saida);
    expect(lidos).toHaveLength(20);
    expect(lidos[0]).toEqual({
      address: "P1.T1.C1",
      ruling: "OBSERVABLE",
      reason: "inspecionar as seções de dependências de aplicação e de desenvolvimento do `package.json` e confirmar a presença de todos os pacotes declarados nas categorias correspondentes.",
    });
  });

  it("eco do critério seguido do veredito: o eco não é veredito, e a linha do veredito vale", () => {
    const saida = fixture("mmax-p2-eco-e-veredito.txt");
    const lidos = parseRehearsal(saida);
    expect(lidos).toHaveLength(20);
    expect(lidos[0]?.reason).toBe("Inspecionar as exportações e as definições de tipo do arquivo, confirmando a presença das três funções e a estrutura exata de `Tarefa`.");
  });

  it("outro run do MiniMax, mesma forma: UNOBSERVABLE lido continua bloqueando, com a razão do verificador", () => {
    const saida = fixture("teste-minimax-p1-sem-dois-pontos-inobservavel.txt");
    expect(parseAnterior(saida)).toEqual([]);
    const lidos = parseRehearsal(saida);
    expect(lidos).toHaveLength(20);
    const bloqueio = lidos.find((veredito) => veredito.ruling !== "OBSERVABLE");
    expect(bloqueio).toMatchObject({ address: "P1.T2.C2", ruling: "UNOBSERVABLE" });
    expect(bloqueio?.reason).toMatch(/^O critério abrange todos os arquivos versionados/);

    const resultado = assessRehearsal(criterios(lidos.map((veredito) => veredito.address)), lidos);
    expect(resultado.blocking.map((item) => `${item.criterion.address} ${item.ruling}`)).toEqual(["P1.T2.C2 UNOBSERVABLE"]);
  });

  it("o lote curto do teste_minimax: oito vereditos", () => {
    expect(parseAnterior(fixture("teste-minimax-p6-sem-dois-pontos.txt"))).toEqual([]);
    expect(parseRehearsal(fixture("teste-minimax-p6-sem-dois-pontos.txt"))).toHaveLength(8);
  });
});

describe("o que a §132 deliberadamente não lê", () => {
  /*
   * Formas reais que continuam recusadas: o veredito não vem logo depois do
   * colchete, ou não há colchete nem chave. Lê-las exigiria saber onde termina
   * o texto do critério ecoado — o que o parser não sabe —, ou abrir mão da
   * chave do protocolo. Esses lotes seguem para a segunda chance, como antes.
   */
  for (const nome of ["mmax-p2-texto-do-criterio.txt", "mmax-p3-sem-chave.txt", "teste-minimax-p4-texto-e-travessao.txt", "codex-luna-p5-crase.txt"]) {
    it(nome, () => {
      expect(parseAnterior(fixture(nome))).toEqual([]);
      expect(parseRehearsal(fixture(nome))).toEqual([]);
    });
  }

  it("a segunda chance renumerada é lida como foi escrita, como antes: o endereço é do verificador", () => {
    // P4.T1.C5 a C7 e P4.T2.C4 não existem no plano. O parser não corrige endereço.
    const saida = fixture("mmax-p4-corretivo-renumerado.txt");
    expect(parseRehearsal(saida)).toEqual(parseAnterior(saida));
    expect(assessRehearsal(criterios(PEDIDOS_P4), parseRehearsal(saida)).unrehearsed.map((criterio) => criterio.address))
      .toEqual(["P4.T4.C4", "P4.T5.C1", "P4.T5.C2", "P4.T5.C3"]);
  });
});

describe("comparação: o parser corrigido estende o anterior, nas mesmas entradas", () => {
  const ENTRADAS = readdirSync(PASTA).sort();

  for (const nome of ENTRADAS) {
    it(nome, () => {
      const saida = fixture(nome);
      const antes = parseAnterior(saida);
      const depois = parseRehearsal(saida);
      // Tudo o que era lido é lido igual, na mesma ordem, na frente.
      expect(depois.slice(0, antes.length)).toEqual(antes);
      // O que é novo vem de uma linha na forma do espelho, e de nenhuma outra.
      const linhas = desgrudarChaves(saida, String.raw`CRITERION\s+P\d+\.T\d+\.C\d+`).split("\n").map((linha) => linha.replace(/\r$/, "").trim());
      for (const novo of depois.slice(antes.length)) {
        expect(antes.some((veredito) => veredito.address === novo.address)).toBe(false);
        const origem = linhas.find((linha) => linha.startsWith(`CRITERION ${novo.address} `) && FORMA_DO_ESPELHO.test(linha));
        expect(origem, `${novo.address} sem linha de origem`).toBeDefined();
        expect(origem).toContain(`${novo.ruling}`);
      }
    });
  }

  it("respostas canônicas de outros runs ficam idênticas", () => {
    for (const nome of ENTRADAS.filter((entrada) => entrada.startsWith("canonico-"))) {
      expect(parseRehearsal(fixture(nome)), nome).toEqual(parseAnterior(fixture(nome)));
    }
  });

  it("o Codex do luna também espelhou com dois-pontos dentro do colchete: as seis linhas dessa forma passam a ser lidas", () => {
    const saida = fixture("codex-luna-p1-colchete-com-dois-pontos.txt");
    const antes = parseAnterior(saida);
    const depois = parseRehearsal(saida);
    expect(antes).toHaveLength(14);
    expect(depois).toHaveLength(20);
    expect(depois.slice(14).map((veredito) => `${veredito.address} ${veredito.ruling}`)).toEqual([
      "P1.T5.C1 OBSERVABLE", "P1.T5.C2 OBSERVABLE", "P1.T5.C3 OBSERVABLE",
      "P1.T6.C1 OBSERVABLE", "P1.T6.C2 OBSERVABLE", "P1.T6.C3 OBSERVABLE",
    ]);
  });
});

describe("a linha canônica tem precedência sobre o espelho do mesmo endereço", () => {
  it("espelho antes, canônica depois: vale a canônica, como valia", () => {
    const entrada = [
      "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] UNSATISFIABLE — pelo espelho",
      "CRITERION P1.T1.C1: OBSERVABLE — pela chave",
    ].join("\n");
    expect(parseAnterior(entrada)).toEqual([{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "pela chave" }]);
    expect(parseRehearsal(entrada)).toEqual([{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "pela chave" }]);
  });

  it("dois espelhos do mesmo endereço: a primeira linha vale, a mesma regra da chave", () => {
    const entrada = [
      "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] UNSATISFIABLE — primeira",
      "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] OBSERVABLE — segunda",
    ].join("\n");
    expect(parseRehearsal(entrada)).toEqual([{ address: "P1.T1.C1", ruling: "UNSATISFIABLE", reason: "primeira" }]);
  });

  it("linha enorme cheia de ` · ` é recusada em tempo linear", () => {
    // Num regex só (`\[.*? · .*?\]`), esta linha levou vinte segundos para ser recusada.
    const linha = `CRITERION P1.T1.C1 [${"a · b ".repeat(20000)}] OBSERVABLE porque${" x".repeat(20000)}`;
    const inicio = performance.now();
    expect(parseRehearsal(linha)).toEqual([]);
    expect(performance.now() - inicio).toBeLessThan(2000);
  });

  it("o espelho não inventa critério: endereço sem linha continua não ensaiado", () => {
    const entrada = "CRITERION P1.T1.C1 [Fase 1: base · Criar a tabela] OBSERVABLE — olho";
    const resultado = assessRehearsal(criterios(["P1.T1.C1", "P1.T1.C2"]), parseRehearsal(entrada));
    expect(resultado.unrehearsed.map((criterio) => criterio.address)).toEqual(["P1.T1.C2"]);
    expect(resultado.blocking).toEqual([]);
  });
});
