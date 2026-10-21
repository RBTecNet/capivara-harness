# Parallel Lab — Project Phases

<!-- inputs: skeleton.md@sha256:a67fdfd8dba3 architecture.md@sha256:9a50d4a6352f -->

## Overview

6 fases, fundação primeiro. O MVP fecha na fase 6.

**Conventions:**
- `[ ]` pendente · `[x]` concluído

## Phase 1: Fundação persistente e contratos compartilhados

**Goal:** Disponibilizar a configuração de ambiente com carregamento de DATABASE_PATH do .env na raiz, .env.example versionado com valores inofensivos e .env ignorado pelo Git; fornecer a persistência SQLite, a função getDatabase() compartilhada para acesso de api-central e dos módulos, a migração repetível pelo comando npm run migrate e a aplicação da migração idempotente ao inicializar o servidor, além do servidor REST, do registro de rotas e do contrato de contagens do painel. · **Depends on:** none · **Covers:** tarefas, categorias, anotacoes, US-5.1 · **Areas:** backend, dados, infra

- [ ] **Task:** Em `package.json` e `tsconfig.json`, configurar o projeto Node.js com TypeScript e os scripts npm da aplicação. Declarar as dependências da API Express, SQLite, dotenv, React, React DOM e React Router, e as ferramentas Vite, TypeScript, tsx e concurrently. O script `dev` inicia a API e o Vite; `build` compila o servidor e a interface; `start` inicia o servidor; `migrate` executa a migração em TypeScript.
  - **Acceptance criteria:**
    - `package.json` declara as dependências da API Express, SQLite, dotenv, React, React DOM e React Router; as dependências de desenvolvimento Vite, TypeScript, tsx, concurrently, @types/node, @types/express, @types/better-sqlite3, @types/react e @types/react-dom; e define os scripts `dev`, `build`, `start` e `migrate` com os respectivos comandos executáveis.
    - `tsconfig.json` configura a compilação de TypeScript para o servidor e para a interface React com Vite.
  - **Traces:** US-5.1 / configuração do projeto

- [ ] **Task:** Na raiz do projeto, configurar `DATABASE_PATH` com dotenv, criar `.env.example` com `DATABASE_PATH=./data/parallel-lab.sqlite` e incluir `.env` no `.gitignore`.
  - **Acceptance criteria:**
    - `.env.example` contém todas as variáveis lidas pelo projeto, com valores de exemplo inofensivos; nesta fase, contém `DATABASE_PATH=./data/parallel-lab.sqlite`.
    - `.gitignore` inclui a entrada `.env`.
    - A configuração do servidor carrega o arquivo `.env` da raiz, e a abertura do banco usa o valor de `DATABASE_PATH`.
  - **Traces:** US-5.1 / configuração do banco

- [ ] **Task:** Em `server/persistencia/index.ts`, implementar e exportar `getDatabase(): BetterSqlite3.Database` para fornecer a conexão SQLite compartilhada usando `DATABASE_PATH`. Criar o diretório pai do arquivo do banco quando necessário.
  - **Acceptance criteria:**
    - `server/persistencia/index.ts` exporta `getDatabase(): BetterSqlite3.Database` e abre o arquivo indicado por `DATABASE_PATH`.
    - Chamadas repetidas a `getDatabase()` retornam a mesma conexão aberta.
    - O arquivo SQLite é criado localmente pelo projeto, inclusive quando o diretório pai ainda não existe.
  - **Traces:** US-5.1 / persistencia

- [ ] **Task:** Em `server/persistencia/`, implementar o esquema SQLite das tabelas `tarefas`, `categorias` e `anotacoes` e o comando de migração executado por `npm run migrate`. Usar IDs inteiros autoincrementados e armazenar datas como texto ISO-8601. Definir o status inicial da tarefa como `pendente`.
  - **Acceptance criteria:**
    - A migração cria `tarefas` com `id`, `titulo`, `descricao`, `status` e `data_criacao`; `titulo` é obrigatório, `descricao` aceita valor nulo e `status` aceita somente `pendente`, `em andamento` ou `concluída`, com valor inicial `pendente`.
    - A migração cria `categorias` com `id`, `nome`, `cor` e `data_criacao`; `nome` é obrigatório e único.
    - A migração cria `anotacoes` com `id`, `titulo`, `conteudo`, `data_criacao` e `data_atualizacao`; `titulo` e `conteudo` são obrigatórios. Executar `npm run migrate` novamente mantém o esquema e não gera erro.
  - **Traces:** US-5.1 / tarefas / categorias / anotacoes

