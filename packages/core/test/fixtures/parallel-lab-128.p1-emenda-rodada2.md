- [ ] **Task:** Configure o projeto em `package.json`, `tsconfig.json`, `vite.config.ts` e `index.html` para React com Vite e TypeScript, incluindo as dependências da arquitetura, o comando `npm run dev` para iniciar API e interface juntas e o proxy de `/api` para `http://localhost:3001`.
  - **Acceptance criteria:**
    - `package.json` declara scripts `dev` e `migrate`; `dev` inicia os processos da API e da interface em conjunto.
    - `vite.config.ts` encaminha solicitações com prefixo `/api` para `http://localhost:3001`.
    - `index.html` monta a aplicação React a partir de `src/main.tsx`.
  - **Traces:** workflow 1, workflow 2, workflow 3, workflow 4

- [ ] **Task:** Em `.gitignore`, `.env.example` e `src/database/index.ts`, configure o carregamento de `DB_PATH` do `.env` na raiz e a abertura do arquivo SQLite indicado pelo ambiente; use `./data/parallel-lab.sqlite` como valor de exemplo.
  - **Acceptance criteria:**
    - `.gitignore` contém `.env`, e `.env.example` declara `DB_PATH=./data/parallel-lab.sqlite` sem credenciais.
    - `src/database/index.ts` exporta uma função que abre o arquivo definido por `DB_PATH` e cria o diretório pai quando necessário.
    - Com outro valor local em `DB_PATH`, a função abre esse arquivo SQLite, sem depender de serviço externo.
  - **Traces:** tarefas, categorias, anotacoes / persistencia

- [ ] **Task:** Em `src/migrations`, crie migrações versionadas para as tabelas `tarefas`, `categorias` e `anotacoes`, usando identificadores inteiros gerados pelo SQLite e sem relações entre as tabelas.
  - **Acceptance criteria:**
    - As migrações definem `tarefas` com `id`, `titulo` obrigatório, `descricao` opcional, `status` obrigatório e `data_criacao`; `categorias` com `id`, `nome` obrigatório e único, `cor` e `data_criacao`; e `anotacoes` com `id`, `titulo` e `conteudo` obrigatórios, `data_criacao` e `data_atualizacao`.
    - `package.json` define `npm run migrate` para aplicar as migrações a partir de banco vazio, sem erro quando executado novamente.
    - A inicialização da aplicação não aplica as migrações automaticamente.
  - **Traces:** tarefas, categorias, anotacoes / persistencia

- [ ] **Task:** Em `src/server/index.ts` e `src/server/app.ts`, implemente a inicialização da API Express na porta `3001` durante o desenvolvimento e configure o prefixo compartilhado `/api`.
  - **Acceptance criteria:**
    - `src/server/index.ts` inicia o servidor na porta `3001`.
    - `src/server/app.ts` monta as rotas da API sob `/api`.
    - O script `dev` de `package.json` inicia o servidor junto com a interface Vite.
  - **Traces:** workflow 1, workflow 2, workflow 3, workflow 4

- [ ] **Task:** Em `src/server/app.ts` e `src/server/modules/*/routes.ts`, implemente a descoberta das rotas próprias dos módulos e monte cada rota encontrada sob `/api`, com respostas de erro no formato JSON compartilhado.
  - **Acceptance criteria:**
    - `src/server/app.ts` descobre arquivos `src/server/modules/*/routes.ts` e monta suas rotas sob `/api`, sem exigir alteração no arquivo de inicialização para adicionar cada módulo.
    - O tratamento de erros da API responde com JSON no formato `{"erro":"mensagem"}`.
  - **Traces:** tarefas, categorias, anotacoes / api.prefixo

- [ ] **Task:** Em `src/server/routes/resumo.ts`, implemente `GET /api/resumo` para contar os registros persistidos nas três tabelas SQLite.
  - **Acceptance criteria:**
    - `GET /api/resumo` responde `200` com objeto JSON no formato `{"tarefas": número, "categorias": número, "anotacoes": número}`.
    - Os três totais são obtidos das tabelas `tarefas`, `categorias` e `anotacoes` do banco selecionado por `DB_PATH`.
  - **Traces:** workflow 4 / tarefas, categorias, anotacoes

- [ ] **Task:** Em `src/main.tsx`, `src/App.tsx` e `src/modules/*/page.tsx`, implemente a descoberta de páginas dos módulos e a navegação pelos caminhos `/`, `/tarefas`, `/categorias` e `/anotacoes`.
  - **Acceptance criteria:**
    - `src/App.tsx` descobre páginas em `src/modules/*/page.tsx`; cada página exporta o caminho de navegação e o componente que o caminho apresenta.
    - A aplicação resolve `/`, `/tarefas`, `/categorias` e `/anotacoes` e apresenta navegação lateral para esses caminhos.
    - A descoberta das páginas não exige adicionar entradas individuais em `src/App.tsx` para cada módulo.
  - **Traces:** navegacao / tarefas, categorias, anotacoes

- [ ] **Task:** Em `src/modules/painel/page.tsx`, implemente o painel inicial para obter os totais por `GET /api/resumo` e apresentá-los na rota `/`.
  - **Acceptance criteria:**
    - A página do painel em `src/modules/painel/page.tsx` solicita `GET /api/resumo` pelo caminho `/api/resumo`.
    - A rota `/` apresenta os totais de tarefas, categorias e anotações retornados pela API.
    - A rota `/` apresenta feedback de carregamento e de erro durante a solicitação dos totais.
  - **Traces:** workflow 4 / api.resumo