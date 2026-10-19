import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProvider } from "../../src/provider/index.js";

const pids: number[] = [];
let directory: string | undefined;
afterEach(async () => {
  for (const pid of pids.splice(0)) { try { process.kill(pid, "SIGKILL"); } catch { /* recolhido */ } }
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
const free = (port: number): Promise<boolean> => new Promise(resolve => {
  const server = createServer();
  server.on("error", () => resolve(false));
  server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
});

describe.skipIf(process.platform !== "linux")("cancelamento do OpenCode standalone", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("o binário real trata %s e encerra o servidor privado", async signal => {
    directory = await mkdtemp(join(tmpdir(), "capivara-cancel-cli-"));
    const binary = join(directory, "opencode.mjs");
    const infoPath = join(directory, "session.json");
    await writeFile(binary, `#!${process.execPath}
import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
for await(const c of process.stdin){}
const server=spawn(process.execPath,['-e',"const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:s.address().port}));"],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
server.once('message',info=>{writeFileSync(process.env.CAPIVARA_CANCEL_TEST_INFO,JSON.stringify(info));server.disconnect();server.unref();});setInterval(()=>{},1000);
`);
    await chmod(binary, 0o755);
    const child = spawn(process.execPath, [resolve("dist/cli.js"), "init", "um app de tarefas", "--provider", "opencode", "--model", "opencode/test", "--project", directory, "--no-dashboard", "--no-modal"], { env: { ...process.env, CAPIVARA_CONFIG_DIR: directory, CAPIVARA_OPENCODE_BIN: binary, CAPIVARA_CANCEL_TEST_INFO: infoPath }, stdio: ["ignore", "ignore", "pipe"] });
    pids.push(child.pid!);
    const ended = new Promise<number | null>((resolveEnd, reject) => { child.once("exit", code => resolveEnd(code)); child.once("error", reject); });
    let info: { pid: number; port: number } | undefined;
    let stderr = "";
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    for (let n = 0; n < 100 && !info; n++) {
      try { info = JSON.parse(await readFile(infoPath, "utf8")); } catch { await new Promise(resolveWait => setTimeout(resolveWait, 25)); }
    }
    expect(info, stderr).toBeDefined();
    pids.push(info!.pid);
    child.kill(signal);
    expect(await ended).toBe(signal === "SIGINT" ? 130 : 143);
    let released = false;
    for (let n = 0; n < 20 && !released; n++) { released = await free(info!.port); if (!released) await new Promise(resolveWait => setTimeout(resolveWait, 25)); }
    expect(released).toBe(true);
  });

  it("AbortSignal recolhe filho em grupo separado e preserva processo externo", async () => {
    const outsider = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    pids.push(outsider.pid!);
    const script = `const {spawn}=require('node:child_process');
const server=spawn(process.execPath,['-e',"const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:s.address().port}));"],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
server.once('message',info=>{process.stdout.write(JSON.stringify(info)+'\\n');server.disconnect();server.unref();});setInterval(()=>{},1000);`;
    const controller = new AbortController();
    let ready!: (value: { pid: number; port: number }) => void;
    const started = new Promise<{ pid: number; port: number }>(resolve => { ready = resolve; });
    let output = "";
    const pending = runProvider({ invocation: { command: process.execPath, args: ["-e", script], env: { ...process.env, CAPIVARA_PROVIDER: "opencode" }, cwd: process.cwd(), streams: true, stdinIsPrompt: true }, prompt: "", limits: { firstOutputSeconds: 0, idleSeconds: 0, wallSeconds: 10, maxOutputBytes: 100000, graceMilliseconds: 50 }, signal: controller.signal, onOutput: (text, stream) => {
      if (stream !== "out") return;
      output += text;
      if (output.includes("\n")) ready(JSON.parse(output.trim()));
    } });
    const owned = await started;
    pids.push(owned.pid);
    controller.abort();
    const result = await pending;
    expect(result.exitCode).not.toBe(0);
    let released = false;
    for (let n = 0; n < 20 && !released; n++) { released = await free(owned.port); if (!released) await new Promise(resolve => setTimeout(resolve, 25)); }
    expect(released, "o servidor privado continuou após o cancelamento").toBe(true);
    expect(() => process.kill(outsider.pid!, 0)).not.toThrow();
  });
});
