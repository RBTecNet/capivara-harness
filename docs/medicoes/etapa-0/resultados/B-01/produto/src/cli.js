import process from 'node:process';
import { createServer } from 'node:http';
import { adicionar, concluir, ErroDeEntrada, listar, remover } from './dominio.js';
import { resolverArquivo } from './persistencia.js';

async function iniciarServidor(caminho, valorPorta) {
  const porta = Number(valorPorta);
  if (!/^\d+$/.test(valorPorta) || !Number.isInteger(porta) || porta > 65535) {
    throw new ErroDeEntrada('PORT deve ser um inteiro entre 0 e 65535.');
  }

  const servidor = createServer(async (requisicao, resposta) => {
    resposta.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (requisicao.url !== '/') {
      resposta.writeHead(404);
      resposta.end(JSON.stringify({ erro: 'Caminho não encontrado.' }));
      return;
    }
    if (!['GET', 'HEAD'].includes(requisicao.method)) {
      resposta.writeHead(405, { Allow: 'GET, HEAD' });
      resposta.end(JSON.stringify({ erro: 'Método não permitido. Use GET ou HEAD.' }));
      return;
    }
    try {
      const tarefas = await listar(caminho);
      resposta.end(`${JSON.stringify(tarefas)}\n`);
    } catch {
      resposta.writeHead(500);
      resposta.end(JSON.stringify({
        erro: 'Não foi possível ler as tarefas. Verifique o arquivo de dados e as permissões de acesso.',
      }));
    }
  });

  try {
    await new Promise((resolver, rejeitar) => {
      servidor.once('error', rejeitar);
      servidor.listen(porta, '127.0.0.1', () => {
        servidor.removeListener('error', rejeitar);
        resolver();
      });
    });
  } catch {
    throw new ErroDeEntrada(`Não foi possível iniciar o servidor na porta ${porta}. Verifique se ela está disponível.`);
  }

  function encerrar() {
    process.removeListener('SIGINT', encerrar);
    process.removeListener('SIGTERM', encerrar);
    servidor.close();
    servidor.closeAllConnections();
  }
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
  process.stdout.write(`Servidor disponível em http://127.0.0.1:${servidor.address().port}\n`);
}

async function executarComando(caminho, comando, argumento) {
  let resultado;

  switch (comando) {
    case 'list':
      resultado = await listar(caminho);
      break;
    case 'add':
      resultado = await adicionar(caminho, argumento);
      break;
    case 'done':
      resultado = await concluir(caminho, argumento);
      break;
    case 'remove':
      resultado = await remover(caminho, argumento);
      break;
    default:
      throw new ErroDeEntrada('Comando desconhecido. Use list, add, done ou remove.');
  }

  process.stdout.write(`${JSON.stringify(resultado)}\n`);
}

try {
  const caminho = resolverArquivo(process.env.TASKS_FILE, process.cwd());
  if (process.argv[2] === undefined && process.env.PORT !== undefined) {
    await iniciarServidor(caminho, process.env.PORT);
  } else {
    await executarComando(caminho, process.argv[2] ?? 'list', process.argv[3] ?? '');
  }
} catch (erro) {
  const mensagem = erro instanceof ErroDeEntrada
    ? erro.message
    : 'Não foi possível executar o comando. Verifique o arquivo de dados e as permissões de acesso.';
  process.stderr.write(`${mensagem}\n`);
  process.exitCode = 1;
}
