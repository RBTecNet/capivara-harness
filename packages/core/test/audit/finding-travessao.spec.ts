/**
 * O travessão no lugar do primeiro "|" — o caso do `teste_openrouter3`.
 *
 * As duas respostas abaixo são as que o auditor de coerência (Luna) devolveu no
 * run `init-dc741f0d7b92`, byte a byte. Os dois achados eram certos — uma rota
 * consumida antes de ser entregue, e uma contagem sem decisão que a autorize —
 * e o `plan` parou porque o primeiro finding separava a localização da
 * descrição com um travessão. A Capivara trabalha para concluir a etapa: forma
 * com toda a informação presente é lida, não devolvida.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatVerdict, parseAudit } from "../../src/audit/index.js";
import { runInit, runPlan } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { approve, fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

/** Primeira resposta do Luna (tentativa 1): os DOIS findings com travessão. */
const LUNA_1 = `CAPIVARA_AUDIT_STATUS: REJECTED
CAPIVARA_FINDING: Architecture — P2.T8.C1 e P4.T1.C1 consomem GET /api/dashboard, mas P6.T1.C1 só entrega essa rota depois das fases 2 e 4; isso também contraria a decisão confirmada de disponibilizar a rota antes dos consumidores e integrar a página na fase 6 | Mova a entrega da rota para a fase 1, ajuste a responsabilidade do dashboard na fase 2 e deixe a fase 6 integrar a página ao contrato já disponível.
CAPIVARA_FINDING: P4.T1.C1 — A página de Categorias deve exibir a quantidade persistida de categorias consultada em GET /api/dashboard; nenhuma decisão autoriza exibir essa contagem nessa página, pois as contagens foram solicitadas para o dashboard | Remova a contagem da página de Categorias e mantenha as contagens no dashboard.
CAPIVARA_REASON: A rota é consumida antes de ser entregue, em desacordo com a decisão confirmada; e P4.T1.C1 acrescenta uma exibição de contagem sem autorização nas decisões.`;

/** Segunda resposta (tentativa 2): o primeiro com travessão, o segundo já no protocolo. */
const LUNA_2 = `CAPIVARA_AUDIT_STATUS: REJECTED
CAPIVARA_FINDING: Architecture — P2.T8.C1 e P4.T1.C1 consomem GET /api/dashboard, mas P6.T1.C1 entrega essa rota apenas na fase 6, depois dos consumidores; isso contraria a decisão confirmada de disponibilizar a rota antes deles e deixar a fase 6 integrar a página ao contrato existente | Mova a entrega da rota de contagens para a fase 1, ajuste a responsabilidade do dashboard na fase 2 para não consumir essa rota antes de sua entrega e deixe a fase 6 integrar a página ao contrato disponível
CAPIVARA_FINDING: P4.T1.C1 | A página de Categorias deve exibir a contagem persistida consultada em GET /api/dashboard, mas nenhuma decisão autoriza exibir contagens nessa página; o pedido prevê as contagens no dashboard | Remova a contagem do critério da página de Categorias e mantenha sua exibição no dashboard
CAPIVARA_REASON: P2.T8.C1 e P4.T1.C1 consomem uma rota entregue somente em P6.T1.C1, contrariando a decisão confirmada sobre a ordem e a integração; P4.T1.C1 também exige uma exibição de contagem sem autorização nas decisões.`;

const PROBLEMA_1 =
  "P2.T8.C1 e P4.T1.C1 consomem GET /api/dashboard, mas P6.T1.C1 entrega essa rota apenas na fase 6, depois dos consumidores; isso contraria a decisão confirmada de disponibilizar a rota antes deles e deixar a fase 6 integrar a página ao contrato existente";
const CORRECAO_1 =
  "Mova a entrega da rota de contagens para a fase 1, ajuste a responsabilidade do dashboard na fase 2 para não consumir essa rota antes de sua entrega e deixe a fase 6 integrar a página ao contrato disponível";
const PROBLEMA_2 =
  "A página de Categorias deve exibir a contagem persistida consultada em GET /api/dashboard, mas nenhuma decisão autoriza exibir contagens nessa página; o pedido prevê as contagens no dashboard";
