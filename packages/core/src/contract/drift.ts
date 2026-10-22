/**
 * O que uma emenda mudou além do que foi pedido.
 *
 * Instrução de prompt não é garantia. "Mude apenas o que os findings citam"
 * estava escrito e o modelo reescrevia a fase inteira mesmo assim — no piloto 3,
 * um finding sobre número de tasks voltou com contagem de critérios diferente em
 * tasks que ninguém tinha citado.
 *
 * Isto é conferível em código, então é conferido em código: as tasks que nenhum
 * finding nomeia precisam voltar iguais. O que sobrar é deriva, e deriva volta
 * para quem a produziu com o desvio nomeado.
 */

import { parsePhases } from "./phases.js";
import type { PhaseBlock, TaskBlock } from "./phases.js";
import { planAddresses } from "./phase-references.js";

/** O mínimo que o parser exige antes de uma fase solta; as linhas da fase começam depois dele. */
const ENVELOPE = ["# X — Project Phases", "", "<!-- inputs: a.md@sha256:000000000000 -->", ""];

/**
 * Lê uma fase solta, cercando-a do mínimo que o parser exige.
 *
 * Só o contrato sabe do que um documento precisa para ser lido, e é aqui que
 * esse conhecimento fica. Montar este envelope em outro módulo seria recriar a
 * gramática fora de casa — exatamente o que o teste de arquitetura impede.
 */
