/**
 * O que o harness pede à base documental.
 *
 * O cliente fala o protocolo; este módulo fala o nosso vocabulário: um projeto
 * tem UM pedido e os documentos que ele selecionou. A seleção é da aplicação,
 * não daqui — o harness pede "o que este projeto usa" e recebe só isso. Puxar o
 * acervo inteiro para dentro de um run seria encher o contexto de documento que
 * ninguém escolheu, que é o oposto do que a base existe para resolver.
 *
 * O contrato de URI é `capivara://<projeto>/pedido` e
 * `capivara://<projeto>/docs/<tipo>/<slug>`. A área geral vive sob `geral`, e um
 * documento dela que o projeto tenha anexado aparece sob o projeto: quem
 * seleciona é a aplicação, e o harness só enxerga o resultado.
 */

import type { McpClient, McpDocument, McpResource } from "./client.js";

export const PEDIDO_SUFIXO = "/pedido";

/** `capivara://biblioteca/docs/memoria/estilo` → `memoria`. */
export function tipoDoDocumento(uri: string): string {
  const partes = uri.split("/docs/")[1]?.split("/") ?? [];
  return partes[0] ?? "documento";
}

export function projetoDoUri(uri: string): string {
  return uri.replace(/^capivara:\/\//, "").split("/")[0] ?? "";
}

export function uriDoPedido(projeto: string): string {
  return `capivara://${projeto}${PEDIDO_SUFIXO}`;
}

export interface ProjectMaterial {
  /** O texto do pedido. Vazio quando o projeto ainda não tem um. */
  request: string;
  /** Os documentos que o projeto selecionou, na ordem em que a aplicação os deu. */
  documents: McpDocument[];
}

/**
 * Tudo que um projeto oferece a um run, numa volta só.
 *
 * O pedido vem por `prompts/get` quando o servidor oferece prompts, e por
 * recurso quando não oferece: a aplicação é nossa, mas o harness não pode
 * exigir que toda base documental do mundo exponha prompt para ser útil.
 */
export async function fetchProjectMaterial(client: McpClient, projeto: string): Promise<ProjectMaterial> {
  const recursos = await client.listResources();
  const doProjeto = recursos.filter((recurso) => projetoDoUri(recurso.uri) === projeto);

  if (doProjeto.length === 0) {
    const conhecidos = [...new Set(recursos.map((recurso) => projetoDoUri(recurso.uri)))].filter((nome) => nome !== "");
    throw new Error(
      `o projeto "${projeto}" não existe na base documental` +
        (conhecidos.length > 0 ? `; lá existem: ${conhecidos.join(", ")}` : " (ela não expõe projeto nenhum)"),
    );
  }

  const request = await lerPedido(client, projeto, doProjeto);

  const documents: McpDocument[] = [];
  for (const recurso of doProjeto) {
    if (recurso.uri.endsWith(PEDIDO_SUFIXO)) continue;
    const text = await client.readResource(recurso.uri);
    if (text.trim() === "") continue;
    documents.push({ uri: recurso.uri, name: recurso.name || recurso.uri, text });
  }

  return { request, documents };
}

async function lerPedido(client: McpClient, projeto: string, recursos: McpResource[]): Promise<string> {
  const comoRecurso = recursos.find((recurso) => recurso.uri.endsWith(PEDIDO_SUFIXO));
  if (comoRecurso) {
    const texto = await client.readResource(comoRecurso.uri);
    if (texto.trim() !== "") return texto.trim();
  }

  // Sem recurso de pedido, tenta o prompt de mesmo nome. Falhar aqui não é erro
  // do harness: é um projeto sem pedido escrito, e quem lê precisa ouvir isso.
  try {
    return (await client.prompt(projeto)).trim();
  } catch {
    return "";
  }
}

/**
 * Os documentos como o resto do harness já sabe consumir.
 *
 * O stamp rastreia todo input por nome e sha; um documento vindo da base entra
 * por essa mesma porta, e é isso que faz uma memória alterada na aplicação
 * deixar o plano stale — de graça, pelo mecanismo que já existe.
 */
export function asInputs(documents: readonly McpDocument[]): { name: string; content: string }[] {
  return documents.map((documento) => ({ name: nomeDeInput(documento), content: documento.text }));
}

export function nomeDeInput(documento: McpDocument): string {
  const tipo = tipoDoDocumento(documento.uri);
  const slug = documento.uri.split("/").pop() ?? "documento";
  return `mcp:${tipo}/${slug}`;
}

/**
 * Os documentos da base, do jeito que o escritor os lê.
 *
 * Vão junto do inventário porque são a mesma categoria de coisa: o que já existe
 * e não se discute. Uma memória que diz "português no código" não é sugestão
 * para o escritor avaliar — é decisão tomada antes deste run, e o texto precisa
 * dizer isso, senão o modelo a trata como opinião e às vezes discorda dela.
 */
export function renderLibraryBlock(documents: readonly McpDocument[]): string {
  if (documents.length === 0) return "";

  const linhas = [
    "## Documentos da base documental",
    "",
    "Selecionados para ESTE projeto por quem o cadastrou. São decisões já tomadas:",
    "não os trate como sugestão, não os contradiga, e não repita o conteúdo deles",
    "no documento que você escrever — cite-os quando precisar.",
  ];

  for (const documento of documents) {
    linhas.push("", `### ${documento.name} (${tipoDoDocumento(documento.uri)})`, "", documento.text.trim());
  }
  return linhas.join("\n");
}

export interface LibraryProject {
  slug: string;
  /** Há pedido escrito? Sem ele o `init` não tem o que ler. */
  hasRequest: boolean;
  /** Quantos documentos o projeto usa. */
  documents: number;
}

/**
 * Os projetos que a base oferece, deduzidos do que ela expõe.
 *
 * Não há método de "listar projetos" no protocolo, e inventar uma ferramenta
 * nossa para isso obrigaria toda base documental a implementá-la para servir ao
 * harness. Os recursos já dizem tudo: o escopo do URI é o projeto, e a presença
 * do pedido se vê pelo sufixo.
 *
 * A área geral não é um projeto — é o acervo de onde os projetos escolhem, e
 * oferecê-la como destino de um run seria oferecer o acervo inteiro.
 */
export async function listLibraryProjects(client: McpClient): Promise<LibraryProject[]> {
  const contagem = new Map<string, LibraryProject>();

  for (const recurso of await client.listResources()) {
    const slug = projetoDoUri(recurso.uri);
    if (slug === "" || slug === "geral") continue;

    const atual = contagem.get(slug) ?? { slug, hasRequest: false, documents: 0 };
    if (recurso.uri.endsWith(PEDIDO_SUFIXO)) atual.hasRequest = true;
    else atual.documents += 1;
    contagem.set(slug, atual);
  }

  return [...contagem.values()].sort((esquerda, direita) => esquerda.slug.localeCompare(direita.slug));
}
