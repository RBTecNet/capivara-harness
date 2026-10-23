/**
 * O teste .NET citado como prova de um passo rodou e passou NESTA execução da
 * suíte? (§134)
 *
 * A prova de um passo fora do navegador é um teste da suíte do projeto, citado
 * pelo roteirista e conferido pelo Core. Ler o código não basta para saber se um
 * teste roda: nas três revisões adversariais da §134, cada reconhecimento de
 * "teste ativo" pelo texto deixou passar algum teste pulado — pela classe, pelo
 * corpo, por `#if`, por alias, por filtro, fora da solução —, e o build fechava
 * com código 0. Quem sabe o que rodou é o runner: o .NET grava, por teste, o
 * resultado no relatório TRX do G2, e é ele que decide.
 *
 * O texto do arquivo só amarra a citação ao relatório: a classe tem de estar
 * declarada no arquivo citado, e o nome tem de aparecer ali como código — não em
 * comentário nem em string.
 */

type Familia = "c" | "py" | "rb" | "php" | "vb" | "fs";

function familiaDe(extensao: string): Familia {
  if (extensao === "py") return "py";
  if (extensao === "rb") return "rb";
  if (extensao === "php") return "php";
  if (extensao === "vb") return "vb";
  if (extensao === "fs") return "fs";
  return "c";
}

/**
 * O texto com comentários e o CONTEÚDO das strings trocados por espaço — mesmo
 * tamanho, mesmas quebras de linha, os delimitadores no lugar. É sobre ele que se
 * procura código; o título de um caso é lido do original, na posição achada.
 */
