/**
 * Splash e mascote.
 *
 * A capivara é identidade do produto, não enfeite: é o que faz a ferramenta ser
 * reconhecida no terminal em meio a dezenas de outras saídas. `--no-splash`
 * desliga para quem roda em CI.
 */

import { paint, type Style } from "./ansi.js";
import { renderCapybara } from "./capybara.js";

/**
 * A capivara.
 *
 * A primeira versão tinha dois olhos redondos e uma boca aberta: lia como uma
 * coruja assustada. Capivara é o animal menos assustado que existe — olhos meio
 * fechados, focinho largo e nenhuma pressa.
 */

export interface SplashOptions {
  version: string;
  roles: { role: string; provider: string; model: string }[];
  style: Style;
  environment?: NodeJS.ProcessEnv;
}

export function renderSplash(options: SplashOptions): string {
  const lines: string[] = [""];
  // A capivara de verdade quando o terminal comporta; o desenho simples quando não.
  for (const line of renderCapybara({ style: options.style, indent: 2, ...(options.environment !== undefined ? { environment: options.environment } : {}) })) {
    lines.push(line);
  }
  lines.push("");
  lines.push(`  ${paint("capivara", "bold", options.style)} ${paint(options.version, "gray", options.style)}`);
  lines.push(`  ${paint("do prompt à aplicação final", "gray", options.style)}`);
  if (options.roles.length > 0) {
    lines.push("");
    for (const role of options.roles) {
      const configured = role.provider ? `${role.provider}${role.model ? `/${role.model}` : ""}` : "não configurado";
      lines.push(`  ${paint(role.role.padEnd(9), "cyan", options.style)} ${configured}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
