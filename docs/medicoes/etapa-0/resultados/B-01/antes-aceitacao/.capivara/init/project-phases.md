# Tarefas locais por terminal — Project Phases

<!-- inputs: skeleton.md@sha256:ddb9f64c361e architecture.md@sha256:1f6c96585afc -->

## Overview

2 fases, fundação primeiro. O MVP fecha na fase 2.

**Conventions:**
- `[ ]` pendente · `[x]` concluído

## Phase 1: Persistência e operações sobre tarefas

**Goal:** Entregar os módulos de persistência e domínio com seleção do arquivo, operações sobre tarefas, preservação entre processos e sequência de identificadores que permanece após remoções. · **Depends on:** none · **Covers:** tarefas, US-1.5 · **Areas:** dados, backend

- [ ] **Task:** Implementar em `src/persistencia.js` as exportações `resolverArquivo(valor: string | undefined, diretorioAtual: string): string` e `lerEstado(caminho: string): Promise<Estado>`.
  - **Acceptance criteria:**
    - `resolverArquivo` retorna um caminho absoluto usando `diretorioAtual` como base para caminhos relativos; `valor === undefined` seleciona `./data/tasks.json`, e um caminho absoluto informado permanece absoluto sem receber o diretório como prefixo.
    - `lerEstado` lê o documento JSON `{proximoId, tarefas}` do arquivo indicado. Somente a ausência do arquivo retorna `{proximoId: 1, tarefas: []}`; falhas de leitura ou de interpretação do JSON são propagadas. A função não cria arquivos nem diretórios.
  - **Traces:** US-1.5 / tarefas / workflow 1

- [ ] **Task:** Implementar em `src/persistencia.js` a exportação `gravarEstado(caminho: string, estado: Estado): Promise<void>` para persistir o estado completo.
  - **Acceptance criteria:**
    - `gravarEstado` usa recursos embutidos do Node.js, cria os diretórios pais necessários durante a gravação, escreve o documento completo em arquivo temporário no mesmo diretório e substitui o destino por renomeação somente após concluir a escrita.
    - O documento persistido contém `{proximoId, tarefas}`, com itens contendo exclusivamente `{id, title, done}`; preserva o `proximoId` recebido inclusive quando `tarefas` está vazio. Uma leitura posterior por `lerEstado`, inclusive em outro processo, recupera esses valores; gravar um caminho não altera o estado de outro arquivo.
  - **Traces:** US-1.5 / tarefas / workflow 1

- [ ] **Task:** Implementar em `src/dominio.js` as exportações `ErroDeEntrada`, `listar(caminho: string): Promise<Tarefa[]>` e `adicionar(caminho: string, titulo: string): Promise<Tarefa>`, consumindo `src/persistencia.js`.
  - **Acceptance criteria:**
    - `listar` retorna um array de objetos `{id, title, done}`, ordenado numericamente por `id` crescente, sem expor `proximoId` nem chamar `gravarEstado`; para arquivo ausente, retorna `[]` sem criar o arquivo ou seus diretórios pais.
    - `adicionar` aplica `trim()` ao título e, se o resultado for vazio, lança `ErroDeEntrada` com mensagem explicativa em português sem chamar `gravarEstado`. Caso contrário, cria `{id: proximoId, title: titulo.trim(), done: false}`, incrementa `proximoId` e persiste antes de retornar o objeto. Um arquivo sem histórico começa no identificador `1`; criações posteriores usam a sequência persistida, inclusive em processos posteriores.
  - **Traces:** US-1.5 / tarefas / workflow 1

- [ ] **Task:** Implementar em `src/dominio.js` a exportação `concluir(caminho: string, identificador: string): Promise<Tarefa>`, utilizando `ErroDeEntrada` e as funções de persistência.
  - **Acceptance criteria:**
    - `concluir` exige um identificador que represente um inteiro positivo e uma tarefa existente. Identificador inválido ou tarefa inexistente lança `ErroDeEntrada` com mensagem explicativa em português, sem alterar o estado nem chamar `gravarEstado`.
    - Para uma tarefa existente com `done: false`, a função altera somente seu `done` para `true`, preserva `proximoId` e as outras tarefas, persiste antes de retornar `{id, title, done}` e disponibiliza a alteração para processos posteriores. Se a tarefa já estiver concluída, retorna seu objeto com `done: true` sem nova gravação.
  - **Traces:** US-1.5 / tarefas / workflow 1

- [ ] **Task:** Implementar em `src/dominio.js` a exportação `remover(caminho: string, identificador: string): Promise<{removed: number}>`, preservando o histórico da sequência.
  - **Acceptance criteria:**
    - `remover` exige um identificador que represente um inteiro positivo e uma tarefa existente. Identificador inválido ou tarefa inexistente lança `ErroDeEntrada` com mensagem explicativa em português, sem alterar o estado nem chamar `gravarEstado`.
    - Para uma tarefa existente, a função remove somente essa tarefa, mantém `proximoId`, persiste antes de retornar `{"removed": ID}` com `ID` numérico e disponibiliza a remoção para processos posteriores. Mesmo após remover todas as tarefas e reiniciar o processo, `adicionar` utiliza o `proximoId` preservado, sem reutilizar identificadores anteriormente atribuídos.
  - **Traces:** US-1.5 / tarefas / workflow 1