export function mascarar(conteudo: string, extensao: string): string {
  const familia = familiaDe(extensao);
  const crase = familia === "c" && extensao !== "kt" && extensao !== "kts";
  const saida = conteudo.split("");
  const apagar = (de: number, ate: number): void => {
    for (let indice = de; indice < ate && indice < saida.length; indice += 1) if (saida[indice] !== "\n") saida[indice] = " ";
  };
  const fimDaLinha = (de: number): number => {
    const fim = conteudo.indexOf("\n", de);
    return fim < 0 ? conteudo.length : fim;
  };
  let i = 0;
  while (i < conteudo.length) {
    const resto = conteudo.slice(i, i + 3);
    const c = conteudo[i]!;
    const linhaComeca = i === 0 || conteudo[i - 1] === "\n";
    // Comentários.
    if ((familia === "c" || familia === "php" || familia === "fs") && resto.startsWith("//")) { const fim = fimDaLinha(i); apagar(i, fim); i = fim; continue; }
    if ((familia === "c" || familia === "php") && resto.startsWith("/*")) { const fim = conteudo.indexOf("*/", i + 2); const ate = fim < 0 ? conteudo.length : fim + 2; apagar(i, ate); i = ate; continue; }
    if (familia === "fs" && resto.startsWith("(*")) { const fim = conteudo.indexOf("*)", i + 2); const ate = fim < 0 ? conteudo.length : fim + 2; apagar(i, ate); i = ate; continue; }
    if ((familia === "py" || familia === "rb" || (familia === "php" && conteudo[i + 1] !== "[")) && c === "#") { const fim = fimDaLinha(i); apagar(i, fim); i = fim; continue; }
    if (familia === "vb" && c === "'") { const fim = fimDaLinha(i); apagar(i, fim); i = fim; continue; }
    if (familia === "rb" && linhaComeca && conteudo.startsWith("=begin", i)) { const fim = conteudo.indexOf("\n=end", i); const ate = fim < 0 ? conteudo.length : fimDaLinha(fim + 1); apagar(i, ate); i = ate; continue; }
    // `#if false` / `#if 0` (C#, C): o bloco não compila, e nada nele é teste.
    if (familia === "c" && linhaComeca && /^[ \t]*#if[ \t]+(?:false|0)\b/u.test(conteudo.slice(i, fimDaLinha(i)))) {
      const fim = conteudo.slice(i).search(/\n[ \t]*#endif\b/u);
      const ate = fim < 0 ? conteudo.length : i + fim + 1;
      apagar(i, ate); i = ate; continue;
    }
    // Strings: triplas (Python, C# 11, Kotlin/Java), verbatim do C#, raw do Rust, e as comuns.
    const tripla = (familia === "py" || familia === "c") && (resto === '"""' || (familia === "py" && resto === "'''"));
    if (tripla) { const fim = conteudo.indexOf(resto, i + 3); const ate = fim < 0 ? conteudo.length : fim + 3; apagar(i + 3, ate - 3); i = ate; continue; }
    if (familia === "c" && c === "@" && conteudo[i + 1] === '"') {
      let j = i + 2;
      while (j < conteudo.length && !(conteudo[j] === '"' && conteudo[j + 1] !== '"')) j += conteudo[j] === '"' ? 2 : 1;
      apagar(i + 2, j); i = j + 1; continue;
    }
    if (familia === "c" && extensao === "rs" && c === "r" && /^r#*"/u.test(conteudo.slice(i, i + 8)) && !/[\w]/u.test(conteudo[i - 1] ?? "")) {
      const hashes = /^r(#*)"/u.exec(conteudo.slice(i, i + 8))![1]!;
      const fecha = `"${hashes}`;
      const fim = conteudo.indexOf(fecha, i + 2 + hashes.length);
      const ate = fim < 0 ? conteudo.length : fim + fecha.length;
      apagar(i + 2 + hashes.length, ate - fecha.length); i = ate; continue;
    }
    const delimitadores = familia === "vb" ? ['"'] : crase ? ['"', "'", "`"] : ['"', "'"];
    if (delimitadores.includes(c) && !(familia === "c" && c === "'" && extensao === "rs" && /^'[\w]+\b(?!')/u.test(conteudo.slice(i, i + 40)))) {
      let j = i + 1;
      while (j < conteudo.length && conteudo[j] !== c) {
        if (conteudo[j] === "\\" && familia !== "vb") j += 1;
        else if (conteudo[j] === "\n" && c !== "`") break;
        j += 1;
      }
      apagar(i + 1, j); i = j + 1; continue;
    }
    i += 1;
  }
  return saida.join("");
}

const IDENT = String.raw`[\p{L}\p{N}_]`;

/** A posição da chave que fecha a aberta em `abre`, no texto mascarado; o fim do texto quando não fecha. */
function fechaChave(codigo: string, abre: number): number {
  let profundidade = 0;
  for (let indice = abre; indice < codigo.length; indice += 1) {
    if (codigo[indice] === "{") profundidade += 1;
    else if (codigo[indice] === "}" && --profundidade === 0) return indice;
  }
  return codigo.length;
}

/**
 * O motivo da recusa, ou `null` quando o relatório da suíte mostra o teste citado
 * aprovado (todas as execuções), com a classe declarada no arquivo, no namespace
 * do arquivo. O nome do relatório é `Namespace.Classe.Metodo` (classe aninhada com
 * `+`); o namespace tem de ser EXATAMENTE um dos que o arquivo declara — a classe
 * homônima de um namespace vizinho é outro teste, e arquivo sem namespace é o
 * global. No VB, o namespace do arquivo vem depois do raiz do projeto, que o
 * arquivo não diz: ali vale o fim do nome.
 */
export function testeDotnetAprovado(conteudo: string, extensao: string, teste: string, testes: ReadonlyMap<string, boolean>): string | null {
  const ext = extensao.toLowerCase();
  const citado = teste.trim().replace(/^[`"']+|[`"']+$/gu, "").replace(/\(.*\)$/su, "");
  const crases = /^``(.+)``$/u.exec(citado)?.[1];
  const metodo = crases ?? citado.split(/[.+]/u).at(-1) ?? "";
  const codigo = mascarar(conteudo, ext);
  if (crases !== undefined || (ext === "fs" && /\s/u.test(metodo))) {
    if (!codigo.includes(`\`\`${metodo}\`\``) && !conteudo.includes(`\`\`${metodo}\`\``)) return "o método citado não está no código do arquivo";
  } else {
    if (!new RegExp(`^${IDENT}+$`, "u").test(metodo)) return "o nome citado não é o de um método de teste";
    if (!new RegExp(`(?<!${IDENT})${metodo}(?!${IDENT})`, "u").test(codigo)) return "o método citado não está no código do arquivo";
  }
  const classes = new Set([...codigo.matchAll(new RegExp(`\\b(?:class|Class|record|struct|Structure|type)\\s+(${IDENT}+)`, "gu"))].map((casou) => casou[1]!));
  // Os namespaces do arquivo, compostos quando um bloco está dentro de outro (`namespace Agenda { namespace Tests { … } }`).
  const declarados = [...codigo.matchAll(new RegExp(`\\b(?:namespace|Namespace)\\s+(${IDENT}+(?:\\.${IDENT}+)*)\\s*(\\{)?`, "gu"))].map((casou) => {
    const inicio = casou.index ?? 0;
    const abre = casou[2] === undefined ? -1 : inicio + casou[0].length - 1;
    return { nome: casou[1]!, inicio, fim: abre < 0 ? codigo.length : fechaChave(codigo, abre) };
  });
  const namespaces = declarados.map((declarado) =>
    [...declarados.filter((outro) => outro !== declarado && outro.inicio < declarado.inicio && declarado.inicio < outro.fim && outro.fim < codigo.length).map((outro) => outro.nome), declarado.nome].join("."));
  // O módulo F# é a "classe" do relatório: `module Agenda.Fs.CadastroTests` → namespace `Agenda.Fs`, classe `CadastroTests`.
  for (const modulo of codigo.matchAll(new RegExp(`\\b(?:module|Module)\\s+(?:(${IDENT}+(?:\\.${IDENT}+)*)\\.)?(${IDENT}+)`, "gu"))) {
    classes.add(modulo[2]!);
    if (modulo[1] !== undefined) namespaces.push(modulo[1]);
  }
  const candidatos = [...testes.entries()].filter(([completo]) => {
    const [dono, ...resto] = [completo.slice(0, completo.lastIndexOf(".")), completo.slice(completo.lastIndexOf(".") + 1)];
    if (resto[0] !== metodo) return false;
    const aninhadas = dono.split("+");
    const classe = aninhadas.at(-1)!.split(".").at(-1)!;
    if (!classes.has(classe)) return false;
    const externa = aninhadas[0]!;
    const namespace = externa.includes(".") ? externa.slice(0, externa.lastIndexOf(".")) : "";
    const doArquivo = ext === "vb"
      ? namespaces.length === 0 || namespaces.some((declarado) => namespace === declarado || namespace.endsWith(`.${declarado}`))
      : namespaces.length === 0 ? namespace === "" || ext === "fs" : namespaces.includes(namespace);
    if (!doArquivo) return false;
    // A citação qualificada tem de bater com o fim do nome do relatório.
    return !/[.+]/u.test(citado) || crases !== undefined || completo === citado || completo.endsWith(`.${citado}`) || completo.endsWith(`+${citado}`);
  });
  if (candidatos.length === 0) return "o relatório da suíte não traz este teste, de uma classe declarada no arquivo e no namespace dele, nesta execução";
  if (!candidatos.every(([, passou]) => passou)) return "o relatório da suíte mostra este teste pulado ou falho nesta execução";
  return null;
}
