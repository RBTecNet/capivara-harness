/**
 * O que cada agente do build paralelo escreveu, e o que aconteceu com ele.
 *
 * Um buffer POR AGENTE, em instâncias separadas: a saída de um nunca passa pelo
 * buffer de outro, porque quem escreve aqui já chega dizendo de qual agente é —
 * o número vem da chamada (`EngineCall.worker`), nunca de ler o texto.
 *
 * O buffer é LIMITADO. Um agente que despeja megabytes de JSONL por minuto não
 * pode levar a memória do processo junto: guardam-se as últimas linhas, e a
 * contagem das que saíram aparece na tela, com o caminho do arquivo onde o log
 * inteiro está. O arquivo é a cópia completa; isto é a janela.
 *
 * Os eventos do agente são montados a partir dos eventos ESTRUTURADOS do loop
 * (o agente pegou a fase, o gate mudou, a integração terminou). Nada aqui lê a
 * prosa do modelo para adivinhar o estado de alguém.
 */

import { sanitizarTerminal } from "./sanitize.js";

export type FonteDoLog = "out" | "err" | "harness";

export interface LinhaDeLog {
  fonte: FonteDoLog;
  /** Já sanitizada: pode ir ao terminal como está. */
  texto: string;
}

export interface LimitesDoLog {
  /** Quantas linhas ficam na memória por agente. */
  linhas: number;
  /** Acima disto a linha é cortada na memória (o arquivo guarda inteira). */
  caracteres: number;
}

export const LIMITES_PADRAO: LimitesDoLog = { linhas: 2000, caracteres: 1000 };

