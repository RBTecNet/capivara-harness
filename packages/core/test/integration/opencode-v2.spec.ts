import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentBridge, DEFAULT_LIMITS } from "../../src/commands/agent.js";
import type { RoleConfig, RoleName } from "../../src/provider/index.js";
import { saveCredential } from "../../src/provider/credentials.js";
import * as provider from "../../src/provider/index.js";
import type { RunOptions } from "../../src/provider/index.js";

let directory = "";

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "capivara-opencode-v2-")));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

// Contrato de opencode 2.0.32 run --help: --dir e --variant não existem.
// O processo recebe stdin e cwd reais, e responde no envelope capturado da CLI.
const CLI = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.shift() !== "run") process.exit(2);
const flags = new Map([["--standalone", false], ["--auto", false], ["--format", true], ["--model", true]]);
const parsed = {};
while (args.length) {
  const flag = args.shift();
  if (!flags.has(flag)) {
    process.stderr.write("Unrecognized flag: " + flag + " in command opencode run");
    process.exit(1);
  }
  parsed[flag] = flags.get(flag) ? args.shift() : true;
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
// Comportamento observado em runNonInteractive da CLI 2.0.32.
process.chdir(process.env.PWD ?? process.cwd());
const text = JSON.stringify({cwd: process.cwd(), prompt, flags: parsed, permission: JSON.parse(process.env.OPENCODE_PERMISSION)});
console.log(JSON.stringify({type: "text", sessionID: "ses_test", part: {type: "text", text}}));
`;

describe.skipIf(process.platform === "win32")("OpenCode 2 pela ponte", () => {
  it.each(["opencode", "claude"])("%s: autoria e triagem não encurtam a sessão por sua finalidade", async cli => {
    const requests: RunOptions[] = [];
    const supervisor = vi.spyOn(provider, "runProvider").mockImplementation(async request => {
      requests.push(request);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: null, truncated: false, firstOutputMilliseconds: null, durationMilliseconds: 0 };
    });
    try {
      const config: RoleConfig = { provider: cli, model: "local/test", effort: "", credential: "", command: "" };
      for (const wallSeconds of [0, 900, 3600]) {
        const limits = { ...DEFAULT_LIMITS, wallSeconds };
        const bridge = createAgentBridge({ projectRoot: directory, runId: "g4", language: "pt-BR", credentialsFile: join(directory, "credentials.json"),
          roles: { writer: config, auditor: config, builder: config, verifier: config }, limits });
        for (const purpose of ["flow-author", "flow-triage"] as const) {
          await bridge({ role: "verifier", purpose, stage: purpose, prompt: "Ler as fontes e devolver a correção." });
          expect(requests.at(-1)?.limits).toEqual({ ...limits,
            ...(cli === "claude" ? { firstOutputSeconds: 0, idleSeconds: 0 } : {}),
          });
        }
      }
    } finally { supervisor.mockRestore(); }
  });

  it.each([
    { type: "provider.quota", status: 402, failure: "quota" },
    { type: "provider.no-route", status: 400, failure: "configuration" },
  ])("$type: configura teto, conserva contexto e entrega recusa apesar de exit 0", async ({ type, status, failure }) => {
    const binary = join(directory, "opencode-recusa.mjs");
    const captured = join(directory, "capture.json");
    await writeFile(binary, `#!${process.execPath}
import { writeFileSync } from 'node:fs';
for await (const c of process.stdin) {}
if(process.argv[2]==='api'){
  console.log(JSON.stringify({data:[{providerID:'openrouter',id:'moonshotai/kimi-k3',limit:{context:1048576,input:900000,output:943718}}]}));
} else {
  writeFileSync(${JSON.stringify(captured)},process.env.OPENCODE_CONFIG_CONTENT);
  console.log(JSON.stringify({type:'text',part:{type:'text',text:'CAPIVARA_BUILDER_STATUS: COMPLETE'}}));
  console.log(JSON.stringify({type:'error',error:{type:${JSON.stringify(type)},status:${status},message:'recusa explícita',response:{body:'privado'}}}));
}
`);
    await chmod(binary, 0o755);
    vi.stubEnv("CAPIVARA_OPENCODE_BIN", binary);
    vi.stubEnv("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX", "");
    vi.stubEnv("OPENCODE_CONFIG_CONTENT", "");
    const config: RoleConfig = { provider: "opencode", model: "openrouter/moonshotai/kimi-k3", effort: "none", credential: "", command: "" };
    const bridge = createAgentBridge({ projectRoot: directory, runId: "build-recusa", language: "pt-BR", credentialsFile: join(directory, "credentials.json"), roles: { writer: config, auditor: config, builder: config, verifier: config }, limits: DEFAULT_LIMITS });
    const response = await bridge({ role: "builder", stage: "implement", prompt: "Teste" });
    expect(response).toMatchObject({ exitCode: 1, resultRead: false, engineError: true, providerFailure: failure });
    expect(response.stdout).toContain("recusa explícita");
    expect(response.stdout).not.toContain("privado");
    expect(response.stdout).not.toContain("COMPLETE");
    const capturedConfig = JSON.parse(await readFile(captured, "utf8"));
    expect(capturedConfig.provider.openrouter.models["moonshotai/kimi-k3"].limit).toEqual({ context: 1048576, input: 900000, output: 16384 });
  });

  it("falha na consulta não permite uma inferência com teto máximo nem expõe stderr privado", async () => {
    const binary = join(directory, "opencode-sem-metadados.mjs");
    const captured = join(directory, "commands.txt");
    await writeFile(binary, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nfor await(const c of process.stdin){}\nappendFileSync(${JSON.stringify(captured)},process.argv[2]+'\\n');process.stderr.write('segredo privado');process.exit(1);\n`);
    await chmod(binary, 0o755);
    vi.stubEnv("CAPIVARA_OPENCODE_BIN", binary);
    const config: RoleConfig = { provider: "opencode", model: "openrouter/model", effort: "", credential: "", command: "" };
    const bridge = createAgentBridge({ projectRoot: directory, runId: "build-meta", language: "pt-BR", credentialsFile: join(directory, "credentials.json"), roles: { writer: config, auditor: config, builder: config, verifier: config }, limits: DEFAULT_LIMITS });
    await expect(bridge({ role: "builder", stage: "implement", prompt: "Teste" })).rejects.toThrow("não foi possível conferir os limites");
    expect(await readFile(captured, "utf8")).toBe("api\n");
  });

  it("transmite ferramentas e testes ao painel antes de encerrar a sessão", async () => {
    const binary = join(directory, "opencode-atividade.mjs");
    const events = [
      { type: "tool_use", part: { type: "tool", tool: "write", state: { status: "completed", input: { path: "backend/src/server.ts", content: "conteúdo privado" } } } },
      { type: "tool_use", part: { type: "tool", tool: "shell", state: { status: "completed", input: { command: "npm test" }, output: "Tests 2 failed | 62 passed (64)\nError: EADDRINUSE: address already in use" } } },
      { type: "text", part: { type: "text", messageID: "final", text: "concluído" } },
    ];
    await writeFile(binary, `#!${process.execPath}\nfor await (const c of process.stdin) {}\nif(process.argv[2]==="api"){console.log(JSON.stringify({data:[{id:"model",providerID:"openrouter",limit:{context:100000,output:65536}}]}));process.exit(0);}\nconst events=${JSON.stringify(events)};\nfor (const event of events) { const line=JSON.stringify(event)+'\\n'; process.stdout.write(line.slice(0,17)); await new Promise(r=>setTimeout(r,10));process.stdout.write(line.slice(17)); }\nawait new Promise(r=>setTimeout(r,40));\n`);
    await chmod(binary, 0o755);
    vi.stubEnv("CAPIVARA_OPENCODE_BIN", binary);
    const config: RoleConfig = { provider: "opencode", model: "openrouter/model", effort: "none", credential: "", command: "" };
    const bridge = createAgentBridge({ projectRoot: directory, runId: "build", language: "pt-BR", roles: { writer: config, auditor: config, builder: config, verifier: config }, limits: DEFAULT_LIMITS });
    const activity: string[] = [];
    const raw: string[] = [];
    let calling = true;
    const response = await bridge({ role: "builder", stage: "implement", prompt: "Teste", onActivity: line => {
      expect(calling).toBe(true);
      activity.push(line);
    }, onOutput: chunk => raw.push(chunk) });
    calling = false;
    expect(activity.join("\n")).toContain("backend/src/server.ts");
    expect(activity.join("\n")).toContain("62 passaram");
    expect(activity.join("\n")).toContain("EADDRINUSE");
    expect(activity.join("\n")).not.toContain("conteúdo privado");
    expect(raw.join("")).toContain('"type":"tool_use"');
    expect(response).toMatchObject({ stdout: "concluído", exitCode: 0, resultRead: true });
  });
  it.each([
    { role: "builder" as const, repair: false },
    { role: "verifier" as const, repair: false },
    { role: "verifier" as const, repair: true },
  ])("$role (repair=$repair): repassa só a chave salva do provider do modelo", async ({ role, repair }) => {
    const file = join(directory, "credentials.json");
    await saveCredential({ id: "deepseek", label: "principal", provider: "deepseek", secret: "sk-deepseek-apenas-teste", default: true, createdAt: "agora" }, file);
    await saveCredential({ id: "openrouter", label: "principal", provider: "openrouter", secret: "sk-openrouter-apenas-teste", default: true, createdAt: "agora" }, file);
    const binary = join(directory, "opencode-api.mjs");
    await writeFile(binary, `#!${process.execPath}\nlet prompt = "";for await(const c of process.stdin)prompt+=c;\nconst args=process.argv.slice(2);\nconst text=JSON.stringify({hasSelectedKey:process.env.DEEPSEEK_API_KEY==="sk-deepseek-apenas-teste",hasOtherSavedKey:process.env.OPENROUTER_API_KEY==="sk-openrouter-apenas-teste",model:args[args.indexOf("--model")+1],permission:JSON.parse(process.env.OPENCODE_PERMISSION),cwd:process.cwd()});\nconsole.log(JSON.stringify({type:"text",part:{type:"text",text}}));\n`);
    await chmod(binary, 0o755);
    vi.stubEnv("CAPIVARA_OPENCODE_BIN", binary);
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const config: RoleConfig = { provider: "opencode", model: "deepseek/deepseek-flash", effort: "high", credential: "", command: "" };
    const bridge = createAgentBridge({ projectRoot: directory, runId: "build-api", language: "pt-BR", roles: { writer: config, auditor: config, builder: config, verifier: config }, limits: DEFAULT_LIMITS, credentialsFile: file });
    const response = await bridge({ role, repair, stage: "implement", prompt: "Teste." });
    expect(response.exitCode).toBe(0);
    expect(JSON.parse(response.stdout)).toEqual({ hasSelectedKey: true, hasOtherSavedKey: false, model: "deepseek/deepseek-flash#high", permission: role === "builder" || repair ? { "*": "allow" } : expect.objectContaining({ "*": "deny", read: "allow", edit: "deny", bash: "deny", task: "deny", external_directory: "deny" }), cwd: directory });
    expect(response.stdout).not.toContain("sk-deepseek");
  });

  it.each([
    { role: "writer" as const, repair: false },
    { role: "auditor" as const, repair: false },
    { role: "builder" as const, repair: false },
    { role: "verifier" as const, repair: false },
    { role: "verifier" as const, repair: true },
  ])("$role (repair=$repair): aceita as flags, o diretório e o prompt por stdin", async ({ role, repair }) => {
    const readOnly = role !== "builder" && !repair;
    const binary = join(directory, "opencode.mjs");
    await writeFile(binary, CLI);
    await chmod(binary, 0o755);
    vi.stubEnv("CAPIVARA_OPENCODE_BIN", binary);
    vi.stubEnv("PWD", directory);
    const config: RoleConfig = { provider: "opencode", model: "opencode/modelo", effort: "high", credential: "", command: "" };
    const roles: Record<RoleName, RoleConfig> = { writer: config, auditor: config, builder: config, verifier: config };
    const projectRoot = join(directory, "projeto com espaço");
    const bridge = createAgentBridge({ projectRoot, runId: "init-opencode-v2", language: "pt-BR", roles, limits: DEFAULT_LIMITS });
    const response = await bridge({ role, repair, stage: "skeleton", prompt: "Responda apenas PONG." });

    expect(response.exitCode, response.stderr).toBe(0);
    expect(response.resultRead).toBe(true);
    expect(JSON.parse(response.stdout)).toEqual({
      cwd: projectRoot,
      prompt: "Responda apenas PONG.",
      flags: {
        "--standalone": true,
        "--format": "json",
        "--model": "opencode/modelo#high",
        ...(readOnly ? {} : { "--auto": true }),
      },
      permission: readOnly
        ? expect.objectContaining({ "*": "deny", read: "allow", edit: "deny", bash: "deny", task: "deny", external_directory: "deny" })
        : { "*": "allow" },
    });
  });
});
