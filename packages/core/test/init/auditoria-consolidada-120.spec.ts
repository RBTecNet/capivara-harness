/**
 * Auditoria consolidada e convergência econômica (§120).
 *
 * No `teste_openrouter3` (0.6.1) o auditor da arquitetura devolveu cinco vezes,
 * e a cada rodada fechou o que tinha apontado e trouxe um ponto novo: sete
 * defeitos em cinco leituras, três deles presentes desde a primeira
 * arquitetura (a comparação das versões em cache mostra: as dependências de
 * tipos faltavam nos desenhos 1 e 2, o status inicial do POST nos desenhos 1 a
 * 3, e o fluxo 4 em todos). O arquiteto convergia; o auditor lia aos pedaços;
 * e o run parou por contagem de devoluções.
 *
 * Os sete achados reais são as fixtures. O que se prova: sete chegam inteiros
 * ao arquiteto numa rodada só e são corrigidos juntos; a rodada que fecha tudo
 * não gasta o teto; o que persiste gasta; nada roda para sempre; e nada é
 * aprovado por cansaço.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { balancoDaRodada, nextAuditAction, parseAudit, rodadaAvancou } from "../../src/audit/index.js";
import type { AuditAttempt, Finding } from "../../src/audit/index.js";
import { runInit, runPlan } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_2, approve, fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

/** Os sete achados reais, na ordem em que o auditor os descobriu — cinco leituras. */
const ACHADOS_REAIS = [
  `CAPIVARA_FINDING: componentes · tarefas | O contrato de PUT cita título e descrição, mas exige rejeitar status inválido; não define como a atualização de status solicitada em US-1.1 é enviada. | Inclua status no contrato de atualização e especifique quando ele é obrigatório.`,
  `CAPIVARA_FINDING: componentes · interface | Os contratos da interface não atribuem os estados de carregamento e lista vazia, validação de formulários, feedback visual de sucesso e erro, responsividade e uso do português brasileiro exigidos pelo skeleton. | Acrescente esses comportamentos ao contrato da interface e aos contratos das páginas dos módulos, conforme aplicável.`,
  `CAPIVARA_FINDING: componentes · entrega | npm start é declarado como comando para iniciar a aplicação compilada, mas não há contrato que estabeleça como a interface compilada é servida junto à API; a integração necessária para abrir o produto não fica definida. | Especifique como o comando disponibiliza a interface e a API integradas.`,
  `CAPIVARA_FINDING: infrastructure · Dependências | A compilação TypeScript do servidor Express e da interface React requer declarações de tipos que não estão entre as dependências declaradas; a infraestrutura não cobre a compilação sem erros exigida por US-5.3. | Declarar as dependências de tipos necessárias para Express, React e Node.js, sem fixar versões não decididas pelo skeleton.`,
  `CAPIVARA_FINDING: components · tarefas | POST cria tarefas recebendo apenas título e descrição, mas o contrato não define como o campo obrigatório status é preenchido; a tabela também não declara um valor padrão | Definir um valor inicial para status na API ou exigir esse campo na criação e alinhar o contrato da interface`,
  `CAPIVARA_FINDING: fluxos · workflow 4 | A sequência interface → tarefas → categorias → anotacoes contradiz a navegação pela sidebar e sugere que os módulos dependem uns dos outros, embora sejam independentes. | Descrever a navegação do dashboard para cada módulo como caminhos independentes.`,
  `CAPIVARA_FINDING: components · api | O contrato de configuração não exige que .env esteja no .gitignore desde a Phase 1 nem que credenciais reais sejam restritas a esse arquivo; a regra explícita do skeleton fica sem componente responsável por aplicá-la | Acrescentar ao contrato da api essas duas restrições e atribuí-las à Phase 1`
];

const consolidada = (findings: readonly string[]) => ["CAPIVARA_AUDIT_STATUS: REJECTED", ...findings, "CAPIVARA_REASON: a arquitetura tem defeitos materiais"].join("\n");

const lidos = (): Finding[] => {
  const parsed = parseAudit(consolidada(ACHADOS_REAIS));
  if (!parsed.ok) throw new Error(parsed.defects.join("; "));
  return parsed.verdict.findings;
};

