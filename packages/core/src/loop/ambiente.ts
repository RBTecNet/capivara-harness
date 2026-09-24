/**
 * O `.env` que o produto lê e que ninguém criou.
 *
 * A regra transversal do banco (§46) manda o projeto ler toda a configuração do
 * ambiente e versionar um `.env.example` — nunca o `.env`, que é de quem roda.
 * Isso deixa um buraco exatamente onde o harness trabalha: o executor entrega o
 * exemplo, o `.env` não existe em máquina nenhuma, e a aplicação sobe sem saber
 * onde está o banco.
 *
 * O estrago não aparece como erro de configuração. No primeiro projeto a usar a
 * regra, o servidor registrou `DB_NAME deve indicar um nome de arquivo...`, a
 * página veio vazia, e o que o gate 4 relatou foi "a aplicação não cumpriu um
 * fluxo declarado" com um seletor que não achou o campo. O executor foi
 * consertar um formulário que estava certo.
 *
 * A aceitação operacional já resolvia isto na cópia limpa, semeando o `.env` a
 * partir do exemplo. Faltava no irmão — os gates, que rodam na pasta do projeto
 * — e é a mesma correção pela metade que este projeto já pagou duas vezes.
 *
 * Duas coisas que não se negociam: nunca sobrescrever um `.env` existente, que é
 * do desenvolvedor e pode apontar para o banco dele; e nunca inventar valor
 * nenhum — o que entra é o exemplo versionado, que por regra não tem credencial.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ARQUIVO_DE_AMBIENTE = ".env";
export const EXEMPLO_DE_AMBIENTE = ".env.example";

/**
 * A marca que diz "este ambiente é nosso".
 *
 * Ela existe para uma decisão só, e é a mais séria deste módulo: o harness roda
 * a migração do projeto antes dos gates, e migração cria e altera esquema. Fazer
 * isso contra o `.env` que o DESENVOLVEDOR escreveu seria mexer no banco dele —
 * exatamente o que a regra do §46 promete que nunca acontece.
 *
 * Então o harness só migra o ambiente que ele mesmo criou, e a marca é como ele
 * reconhece o próprio. Um `.env` sem marca é de quem o escreveu: semear, migrar
 * ou sobrescrever, nenhum dos três.
 */
export const MARCA_DO_HARNESS = "# capivara: ambiente descartável dos gates, gerado de .env.example — apague esta linha para assumi-lo";

/**
 * Cria o `.env` a partir do `.env.example`, quando ele falta.
 *
 * Devolve a mensagem para anunciar, ou `null` quando não havia o que fazer —
 * porque o `.env` já existe, porque não há exemplo, ou porque o exemplo está
 * vazio. Silêncio quando nada acontece: anunciar "não fiz nada" a cada ciclo é
 * ruído que ninguém lê.
 */
export async function semearAmbiente(projectRoot: string): Promise<string | null> {
  const destino = join(projectRoot, ARQUIVO_DE_AMBIENTE);
  const jaExiste = await readFile(destino, "utf8").then(() => true).catch(() => false);
  if (jaExiste) return null;

  const exemplo = await readFile(join(projectRoot, EXEMPLO_DE_AMBIENTE), "utf8").catch(() => null);
  if (exemplo === null || exemplo.trim() === "") return null;

  await writeFile(destino, `${MARCA_DO_HARNESS}\n${exemplo}`, "utf8");
  return (
    `${ARQUIVO_DE_AMBIENTE} não existia e foi criado a partir de ${EXEMPLO_DE_AMBIENTE}: ` +
    "os gates precisam da aplicação configurada para subir. São os valores de exemplo, descartáveis — " +
    "edite-o quando quiser apontar para o seu banco, e ele não será sobrescrito."
  );
}

/** O `.env` que está lá é o que o harness gerou? */
export async function ambienteEhDescartavel(projectRoot: string): Promise<boolean> {
  const conteudo = await readFile(join(projectRoot, ARQUIVO_DE_AMBIENTE), "utf8").catch(() => null);
  return conteudo !== null && conteudo.startsWith(MARCA_DO_HARNESS);
}