- [ ] **Task:** Na raiz do projeto, documentar em `README.md` os comandos de instalação e inicialização da aplicação usando `.env.example`, incluindo a migração do banco.
  - **Acceptance criteria:**
    - `README.md` documenta os comandos `npm install`, `cp .env.example .env`, `npm run migrate` e `npm run dev`, nessa ordem de uso.
    - A configuração de exemplo usa apenas o arquivo SQLite local `./data/parallel-lab.sqlite` e não exige serviço externo.
  - **Traces:** US-5.1 / inicialização da aplicação

- [ ] **Task:** Em `server/index.ts` e `server/api/index.ts`, implementar o servidor Express com middleware JSON, prefixo de API `/api` e exportação de `registrarModulo(prefixo, roteador)` para montar roteadores de módulos sob `/api/{prefixo}`. Aplicar a migração idempotente antes de aceitar requisições.
  - **Acceptance criteria:**
    - `server/api/index.ts` exporta `registrarModulo(prefixo, roteador)` e monta o roteador recebido sob `/api/{prefixo}`.
    - `server/index.ts` configura Express para receber e retornar JSON e importa a migração de `server/persistencia/`.
    - O servidor aplica a migração antes de começar a aceitar requisições.
  - **Traces:** US-5.1 / api-central

- [ ] **Task:** Em `server/api/`, implementar o endpoint agregado de contagens do painel consultando as tabelas pela conexão de `getDatabase()` exportada por `server/persistencia/index.ts`.
  - **Acceptance criteria:**
    - `GET /api/painel` retorna HTTP 200 e JSON no formato `{ "tarefas": number, "categorias": number, "anotacoes": number }`.
    - Os três valores retornados correspondem às contagens das tabelas `tarefas`, `categorias` e `anotacoes` no SQLite aberto por `getDatabase()`.
  - **Traces:** US-5.1 / painel / persistencia

## Phase 2: Estrutura visual e navegação

**Goal:** Criar a interface responsiva em português brasileiro, com sistema visual próprio, barra lateral, caminhos de navegação, estrutura do painel, contagens, atalhos e estados compartilhados. · **Depends on:** Phase 1 · **Covers:** US-1.1, US-1.2, workflow 1 · **Areas:** frontend

- [ ] **Task:** Criar a base visual compartilhada em `src/app/styles/tokens.css` e `src/app/styles/global.css`, definindo cores, tipografia, espaçamentos, estilos de foco e regras de layout usadas pelo shell e pelo painel.
  - **Acceptance criteria:**
    - `tokens.css` define variáveis CSS compartilhadas para cores, tipografia e espaçamentos; `global.css` importa essas variáveis e define os estilos globais da interface.
    - `global.css` inclui regras responsivas para o conteúdo principal e estilos visíveis de foco para elementos interativos.
  - **Traces:** US-1.1 / US-1.2 / interface-base

- [ ] **Task:** Implementar o shell React em `src/app/App.tsx`, `src/app/routes.tsx` e `src/app/Sidebar.tsx`, com navegação para o painel e para as rotas `/`, `/tarefas`, `/categorias` e `/anotacoes`.
  - **Acceptance criteria:**
    - `routes.tsx` associa `/` ao painel e `/tarefas`, `/categorias` e `/anotacoes` às respectivas áreas de página; `App.tsx` renderiza as rotas dentro do shell compartilhado.
    - `Sidebar.tsx` apresenta os links “Painel”, “Tarefas”, “Categorias” e “Anotações”, que abrem, respectivamente, `/`, `/tarefas`, `/categorias` e `/anotacoes`.
    - A rota ativa recebe um estado visual distinto e cada rota renderiza seu conteúdo na área principal do shell.
  - **Traces:** US-1.2 / workflow 1

