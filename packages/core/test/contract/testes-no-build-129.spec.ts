/**
 * §129 — o pedido de testes é do build; o plano não o carrega, e nenhuma
 * leitura do plan devolve por causa dele.
 *
 * Os textos são os do run `init-dc741f0d7b92` do Parallel Lab em
 * `laravel/claude` (0.7.2), copiados para `test/fixtures/parallel-lab-129.*`:
 * o pedido, o esqueleto e a arquitetura que o plan recebeu, as seis fases da
 * rodada 1 e as respostas dos auditores e da triagem na rodada 2. Na rodada 2,
 * seis de nove achados eram sobre teste: três tasks de teste a tirar, com a
 * correção "registre o requisito como critério de uma task de produto", e a
 * fase 3 reprovada duas vezes por NÃO trazer o critério de testes. A triagem
 * manteve os nove. A causa estava no harness: a regra do planejamento mandava o
 * plano carregar o requisito de testes do pedido, e todos os papéis obedeceram.
 *
 * O pedido de testes continua onde o build já o lê — a regra "testes…" e a
 * entrada de stack sobre testes, no contrato compartilhado — e sai só do que o
 * plano lê.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NADA_DE_TESTE_NO_LUGAR, parseAudit, tirarPedidoDeTeste } from "../../src/audit/index.js";
import type { AuditVerdict } from "../../src/audit/index.js";
import {
  assemblePhase,
  checkTestPrescription,
  parseArchitecture,
  parsePhases,
  parseSkeleton,
  renderSkeleton,
  skeletonForPlanning,
  sliceForPhase,
  testPrescriptions,
  testRequirements,
} from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { sharedContractFromSkeleton } from "../../src/prompts/acceptance-policy.js";
import { testPolicyBlock } from "../../src/prompts/test-policy.js";
import { architectPrompt, architectureAuditPrompt, phaseAuditPrompt, planningScopeBlock, skeletonPrompt } from "../../src/prompts/index.js";

const fixture = (nome: string): string => readFileSync(join(import.meta.dirname, "..", "fixtures", nome), "utf8");

const PEDIDO = fixture("parallel-lab-129.pedido.md");
const ESQUELETO = JSON.parse(fixture("parallel-lab-129.skeleton.json")) as Skeleton;
const ARQUITETURA = fixture("parallel-lab-129.architecture.json");
const FASES_R1 = JSON.parse(fixture("parallel-lab-129.fases-r1.json")) as Record<string, string>;
const RODADA_2 = JSON.parse(fixture("parallel-lab-129.rodada2.json")) as Record<string, string>;

const veredito = (texto: string): AuditVerdict => {
  const lido = parseAudit(texto);
  if (!lido.ok) throw new Error(lido.defects.join("; "));
  return lido.verdict;
};
const filtrado = (chave: string) => tirarPedidoDeTeste(veredito(RODADA_2[chave]!), [PEDIDO]);

/** As seis fases da rodada 1, montadas como o orquestrador monta o documento. */
const PLANO_R1 = [
  "# Parallel Lab — Project Phases",
  "",
  "<!-- inputs: skeleton.md@sha256:000000000000 architecture.md@sha256:000000000000 -->",
  "",
  ...Object.entries(FASES_R1).map(([numero, texto]) =>
    `${assemblePhase({ number: Number(numero), title: `Fase ${numero}`, goal: "objetivo", dependsOn: numero === "1" ? "none" : "Phase 1", covers: ["tarefas"], areas: ["frontend"] }, texto).trim()}\n`),
].join("\n");

