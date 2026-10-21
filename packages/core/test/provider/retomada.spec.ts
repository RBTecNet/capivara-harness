/**
 * Retomada de sessão do verificador (§125 E; spec §6).
 *
 * Três garantias, cada uma num lugar: o id da sessão vem do envelope da CLI e
 * só passa com forma de id; só a CLI que declara retomada recebe o pedido, com
 * a flag da versão instalada; e a ponte recusa retomar qualquer chamada que
 * não seja o reparo — quem valida nasce sempre numa sessão nova.
 */

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, createAgentBridge } from "../../src/commands/agent.js";
import { CLI_ADAPTERS, buildInvocation, contratoDaRetomada, readTranscript } from "../../src/provider/index.js";
import type { RoleConfig, RoleName } from "../../src/provider/index.js";

const context = {
  projectRoot: "/tmp/projeto",
  runId: "build-abc123abc123",
  stage: "verifier-repair",
  language: "pt-BR",
  environment: {} as NodeJS.ProcessEnv,
};

const config = (provider: string, extra: Partial<RoleConfig> = {}): RoleConfig => ({
  provider, model: provider === "opencode" ? "local/x" : "m", effort: "", credential: "", command: provider === "custom" ? "/bin/true" : "", ...extra,
});

describe("o id da sessão sai do envelope de cada CLI", () => {
  it.each([
    ["codex-jsonl", '{"type":"thread.started","thread_id":"0199a-thread"}\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}', "0199a-thread"],
    ["claude-json", '{"type":"result","is_error":false,"result":"ok","session_id":"5f2c-claude"}', "5f2c-claude"],
    ["cursor-json", '{"type":"result","is_error":false,"result":"ok","session_id":"chat-cursor-1"}', "chat-cursor-1"],
    ["agy-json", '{"response":"ok","conversation_id":"conv-agy-1"}', "conv-agy-1"],
    ["opencode-jsonl", '{"type":"text","sessionID":"ses_opencode1","part":{"type":"text","text":"ok"}}', "ses_opencode1"],
  ] as const)("%s", (kind, stdout, id) => {
    expect(readTranscript(kind, stdout).sessionId).toBe(id);
  });

  it("o texto do agente nunca vira id, e id sem forma de id não passa", () => {
    expect(readTranscript("claude-json", '{"type":"result","result":"session_id: abc-123","session_id":"a b; rm -rf"}').sessionId).toBeUndefined();
    expect(readTranscript("codex-jsonl", '{"type":"item.completed","item":{"type":"agent_message","text":"thread_id abc-999"}}').sessionId).toBeUndefined();
  });
});

describe("só a CLI que declara retomada recebe o pedido", () => {
  it.each([
    ["claude", ["--resume", "sessao-1"]],
    ["cursor", ["--resume", "sessao-1"]],
    ["opencode", ["--session", "sessao-1"]],
    ["agy", ["--conversation", "sessao-1"]],
  ] as const)("%s retoma pela flag da versão instalada", (provider, flags) => {
    const invocation = buildInvocation("verifier", config(provider), { ...context, verifierRepair: true, resumeSessionId: "sessao-1" });
    const at = invocation.args.indexOf(flags[0]);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(invocation.args[at + 1]).toBe(flags[1]);
  });

  it("codex retoma pelo subcomando, com escrita, e nunca retoma uma leitura", () => {
    const reparo = buildInvocation("verifier", config("codex"), { ...context, verifierRepair: true, resumeSessionId: "sessao-1" });
    expect(reparo.args.slice(0, 3)).toEqual(["exec", "resume", "sessao-1"]);
    expect(reparo.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(reparo.args).not.toContain("--sandbox");
    expect(() => buildInvocation("verifier", config("codex"), { ...context, resumeSessionId: "sessao-1" })).toThrow(/nunca para leitura/u);
  });

  it("sem pedido de retomada, a chamada é a mesma de antes", () => {
    for (const provider of ["claude", "codex", "cursor", "opencode", "agy"]) {
      const nova = buildInvocation("verifier", config(provider), { ...context, verifierRepair: true });
      expect(nova.args.join(" ")).not.toMatch(/--resume|--session|--conversation|exec resume/u);
    }
  });

  it("CLI sem retomada declarada recusa o pedido, e id com caractere de shell é recusado antes", () => {
    expect(() => buildInvocation("verifier", config("custom"), { ...context, verifierRepair: true, resumeSessionId: "sessao-1" })).toThrow(/não declara retomada/u);
    expect(() => buildInvocation("verifier", config("claude"), { ...context, verifierRepair: true, resumeSessionId: "x; rm -rf ~" })).toThrow(/sessão inválido/u);
  });

  it("nenhuma CLI se declara garantida sem chamada real; custom e API direta não retomam", () => {
    for (const adapter of CLI_ADAPTERS) {
      const contrato = contratoDaRetomada(adapter.id);
      if (adapter.id === "custom") expect(contrato).toBeNull();
      else expect(contrato?.estado).toBe("nao-verificado");
    }
    expect(contratoDaRetomada("openrouter")).toBeNull();
  });
});

describe("a ponte: só o reparo retoma", () => {
  let raiz = "";
  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "capivara-retomada-"));
  });
  afterEach(async () => {
    delete process.env.CAPIVARA_CLAUDE_BIN;
    await rm(raiz, { recursive: true, force: true });
  });

  async function ponte() {
    const script = join(raiz, "claude-falso");
    // Devolve os próprios argumentos e o id que a CLI teria aberto.
    await writeFile(script, `#!/usr/bin/env node
for await (const chunk of process.stdin) {}
const at = process.argv.indexOf("--resume");
console.log(JSON.stringify({type:"result",is_error:false,result:JSON.stringify(process.argv.slice(2)),session_id: at > 0 ? process.argv[at + 1] : "nova-sessao"}));
`);
    await chmod(script, 0o755);
    process.env.CAPIVARA_CLAUDE_BIN = script;
    const papel: RoleConfig = { provider: "claude", model: "sonnet", effort: "", credential: "", command: "" };
    const roles = { writer: papel, auditor: papel, builder: papel, verifier: papel } as Record<RoleName, RoleConfig>;
    return createAgentBridge({ projectRoot: raiz, runId: "build-teste", language: "pt-BR", roles, limits: DEFAULT_LIMITS });
  }

  it("a leitura do verificador e o executor não podem pedir retomada", async () => {
    const bridge = await ponte();
    await expect(bridge({ role: "verifier", stage: "verify", prompt: "leia", resumeSessionId: "sessao-1" })).rejects.toThrow(/validação é sempre uma sessão nova/u);
    await expect(bridge({ role: "builder", stage: "implement", prompt: "faça", resumeSessionId: "sessao-1" })).rejects.toThrow(/só a sessão de reparo/u);
  });

  it("o reparo leva o id até a CLI e devolve o id que o envelope trouxe", async () => {
    const bridge = await ponte();
    const retomada = await bridge({ role: "verifier", stage: "verifier-repair", prompt: "repare", repair: true, resumeSessionId: "sessao-1" });
    expect(JSON.parse(retomada.stdout) as string[]).toEqual(expect.arrayContaining(["--resume", "sessao-1"]));
    expect(retomada.sessionId).toBe("sessao-1");
    const nova = await bridge({ role: "verifier", stage: "verifier-repair", prompt: "repare", repair: true });
    expect(JSON.parse(nova.stdout) as string[]).not.toContain("--resume");
    expect(nova.sessionId).toBe("nova-sessao");
  });
});