- [ ] **Task:** Tornar `src/app/Sidebar.tsx` e o layout principal do shell responsivos, mantendo os caminhos de navegação disponíveis em telas estreitas.
  - **Acceptance criteria:**
    - Em telas estreitas, a barra lateral pode ser aberta e fechada por um controle visível e acessível.
    - Ao selecionar um link em uma tela estreita, a navegação abre o caminho correspondente e fecha a barra lateral.
    - Em telas largas, os quatro links permanecem visíveis na barra lateral sem exigir abertura por controle.
  - **Traces:** US-1.2 / workflow 1

- [ ] **Task:** Implementar o painel em `src/app/Dashboard.tsx` e o serviço de dados em `src/app/services/painel.ts`, consumindo contagens reais de `GET /api/painel`.
  - **Acceptance criteria:**
    - `painel.ts` faz `GET /api/painel` com `fetch` e interpreta a resposta JSON `{ "tarefas": number, "categorias": number, "anotacoes": number }`.
    - `Dashboard.tsx` apresenta as contagens recebidas para tarefas, categorias e anotações, sem usar valores fictícios como dados da API.
    - O estado de carregamento é exibido enquanto `GET /api/painel` está pendente, e uma falha nessa chamada produz feedback visual de erro em português brasileiro.
  - **Traces:** US-1.1 / workflow 1

- [ ] **Task:** Adicionar atalhos para as páginas dos módulos em `src/app/Dashboard.tsx`.
  - **Acceptance criteria:**
    - O painel apresenta os atalhos “Tarefas”, “Categorias” e “Anotações”.
    - Cada atalho abre, respectivamente, `/tarefas`, `/categorias` e `/anotacoes`.
  - **Traces:** US-1.1 / workflow 1

- [ ] **Task:** Criar os estados compartilhados de carregamento e lista vazia em `src/app/components/LoadingState.tsx` e `src/app/components/EmptyState.tsx`.
  - **Acceptance criteria:**
    - `LoadingState.tsx` exporta um componente que apresenta uma mensagem de carregamento em português brasileiro.
    - `EmptyState.tsx` exporta um componente que apresenta uma mensagem de lista vazia em português brasileiro e aceita o texto da mensagem por propriedade.
  - **Traces:** interface-base / interface

- [ ] **Task:** Criar o feedback visual compartilhado de sucesso e erro em `src/app/components/Feedback.tsx`.
  - **Acceptance criteria:**
    - `Feedback.tsx` exporta componentes ou variantes identificáveis para mensagens de sucesso e de erro, com estilos distintos.
    - As mensagens são exibidas em português brasileiro e ficam associadas programaticamente ao conteúdo que comunicam.
  - **Traces:** interface-base / interface

## Phase 3: Gestão de tarefas

**Goal:** Implementar cadastro, consulta, edição, alteração de status e exclusão confirmada de tarefas persistidas, com validação de campos e estados da interface. Critério de aceite: o módulo possui testes automatizados e a aplicação aceita um banco isolado dos dados normais pela variável de ambiente DATABASE_PATH. · **Depends on:** Phase 1, Phase 2 · **Covers:** tarefas, US-2.1, workflow 2 · **Areas:** backend, frontend, dados

- [ ] **Task:** Em `server/modulos/tarefas/tarefaService.ts`, implementar operações de criação, consulta, listagem, edição, alteração de status e exclusão usando `getDatabase` de `server/persistencia/index.ts` e a tabela `tarefas`.
  - **Acceptance criteria:**
    - A criação grava título, descrição opcional, status `pendente` atribuído automaticamente e data de criação em formato ISO-8601; o identificador é inteiro autoincrementado.
    - A edição exige título, aceita descrição opcional e preserva a data de criação; a alteração de status aceita somente `pendente`, `em andamento` ou `concluída`.
    - Os serviços usam a conexão retornada por `getDatabase()` e não criam relações entre tarefas e outras entidades.
  - **Traces:** US-2.1 / tarefas / workflow 2