describe("1. uma resposta com os sete achados é lida inteira", () => {
  it("sete findings, cada um com os três campos preservados", () => {
    const findings = lidos();
    expect(findings).toHaveLength(7);
    expect(findings.map((f) => f.where)).toEqual(["componentes · tarefas", "componentes · interface", "componentes · entrega", "infrastructure · Dependências", "components · tarefas", "fluxos · workflow 4", "components · api"]);
    for (const finding of findings) {
      expect(finding.problem.length).toBeGreaterThan(40);
      expect(finding.fix.length).toBeGreaterThan(20);
    }
    expect(findings[4]?.problem).toContain("não define como o campo obrigatório status é preenchido");
  });
});

describe("5–6. o balanço de uma rodada distingue fechado, persistente, novo e regressão", () => {
  const sete = lidos();
  const rodada = (attempt: number, findings: Finding[], sha: string): AuditAttempt => ({ attempt, verdict: { status: "REJECTED", findings, remarks: [], reason: "r" }, contentSha: sha });

  it("classifica com evidência, não por contagem", () => {
    const history = [
      rodada(1, sete.slice(0, 3), "a"),
      rodada(2, [sete[2]!, sete[3]!], "b"), // fechou 2, persistiu 1, 1 novo
      rodada(3, [sete[0]!, sete[4]!], "c"), // fechou 2; o primeiro voltou (regressão); 1 novo
      rodada(4, [sete[4]!], "c"), // mesmo texto
    ];
    expect(balancoDaRodada(history, 0)).toEqual({ fechados: 0, persistentes: 0, novos: 3, regressoes: 0, incertos: 0, mesmoTexto: false });
    expect(balancoDaRodada(history, 1)).toEqual({ fechados: 2, persistentes: 1, novos: 1, regressoes: 0, incertos: 0, mesmoTexto: false });
    expect(balancoDaRodada(history, 2)).toEqual({ fechados: 2, persistentes: 0, novos: 1, regressoes: 1, incertos: 0, mesmoTexto: false });
    expect(balancoDaRodada(history, 3).mesmoTexto).toBe(true);
    expect(rodadaAvancou(history, 1)).toBe(false);
    expect(rodadaAvancou(history, 2)).toBe(false);
    expect(rodadaAvancou(history, 3)).toBe(false);
  });

  it("a rodada que fecha tudo e só traz pontos novos é progresso, e não gasta o teto", () => {
    const history = [rodada(1, sete.slice(0, 3), "a"), rodada(2, [sete[3]!], "b"), rodada(3, [sete[4]!], "c")];
    expect(rodadaAvancou(history, 1)).toBe(true);
    expect(rodadaAvancou(history, 2)).toBe(true);
    // Três devoluções, mas só a primeira sem progresso: ainda volta ao escritor.
    expect(nextAuditAction({ document: "architecture.md", history, maxReturns: 3, maxMechanical: 1 }).action).toBe("return-to-writer");
  });

  it("7. o que persiste gasta o teto, e o teto duro impede o auditor de acrescentar pontos para sempre", () => {
    const persistente = [rodada(1, [sete[0]!], "a"), rodada(2, [sete[0]!], "b"), rodada(3, [sete[0]!], "c")];
    expect(nextAuditAction({ document: "architecture.md", history: persistente, maxReturns: 3, maxMechanical: 1 }).action).toBe("ask-developer");
    const semFim = sete.slice(0, 6).map((finding, index) => rodada(index + 1, [finding], `s${index}`));
    const acao = nextAuditAction({ document: "architecture.md", history: semFim, maxReturns: 3, maxMechanical: 1 });
    expect(acao.action).toBe("ask-developer");
    if (acao.action === "ask-developer") expect(acao.standoff.question).toContain("O teto duro acabou");
  });
});

