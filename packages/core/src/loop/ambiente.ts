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

  await writeFile(destino, exemplo, "utf8");
  return (
    `${ARQUIVO_DE_AMBIENTE} não existia e foi criado a partir de ${EXEMPLO_DE_AMBIENTE}: ` +
    "os gates precisam da aplicação configurada para subir. São os valores de exemplo, descartáveis — " +
    "edite-o quando quiser apontar para o seu banco, e ele não será sobrescrito."
  );
}
