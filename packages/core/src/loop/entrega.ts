/**
 * A entrega final, proporcional (§125 G; spec §10).
 *
 * Sem G5: a aceitação operacional já prova, numa cópia limpa, que o produto
 * instala, compila, prepara (migra) e sobe — sem repetir a suíte que cada fase
 * já provou. O que faltava era dizer a quem recebe COMO rodar e o que NÃO foi
 * provado. Este módulo monta isso do que aconteceu: os passos que a aceitação
 * executou, o ambiente que o projeto versiona e as lacunas de preparação que o
 * PLAN permite detectar. Nada é inventado: passo que não rodou não vira
 * instrução, e o que não se pode afirmar vira limitação.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AcceptanceResult } from "./acceptance.js";
import { readEnvironmentPlanExtras } from "./environment-plan.js";

/** Os bancos que a infraestrutura do PLAN declara (`environment.json`), pelo nome. */
export async function bancosDoPlano(projectRoot: string): Promise<string[]> {
  const { infrastructure } = await readEnvironmentPlanExtras(projectRoot);
  const bancos = (infrastructure as { databases?: unknown } | undefined)?.databases;
  if (!Array.isArray(bancos)) return [];
  return bancos
    .map((banco) => (banco && typeof banco === "object" && typeof (banco as { name?: unknown }).name === "string" ? (banco as { name: string }).name.trim() : ""))
    .filter((nome) => nome !== "");
}

/**
 * O que a preparação inicial do produto não prova, pelo que o PLAN declara.
 *
 * Banco declarado sem script `migrate` não é reprovação — o produto pode
 * criar o esquema ao subir, e a aceitação o sobe —, mas também não é
 * preparação provada: fica dito.
 */
export async function lacunasDaPreparacao(projectRoot: string, acceptance: AcceptanceResult | null): Promise<string[]> {
  const lacunas: string[] = [];
  const bancos = await bancosDoPlano(projectRoot);
  const migrou = acceptance?.steps.some((passo) => passo.id === "migrate" && passo.exitCode === 0) === true;
  const subiu = acceptance?.steps.some((passo) => passo.id === "start" && passo.exitCode === 0) === true;
  if (bancos.length > 0 && !migrou) {
    lacunas.push(
      `o PLAN declara ${bancos.join(", ")}, e o projeto não tem uma migração que a aceitação tenha rodado` +
        `${subiu ? ": a preparação do banco só foi provada pela subida do serviço" : ": a preparação do banco não foi provada"}`,
    );
  }
  if (acceptance?.accepted === true && acceptance.skipped !== "") lacunas.push(`aceitação operacional: ${acceptance.skipped}`);
  return lacunas;
}

export interface Entrega {
  instrucoes: string[];
  limitacoes: string[];
}

/** As instruções de execução e as limitações conhecidas, do que de fato rodou. */
export async function montarEntrega(projectRoot: string, acceptance: AcceptanceResult | null, outras: readonly string[] = []): Promise<Entrega> {
  const instrucoes: string[] = [];
  if (await readFile(join(projectRoot, ".env.example"), "utf8").then(() => true, () => false)) {
    instrucoes.push("copie `.env.example` para `.env` e ajuste os valores do seu ambiente (a aceitação usou o exemplo, nunca o seu `.env`)");
  }
  for (const passo of acceptance?.steps ?? []) {
    if (passo.exitCode !== 0) continue;
    const rotulo = passo.id === "install" ? "instale as dependências" : passo.id === "build" ? "compile" : passo.id === "migrate" ? "prepare o banco" : passo.id === "start" ? "suba a aplicação" : passo.id;
    instrucoes.push(`${rotulo}: \`${passo.command}\``);
  }
  const limitacoes = [...(await lacunasDaPreparacao(projectRoot, acceptance)), ...outras];
  if (acceptance === null) limitacoes.push("a aceitação operacional não rodou (--no-acceptance): nada foi provado numa cópia limpa");
  return { instrucoes, limitacoes };
}

export function renderEntrega(runId: string, entrega: Entrega): string {
  return [
    `# Entrega do build ${runId}`,
    "",
    "## Como rodar",
    "",
    ...(entrega.instrucoes.length > 0 ? entrega.instrucoes.map((linha) => `- ${linha}`) : ["- a aceitação não executou nenhum passo; não há instrução comprovada"]),
    "",
    "## Limitações conhecidas",
    "",
    ...(entrega.limitacoes.length > 0 ? entrega.limitacoes.map((linha) => `- ${linha}`) : ["- nenhuma registrada"]),
    "",
  ].join("\n");
}
