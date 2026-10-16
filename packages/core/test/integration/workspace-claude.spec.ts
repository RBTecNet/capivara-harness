/**
 * A ponte monta o nível workspace do claude de ponta a ponta (§106).
 *
 * O claude falso não decide nada: devolve, no envelope de verdade, o que
 * recebeu — o `TMPDIR`, os `--settings` — e uma negação de permissão, como a
 * CLI real conta. O que se prova aqui é o que é do harness: a raiz certa, o
 * Git certo no `denyWrite`, o temporário próprio que nasce e some com a
 * chamada, e a negação que sobe resumida.
 *
 * O que o SANDBOX faz com isso — rodar `npm`, alcançar a rede, barrar a escrita
 * fora — não se prova com um falso: está nas sondas com a CLI real, registradas
 * no diagnóstico em docs/.
 */

import { execFile } from "node:child_process";
import { chmod, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, createAgentBridge } from "../../src/commands/agent.js";
import type { RoleConfig, RoleName } from "../../src/provider/index.js";

const run = promisify(execFile);
let pasta = "";
const anteriores: Record<string, string | undefined> = {};

beforeEach(async () => {
  pasta = await realpath(await mkdtemp(join(tmpdir(), "capivara-workspace-claude-")));
  for (const chave of ["CAPIVARA_CLAUDE_BIN", "XDG_CACHE_HOME"]) anteriores[chave] = process.env[chave];
});

afterEach(async () => {
  for (const [chave, valor] of Object.entries(anteriores)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  await rm(pasta, { recursive: true, force: true });
});

const FALSO = `#!/usr/bin/env node
let entrada = "";
process.stdin.on("data", (pedaco) => (entrada += pedaco)).on("end", () => {
  const args = process.argv.slice(2);
  const indice = args.indexOf("--settings");
  const fs = require("node:fs");
  const resultado = {
    tmpdir: process.env.TMPDIR ?? null,
    tmpExiste: process.env.TMPDIR ? fs.existsSync(process.env.TMPDIR) : false,
    modo: args[args.indexOf("--permission-mode") + 1],
    settings: indice > -1 ? JSON.parse(args[indice + 1]) : null,
  };
  process.stdout.write(JSON.stringify({
    type: "result",
    is_error: false,
    result: JSON.stringify(resultado),
    permission_denials: [{ tool_name: "Bash", tool_use_id: "x", tool_input: { command: "TOKEN=segredo123 npm publish" } }],
  }));
});
`;

async function ponte(systemInstall: boolean) {
  const binario = join(pasta, "claude-falso");
  await writeFile(binario, FALSO, "utf8");
  await chmod(binario, 0o755);
  process.env.CAPIVARA_CLAUDE_BIN = binario;
  process.env.XDG_CACHE_HOME = join(pasta, "cache");

  const projeto = join(pasta, "projeto");
  await run("git", ["init", "-q", projeto]);
  const config: RoleConfig = { provider: "claude", model: "haiku", effort: "", credential: "", command: "" };
  const roles: Record<RoleName, RoleConfig> = { writer: config, auditor: config, builder: config, verifier: config };
  const bridge = createAgentBridge({ projectRoot: projeto, runId: "build-teste", language: "português do Brasil", roles, limits: DEFAULT_LIMITS, systemInstall });
  const resposta = await bridge({ role: "builder", stage: "implement", prompt: "implemente a fase 1" });
  return { resposta, projeto, visto: JSON.parse(resposta.stdout) as { tmpdir: string | null; tmpExiste: boolean; modo: string; settings: Record<string, any> | null } };
}

describe("o claude no nível workspace, pela ponte", () => {
  it("roda com o sandbox, um TMPDIR só dele fora de /tmp, e o Git do projeto protegido", async () => {
    const { resposta, projeto, visto } = await ponte(false);
    expect(resposta.exitCode).toBe(0);
    expect(visto.modo).toBe("acceptEdits");
    expect(visto.settings?.sandbox.enabled).toBe(true);
    expect(visto.settings?.sandbox.filesystem.denyWrite).toContain(join(projeto, ".git"));

    const temporarios = join(pasta, "cache", "capivara", "tmp");
    expect(visto.tmpdir?.startsWith(`${temporarios}/chamada-`)).toBe(true);
    expect(visto.tmpExiste).toBe(true);
    // E some com a chamada: o que a sessão deixou ali não é do projeto.
    expect(await readdir(temporarios)).toEqual([]);
  });

  it("a negação sobe resumida, sem o segredo do comando", async () => {
    const { resposta } = await ponte(false);
    expect(resposta.negacoes).toEqual(["Bash: npm"]);
    expect(JSON.stringify(resposta.negacoes)).not.toContain("segredo123");
  });

  it("com acesso de sistema, nada disso: sem sandbox e sem temporário próprio", async () => {
    const { visto } = await ponte(true);
    expect(visto.modo).toBe("bypassPermissions");
    expect(visto.settings).toBeNull();
    expect(visto.tmpdir?.startsWith(join(pasta, "cache"))).not.toBe(true);
  });
});