describe("§129 · a rodada 2 do run, achado por achado", () => {
  it("a fase 3, reprovada por NÃO ter o critério de testes, sai aprovada: o achado pedia teste", () => {
    const original = veredito(RODADA_2.P3!);
    expect(original.status).toBe("REJECTED");
    expect(original.findings[0]?.problem).toContain("cada módulo tenha testes automatizados próprios");
    const { verdict, descartados } = filtrado("P3");
    expect(verdict.status).toBe("APPROVED");
    expect(verdict.findings).toEqual([]);
    expect(descartados).toEqual(["Phase 3 (Goal, tasks 3.1 and 3.2)"]);
  });

  it("a coerência perde o F7 (o mesmo pedido de teste da fase 3) e guarda o F9, que é de produto", () => {
    const { verdict, descartados } = filtrado("coerencia");
    expect(descartados).toHaveLength(1);
    expect(descartados[0]).toContain("P3.T1..P3.T8");
    expect(verdict.findings.map((finding) => finding.where)).toEqual(["P4.T8.C1-C3, P5.T9.C1-C2, P6.T4.C1-C2", "P5.T8.C1 vs P6.T3.C2 / P6.T2.C1"]);
    // O F9 volta byte a byte.
    expect(verdict.findings[1]).toEqual(veredito(RODADA_2.coerencia!).findings[2]);
  });

  it("os achados que mandam TIRAR a task de teste ficam, com as palavras do auditor menos o critério de teste que ele pedia no lugar", () => {
    const casos: [string, string, string][] = [
      ["P4", "Remova a Phase 4.3 e a tarefa.", "Registre o requisito"],
      ["P5", "Remova a task e a sub-fase 5.3.", "Mantenha o requisito do desenvolvedor como UM critério"],
      ["P6", "Remova a tarefa.", "Mantenha o requisito como um único critério"],
    ];
    for (const [chave, comeco, pedido] of casos) {
      const { verdict, corrigidos } = filtrado(chave);
      expect(corrigidos, chave).toBe(1);
      expect(verdict.status, chave).toBe("REJECTED");
      const fix = verdict.findings[0]!.fix;
      expect(fix.startsWith(comeco), `${chave}: ${fix}`).toBe(true);
      expect(fix, chave).not.toContain(pedido);
      expect(fix, chave).toContain(NADA_DE_TESTE_NO_LUGAR);
      expect(testRequirements(fix), chave).toEqual([]);
    }
    const f8 = filtrado("coerencia").verdict.findings[0]!.fix;
    expect(f8.startsWith("Remover as tarefas P4.T8, P5.T9 e P6.T4.")).toBe(true);
    expect(f8).not.toContain("acrescentar a uma tarefa de produto um único critério");
    expect(f8).toContain(NADA_DE_TESTE_NO_LUGAR);
  });

  it("os achados de executabilidade (F3, F4) não são tocados", () => {
    for (const chave of ["P1", "P2"]) {
      const { verdict, descartados, corrigidos } = filtrado(chave);
      expect(descartados, chave).toEqual([]);
      expect(corrigidos, chave).toBe(0);
      expect(verdict.findings, chave).toEqual(veredito(RODADA_2[chave]!).findings);
    }
  });

  it("a ressalva que pede teste sai — ela vira os \"achados anteriores\" do prompt seguinte —, e as do run, que não pedem, ficam", () => {
    for (const chave of ["P1", "P2", "P3", "P4", "P5", "P6", "coerencia"]) {
      expect(filtrado(chave).verdict.remarks, chave).toEqual(veredito(RODADA_2[chave]!).remarks);
    }
    const comPedido = tirarPedidoDeTeste({
      status: "APPROVED", findings: [], reason: "x",
      remarks: [{ where: "Phase 3", observation: "O requisito do desenvolvedor de que cada módulo tenha testes automatizados próprios aparece só no Goal." }],
    }, [PEDIDO]);
    expect(comPedido.verdict.remarks).toEqual([]);
  });
});