- [ ] **Task:** Em `server/modulos/tarefas/tarefasRouter.ts`, criar e exportar o roteador do módulo com as rotas de listagem, criação, consulta individual, edição, alteração de status e exclusão.
  - **Acceptance criteria:**
    - `GET /api/tarefas` retorna `200` e um array de tarefas com os campos `id`, `titulo`, `descricao`, `status` e `data_criacao`; `POST /api/tarefas` recebe JSON com `titulo` obrigatório e `descricao` opcional, e retorna `201` com `{id, titulo, descricao, status, data_criacao}`, atribuindo `pendente` ao status.
    - `GET /api/tarefas/{id}` retorna `200` e `{id, titulo, descricao, status, data_criacao}`; `PUT /api/tarefas/{id}` recebe título e descrição e retorna `200` com `{id, titulo, descricao, status, data_criacao}`.
    - `PUT /api/tarefas/{id}/status` recebe um status permitido e retorna `200` com `{id, titulo, descricao, status, data_criacao}`; `DELETE /api/tarefas/{id}` retorna `204`.
  - **Traces:** US-2.1 / tarefas / workflow 2

- [ ] **Task:** Em `src/modulos/tarefas/tarefasApi.ts` e `src/modulos/tarefas/TarefasPage.tsx`, implementar o acesso à API e a página de consulta no caminho `/tarefas`, expondo a página ao ponto de integração do shell já preparado para o módulo.
  - **Acceptance criteria:**
    - `tarefasApi.ts` consulta `GET /api/tarefas` e `GET /api/tarefas/{id}` e interpreta, respectivamente, um array e um objeto com `id`, `titulo`, `descricao`, `status` e `data_criacao`.
    - `TarefasPage.tsx` apresenta tarefas retornadas pela API com título, descrição, status e data de criação; quando não há tarefas, apresenta a lista vazia do shell compartilhado.
    - A página é acessível em `/tarefas` pelo shell compartilhado, sem reescrever os arquivos de navegação ou de integração de `src/app/`.
  - **Traces:** US-2.1 / tarefas / workflow 1, workflow 2

- [ ] **Task:** Em `src/modulos/tarefas/TarefaForm.tsx`, implementar o formulário de criação e edição de tarefas, integrado à página e a `tarefasApi.ts`.
  - **Acceptance criteria:**
    - O formulário permite informar título obrigatório e descrição opcional; título vazio impede o envio e apresenta feedback de erro.
    - A criação envia JSON com `titulo` e `descricao` a `POST /api/tarefas` e incorpora a resposta `{id, titulo, descricao, status, data_criacao}` à lista, com status `pendente`.
    - A edição envia título e descrição a `PUT /api/tarefas/{id}` e atualiza a tarefa exibida com o objeto `{id, titulo, descricao, status, data_criacao}` retornado.
  - **Traces:** US-2.1 / tarefas / workflow 2

- [ ] **Task:** Em `src/modulos/tarefas/TarefasPage.tsx` e `src/modulos/tarefas/tarefasApi.ts`, implementar a alteração do status de uma tarefa para os valores permitidos.
  - **Acceptance criteria:**
    - A interface permite escolher `pendente`, `em andamento` ou `concluída` para uma tarefa exibida.
    - A alteração envia JSON com `status` a `PUT /api/tarefas/{id}/status` e atualiza a tarefa com a resposta `{id, titulo, descricao, status, data_criacao}`.
    - Um status fora de `pendente`, `em andamento` e `concluída` não é aceito pelo serviço da rota.
  - **Traces:** US-2.1 / tarefas / workflow 2

- [ ] **Task:** Em `src/modulos/tarefas/TarefasPage.tsx` e `src/modulos/tarefas/tarefasApi.ts`, implementar a exclusão de tarefa com confirmação explícita na interface.
  - **Acceptance criteria:**
    - Ao solicitar exclusão, a interface pede confirmação antes de chamar `DELETE /api/tarefas/{id}`.
    - Se a pessoa confirmar, a interface remove a tarefa da lista após a resposta `204`; se cancelar, a tarefa permanece e a API não é chamada.
    - Sucesso e erro da operação são apresentados pelo feedback visual compartilhado do shell.
  - **Traces:** US-2.1 / tarefas / workflow 2

## Phase 4: Gestão de categorias

**Goal:** Implementar cadastro, consulta, edição e exclusão confirmada de categorias persistidas, com nome obrigatório e único e cor de identificação, entregando a página do módulo pronta para a integração da entrada compartilhada e da navegação na fase 6. Critério de aceite: o módulo possui testes automatizados e a aplicação aceita um banco isolado dos dados normais pela variável de ambiente DATABASE_PATH. · **Depends on:** Phase 1, Phase 2 · **Covers:** categorias, US-3.1, workflow 3 · **Areas:** backend, frontend, dados

