/**
 * A costura entre a ponte e o gate 0.
 *
 * Os dois lados tinham teste e os dois estavam verdes. O defeito morava no meio:
 * a ponte desembrulha o envelope da CLI e entrega texto, e o gate 0 procurava o
 * envelope dentro desse texto. Toda volta BEM-SUCEDIDA do claude era reprovada,
 * e as reprovações legítimas passavam no teste unitário porque ali o envelope
 * era passado à mão — uma entrada que a produção nunca produz.
 *
 * Por isso este arquivo exercita os dois juntos, com uma CLI falsa que fala o
 * mesmo formato da de verdade. É o cenário do `cron5`: executor entrega a fase,
 * declara conclusão, e o loop precisa aceitar.
 */

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, createAgentBridge } from "../../src/commands/agent.js";
import { declaredComplete, gate0 } from "../../src/loop/index.js";
import type { RoleConfig, RoleName } from "../../src/provider/index.js";

let raiz = "";

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "capivara-envelope-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

const RESPOSTA = "Implementei a Fase 1 completa.\n\nCAPIVARA_BUILDER_STATUS: COMPLETE";

/** Uma CLI falsa que responde com o envelope do claude e nada mais. */
async function cliFalsa(corpo: string): Promise<string> {
  const caminho = join(raiz, "claude-falso");
  await writeFile(caminho, `#!/bin/bash\ncat > /dev/null\ncat <<'JSON'\n${corpo}\nJSON\n`, "utf8");
  await chmod(caminho, 0o755);
  return caminho;
}

function papeis(binario: string): { roles: Record<RoleName, RoleConfig>; env: NodeJS.ProcessEnv } {
  const config: RoleConfig = { provider: "claude", model: "sonnet", effort: "", credential: "", command: "" };
  return {
    roles: { writer: config, auditor: config, builder: config, verifier: config },
    env: { ...process.env, CAPIVARA_CLAUDE_BIN: binario },
  };
}

async function chamar(corpo: string) {
  const { roles, env } = papeis(await cliFalsa(corpo));
  const anterior = process.env.CAPIVARA_CLAUDE_BIN;
  process.env.CAPIVARA_CLAUDE_BIN = env.CAPIVARA_CLAUDE_BIN;
  try {
    const bridge = createAgentBridge({
      projectRoot: raiz,
      runId: "build-teste",
      language: "português do Brasil",
      roles,
      limits: DEFAULT_LIMITS,
    });
    return await bridge({ role: "builder", stage: "implement", prompt: "implemente a fase 1" });
  } finally {
    if (anterior === undefined) delete process.env.CAPIVARA_CLAUDE_BIN;
    else process.env.CAPIVARA_CLAUDE_BIN = anterior;
  }
}

describe("o envelope da CLI atravessa a ponte até o gate 0", () => {
  it("volta bem-sucedida do claude passa no gate 0 e declara conclusão", async () => {
    const resposta = await chamar(
      JSON.stringify({ type: "result", is_error: false, result: RESPOSTA, usage: { input_tokens: 10, output_tokens: 5 } }),
    );

    // A ponte entrega o texto, não o envelope: é isso que o gate 0 recebe.
    expect(resposta.stdout).toBe(RESPOSTA);
    expect(resposta.stdout).not.toContain('"type"');
    expect(declaredComplete(resposta.stdout)).toBe(true);

    const g0 = gate0(resposta, "claude");
    expect(g0.green).toBe(true);
  });

  it("erro declarado pela CLI reprova, e a causa traz o envelope", async () => {
    const resposta = await chamar(JSON.stringify({ type: "result", is_error: true, result: "sessão interrompida" }));

    const g0 = gate0(resposta, "claude");
    if (g0.green) throw new Error("deveria reprovar");
    expect(g0.cause).toContain("reportou a volta como erro");
    expect(g0.cause).toContain("sessão interrompida");
  });

  it("saída sem envelope nenhum reprova por falta de resultado", async () => {
    const resposta = await chamar("o processo morreu antes de responder");

    expect(resposta.resultRead).toBe(false);
    const g0 = gate0(resposta, "claude");
    if (g0.green) throw new Error("deveria reprovar");
    expect(g0.cause).toContain("sem emitir um resultado");
  });
});
