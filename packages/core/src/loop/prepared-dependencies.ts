/**
 * O Core registra apenas o bootstrap mínimo que a preparação criou, nunca código:
 * o manifesto de dependências e o lock, com proveniência e conteúdo provados, e
 * só com o que o contrato do PLAN ou as sondas autorizam (§131, §135).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { environmentRequirements, type EnvironmentRequirement } from "../contract/environment.js";
import { commitAdmitido, lerStatus, type EntradaDoStatus } from "./admissao.js";
import { dependenciasContratadas, readEnvironmentPlanExtras, type AutoridadeDaAdocao } from "./environment-plan.js";
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

/** As entradas pendentes da árvore, sem `node_modules`: a adoção não o leva, e listado arquivo a arquivo ele faria a consulta do tamanho da instalação. */
async function entradasDaPreparacao(root: string): Promise<EntradaDoStatus[]> {
  return (await lerStatus(root, [".", ":(exclude).capivara", ":(exclude,glob)**/node_modules/**"]))
    .filter(entrada => !entrada.caminho.split("/").includes("node_modules"));
}

/** Os pendentes da árvore, sem `node_modules`. */
export async function pendentesDaPreparacao(root: string): Promise<string[]> {
  return (await entradasDaPreparacao(root)).map(entrada => entrada.caminho);
}

/** Um registro de sessão de preparação em `preparation/`, como o build o escreve. */
interface RegistroDaPreparacao {
  nome: string;
  /** `started` (a sessão não terminou), `complete`, `recovered`, `failed`; nulo no registro ilegível. */
  status: string | null;
  exitCode: number | null;
  /** O que a sessão foi vista deixando; nulo no registro sem a lista (interrompido, ou de antes do §131). */
  criados: { caminho: string; sha256: string }[] | null;
}

async function registrosDaPreparacao(pasta: string): Promise<RegistroDaPreparacao[]> {
  const registros: RegistroDaPreparacao[] = [];
  for (const nome of (await readdir(pasta).catch(() => [])).filter(nome => nome.endsWith(".json")).sort()) {
    try {
      const registro = JSON.parse(await readFile(join(pasta, nome), "utf8")) as { status?: unknown; criados?: unknown; response?: { exitCode?: unknown } | null };
      registros.push({
        nome,
        status: typeof registro.status === "string" ? registro.status : null,
        exitCode: typeof registro.response?.exitCode === "number" ? registro.response.exitCode : null,
        criados: Array.isArray(registro.criados)
          ? (registro.criados as { caminho?: unknown; sha256?: unknown }[]).flatMap(item =>
            typeof item?.caminho === "string" && typeof item.sha256 === "string" ? [{ caminho: item.caminho, sha256: item.sha256 }] : [])
          : null,
      });
    } catch {
      // Registro ilegível não prova nada, mas existe, e a explicação o menciona.
      registros.push({ nome, status: null, exitCode: null, criados: null });
    }
  }
  return registros;
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
  const registros = (await registrosDaPreparacao(pasta)).filter(registro => registro.criados !== null);
  if (registros.length === 0) return null;
  const criados = new Map<string, Set<string>>();
  for (const item of registros.flatMap(registro => registro.criados!)) criados.set(item.caminho, (criados.get(item.caminho) ?? new Set()).add(item.sha256));
  return criados;
}

/**
 * O que o conteúdo permite adotar (§135): os manifestos que declaram só o que o
 * contrato do PLAN (`infrastructure.dependencies`) ou as sondas autorizam, e o
 * lock de cada um, quando bate com ele. As sondas comprovam prontidão — a do
 * Vite é `npm exec --no -- vite --version`, que não diz pacote nenhum —, e
 * exigir que cada dependência contratada aparecesse numa sonda recusava a
 * preparação que a própria Capivara pediu. O que não é elegível leva o motivo.
 */
interface Elegibilidade {
  autorizadas: Set<string>;
  elegiveis: Set<string>;
  recusados: Map<string, string>;
}

const COMPARADOR = /^(?:[<>]=?|=|\^|~>?)?v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * A versão declarada é do registro: um intervalo semver ou uma etiqueta
 * (`latest`)? Todo o resto — alias (`npm:outro`), `file:`, `link:`, Git, URL,
 * `usuario/repo`, uma pasta (`..`, `.capivara`) ou um tarball (`x.tgz`) —
 * instala outra coisa sob o nome autorizado. Aceitar só a forma do registro, e
 * não recusar as formas conhecidas de fora dele, é o que não deixa brecha.
 */
