/**
 * Traduz o fim de um build para o relatório de parada.
 *
 * O build sempre soube por que parou — `outcome.errors` carrega a causa inteira
 * desde o primeiro piloto. O que faltava era responder às perguntas que quem lê
 * faz em seguida, e que até agora só se respondiam abrindo `.capivara/` na mão:
 * de quem é o defeito, o que já foi gasto, e o que fazer agora.
 *
 * Classificar é a parte que importa. "A suíte falhou" e "o runner de testes não
 * está instalado" saem do mesmo gate e mandam pessoas diferentes trabalhar —
 * uma mexe no código, a outra instala um pacote e reexecuta. Errar essa
 * atribuição foi, em todos os pilotos, mais caro do que a falha em si.
 */

import { join } from "node:path";

import type { Conclusao, NaturezaDaParada, Parada } from "../tui/parada.js";
import type { BuildOutcome, PhaseReport } from "./build.js";

/**
 * Marcas de que a causa é do ambiente, não do produto.
 *
 * Todas vêm de textos que o próprio harness escreve (gates.ts, flows.ts): não
 * adivinhamos a partir da saída do executor, lemos a classificação que o gate já
 * fez. Ler a mensagem do gate é frágil de propósito — o teste abaixo quebra se
 * alguém reescrever o texto sem reescrever isto aqui.
 */
const MARCAS_DE_AMBIENTE = [
  /NÃO ESTÁ INSTALADO neste ambiente/i,
  /Isto é do ambiente, não do seu código/i,
  /não está instalado/i,
  /porta \d+ está ocupada/i,
];

export interface ContextoDaParada {
  /** Quantas fases o plano tem, incluindo as que já estavam fechadas. */
  totalDeFases?: number;
  /** Fases que já estavam fechadas quando este build começou. */
  fechadasAntes?: number;
}

function ultimaFalha(phases: PhaseReport[]): PhaseReport | null {
  for (let indice = phases.length - 1; indice >= 0; indice -= 1) {
    const fase = phases[indice]!;
    if (fase.outcome.status === "failed" || fase.outcome.status === "rate-limit-exhausted" || fase.outcome.status === "credential-rejected") {
      return fase;
    }
  }
  return null;
}

function fechadas(phases: PhaseReport[]): PhaseReport[] {
  return phases.filter((fase) => fase.outcome.status === "complete" || fase.outcome.status === "already-implemented");
}

/** A primeira linha da causa; o resto vai para o detalhe. */
function resumo(causa: string): string {
  return (causa.split("\n")[0] ?? causa).trim();
}

function detalhe(causa: string): string {
  return causa.split("\n").slice(1).join("\n").trim();
}

function ehDoAmbiente(causa: string): boolean {
  return MARCAS_DE_AMBIENTE.some((marca) => marca.test(causa));
}

/**
 * De quem é a falha de uma fase.
 *
 * O gate 0 é o único que fala da sessão do modelo: ele reprova quando o executor
 * não devolveu nada utilizável. Os outros três olham o produto — a menos que o
 * próprio gate tenha dito que o defeito é do ambiente.
 */
function naturezaDaFase(fase: PhaseReport): NaturezaDaParada {
  if (fase.outcome.status === "rate-limit-exhausted") return "ambiente";
  // Sem isto caía em "produto", e a tela mandava corrigir o código de uma fase
  // cujo código ninguém chegou a julgar.
  if (fase.outcome.status === "credential-rejected") return "ambiente";
  if (fase.outcome.status !== "failed") return "produto";
  if (ehDoAmbiente(fase.outcome.cause)) return "ambiente";
  return fase.outcome.gate.startsWith("gate 0") ? "modelo" : "produto";
}

/** O log que prova a falha, escolhido pelo gate que reprovou. */
function evidenciaDaFase(runId: string, fase: PhaseReport): string[] {
  const logs = join(".capivara", "runs", runId, "logs");
  const eventos = join(".capivara", "runs", runId, "events.tsv");
  if (fase.outcome.status !== "failed") return [eventos];

  const ciclo = fase.outcome.cycles;
  const gate = fase.outcome.gate;
  const arquivo = gate.startsWith("gate 4")
    ? `${fase.id}.flow-run-${ciclo}.log`
    : gate.startsWith("gate 3")
      ? `${fase.id}.verify-${ciclo}.log`
      : `${fase.id}.cycle-${ciclo}.log`;

  return [join(logs, arquivo), eventos];
}

function contarCusto(outcome: BuildOutcome, contexto: ContextoDaParada): string {
  const novas = fechadas(outcome.phases).length;
  const antes = contexto.fechadasAntes ?? 0;
  const total = contexto.totalDeFases;

  if (novas === 0 && antes === 0) return "nenhuma fase fechada ainda";

  const fechadasNoTotal = novas + antes;
  const denominador = total !== undefined ? ` de ${total}` : "";
  const preservadas = "elas não serão refeitas — o build reconhece o texto delas";
  return `${fechadasNoTotal}${denominador} fase(s) fechada(s); ${preservadas}`;
}

/**
 * O que fazer agora, com o comando que retoma.
 *
 * O segundo passo é sempre o mesmo comando, e é o ponto todo: o que mais assusta
 * numa parada não é a falha, é não saber se o trabalho das últimas seis horas
 * continua valendo.
 */