describe("no orquestrador, com o provider falso", () => {
  let projectRoot = "";
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-120-"));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };
  const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
  const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
    agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

  /** O arquiteto que corrige de verdade: cada resposta é um texto diferente do anterior. */
  const arquitetoQueMuda = () => {
    let vez = 0;
    return () => JSON.stringify({ ...JSON.parse(ARCHITECTURE), overview: `Um serviço Node com camada de dados e camada HTTP no mesmo processo (revisão ${(vez += 1)}).` });
  };

  async function plan(auditorDaArquitetura: (call: AgentCall) => string, extras: Partial<Parameters<typeof runPlan>[0]> = {}, arquiteto: (call: AgentCall) => string = arquitetoQueMuda()) {
    await runInit({ projectRoot, request, language: "português do Brasil", stage: "init", call: fakeAgent(skeletonPath()).call, ask: responde, announce: () => undefined });
    const dito: string[] = [];
    const perguntadas: Question[] = [];
    let impasses = 0;
    const agent = fakeAgent([
      { match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: auditorDaArquitetura }, repeat: true },
      { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquiteto }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "architecture"),
    ]);
    const run = runPlan({
      projectRoot, request, language: "português do Brasil", call: agent.call,
      ask: async (question) => { perguntadas.push(question); return "1"; },
      announce: (linha) => void dito.push(linha), sleep: async () => undefined,
      decideStandoff: async () => { impasses += 1; return "publicar"; },
      ...extras,
    });
    return { run, agent, perguntadas, anunciado: () => dito.join("\n"), impasses: () => impasses };
  }

  it("2–4, 10, 12. os sete achados chegam juntos ao arquiteto, são corrigidos numa rodada, e o plano fecha com duas auditorias", async () => {
    let auditorias = 0;
    const { run, agent, perguntadas, impasses, anunciado } = await plan(() => ((auditorias += 1) === 1 ? consolidada(ACHADOS_REAIS) : approve()));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    const desenhos = por(agent, { role: "writer", stage: "authoring", subject: "architecture" });
    expect(desenhos).toHaveLength(2);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(2);
    const emenda = desenhos[1]?.prompt ?? "";
    for (const finding of lidos()) {
      expect(emenda).toContain(finding.problem);
      expect(emenda).toContain(finding.fix);
    }
    expect(emenda).toContain("correct ALL of it in this one answer");
    expect(emenda).toContain("## Your previous architecture");
    // A reauditoria sabe o que a leitura anterior apontou.
    const reauditoria = por(agent, { role: "auditor", stage: "audit", subject: "architecture" })[1]?.prompt ?? "";
    expect(reauditoria).toContain("## Your previous reading of this architecture found");
    expect(reauditoria).toContain("O contrato de PUT cita título e descrição");
    expect(anunciado()).toContain("refazendo a arquitetura com os 7 achado(s) juntos");
    expect(impasses()).toBe(0);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
  });

  it("6, 11. o caso real: cinco leituras, cada uma fechando a anterior e trazendo ponto novo, converge em vez de parar por contagem", async () => {
    // Leituras do run real: 3 achados, depois 1, 1, 1, 1; a sexta aprova. O teto é 3 sem progresso.
    const leituras = [ACHADOS_REAIS.slice(0, 3), [ACHADOS_REAIS[3]!], [ACHADOS_REAIS[4]!], [ACHADOS_REAIS[5]!], [ACHADOS_REAIS[6]!]];
    let auditorias = 0;
    const { run, agent, impasses, perguntadas, anunciado } = await plan(() => {
      const leitura = leituras[auditorias];
      auditorias += 1;
      return leitura ? consolidada(leitura) : approve();
    });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(auditorias).toBe(6);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(6);
    expect(impasses()).toBe(0);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    expect(anunciado()).toContain("rodada: fechou 3, 1 apareceu(ram) novo(s)");
    // O que já fechou viaja com a emenda seguinte, para não voltar.
    const terceiro = por(agent, { role: "writer", stage: "authoring", subject: "architecture" })[2]?.prompt ?? "";
    expect(terceiro).toContain("## Already fixed in earlier rounds — keep it fixed");
    expect(terceiro).toContain("O contrato de PUT cita título e descrição");
  });

  it("7, 10. o achado que persiste gasta o teto; esgotado, a estratégia muda uma vez e o run para sem publicar", async () => {
    const { run, agent, impasses } = await plan(() => consolidada([ACHADOS_REAIS[0]!]));
    await expect(run).rejects.toThrow(/não convergiu depois de 6 devolução\(ões\)/);
    // Devoluções 1 e 2 dentro do teto, a 3 esgota, a 4 é a estratégia trocada, a 5 e a 6 são os dois
    // reparos pelo auditor validados pelo verifier (§121): seis desenhos, seis leituras, e para.
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(4);
    expect(por(agent, { role: "verifier", stage: "audit", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(4);
    expect(por(agent, { role: "auditor", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(impasses()).toBe(0);
    await expect(readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).rejects.toThrow();
  });

  it("7. o auditor que sempre acha um ponto novo bate no teto duro: finito, e dito no diagnóstico", async () => {
    let auditorias = 0;
    const { run, agent, impasses } = await plan(() => consolidada([ACHADOS_REAIS[(auditorias += 1) % ACHADOS_REAIS.length]!]));
    await expect(run).rejects.toThrow(/não convergiu depois de 9 devolução\(ões\)/);
    // Sete leituras do auditor até o teto duro e a estratégia; depois dois reparos validados pelo verifier.
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(7);
    expect(por(agent, { role: "verifier", stage: "audit", subject: "architecture" })).toHaveLength(2);
    expect(impasses()).toBe(0);
  });

  it("8. a decisão genuína de produto continua chegando ao desenvolvedor, separada dos achados", async () => {
    let auditorias = 0;
    const comDecisao = `${consolidada(ACHADOS_REAIS.slice(0, 2))}\nCAPIVARA_DECISION: components · api | A reserva nova nasce pendente ou confirmada? | Pendente, até o pagamento | Confirmada no ato`;
    const { run, perguntadas, impasses } = await plan(() => ((auditorias += 1) === 1 ? comDecisao : approve()));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const daAuditoria = perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"));
    expect(daAuditoria).toHaveLength(1);
    expect(daAuditoria[0]?.decision).toContain("pendente ou confirmada");
    expect(impasses()).toBe(0);
  });

  it("3, 12. no plano, dois achados de uma fase chegam juntos à emenda e são corrigidos numa passagem", async () => {
    await runInit({ projectRoot, request, language: "português do Brasil", stage: "init", call: fakeAgent(skeletonPath()).call, ask: responde, announce: () => undefined });
    let auditorias = 0;
    let escritas = 0;
    const dois = ["CAPIVARA_AUDIT_STATUS: REJECTED",
      "CAPIVARA_FINDING: Tarefa «Implementar a criação de reserva com recusa de datas sobrepostas» | o critério de datas não diz o que acontece com a reserva recusada | diga que nada é persistido e que a resposta é 409",
      "CAPIVARA_FINDING: Tarefa «Implementar a criação de reserva com recusa de datas sobrepostas» | o status inicial não é observável | diga que a resposta traz status pendente",
      "CAPIVARA_REASON: dois pontos"].join("\n");
    const corrigida = PHASE_2.replace("Uma reserva nova nasce com status pendente", "A resposta 201 traz status pendente").replace("devolvem erro e não persistem nada", "respondem 409 e nada é persistido");
    const agent = fakeAgent([
      { match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2" }, respond: { stdout: () => ((auditorias += 1) === 1 ? dois : approve()) }, repeat: true },
      { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: () => ((escritas += 1) === 1 ? PHASE_2 : corrigida) }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "phase-p02"),
    ]);
    const outcome = await runPlan({ projectRoot, request, language: "português do Brasil", call: agent.call, ask: responde, announce: () => undefined, sleep: async () => undefined });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const emendas = por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" });
    expect(emendas).toHaveLength(2);
    expect(emendas[1]?.prompt).toContain("o critério de datas não diz o que acontece");
    expect(emendas[1]?.prompt).toContain("o status inicial não é observável");
    expect(emendas[1]?.prompt).toContain("apply ALL of it in this one answer");
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md#P2" })).toHaveLength(2);
  });
});