function cortar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite)} … (+${texto.length - limite} caracteres; a linha inteira está no arquivo do log)`;
}

export class LogDoAgente {
  private readonly linhas: LinhaDeLog[] = [];
  /** O pedaço de linha que ainda não terminou, por fluxo: stdout e stderr nunca se emendam. */
  private readonly parcial: Record<"out" | "err", string> = { out: "", err: "" };
  private descartadasAteAqui = 0;
  /** Muda a cada escrita; quem desenha compara para saber se há o que redesenhar. */
  versao = 0;

  constructor(private readonly limites: LimitesDoLog = LIMITES_PADRAO) {}

  /** Uma linha do HARNESS — início e fim de chamada —, distinta do que o agente escreveu. */
  marcar(texto: string): void {
    this.fecharParciais();
    this.empurrar({ fonte: "harness", texto: cortar(sanitizarTerminal(texto).replace(/\n/g, " "), this.limites.caracteres) });
  }

  anexar(fonte: "out" | "err", pedaco: string): void {
    if (pedaco === "") return;
    const junto = this.parcial[fonte] + pedaco;
    const partes = junto.split("\n");
    this.parcial[fonte] = partes.pop() ?? "";
    for (const parte of partes) this.empurrar({ fonte, texto: cortar(sanitizarTerminal(parte), this.limites.caracteres) });
    /*
     * Linha que nunca termina — uma barra de progresso, um JSON gigante — não
     * pode crescer sem fim esperando o `\n`: passado o limite, vai como está.
     */
    if (this.parcial[fonte].length > this.limites.caracteres * 4) {
      this.empurrar({ fonte, texto: cortar(sanitizarTerminal(this.parcial[fonte]), this.limites.caracteres) });
      this.parcial[fonte] = "";
    }
    this.versao += 1;
  }

  /** Fim da chamada: o pedaço sem `\n` vira linha, para não grudar na próxima. */
  fecharParciais(): void {
    for (const fonte of ["out", "err"] as const) {
      if (this.parcial[fonte] === "") continue;
      this.empurrar({ fonte, texto: cortar(sanitizarTerminal(this.parcial[fonte]), this.limites.caracteres) });
      this.parcial[fonte] = "";
    }
  }

  private empurrar(linha: LinhaDeLog): void {
    this.linhas.push(linha);
    const excesso = this.linhas.length - this.limites.linhas;
    if (excesso > 0) {
      this.linhas.splice(0, excesso);
      this.descartadasAteAqui += excesso;
    }
    this.versao += 1;
  }

  /** As linhas guardadas, mais os pedaços ainda abertos — é o que está acontecendo agora. */
  ver(): LinhaDeLog[] {
    const abertos = (["out", "err"] as const)
      .filter((fonte) => this.parcial[fonte] !== "")
      .map((fonte) => ({ fonte, texto: cortar(sanitizarTerminal(this.parcial[fonte]), this.limites.caracteres) }));
    return [...this.linhas, ...abertos];
  }

  /** Quantas linhas saíram da memória por causa do limite. */
  get descartadas(): number {
    return this.descartadasAteAqui;
  }
}

export interface EventoDoAgente {
  /** `HH:MM:SS`, do relógio de quem olha. */
  hora: string;
  texto: string;
}

export class EventosDoAgente {
  private readonly lista: EventoDoAgente[] = [];
  versao = 0;

  constructor(private readonly limite = 200) {}

  registrar(texto: string, quando: Date): void {
    this.lista.push({ hora: quando.toLocaleTimeString("pt-BR", { hour12: false }), texto: sanitizarTerminal(texto).replace(/\n/g, " ") });
    if (this.lista.length > this.limite) this.lista.splice(0, this.lista.length - this.limite);
    this.versao += 1;
  }

  ver(): EventoDoAgente[] {
    return [...this.lista];
  }
}

/** Um log e uma lista de eventos por agente, criados juntos e nunca compartilhados. */
export class LogsDosAgentes {
  private readonly logs: LogDoAgente[];
  private readonly eventos: EventosDoAgente[];
  /** Quando a chamada corrente de cada agente começou; nulo quando não há chamada. */
  private readonly chamada: (number | null)[];

  constructor(quantos: number, limites: LimitesDoLog = LIMITES_PADRAO) {
    this.logs = Array.from({ length: quantos }, () => new LogDoAgente(limites));
    this.eventos = Array.from({ length: quantos }, () => new EventosDoAgente());
    this.chamada = Array.from({ length: quantos }, () => null);
  }

  get quantos(): number {
    return this.logs.length;
  }

  log(slot: number): LogDoAgente | undefined {
    return this.logs[slot];
  }

  eventosDe(slot: number): EventosDoAgente | undefined {
    return this.eventos[slot];
  }

  comecarChamada(slot: number, descricao: string, agora: number): void {
    this.chamada[slot] = agora;
    this.logs[slot]?.marcar(`▶ ${descricao}`);
  }

  terminarChamada(slot: number, descricao: string): void {
    this.chamada[slot] = null;
    this.logs[slot]?.marcar(`■ ${descricao}`);
  }

  /** Desde quando a chamada corrente roda, em ms; nulo quando o agente não está chamando ninguém. */
  inicioDaChamada(slot: number): number | null {
    return this.chamada[slot] ?? null;
  }

  /** Muda quando qualquer coisa do agente muda. */
  versao(slot: number): number {
    return (this.logs[slot]?.versao ?? 0) + (this.eventos[slot]?.versao ?? 0);
  }
}

/**
 * O evento do agente, dito a partir dos CAMPOS do evento do loop — estado,
 * fase, desfecho —, nunca do que o modelo escreveu.
 */
export function descreverEventoDoAgente(evento: { state: "livre" | "preparando" | "trabalhando" | "integrando"; phaseId: string | null; detail: string }): string {
  switch (evento.state) {
    case "preparando":
      return `pegou ${evento.phaseId ?? "?"}: preparando o worktree`;
    case "trabalhando":
      return `trabalhando em ${evento.phaseId ?? "?"}`;
    case "integrando":
      return `integrando ${evento.phaseId ?? "?"} na árvore principal`;
    default:
      return evento.detail === "" ? "livre" : `livre · ${evento.detail}`;
  }
}

/** A mudança de fase ou de gate que o loop contou, para os eventos do agente que está nela. */
export function descreverProgressoDaFase(
  evento:
    | { kind: "phase"; id: string; state: string; detail: string }
    | { kind: "gate"; id: string; gate: string; state: string }
    | { kind: "recovery"; id: string; line: string },
): string {
  if (evento.kind === "recovery") return `${evento.id} · ${evento.line}`;
  return evento.kind === "phase"
    ? `${evento.id} · ${evento.state}${evento.detail && evento.detail !== evento.state ? ` · ${evento.detail}` : ""}`
    : `${evento.id} · ${evento.gate} ${evento.state}`;
}