- [ ] **Task:** Em `server/modulos/categorias/categoriasService.ts`, implemente as operações de listar, consultar por ID, criar, editar e excluir usando `getDatabase()` de `server/persistencia/index.ts` e a tabela `categorias`. A criação define `data_criacao` em formato ISO-8601; o nome é obrigatório e único entre as categorias.
  - **Acceptance criteria:**
    - O serviço retorna registros com `id`, `nome`, `cor` e `data_criacao`, e a consulta por ID e a edição identificam quando a categoria não existe.
    - A criação e a edição recusam nome vazio e nome já usado por outra categoria; a edição permite manter o nome da própria categoria.
    - As operações usam a conexão retornada por `getDatabase()` e não criam relações com tarefas ou anotações.
  - **Traces:** US-3.1 / categorias / workflow 3

- [ ] **Task:** Em `server/modulos/categorias/routes.ts`, implemente e exporte `categoriasRouter` com as rotas do módulo, usando `categoriasService.ts` e respostas JSON.
  - **Acceptance criteria:**
    - `GET /api/categorias` retorna `200` e um array de objetos `{id, nome, cor, data_criacao}`; `GET /api/categorias/{id}` retorna `200` e um objeto com esses campos ou `404` quando o registro não existe.
    - `POST /api/categorias` retorna `201` e `{id, nome, cor, data_criacao}`; `PUT /api/categorias/{id}` retorna `200` e `{id, nome, cor, data_criacao}`. Nome vazio ou duplicado retorna erro JSON com status `400` ou `409`, respectivamente.
    - `DELETE /api/categorias/{id}` exclui o registro e retorna `204`; se não existir, retorna `404`. O roteador é exportado sem registro no servidor central.
  - **Traces:** US-3.1 / categorias / workflow 3

- [ ] **Task:** Em `src/modulos/categorias/categoriasApi.ts`, implemente o serviço de interface para listar, consultar, criar, editar e excluir categorias por meio da API compartilhada.
  - **Acceptance criteria:**
    - A listagem chama `GET /api/categorias` e interpreta `200` como array de `{id, nome, cor, data_criacao}`; a consulta chama `GET /api/categorias/{id}` e interpreta `200` como objeto com esses campos.
    - A criação chama `POST /api/categorias` e a edição chama `PUT /api/categorias/{id}`, enviando `{nome, cor}` em JSON e interpretando `201` e `200`, respectivamente, como objeto `{id, nome, cor, data_criacao}`.
    - A exclusão chama `DELETE /api/categorias/{id}` e interpreta `204` como sucesso; respostas de erro da API são propagadas ao chamador.
  - **Traces:** US-3.1 / categorias / workflow 3

- [ ] **Task:** Em `src/modulos/categorias/CategoriasPage.tsx`, implemente a página de consulta de categorias consumindo `categoriasApi.ts`.
  - **Acceptance criteria:**
    - A página carrega e exibe categorias com nome e cor; cada item oferece ações para editar e excluir a categoria correspondente.
    - Durante a consulta, exibe estado de carregamento; quando a API retorna uma lista vazia, exibe estado vazio; quando ocorre erro, exibe feedback de erro.
    - A página exporta `CategoriasPage` e não registra caminhos na navegação compartilhada.
  - **Traces:** US-3.1 / categorias / workflow 1, workflow 3

- [ ] **Task:** Em `src/modulos/categorias/CategoriaForm.tsx`, implemente o formulário de criação e edição, conectado a `categoriasApi.ts` e utilizável por `CategoriasPage.tsx`.
  - **Acceptance criteria:**
    - O formulário contém campo obrigatório para nome e seletor de cor com valor inicial; ao editar, apresenta os valores atuais da categoria.
    - Impede o envio quando o nome está vazio e apresenta feedback de erro quando a API recusa o nome por duplicidade.
    - Criar chama `POST /api/categorias` com `{nome, cor}` e editar chama `PUT /api/categorias/{id}` com `{nome, cor}`; após sucesso, a página exibe a categoria retornada pela API.
  - **Traces:** US-3.1 / categorias / workflow 3

