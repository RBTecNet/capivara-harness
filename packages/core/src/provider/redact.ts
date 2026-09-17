/**
 * Redator de segredos.
 *
 * Toda saída que pode chegar a um log, ao dashboard ou a um relatório passa por
 * aqui. Uma chave de API vaza uma vez só: depois disso ela já está no disco de
 * alguém, e nenhuma correção posterior a tira de lá.
 */

const SENSITIVE_NAME = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION)/i;
const MINIMUM_LENGTH = 8;

/** Substitui, no texto, todo valor de variável sensível do ambiente informado. */
export function redact(value: string, environment: NodeJS.ProcessEnv = process.env): string {
  const secrets = Object.entries(environment)
    .filter(([name, secret]) => SENSITIVE_NAME.test(name) && typeof secret === "string" && secret.length >= MINIMUM_LENGTH)
    .sort((left, right) => (right[1] ?? "").length - (left[1] ?? "").length);

  let redacted = value;
  for (const [name, secret] of secrets) {
    if (!secret) continue;
    redacted = redacted.split(secret).join(`[REDACTED:${name}]`);
  }
  return redacted;
}

/** Mascara um segredo para exibição: nunca mostra o valor, só o formato. */
export function mask(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 3)}${"*".repeat(Math.max(4, secret.length - 6))}${secret.slice(-3)}`;
}