describe("§129 · as tasks de teste da rodada 1 não chegam a nenhum auditor", () => {
  it("a I-16 conta as três tasks de teste (P4.3, P5.3, P6.1) e a condição de teste no README, e nada nas fases de produto", () => {
    const lido = parsePhases(PLANO_R1);
    if (!lido.ok) throw new Error(lido.errors.map((erro) => erro.message).join("; "));
    const erros = checkTestPrescription(lido.document, [PEDIDO]);
    const porFase = erros.map((erro) => Number(/da fase (\d+)/u.exec(erro.message)?.[1]));
    expect(porFase).toEqual([4, 5, 6, 6]);
    expect(erros[0]?.message).toContain("O módulo Categorias tem os seus próprios testes automatizados");
    expect(erros[1]?.message).toContain("O módulo Anotações tem seus próprios testes automatizados");
    expect(erros[2]?.message).toContain("Garantir que o dashboard do módulo tenha testes automatizados próprios");
    for (const erro of erros) {
      expect(erro.hint).toContain("executado pelo build");
      expect(erro.hint).not.toContain("mova-o");
    }
  });

  it("a cláusula da rodada 4 — \"e tem testes próprios\", sem qualificador — a I-16 não conta; o achado que a manda tirar fica, sem o critério de teste no lugar", () => {
    // Sem "automatizados", "testes próprios" é produto numa escola ("cada módulo do curso tem seus próprios testes").
    expect(testRequirements("garantir que o módulo é descoberto pela fundação e tem testes próprios.")).toEqual([]);
    const { verdict } = tirarPedidoDeTeste(veredito([
      "CAPIVARA_AUDIT_STATUS: REJECTED",
      "CAPIVARA_FINDING: Phase 4.1 · quarta Task (edição e exclusão) | A descrição da task manda \"garantir que o módulo ... tem testes próprios\". Isso é uma cláusula de trabalho sobre testes, e o plano não pode prescrevê-la. O requisito do desenvolvedor já está no critério final da task, escrito como propriedade do produto. | Tire da descrição da task a cláusula \"e tem testes próprios\" e deixe a descrição só com os endpoints de edição e exclusão e a descoberta pela fundação. Mantenha o critério \"O módulo tem testes automatizados próprios, executados contra um banco SQLite isolado e descartável\", porque ele é o requisito do desenvolvedor.",
      "CAPIVARA_REASON: a cláusula",
    ].join("\n")), [PEDIDO]);
    expect(verdict.status).toBe("REJECTED");
    expect(verdict.findings[0]?.fix.startsWith("Tire da descrição da task a cláusula")).toBe(true);
    expect(verdict.findings[0]?.fix).not.toContain("Mantenha o critério");
    expect(verdict.findings[0]?.fix).toContain(NADA_DE_TESTE_NO_LUGAR);
  });
});

