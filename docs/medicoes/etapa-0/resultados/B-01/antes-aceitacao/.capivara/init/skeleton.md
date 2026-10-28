# Tarefas locais por terminal — Skeleton

## Stack
- Linguagem: JavaScript ESM, sem transpilação
- Ambiente de execução: Node.js >=22; versão disponível na máquina: 24.22.1
- Persistência: Arquivo JSON local
- Dependências: Somente recursos embutidos do Node.js, sem dependências externas

## Ambiente de desenvolvimento
- Node.js >=22: ["node","--eval","if (Number(process.versions.node.split('.')[0]) < 22) { console.error('É necessário Node.js 22 ou superior.'); process.exit(1); }"]
  - preparação: Utilizar o Node.js 24.22.1 já disponível na máquina; nenhuma instalação é necessária.
- Recursos embutidos do Node.js: ["node","--input-type=module","--eval","await Promise.all(['node:fs/promises', 'node:path', 'node:process', 'node:test'].map(nome => import(nome)));"]
  - preparação: Os módulos declarados acompanham o Node.js disponível; nenhuma instalação de pacote ou serviço é necessária.

## Entidades
### tarefas
- id: inteiro positivo, obrigatório, único e crescente
- title: texto obrigatório, não vazio após remover espaços nas extremidades
- done: booleano obrigatório, inicialmente false

## Stories
- US-1.1: Como usuário do terminal, quero listar as tarefas em ordem de id, inclusive quando ainda não existe arquivo de dados.
- US-1.2: Como usuário do terminal, quero criar tarefas com título e receber seus identificadores.
- US-1.3: Como usuário do terminal, quero concluir uma tarefa e poder repetir a conclusão de forma idempotente.
- US-1.4: Como usuário do terminal, quero remover uma tarefa pelo identificador.
- US-1.5: Como usuário do terminal, quero selecionar o arquivo de dados e encontrar minhas tarefas preservadas em processos posteriores.
- US-1.6: Como usuário do terminal, quero receber uma mensagem explicativa quando uma entrada for recusada, preservando os dados existentes.
- US-1.7: Como usuário do terminal, quero instruções curtas de execução, configuração e exemplos dos comandos.

## Fluxos
### workflow 1 — Gerenciar tarefas em processos separados
- Executar node src/cli.js list e criar duas tarefas com node src/cli.js add TITULO.
- Executar node src/cli.js list em outro processo e conferir as duas tarefas persistidas.
- Executar node src/cli.js done ID para uma tarefa e conferir seu novo estado em uma listagem posterior.
- Executar node src/cli.js remove ID para a outra tarefa e conferir a listagem resultante em outro processo.

## Regras transversais
- produto.execucao: A aplicação é local e utilizada somente por comandos no terminal, em JavaScript ESM e Node.js >=22, sem transpilação, interface web, servidor, serviço permanente, SQL ou banco de dados próprio.
- produto.dependencias: Durante a execução, a aplicação utiliza somente recursos embutidos do Node.js; nenhuma dependência externa, instalação de pacote ou serviço é necessária.
- tarefas.persistencia: Após operações bem-sucedidas de criação, conclusão e remoção, os dados ficam preservados em arquivo JSON e disponíveis para processos posteriores.
- tarefas.arquivo: Em cada execução, TASKS_FILE seleciona o arquivo de dados. Quando a variável está ausente, o arquivo utilizado é ./data/tasks.json, relativo ao diretório de trabalho. Arquivos de dados diferentes mantêm tarefas e sequências de identificadores independentes.
- tarefas.diretorios: Os diretórios pais do arquivo de dados são criados somente ao gravar. Listar um arquivo inexistente não cria o arquivo nem seus diretórios pais.
- tarefas.id: Na criação, cada tarefa recebe um id inteiro positivo, único e crescente, começando em 1 para um arquivo sem histórico. Identificadores anteriormente atribuídos nunca são reutilizados, inclusive após remover todas as tarefas e reiniciar o processo.
- tarefas.title: Ao adicionar uma tarefa, os espaços nas extremidades do título são removidos antes de armazená-lo. Um título vazio após essa remoção é recusado.
- tarefas.done: Na criação, done é false. Ao concluir uma tarefa existente, done passa a true. Repetir a conclusão mantém a tarefa concluída e retorna seu objeto atualizado.
- cli.list: node src/cli.js list imprime na saída padrão um array JSON de objetos com id, title e done, ordenado pelo id. Quando o arquivo de dados não existe, imprime [] sem criá-lo.
- cli.add: node src/cli.js add TITULO cria a tarefa e imprime na saída padrão seu objeto JSON com id, title e done. A primeira tarefa de um arquivo sem histórico recebe id 1 e done false.
- cli.done: node src/cli.js done ID conclui a tarefa identificada e imprime na saída padrão o objeto JSON atualizado com id, title e done.
- cli.remove: node src/cli.js remove ID remove a tarefa identificada e imprime na saída padrão o objeto JSON {"removed":ID}, com o identificador numérico da tarefa removida.
- cli.recusas: Ao receber título vazio, ID inválido, ID inexistente ou comando desconhecido, a execução termina com código diferente de zero e mensagem explicativa em português no stderr. IDs válidos são inteiros positivos. Entradas recusadas não apagam nem modificam os dados existentes.
- distribuicao.execucao: A entrega contém package.json com type igual a module e o script start executando node src/cli.js.
- documentacao.uso: A entrega contém README.md curto, em português, com execução, configuração por TASKS_FILE e exemplos dos comandos list, add, done e remove.
- testes.execucao: A entrega contém em package.json o script test executando testes automatizados com o runner embutido node --test.

## Fases
- Phase 1: Persistência e operações sobre tarefas — Entregar os módulos de persistência e domínio com seleção do arquivo, operações sobre tarefas, preservação entre processos e sequência de identificadores que permanece após remoções. · depende de none · cobre tarefas, US-1.5 · 5 tasks
- Phase 2: Comandos públicos e instruções de uso — Integrar os módulos existentes à entrada src/cli.js, disponibilizar todos os comandos com respostas JSON e recusas explicativas e entregar package.json e README.md, tornando o fluxo completo acessível em processos separados. · depende de Phase 1 · cobre US-1.1, US-1.2, US-1.3, US-1.4, US-1.5, US-1.6, US-1.7, workflow 1 · 4 tasks

MVP fecha na fase 2.