function doRegistro(versao: unknown): boolean {
  if (typeof versao !== "string") return false;
  const texto = versao.trim();
  // `1.0.0-a.tgz` tem a forma de um pré-lançamento, e o npm o instala como arquivo.
  if (/\.(?:tgz|tar|tar\.gz)$/iu.test(texto)) return false;
  if (texto === "" || /^[A-Za-z][A-Za-z0-9_-]*$/u.test(texto)) return true;
  return texto.split("||").every(alternativa => {
    const termos = alternativa.trim().replace(/(>=|<=|>|<|=|\^|~>?)\s+/gu, "$1").split(/\s+/u);
    return termos.every((termo, indice) => COMPARADOR.test(termo) || (termo === "-" && indice > 0 && indice < termos.length - 1));
  });
}

/** Por que um manifesto não é o mínimo que a preparação adota, ou nulo. */
function motivoDoManifesto(data: Record<string, unknown>, autorizadas: ReadonlySet<string>): string | null {
  const declared = dependencies(data);
  const campos = Object.keys(data).filter(key => !allowedKeys.has(key));
  if (campos.length > 0) return `tem ${campos.map(campo => `\`${campo}\``).join(", ")}, além do que um manifesto mínimo de dependências tem`;
  if (Object.keys(declared).length === 0) return "não declara dependência nenhuma";
  // O npm decide entre chaves repetidas por uma precedência própria; a fusão daqui veria outra versão.
  const repetidas = Object.keys(declared).filter(name => dependencyKeys.filter(key => Object.hasOwn((data[key] ?? {}) as object, name)).length > 1);
  if (repetidas.length > 0) return `declara ${repetidas.map(nome => `\`${nome}\``).join(", ")} em mais de uma chave de dependências`;
  const alheias = Object.keys(declared).filter(name => !autorizadas.has(name));
  if (alheias.length > 0) {
    const so = alheias.length === Object.keys(declared).length ? "só " : "";
    return `declara ${so}${alheias.slice(0, 6).map(nome => `\`${nome}\``).join(", ")}, que nem o contrato de infraestrutura do PLAN (infrastructure.dependencies) nem as sondas de prontidão que o build aceitou autorizam`;
  }
  const foraDoRegistro = Object.keys(declared).filter(name => !doRegistro(declared[name]));
  if (foraDoRegistro.length > 0) {
    return `declara ${foraDoRegistro.map(nome => `\`${nome}\` como ${JSON.stringify(declared[nome])}`).join(", ")}: só um intervalo de versões ou uma etiqueta do registro; alias, pasta, arquivo, Git ou URL instalam outra coisa sob o nome autorizado`;
  }
  return null;
}

/** Por que um lock não é o do manifesto, como o npm o gera do registro, ou nulo. */
function motivoDoLock(lock: { packages?: unknown }, declared: Record<string, unknown>, caminho: string): string | null {
  const pacotes = lock.packages !== null && typeof lock.packages === "object" ? lock.packages as Record<string, Record<string, unknown> | null> : {};
  const locked = dependencies(pacotes[""] ?? {});
  const divergentes = [...new Set([...Object.keys(declared), ...Object.keys(locked)])].filter(name => locked[name] !== declared[name]);
  if (divergentes.length > 0) {
    return `não corresponde a ${caminho}: ${divergentes.slice(0, 6).map(name =>
      `\`${name}\` ${typeof declared[name] === "string" ? `"${declared[name]}"` : "ausente"} no manifesto, ${typeof locked[name] === "string" ? `"${locked[name]}"` : "ausente"} no lock`).join("; ")}`;
  }
  // A mesma regra do manifesto no irmão dele: o que o lock manda instalar vem do registro, não de um link, de uma pasta ou de um Git.
  const fora = Object.entries(pacotes).filter(([chave, entrada]) => chave !== "" &&
    (entrada?.link === true || (typeof entrada?.resolved === "string" && !/^https?:\/\//u.test(entrada.resolved)))).map(([chave]) => chave);
  if (fora.length > 0) return `manda instalar ${fora.slice(0, 4).map(chave => `\`${chave}\``).join(", ")} de fora do registro (link, pasta, arquivo ou Git)`;
  return null;
}

async function elegibilidade(root: string, requirements: readonly EnvironmentRequirement[], contratadas: readonly string[]): Promise<Elegibilidade> {
  // As sondas `./node_modules/.bin/<ferramenta>` comprovam o pacote do link, não um nome no script (§131).
  const instalados = (await Promise.all(requirements.map(requirement => packageBehindBinary(root, requirement.binary))))
    .flatMap(pacote => pacote ? [pacote.name] : []);
  // O nome do contrato vale como o PLAN o escreveu e na forma minúscula do npm ("React" → `react`); nenhum nome ganha maiúscula.
  const autorizadas = new Set([...requirements.flatMap(packagesInReadinessProbe), ...instalados, ...contratadas.flatMap(nome => [nome, nome.toLowerCase()])]);
  const elegiveis = new Set<string>();
  const recusados = new Map<string, string>();
  // Cada manifesto precisa de ao menos um pacote autorizado para ser achado, não de todos eles.
  const manifests = new Map((await Promise.all([...autorizadas].map(name => probeManifests(root, [name])))).flat().map(item => [item.path, item]));
  for (const manifest of manifests.values()) {
    const caminho = relative(root, manifest.path);
    const lockPath = join(manifest.directory, "package-lock.json");
    const lockRelativo = relative(root, lockPath);
    const motivo = motivoDoManifesto(manifest.data, autorizadas);
    if (motivo !== null) {
      recusados.set(caminho, motivo);
      recusados.set(lockRelativo, `acompanha ${caminho}, que não pode ser adotado: ${motivo}`);
      continue;
    }
    elegiveis.add(caminho);
    // Lock ausente ou ilegível não é adotado.
    const lock = await readFile(lockPath, "utf8").then(texto => JSON.parse(texto) as { packages?: unknown }, () => null).catch(() => null);
    const motivoDoLockAqui = lock === null ? "não é um package-lock.json legível" : motivoDoLock(lock, dependencies(manifest.data), caminho);
    if (motivoDoLockAqui === null) elegiveis.add(lockRelativo);
    else recusados.set(lockRelativo, motivoDoLockAqui);
  }
  return { autorizadas, elegiveis, recusados };
}

/**
 * Por que um `package.json` (ou o lock ao lado dele) pendente nem entrou na
 * avaliação: a busca o acha pelo nome de um pacote autorizado, declarado com
 * versão em texto, e só até onde ela percorre. Nulo para o que não é manifesto
 * nem lock.
 */
async function naoAchado(root: string, caminho: string, autorizadas: ReadonlySet<string>): Promise<string | null> {
  const nome = basename(caminho);
  if (nome === "package-lock.json") return "não acompanha um manifesto que a preparação adote";
  if (nome !== "package.json") return null;
  const data = await readFile(join(root, caminho), "utf8").then(texto => JSON.parse(texto) as Record<string, unknown>, () => null).catch(() => null);
  if (data === null || typeof data !== "object" || Array.isArray(data)) return "não é um package.json legível";
  return motivoDoManifesto(data, autorizadas) ?? "está numa pasta que a busca de manifestos da preparação não percorre (oculta, gerada ou funda demais)";
}

/** O que se apurou de um arquivo pendente: os fatos e, quando ele não pode ser adotado, a condição que falhou. */
interface Apuracao {
  caminho: string;
  git: string;
  proveniencia: string;
  conteudo: string;
  condicao: string | null;
  /** Que tipo de decisão a condição pede, para a ação dita no fim. */
  tipo: "versionado" | "alheio" | "conteudo" | "proveniencia" | "alterado" | null;
}

async function apurar(root: string, entrada: EntradaDoStatus, avaliacao: Elegibilidade, criados: ReadonlyMap<string, ReadonlySet<string>> | null): Promise<Apuracao> {
  const { caminho } = entrada;
  // Fora do `??` do status, o arquivo já está no índice ou no histórico: alterado, removido ou só adicionado.
  const git = entrada.naoVersionado ? "não versionado" : "no índice ou no histórico do Git";
  const registrados = criados?.get(caminho);
  const proveniencia = criados === null
    ? "nenhum registro de preparação deste run traz a lista do que a sessão criou"
    : registrados
      ? "registrado como criado por uma sessão de preparação deste run"
      : "nenhuma sessão de preparação deste run o registrou como criado por ela";
  const atual = registrados ? await conteudoDe(join(root, caminho)) : null;
  const conteudo = !registrados
    ? "conteúdo sem registro com que comparar"
    : atual !== null && registrados.has(atual)
      ? `conteúdo igual ao registrado (sha256 ${atual.slice(0, 12)})`
      : `conteúdo atual (sha256 ${atual?.slice(0, 12) ?? "ilegível"}) diferente do registrado (${[...registrados].map(sha => sha.slice(0, 12)).join(", ")})`;
  const fatos = { caminho, git, proveniencia, conteudo };
  if (!entrada.naoVersionado) return { ...fatos, tipo: "versionado", condicao: "já está no índice ou no histórico do Git, e a preparação só adota arquivo novo que ela criou" };
  if (!avaliacao.elegiveis.has(caminho)) {
    const recusado = avaliacao.recusados.get(caminho) ?? await naoAchado(root, caminho, avaliacao.autorizadas);
    return recusado
      ? { ...fatos, tipo: "conteudo", condicao: recusado }
      : { ...fatos, tipo: "alheio", condicao: "não é manifesto de dependências nem lock que a preparação adote" };
  }
  if (!registrados) return { ...fatos, tipo: "proveniencia", condicao: proveniencia };
  if (atual === null || !registrados.has(atual)) return { ...fatos, tipo: "alterado", condicao: "mudou depois da sessão que o criou" };
  return { ...fatos, tipo: null, condicao: null };
}

const ACAO: Record<NonNullable<Apuracao["tipo"]>, string> = {
  versionado: "a alteração no que já está no Git é de quem a fez: commite-a ou desfaça-a",
  alheio: "a alteração que não é da preparação é de quem a fez: commite-a ou desfaça-a; com a árvore só com o que a preparação deixou, a próxima execução a adota",
  proveniencia: "o arquivo que nenhuma sessão deste run criou é de quem o escreveu: se é seu, commite-o; o Core não o adota",
  alterado: "o arquivo mudou depois da sessão: se a mudança é sua, commite-o; se não, apague-o, e a próxima execução prepara de novo o que as sondas reprovarem",
  conteudo: "o conteúdo não é o que a preparação pode adotar: se você o aceita, a decisão é sua — commite os arquivos pendentes listados; se não, apague os não versionados listados, e a próxima execução prepara de novo, só com o que o PLAN contrata, o que as sondas reprovarem",
};

function situacao(registro: RegistroDaPreparacao): string {
  if (registro.status === null) return "registro ilegível";
  if (registro.status === "started") return "a sessão não terminou: o registro parou em started";
  const codigo = registro.exitCode === null ? "" : `, código ${registro.exitCode}`;
  const lista = registro.criados === null ? "; sem a lista do que criou" : "";
  return registro.status === "failed" ? `terminou com falha (failed${codigo})${lista}` : `terminou (${registro.status}${codigo})${lista}`;
}

/**
 * Por que a preparação não foi adotada, quando há registro dela neste run e a
 * árvore ficou com alterações (§135): arquivo por arquivo, a situação no Git, a
 * proveniência, a comparação do conteúdo e a condição que falhou — os fatos dos
 * registros, nunca uma lista de hipóteses —, e a ação que cada uma pede. Nulo
 * quando nada pendente é da preparação: a preparação já adotada não explica a
 * árvore que alguém sujou depois.
 */
export async function explicarPreparacaoNaoAdotada(root: string, pasta: string, autoridade: AutoridadeDaAdocao): Promise<string | null> {
  const registros = await registrosDaPreparacao(pasta);
  if (registros.length === 0) return null;
  const pendentes = await entradasDaPreparacao(root).catch(() => []);
  if (pendentes.length === 0) return null;
  const criados = await criadosPelaPreparacao(pasta);
  if (criados !== null && !pendentes.some(entrada => criados.has(entrada.caminho))) return null;
  const avaliacao = await elegibilidade(root, autoridade.requisitos, autoridade.dependencias);
  const apuradas = await Promise.all(pendentes.slice(0, 12).map(entrada => apurar(root, entrada, avaliacao, criados)));
  const recusadas = apuradas.filter(apurada => apurada.condicao !== null);
  const fora = await foraDaAutoridade(root, autoridade, recusadas.map(apurada => apurada.condicao!));
  // O contrato fora do commit vem antes: apagar e preparar de novo daria na mesma recusa.
  const acoes = [...new Set([...fora.acoes, ...recusadas.map(apurada => ACAO[apurada.tipo!])])];
  return [
    "Há alterações pendentes que o Core não adotou como preparação do ambiente deste run; arquivo por arquivo:",
    ...apuradas.map(apurada => `- ${apurada.caminho} — ${apurada.git}; ${apurada.proveniencia}; ${apurada.conteudo}; ${apurada.condicao === null ? "cumpre as condições de adoção" : `recusado: ${apurada.condicao}`}.`),
    ...(pendentes.length > apuradas.length ? [`- e mais ${pendentes.length - apuradas.length} arquivo(s) pendente(s).`] : []),
    `Sessões de preparação registradas neste run, em ${pasta}: ${registros.map(registro => `${registro.nome} (${situacao(registro)})`).join("; ")}.`,
    ...fora.linhas,
    recusadas.length > 0
      ? `Nada foi adotado nem apagado. Para continuar: ${acoes.join("; ")}.`
      : "Nada foi adotado nem apagado: cada arquivo cumpre as condições, e o commit da preparação não aconteceu. Para continuar: commite-os você mesmo, se são os da preparação.",
  ].join("\n");
}

/**
 * O que o `environment.json` da árvore autoriza hoje e a autoridade da adoção
 * não aceitou, com o porquê exato — não está no commit da HEAD, ou entrou depois
 * que o build o leu, antes de qualquer sessão —, e a ação que cada caso pede
 * quando ele é o que recusou um dos arquivos.
 */
async function foraDaAutoridade(root: string, autoridade: AutoridadeDaAdocao, recusas: readonly string[]): Promise<{ linhas: string[]; acoes: string[] }> {
  const lista = (nomes: readonly string[]): string => nomes.slice(0, 6).map(nome => `\`${nome}\``).join(", ");
  // A condição de recusa cita cada dependência entre crases: é por ela que se sabe se este nome recusou alguma coisa.
  const recusou = (nomes: readonly string[]): boolean => nomes.some(nome => recusas.some(recusa => recusa.includes(`\`${nome}\``)));
  const foraDoCommit = (nome: string): boolean => autoridade.publicadas !== null && !autoridade.publicadas.includes(nome);
  const depoisDaLeitura = "não estava nele quando o build o leu, antes de qualquer sessão desta execução: não vale nesta execução, e na próxima passa a valer";
  const linhas: string[] = [];
  const acoes: string[] = [];
  const contrato = dependenciasContratadas(await readEnvironmentPlanExtras(root)).filter(nome => !autoridade.dependencias.includes(nome));
  const doCommit = contrato.filter(foraDoCommit);
  const depois = contrato.filter(nome => !foraDoCommit(nome));
  if (doCommit.length > 0) linhas.push(`O contrato do environment.json da árvore lista ${lista(doCommit)}, que o do commit da HEAD não tem: só vale o que está nos dois.`);
  if (depois.length > 0) linhas.push(`O contrato do environment.json da árvore lista ${lista(depois)}, que ${depoisDaLeitura}.`);
  const requisitos = await readFile(join(root, ".capivara/init/environment.json"), "utf8")
    .then(texto => environmentRequirements((JSON.parse(texto) as { requirements?: unknown }).requirements), () => [] as EnvironmentRequirement[]).catch(() => []);
  const aceitos = new Set(autoridade.requisitos.flatMap(packagesInReadinessProbe));
  const sondados = [...new Set(requisitos.flatMap(packagesInReadinessProbe))].filter(nome => !aceitos.has(nome));
  if (sondados.length > 0) linhas.push(`O environment.json da árvore tem sonda que nomeia ${lista(sondados)}, e essa sonda ${depoisDaLeitura}.`);
  if (recusou(doCommit)) acoes.push("se a mudança no contrato da árvore é sua (um `change` ou um `plan` sem commit), commite a especificação em `.capivara/init` e rode de novo; se não é, desfaça-a");
  if (recusou([...depois, ...sondados])) acoes.push("o `.capivara/init/environment.json` mudou durante esta execução: se a mudança não é sua, desfaça-a antes de rodar de novo, porque na próxima execução ela valeria");
  return { linhas, acoes };
}

