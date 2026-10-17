/**
 * O passo "reiniciar o servidor e conferir o que persistiu", percorrido de verdade (§109).
 *
 * No `build-96756ca336b0` a P05 bloqueou no gate 4 num passo que ninguém podia
 * cumprir: o roteiro era proibido de subir servidores e o ajudante não reiniciava
 * nada. Aqui o gate 4 roda inteiro sobre um produto de verdade — um servidor HTTP
 * com SQLite em arquivo, subido por `npm start` —, e o roteiro gravado é
 * EXECUTADO: cria um registro, confere, reinicia a instância (o processo antigo
 * morre, outro sobe no mesmo banco), consulta de novo e compara.
 *
 * O que é real: o gate, a passagem isolada, o ajudante gerado, os processos, a
 * porta, o arquivo SQLite, o reinício e a limpeza. O que é substituído: só o
 * Playwright, que não é dependência deste pacote — o `@playwright/test` do
 * projeto temporário é um substituto mínimo com `test`, `test.step`, `expect` e
 * `page.request` sobre `fetch`. O roteiro em si é o arquivo que o gate gravou,
 * no formato que o roteirista entrega.
 */

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SkeletonWorkflow } from "../../src/contract/index.js";
import { FLOWS_DIR, flowScriptName, gate4 } from "../../src/loop/flows.js";
import type { FlowRun } from "../../src/loop/flows.js";
import { encerrarOrfaos } from "../../src/loop/passagem.js";

let pasta = "";

beforeEach(async () => {
  pasta = await realpath(await mkdtemp(join(tmpdir(), "capivara-reinicio-g4-")));
});

afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

/** O produto: notas num SQLite em arquivo, na porta e no host que vêm do ambiente. */
const SERVIDOR = `import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const banco = new DatabaseSync(process.env.BANCO_CAMINHO);
banco.exec('CREATE TABLE IF NOT EXISTS notas (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL)');

createServer((pedido, resposta) => {
  const enviar = (codigo, corpo) => {
    resposta.writeHead(codigo, { 'content-type': 'application/json', 'x-pid': String(process.pid), 'x-banco': process.env.BANCO_CAMINHO });
    resposta.end(JSON.stringify(corpo));
  };
  const nota = /^\\/notas\\/(\\d+)$/.exec(pedido.url ?? '');
  if (pedido.method === 'POST' && pedido.url === '/notas') {
    let corpo = '';
    pedido.on('data', (pedaco) => (corpo += pedaco)).on('end', () => {
      const { texto } = JSON.parse(corpo);
      const { lastInsertRowid } = banco.prepare('INSERT INTO notas (texto) VALUES (?)').run(texto);
      enviar(201, { id: Number(lastInsertRowid), texto });
    });
    return;
  }
  if (pedido.method === 'GET' && nota) {
    const linha = banco.prepare('SELECT id, texto FROM notas WHERE id = ?').get(Number(nota[1]));
    return linha ? enviar(200, { id: linha.id, texto: linha.texto }) : enviar(404, {});
  }
  enviar(200, { ok: true });
}).listen(Number(process.env.PORT), process.env.HOST);
`;

/** O mínimo de `@playwright/test` que um roteiro de API usa — e nada que decida por ele. */
const SUBSTITUTO_DO_PLAYWRIGHT = `
const resposta = (r, corpo) => ({
  status: () => r.status,
  headers: () => Object.fromEntries(r.headers.entries()),
  json: async () => JSON.parse(corpo),
  text: async () => corpo,
});
const pedir = async (metodo, url, opcoes = {}) => {
  const r = await fetch(url, {
    method: metodo,
    ...(opcoes.data !== undefined ? { body: JSON.stringify(opcoes.data), headers: { 'content-type': 'application/json' } } : {}),
  });
  return resposta(r, await r.text());
};
const page = { request: { get: (url) => pedir('GET', url), post: (url, opcoes) => pedir('POST', url, opcoes) } };

const comparar = (recebido, negado) => {
  const conferir = (ok, mensagem) => {
    if (ok === negado) throw new Error(mensagem);
  };
  return {
    toBe: (esperado) => conferir(Object.is(recebido, esperado), \`esperava \${JSON.stringify(esperado)}, recebeu \${JSON.stringify(recebido)}\`),
    toEqual: (esperado) =>
      conferir(JSON.stringify(recebido) === JSON.stringify(esperado), \`esperava \${JSON.stringify(esperado)}, recebeu \${JSON.stringify(recebido)}\`),
    toThrow: () => {
      let lancou = false;
      try { recebido(); } catch { lancou = true; }
      conferir(lancou, 'esperava que lançasse');
    },
  };
};
export const expect = (recebido) => ({ ...comparar(recebido, false), not: comparar(recebido, true) });

export const test = (nome, corpo) => {
  Promise.resolve(corpo({ page }))
    .then(() => console.log(\`PASSOU: \${nome}\`))
    .catch((erro) => {
      console.log(\`FALHOU: \${nome}: \${erro.stack ?? erro}\`);
      process.exitCode = 1;
    })
    // Como o worker do Playwright: terminado o teste, o processo sai — e o que ficou de pé morre com ele.
    .finally(() => process.exit());
};
test.step = async (nome, corpo) => {
  console.log(\`  \${nome}\`);
  return await corpo();
};
test.setTimeout = () => {};
`;