- [ ] **Task:** Em `src/modulos/categorias/ConfirmarExclusaoCategoria.tsx`, implemente a confirmação explícita da exclusão, integrada à ação de exclusão em `CategoriasPage.tsx`.
  - **Acceptance criteria:**
    - A interface solicita confirmação antes de chamar `DELETE /api/categorias/{id}`; cancelar mantém o registro e não chama a API.
    - Confirmar chama `DELETE /api/categorias/{id}`; após resposta `204`, a categoria removida deixa de aparecer na lista.
    - Erros da API são apresentados como feedback de erro e não removem a categoria da lista.
  - **Traces:** US-3.1 / categorias / workflow 3

- [ ] **Task:** Em `src/modulos/categorias/categorias.css`, defina os estilos responsivos da página, lista e formulário do módulo, aplicados pelos componentes em `src/modulos/categorias/`.
  - **Acceptance criteria:**
    - Os componentes do módulo importam `categorias.css`; os estilos cobrem a lista, o formulário, as ações e a confirmação de exclusão.
    - Em larguras estreitas, os nomes, campos e ações permanecem visíveis e utilizáveis sem exigir rolagem horizontal da página.
    - Os textos, rótulos e mensagens definidos pelos componentes do módulo estão em português brasileiro.
  - **Traces:** US-3.1 / categorias / workflow 1, workflow 3

## Phase 5: Gestão de anotações

**Goal:** Implementar cadastro, consulta, edição e exclusão confirmada de anotações persistidas, com título e conteúdo obrigatórios e datas de criação e atualização. Critério de aceite: o módulo possui testes automatizados e a aplicação aceita um banco isolado dos dados normais pela variável de ambiente DATABASE_PATH. · **Depends on:** Phase 1, Phase 2 · **Covers:** anotacoes, US-4.1, workflow 4 · **Areas:** backend, frontend, dados

- [ ] **Task:** Em `server/modulos/anotacoes/`, implementar o serviço de persistência de anotações, importando `getDatabase` de `server/persistencia/index.ts` e usando a conexão retornada para consultar e alterar a tabela `anotacoes`.
  - **Acceptance criteria:**
    - O serviço cria registros com `titulo`, `conteudo`, `data_criacao` e `data_atualizacao`; os identificadores são gerados pelo SQLite e as duas datas usam formato ISO-8601.
    - O serviço lista e consulta registros, atualiza `titulo` e `conteudo` e exclui registros; ao editar, atualiza `data_atualizacao`.
    - O módulo possui testes automatizados que usam um banco descartável, isolado dos dados normais da aplicação; a aplicação aceita esse banco por `DATABASE_PATH`.
  - **Traces:** US-4.1 / anotacoes / workflow 4

- [ ] **Task:** Em `server/modulos/anotacoes/`, implementar e exportar um roteador Express que encaminha as operações da API ao serviço de persistência de anotações.
  - **Acceptance criteria:**
    - `GET /api/anotacoes` retorna `200` e um array de objetos `{id, titulo, conteudo, data_criacao, data_atualizacao}`; `GET /api/anotacoes/{id}` retorna `200` e um objeto com esses campos quando o registro existe.
    - `POST /api/anotacoes` recebe JSON com `titulo` e `conteudo` e retorna `201` com `{id, titulo, conteudo, data_criacao, data_atualizacao}`; título ou conteúdo ausente ou vazio é rejeitado sem criar registro.
    - `PUT /api/anotacoes/{id}` recebe JSON com `titulo` e `conteudo` e retorna `200` com `{id, titulo, conteudo, data_criacao, data_atualizacao}`; título ou conteúdo ausente ou vazio é rejeitado sem atualizar o registro. `DELETE /api/anotacoes/{id}` retorna `204` após excluir o registro.
  - **Traces:** US-4.1 / anotacoes / workflow 4

- [ ] **Task:** Em `src/modulos/anotacoes/`, implementar e exportar o serviço de interface que envia e recebe JSON nos endpoints do módulo, usando o prefixo compartilhado `/api`.
  - **Acceptance criteria:**
    - O serviço lista anotações por `GET /api/anotacoes`, consulta uma por `GET /api/anotacoes/{id}`, cria por `POST /api/anotacoes`, atualiza por `PUT /api/anotacoes/{id}` e exclui por `DELETE /api/anotacoes/{id}`.
    - Nas listagens, o serviço interpreta um array de `{id, titulo, conteudo, data_criacao, data_atualizacao}`; nas consultas, criações e atualizações, interpreta um objeto com esses campos.
    - O serviço comunica erros da API à página do módulo sem substituir operações reais por dados fictícios ou mocks.
  - **Traces:** US-4.1 / anotacoes / workflow 4

