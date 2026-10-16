/**
 * A raiz que a ponte recebe é o diretório onde a CLI trabalha (§105).
 *
 * No primeiro build paralelo com o Haiku (run `build-f1cd4ae9e525`), o
 * worktree da P01 chegava certo até a ponte, e se perdia ali: o adaptador do
 * claude não passa diretório nenhum, e o processo nascia no cwd de quem rodou
 * a capivara — a árvore principal. O executor escreveu a fase inteira lá, com
 * 25 testes verdes; o verificador, no worktree, achou tudo ausente; três ciclos
 * se foram com o gate 1 dizendo a verdade ("nenhum arquivo alterado").
 *
 * A CLI falsa só IMPRIME o próprio cwd, no envelope do claude: quando o defeito
 * volta, o teste falha sem escrever nada fora da pasta temporária.
 */

import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, createAgentBridge } from "../../src/commands/agent.js";
import type { RoleConfig, RoleName } from "../../src/provider/index.js";

let pasta = "";

beforeEach(async () => {
  pasta = await realpath(await mkdtemp(join(tmpdir(), "capivara-cwd-executor-")));
});

afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

describe("o executor claude trabalha na raiz que a ponte recebeu", () => {
  it("no worktree da fase, não no diretório de quem rodou a capivara", async () => {
    const binario = join(pasta, "claude-falso");
    await writeFile(
      binario,
      `#!/bin/bash\ncat > /dev/null\nprintf '{"type":"result","is_error":false,"result":"%s"}\\n' "$(pwd -P)"\n`,
      "utf8",
    );
    await chmod(binario, 0o755);
    const worktree = join(pasta, "worktree", "P01");
    expect(worktree).not.toBe(process.cwd());

    const config: RoleConfig = { provider: "claude", model: "haiku", effort: "", credential: "", command: "" };
    const roles: Record<RoleName, RoleConfig> = { writer: config, auditor: config, builder: config, verifier: config };
    const anterior = process.env.CAPIVARA_CLAUDE_BIN;
    process.env.CAPIVARA_CLAUDE_BIN = binario;
    try {
      const bridge = createAgentBridge({ projectRoot: worktree, runId: "build-teste", language: "português do Brasil", roles, limits: DEFAULT_LIMITS });
      const resposta = await bridge({ role: "builder", stage: "implement", prompt: "implemente a fase 1" });
      expect(resposta.exitCode).toBe(0);
      expect(resposta.stdout).toBe(worktree);
    } finally {
      if (anterior === undefined) delete process.env.CAPIVARA_CLAUDE_BIN;
      else process.env.CAPIVARA_CLAUDE_BIN = anterior;
    }
  });
});
