/**
 * O ambiente em que os GATES rodam — que não é o ambiente em que o harness roda.
 *
 * O `doctor` sempre conferiu o que o harness precisa: Node, CLI no PATH,
 * credencial, árvore limpa. Nada disso é o que quebra na hora do gate. O que
 * quebra é o gate 2 precisando compilar um módulo nativo numa máquina sem
 * compilador, e o gate 4 abrindo um navegador que nunca foi baixado — as duas
 * falhas que mais custaram ciclo nos pilotos, as duas descobertas depois de o
 * modelo já ter escrito a fase inteira.
 *
 * Nada aqui é bloqueio. Um projeto pode não tocar em banco, não ter módulo
 * nativo e não declarar fluxo nenhum, e a máquina continua perfeita para ele. O
 * que isto faz é dizer, antes de gastar, o que vai faltar se precisar — com o
 * comando exato daquele sistema, porque "instale as ferramentas de compilação"
 * não é acionável no Mac de quem nunca abriu o Xcode.
 */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface AmbienteDosGates {
  item: string;
  ok: boolean;
  detail: string;
}

export interface SondaDoAmbiente {
  /** `which`, injetável para o teste não depender da máquina que o roda. */
  which?: (binario: string) => Promise<string | null>;
  existe?: (caminho: string) => Promise<boolean>;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  home?: string;
}

async function ondeEsta(binario: string): Promise<string | null> {
  try {
    const { stdout } = await run("which", [binario]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

const existeMesmo = async (caminho: string): Promise<boolean> => await stat(caminho).then(() => true).catch(() => false);

/** Onde o Playwright guarda os navegadores, por sistema. */
export function cacheDoPlaywright(platform: NodeJS.Platform, home: string, environment: NodeJS.ProcessEnv = {}): string {
  const declarado = environment.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (declarado) return declarado;
  if (platform === "darwin") return join(home, "Library", "Caches", "ms-playwright");
  if (platform === "win32") return join(home, "AppData", "Local", "ms-playwright");
  return join(home, ".cache", "ms-playwright");
}

/** Como se instala um compilador C, naquele sistema. */
export function comoInstalarCompilador(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "rode `xcode-select --install`";
  if (platform === "win32") return "instale as Build Tools do Visual Studio";
  return "instale o pacote de compilação do seu sistema (por exemplo `build-essential`)";
}

export async function ambienteDosGates(sonda: SondaDoAmbiente = {}): Promise<AmbienteDosGates[]> {
  const which = sonda.which ?? ondeEsta;
  const existe = sonda.existe ?? existeMesmo;
  const platform = sonda.platform ?? process.platform;
  const home = sonda.home ?? homedir();
  const environment = sonda.environment ?? process.env;

  const sqlite = await which("sqlite3");
  const compilador = (await which("cc")) ?? (await which("gcc")) ?? (await which("clang"));
  const make = await which("make");
  const navegadores = cacheDoPlaywright(platform, home, environment);
  const temNavegadores = await existe(navegadores);

  return [
    {
      item: "sqlite3",
      ok: sqlite !== null,
      detail:
        sqlite !== null
          ? sqlite
          : "ausente: o harness não precisa dele, mas a suíte de um projeto que guarda dados em SQLite costuma precisar — " +
            (platform === "darwin" ? "`brew install sqlite`" : "instale o pacote `sqlite3` do seu sistema"),
    },
    {
      item: "compilador C",
      ok: compilador !== null && make !== null,
      detail:
        compilador !== null && make !== null
          ? `${compilador}, com make`
          : `ausente: módulo nativo (driver de banco, por exemplo) não compila sem ele — ${comoInstalarCompilador(platform)}`,
    },
    {
      item: "navegadores do Playwright",
      ok: temNavegadores,
      detail: temNavegadores
        ? navegadores
        : `nada em ${navegadores}: o gate 4 pede \`npx playwright install\` na primeira vez que percorrer um fluxo`,
    },
  ];
}
