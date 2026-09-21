/**
 * As skills no disco, e quais delas cada fase recebe.
 *
 * O §34 decidiu que a skill chega ao executor **pelo disco**, não pelo
 * protocolo. Três coisas vêm de graça com isso, e nenhuma vinha pelo MCP: os
 * caminhos relativos do próprio `SKILL.md` funcionam literalmente; o build volta
 * a funcionar em qualquer CLI, e não só nas duas que aceitam servidor por
 * invocação; e o custo é zero até alguém abrir o arquivo.
 *
 * A seleção por área é o outro lado: carregar uma skill de frontend para
 * construir um backend é contexto pago que compete com o que importa, e aumenta
 * a chance de o modelo seguir o conselho errado. Quem escolhe não é modelo
 * nenhum — é o cruzamento de duas listas fechadas.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { McpDocument } from "./client.js";

/** Onde as skills são materializadas, relativo à raiz do projeto. */
export const SKILLS_DIR = join(".capivara", "skills");

/** A base de um pacote, com o nome que a skill espera ver. */
export const ARQUIVO_BASE = "SKILL.md";

export const AREAS = ["frontend", "backend", "dados", "infra", "qualidade", "geral"] as const;
export type Area = (typeof AREAS)[number];

export function areaValida(valor: string): Area {
  const limpo = valor.trim().toLowerCase();
  return (AREAS as readonly string[]).includes(limpo) ? (limpo as Area) : "geral";
}

/** `capivara://p/docs/skill/frontend-design` → `frontend-design`. */
export function slugDaSkill(uri: string): string {
  return uri.split("/").pop() ?? "skill";
}

export interface SkillMaterializada {
  slug: string;
  /** Caminho da pasta, relativo à raiz do projeto. */
  pasta: string;
  /** Quantos arquivos além da base. */
  arquivos: number;
  bytes: number;
}

/**
 * Escreve a skill no projeto.
 *
 * A pasta é apagada antes: uma skill atualizada que perdeu um arquivo não pode
 * deixar o arquivo velho para trás, porque o `SKILL.md` novo não o cita e
 * ninguém iria olhar para ele de novo.
 */
export async function materializarSkill(projectRoot: string, documento: McpDocument): Promise<SkillMaterializada> {
  const slug = slugDaSkill(documento.uri);
  const pasta = join(SKILLS_DIR, slug);
  const absoluta = join(projectRoot, pasta);

  await rm(absoluta, { recursive: true, force: true });
  await mkdir(absoluta, { recursive: true });

  const base = Buffer.from(documento.text, "utf8");
  await writeFile(join(absoluta, ARQUIVO_BASE), base);

  let bytes = base.length;
  for (const arquivo of documento.files ?? []) {
    const destino = join(absoluta, arquivo.path);
    // O caminho vem da base documental, que o operador alimenta. Escrever fora
    // da pasta da skill seria escrever onde ninguém autorizou.
    if (!destino.startsWith(absoluta)) continue;
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, arquivo.content);
    bytes += arquivo.content.length;
  }

  return { slug, pasta, arquivos: (documento.files ?? []).length, bytes };
}

export interface SelecaoDeSkills {
  /** As que entram inteiras no prompt desta fase. */
  inteiras: McpDocument[];
  /** As que ficam só no índice: existem, o modelo sabe, mas não custam contexto. */
  noIndice: McpDocument[];
  /** O que o teto deixou de fora, para o log poder dizer. */
  cortadas: string[];
}

export interface TetoDeContexto {
  /** Quantos bytes de skill cabem no prompt de uma fase. */
  maxBytes?: number;
  maxSkills?: number;
}

/**
 * Quais skills entram nesta fase.
 *
 * A área da skill cruza com as áreas da fase; `geral` entra sempre, porque é o
 * que serve a tudo. O teto existe porque mesmo a área certa pode crescer: oito
 * skills de 4 KB são 32 KB repetidos a cada ciclo de correção, e no dia em que o
 * catálogo dobrar o custo subiria sem ninguém perceber.
 *
 * O que o teto corta não desaparece: vai para o índice, e o log diz o que ficou
 * de fora. Uma skill escondida em silêncio é pior que uma skill ausente.
 */
export function escolherSkills(
  skills: readonly McpDocument[],
  areasDaFase: readonly string[],
  teto: TetoDeContexto = {},
): SelecaoDeSkills {
  const maxBytes = teto.maxBytes ?? 24_000;
  const maxSkills = teto.maxSkills ?? 4;

  const alvo = new Set(areasDaFase.map((area) => areaValida(area)));
  const serve = (documento: McpDocument): boolean => {
    const area = areaValida(documento.area ?? "geral");
    return area === "geral" || alvo.has(area);
  };

  /*
   * A ordem decide quem cabe: a skill da área específica da fase vem antes da
   * geral. Uma skill de frontend numa fase de frontend é mais relevante que um
   * conselho que vale para tudo, e quando o teto aperta é a geral que cede.
   */
  const candidatas = skills
    .filter(serve)
    .sort((esquerda, direita) => {
      const peso = (documento: McpDocument): number => (areaValida(documento.area ?? "geral") === "geral" ? 1 : 0);
      return peso(esquerda) - peso(direita) || esquerda.name.localeCompare(direita.name);
    });

  const inteiras: McpDocument[] = [];
  const cortadas: string[] = [];
  let usados = 0;

  for (const documento of candidatas) {
    const tamanho = Buffer.byteLength(documento.text, "utf8");
    if (inteiras.length < maxSkills && usados + tamanho <= maxBytes) {
      inteiras.push(documento);
      usados += tamanho;
      continue;
    }
    cortadas.push(documento.name);
  }

  const escolhidas = new Set(inteiras.map((documento) => documento.uri));
  return { inteiras, noIndice: skills.filter((documento) => !escolhidas.has(documento.uri)), cortadas };
}

/**
 * O bloco que vai ao prompt da fase.
 *
 * As inteiras entram com o texto e com o caminho da pasta — é isso que permite
 * ao modelo abrir `references/typography.md` sem ferramenta nova. As do índice
 * aparecem com nome e quando usar: o modelo fica sabendo que existem, e pedir
 * custa um `Read`, não uma sessão.
 */
export function renderSkillBlock(selecao: SelecaoDeSkills, pastaPorUri: Map<string, string>): string {
  if (selecao.inteiras.length === 0 && selecao.noIndice.length === 0) return "";

  const linhas: string[] = ["## Skills desta fase", ""];

  for (const documento of selecao.inteiras) {
    const pasta = pastaPorUri.get(documento.uri) ?? "";
    linhas.push(`### ${documento.name}`);
    if (pasta !== "") {
      linhas.push(
        "",
        `Os arquivos desta skill estão em \`${pasta}/\`. Os caminhos citados abaixo são relativos a essa pasta:`,
        `leia \`${pasta}/references/…\` com a ferramenta de leitura quando o texto mandar consultar.`,
      );
    }
    linhas.push("", documento.text.trim(), "");
  }

  if (selecao.noIndice.length > 0) {
    linhas.push("### Outras skills disponíveis", "");
    linhas.push("Não estão abertas aqui. Leia a que servir, pelo caminho indicado:");
    for (const documento of selecao.noIndice) {
      const pasta = pastaPorUri.get(documento.uri) ?? "";
      linhas.push(`- **${documento.name}** — \`${pasta}/${ARQUIVO_BASE}\``);
    }
    linhas.push("");
  }

  return linhas.join("\n");
}
