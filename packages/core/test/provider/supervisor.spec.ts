import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runProvider } from "../../src/provider/index.js";
import type { Invocation } from "../../src/provider/index.js";

function node(script: string): Invocation {
  return { command: process.execPath, args: ["-e", script], env: { ...process.env }, stdinIsPrompt: true };
}

const limits = { firstOutputSeconds: 0, idleSeconds: 0, wallSeconds: 0, maxOutputBytes: 1_000_000, graceMilliseconds: 200 };

describe("runProvider", () => {
  it("entrega o prompt por stdin e devolve a saída", async () => {
    const result = await runProvider({
      invocation: node("let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write('recebi: '+d))"),
      prompt: "o prompt inteiro",
      limits,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("recebi: o prompt inteiro");
    expect(result.timedOut).toBeNull();
  });

  it("propaga o exit code real", async () => {
    const result = await runProvider({ invocation: node("process.exit(3)"), prompt: "", limits });
    expect(result.exitCode).toBe(3);
  });

  it("separa stdout de stderr", async () => {
    const result = await runProvider({
      invocation: node("process.stdout.write('saida');process.stderr.write('erro')"),
      prompt: "",
      limits,
    });
    expect(result.stdout).toBe("saida");
    expect(result.stderr).toBe("erro");
  });

  it("mede o tempo até o primeiro byte", async () => {
    const result = await runProvider({
      invocation: node("setTimeout(()=>process.stdout.write('ok'),120)"),
      prompt: "",
      limits,
    });
    expect(result.firstOutputMilliseconds).toBeGreaterThanOrEqual(80);
  });
});

describe("os três timeouts são distintos", () => {
  it("first-output pega o provider que nunca começou", async () => {
    const result = await runProvider({
      invocation: node("setTimeout(()=>process.stdout.write('tarde demais'),5000)"),
      prompt: "",
      limits: { ...limits, firstOutputSeconds: 0.3 },
    });
    expect(result.timedOut).toBe("first-output");
    expect(result.exitCode).toBe(124);
  }, 15000);

  it("idle pega o provider que começou e travou", async () => {
    const result = await runProvider({
      invocation: node("process.stdout.write('comecei');setTimeout(()=>{},5000)"),
      prompt: "",
      limits: { ...limits, firstOutputSeconds: 5, idleSeconds: 0.4 },
    });
    expect(result.timedOut).toBe("idle");
  }, 15000);

  it("o relógio de ocioso não corre antes da primeira saída", async () => {
    // Armado desde o início, um idle curto mataria este provider aos 0,4s, e o
    // limite de primeira saída — o que deveria mandar aqui — nunca valeria.
    const result = await runProvider({
      invocation: node("setTimeout(()=>process.stdout.write('cheguei'),700)"),
      prompt: "",
      limits: { ...limits, firstOutputSeconds: 5, idleSeconds: 0.4 },
    });
    expect(result.timedOut).toBeNull();
    expect(result.stdout).toContain("cheguei");
  }, 15000);

  it("idle não mata quem continua produzindo saída", async () => {
    const result = await runProvider({
      invocation: node("let n=0;const t=setInterval(()=>{process.stdout.write('.');if(++n>6){clearInterval(t)}},60)"),
      prompt: "",
      limits: { ...limits, idleSeconds: 0.5 },
    });
    expect(result.timedOut).toBeNull();
    expect(result.stdout.length).toBeGreaterThan(5);
  }, 15000);

  it("wall pega o provider que trabalha para sempre", async () => {
    const result = await runProvider({
      invocation: node("setInterval(()=>process.stdout.write('.'),50)"),
      prompt: "",
      limits: { ...limits, idleSeconds: 5, wallSeconds: 0.5 },
    });
    expect(result.timedOut).toBe("wall");
  }, 15000);
});

describe("contenção", () => {
  it("mata a árvore inteira: nenhum neto sobrevive ao timeout", async () => {
    const script = [
      "const {spawn}=require('node:child_process');",
      "const neto=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
      "process.stdout.write('NETO:'+neto.pid+'\\n');",
      "setInterval(()=>{},1000);",
    ].join("");

    const result = await runProvider({
      invocation: node(script),
      prompt: "",
      limits: { ...limits, wallSeconds: 0.5, graceMilliseconds: 100 },
    });

    expect(result.timedOut).toBe("wall");
    const pid = Number(/NETO:(\d+)/.exec(result.stdout)?.[1]);
    expect(Number.isInteger(pid)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const vivo = (() => {
      try {
        execFileSync("ps", ["-p", String(pid)], { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    })();
    expect(vivo, `o neto ${pid} sobreviveu ao timeout`).toBe(false);
  }, 20000);

  it("o teto de bytes encerra o processo e marca truncado", async () => {
    const result = await runProvider({
      invocation: node("const l='x'.repeat(10000);setInterval(()=>process.stdout.write(l),1)"),
      prompt: "",
      limits: { ...limits, maxOutputBytes: 50_000, wallSeconds: 5 },
    });
    expect(result.truncated).toBe(true);
  }, 15000);

  it("um AbortSignal encerra a execução", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await runProvider({
      invocation: node("setInterval(()=>{},1000)"),
      prompt: "",
      limits: { ...limits, wallSeconds: 10 },
      signal: controller.signal,
    });
    expect(result.durationMilliseconds).toBeLessThan(5000);
  }, 15000);

  it("comando inexistente devolve 127 em vez de explodir", async () => {
    const result = await runProvider({
      invocation: { command: "/nao/existe/binario", args: [], env: {}, stdinIsPrompt: true },
      prompt: "",
      limits,
    });
    expect(result.exitCode).toBe(127);
  });
});

describe("segredos", () => {
  it("a saída é redigida com o ambiente da própria invocação", async () => {
    const result = await runProvider({
      invocation: {
        command: process.execPath,
        args: ["-e", "process.stdout.write('vazou: '+process.env.OPENAI_API_KEY)"],
        env: { ...process.env, OPENAI_API_KEY: "sk-supersecretovalor" },
        stdinIsPrompt: true,
      },
      prompt: "",
      limits,
    });
    expect(result.stdout).not.toContain("sk-supersecretovalor");
    expect(result.stdout).toContain("[REDACTED:OPENAI_API_KEY]");
  });
});
