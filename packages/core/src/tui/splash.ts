/**
 * Splash e mascote.
 *
 * A capivara é identidade do produto, não enfeite: é o que faz a ferramenta ser
 * reconhecida no terminal em meio a dezenas de outras saídas. `--no-splash`
 * desliga para quem roda em CI.
 */

import { paint, type Style } from "./ansi.js";

const CAPIVARA = [
  "        ___       ___",
  "     .-'   `'.-'`   `'-.",
  "    /   o        o      \\",
  "   |      .-\"\"\"-.        |",
  "   |     /       \\       |",
  "    \\    \\_.---._/      /",
  "     '-.__       __.-'",
  "          `'---'`",
];

export interface SplashOptions {
  version: string;
  roles: { role: string; provider: string; model: string }[];
  style: Style;
}

export function renderSplash(options: SplashOptions): string {
  const lines: string[] = [""];
  for (const line of CAPIVARA) lines.push(paint(line, "yellow", options.style));
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