const CORRECAO_2 = "Remova a contagem do critério da página de Categorias e mantenha sua exibição no dashboard";

describe("as duas respostas reais do Luna são aproveitadas sem nova chamada", () => {
  it("a segunda resposta: o finding com travessão e o finding conforme, os dois preservados", () => {
    const lido = parseAudit(LUNA_2);
    if (!lido.ok) throw new Error(lido.defects.join("; "));
    expect(lido.verdict.status).toBe("REJECTED");
    expect(lido.verdict.findings).toHaveLength(2);
    expect(lido.verdict.findings[0]).toEqual({ where: "Architecture", problem: PROBLEMA_1, fix: CORRECAO_1 });
    expect(lido.verdict.findings[1]).toEqual({ where: "P4.T1.C1", problem: PROBLEMA_2, fix: CORRECAO_2 });
    expect(lido.verdict.reason).toContain("P2.T8.C1 e P4.T1.C1 consomem uma rota entregue somente em P6.T1.C1");
    // O conserto é dito, uma vez, e só para o finding que precisou dele.
    expect(lido.applied).toHaveLength(1);
    expect(lido.applied[0]).toContain('"Architecture"');
    expect(lido.applied[0]).toContain("travessão");
  });

  it("a primeira resposta: os dois findings com travessão, inclusive o endereçado a um critério", () => {
    const lido = parseAudit(LUNA_1);
    if (!lido.ok) throw new Error(lido.defects.join("; "));
    expect(lido.verdict.status).toBe("REJECTED");
    expect(lido.verdict.findings.map((finding) => finding.where)).toEqual(["Architecture", "P4.T1.C1"]);
    expect(lido.verdict.findings[0]?.problem).toMatch(/^P2\.T8\.C1 e P4\.T1\.C1 consomem GET \/api\/dashboard, mas P6\.T1\.C1 só entrega/);
    expect(lido.verdict.findings[0]?.fix).toMatch(/^Mova a entrega da rota para a fase 1/);
    expect(lido.verdict.findings[1]?.problem).toMatch(/^A página de Categorias deve exibir a quantidade persistida/);
    expect(lido.verdict.findings[1]?.fix).toMatch(/^Remova a contagem da página de Categorias/);
    expect(lido.applied).toHaveLength(2);
  });

  it("o veredito recuperado é o mesmo que o auditor teria dado no protocolo: o round-trip fecha", () => {
    const lido = parseAudit(LUNA_2);
    if (!lido.ok) throw new Error(lido.defects.join("; "));
    const conforme = parseAudit(formatVerdict(lido.verdict));
    if (!conforme.ok) throw new Error(conforme.defects.join("; "));
    expect(conforme.verdict).toEqual(lido.verdict);
    expect(conforme.applied).toEqual([]);
  });
});

