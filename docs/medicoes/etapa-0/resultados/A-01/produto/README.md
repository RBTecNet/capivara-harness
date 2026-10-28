# Tarefas no terminal

Requer Node.js >=22. Usa apenas recursos nativos; não precisa instalar pacotes.

```sh
node src/cli.js list
node src/cli.js add "Comprar pão"
node src/cli.js add "Ler um livro"
node src/cli.js list
node src/cli.js done 1
node src/cli.js remove 2
node src/cli.js list
```

Também é possível executar `npm start -- list`. A saída de cada comando é JSON.
Erros são escritos no stderr e retornam código de saída diferente de zero.
Use aspas para títulos com espaços; espaços nas extremidades são removidos.

Por padrão, os dados ficam em `./data/tasks.json`, relativo ao diretório de
trabalho. Para escolher outro arquivo:

```sh
TASKS_FILE=./pessoal/tarefas.json node src/cli.js add "Estudar"
TASKS_FILE=./pessoal/tarefas.json node src/cli.js list
```

Cada arquivo mantém suas tarefas e seu contador de IDs, que nunca são
reutilizados. Diretórios são criados apenas ao gravar; listar um arquivo
inexistente retorna `[]`. A conclusão repetida é idempotente. O arquivo contém
`lastId` e `tasks`; preserve o contador para manter a sequência de IDs.
Execute os comandos sequencialmente para o mesmo arquivo.

Execute os testes de integração com `npm test` (`node --test`).
