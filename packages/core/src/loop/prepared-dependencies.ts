/** O Core registra apenas o bootstrap mínimo declarado pelo probe, nunca código. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { EnvironmentRequirement } from "../contract/environment.js";
import { commitAdmitido, lerStatus } from "./admissao.js";
import { packageBehindBinary, packagesInReadinessProbe, probeManifests } from "./prerequisite-workspace.js";

const run = promisify(execFile);
const dependencyKeys = ["dependencies", "devDependencies", "optionalDependencies"];
const allowedKeys = new Set([...dependencyKeys, "name", "version", "private", "type", "description", "license"]);

function dependencies(value: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({}, ...dependencyKeys.map(key => value[key]));
}

/** O sha256 do arquivo, ou null quando não é um arquivo legível. */
export async function conteudoDe(arquivo: string): Promise<string | null> {
  return readFile(arquivo).then((bytes) => createHash("sha256").update(bytes).digest("hex"), () => null);
}

/** Os pendentes da árvore, sem `node_modules`: a adoção não o leva, e listado arquivo a arquivo ele faria a consulta do tamanho da instalação. */
export async function pendentesDaPreparacao(root: string): Promise<string[]> {
  return (await lerStatus(root, [".", ":(exclude).capivara", ":(exclude,glob)**/node_modules/**"]))
    .map(entrada => entrada.caminho).filter(caminho => !caminho.split("/").includes("node_modules"));
}

/**
 * O que as sessões de preparação deste run deixaram na árvore (§131), lido dos
 * registros em `preparation/`: cada caminho com o conteúdo (sha256) que ele
 * tinha quando a sessão terminou.
 *
 * É a proveniência da adoção: só entra no commit da preparação o arquivo que
 * uma sessão foi vista criando, e com o conteúdo que ela deixou. Um manifesto
 * que já estava ali é do desenvolvedor, por mais que se pareça com o que a
 * preparação faria. O mesmo vale para o que ele escreveu ou mudou depois, no
 * mesmo caminho: o run é do plano, e os registros de uma execução anterior
 * continuam aqui. Nulo quando nenhuma sessão deixou esse registro (a sessão
 * interrompida, o registro de antes desta versão): sem a prova, nada é adotado.
 */
export async function criadosPelaPreparacao(pasta: string): Promise<Map<string, Set<string>> | null> {
  let encontrou = false;
  const criados = new Map<string, Set<string>>();
  for (const nome of (await readdir(pasta).catch(() => [])).filter(nome => nome.endsWith(".json")).sort()) {
    try {
      const registro = JSON.parse(await readFile(join(pasta, nome), "utf8")) as { criados?: unknown };
      if (!Array.isArray(registro.criados)) continue;
      encontrou = true;
      for (const item of registro.criados as { caminho?: unknown; sha256?: unknown }[]) {
        if (typeof item?.caminho !== "string" || typeof item.sha256 !== "string") continue;
        criados.set(item.caminho, (criados.get(item.caminho) ?? new Set()).add(item.sha256));
      }
    } catch { /* registro ilegível não prova nada */ }
  }
  return encontrou ? criados : null;
}

/**
 * Por que a preparação não foi adotada, quando há registro dela neste run e a
 * árvore ficou com alterações: a mensagem que o build acrescenta ao parar, para
 * a decisão ser de quem sabe de onde os arquivos vieram.
 */
export async function explicarPreparacaoNaoAdotada(root: string, pasta: string): Promise<string | null> {
  const registros = (await readdir(pasta).catch(() => [])).filter(nome => nome.endsWith(".json"));
  if (registros.length === 0) return null;
  const pendentes = await pendentesDaPreparacao(root).catch(() => []);
  if (pendentes.length === 0) return null;
  const lista = `${pendentes.slice(0, 8).join(", ")}${pendentes.length > 8 ? `, e mais ${pendentes.length - 8}` : ""}`;
  return [
    `A preparação do ambiente deste run tem registro em ${pasta}, e nenhum deles prova que ${lista} é o que ela deixou:`,
    "a sessão foi interrompida antes de registrar o que criou, o arquivo mudou depois dela, o manifesto declara mais do que as",
    "sondas comprovam, ou o registro é de antes desta versão. Nada foi adotado nem apagado. Se vieram da preparação, apague-os —",
    "ela os refaz na próxima execução; se são seus, commite-os.",
  ].join(" ");
}

export async function adoptPreparedDependencies(
  root: string,
  requirements: readonly EnvironmentRequirement[],
  /** O que a preparação deixou, com o conteúdo (`criadosPelaPreparacao`); nulo é preparação sem esse registro, e então nada é adotado. */
  criados: ReadonlyMap<string, ReadonlySet<string>> | null,
): Promise<boolean> {
  // As sondas `./node_modules/.bin/<ferramenta>` comprovam o pacote do link, não um nome no script (§131).
  const instalados = (await Promise.all(requirements.map(requirement => packageBehindBinary(root, requirement.binary))))
    .flatMap(pacote => pacote ? [pacote.name] : []);
  const packages = [...new Set([...requirements.flatMap(packagesInReadinessProbe), ...instalados])];
  if (!packages.length) return false;
  // Cada manifesto precisa de ao menos um pacote sondado, não de todos eles.
  const manifests = new Map((await Promise.all(packages.map(name => probeManifests(root, [name])))).flat().map(item => [item.path, item]));
  const eligible = new Set<string>();
  for (const manifest of manifests.values()) {
    const declared = dependencies(manifest.data);
    if (Object.keys(manifest.data).some(key => !allowedKeys.has(key)) ||
        Object.keys(declared).length === 0 || Object.keys(declared).some(name => !packages.includes(name))) continue;
    eligible.add(relative(root, manifest.path));
    try {
      const lockPath = join(manifest.directory, "package-lock.json");
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as { packages?: Record<string, Record<string, unknown>> };
      const locked = dependencies(lock.packages?.[""] ?? {});
      if (Object.keys(locked).length === Object.keys(declared).length && Object.entries(declared).every(([name, version]) => locked[name] === version)) eligible.add(relative(root, lockPath));
    } catch { /* Lock ausente ou incompatível não é adotado. */ }
  }
  if (!eligible.size) return false;

  // Exclusão local padrão: não modifica o .gitignore nem oculta fonte rastreada.
  const exclude = resolve(root, (await run("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root })).stdout.trim());
  const previous = await readFile(exclude, "utf8").catch(() => "");
  if (!previous.split(/\r?\n/).includes("node_modules/")) {
    await mkdir(dirname(exclude), { recursive: true });
    await writeFile(exclude, `${previous}${previous.endsWith("\n") || previous === "" ? "" : "\n"}node_modules/\n`);
  }
  const pending = await lerStatus(root);
  if (!pending.length || criados === null || pending.some(item => !item.naoVersionado || !eligible.has(item.caminho))) return false;
  for (const item of pending) {
    const conteudo = await conteudoDe(join(root, item.caminho));
    if (conteudo === null || criados.get(item.caminho)?.has(conteudo) !== true) return false;
  }
  const result = await commitAdmitido(root, { caminhos: pending.map(item => item.caminho), mensagem: "chore(capivara): prepara dependências do ambiente" });
  return result.status === "commitado";
}