const FLUXO: SkeletonWorkflow = {
  number: "9",
  name: "Persistência após reinício",
  steps: [
    "Cadastrar uma nota",
    "Confirmar que a nota existe",
    "Reiniciar o servidor com o mesmo arquivo SQLite",
    "Consultar a nota de novo e conferir os valores persistidos",
  ],
};

/** O roteiro como o roteirista o entrega: um bloco, quatro passos, o ajudante para reiniciar. */
function roteiro(texto: string): string {
  return [
    "```ts",
    "import { expect, test } from '@playwright/test';",
    "import { aplicacaoPropria } from './capivara-comando.ts';",
    "",
    "test('workflow 9 — Persistência após reinício', async ({ page }) => {",
    "  test.setTimeout(300_000);",
    "  const app = await aplicacaoPropria();",
    "  let id = 0;",
    "  let pidAntes = 0;",
    "  let bancoAntes = '';",
    "  await test.step('passo 1: Cadastrar uma nota', async () => {",
    `    const criada = await page.request.post(\`\${app.url}/notas\`, { data: { texto: ${JSON.stringify(texto)} } });`,
    "    expect(criada.status()).toBe(201);",
    "    id = (await criada.json()).id;",
    "  });",
    "  await test.step('passo 2: Confirmar que a nota existe', async () => {",
    "    const lida = await page.request.get(`${app.url}/notas/${id}`);",
    `    expect(await lida.json()).toEqual({ id, texto: ${JSON.stringify(texto)} });`,
    "    pidAntes = Number(lida.headers()['x-pid']);",
    "    bancoAntes = lida.headers()['x-banco'];",
    "  });",
    "  await test.step('passo 3: Reiniciar o servidor com o mesmo arquivo SQLite', async () => {",
    "    await app.reiniciar();",
    "    // O processo antigo morreu de verdade.",
    "    expect(() => process.kill(pidAntes, 0)).toThrow();",
    "    const depois = await page.request.get(app.url);",
    "    expect(Number(depois.headers()['x-pid'])).not.toBe(pidAntes);",
    "    expect(depois.headers()['x-banco']).toBe(bancoAntes);",
    "  });",
    "  await test.step('passo 4: Consultar a nota de novo e conferir os valores persistidos', async () => {",
    "    const relida = await page.request.get(`${app.url}/notas/${id}`);",
    `    expect(await relida.json()).toEqual({ id, texto: ${JSON.stringify(texto)} });`,
    "    console.log(`EVIDENCIA ${JSON.stringify({ url: app.url, banco: bancoAntes, pidAntes, pidDepois: Number(relida.headers()['x-pid']) })}`);",
    "    await app.encerrar();",
    "  });",
    "});",
    "```",
  ].join("\n");
}

async function projeto(nome: string): Promise<string> {
  const raiz = join(pasta, nome);
  await mkdir(join(raiz, "node_modules", "@playwright", "test"), { recursive: true });
  await writeFile(join(raiz, "package.json"), JSON.stringify({ name: nome, type: "module", scripts: { start: "node servidor.mjs" } }), "utf8");
  await writeFile(join(raiz, ".env.example"), "BANCO_CAMINHO=./dados.sqlite\n", "utf8");
  await writeFile(join(raiz, "servidor.mjs"), SERVIDOR, "utf8");
  await writeFile(
    join(raiz, "node_modules", "@playwright", "test", "package.json"),
    JSON.stringify({ name: "@playwright/test", type: "module", exports: "./index.mjs" }),
    "utf8",
  );
  await writeFile(join(raiz, "node_modules", "@playwright", "test", "index.mjs"), SUBSTITUTO_DO_PLAYWRIGHT, "utf8");
  return raiz;
}

/** Roda o roteiro GRAVADO pelo gate, com o ambiente da passagem — o papel do Playwright. */
const executarRoteiros = async (raiz: string, scripts: string[], env: Record<string, string> = {}): Promise<FlowRun> => {
  let saida = "";
  let codigo = 0;
  for (const script of scripts) {
    const resultado = await new Promise<{ codigo: number; saida: string }>((resolve) => {
      execFile(
        process.execPath,
        ["--no-warnings", join(raiz, FLOWS_DIR, script)],
        { cwd: join(raiz, FLOWS_DIR), env: { ...process.env, ...env }, timeout: 120_000 },
        (erro, stdout, stderr) => resolve({ codigo: erro ? 1 : 0, saida: `${stdout}${stderr}` }),
      );
    });
    saida += resultado.saida;
    codigo ||= resultado.codigo;
  }
  return { exitCode: codigo, output: saida };
};