function comoSeguir(natureza: NaturezaDaParada, fase: PhaseReport | null): string[] {
  const retoma = fase
    ? `rode \`capivara build\` — retoma de ${fase.id}, sem refazer as fases já fechadas`
    : "rode `capivara build` — as fases já fechadas não são refeitas";

  switch (natureza) {
    case "ambiente":
      return ["resolva a dependência de ambiente apontada acima; nada no seu código precisa mudar", retoma];
    case "modelo":
      return ["a sessão não entregou saída utilizável; o texto da fase continua válido", retoma];
    case "produto":
      return ["leia a evidência: é o produto que está reprovando, e a correção é no código", retoma];
    default:
      return [retoma];
  }
}

export type RelatorioDoBuild = { tipo: "conclusao"; conclusao: Conclusao } | { tipo: "parada"; parada: Parada };

export function relatorioDoBuild(outcome: BuildOutcome, contexto: ContextoDaParada = {}): RelatorioDoBuild {
  const fechadasAgora = fechadas(outcome.phases).length + (contexto.fechadasAntes ?? 0);

  if (outcome.exitCode === 0) {
    return {
      tipo: "conclusao",
      conclusao: {
        oQue:
          !outcome.acceptance?.accepted || outcome.acceptance.skipped !== ""
            ? `todas as ${fechadasAgora} fase(s) fecharam`
            : `todas as ${fechadasAgora} fase(s) fecharam e a aplicação sobe a partir de uma cópia limpa`,
        custou: `${fechadasAgora} fase(s) implementadas e verificadas`,
        evidencia: [join(".capivara", "runs", outcome.runId)],
        paraSeguir: ["a aplicação está no seu repositório, com a especificação versionada junto"],
      },
    };
  }

  /*
   * Código 1 não é falha: é um passo fora de ordem. Dizer "PAROU — defeito" para
   * quem esqueceu de rodar o init manda a pessoa procurar um problema que não
   * existe.
   */
  if (outcome.exitCode === 1) {
    const causa = outcome.errors[0] ?? "o build não pôde começar";
    return {
      tipo: "parada",
      parada: {
        natureza: "decisão",
        oQue: resumo(causa),
        deQuem: "de ninguém: falta uma etapa antes desta",
        custou: "nenhuma sessão gasta — o build nem começou",
        paraSeguir: [resumo(causa).includes("capivara init") ? "rode `capivara init` e depois `capivara plan`" : "resolva o que está acima e rode `capivara build`"],
        ...(detalhe(causa) !== "" ? { detalhe: detalhe(causa) } : {}),
      },
    };
  }

  const fase = ultimaFalha(outcome.phases);
  const causa = outcome.errors[0] ?? "o build pausou";

  // Sem fase falhada e com código 2, quem reprovou foi a aceitação operacional:
  // as fases estão todas verdes e o produto não sobe.
  if (!fase) {
    return {
      tipo: "parada",
      parada: {
        natureza: "produto",
        oQue: `a aceitação operacional reprovou: ${resumo(causa)}`,
        deQuem: "do produto: as fases fecharam, mas a aplicação não sobe de uma cópia limpa",
        custou: contarCusto(outcome, contexto),
        evidencia: [join(".capivara", "runs", outcome.runId, "events.tsv")],
        paraSeguir: ["a instalação, a migração ou a subida falharam numa pasta limpa — leia a evidência", "rode `capivara build` — as fases fechadas não são refeitas"],
        ...(detalhe(causa) !== "" ? { detalhe: detalhe(causa) } : {}),
      },
    };
  }

  const natureza = naturezaDaFase(fase);
  const ciclos = fase.outcome.status === "failed" ? fase.outcome.cycles : 0;
  const gasto = contarCusto(outcome, contexto);

  if (fase.outcome.status === "credential-rejected") {
    const provider = fase.outcome.engine;
    return {
      tipo: "parada",
      parada: {
        natureza: "ambiente",
        oQue: `${fase.id} parou porque o provider ${provider} recusou a credencial`,
        deQuem: "da credencial do provider — o código desta fase não chegou a ser julgado por ela",
        custou: gasto,
        evidencia: evidenciaDaFase(outcome.runId, fase),
        paraSeguir: [
          `renove a credencial: \`${provider} login\``,
          "se a fase deixou trabalho na árvore: `git add -A && git commit -m \"wip: trabalho parcial\"` — o loop revalida e segue",
          `rode \`capivara build\` — retoma de ${fase.id}, sem refazer as fases já fechadas`,
        ],
        detalhe: fase.outcome.evidence,
      },
    };
  }

  return {
    tipo: "parada",
    parada: {
      natureza,
      oQue:
        fase.outcome.status === "rate-limit-exhausted"
          ? `${fase.id} parou no limite de uso do provedor`
          : `${fase.id} — ${resumo(causa)}`,
      ...(fase.outcome.status === "rate-limit-exhausted"
        ? { deQuem: "da cota do provedor; nada do que foi feito se perdeu" }
        : {}),
      custou: ciclos > 0 ? `${gasto}. ${fase.id} gastou ${ciclos} ciclo(s) de correção` : gasto,
      evidencia: evidenciaDaFase(outcome.runId, fase),
      paraSeguir: comoSeguir(natureza, fase),
      ...(detalhe(causa) !== "" ? { detalhe: detalhe(causa) } : {}),
    },
  };
}
