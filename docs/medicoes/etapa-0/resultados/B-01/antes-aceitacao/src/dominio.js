import { gravarEstado, lerEstado } from './persistencia.js';

export class ErroDeEntrada extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDeEntrada';
  }
}

function validarIdentificador(identificador) {
  const id = Number(identificador);
  if (
    typeof identificador !== 'string'
    || !/^\d+$/.test(identificador)
    || !Number.isSafeInteger(id)
    || id <= 0
  ) {
    throw new ErroDeEntrada('O identificador deve ser um inteiro positivo.');
  }
  return id;
}

function buscarTarefa(estado, id) {
  const tarefa = estado.tarefas.find((item) => item.id === id);
  if (!tarefa) {
    throw new ErroDeEntrada(`Não existe tarefa com o identificador ${id}.`);
  }
  return tarefa;
}

export async function listar(caminho) {
  const estado = await lerEstado(caminho);
  return estado.tarefas
    .map(({ id, title, done }) => ({ id, title, done }))
    .sort((primeira, segunda) => primeira.id - segunda.id);
}

export async function adicionar(caminho, titulo) {
  const title = titulo.trim();
  if (title.length === 0) {
    throw new ErroDeEntrada('O título da tarefa não pode ficar vazio.');
  }
  const estado = await lerEstado(caminho);
  const tarefa = { id: estado.proximoId, title, done: false };
  estado.tarefas.push(tarefa);
  estado.proximoId += 1;
  await gravarEstado(caminho, estado);
  return tarefa;
}

export async function concluir(caminho, identificador) {
  const id = validarIdentificador(identificador);
  const estado = await lerEstado(caminho);
  const tarefa = buscarTarefa(estado, id);
  if (!tarefa.done) {
    tarefa.done = true;
    await gravarEstado(caminho, estado);
  }
  return tarefa;
}

export async function remover(caminho, identificador) {
  const id = validarIdentificador(identificador);
  const estado = await lerEstado(caminho);
  buscarTarefa(estado, id);
  estado.tarefas = estado.tarefas.filter((tarefa) => tarefa.id !== id);
  await gravarEstado(caminho, estado);
  return { removed: id };
}
