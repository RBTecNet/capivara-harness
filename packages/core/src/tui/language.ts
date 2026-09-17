/**
 * Idioma da interface.
 *
 * Resolvido UMA vez, do prompt inicial, e gravado no run. Nunca redetectado no
 * meio: um documento que muda de idioma na terceira seção é pior do que um
 * documento inteiro no idioma errado.
 *
 * A heurística é deliberadamente simples e o `--language` sempre vence. Errar a
 * detecção custa uma flag; travar a ferramenta atrás de uma detecção perfeita
 * custaria o uso.
 */

/**
 * Só marcadores DISCRIMINANTES.
 *
 * Palavras compartilhadas entre línguas próximas — "de", "para", "que",
 * "sistema" — não separam nada: elas fizeram um pedido claramente em português
 * ser classificado como espanhol, porque o espanhol as tem também.
 */
const MARKERS: { language: string; pattern: RegExp; weight: number }[] = [
  { language: "português do Brasil", pattern: /\b(?:não|são|você|com|uma|dos|das|já|então|também|é|quero|preciso|quartos?)\b|ç|ã|õ/gi, weight: 1 },
  { language: "español", pattern: /\b(?:con|una|el|los|las|muy|pero|además|está|usuario)\b|ción\b|ñ/gi, weight: 1 },
  { language: "English", pattern: /\b(?:the|and|with|that|should|must|need|booking|must)\b/gi, weight: 1 },
];

export const DEFAULT_LANGUAGE = "English";

export function detectLanguage(text: string, override?: string): string {
  const explicit = override?.trim();
  if (explicit) return explicit;

  let best = { language: DEFAULT_LANGUAGE, score: 0 };
  for (const marker of MARKERS) {
    const score = (text.match(marker.pattern) ?? []).length * marker.weight;
    if (score > best.score) best = { language: marker.language, score };
  }
  return best.score === 0 ? DEFAULT_LANGUAGE : best.language;
}