- [ ] **Task:** Em `src/modulos/anotacoes/`, implementar e exportar a página de anotações destinada ao caminho de navegação `/anotacoes`, consumindo o serviço de interface do módulo.
  - **Acceptance criteria:**
    - A página lista as anotações retornadas pela API, exibindo título, conteúdo, data de criação e data de atualização de cada registro.
    - Durante a consulta, a página apresenta um estado de carregamento; quando a API retorna uma lista vazia, apresenta um estado vazio; quando a consulta falha, apresenta feedback visual de erro.
    - A página oferece acesso às ações de criar, editar e excluir cada anotação listada.
  - **Traces:** US-4.1 / anotacoes / workflow 4

- [ ] **Task:** Em `src/modulos/anotacoes/`, implementar o formulário de criação e edição de anotações e conectá-lo à página do módulo.
  - **Acceptance criteria:**
    - O formulário de criação solicita título e conteúdo; o formulário de edição apresenta os valores atuais do registro.
    - A interface exige título e conteúdo na criação e na edição e exibe feedback de erro quando a API rejeita uma operação.
    - Após criação ou edição bem-sucedida, a interface exibe feedback visual de sucesso e apresenta os dados persistidos retornados pela API, incluindo `data_atualizacao`.
  - **Traces:** US-4.1 / anotacoes / workflow 4

- [ ] **Task:** Em `src/modulos/anotacoes/`, implementar a exclusão de anotações com confirmação explícita na interface.
  - **Acceptance criteria:**
    - A ação de excluir solicita confirmação antes de enviar `DELETE /api/anotacoes/{id}`; cancelar a confirmação não envia a requisição.
    - Após confirmação, a interface atualiza a lista quando a API retorna `204` e exibe feedback visual de sucesso.
    - Se a API falhar ao excluir, a interface mantém o registro na lista e exibe feedback visual de erro.
  - **Traces:** US-4.1 / anotacoes / workflow 4

## Phase 6: Integração da aplicação

**Goal:** Conectar os roteadores e páginas dos três módulos ao servidor e à navegação compartilhada, integrar API e interface para viabilizar os fluxos reais no navegador e documentar os comandos de inicialização e compilação, incluindo a cópia de .env.example para .env; a aplicação compila sem erros. · **Depends on:** Phase 3, Phase 4, Phase 5 · **Covers:** US-1.1, US-1.2, US-5.1, workflow 1, workflow 2, workflow 3, workflow 4 · **Areas:** backend, frontend, geral

- [ ] **Task:** Em `server/api/index.ts`, criar o servidor Express, montar os roteadores existentes de `server/modulos/tarefas/routes.ts`, `server/modulos/categorias/routes.ts` e `server/modulos/anotacoes/routes.ts` sob `/api/tarefas`, `/api/categorias` e `/api/anotacoes`, e executar a migração idempotente de `server/persistencia/` antes de aceitar requisições.
  - **Acceptance criteria:**
    - `server/api/index.ts` monta os três roteadores nos prefixos indicados e inicia o servidor somente após a migração idempotente.
    - As rotas montadas incluem GET `/api/tarefas` e GET `/api/categorias` e GET `/api/anotacoes`, cada uma retornando um array JSON com os campos da entidade; GET `/api/tarefas/{id}`, POST `/api/tarefas` e PUT `/api/tarefas/{id}` retornam um objeto JSON com `id, titulo, descricao, status, data_criacao`; GET `/api/categorias/{id}`, POST `/api/categorias` e PUT `/api/categorias/{id}` retornam um objeto JSON com `id, nome, cor, data_criacao`; GET `/api/anotacoes/{id}`, POST `/api/anotacoes` e PUT `/api/anotacoes/{id}` retornam um objeto JSON com `id, titulo, conteudo, data_criacao, data_atualizacao`.
    - As rotas montadas incluem PUT `/api/tarefas/{id}/status` para alterar o status e DELETE `/api/tarefas/{id}`, DELETE `/api/categorias/{id}` e DELETE `/api/anotacoes/{id}` para excluir registros.
  - **Traces:** US-5.1 / API central / workflow 2, 3 e 4

