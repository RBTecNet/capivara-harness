import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepararExecucao } from "../../src/commands/execucao.js";
import { ARQUIVO_DE_EXECUCAO, gravarArquivoDeExecucao, type FlagsDeExecucao } from "../../src/config/execucao.js";
import { resolveRoles, buildInvocation } from "../../src/provider/index.js";
import { createProgram } from "../../src/cli-program.js";
import { rolesFromFlags } from "../../src/commands/options.js";
import { toArgv } from "../../src/tui/wizard.js";
import { renderDashboard, type DashboardModel } from "../../src/tui/dashboard.js";
import { WorkerTracker, renderWorkerRows } from "../../src/tui/build-workers.js";

const ROLES = resolveRoles({ global: { provider: "codex", model: "gpt-5.5" }, roles: { verifier: { provider: "claude", model: "opus" } } });
const instalado = async (): Promise<boolean> => true;
// O contrato do workspace (§106) conferido como no Linux com bubblewrap e socat no PATH.
const workspace = { platform: "linux" as const, noPath: async (): Promise<boolean> => true };

let raiz: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "capivara-prepara-"));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("a execução que o CLI entrega ao build", () => {
  it.each([true, false])("argv do wizard troca modelo no pool e no processo com salvar=%s", async saveExecution => {
    await gravarArquivoDeExecucao(raiz, { mode: "parallel", maxConcurrency: 3, workers: [{ provider: "opencode", model: "openrouter/antigo", effort: "high" }] });
    const original = await readFile(join(raiz, ARQUIVO_DE_EXECUCAO), "utf8");
    const answers = { command: "build" as const, global: { provider: "opencode", model: "openrouter/novo", effort: "none" }, roles: {}, execution: { mode: "parallel" as const, maxConcurrency: 3, workers: [] }, saveExecution };
    const command = createProgram().commands.find(c => c.name() === "build")!;
    const parsed = command.parseOptions(toArgv(answers).slice(1));
    expect(parsed.unknown).toEqual([]);
    const flags = command.opts<FlagsDeExecucao & { provider: string; model: string; effort: string; saveExecution?: boolean }>();
    const prepared = await prepararExecucao({ projectRoot: raiz, flags, roles: rolesFromFlags(flags), systemInstall: true, instalado });
    if (!prepared.ok) throw new Error(prepared.erros.join("\n"));
    expect(prepared.agentes.map(a => a.config.model)).toEqual(Array(3).fill("openrouter/novo"));
    const tracker = new WorkerTracker(prepared.agentes.map(a => a.label));
    expect(tracker.rows().every(row => row.label.includes("openrouter/novo"))).toBe(true);
    for (const agent of prepared.agentes) {
      const invocation = buildInvocation("builder", agent.config, { projectRoot: raiz, runId: "build-test", stage: "implement", language: "pt-BR", environment: {} });
      expect(invocation.env.CAPIVARA_MODEL).toBe("openrouter/novo");
      expect(invocation.args).toContain("openrouter/novo#none");
    }
    if (flags.saveExecution) await gravarArquivoDeExecucao(raiz, prepared.estrategia);
    if (!saveExecution) expect(await readFile(join(raiz, ARQUIVO_DE_EXECUCAO), "utf8")).toBe(original);
    else {
      expect(JSON.parse(await readFile(join(raiz, ARQUIVO_DE_EXECUCAO), "utf8")).workers).toEqual([]);
      const next = await prepararExecucao({ projectRoot: raiz, flags: {}, roles: resolveRoles({ global: { provider: "opencode", model: "openrouter/proximo" }, roles: {} }), systemInstall: true, instalado });
      expect(next.ok && next.agentes.every(a => a.config.model === "openrouter/proximo")).toBe(true);
    }
  });

  it("projeto sem nada é serial e não diz nada a mais — o build de sempre", async () => {
    const preparada = await prepararExecucao({ projectRoot: raiz, flags: {}, roles: ROLES, systemInstall: true, instalado });
    expect(preparada).toMatchObject({ ok: true, estrategia: { mode: "serial" }, origem: "padrão", agentes: [], resumo: [] });
  });

  it("o paralelo resume modo, agentes, verificador e limitações antes de começar", async () => {
    const preparada = await prepararExecucao({
      projectRoot: raiz,
      flags: { parallel: "3", worker: ["provider=cursor,model=sonnet-4,effort=high", "provider=claude,model=haiku,system-install=no"] },
      roles: ROLES,
      systemInstall: true,
      instalado,
      workspace,
    });
    expect(preparada.ok).toBe(true);
    if (!preparada.ok) return;
    expect(preparada.resumo[0]).toBe("execução: paralela, até 3 agentes ao mesmo tempo (pedida na linha de comando)");
    expect(preparada.resumo).toContain("  agente 1: cursor/sonnet-4 · high");
    expect(preparada.resumo).toContain("  agente 2: claude/haiku · nível workspace, sem acesso de sistema");
    expect(preparada.resumo).toContain("  agente 3: codex/gpt-5.5 (o executor)");
    expect(preparada.resumo.some((linha) => linha.includes("verificador continua um só") && linha.includes("claude/opus"))).toBe(true);
    expect(preparada.resumo.some((linha) => linha.startsWith("limitação: agente 1: cursor"))).toBe(true);
    expect(preparada.agentes.map((agente) => agente.systemInstall)).toEqual([true, false, true]);
  });

  it("agente nunca ganha mais acesso que o build", async () => {
    const preparada = await prepararExecucao({
      projectRoot: raiz,
      flags: { parallel: "2", worker: ["provider=claude,system-install=yes"] },
      roles: resolveRoles({ global: { provider: "claude", model: "haiku" }, roles: {} }),
      systemInstall: false,
      instalado,
      workspace,
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

/*
 * §106: o nível workspace tem um contrato — rodar comandos, alcançar a internet,
 * instalar dependências, não escrever fora do projeto. O provider que
 * comprovadamente não entrega isso é recusado antes da primeira chamada: nem a
 * rede é tirada, nem o acesso é promovido, em silêncio.
 */
describe("o contrato do nível workspace no preflight", () => {
  const CLAUDE = resolveRoles({ global: { provider: "claude", model: "haiku" }, roles: {} });

  // §112: sem sandbox, o executor codex não é recusado no workspace — o acesso amplo é dito.
  it.each(["codex", "cursor", "agy", "opencode"])("serial: executor %s sem acesso de sistema segue, com o acesso amplo dito", async (provider) => {
    const roles = resolveRoles({ global: { provider }, roles: {} });
    const preparada = await prepararExecucao({ projectRoot: raiz, flags: {}, roles, systemInstall: false, instalado, workspace });
    expect(preparada.ok).toBe(true);
    if (!preparada.ok) return;
    expect(preparada.resumo.join("\n")).toContain("acesso amplo ao sistema, à rede e aos arquivos do usuário");
  });

  it.each(["cursor", "agy", "opencode"])("paralelo: %s segue com ou sem acesso de sistema", async (provider) => {
    const workspaceSemSandbox = await prepararExecucao({
      projectRoot: raiz,
      flags: { parallel: "2", worker: [`provider=${provider},system-install=no`] },
      roles: ROLES,
      systemInstall: true,
      instalado,
      workspace,
    });
    expect(workspaceSemSandbox.ok).toBe(true);
    if (workspaceSemSandbox.ok) {
      expect(workspaceSemSandbox.resumo.some((linha) => linha.includes("agente 1:") && linha.includes("acesso amplo ao sistema, à rede e aos arquivos do usuário"))).toBe(true);
    }

    const aceita = await prepararExecucao({
      projectRoot: raiz,
      flags: { parallel: "2", worker: [`provider=${provider},system-install=yes`] },
      roles: ROLES,
      systemInstall: true,
      instalado,
      workspace,
    });
    expect(aceita.ok).toBe(true);
  });

  it("acesso de sistema é decisão explícita do operador: o contrato não se aplica", async () => {
    const preparada = await prepararExecucao({ projectRoot: raiz, flags: {}, roles: ROLES, systemInstall: true, instalado, workspace });
    expect(preparada).toMatchObject({ ok: true, resumo: [] });
  });

  it("claude começa sem bubblewrap, e o resumo diz que o executor tem acesso amplo (§108)", async () => {
    const preparada = await prepararExecucao({
      projectRoot: raiz,
      flags: {},
      roles: CLAUDE,
      systemInstall: false,
      instalado,
      workspace: { platform: "linux", noPath: async () => false },
    });
    expect(preparada.ok).toBe(true);
    if (preparada.ok) expect(preparada.resumo.join("\n")).toContain("acesso amplo ao sistema, à rede e aos arquivos do usuário");
  });

  it("o que não foi verificado segue, e diz que não garante", async () => {
    const preparada = await prepararExecucao({
      projectRoot: raiz,
      flags: { serial: true },
      roles: resolveRoles({ global: { provider: "cursor", model: "sonnet-4" }, roles: {} }),
      systemInstall: false,
      instalado,
      workspace,
    });
    expect(preparada.ok).toBe(true);
    if (!preparada.ok) return;
    expect(preparada.resumo.some((linha) => linha.startsWith("limitação: executor:") && linha.includes("não são garantidos"))).toBe(true);
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