## Phase 2: Comandos públicos e instruções de uso

**Goal:** Integrar os módulos existentes à entrada src/cli.js, disponibilizar todos os comandos com respostas JSON e recusas explicativas e entregar package.json e README.md, tornando o fluxo completo acessível em processos separados. · **Depends on:** Phase 1 · **Covers:** US-1.1, US-1.2, US-1.3, US-1.4, US-1.5, US-1.6, US-1.7, workflow 1 · **Areas:** geral, infra

- [ ] **Task:** Implementar em src/cli.js a seleção do arquivo e os comandos `list` e `add`, consumindo `resolverArquivo` de src/persistencia.js e `listar` e `adicionar` de src/dominio.js. Ler o comando de `process.argv[2]` e o título de `process.argv[3]`, usando `""` quando o título estiver ausente.
  - **Acceptance criteria:**
    - src/cli.js obtém `caminho` por `resolverArquivo(process.env.TASKS_FILE, process.cwd())` e utiliza esse caminho nas chamadas ao domínio. `node src/cli.js list` chama `listar(caminho)`, termina com código 0 e imprime uma única linha contendo um array JSON de objetos `{id, title, done}`, ordenado numericamente por id, sem expor `proximoId`. Para arquivo inexistente, imprime `[]` sem criar arquivo ou diretórios. Sem TASKS_FILE, utiliza `./data/tasks.json` relativo ao diretório de trabalho.
    - `node src/cli.js add TITULO` chama `adicionar(caminho, titulo)`, termina com código 0 e imprime uma única linha contendo somente o objeto JSON `{id, title, done}` retornado. O título armazenado e impresso tem os espaços das extremidades removidos; a primeira criação em arquivo sem histórico retorna id 1 e done false. Duas criações em processos separados aparecem em uma listagem posterior do mesmo arquivo; arquivos selecionados por TASKS_FILE mantêm tarefas e sequências independentes.
  - **Traces:** US-1.1, US-1.2, US-1.5 / tarefa / workflow 1

- [ ] **Task:** Implementar em src/cli.js os comandos `done` e `remove`, consumindo `concluir` e `remover` de src/dominio.js. Encaminhar `process.argv[3]` como identificador textual, usando `""` quando ausente, e utilizar o caminho obtido por `resolverArquivo(process.env.TASKS_FILE, process.cwd())`.
  - **Acceptance criteria:**
    - `node src/cli.js done ID` chama `concluir(caminho, identificador)`, termina com código 0 e imprime uma única linha contendo somente o objeto JSON `{id, title, done}` atualizado, com id numérico e done true. A conclusão fica disponível em processos posteriores; repetir o comando para a mesma tarefa retorna o mesmo objeto concluído.
    - `node src/cli.js remove ID` chama `remover(caminho, identificador)`, termina com código 0 e imprime uma única linha contendo somente `{"removed":ID}`, com ID numérico. Após criar duas tarefas, concluir uma e remover a outra em processos separados, uma listagem posterior contém somente a tarefa concluída. Remover todas as tarefas e criar outra em novo processo produz um id superior aos anteriormente atribuídos.
  - **Traces:** US-1.3, US-1.4, US-1.5 / tarefa / workflow 1

- [ ] **Task:** Implementar em src/cli.js o tratamento das recusas dos comandos, capturando `ErroDeEntrada` exportado por src/dominio.js e apresentando sua mensagem em português. Recusar comando desconhecido antes de chamar `listar`, `adicionar`, `concluir` ou `remover`.
  - **Acceptance criteria:**
    - Comando desconhecido termina com código 1, mensagem explicativa em português no stderr e saída padrão vazia; o despacho em src/cli.js não chama operações do domínio nesse caso.
    - `add` com título ausente ou vazio após remoção dos espaços das extremidades, e `done` ou `remove` com identificador ausente, diferente de inteiro positivo ou inexistente, terminam com código 1, apresentam a mensagem de `ErroDeEntrada` no stderr e deixam a saída padrão vazia. Essas recusas preservam o conteúdo do arquivo existente e não criam arquivo ou diretórios quando ausentes.
  - **Traces:** US-1.2, US-1.3, US-1.4, US-1.6 / tarefa

- [ ] **Task:** Entregar package.json para execução dos módulos ESM e README.md curto, em português, com instruções de uso da aplicação pelo terminal.
  - **Acceptance criteria:**
    - package.json contém `"type": "module"` e o comando `"start": "node src/cli.js"` em `scripts`, permitindo executar a entrada implementada em src/cli.js.
    - README.md informa Node.js >=22, execução direta sem instalação de pacotes, uso de `npm start -- list`, configuração por TASKS_FILE e caminho padrão `./data/tasks.json` relativo ao diretório de trabalho. Inclui exemplos de `node src/cli.js list`, `node src/cli.js add "Comprar pão"`, `node src/cli.js done 1` e `node src/cli.js remove 2`, além de uma sequência de comandos que cria duas tarefas, lista, conclui uma, remove a outra e lista o resultado em processos separados.
  - **Traces:** US-1.7 / terminal / workflow 1
