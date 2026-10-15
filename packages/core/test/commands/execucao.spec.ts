import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepararExecucao } from "../../src/commands/execucao.js";
import { ARQUIVO_DE_EXECUCAO, gravarArquivoDeExecucao } from "../../src/config/execucao.js";
import { resolveRoles } from "../../src/provider/index.js";
import { renderDashboard, type DashboardModel } from "../../src/tui/dashboard.js";
import { WorkerTracker, renderWorkerRows } from "../../src/tui/build-workers.js";

const ROLES = resolveRoles({ global: { provider: "codex", model: "gpt-5.5" }, roles: { verifier: { provider: "claude", model: "opus" } } });
const instalado = async (): Promise<boolean> => true;

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "capivara-prepara-"));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("a execução que o CLI entrega ao build", () => {
  it("projeto sem nada é serial e não diz nada a mais — o build de sempre", async () => {
    const preparada = await prepararExecucao({ projectRoot: raiz, flags: {}, roles: ROLES, systemInstall: true, instalado });
    expect(preparada).toMatchObject({ ok: true, estrategia: { mode: "serial" }, origem: "padrão", agentes: [], resumo: [] });
  });

  it("o paralelo resume modo, agentes, verificador e limitações antes de começar", async () => {
    const preparada = await prepararExecucao({
      projectRoot: raiz,
      flags: { parallel: "3", worker: ["provider=cursor,model=sonnet-4,effort=high", "provider=codex,system-install=no"] },
      roles: ROLES,
      systemInstall: true,
      instalado,
    });
    expect(preparada.ok).toBe(true);
    if (!preparada.ok) return;
    expect(preparada.resumo[0]).toBe("execução: paralela, até 3 agentes ao mesmo tempo (pedida na linha de comando)");
    expect(preparada.resumo).toContain("  agente 1: cursor/sonnet-4 · high");
    expect(preparada.resumo).toContain("  agente 2: codex/gpt-5.5 · sem instalar no sistema");
    expect(preparada.resumo).toContain("  agente 3: codex/gpt-5.5 (o executor)");
    expect(preparada.resumo.some((linha) => linha.includes("verificador continua um só") && linha.includes("claude/opus"))).toBe(true);
    expect(preparada.resumo.some((linha) => linha.startsWith("limitação: agente 1: cursor"))).toBe(true);
    expect(preparada.agentes.map((agente) => agente.systemInstall)).toEqual([true, false, true]);
  });

  it("agente nunca ganha mais acesso que o build", async () => {
    const preparada = await prepararExecucao({
      projectRoot: raiz,
      flags: { parallel: "2", worker: ["provider=codex,system-install=yes"] },
      roles: ROLES,
      systemInstall: false,
      instalado,
    });
    expect(preparada.ok && preparada.agentes.map((agente) => agente.systemInstall)).toEqual([false, false]);
  });

  it("provider indisponível para antes de qualquer chamada", async () => {
    const preparada = await prepararExecucao({
      projectRoot: raiz,
      flags: { parallel: "2", worker: ["agy"] },
      roles: ROLES,
      systemInstall: true,
      instalado: async (provider) => provider !== "agy",
    });
    expect(preparada.ok).toBe(false);
    if (!preparada.ok) expect(preparada.erros.join("\n")).toContain("agy não está instalado");
  });

  it("o arquivo salvo vale sem flag, e --serial vence o arquivo", async () => {
    await gravarArquivoDeExecucao(raiz, { mode: "parallel", maxConcurrency: 2, workers: [] });
    const doArquivo = await prepararExecucao({ projectRoot: raiz, flags: {}, roles: ROLES, systemInstall: true, instalado });
    expect(doArquivo.ok && doArquivo.resumo[0]).toBe(`execução: paralela, até 2 agentes ao mesmo tempo (de ${ARQUIVO_DE_EXECUCAO})`);

    const serial = await prepararExecucao({ projectRoot: raiz, flags: { serial: true }, roles: ROLES, systemInstall: true, instalado });
    expect(serial).toMatchObject({ ok: true, estrategia: { mode: "serial" }, resumo: ["execução: serial, uma fase por vez (pedida na linha de comando)"] });
  });

  it("arquivo malformado sem flag não começa", async () => {
    await mkdir(join(raiz, ".capivara"), { recursive: true });
    await writeFile(join(raiz, ARQUIVO_DE_EXECUCAO), JSON.stringify({ version: 1, mode: "parallel", maxConcurrency: 40 }), "utf8");
    const preparada = await prepararExecucao({ projectRoot: raiz, flags: {}, roles: ROLES, systemInstall: true, instalado });
    expect(preparada.ok).toBe(false);
  });
});

describe("os agentes na tela", () => {
  const style = { enabled: false } as const;

  it("cada agente diz a fase que pegou, e o livre diz o último desfecho", () => {
    const agentes = new WorkerTracker(["codex/gpt-5.5", "claude/opus"]);
    agentes.apply({ slot: 0, state: "trabalhando", phaseId: "P02", detail: "" });
    agentes.apply({ slot: 1, state: "livre", phaseId: null, detail: "P03 integrada" });
    const linhas = renderWorkerRows(
      agentes.rows(),
      [{ id: "P02", title: "Cadastro", state: "em andamento", gates: {}, detail: "ciclo 2/3" }],
      100,
      style,
    );
    expect(linhas[0]).toMatch(/1 codex\/gpt-5\.5\s+● trabalhando P02 Cadastro · ciclo 2\/3/);
    expect(linhas[1]).toMatch(/2 claude\/opus\s+○ livre\s+último: P03 integrada/);
  });

  it("o painel do build paralelo ganha a caixa AGENTES; o serial não", () => {
    const base: DashboardModel = {
      version: "0",
      command: "build",
      subtitle: "",
      project: "p",
      stage: "",
      status: { label: "rodando", state: "em andamento" },
      durationSeconds: 0,
      pipeline: [],
      provider: { perfil: "", transporte: "", contabilidade: "" },
      telemetry: [],
      events: [],
      activity: { kind: "modelo", detail: "", sinceSeconds: 0 },
      style,
      width: 100,
    };
    expect(renderDashboard(base)).not.toContain("AGENTES");
    const agentes = new WorkerTracker(["codex", "codex"]);
    agentes.apply({ slot: 0, state: "integrando", phaseId: "P02", detail: "" });
    expect(renderDashboard({ ...base, workers: agentes.rows() })).toContain("AGENTES · 1 de 2 ocupados");
  });
});
