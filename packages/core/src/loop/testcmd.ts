/**
 * Resolução do comando de teste do projeto.
 *
 * Redetectado a cada fase: num greenfield a suíte não existe na fase 1 e passa
 * a existir na 2, e um valor decidido uma vez no início ficaria errado para
 * sempre. Sem comando resolvido, o gate 2 é pulado com aviso alto e o
 * verificador independente segura sozinho — nunca um erro silencioso.
 *
 * O comando resolvido aqui é o MESMO que vai no prompt do executor. Se o agente
 * rodar outro runner, ele vê verde e o gate vê vermelho.
 */

import { access, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";

export interface TestCommand {
  command: string;
  source: string;
  /** Verdadeiro quando a suíte roda dentro de um container. */
  containerized: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function json(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface TestCommandOptions {
  /** `--test-cmd`, que tem a maior precedência. */
  explicit?: string;
  environment?: NodeJS.ProcessEnv;
}

export async function resolveTestCommand(
  projectRoot: string,
  options: TestCommandOptions = {},
): Promise<TestCommand | null> {
  const explicit = options.explicit?.trim();
  if (explicit) return { command: explicit, source: "--test-cmd", containerized: false };

  const fromEnvironment = (options.environment ?? process.env).CAPIVARA_TEST_CMD?.trim();
  if (fromEnvironment) return { command: fromEnvironment, source: "CAPIVARA_TEST_CMD", containerized: false };

  const has = async (name: string): Promise<boolean> => exists(join(projectRoot, name));

  // Sail tem precedência sobre composer: a suíte roda DENTRO do container, e
  // rodá-la no host faria todo gate 2 falhar, queimando ciclos de correção.
  if ((await has("artisan")) && (await has("vendor/bin/sail"))) {
    return { command: "vendor/bin/sail test", source: "Laravel Sail", containerized: true };
  }

  const composer = await json(join(projectRoot, "composer.json"));
  if (composer && typeof (composer.scripts as Record<string, unknown> | undefined)?.test !== "undefined") {
    return { command: "composer test", source: "composer.json scripts.test", containerized: false };
  }

  if (await has("artisan")) return { command: "php artisan test", source: "artisan", containerized: false };

  const packageJson = await json(join(projectRoot, "package.json"));
  if (packageJson && typeof (packageJson.scripts as Record<string, unknown> | undefined)?.test !== "undefined") {
    return { command: "npm test", source: "package.json scripts.test", containerized: false };
  }

  // `python3 -m pytest` funciona sempre que o pytest é importável pelo
  // interpretador ativo; o `pytest` pelado depende de ele estar no PATH, e no
  // piloto 2 isso queimou os três ciclos de uma fase com "comando não encontrado".
  if (await has("pytest.ini")) return { command: "python3 -m pytest", source: "pytest.ini", containerized: false };
  if (await has("pyproject.toml")) {
    const pyproject = await readFile(join(projectRoot, "pyproject.toml"), "utf8").catch(() => "");
    if (pyproject.includes("[tool.pytest")) return { command: "python3 -m pytest", source: "pyproject.toml", containerized: false };
  }

  if (await has("go.mod")) return { command: "go test ./...", source: "go.mod", containerized: false };
  if (await has("Cargo.toml")) return { command: "cargo test", source: "Cargo.toml", containerized: false };

  const dotnet = await projetosDeTesteDotnet(projectRoot);
  if (dotnet.length > 0) {
    /*
     * No modo Microsoft.Testing.Platform (`global.json`), o `dotnet test` só aceita
     * o projeto por `--project`, e o relatório TRX depende de uma extensão que o
     * projeto pode não ter: roda sem relatório, e a prova pela suíte não vale ali.
     */
    if (/Microsoft\.Testing\.Platform/iu.test(await runnerDoGlobalJson(projectRoot))) {
      return { command: dotnet.map((projeto) => `dotnet test --project ${citarNoShell(projeto)}`).join(" && "), source: "projeto de teste .NET (Microsoft.Testing.Platform)", containerized: false };
    }
    // Cada projeto grava o relatório TRX dele: é por ele que o Core sabe qual teste rodou e passou (§134).
    const comando = dotnet.map((projeto) => {
      const relatorio = `${projeto.replace(/[^\w.-]+/gu, "-")}.trx`;
      return `dotnet test ${citarNoShell(projeto)} --logger "trx;LogFileName=${relatorio}" --results-directory ${RESULTADOS_DOTNET}`;
    });
    return { command: comando.join(" && "), source: "projeto de teste .NET", containerized: false };
  }

  return null;
}

/**
 * Onde o G2 do .NET grava o relatório de cada projeto de teste (§134): dentro de
 * `.capivara/tmp`, fora da árvore do produto e de todo commit.
 */
export const RESULTADOS_DOTNET = ".capivara/tmp/testes-dotnet";

/** Apaga o relatório da passagem anterior: o que se lê depois é só desta. */
export async function limparResultadosDotnet(raiz: string): Promise<void> {
  await rm(join(raiz, RESULTADOS_DOTNET), { recursive: true, force: true });
}

const DESESCAPAR: Record<string, string> = { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };
const atributo = (tag: string, nome: string): string | undefined =>
  new RegExp(`\\s${nome}="([^"]*)"`, "u").exec(tag)?.[1]?.replace(/&(?:quot|apos|lt|gt|amp);/gu, (entidade) => DESESCAPAR[entidade] ?? entidade);

/**
 * O que a suíte .NET rodou, teste a teste, segundo o relatório TRX (§134): de
 * `Namespace.Classe.Metodo` para "passou em todas as execuções". Pulado
 * (`NotExecuted`), falho ou inconclusivo não passou; cada caso de um `[Theory]` conta.
 * `null` quando não há relatório: a suíte não disse o que rodou.
 *
 * É a prova de execução que a leitura do código não dá: nas revisões da §134,
 * todo reconhecimento de "teste ativo" pelo texto deixou passar um teste pulado
 * pela classe, pelo corpo, por `#if`, por filtro ou fora da solução.
 */
export async function lerResultadosDotnet(raiz: string, comando?: string): Promise<Map<string, boolean> | null> {
  const pasta = join(raiz, RESULTADOS_DOTNET);
  // Só os relatórios que o comando declara: um `.trx` que um teste escrevesse na pasta não é do runner.
  const declarados = new Set([...(comando ?? "").matchAll(/LogFileName=([^";]+)/gu)].map((casou) => casou[1]!));
  const arquivos = (await readdir(pasta).catch(() => [] as string[])).filter((nome) => nome.endsWith(".trx") && (declarados.size === 0 || declarados.has(nome)));
  if (arquivos.length === 0) return null;
  const testes = new Map<string, boolean>();
  for (const arquivo of arquivos) {
    const xml = await readFile(join(pasta, arquivo), "utf8").catch(() => "");
    const metodos = new Map<string, string>();
    for (const definicao of xml.matchAll(/<UnitTest\s[^>]*>[\s\S]*?<\/UnitTest>/gu)) {
      const id = atributo(definicao[0].slice(0, definicao[0].indexOf(">") + 1), "id");
      const metodo = /<TestMethod\s[^>]*>/u.exec(definicao[0])?.[0] ?? "";
      const classe = atributo(metodo, "className");
      const nome = atributo(metodo, "name")?.replace(/\(.*$/su, "");
      if (id && classe && nome) metodos.set(id, `${classe}.${nome}`);
    }
    for (const resultado of xml.matchAll(/<UnitTestResult\s[^>]*>/gu)) {
      const teste = metodos.get(atributo(resultado[0], "testId") ?? "");
      if (teste === undefined) continue;
      const passou = atributo(resultado[0], "outcome") === "Passed";
      testes.set(teste, (testes.get(teste) ?? true) && passou);
    }
  }
  return testes;
}

/**
 * Onde um projeto .NET nunca guarda o projeto de teste: saída de build e
 * dependências de qualquer ecossistema (a busca roda a cada fase, e um `vendor/`
 * ou um `.venv/` têm milhares de pastas). Pasta oculta também fica de fora.
 */
const FORA_DA_BUSCA = new Set(["bin", "obj", "node_modules", "vendor", "venv", "target", "dist", "build", "coverage", "TestResults", "__pycache__"]);

/**
 * Os projetos de teste .NET da árvore, em ordem estável (§134).
 *
 * No Luna (`build-521a72e8dbb5`) o PLAN declarou xUnit, o executor escreveu
 * `tests/Agenda.Tests` — e o G2 ficou NOT_APPLICABLE nas quatro passagens, porque
 * nada aqui conhecia .NET. O verificador julgou o produto só pela leitura, e o
 * fluxo de um desktop ficou sem prova executada nenhuma. Numa cópia do projeto,
 * `dotnet test tests/Agenda.Tests/Agenda.Tests.csproj` passa 13 testes.
 *
 * Cada projeto de teste é nomeado, e não a solução: um projeto fora da solução
 * não rodaria, e a suíte que passa tem de ser a que contém os testes. Projeto de
 * teste é o que o próprio .NET trata assim — o SDK de teste, o `MSTest.Sdk`, ou
 * `<IsTestProject>true`; um projeto de aplicação não vira suíte.
 */
async function projetosDeTesteDotnet(projectRoot: string): Promise<string[]> {
  const achados: string[] = [];
  const visitar = async (relativo: string, profundidade: number): Promise<void> => {
    const entradas = await readdir(join(projectRoot, relativo), { withFileTypes: true }).catch(() => []);
    for (const entrada of entradas) {
      const caminho = relativo === "" ? entrada.name : `${relativo}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (profundidade < 4 && !FORA_DA_BUSCA.has(entrada.name) && !entrada.name.startsWith(".") && !(await outroProjeto(join(projectRoot, caminho)))) {
          await visitar(caminho, profundidade + 1);
        }
        continue;
      }
      if (!entrada.isFile() || !/\.(?:cs|fs|vb)proj$/u.test(entrada.name)) continue;
      const projeto = await readFile(join(projectRoot, caminho), "utf8").catch(() => "");
      if (/Microsoft\.NET\.Test\.Sdk|MSTest\.Sdk|<IsTestProject>\s*true\s*<\/IsTestProject>/iu.test(projeto)) achados.push(caminho);
    }
  };
  await visitar("", 0);
  return achados.sort();
}

/**
 * A pasta é a raiz de outro projeto — tem o manifesto de outro ecossistema? A
 * busca não desce nela: o teste .NET que estiver lá é de outro produto (a pasta
 * de projetos que contém o Luna resolvia a suíte dele).
 */
async function outroProjeto(pasta: string): Promise<boolean> {
  for (const manifesto of ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", ".git"]) {
    if (await exists(join(pasta, manifesto))) return true;
  }
  return false;
}

/**
 * O runner de teste que o `global.json` mais próximo escolhe, subindo as pastas
 * como o SDK sobe. O SDK aceita BOM, comentário e vírgula sobrando; a leitura
 * também — sem isso, um `global.json` comentado passava por VSTest e o comando
 * quebrava o G2 em toda passagem.
 */
async function runnerDoGlobalJson(projectRoot: string): Promise<string> {
  let pasta = resolvePath(projectRoot);
  for (;;) {
    const bruto = await readFile(join(pasta, "global.json"), "utf8").catch(() => null);
    if (bruto !== null) {
      const limpo = bruto
        .replace(/^\uFEFF/u, "")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/(^|[^:"\\])\/\/[^\n]*/gu, "$1")
        .replace(/,(\s*[}\]])/gu, "$1");
      try {
        const lido = JSON.parse(limpo) as { test?: { runner?: unknown } };
        return String(lido.test?.runner ?? "");
      } catch {
        return "";
      }
    }
    const pai = dirname(pasta);
    if (pai === pasta) return "";
    pasta = pai;
  }
}

/** O caminho como argumento de shell: entre aspas simples só quando precisa. */
function citarNoShell(caminho: string): string {
  return /^[\w./-]+$/u.test(caminho) ? caminho : `'${caminho.replace(/'/g, "'\\''")}'`;
}

/**
 * Os testes de navegador do projeto, quando o manifesto os declara (§113).
 *
 * Não é o comando do gate 2, que continua sendo o de `resolveTestCommand`: é o
 * que o executor precisa saber que existe para rodar o que escreve. No
 * `teste_luna`, `npm test` era só o Vitest e as specs Playwright rodavam por
 * `test:e2e`; o executor da P05 as escreveu três ciclos sem nunca rodá-las.
 */
export async function resolveE2eCommand(projectRoot: string): Promise<string | null> {
  const scripts = (await json(join(projectRoot, "package.json")))?.scripts as Record<string, unknown> | undefined;
  for (const nome of ["test:e2e", "e2e"]) if (typeof scripts?.[nome] === "string") return `npm run ${nome}`;
  return null;
}
