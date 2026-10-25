import { describe, expect, it } from "vitest";
import { lerProtocolo, semRaciocinio } from "../../src/contract/protocolo.js";
import { admitir, citacoes } from "../../src/audit/admissibilidade.js";
import { parseAudit } from "../../src/audit/index.js";
import { parseVerification } from "../../src/prompts/index.js";
import { lerTriagem } from "../../src/prompts/index.js";
import { jsonDaResposta } from "../../src/contract/resposta.js";

/*
 * A leitura tolerante, num lugar só (etapa 2 da redução): a embalagem sai, o
 * conteúdo fica, e o que continua ilegível nunca é lido como aprovação.
 */
describe("a leitura tolerante do protocolo", () => {
  it("tira o raciocínio antes da resposta, com ou sem a abertura no texto", () => {
    expect(semRaciocinio("<think>TASK 1: INCOMPLETE — rascunho</think>\nTASK 1: DONE")).toBe("\nTASK 1: DONE");
    expect(semRaciocinio("<thinking>\nplanejando\n</thinking>CAPIVARA_AUDIT_STATUS: APPROVED")).toBe("CAPIVARA_AUDIT_STATUS: APPROVED");
    expect(semRaciocinio("pensei bastante</think>\nTASK 1: DONE")).toBe("\nTASK 1: DONE");
    expect(parseVerification("<think>TASK 1: INCOMPLETE — dúvida</think>\nTASK 1: DONE")).toEqual([{ index: 1, done: true, missing: "" }]);
  });

  it("negrito, marcador de lista, crase e outra caixa na chave são embalagem", () => {
    expect(parseVerification("**TASK 1:** DONE\n- task 2: incomplete — falta X\n1. `TASK 3`: DONE")).toEqual([
      { index: 1, done: true, missing: "" },
      { index: 2, done: false, missing: "falta X" },
      { index: 3, done: true, missing: "" },
    ]);
    const lido = parseAudit("- **capivara_audit_status:** approved\n> Capivara_Reason: fiel ao pedido");
    expect(lido.ok && lido.verdict.status).toBe("APPROVED");
  });

  it("o travessão curto entre palavras vira o travessão do protocolo", () => {
    expect(lerProtocolo("TASK 1: INCOMPLETE – falta X", String.raw`TASK\s+\d+`)).toBe("TASK 1: INCOMPLETE — falta X");
  });

  it("o conteúdo não é tocado: a crase final, a linha sem chave e a prosa ficam como vieram", () => {
    expect(lerProtocolo("TASK 1: INCOMPLETE — use `ler()`", String.raw`TASK\s+\d+`)).toBe("TASK 1: INCOMPLETE — use `ler()`");
    expect(lerProtocolo("uma **frase** qualquer", String.raw`TASK\s+\d+`)).toBe("uma **frase** qualquer");
    // A chave em minúscula no meio da prosa de um achado é conteúdo, e não é cortada.
    expect(parseVerification("TASK 1: INCOMPLETE — a task 2: depende disto")).toEqual([{ index: 1, done: false, missing: "a task 2: depende disto" }]);
  });

  it("o que continua ilegível nunca vira aprovação", () => {
    expect(parseAudit("<think>CAPIVARA_AUDIT_STATUS: APPROVED</think>achei bom").ok).toBe(false);
    expect(parseVerification("**TASK** um: feito")).toEqual([]);
    expect(lerTriagem("<think>CAPIVARA_TRIAGEM: PRODUTO\nCAPIVARA_CORRECAO: x</think>")).toBeNull();
  });

  it("o JSON da resposta é lido sem o raciocínio que o antecede", () => {
    expect(jsonDaResposta('<think>talvez {"a": 2}</think>\n{"a": 1}')).toEqual({ a: 1 });
  });
});

describe("o que pode devolver o plano: a classe e o que o Core confere", () => {
  const lugares = [
    { nome: "Phase 1", texto: "- `POST /clientes` grava o cliente\n- O cliente é excluído permanentemente do banco" },
    { nome: "Phase 2", texto: "- a tela chama `POST /clientes` ao salvar" },
    { nome: "skeleton.md", texto: "- clientes.remocao: Clientes são desativados, nunca excluídos" },
  ];
  const achado = (classe: string, problem: string) => ({ classe, where: "Phase 1", problem, fix: "corrija" });

  it("lê as citações entre « », “ ” e aspas duplas", () => {
    expect(citacoes("«um» e “dois” e \"três\"")).toEqual(["um", "dois", "três"]);
  });

  it("CONTRADICTION bloqueia só com as duas passagens existindo nos documentos", () => {
    expect(admitir(achado("CONTRADICTION", "«O cliente é excluído permanentemente do banco» contra «Clientes são desativados, nunca excluídos»"), lugares, []).bloqueia).toBe(true);
    const inventada = admitir(achado("CONTRADICTION", "«O cliente é apagado» contra «Clientes são desativados, nunca excluídos»"), lugares, []);
    expect(inventada.bloqueia).toBe(false);
    expect(inventada.bloqueia ? "" : inventada.motivo).toContain("1 de 2");
  });

  it("INTERFACE bloqueia só com o nome existindo dos dois lados", () => {
    expect(admitir(achado("INTERFACE", "«POST /clientes» é entregue e consumido com corpos diferentes"), lugares, []).bloqueia).toBe(true);
    expect(admitir(achado("INTERFACE", "«GET /clientes» não existe"), lugares, []).bloqueia).toBe(false);
  });

  it("DEPENDENCY bloqueia só com o pacote nos documentos e fora de infrastructure.dependencies", () => {
    const comPacote = [...lugares, { nome: "Phase 3", texto: "- valida o corpo com zod" }];
    expect(admitir(achado("DEPENDENCY", "«zod» é usado e não está declarado"), comPacote, ["pg"]).bloqueia).toBe(true);
    expect(admitir(achado("DEPENDENCY", "«zod» é usado e não está declarado"), comPacote, ["zod"]).bloqueia).toBe(false);
    expect(admitir(achado("DEPENDENCY", "«lodash» é usado"), comPacote, []).bloqueia).toBe(false);
  });

  it("sem classe, ou de outra classe, é observação", () => {
    expect(admitir({ where: "Phase 1", problem: "a regra podia ser mais precisa", fix: "nomeie o alvo" }, lugares, []).bloqueia).toBe(false);
    expect(admitir(achado("OTHER", "«O cliente é excluído permanentemente do banco»"), lugares, []).bloqueia).toBe(false);
  });

  it("o protocolo lê a classe no primeiro campo e continua lendo o achado de três campos", () => {
    const comClasse = parseAudit("CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: contradiction | Phase 2 | «a» contra «b» | troque\nCAPIVARA_REASON: r");
    expect(comClasse.ok && comClasse.verdict.findings[0]).toEqual({ classe: "CONTRADICTION", where: "Phase 2", problem: "«a» contra «b»", fix: "troque" });
    const semClasse = parseAudit("CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 2 | o problema | a correção\nCAPIVARA_REASON: r");
    expect(semClasse.ok && semClasse.verdict.findings[0]).toEqual({ where: "Phase 2", problem: "o problema", fix: "a correção" });
  });
});
