/** Prepara o que já está declarado; não inicia a construção para descobrir instalação quebrada. */
import { dependenciasAusentes } from "./dependencias.js";
import { inspecionarInstalacaoNode, registrarInstalacaoNode } from "./instalacao-node.js";
import { comandoDeInstalacao } from "./worktree.js";
import type { TestRun, TestRunner } from "./gates.js";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ferramentasDaMaquina } from "./passagem.js";

const quote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'";

export async function prepareBuildEnvironment(root: string, runner: TestRunner, announce: (message: string) => void, options: { browser?: boolean; systemInstall?: boolean } = {}): Promise<{ ok: boolean; evidence: string }> {
  root = resolve(root);
  const evidence: string[] = [];
  const installation = await inspecionarInstalacaoNode(root);
  const commands: string[] = [];
  if (installation.estado === "ausente" || installation.estado === "incompativel") commands.push(await comandoDeInstalacao(root));
  for (const missing of await dependenciasAusentes(root)) {
    if (missing.manifesto !== "package.json") commands.push(missing.comando);
  }
  for (const command of commands) {
    announce(`preparando ambiente antes da construção: ${command}`);
    const result = await runner(command, root).catch((error: unknown) => ({ exitCode: 1, output: error instanceof Error ? error.message : String(error) }));
    evidence.push(`$ ${command}\nexit: ${result.exitCode}\n${result.output}`);
    if (result.exitCode !== 0) return { ok: false, evidence: evidence.join("\n\n") };
  }
  await registrarInstalacaoNode(root);
  if (options.browser) {
    const execute = async (command: string): Promise<TestRun> => {
      const result = await runner(command, root).catch((error: unknown) => ({ exitCode: 1, output: String(error) }));
      evidence.push(`$ ${command}\nexit: ${result.exitCode}\n${result.output}`);
      return result;
    };
    const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
    const local = join(root, "node_modules/@playwright/test");
    const tools = join(root, ".capivara/node_modules/@playwright/test");
    let selected = await exists(tools) ? tools : await exists(local) ? local : tools;
    if (!(await exists(selected))) {
      announce("preparando ferramenta do G4 antes do desenvolvimento, fora do manifesto do produto");
      if ((await execute("npm install --prefix .capivara --no-save --package-lock=false --no-audit --no-fund @playwright/test")).exitCode !== 0) return { ok: false, evidence: evidence.join("\n\n") };
      selected = tools;
    }
    const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? ferramentasDaMaquina(process.env).PLAYWRIGHT_BROWSERS_PATH!;
    const prefix = `PLAYWRIGHT_BROWSERS_PATH=${quote(browsers)} `;
    const script = "const {chromium}=require(process.argv[1]);chromium.launch({headless:true,timeout:15000}).then(b=>b.close()).catch(e=>{console.error(e.message);process.exitCode=1})";
    const probe = `${prefix}${quote(process.execPath)} -e ${quote(script)} ${quote(selected)}`;
    announce("verificando Chromium headless uma vez, antes do desenvolvimento");
    const cli = `${prefix}${quote(process.execPath)} ${quote(join(selected, "cli.js"))}`;
    let checked = await execute(probe);
    // Um erro de resolução/código não significa dependência de sistema ausente.
    // Primeiro baixar apenas o executável, quando o próprio Playwright o pede.
    if (checked.exitCode !== 0 && /Executable doesn't exist at/i.test(checked.output)) {
      announce("Chromium ausente; baixando o navegador antes do desenvolvimento");
      if ((await execute(`${cli} install chromium`)).exitCode !== 0) return { ok: false, evidence: evidence.join("\n\n") };
      checked = await execute(probe);
    }
    // Só este diagnóstico autoriza apt/dpkg, e somente com a permissão já dada.
    // Cada reparo roda no máximo uma vez; a sonda final precisa iniciar de fato.
    if (checked.exitCode !== 0 && /Host system is missing dependencies|error while loading shared libraries:/i.test(checked.output) && options.systemInstall) {
      announce("Chromium precisa de bibliotecas do sistema; preparando antes do desenvolvimento");
      if ((await execute(`${cli} install-deps chromium`)).exitCode !== 0) return { ok: false, evidence: evidence.join("\n\n") };
      checked = await execute(probe);
    }
    if (checked.exitCode !== 0) return { ok: false, evidence: evidence.join("\n\n") };
  }
  evidence.push("Ambiente aprovado antes do desenvolvimento. Sondas de prontidão não serão repetidas nas fases.");
  return { ok: true, evidence: evidence.join("\n\n") };
}
