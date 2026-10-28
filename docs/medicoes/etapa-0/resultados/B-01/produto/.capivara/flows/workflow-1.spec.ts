// capivara-flow: v3 — passagem isolada, em sequência, com reinício
import { expect, test } from '@playwright/test';
import { comandoDoProjeto } from './capivara-comando';

function lerJson(saida: string) {
  const linha = saida.split(/\r?\n/).find((trecho) => /^\s*[\[{]/.test(trecho));
  return JSON.parse(linha ?? saida);
}

test('workflow 1 — Gerenciar tarefas em processos separados', async () => {
  const primeira = { id: 1, title: 'Comprar pão', done: false };
  const segunda = { id: 2, title: 'Estudar JavaScript', done: false };
  const concluida = { ...primeira, done: true };

  await test.step('passo 1: Executar node src/cli.js list e criar duas tarefas com node src/cli.js add TITULO.', async () => {
    const listagem = await comandoDoProjeto('node', ['src/cli.js', 'list']);
    expect(listagem.codigo, listagem.saida).toBe(0);
    expect(lerJson(listagem.saida)).toEqual([]);

    const criacaoPrimeira = await comandoDoProjeto('node', [
      'src/cli.js', 'add', primeira.title,
    ]);
    expect(criacaoPrimeira.codigo, criacaoPrimeira.saida).toBe(0);
    expect(lerJson(criacaoPrimeira.saida)).toEqual(primeira);

    const criacaoSegunda = await comandoDoProjeto('node', [
      'src/cli.js', 'add', segunda.title,
    ]);
    expect(criacaoSegunda.codigo, criacaoSegunda.saida).toBe(0);
    expect(lerJson(criacaoSegunda.saida)).toEqual(segunda);
  });

  await test.step('passo 2: Executar node src/cli.js list em outro processo e conferir as duas tarefas persistidas.', async () => {
    const listagem = await comandoDoProjeto('node', ['src/cli.js', 'list']);
    expect(listagem.codigo, listagem.saida).toBe(0);
    expect(lerJson(listagem.saida)).toEqual([primeira, segunda]);
  });

  await test.step('passo 3: Executar node src/cli.js done ID para uma tarefa e conferir seu novo estado em uma listagem posterior.', async () => {
    const conclusao = await comandoDoProjeto('node', [
      'src/cli.js', 'done', String(primeira.id),
    ]);
    expect(conclusao.codigo, conclusao.saida).toBe(0);
    expect(lerJson(conclusao.saida)).toEqual(concluida);

    const listagem = await comandoDoProjeto('node', ['src/cli.js', 'list']);
    expect(listagem.codigo, listagem.saida).toBe(0);
    expect(lerJson(listagem.saida)).toEqual([concluida, segunda]);
  });

  await test.step('passo 4: Executar node src/cli.js remove ID para a outra tarefa e conferir a listagem resultante em outro processo.', async () => {
    const remocao = await comandoDoProjeto('node', [
      'src/cli.js', 'remove', String(segunda.id),
    ]);
    expect(remocao.codigo, remocao.saida).toBe(0);
    expect(lerJson(remocao.saida)).toEqual({ removed: segunda.id });

    const listagem = await comandoDoProjeto('node', ['src/cli.js', 'list']);
    expect(listagem.codigo, listagem.saida).toBe(0);
    expect(lerJson(listagem.saida)).toEqual([concluida]);
  });
});
