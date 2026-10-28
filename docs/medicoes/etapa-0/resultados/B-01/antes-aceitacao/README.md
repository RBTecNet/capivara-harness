# Tarefas locais pelo terminal

Requer Node.js >=22. Execute diretamente, sem instalar pacotes:

```sh
node src/cli.js list
npm start -- list
```

Cada comando termina após imprimir uma linha JSON. As recusas apresentam uma
mensagem em português na saída de erro e encerram com código 1.

Por padrão, os dados ficam em `./data/tasks.json`, relativo ao diretório de
trabalho. Configure `TASKS_FILE` para selecionar outro arquivo em cada execução;
caminhos relativos também partem do diretório de trabalho. Cada arquivo mantém
suas próprias tarefas e sequência de identificadores.

```sh
TASKS_FILE=./minhas-tarefas.json node src/cli.js list
```

No terminal, a sequência abaixo executa cada comando em um processo separado:

```sh
node src/cli.js add "Comprar pão"
node src/cli.js add "Estudar JavaScript"
node src/cli.js list
node src/cli.js done 1
node src/cli.js remove 2
node src/cli.js list
```

Em um arquivo sem histórico, a listagem final será
`[{"id":1,"title":"Comprar pão","done":true}]`. Use os identificadores retornados
pela criação caso já existam tarefas. Títulos com espaços devem estar entre
aspas; espaços nas extremidades são removidos e títulos vazios são recusados.
Os identificadores devem ser inteiros positivos de tarefas existentes.

Listar um arquivo ausente retorna `[]` sem criar arquivo ou diretórios. Gravações
criam os diretórios necessários e preservam os dados entre execuções. Remover
tarefas não reutiliza seus identificadores; repetir uma conclusão mantém a
tarefa concluída.

Execute os testes automatizados com `npm test`.