function evidencia(saida: string): { url: string; banco: string; pidAntes: number; pidDepois: number } {
  const linha = /EVIDENCIA (\{.*\})/.exec(saida)?.[1];
  if (!linha) throw new Error(`o roteiro não chegou ao fim:\n${saida}`);
  return JSON.parse(linha) as { url: string; banco: string; pidAntes: number; pidDepois: number };
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("o gate 4 reinicia a aplicação de verdade (§109)", () => {
  it("o roteiro cria, confere, reinicia o servidor, consulta no mesmo SQLite e o registro persistiu", async () => {
    const raiz = await projeto("unico");
    let saida = "";
    const resultado = await gate4({
      projectRoot: raiz,
      workflows: [FLUXO],
      startCommand: "npm start",
      author: async () => roteiro("anotação que sobrevive ao reinício"),
      runner: async (dir, scripts, env) => {
        const corrida = await executarRoteiros(dir, scripts, env);
        saida = corrida.output;
        return corrida;
      },
    });

    expect(resultado.green, saida).toBe(true);
    // O roteiro que rodou é o que o gate gravou, com o ajudante novo ao lado.
    expect(await readFile(join(raiz, FLOWS_DIR, flowScriptName("9")), "utf8")).toContain("app.reiniciar()");
    for (const passo of [1, 2, 3, 4]) expect(saida).toContain(`passo ${passo}:`);
    const prova = evidencia(saida);
    expect(prova.pidDepois).not.toBe(prova.pidAntes);
    // O banco é o arquivo da passagem, não o do projeto — e já foi apagado com ela.
    expect(prova.banco.startsWith(raiz)).toBe(false);
    expect(prova.banco.endsWith("dados.sqlite")).toBe(true);
    // Nada ficou de pé.
    expect(vivo(prova.pidDepois)).toBe(false);
  }, 120_000);

  it("um roteiro que não reinicia de fato reprova: o processo antigo continua vivo e o passo 3 falha", async () => {
    const raiz = await projeto("fingido");
    const fingido = roteiro("x").replace("    await app.reiniciar();\n", "");
    let saida = "";
    const resultado = await gate4({
      projectRoot: raiz,
      workflows: [FLUXO],
      startCommand: "npm start",
      author: async () => fingido,
      runner: async (dir, scripts, env) => {
        const corrida = await executarRoteiros(dir, scripts, env);
        saida = corrida.output;
        return corrida;
      },
    });

    expect(resultado.green).toBe(false);
    expect(saida).toContain("FALHOU");
    expect(saida).toContain("esperava que lançasse");
  }, 120_000);

  it("dois gates em paralelo: cada um com o seu servidor, a sua porta e o seu banco", async () => {
    const [um, dois] = await Promise.all(
      ["paralelo-1", "paralelo-2"].map(async (nome) => {
        const raiz = await projeto(nome);
        let saida = "";
        const resultado = await gate4({
          projectRoot: raiz,
          workflows: [FLUXO],
          startCommand: "npm start",
          author: async () => roteiro(`nota do ${nome}`),
          runner: async (dir, scripts, env) => {
            const corrida = await executarRoteiros(dir, scripts, env);
            saida = corrida.output;
            return corrida;
          },
        });
        return { resultado, saida };
      }),
    );

    expect(um?.resultado.green, um?.saida).toBe(true);
    expect(dois?.resultado.green, dois?.saida).toBe(true);
    const a = evidencia(um?.saida ?? "");
    const b = evidencia(dois?.saida ?? "");
    expect(a.url).not.toBe(b.url);
    expect(a.banco).not.toBe(b.banco);
    // Cada um leu de volta a SUA nota, no seu banco: o passo 4 compara o texto.
    expect(um?.saida).not.toContain("nota do paralelo-2");
    expect(dois?.saida).not.toContain("nota do paralelo-1");
  }, 120_000);
});

describe("a passagem encerra o que o roteiro deixou de pé (§109)", () => {
  it("mata o grupo inteiro de cada processo anotado — o comando de início e o que ele criou", async () => {
    const lista = join(pasta, "processos.txt");
    // Um líder de grupo (o shell) com um neto (o node), como `npm start` deixaria.
    const lider = spawn("sh", ["-c", `${process.execPath} -e "console.log(process.pid); setInterval(() => {}, 1000)"`], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const neto = await new Promise<number>((resolve) => lider.stdout.once("data", (pedaco) => resolve(Number(String(pedaco).trim()))));
    await writeFile(lista, `${lider.pid}\n`, "utf8");
    expect(vivo(neto)).toBe(true);

    await encerrarOrfaos(lista);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(vivo(neto)).toBe(false);
    expect(vivo(lider.pid ?? 0)).toBe(false);
  });

  it("sem lista, ou com processos que já saíram, não faz nada e não lança", async () => {
    await expect(encerrarOrfaos(join(pasta, "nao-existe.txt"))).resolves.toBeUndefined();
    await writeFile(join(pasta, "velha.txt"), "999999\n", "utf8");
    await expect(encerrarOrfaos(join(pasta, "velha.txt"))).resolves.toBeUndefined();
  });
});