- [ ] **Task:** Em `server/api/painel.ts`, implementar o endpoint agregado do painel usando `getDatabase()` exportada por `server/persistencia/index.ts`, e registrar esse roteador em `server/api/index.ts`.
  - **Acceptance criteria:**
    - GET `/api/painel` retorna HTTP 200 e JSON `{tarefas: number, categorias: number, anotacoes: number}`.
    - Cada contagem retornada corresponde ao número de registros da tabela SQLite correspondente, consultada pela conexão retornada por `getDatabase()`.
  - **Traces:** US-1.1 / tarefas, categorias e anotações / workflow 1

- [ ] **Task:** Em `src/app/`, integrar o shell React às páginas de `src/modulos/tarefas/`, `src/modulos/categorias/` e `src/modulos/anotacoes/`, registrando os caminhos de navegação `/`, `/tarefas`, `/categorias` e `/anotacoes` e exibindo barra lateral e atalhos para os três módulos no painel inicial.
  - **Acceptance criteria:**
    - O shell React registra `/` para o painel inicial, `/tarefas` para a página de tarefas, `/categorias` para a página de categorias e `/anotacoes` para a página de anotações.
    - A barra lateral e os atalhos do painel apontam para `/tarefas`, `/categorias` e `/anotacoes`; a navegação abre a página correspondente.
    - O painel inicial solicita GET `/api/painel` e exibe as contagens recebidas no JSON `{tarefas: number, categorias: number, anotacoes: number}`.
  - **Traces:** US-1.1, US-1.2 / interface compartilhada / workflow 1

- [ ] **Task:** Em `vite.config.ts` e nas integrações da interface em `src/modulos/`, configurar o encaminhamento das solicitações `/api` ao servidor Node.js e conectar as páginas aos serviços dos módulos para operar sobre os registros reais da API.
  - **Acceptance criteria:**
    - `vite.config.ts` encaminha solicitações com prefixo `/api` ao servidor da API durante o desenvolvimento.
    - A página de tarefas usa GET `/api/tarefas`, POST `/api/tarefas`, GET `/api/tarefas/{id}`, PUT `/api/tarefas/{id}`, PUT `/api/tarefas/{id}/status` e DELETE `/api/tarefas/{id}`; listas consomem arrays JSON com `id, titulo, descricao, status, data_criacao`, e consultas, criações e atualizações consomem objetos JSON com esses campos.
    - A página de categorias usa GET `/api/categorias`, POST `/api/categorias`, GET `/api/categorias/{id}`, PUT `/api/categorias/{id}` e DELETE `/api/categorias/{id}`; a página de anotações usa GET `/api/anotacoes`, POST `/api/anotacoes`, GET `/api/anotacoes/{id}`, PUT `/api/anotacoes/{id}` e DELETE `/api/anotacoes/{id}`. Listas consomem arrays JSON e consultas, criações e atualizações consomem objetos JSON com, respectivamente, `id, nome, cor, data_criacao` e `id, titulo, conteudo, data_criacao, data_atualizacao`.
  - **Traces:** US-5.1 / interface e serviços dos módulos / workflow 2, 3 e 4

- [ ] **Task:** Na raiz do projeto, configurar em `package.json` os comandos `dev` para iniciar API e Vite em conjunto e `build` para compilar servidor e interface; documentar em `README.md` a cópia de `.env.example` para `.env` e os comandos de migração, inicialização e compilação.
  - **Acceptance criteria:**
    - `package.json` define `npm run dev`, `npm run migrate` e `npm run build`; `npm run dev` inicia API e Vite em conjunto, e `npm run build` compila o servidor e a interface.
    - `README.md` documenta `cp .env.example .env`, `npm run migrate`, `npm run dev` e `npm run build`, na ordem de preparação e uso da aplicação.
    - A compilação por `npm run build` termina sem erros.
  - **Traces:** US-5.1 / inicialização e compilação / workflow 1, 2, 3 e 4