describe("a recuperação é determinística e não afrouxa o protocolo", () => {
  const resposta = (finding: string) => ["CAPIVARA_AUDIT_STATUS: REJECTED", `CAPIVARA_FINDING: ${finding}`, "CAPIVARA_REASON: há defeito"].join("\n");
  const defeitos = (finding: string): string[] => {
    const lido = parseAudit(resposta(finding));
    return lido.ok ? [] : lido.defects;
  };

  it("um finding já no protocolo não é tocado, mesmo com travessão dentro do texto", () => {
    const lido = parseAudit(resposta("Phase 2 | o critério — o segundo — é vago | use um limite numérico"));
    if (!lido.ok) throw new Error(lido.defects.join("; "));
    expect(lido.verdict.findings[0]).toEqual({ where: "Phase 2", problem: "o critério — o segundo — é vago", fix: "use um limite numérico" });
    expect(lido.applied).toEqual([]);
  });

  it("reconhece endereços com número, com o separador · e as seções nomeadas", () => {
    for (const where of ["Phase 3", "US-1.2", "Phase 1 · statuses", "components · api", "Overview", "Arquitetura"]) {
      const lido = parseAudit(resposta(`${where} — o problema | a correção`));
      expect(lido.ok, where).toBe(true);
      if (lido.ok) expect(lido.verdict.findings[0]?.where).toBe(where);
    }
  });

  it("dois campos sem travessão continuam incompletos", () => {
    expect(defeitos("Architecture o problema | a correção").join(" ")).toContain("três campos");
  });

  it("o hífen não é separador: aparece dentro de prosa e de identificadores", () => {
    expect(defeitos("Architecture - o problema | a correção").join(" ")).toContain("três campos");
  });

  it("uma cabeça que é frase não é localização", () => {
    expect(defeitos("A rota é consumida antes de existir — o problema | a correção")).not.toEqual([]);
    expect(defeitos("Phase 2, task 3 — o problema | a correção")).not.toEqual([]);
  });

  it("descrição ou correção vazias seguem inválidas", () => {
    expect(defeitos("Architecture — | a correção")).not.toEqual([]);
    expect(defeitos("Architecture — o problema |")).not.toEqual([]);
  });

  it("a correção que só repete o problema continua sendo cobrada depois da recuperação", () => {
    expect(defeitos("Architecture — o problema | o problema").join(" ")).toContain("apenas repete o problema");
  });

  it("REJECTED continua REJECTED; a recuperação não aprova nada", () => {
    const lido = parseAudit(LUNA_1);
    expect(lido.ok && lido.verdict.status).toBe("REJECTED");
  });
});

/*
 * Depois do parse, o caminho já existia: o achado endereçado a `Architecture`
 * refaz a arquitetura, e o de fase fica para a auditoria seguinte, sobre a
 * divisão nova. O que se prova aqui é que a resposta real do Luna CHEGA a esse
 * caminho, sem a repetição do auditor e sem nova chamada para normalizar.
 */
describe("o PLAN recebe os achados e segue pela correção arquitetural", () => {
  let projectRoot = "";
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-travessao-"));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };
  const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
  const COERENCIA = "project-phases.md#coerência";

  it("a resposta real reprova uma vez, a arquitetura é refeita com o achado, e o plano fecha", async () => {
    const dito: string[] = [];
    const base = skeletonPath();
    await runInit({ projectRoot, request, language: "português do Brasil", stage: "init", call: fakeAgent(base).call, ask: responde, announce: () => undefined });

    let coerencias = 0;
    const passos: ScriptStep[] = [
      { match: { role: "auditor", stage: "audit", subject: COERENCIA }, respond: { stdout: () => (coerencias += 1) === 1 ? LUNA_2 : approve() }, repeat: true },
      ...base,
    ];
    const agent = fakeAgent(passos);
    const outcome = await runPlan({ projectRoot, request, language: "português do Brasil", call: agent.call, ask: responde, announce: (linha) => void dito.push(linha), sleep: async () => undefined });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    const por = (filtro: Partial<AgentCall>) => agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));
    // Nenhuma repetição do auditor: a resposta foi lida na primeira vez.
    const deCoerencia = por({ role: "auditor", stage: "audit", subject: COERENCIA });
    expect(deCoerencia).toHaveLength(2);
    expect(deCoerencia.some((call) => call.prompt.includes("## Repair the previous audit response"))).toBe(false);
    // A arquitetura foi refeita com o achado inteiro, preservado.
    const arquiteturas = por({ role: "writer", stage: "authoring", subject: "architecture" });
    // Três: o desenho, a emenda com o achado e — como o arquiteto falso devolve a
    // mesma arquitetura — a mudança de estratégia da §119, antes de qualquer arbitragem.
    expect(arquiteturas).toHaveLength(3);
    expect(arquiteturas[1]?.prompt).toContain(PROBLEMA_1);
    expect(arquiteturas[1]?.prompt).toContain(CORRECAO_1);
    expect(arquiteturas[2]?.prompt).toContain("## Change of strategy");
    const anunciado = dito.join("\n");
    expect(anunciado).toContain("travessão");
    expect(anunciado).toContain("1 achado(s) pedem reorganização das fases");
    expect(anunciado).toContain("1 achado(s) de fase ficam para a próxima auditoria");
  });
});
