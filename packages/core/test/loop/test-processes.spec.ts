import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTestRunner } from "../../src/loop/gates.js";

let root: string | undefined;
const pids: number[] = [];
afterEach(async () => {
  for (const pid of pids.splice(0)) { try { process.kill(pid, "SIGKILL"); } catch { /* já recolhido */ } }
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function listen(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, ["-e", "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>process.send({port:s.address().port}));"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  pids.push(child.pid!);
  const port = await new Promise<number>((resolve, reject) => { child.once("message", message => resolve((message as { port: number }).port)); child.once("error", reject); });
  return { child, port };
}

async function free(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

describe.skipIf(process.platform === "win32")("contenção da suíte do G2", () => {
  it("suítes simultâneas recebem portas próprias sem disputar o servidor alheio nem alterar o ambiente global", async () => {
    root = await mkdtemp(join(tmpdir(), "capivara-suite-portas-"));
    const outsider = await listen();
    const before = process.env.E2E_PORT;
    const file = join(root, "suite.cjs");
    await writeFile(file, `const net = require('net');const server=net.createServer();
server.on('error', error=>{console.error(error.code);process.exitCode=1});
server.listen(Number(process.env.E2E_PORT)||${outsider.port},'127.0.0.1',()=>{console.log(JSON.stringify({port:server.address().port}));setTimeout(()=>server.close(),150)});
`);
    const results = await Promise.all([defaultTestRunner(`'${process.execPath}' '${file}'`, root), defaultTestRunner(`'${process.execPath}' '${file}'`, root)]);
    for (const result of results) expect(result.exitCode, result.output).toBe(0);
    const ports = results.map(result => (JSON.parse(result.output) as { port: number }).port);
    expect(new Set(ports).size).toBe(2);
    expect(ports).not.toContain(outsider.port);
    expect(await free(outsider.port)).toBe(false);
    expect(process.env.E2E_PORT).toBe(before);
  });

  it.each([0, 7])("recolhe servidor deixado pela suíte com código %s e preserva processo alheio", async code => {
    root = await mkdtemp(join(tmpdir(), "capivara-suite-processos-"));
    const outsider = await listen();
    const file = join(root, "suite.cjs");
    await writeFile(file, `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',"const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>process.send({pid:process.pid,port:s.address().port}));"],{stdio:['ignore','ignore','ignore','ipc']});
child.once('message',info=>{process.stdout.write(JSON.stringify(info));child.disconnect();child.unref();process.exit(${code});});
`);
    const result = await defaultTestRunner(`'${process.execPath}' '${file}'`, root);
    const leaked = JSON.parse(result.output) as { pid: number; port: number };
    pids.push(leaked.pid);
    expect(result.exitCode).toBe(code);
    // A morte do grupo é assíncrona; não depende de o init recolher um zumbi.
    let released = false;
    for (let attempt = 0; attempt < 20 && !released; attempt++) {
      released = await free(leaked.port);
      if (!released) await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(released, `a suíte deixou servidor na porta ${leaked.port}`).toBe(true);
    expect(await free(outsider.port)).toBe(false);
    outsider.child.kill("SIGKILL");
  });
});