/**
 * O comando de migração que o PROJETO declara.
 *
 * Declara, nunca adivinhado: rodar um comando que o projeto não anunciou é a
 * mesma classe de suposição que já derrubou uma aplicação antes (o gate subindo
 * o produto com `NODE_ENV=test`). Se não houver `migrate` no manifesto, não há
 * migração a rodar — e a regra do §46 manda que haja.
 */
export async function comandoDeMigracao(projectRoot: string): Promise<string | null> {
  const manifesto = await readFile(join(projectRoot, "package.json"), "utf8").catch(() => null);
  if (manifesto === null) return null;

  const scripts = (JSON.parse(manifesto) as { scripts?: Record<string, unknown> }).scripts ?? {};
  return typeof scripts.migrate === "string" && scripts.migrate.trim() !== "" ? "npm run migrate" : null;
}

export interface PreparoDoAmbiente {
  /** O que contar na tela, em ordem. */
  anuncios: string[];
  /** A migração rodou e falhou de um jeito que importa; a saída dela. */
  migracaoFalhou: string | null;
  /** A saída inteira da migração, para ir ao disco. Vazio quando ela não rodou. */
  saidaDaMigracao: string;
}

/**
 * A migração não conectou — e isso, contra o ambiente de exemplo, é o esperado.
 *
 * O `.env.example` de um projeto que usa servidor carrega valores INOFENSIVOS
 * por regra: `servidor.exemplo.invalid`, `usuario_exemplo`. Semear esse exemplo e
 * mandar migrar produz exatamente isto — e anunciar "FALHOU" em letras garrafais
 * manda procurar um defeito que não existe.
 *
 * O que DEVE gritar é a migração que conecta e quebra: SQL errado, tabela que
 * falta, esquema que não se aplica. Essa é do produto.
 */
export function naoConectou(saida: string): boolean {
  return /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|getaddrinfo|Access denied|Unknown database|connect ECONN|não foi possível conectar|could not connect/i.test(
    saida,
  );
}

/**
 * O ambiente dos gates, pronto: configuração e esquema.
 *
 * Os dois juntos porque metade não serve para nada. Com o `.env` semeado e sem
 * migração, a aplicação sobe, conecta num banco vazio e responde
 * `no such table: clientes` a cada requisição — que foi o que aconteceu no
 * `teste`, e é a mesma correção pela metade de sempre: eu escrevi a primeira
 * metade ontem e deixei a segunda para o log descobrir.
 *
 * Roda a cada ciclo porque cada fase acrescenta tabela, e a regra do §46 exige
 * que a migração possa ser repetida sem erro.
 */
export async function prepararAmbiente(
  projectRoot: string,
  executar?: (comando: string, cwd: string) => Promise<{ exitCode: number; output: string }>,
): Promise<PreparoDoAmbiente> {
  const anuncios: string[] = [];

  const semeado = await semearAmbiente(projectRoot);
  if (semeado !== null) anuncios.push(semeado);

  const nada = { anuncios, migracaoFalhou: null, saidaDaMigracao: "" };
  if (executar === undefined) return nada;
  if (!(await ambienteEhDescartavel(projectRoot))) return nada;

  const comando = await comandoDeMigracao(projectRoot);
  if (comando === null) return nada;

  const resultado = await executar(comando, projectRoot);
  if (resultado.exitCode === 0) {
    anuncios.push(`esquema do banco aplicado com \`${comando}\` no ambiente descartável dos gates`);
    return { anuncios, migracaoFalhou: null, saidaDaMigracao: resultado.output };
  }

  if (naoConectou(resultado.output)) {
    anuncios.push(
      `\`${comando}\` não conectou, e contra este ambiente isso é o esperado: o ${ARQUIVO_DE_AMBIENTE} é o ` +
        `${EXEMPLO_DE_AMBIENTE} do projeto, que por regra traz valores de exemplo e não um servidor de verdade. ` +
        "Nada a corrigir aqui — os gates rodam contra o banco descartável que a própria suíte cria.",
    );
    return { anuncios, migracaoFalhou: null, saidaDaMigracao: resultado.output };
  }

  const saida = resultado.output.split("\n").slice(-20).join("\n").trim();
  anuncios.push(`\`${comando}\` FALHOU (código ${resultado.exitCode}); os gates vão rodar contra um banco sem esquema:\n${saida}`);
  return { anuncios, migracaoFalhou: saida, saidaDaMigracao: resultado.output };
}
