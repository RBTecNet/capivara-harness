/** A instalação pertence ao runtime e ao manifesto, não apenas ao diretório. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

export const MARCA_DE_INSTALACAO_NODE = ".capivara-installation.json";

export interface RuntimeNode {
  executavel: string;
  node: string;
  abi: string;
  plataforma: string;
  arquitetura: string;
}

export function runtimeNode(): RuntimeNode {
  return { executavel: process.execPath, node: process.version, abi: process.versions.modules ?? "", plataforma: process.platform, arquitetura: process.arch };
}

interface Marca { versao: 1; runtime: RuntimeNode; manifesto: string }
export interface InstalacaoNode {
  estado: "nao-se-aplica" | "ausente" | "compativel" | "incompativel";
  motivo: string;
}

async function existe(caminho: string): Promise<boolean> {
  return stat(caminho).then(() => true, () => false);
}

async function identidadeDoManifesto(projectRoot: string): Promise<string | null> {
  const manifesto = await readFile(join(projectRoot, "package.json"), "utf8").catch(() => null);
  if (manifesto === null) return null;
  const hash = createHash("sha256").update("package.json\0").update(manifesto);
  for (const arquivo of ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]) {
    const conteudo = await readFile(join(projectRoot, arquivo), "utf8").catch(() => null);
    if (conteudo !== null) hash.update(`\0${arquivo}\0`).update(conteudo);
  }
  return hash.digest("hex");
}

/** Mensagens inequívocas do loader nativo; um erro funcional não autoriza reinstalação. */
export function falhaDeDependenciasNode(saida: string): boolean {
  return /NODE_MODULE_VERSION\s+\d+[\s\S]*NODE_MODULE_VERSION\s+\d+|compiled against a different Node\.js version|ERR_DLOPEN_FAILED[\s\S]*NODE_MODULE_VERSION/i.test(saida);
}

/** Só um pacote declarado ausente, ou ABI explícita, é infraestrutura reparável. */
export async function falhaDeInstalacaoNode(projectRoot: string, saida: string): Promise<boolean> {
  if (falhaDeDependenciasNode(saida)) return true;
  const pacote = /Cannot find (?:module|package) ['"]([^'"./][^'"]*)['"]/i.exec(saida)?.[1];
  const binario = /(?:^|\n)(?:sh|\/bin\/sh|bash):\s*(?:\d+:\s*)?([\w@/-]+):\s*(?:not found|command not found)/i.exec(saida)?.[1];
  const ausente = pacote?.startsWith("@") ? pacote.split("/").slice(0, 2).join("/") : pacote?.split("/")[0];
  const nome = ausente ?? binario;
  if (!nome) return false;
  try {
    const manifesto = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as Record<string, Record<string, unknown>>;
    return ["dependencies", "devDependencies", "optionalDependencies"].some((campo) => Object.hasOwn(manifesto[campo] ?? {}, nome));
  } catch { return false; }
}

/** Addons antigos não têm marca. A sonda é isolada e não carrega código JS do produto. */
async function sondarAddon(caminho: string): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, ["-e", "try { require(process.argv[1]); } catch (e) { process.stderr.write(String(e)); process.exitCode = 1; }", resolvePath(caminho)],
      { timeout: 3_000, killSignal: "SIGKILL", maxBuffer: 128 * 1024 }, (_erro, stdout, stderr) => resolve(`${stdout}${stderr}`));
    child.stdin?.end();
  });
}

async function addonIncompativel(pasta: string, sonda: (caminho: string) => Promise<string>, limite: { restantes: number; ate: number }): Promise<string | null> {
  if (limite.restantes <= 0 || Date.now() >= limite.ate) return null;
  const entradas = await readdir(pasta, { withFileTypes: true }).catch(() => []);
  for (const entrada of entradas) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) {
      // Pacotes podem distribuir várias ABIs/plataformas em prebuilds. Não são
      // a instalação ativa; carregar uma delas daria um falso positivo.
      if (["prebuilds", "prebuilt", "Debug", ".cache", ".git"].includes(entrada.name)) continue;
      const encontrado = await addonIncompativel(caminho, sonda, limite);
      if (encontrado) return encontrado;
    } else if (entrada.isFile() && entrada.name.endsWith(".node")) {
      if (limite.restantes-- <= 0 || Date.now() >= limite.ate) return null;
      if (falhaDeDependenciasNode(await sonda(caminho))) return caminho;
    }
  }
  return null;
}

export async function inspecionarInstalacaoNode(
  projectRoot: string,
  opcoes: { runtime?: RuntimeNode; sondar?: (caminho: string) => Promise<string> } = {},
): Promise<InstalacaoNode> {
  const manifesto = await identidadeDoManifesto(projectRoot);
  if (manifesto === null) return { estado: "nao-se-aplica", motivo: "sem package.json" };
  const pasta = join(projectRoot, "node_modules");
  if (!(await existe(pasta))) {
    // Um projeto sem dependências pode rodar com o próprio Node.
    let dados: Record<string, object>;
    try { dados = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as Record<string, object>; }
    catch { return { estado: "nao-se-aplica", motivo: "manifesto inválido; o gate do projeto deve diagnosticá-lo" }; }
    const precisa = ["dependencies", "devDependencies", "optionalDependencies"].some((campo) => Object.keys(dados[campo] ?? {}).length > 0);
    return precisa ? { estado: "ausente", motivo: "node_modules ausente" } : { estado: "nao-se-aplica", motivo: "sem dependências Node" };
  }
  const runtime = opcoes.runtime ?? runtimeNode();
  const marca = await readFile(join(pasta, MARCA_DE_INSTALACAO_NODE), "utf8").then((texto) => {
    try { return JSON.parse(texto) as Marca; } catch { return null; }
  }, () => null);
  if (marca?.versao === 1 && marca.runtime && typeof marca.manifesto === "string") {
    if ((["executavel", "node", "abi", "plataforma", "arquitetura"] as const).some((campo) => marca.runtime[campo] !== runtime[campo])) {
      return { estado: "incompativel", motivo: `runtime mudou: instalação ${marca.runtime.node}/ABI ${marca.runtime.abi} (${marca.runtime.executavel}); atual ${runtime.node}/ABI ${runtime.abi} (${runtime.executavel})` };
    }
    if (marca.manifesto !== manifesto) return { estado: "incompativel", motivo: "manifesto ou lockfile diverge da instalação" };
  }
  // Um npm rebuild externo pode manter a marca e trocar só o binário nativo.
  // A identidade confere o ambiente; a sonda limitada confere a ABI instalada.
  const addon = await addonIncompativel(pasta, opcoes.sondar ?? sondarAddon, { restantes: 16, ate: Date.now() + 4_000 });
  if (addon) return { estado: "incompativel", motivo: `addon compilado para outra ABI Node: ${addon}` };
  return { estado: "compativel", motivo: marca?.versao === 1 ? "instalação conferida para este runtime e manifesto" : "instalação anterior sem incompatibilidade conhecida" };
}

/** Registrar apenas após instalação bem-sucedida ou suíte verde, nunca por mera existência. */
export async function registrarInstalacaoNode(projectRoot: string, runtime: RuntimeNode = runtimeNode()): Promise<void> {
  const manifesto = await identidadeDoManifesto(projectRoot);
  if (manifesto === null || !(await existe(join(projectRoot, "node_modules")))) return;
  await writeFile(join(projectRoot, "node_modules", MARCA_DE_INSTALACAO_NODE), JSON.stringify({ versao: 1, runtime, manifesto } satisfies Marca), "utf8");
}