export function parsePhaseFragment(phaseMarkdown: string): PhaseBlock | null {
  /*
   * O documento exige fases numeradas a partir de 1, e uma fase solta é UMA fase:
   * sem isto, só a primeira do plano era legível. Do assistencia2 em diante as
   * duas memórias de tasks — a do auditor no `plan` e a do verificador no `build`
   * — ficaram mudas da fase 2 à 12: nada foi guardado, e task aprovada voltou a
   * ser julgada. A fase é lida como 1 e devolvida com o número dela.
   */
  const numero = /^##\s+Phase\s+(\d+)\s*:/m.exec(phaseMarkdown);
  const original = numero ? Number(numero[1]) : null;
  const dependencia = /\*\*Depends on:\*\*\s*([^·\n]*?)\s*(?:·|$)/m.exec(phaseMarkdown)?.[1]?.trim();
  const comoPrimeira =
    original !== null && original !== 1
      ? phaseMarkdown
          .replace(/^(##\s+Phase\s+)\d+(\s*:)/m, "$11$2")
          .replace(/^(###\s+Phase\s+)(\d+)(\.\d+\s*:)/gm, (whole, prefix: string, major: string, suffix: string) =>
            Number(major) === original ? `${prefix}1${suffix}` : whole)
          // Numa fase solta não há fase anterior a que se referir.
          .replace(/(\*\*Depends on:\*\*\s*)[^·\n]*?(\s*(?:·|$))/m, "$1none$2")
      : phaseMarkdown;
  const envelope = [...ENVELOPE, comoPrimeira, ""].join("\n");
  const lido = parsePhases(envelope);
  const fase = lido.ok ? (lido.document.phases[0] ?? null) : null;
  return fase !== null && original !== null && original !== 1
    ? { ...fase, number: original, subPhases: fase.subPhases.map(section => ({ ...section, phase: original })), ...(dependencia !== undefined ? { dependsOn: dependencia } : {}) }
    : fase;
}

/**
 * A fase com só algumas das suas tasks, no texto exato do plano (§130).
 *
 * O build entrega uma fase grande ao executor em partes, e cada parte precisa
 * ser a fase aprovada — não um resumo dela. Vai sempre o cabeçalho (heading,
 * metadados e o que vier antes da primeira task ou sub-fase), e toda nota que o
 * plano pôs entre as tasks sob um `###` que não é sub-fase — não se sabe a quais
 * tasks ela se aplica; cada sub-fase vai com o heading e a prosa dela quando
 * alguma task escolhida mora nela; cada task escolhida vai inteira, linha por
 * linha, com todos os critérios. Nada é
 * reescrito, então o texto canônico de cada task — e o sha que as aprovações
 * usam — é o mesmo da fase inteira. Sem índice, só o cabeçalho: é o que se
 * mede como contexto fixo. Null quando a fase não lê ou um índice não existe.
 */
export function recorteDaFase(phaseMarkdown: string, indices: readonly number[]): string | null {
  const fase = parsePhaseFragment(phaseMarkdown);
  if (fase === null) return null;
  const escolhidas = new Set(indices);
  if ([...escolhidas].some((indice) => !fase.tasks.some((task) => task.index === indice))) return null;
  const linhas = phaseMarkdown.split(/\r?\n/);
  // As linhas do parser contam o envelope; as do recorte começam na fase.
  const posicao = (linha: number): number => linha - 1 - ENVELOPE.length;
  const subs = new Set(fase.subPhases.map((sub) => posicao(sub.line)));
  const notas = linhas.flatMap((linha, indice) => (/^### /u.test(linha) && !subs.has(indice) ? [indice] : []));
  const marcos = [
    ...[...subs].map((inicio) => ({ inicio, tipo: "sub" as const, task: null as TaskBlock | null })),
    ...notas.map((inicio) => ({ inicio, tipo: "nota" as const, task: null as TaskBlock | null })),
    ...fase.tasks.map((task) => ({ inicio: posicao(task.line), tipo: "task" as const, task })),
  ].sort((a, b) => a.inicio - b.inicio);
  const saida = linhas.slice(0, marcos[0]?.inicio ?? linhas.length);
  marcos.forEach((marco, ordem) => {
    const fim = marcos[ordem + 1]?.inicio ?? linhas.length;
    if (marco.tipo === "nota") saida.push(...linhas.slice(marco.inicio, fim));
    if (marco.tipo === "task" && escolhidas.has(marco.task!.index)) saida.push(...linhas.slice(marco.inicio, fim));
    if (marco.tipo !== "sub") return;
    const proximaSub = marcos.slice(ordem + 1).find((outro) => outro.tipo === "sub")?.inicio ?? linhas.length;
    const temEscolhida = marcos.some((outro) => outro.task !== null && outro.inicio > marco.inicio && outro.inicio < proximaSub && escolhidas.has(outro.task.index));
    if (temEscolhida) saida.push(...linhas.slice(marco.inicio, fim));
  });
  return `${saida.join("\n").replace(/\s+$/u, "")}\n`;
}

export interface DriftInput {
  before: readonly TaskBlock[];
  after: readonly TaskBlock[];
  /** Textos dos findings, para saber o que foi legitimamente pedido. */
  findings: readonly { where: string; problem: string; fix: string }[];
}

/** Uma task foi citada quando seu título aparece em algum finding. */
function citada(title: string, findings: DriftInput["findings"]): boolean {
  const alvo = title.toLowerCase();
  return findings.some((finding) => `${finding.where} ${finding.problem} ${finding.fix}`.toLowerCase().includes(alvo));
}

/**
 * Um finding pode pedir mudança estrutural — dividir task, consolidar critério.
 * Quando pede, acrescentar e remover task deixa de ser deriva.
 */
function autorizaEstrutura(findings: DriftInput["findings"]): boolean {
  const texto = findings.map((finding) => `${finding.problem} ${finding.fix}`).join(" ").toLowerCase();
  return /divid|consolid|task|critério|criterio|dimension|fase/.test(texto);
}

export function checkRewriteDrift(input: DriftInput): string[] {
  const desvios: string[] = [];
  const estrutural = autorizaEstrutura(input.findings);

  const antes = new Map(input.before.map((task) => [task.title.trim(), task]));
  const depois = new Map(input.after.map((task) => [task.title.trim(), task]));

  for (const [title, task] of antes) {
    const novo = depois.get(title);
    if (!novo) {
      if (!estrutural && !citada(title, input.findings)) desvios.push(`a task "${title}" desapareceu sem nenhum finding pedir`);
      continue;
    }
    if (citada(title, input.findings)) continue;

    if (novo.acceptanceCriteria.length !== task.acceptanceCriteria.length) {
      desvios.push(
        `a task "${title}" foi de ${task.acceptanceCriteria.length} para ${novo.acceptanceCriteria.length} critérios sem nenhum finding citá-la`,
      );
    }
    if (novo.traces.join(",") !== task.traces.join(",")) {
      desvios.push(`os Traces da task "${title}" mudaram sem nenhum finding citá-la`);
    }
  }

  if (!estrutural) {
    for (const title of depois.keys()) {
      if (!antes.has(title)) desvios.push(`a task "${title}" foi acrescentada sem nenhum finding pedir`);
    }
  }

  return desvios;
}

/**
 * O que um achado manda usar, entre crases, e localiza uma linha: caminho,
 * arquivo, padrão, rota, variável. `/api` e `id` estão em toda parte e não
 * localizam nada; por isso o trecho precisa de cinco caracteres e de uma
 * barra, um ponto, um asterisco ou um sublinhado. Só a correção (`fix`)
 * conta: o trecho que o achado acusa está errado, e trazê-lo não corrige nada.
 */
function trechosDaCorrecao(findings: DriftInput["findings"]): string[] {
  const trechos = new Set<string>();
  for (const finding of findings) {
    for (const trecho of trechosEntreCrases(finding.fix)) if (trecho.length >= 5 && /[/.*_]/.test(trecho)) trechos.add(trecho);
  }
  return [...trechos];
}

/** Os trechos de um texto entre crases. */
export function trechosEntreCrases(texto: string): string[] {
  return [...texto.matchAll(/`([^`\n]+)`/g)].map((match) => (match[1] ?? "").trim());
}

/**
 * Um trecho com `*` é um padrão de caminho: `src/modules/*\/page.tsx` cobre
 * `src/modules/painel/page.tsx`. Um segmento entre `<` e `>` é o mesmo
 * curinga escrito por extenso: o auditor que manda mover a página "para
 * `src/pages/<módulo>/page.tsx`" está citando um padrão.
 */
export function casaComPadrao(trecho: string, padrao: string): boolean {
  if (trecho === padrao) return true;
  const comCuringa = padrao.replace(/<[^<>/\s`]+>/g, "*");
  if (!comCuringa.includes("*")) return false;
  const expressao = comCuringa.split("*").map((parte) => parte.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/\\s`]+");
  return new RegExp(`^${expressao}$`).test(trecho);
}

/**
 * A task vizinha que a correção do achado alcança (§128): a mesma quantidade
 * de linhas, e toda linha que mudou passou a citar um trecho que a correção
 * manda usar e que ela não citava.
 *
 * No Parallel Lab o achado da coerência dizia "`index.html` monta
 * `src/web/main.tsx` … mantenha a descoberta de páginas em `src/App.tsx` e
 * `src/modules/*\/page.tsx`", com endereço `P1.T1.C3`. O escritor corrigiu a
 * Task 1 e também as Tasks 7 e 8, que escreviam `src/web/main.tsx` e a
 * descoberta em `src/web/`; o endereço só nomeava a 1, e as duas voltaram com
 * os bytes antigos. A coerência acusou o mesmo conflito na rodada seguinte,
 * endereçado à arquitetura, e a reorganização reescreveu as cinco fases.
 *
 * Linha a linha, e não a task inteira: a revisão da primeira versão mostrou
 * que um achado sobre `package.json` destravava a reescrita de toda task que
 * citasse o arquivo, e um critério de migração sumia sem ninguém pedir. Agora
 * critério apagado, acrescentado ou reescrito sem o trecho da correção volta
 * como estava.
 */
function alcancadaPelaCorrecao(original: string, emendada: string, trechos: readonly string[]): boolean {
  if (trechos.length === 0) return false;
  const antes = original.trimEnd().split("\n");
  const depois = emendada.trimEnd().split("\n");
  if (antes.length !== depois.length) return false;
  let mudou = false;
  for (let linha = 0; linha < antes.length; linha += 1) {
    if (antes[linha] === depois[linha]) continue;
    const tinha = trechosEntreCrases(antes[linha]!);
    const trouxe = trechosEntreCrases(depois[linha]!).filter((trecho) => !tinha.includes(trecho));
    if (!trouxe.some((trecho) => trechos.some((padrao) => casaComPadrao(trecho, padrao)))) return false;
    mudou = true;
  }
  return mudou;
}

/** Mantém os bytes das tasks que não pertencem a uma emenda endereçada. */
export function preserveUnaddressedTasks(before: string, after: string, phase: number, findings: DriftInput["findings"]): string {
  const targets = new Set<number>();
  const parsed = parsePhaseFragment(before);
  for (const finding of findings) {
    if (/divid|consolid|redistribu|\bsplit\b|\bmerge\b|renumber/i.test(finding.fix)) return after;
    const addresses = planAddresses(finding.where).filter(address => address.phase === phase);
    if (addresses.length === 0) {
      const sections = [...finding.where.matchAll(/\b(?:phase|fase)\s+(\d+)\.(\d+)\b/gi)].filter(match => Number(match[1]) === phase);
      const matched = new Set<number>();
      for (const section of sections) {
        const position = parsed?.subPhases.findIndex(entry => entry.number === Number(section[2])) ?? -1;
        if (!parsed || position < 0) continue;
        const start = parsed.subPhases[position]!.line;
        const end = parsed.subPhases[position + 1]?.line ?? Infinity;
        for (const task of parsed.tasks.filter(task => task.line > start && task.line < end)) matched.add(task.index);
      }
      if (matched.size === 0) return after;
      for (const task of matched) targets.add(task);
    }
    for (const address of addresses) targets.add(address.task);
  }
  if (targets.size === 0) return after;
  const blocks = (source: string): { start: number; end: number; text: string; title: string }[] => {
    const markers = [...source.matchAll(/^- \[[ xX]\] \*\*Task:\*\* (.+)$/gm)];
    return markers.map((marker, index) => {
      const start = marker.index;
      const next = markers[index + 1]?.index ?? source.length;
      const heading = /^#{2,3} /m.exec(source.slice(start, next));
      const end = heading ? start + heading.index : next;
      return { start, end, text: source.slice(start, end), title: marker[1]!.trim() };
    });
  };
  const original = blocks(before);
  const candidate = blocks(after);
  if ([...targets].some(task => task < 1 || task > original.length)) return after;
  const montar = (alvos: ReadonlySet<number>): string => {
    let result = before;
    for (let index = original.length - 1; index >= 0; index -= 1) {
      if (!alvos.has(index + 1)) continue;
      const block = original[index]!;
      const matching = candidate.filter(entry => entry.title === block.title);
      const correction = original.length === candidate.length ? candidate[index] : matching.length === 1 ? matching[0] : undefined;
      /*
       * A task endereçada sumiu ou mudou de nome numa reescrita que também
       * mudou a contagem: a emenda a reestruturou (apagou a task que era a
       * suíte, fundiu-a noutra), e não há bloco para pôr no lugar dela. Antes
       * isto deixava o bloco ORIGINAL — e a correção pedida era descartada em
       * silêncio: o I-16 voltava a cada rodada sobre a mesma task que o
       * escritor tinha removido (§124). A reescrita inteira vale, como já valia
       * para a divisão pedida; o que se perde é a proteção das vizinhas nesta
       * emenda, que é o menor dos dois males.
       */
      if (!correction) return after;
      result = result.slice(0, block.start) + correction.text + result.slice(block.end);
    }
    return result;
  };
  const enderecadas = montar(targets);
  /*
   * As vizinhas alcançadas pela correção (§128). O par é pelo título, ou pela
   * posição só quando nenhuma task mudou de lugar: com uma removida e outra
   * acrescentada, a contagem é a mesma e a posição aponta para a task errada.
   */
  const trechos = trechosDaCorrecao(findings);
  if (trechos.length === 0) return enderecadas;
  const titulosAntes = new Set(original.map(block => block.title));
  const titulosDepois = new Set(candidate.map(block => block.title));
  const alinhadas = original.length === candidate.length && original.every((block, index) =>
    candidate[index]!.title === block.title || (!titulosDepois.has(block.title) && !titulosAntes.has(candidate[index]!.title)));
  const comAlcance = new Set(targets);
  original.forEach((block, index) => {
    if (targets.has(index + 1)) return;
    const mesmoTitulo = candidate.filter(entry => entry.title === block.title);
    const emendada = alinhadas ? candidate[index] : mesmoTitulo.length === 1 ? mesmoTitulo[0] : undefined;
    if (emendada !== undefined && alcancadaPelaCorrecao(block.text, emendada.text, trechos)) comAlcance.add(index + 1);
  });
  if (comAlcance.size === targets.size) return enderecadas;
  const resultado = montar(comAlcance);
  // Seguro contra o par errado: uma task repetida que não estava repetida antes desfaz o alcance.
  const repetidas = (texto: string): number => {
    const titulos = [...texto.matchAll(/^- \[[ xX]\] \*\*Task:\*\* (.+)$/gm)].map(match => match[1]!.trim());
    return titulos.length - new Set(titulos).size;
  };
  return repetidas(resultado) > repetidas(before) ? enderecadas : resultado;
}
