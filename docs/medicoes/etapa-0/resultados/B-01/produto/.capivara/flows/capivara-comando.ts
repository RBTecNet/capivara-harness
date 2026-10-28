// Gerado pelo capivara a cada passagem do gate 4. Não edite: será sobrescrito.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:net';

/**
 * Roda um comando que o PROJETO declara — instalar, migrar, semear — na raiz do
 * projeto, com o ambiente desta passagem. Para subir, parar ou reiniciar a aplicação,
 * use `aplicacaoPropria`.
 */
export async function comandoDoProjeto(
  comando: string,
  args: string[] = [],
  opcoes: { entrada?: string; tempoMs?: number } = {},
): Promise<{ codigo: number; saida: string }> {
  const raiz = process.env.CAPIVARA_RAIZ;
  if (!raiz) throw new Error('comandoDoProjeto: CAPIVARA_RAIZ ausente — este ajudante só roda dentro do gate 4');
  return await new Promise((resolve) => {
    const filho = execFile(
      comando,
      args,
      { cwd: raiz, env: process.env, timeout: opcoes.tempoMs ?? 120_000, maxBuffer: 16 * 1024 * 1024 },
      (erro, stdout, stderr) => {
        const codigo = erro ? (typeof (erro as { code?: unknown }).code === 'number' ? (erro as { code: number }).code : 1) : 0;
        resolve({ codigo, saida: `${stdout}${stderr}` });
      },
    );
    filho.stdin?.end(opcoes.entrada ?? '');
  });
}

export interface AplicacaoPropria {
  /** Onde esta instância responde — use `${app.url}/rota` ou `page.goto(app.url + '/rota')`. */
  url: string;
  porta: number;
  /** O processo de agora; muda a cada `reiniciar`. */
  pid: () => number;
  /** Encerra o processo de verdade, espera ele sair, e sobe de novo na mesma porta e no mesmo banco. */
  reiniciar: () => Promise<void>;
  /** Encerra e espera sair. Chame ao fim do passo que subiu a instância. */
  encerrar: () => Promise<void>;
  /** O que a instância escreveu até agora, para pôr na mensagem de uma asserção. */
  saida: () => string;
}

const vivos = new Set<ChildProcess>();
process.once('exit', () => {
  for (const filho of vivos) matar(filho, 'SIGKILL');
});

function matar(filho: ChildProcess, sinal: NodeJS.Signals): void {
  if (filho.pid === undefined) return;
  try {
    if (process.platform === 'win32') filho.kill(sinal);
    else process.kill(-filho.pid, sinal);
  } catch {
    // já saiu
  }
}

async function portaLivre(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
      servidor.close(() => resolve(porta));
    });
  });
}

/**
 * Sobe outra instância da aplicação, com o comando de início do gate, o ambiente desta
 * passagem e o MESMO arquivo de banco, numa porta livre só dela. A instância do gate
 * continua de pé em paralelo; esta é a que o roteiro pode reiniciar e encerrar.
 */
export async function aplicacaoPropria(opcoes: { tempoMs?: number; ambiente?: Record<string, string> } = {}): Promise<AplicacaoPropria> {
  const raiz = process.env.CAPIVARA_RAIZ;
  const comando = process.env.CAPIVARA_INICIO;
  if (!raiz || !comando) throw new Error('aplicacaoPropria: CAPIVARA_RAIZ ou CAPIVARA_INICIO ausente — este ajudante só roda dentro do gate 4');
  const prazo = opcoes.tempoMs ?? 120_000;
  const porta = await portaLivre();
  const url = `http://127.0.0.1:${porta}`;
  let filho: ChildProcess | undefined;
  let saida = '';

  const saiu = (processo: ChildProcess): Promise<void> =>
    processo.exitCode !== null || processo.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => processo.once('exit', () => resolve()));

  const subir = async (): Promise<void> => {
    const atual = spawn(comando, {
      cwd: raiz,
      env: { ...process.env, ...opcoes.ambiente, PORT: String(porta), HOST: '127.0.0.1' },
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    filho = atual;
    vivos.add(atual);
    atual.once('exit', () => vivos.delete(atual));
    const lista = process.env.CAPIVARA_PROCESSOS;
    if (lista && atual.pid !== undefined) appendFileSync(lista, `${atual.pid}\n`);
    atual.stdout?.on('data', (pedaco) => (saida += String(pedaco)));
    atual.stderr?.on('data', (pedaco) => (saida += String(pedaco)));
    const limite = Date.now() + prazo;
    for (;;) {
      if (atual.exitCode !== null || atual.signalCode !== null) {
        throw new Error(`aplicacaoPropria: a instância saiu antes de responder em ${url}:\n${saida.slice(-2000)}`);
      }
      try {
        await fetch(url, { signal: AbortSignal.timeout(2_000) });
        return;
      } catch {
        if (Date.now() > limite) {
          matar(atual, 'SIGKILL');
          throw new Error(`aplicacaoPropria: nada respondeu em ${url} em ${prazo} ms:\n${saida.slice(-2000)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };

  const encerrar = async (): Promise<void> => {
    const atual = filho;
    if (!atual) return;
    const fim = saiu(atual);
    matar(atual, 'SIGTERM');
    const aindaVivo = setTimeout(() => matar(atual, 'SIGKILL'), 5_000);
    await fim;
    clearTimeout(aindaVivo);
    // O grupo inteiro: o comando de início pode ter deixado filhos.
    matar(atual, 'SIGKILL');
  };

  await subir();
  return {
    url,
    porta,
    pid: () => filho?.pid ?? 0,
    reiniciar: async () => {
      await encerrar();
      await subir();
    },
    encerrar,
    saida: () => saida,
  };
}