describe("§129 · o esqueleto guarda o pedido de testes para o build, e o plano não o lê", () => {
  it("o esqueleto do run, lido hoje: a stack \"Testes\" e a regra testes.requisito ficam onde estão — é o lugar do pedido; o resto volta nomeado", () => {
    const lido = parseSkeleton(JSON.stringify(ESQUELETO), { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(lido.ok).toBe(false);
    if (lido.ok) return;
    const problemas = lido.defects.map((defeito) => defeito.problem).join("\n");
    expect(problemas).toContain('a regra "persistencia.isolamento" carrega o pedido de testes para o plano');
    expect(problemas).toContain('a regra "modulos.independencia" carrega o pedido de testes para o plano');
    expect(problemas).toContain('a regra "projeto.execucao" carrega o pedido de testes para o plano');
    for (const fase of [3, 4, 5]) expect(problemas).toContain(`a fase ${fase} carrega o pedido de testes para o plano`);
    // A regra do banco dos testes é do harness: o escritor que a repete não erra.
    expect(problemas).not.toContain('"banco dos testes"');
    // No lugar do pedido, ele fica: é o que o build lê.
    expect(problemas).not.toContain('a regra "testes.requisito"');
    expect(problemas).not.toContain('em "Testes:');

    const tolerado = parseSkeleton(JSON.stringify(ESQUELETO), { maxTasksPerPhase: 15, authority: [PEDIDO], mechanisms: "tolerate" });
    expect(tolerado.ok).toBe(true);
    if (!tolerado.ok) return;
    expect(tolerado.skeleton.stack.some((item) => item.component === "Testes")).toBe(true);
    expect(tolerado.skeleton.rules.some((regra) => regra.subject === "testes.requisito")).toBe(true);
    expect(tolerado.applied).toEqual([]);
  });

  it("o esqueleto JÁ publicado (anterior à §129) é lido pelo plano sem o pedido de testes, e o arquivo continua o mesmo", () => {
    const doPlano = skeletonForPlanning(ESQUELETO);
    const fora = ESQUELETO.rules.filter((regra) => !doPlano.rules.includes(regra)).map((regra) => regra.subject);
    expect(fora).toEqual(["persistencia.isolamento", "testes.requisito", "banco dos testes"]);
    expect(doPlano.stack.map((item) => item.component)).not.toContain("Testes");
    // O produto fica: a independência dos módulos, o lado da aplicação que aceita o banco pelo ambiente.
    expect(doPlano.rules.map((regra) => regra.subject)).toContain("modulos.independencia");
    expect(doPlano.rules.map((regra) => regra.subject)).toContain("a aplicação escolhe o banco pelo ambiente");
    // A fatia de cada fase não leva a regra que mandava cada módulo ter testes.
    for (const fase of ESQUELETO.phases) expect(sliceForPhase(ESQUELETO, fase.number)).not.toContain("testes.requisito");
    // E o skeleton.md que o run publicou é o mesmo, byte a byte: os hashes do plano e o que o build lê não mudam.
    const publicado = readFileSync(join(import.meta.dirname, "..", "fixtures", "parallel-lab-129.skeleton.json"), "utf8");
    expect(renderSkeleton(JSON.parse(publicado) as Skeleton)).toBe(renderSkeleton(ESQUELETO));
  });

  it("o pedido de testes chega ao build pelo contrato compartilhado que já existia, e não chega ao plano", () => {
    const requisito = ESQUELETO.rules.find((regra) => regra.subject === "testes.requisito")!.statement;
    const contrato = sharedContractFromSkeleton(renderSkeleton(ESQUELETO));
    expect(contrato).toContain(`- testes.requisito: ${requisito}`);
    expect(contrato).toContain("- Testes: Testes automatizados, executados contra um banco isolado");
    // A instrução vive na política de teste, que o executor e o verificador leem (etapa 1 da redução).
    expect(testPolicyBlock()).toContain("rules about tests (subject starting with \"testes\")");
    // O plano não os vê: nem a fatia da fase, nem o esqueleto que o arquiteto, a coerência e a triagem recebem.
    for (const fase of ESQUELETO.phases) expect(sliceForPhase(ESQUELETO, fase.number)).not.toContain(requisito);
    expect(renderSkeleton(skeletonForPlanning(ESQUELETO))).not.toContain(requisito);
    expect(renderSkeleton(skeletonForPlanning(ESQUELETO))).not.toContain("- Testes: ");
  });
});

describe("§129 · a arquitetura: o pedido de testes não entra, as dependências de teste entram", () => {
  it("a arquitetura aprovada no run carrega os testes de cada módulo nos componentes e nas fases: o contrato de hoje a devolve nomeada", () => {
    const lida = parseArchitecture(ARQUITETURA, ESQUELETO, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(lida.ok).toBe(false);
    if (lida.ok) return;
    const problemas = lida.defects.map((defeito) => defeito.problem);
    for (const componente of ["tarefas", "categorias", "anotacoes", "dashboard"]) {
      expect(problemas.some((problema) => problema.startsWith(`o componente ${componente} prescreve teste`)), componente).toBe(true);
    }
    for (const fase of [3, 4, 5]) expect(problemas.some((problema) => problema.startsWith(`a fase ${fase} prescreve teste`)), String(fase)).toBe(true);
  });

  it("Vitest e Playwright na infraestrutura ficam: o build tem de tê-los antes da primeira fase", () => {
    const arquitetura = JSON.parse(ARQUITETURA);
    const semTestesNosComponentes = {
      ...arquitetura,
      components: arquitetura.components.map((componente: { responsibility: string }) => ({
        ...componente,
        responsibility: componente.responsibility.replace(/,? (?:com |e )?(?:os )?testes automatizados[^.]*\./u, "."),
      })),
      phases: arquitetura.phases.map((fase: { goal: string }) => ({ ...fase, goal: fase.goal.replace(/ e com os testes automatizados próprios do módulo/u, "") })),
      infrastructure: {
        ...arquitetura.infrastructure,
        dependencies: [
          ...arquitetura.infrastructure.dependencies,
          { name: "vitest", version: "", kind: "dev", purpose: "runner de testes da stack Vite", basis: "exigência técnica: o build executa os testes que o pedido exige" },
          { name: "@playwright/test", version: "", kind: "dev", purpose: "percorrer os fluxos no navegador", basis: "exigência técnica: a interface web é percorrida no build" },
        ],
      },
    };
    const lida = parseArchitecture(JSON.stringify(semTestesNosComponentes), ESQUELETO, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(lida.ok, lida.ok ? "" : JSON.stringify(lida.defects.map((defeito) => defeito.problem))).toBe(true);
    if (!lida.ok) return;
    expect(lida.architecture.infrastructure.dependencies.map((item) => item.name)).toEqual(expect.arrayContaining(["vitest", "@playwright/test"]));
    expect(lida.applied.some((nota) => nota.includes("removeu vitest") || nota.includes("removeu @playwright"))).toBe(false);
  });
});

describe("§129 · os prompts dizem a mesma regra a todos os papéis", () => {
  const contexto = { language: "português do Brasil", request: PEDIDO, decisions: [], assumptions: [], inventory: "vazio", maxTasksPerPhase: 15, maxCriteriaPerTask: 4 };

  it("a regra do planejamento: o pedido de testes é do build, a infraestrutura lista as dependências de teste, e teste não é motivo de devolução", () => {
    const regra = planningScopeBlock();
    expect(regra).toContain("is an instruction to the BUILD, exactly like \"compile without errors\"");
    expect(regra).toContain("the test ones included");
    expect(regra).toContain("Tests are never a reason to reject, return or question a plan");
    // O parágrafo da §128 que mandava carregar o requisito na responsabilidade do componente e num critério.
    expect(regra).not.toContain("the phase that delivers that component carries it as one acceptance");
    expect(regra).not.toContain("leaving it out loses a requirement");
  });

  it("o escritor do esqueleto guarda o pedido nas regras \"testes.\"; o arquiteto lista as dependências de teste; os auditores não pedem teste", () => {
    expect(skeletonPrompt(contexto)).toContain("Record it in `rules` whose subject starts with `testes.`");
    const arquiteto = architectPrompt({ ...contexto, skeleton: "# esqueleto" });
    expect(arquiteto).toContain("the stack's test runner and, for a browser");
    const auditorDaArquitetura = architectureAuditPrompt({ language: contexto.language, request: PEDIDO, decisions: [], skeleton: "# esqueleto", architecture: "# arquitetura", maxTasksPerPhase: 15 });
    expect(auditorDaArquitetura).toContain("its absence from the architecture is correct");
    expect(auditorDaArquitetura).not.toContain("its absence is a fidelity defect");
    const auditorDaFase = phaseAuditPrompt({
      language: contexto.language, document: "project-phases.md#P1", executable: true, request: PEDIDO, decisions: [], dispositions: [],
      upstream: [], upstreamRemarks: [], content: "## Phase 1", phaseMarkdown: "## Phase 1", phaseNumber: 1, totalPhases: 1,
    });
    expect(auditorDaFase).toContain("the one finding allowed is to remove it");
  });
});

describe("§129 · o que continua produto", () => {
  it("o domínio do produto que fala de teste não é contado", () => {
    for (const produto of [
      "O aluno faz testes de nivelamento no início do semestre.",
      "O sistema tem testes de nivelamento cadastrados pelo professor.",
      "Testes clínicos armazenados em banco de sangue ficam disponíveis.",
      "Implementar a suíte presidencial com vista para o mar.",
      "A suíte presidencial passa por reforma anual.",
      "O laboratório registra os resultados dos testes no banco.",
      "O usuário cadastra um teste A/B com duas variantes.",
      "O professor cria testes próprios para cada turma.",
      "A aplicação aceita DATABASE_PATH apontando para outro arquivo.",
      "Excluir uma coluna é recusado enquanto ela ainda tem cartões.",
    ]) {
      expect(testPrescriptions(produto, [PEDIDO]), produto).toEqual([]);
    }
  });

  it("o achado de produto cuja correção sugere um teste fica, sem o teste", () => {
    const { verdict, corrigidos } = tirarPedidoDeTeste({
      status: "REJECTED",
      findings: [{ where: "P2.T1.C2", problem: "O critério não diz o que acontece com título vazio.", fix: "Diga que título vazio é recusado com 400. Acrescente um teste automatizado do módulo para isso." }],
      remarks: [],
      reason: "x",
    });
    expect(corrigidos).toBe(1);
    expect(verdict.status).toBe("REJECTED");
    expect(verdict.findings[0]?.fix).toContain("Diga que título vazio é recusado com 400");
    expect(verdict.findings[0]?.fix).not.toContain("Acrescente um teste");
  });
});

describe("§129 · a revisão adversarial, achado por achado", () => {
  it("1. o texto de produto que fala de teste não é contado: escola, laboratório, A/B, ferramenta de QA, hotel", () => {
    for (const produto of [
      "Os testes usam o banco de questões da disciplina",
      "Cada módulo do curso tem seus próprios testes",
      "O aluno pode executar os testes",
      "Os testes do módulo são aprovados pelo coordenador",
      "Exames e testes laboratoriais usam o mesmo banco de dados de pacientes",
      "Os testes rápidos de COVID usam a base de dados",
      "The A/B tests use the events database",
      "Os testes multivariados usam o banco",
      "a suíte de testes passa ou falha",
      "test suite passes",
      "O sistema executa os testes automatizados do repositório",
      "Users can run the tests",
      "Product tests",
      "A suíte automatizada passa por limpeza",
    ]) {
      expect(testPrescriptions(produto, [PEDIDO]), produto).toEqual([]);
    }
    // E o pedido de testes do run continua contado, inclusive a condição do banco isolado.
    for (const pedido of ["Os testes precisam utilizar banco isolado dos dados normais da aplicação.", "Testes automatizados aprovados.", "os testes rodam contra um banco isolado"]) {
      expect(testRequirements(pedido), pedido).not.toEqual([]);
    }
  });

  it("2. o achado de produto que cita uma regra \"teste.x\" ou o comando `npm test` não é tirado, e o veredito não vira aprovação", () => {
    for (const [problema, correcao] of [
      ["A regra teste.nota_minima diz 6, e a fase grava 5.", "Grave a nota mínima 6, como a regra teste.nota_minima diz."],
      ["O README cita `npm test`, mas o script `start` não existe.", "Declare o script `start` no package.json."],
      ["Os testes usam o banco de questões da disciplina, e a fase não diz como uma questão entra nele.", "Diga que a questão é cadastrada pelo professor."],
    ]) {
      const { verdict, descartados } = tirarPedidoDeTeste({ status: "REJECTED", findings: [{ where: "P2.T1", problem: problema!, fix: correcao! }], remarks: [], reason: "x" }, [PEDIDO]);
      expect(descartados, problema).toEqual([]);
      expect(verdict.status, problema).toBe("REJECTED");
      expect(verdict.findings[0]?.fix, problema).toBe(correcao);
    }
  });

  it("3. a correção que tira em qualquer ponto da frase fica — \"Na task 2, remova o critério 3\" —, e o teste que ela aponta sai do texto", () => {
    for (const correcao of ["Na task 2, remova o critério 3.", "In task 2, remove criterion 3.", "Reescreva o critério 3 sem a menção aos testes."]) {
      const { verdict, descartados } = tirarPedidoDeTeste({
        status: "REJECTED", reason: "x", remarks: [],
        findings: [{ where: "P2.T2.C3", problem: "O critério 3 diz que o módulo tem testes automatizados próprios.", fix: correcao }],
      }, [PEDIDO]);
      expect(descartados, correcao).toEqual([]);
      expect(verdict.status, correcao).toBe("REJECTED");
      expect(verdict.findings[0]?.fix, correcao).toContain(NADA_DE_TESTE_NO_LUGAR);
    }
  });

  it("4. \"mova o requisito para um critério\" sai da correção em qualquer forma, e a regra vai no fim", () => {
    for (const correcao of [
      "Remova a task 9 e registre o requisito como critério da task 8.",
      "Remova a task 9 e registre o requisito de testes como critério da task 8.",
      "Remova a task 9; o requisito vai como critério da task 8.",
    ]) {
      const { verdict } = tirarPedidoDeTeste({
        status: "REJECTED", reason: "x", remarks: [],
        findings: [{ where: "P2.T9", problem: "A task 9 existe só para entregar os testes automatizados do módulo.", fix: correcao }],
      }, [PEDIDO]);
      const fix = verdict.findings[0]?.fix ?? "";
      expect(fix, correcao).toContain("Remova a task 9");
      expect(fix, correcao).not.toContain("requisito");
      expect(fix, correcao).toContain(NADA_DE_TESTE_NO_LUGAR);
    }
  });

  it("5. a regra \"banco dos testes\" escrita pelo escritor continua passando pela I-16 de ferramenta", () => {
    const comJest = { ...ESQUELETO, rules: [...ESQUELETO.rules.filter((regra) => regra.subject !== "banco dos testes"), { subject: "banco dos testes", statement: "A suíte roda com Jest a partir de jest.config.js, com os arquivos em `__tests__/`." }] };
    const lido = parseSkeleton(JSON.stringify(comJest), { maxTasksPerPhase: 15, authority: [PEDIDO], mechanisms: "tolerate" });
    expect(lido.ok).toBe(false);
    if (!lido.ok) expect(lido.defects.map((defeito) => defeito.problem).join(" ")).toContain('a regra "banco dos testes" prescreve teste');
  });

  it("6. o pedido que exige testes não some: sem regra \"testes.\", o esqueleto volta ao escritor nomeado; com ela, passa", () => {
    const semRegraDeTeste = { ...ESQUELETO, stack: ESQUELETO.stack.filter((item) => item.component !== "Testes"), rules: ESQUELETO.rules.filter((regra) => regra.subject !== "testes.requisito") };
    const lido = parseSkeleton(JSON.stringify(semRegraDeTeste), { maxTasksPerPhase: 15, authority: [PEDIDO], mechanisms: "tolerate" });
    expect(lido.ok).toBe(true);
    if (lido.ok) expect(lido.tolerated.join("\n")).toContain('o pedido exige testes');
    const comRegra = parseSkeleton(JSON.stringify(ESQUELETO), { maxTasksPerPhase: 15, authority: [PEDIDO], mechanisms: "tolerate" });
    expect(comRegra.ok && comRegra.tolerated.some((ressalva) => ressalva.includes("o pedido exige testes"))).toBe(false);
  });
});

describe("§129 · as dependências são do plano: o build instala o que a infraestrutura aprovada declara", () => {
  it("o executor instala o declarado, nunca acrescenta, troca ou atualiza; o reparo também; o verificador leva a dependência não prevista ao plano", async () => {
    const { implementPrompt } = await import("../../src/prompts/builder.js");
    const { verifyPrompt, verifierRepairPrompt } = await import("../../src/prompts/verifier.js");
    const executor = implementPrompt({ language: "pt-BR", phaseMarkdown: "## Phase 1", testCommand: null } as Parameters<typeof implementPrompt>[0]);
    expect(executor).toContain("Install the dependencies the approved infrastructure declares");
    expect(executor).toContain("that change belongs to the plan");
    const verificador = verifyPrompt({ language: "pt-BR", taskCount: 1, phaseMarkdown: "## Phase 1" });
    expect(verificador).toContain("the phase demonstrably needs a dependency the approved infrastructure does not\ndeclare — add `UPSTREAM: PLAN");
    const reparo = verifierRepairPrompt({ language: "pt-BR", phaseMarkdown: "## Phase 1", cause: "x", testCommand: null } as unknown as Parameters<typeof verifierRepairPrompt>[0]);
    expect(reparo).toContain("Never add, replace or upgrade one they do not declare: the plan chose them");
  });

  it("o G2 com o runner ausente manda instalar o declarado e não escolher outro; o G4 não acrescenta o runner do harness ao projeto", async () => {
    const { gate2 } = await import("../../src/loop/gates.js");
    const resultado = await gate2("/tmp", "npm test", async () => ({ exitCode: 127, output: "sh: 1: vitest: not found" }));
    expect(resultado.green).toBe(false);
    const causa = "cause" in resultado ? String(resultado.cause) : "";
    expect(causa).toContain("o runner que a infraestrutura aprovada e o manifesto declaram");
    expect(causa).toContain("Não escolha nem troque o runner");
    expect(causa).not.toContain("npm install -D");
  });

  it("a task da fundação que declara no manifesto o runner que a infraestrutura escolheu não é prescrição de teste", () => {
    const fundacao = [
      "# Parallel Lab — Project Phases", "", "<!-- inputs: skeleton.md@sha256:000000000000 architecture.md@sha256:000000000000 -->", "",
      assemblePhase({ number: 1, title: "Fundação", goal: "objetivo", dependsOn: "none", covers: ["tarefas"], areas: ["infra"] }, [
        "- [ ] **Task:** Criar o `package.json` da raiz com as dependências da infraestrutura aprovada, inclusive `vitest` e `@playwright/test` em `devDependencies`",
        "  - **Acceptance criteria:**",
        "    - `npm install` instala, sem erro, todas as dependências declaradas",
        "  - **Traces:** tarefas",
      ].join("\n")).trim(),
    ].join("\n");
    const lido = parsePhases(fundacao);
    if (!lido.ok) throw new Error(lido.errors.map((erro) => erro.message).join("; "));
    // Sem a infraestrutura na autoridade, o nome da ferramenta é escolha que a fase não tem.
    expect(checkTestPrescription(lido.document, [PEDIDO])).not.toEqual([]);
    // Com ela — o que o orquestrador passa depois que a arquitetura é aprovada —, é o cumprimento da escolha do plano.
    expect(checkTestPrescription(lido.document, [PEDIDO, "vitest", "@playwright/test"])).toEqual([]);
  });
});