export async function adoptPreparedDependencies(
  root: string,
  requirements: readonly EnvironmentRequirement[],
  /** O que a preparação deixou, com o conteúdo (`criadosPelaPreparacao`); nulo é preparação sem esse registro, e então nada é adotado. */
  criados: ReadonlyMap<string, ReadonlySet<string>> | null,
  /** As dependências que o PLAN contratou (`dependenciasContratadas`): a autoridade sobre o que o manifesto pode declarar (§135). */
  contratadas: readonly string[] = [],
): Promise<boolean> {
  const avaliacao = await elegibilidade(root, requirements, contratadas);
  if (!avaliacao.elegiveis.size) return false;

  // Exclusão local padrão: não modifica o .gitignore nem oculta fonte rastreada.
  const exclude = resolve(root, (await run("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root })).stdout.trim());
  const previous = await readFile(exclude, "utf8").catch(() => "");
  if (!previous.split(/\r?\n/).includes("node_modules/")) {
    await mkdir(dirname(exclude), { recursive: true });
    await writeFile(exclude, `${previous}${previous.endsWith("\n") || previous === "" ? "" : "\n"}node_modules/\n`);
  }
  const pending = await lerStatus(root);
  if (!pending.length || criados === null) return false;
  for (const item of pending) {
    if ((await apurar(root, item, avaliacao, criados)).condicao !== null) return false;
  }
  const result = await commitAdmitido(root, { caminhos: pending.map(item => item.caminho), mensagem: "chore(capivara): prepara dependências do ambiente" });
  return result.status === "commitado";
}
