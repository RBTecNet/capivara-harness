/**
 * Os agentes do build paralelo estão de fato isolados? (§97)
 *
 * O worktree separa os ARQUIVOS. O que ele não separa é o que mora fora da
 * árvore: um banco num servidor, contêineres com nome fixo, uma pasta de
 * dependências que não é copiável. Duas suítes rodando ao mesmo tempo contra o
 * mesmo banco se reprovam uma à outra — e o defeito apareceria como "a fase 3
 * quebrou o cadastro", que é o diagnóstico errado.
 *
 * A pergunta é refeita ANTES DE CADA FASE sair, e não só no começo: num
 * greenfield o `.env.example` que declara o banco só passa a existir quando a
 * fase 1 o escreve. Quando a resposta é não, o build não finge: a concorrência
 * cai para um agente, a tela diz por quê, e o que já está rodando termina.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { bancosDeclarados } from "./passagem.js";
import { suportaWorktree } from "./worktree.js";

export interface Isolamento {
  ok: boolean;
  /**
   * O que torna o paralelo IMPOSSÍVEL aqui, e não só arriscado: sem Git não há
   * worktree. Com isto preenchido, o build paralelo nem começa — rodar serial
   * com o nome de paralelo seria mentir na tela.
   */
  impedimentos: string[];
  /** Por que agentes paralelos se atrapalhariam aqui, agora. Faz a concorrência cair para um. */
  motivos: string[];
  /** O que vale saber e não impede. */
  limitacoes: string[];
}

/** Valor que aponta para um banco servido por rede, e não para um arquivo. */
const ESQUEMA_DE_SERVIDOR = /^(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|sqlserver|mssql|amqp|cockroachdb):\/\//i;
/** Chaves que, por convenção, dizem onde o banco está. */
const CHAVE_DE_BANCO = /^(?:DATABASE_URL|DB_HOST|DB_URL|PGHOST|POSTGRES_(?:HOST|URL)|MYSQL_(?:HOST|URL)|MARIADB_HOST|MONGO(?:DB)?_(?:URI|URL|HOST)|REDIS_(?:URL|HOST))$/i;

/**
 * As chaves de ambiente que apontam para um servidor de banco.
 *
 * Lidas do `.env.example`, que o projeto versiona por regra, e do `.env`. O
 * banco em ARQUIVO não entra: o gate 4 já dá um arquivo novo a cada passagem, e
 * a suíte que usa SQLite em arquivo usa o arquivo do worktree dela.
 */
export async function servidoresDeBanco(root: string): Promise<string[]> {
  const emArquivo = new Set(Object.keys(await bancosDeclarados(root)));
  const chaves = new Set<string>();
  for (const nome of [".env.example", ".env"]) {
    const conteudo = await readFile(join(root, nome), "utf8").catch(() => "");
    for (const linha of conteudo.split("\n")) {
      const casou = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
      if (!casou?.[1] || emArquivo.has(casou[1])) continue;
      const valor = (casou[2] ?? "").replace(/^['"]|['"]$/g, "");
      if (valor === "") continue;
      if (ESQUEMA_DE_SERVIDOR.test(valor) || CHAVE_DE_BANCO.test(casou[1])) chaves.add(casou[1]);
    }
  }
  return [...chaves].sort();
}

async function existe(caminho: string): Promise<boolean> {
  return stat(caminho).then(() => true, () => false);
}

export interface ContextoDoIsolamento {
  /** Há repositório e o build commita: sem isso não há worktree nem integração. */
  commitsEnabled: boolean;
  /** A suíte do gate 2 sobe contêineres. */
  containerized?: boolean;
}

export async function conferirIsolamento(root: string, contexto: ContextoDoIsolamento): Promise<Isolamento> {
  const impedimentos: string[] = [];
  const motivos: string[] = [];
  const limitacoes: string[] = [];

  if (!contexto.commitsEnabled) {
    impedimentos.push("sem repositório Git não há worktree: cada agente precisa da própria árvore, e o trabalho dele volta por commit");
  } else if (!(await suportaWorktree(root))) {
    impedimentos.push("o git desta máquina não cria worktree (exige git 2.5 ou maior)");
  }
  if (contexto.containerized === true) {
    motivos.push("a suíte roda em contêiner: agentes paralelos subiriam os mesmos contêineres, com os mesmos nomes e portas");
  }
  const servidores = await servidoresDeBanco(root);
  if (servidores.length > 0) {
    motivos.push(
      `o projeto declara banco em servidor (${servidores.join(", ")}): as suítes de agentes paralelos rodariam contra o mesmo banco e se reprovariam uma à outra`,
    );
  }

  if ((await existe(join(root, ".venv"))) || (await existe(join(root, "vendor")))) {
    limitacoes.push("só o node_modules é copiado para cada agente; .venv e vendor são reinstalados pelo executor em cada worktree");
  }
  return { ok: impedimentos.length === 0 && motivos.length === 0, impedimentos, motivos, limitacoes };
}
