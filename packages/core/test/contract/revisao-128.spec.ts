/**
 * §128 — os defeitos que a revisão adversarial reproduziu na primeira versão,
 * como cenários de regressão (as sondas do revisor, com as expectativas
 * seguras dele).
 *
 * - o alcance da emenda (F1) aceitava a reescrita inteira de toda task que
 *   citasse um trecho do achado: um achado sobre `package.json` apagava um
 *   critério de migração; e casava tasks pela posição mesmo quando o escritor
 *   tinha tirado uma e acrescentado outra, perdendo e duplicando tasks;
 * - a triagem aceitava a regra do harness como prova para descartar o
 *   requisito de testes que o pedido exige;
 * - o I-16 novo acusava "adicionar a cobertura escolhida" (sorvete), "concluir
 *   o teste de nivelamento" (escola) e "finalizar a cobertura" (seguro).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblePhase, assemblePhasesDocument, buildStamp, parsePhases, parseSkeleton, preserveUnaddressedTasks, testPrescriptions } from "../../src/contract/index.js";
import type { AuditVerdict } from "../../src/audit/index.js";
import { planningScopeBlock } from "../../src/prompts/index.js";

const fixture = (nome: string): string => readFileSync(join(import.meta.dirname, "..", "fixtures", nome), "utf8");
const FASES = JSON.parse(fixture("parallel-lab-128.fases.json")) as { r1: Record<string, string> };
const PEDIDO = fixture("parallel-lab-128.pedido.md");

const envelope = { number: 1, title: "Fase 1", goal: "objetivo", dependsOn: "none", covers: ["tarefas"], areas: ["frontend"] };
const fase = (tasks: string): string => assemblePhase(envelope, tasks).trim();

const ANTES = fase(FASES.r1["1"]!);

// Critérios de tasks vizinhas que nenhum achado abaixo pede para mudar.
const MIGRA_SEM_AUTO = "    - A inicialização da aplicação não aplica as migrações automaticamente.\n";
const MIGRA_REPETIVEL = "`package.json` define `npm run migrate` para aplicar as migrações a partir de banco vazio, sem erro quando executado novamente.";
const RESUMO_DB = "    - Os três totais são obtidos das tabelas `tarefas`, `categorias` e `anotacoes` do banco selecionado por `DB_PATH`.\n";
const SERVER_DEV = "    - O script `dev` de `package.json` inicia o servidor junto com a interface Vite.\n";

describe("§128 · revisão — o trecho citado não destrava a reescrita da vizinha", () => {
  it("A — achado sobre `package.json` na Task 1: o critério da Task 3 (migrações) que a emenda apagou volta", () => {
    expect(ANTES).toContain(MIGRA_SEM_AUTO);
    const achado = {
      where: "P1.T1.C1",
      problem: "`package.json` declara `dev` e `migrate`, mas não declara o script `build` que a arquitetura exige.",
      fix: "Acrescente em `package.json` o script `build` que compila a API e a interface.",
    };
    const emendada = ANTES
      .replace("`package.json` declara scripts `dev` e `migrate`;", "`package.json` declara scripts `dev`, `migrate` e `build`;")
      // A "simplificação" que nenhum achado pede: um requisito da decisão de dados some, e outro é enfraquecido.
      .replace(MIGRA_SEM_AUTO, "")
      .replace(MIGRA_REPETIVEL, "`package.json` define `npm run migrate` para aplicar as migrações.");
    const resultado = preserveUnaddressedTasks(ANTES, emendada, 1, [achado]);
    expect(resultado).toContain("`migrate` e `build`");
    // Comportamento seguro: a Task 3 não foi endereçada, e volta como estava.
    expect(resultado, "critério 'não aplica automaticamente' perdido").toContain(MIGRA_SEM_AUTO);
    expect(resultado, "critério 'repetível' enfraquecido").toContain(MIGRA_REPETIVEL);
  });

  it("A' — o mesmo achado não destrava a Task 4 (servidor), que só cita `package.json` num critério", () => {
    const achado = {
      where: "P1.T1.C1",
      problem: "`package.json` não declara o script `build`.",
      fix: "Acrescente o script `build` em `package.json`.",
    };
    const emendada = ANTES
      .replace("`package.json` declara scripts `dev` e `migrate`;", "`package.json` declara scripts `dev`, `migrate` e `build`;")
      .replace(SERVER_DEV, "");
    const resultado = preserveUnaddressedTasks(ANTES, emendada, 1, [achado]);
    expect(resultado, "critério do `dev` da Task 4 perdido").toContain(SERVER_DEV);
  });

  it("B — achado sobre `DB_PATH` na Task 2: a Task 6 (resumo) não perde o critério de qual banco é contado", () => {
    expect(ANTES).toContain(RESUMO_DB);
    const achado = {
      where: "P1.T2.C1",
      problem: "`.env.example` declara `DB_PATH` mas não diz que é o único lugar com credenciais.",
      fix: "Diga em `.env.example` que `DB_PATH` não leva credencial.",
    };
    const emendada = ANTES.replace("sem credenciais.", "sem credenciais, e é o único arquivo com configuração sensível.").replace(RESUMO_DB, "");
    const resultado = preserveUnaddressedTasks(ANTES, emendada, 1, [achado]);
    expect(resultado).toContain("é o único arquivo com configuração sensível");
    expect(resultado, "critério do banco do resumo perdido").toContain(RESUMO_DB);
  });

  it("C — a rota citada (`/api/resumo`) não alcança o painel (Task 8), que mantém o feedback de erro", () => {
    const FEEDBACK = "    - A rota `/` apresenta feedback de carregamento e de erro durante a solicitação dos totais.\n";
    expect(ANTES).toContain(FEEDBACK);
    const achado = {
      where: "P1.T6.C1",
      problem: "`GET /api/resumo` não diz o código de erro quando o banco não abre.",
      fix: "Diga que `/api/resumo` responde 500 com JSON de erro quando o banco não abre.",
    };
    const emendada = ANTES
      .replace("`GET /api/resumo` responde `200` com objeto JSON", "`GET /api/resumo` responde `200` (ou `500` com JSON de erro quando o banco não abre) com objeto JSON")
      .replace(FEEDBACK, "");
    const resultado = preserveUnaddressedTasks(ANTES, emendada, 1, [achado]);
    expect(resultado).toContain("ou `500` com JSON de erro");
    expect(resultado, "critério de feedback do painel perdido").toContain(FEEDBACK);
  });

  it("D — trazer um trecho da correção para uma task alheia não a destrava: a Task 4 não perde dois critérios", () => {
    const achado = {
      where: "P1.T1.C3",
      problem: "`index.html` monta `src/web/main.tsx`, mas a arquitetura fixa `src/main.tsx`.",
      fix: "Use `src/main.tsx` como ponto de entrada.",
    };
    const emendada = ANTES
      .replace("a partir de `src/web/main.tsx`", "a partir de `src/main.tsx`")
      .replace("implemente a inicialização da API Express na porta `3001`", "implemente a inicialização da API Express (servida ao `src/main.tsx`) na porta `3001`")
      .replace("    - `src/server/index.ts` inicia o servidor na porta `3001`.\n", "")
      .replace(SERVER_DEV, "");
    const resultado = preserveUnaddressedTasks(ANTES, emendada, 1, [achado]);
    expect(resultado).toContain("a partir de `src/main.tsx`");
    expect(resultado, "Task 4 reescrita sem achado").toContain("    - `src/server/index.ts` inicia o servidor na porta `3001`.\n");
  });
});


describe("§128 · revisão — a posição não casa tasks que mudaram de lugar", () => {
  it("E — o escritor tira a Task 3 e acrescenta uma no fim (mesma contagem): nenhuma task some nem se repete", () => {
    const blocos = ANTES.split(/\n(?=- \[ \] \*\*Task:\*\*)/);
    const cabecalho = blocos[0]!.startsWith("- [ ] **Task:**") ? [] : [blocos.shift()!];
    const tasks = blocos;
    expect(tasks).toHaveLength(8);
    const nova = "- [ ] **Task:** Em `src/server/health.ts`, expor `GET /api/saude`.\n  - **Acceptance criteria:**\n    - `GET /api/saude` responde 200.\n  - **Traces:** workflow 4\n";
    const emendada = [...cabecalho, tasks[0]!.replace("a partir de `src/web/main.tsx`", "a partir de `src/main.tsx`"), tasks[1]!, tasks[3]!, tasks[4]!, tasks[5]!, tasks[6]!, tasks[7]!.trimEnd() + "\n", nova].join("\n");
    const achado = { where: "P1.T1.C3", problem: "`index.html` monta `src/web/main.tsx`; o script `dev` precisa iniciar `src/server/index.ts`.", fix: "Use `src/main.tsx`." };
    const resultado = preserveUnaddressedTasks(ANTES, emendada, 1, [achado]);
    const titulos = [...resultado.matchAll(/^- \[ \] \*\*Task:\*\* (.{0,60})/gm)].map((m) => m[1]);
    const doc = parsePhases(assemblePhasesDocument({ projectName: "x", stamp: buildStamp([{ name: "skeleton.md", content: "" }]), overview: "x", phases: [resultado], openQuestions: [] }));
    expect(doc.ok).toBe(true);
    expect(resultado, "a Task 4 (servidor) sumiu").toContain("Em `src/server/index.ts` e `src/server/app.ts`, implemente a inicialização da API Express");
    expect(new Set(titulos).size, "task duplicada").toBe(titulos.length);
  });
});

const cincoFases = [1, 2, 3, 4, 5].map((numero) => assemblePhase({ number: numero, title: `Fase ${numero}`, goal: "objetivo", dependsOn: numero === 1 ? "none" : `Phase ${numero - 1}`, covers: ["tarefas"], areas: ["frontend"] }, FASES.r1[String(numero)]!).trim());
const documento = parsePhases(assemblePhasesDocument({ projectName: "PL", stamp: buildStamp([{ name: "skeleton.md", content: "" }]), overview: "x", phases: cincoFases, openQuestions: [] }));


interface Caso { frase: string; autoridade: string[] }

const CASOS: Record<string, Caso> = {
  // Sorveteria / pizzaria / confeitaria: "cobertura" é o produto (calda, topping).
  sorvete: { frase: "O cliente monta o sorvete e adicionar a cobertura escolhida é opcional.", autoridade: ["App de sorveteria: o cliente escolhe sabor e cobertura."] },
  sorveteCriterio: { frase: "- Permite escolher o sabor e adicionar a cobertura escolhida antes de fechar o pedido.", autoridade: ["App de sorveteria: o cliente escolhe sabor e cobertura."] },
  bolo: { frase: "A tela de pedido permite escolher a massa e definir a cobertura do bolo.", autoridade: ["Encomendas de bolos: massa, recheio e cobertura."] },
  // Seguro: "cobertura" é o objeto do contrato.
  seguro: { frase: "O corretor cadastra a apólice e define o prêmio, e incluir a cobertura de roubo é opcional.", autoridade: ["Sistema de corretora de seguros com coberturas por apólice."] },
  seguroDecisao: { frase: "Ao cancelar a apólice, o sistema deve encerrar o contrato e finalizar a cobertura imediatamente?", autoridade: ["Sistema de corretora de seguros com coberturas por apólice."] },
  // Rede / telecom: cobertura de sinal.
  wifi: { frase: "O técnico importa a planta e definir a cobertura Wi-Fi de cada andar é obrigatório.", autoridade: ["Planejador de cobertura Wi-Fi para escritórios."] },
  // Simulados / avaliações: "teste" é o produto.
  simulado: { frase: "O aluno pode pausar e concluir o teste de nivelamento depois.", autoridade: ["Plataforma de testes de nivelamento de inglês."] },
  simuladoStory: { frase: "Como aluno, quero iniciar e terminar o teste vocacional no celular.", autoridade: ["App de testes vocacionais para estudantes."] },
  abTest: { frase: "O analista cria o experimento e finalizar o teste A/B encerra a coleta.", autoridade: ["Ferramenta de testes A/B para lojas virtuais."] },
  quizEn: { frase: "Students can start and complete the test within the time limit.", autoridade: ["An online quiz platform where students take timed tests."] },
  labEn: { frase: "Lab staff can register a sample and add test results for each patient.", autoridade: ["A clinical lab system to register samples and results."] },
  // Hotel: "suíte" é o quarto. A primeira correção da revisão a tratava como teste de software sem qualificador.
  hotel: { frase: "O hóspede escolhe o pacote e incluir a suíte presidencial custa uma diária a mais.", autoridade: ["Reservas de um hotel com quartos e suítes."] },
  labPt: { frase: "O laboratório registra a amostra e incluir os testes solicitados pelo médico é obrigatório.", autoridade: ["Sistema de laboratório de análises clínicas com pedidos de exames."] },
};

describe("§128 · revisão — frases de produto que o I-16 não acusa", () => {
  for (const [nome, caso] of Object.entries(CASOS)) {
    it(`${nome}: ${caso.frase}`, () => {
      const termos = testPrescriptions(caso.frase, caso.autoridade);
      expect(termos).toEqual([]);
    });
  }
});

describe("§128 · revisão — o mesmo, no contrato do esqueleto", () => {
  it("a story de um app de simulados passa no contrato do esqueleto", () => {
    const pedido = "Plataforma de testes de nivelamento de inglês.";
    const base = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "parallel-lab-128.skeleton.json"), "utf8")) as { stories: { id: string; statement: string }[] };
    base.stories[0]!.statement = "Como aluno, quero iniciar, pausar e concluir o teste de nivelamento pelo celular.";
    const lido = parseSkeleton(JSON.stringify(base), { maxTasksPerPhase: 15, authority: [pedido] });
    const defeitos = lido.ok ? [] : lido.defects;
    const deTeste = defeitos.filter((defeito) => /prescreve teste/.test(defeito.problem));
    expect(deTeste).toEqual([]);
  });
});
