import process from 'node:process';
import { adicionar, concluir, ErroDeEntrada, listar, remover } from './dominio.js';
import { resolverArquivo } from './persistencia.js';

try {
  const comando = process.argv[2];
  const argumento = process.argv[3] ?? '';
  const caminho = resolverArquivo(process.env.TASKS_FILE, process.cwd());
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
} catch (erro) {
  const mensagem = erro instanceof ErroDeEntrada
    ? erro.message
    : 'Não foi possível executar o comando. Verifique o arquivo de dados e as permissões de acesso.';
  process.stderr.write(`${mensagem}\n`);
  process.exitCode = 1;
}
