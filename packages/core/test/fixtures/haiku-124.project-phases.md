# Parallel Lab — Project Phases

<!-- inputs: skeleton.md@sha256:f8d0be8edd74 architecture.md@sha256:dc12db79f4e0 -->

## Overview

7 fases, fundação primeiro. O MVP fecha na fase 6.

**Conventions:**
- `[ ]` pendente · `[x]` concluído

## Phase 1: Fundação: banco, esquema e API base

**Goal:** A aplicação abre um arquivo SQLite criado pelo próprio projeto ou o caminho indicado em CAMINHO_BANCO no ambiente do processo, aplica o esquema das três tabelas, responde sob /api com o formato comum de erro e expõe os pontos onde os módulos se registram. Nenhuma funcionalidade de módulo é entregue nesta fase. · **Depends on:** none · **Covers:** US-1.3 · **Areas:** dados, backend, infra

### Phase 1.1: Projeto base

- [ ] **Task:** Criar na raiz o `package.json` com `"type": "module"`, os scripts e as dependências abaixo, e gerar o `package-lock.json` pela instalação. Scripts: `migrate` executa `tsx scripts/migrar.ts`; `dev:servidor` executa `tsx watch src/servidor/index.ts`; `dev:web` executa `vite`; `build` executa `tsc -p tsconfig.servidor.json && tsc -p tsconfig.json && vite build`; `start` executa `node dist/servidor/src/servidor/index.js`. Dependências de execução: express, better-sqlite3, react, react-dom, react-router e tsx. Dependências de desenvolvimento: typescript, vite, @vitejs/plugin-react, @types/node, @types/express, @types/better-sqlite3, @types/react e @types/react-dom. Criar também `tsconfig.servidor.json` (inclui `src/servidor` e `scripts`, com `"strict": true`, `"module": "NodeNext"`, `"rootDir": "."` e `"outDir": "dist/servidor"`, sem `"noEmit"`), `tsconfig.json` (inclui `src/web`, com `"strict": true`, `"noEmit": true` e `"jsx": "react-jsx"`), `vite.config.ts` (plugin React, build gravado em `dist/web`, `server.proxy` encaminhando `/api` para `http://localhost:3000`), `index.html` na raiz que carrega `src/web/main.tsx`, e `src/web/main.tsx`, que monta um componente React vazio no elemento de id `raiz`. Nenhuma tela é criada nesta tarefa.
  - **Acceptance criteria:**
    - `package.json` define exatamente os cinco scripts acima, com os comandos escritos literalmente.
    - `package.json` lista express, better-sqlite3, react, react-dom, react-router e tsx em `dependencies`, e os pacotes de desenvolvimento listados acima em `devDependencies`.
    - `tsconfig.servidor.json` inclui `src/servidor` e `scripts` com `"strict": true`, `"outDir": "dist/servidor"` e sem `"noEmit"`, e `tsconfig.json` inclui `src/web` com `"strict": true` e `"noEmit": true`.
    - `vite.config.ts` grava o build em `dist/web` e tem `server.proxy` com a chave `/api` apontando para `http://localhost:3000`; `index.html` existe na raiz e carrega `src/web/main.tsx`.
  - **Traces:** US-1.3 / fundação (stack e comandos documentados)

- [ ] **Task:** Criar na raiz o `.gitignore` e o `.env.example`. O `.gitignore` contém as linhas `.env`, `dados/`, `node_modules/` e `dist/`. O `.env.example` contém somente a variável `CAMINHO_BANCO=./dados/parallel-lab.sqlite`. Nenhum arquivo `.env` é criado.
  - **Acceptance criteria:**
    - `.gitignore` contém as linhas `.env`, `dados/`, `node_modules/` e `dist/`.
    - `.env.example` contém somente a linha `CAMINHO_BANCO=./dados/parallel-lab.sqlite`, sem senha, token, string de conexão ou credencial real.
  - **Traces:** US-1.3 / configuração do banco

### Phase 1.2: Banco

- [ ] **Task:** Criar `src/servidor/banco/configuracao.ts` com `lerCaminhoBanco(): string`, que segue esta ordem. Primeiro, se `CAMINHO_BANCO` estiver definida em `process.env` e não for vazia, usa esse valor e não lê o `.env`. Depois, se a variável estiver definida e vazia, a remove de `process.env`; em seguida, se existir o `.env` na raiz, carrega-o com `process.loadEnvFile`, sem sobrescrever variáveis já definidas, e usa o valor de `CAMINHO_BANCO` lido dele. Por fim, se a variável estiver ausente nas duas origens, lança `Error` com mensagem em português que contém o nome `CAMINHO_BANCO`. Caminhos relativos são resolvidos a partir da pasta que contém o `package.json`, e o retorno é sempre um caminho absoluto.
  - **Acceptance criteria:**
    - Com `CAMINHO_BANCO` definida e não vazia em `process.env`, `lerCaminhoBanco()` devolve o caminho absoluto correspondente a esse valor, e o código não lê o `.env` nesse caso.
    - Sem a variável em `process.env` e com o `.env` presente na raiz, `lerCaminhoBanco()` devolve o valor de `CAMINHO_BANCO` lido do `.env`.
    - Sem a variável nas duas origens, `lerCaminhoBanco()` lança `Error` cuja mensagem em português contém `CAMINHO_BANCO`.
  - **Traces:** US-1.3 / configuração do banco

- [ ] **Task:** Criar `src/servidor/banco/esquema.ts` com `aplicarEsquema(banco: Database): void`, que executa `CREATE TABLE IF NOT EXISTS` para estas três tabelas, com exatamente estas colunas. Em `tarefas`: `id` inteiro autoincrementado como chave primária, `titulo` texto obrigatório, `descricao` texto anulável, `status` texto obrigatório restrito por `CHECK` aos valores `'pendente'`, `'em andamento'` e `'concluída'`, e `criadoEm` texto obrigatório. Em `categorias`: `id`, `nome` texto obrigatório, `cor` texto obrigatório e `criadoEm` texto obrigatório. Em `anotacoes`: `id`, `titulo` texto obrigatório, `conteudo` texto obrigatório, `criadoEm` texto obrigatório e `atualizadoEm` texto obrigatório. Não há chave estrangeira entre as tabelas, nem índice ou restrição `UNIQUE` em `categorias.nome`. Criar também `src/servidor/banco/conexao.ts` com `abrirBanco(caminho: string): Database`, que cria o diretório pai quando ausente, abre o arquivo com better-sqlite3, aplica `aplicarEsquema` e devolve o handle. Criar `scripts/migrar.ts`, que obtém o caminho com `lerCaminhoBanco`, abre o banco com `abrirBanco` e fecha a conexão.
  - **Acceptance criteria:**
    - `aplicarEsquema` cria as tabelas `tarefas`, `categorias` e `anotacoes` com as colunas listadas, usando `CREATE TABLE IF NOT EXISTS`; `esquema.ts` não contém `DROP`, `DELETE` nem `ALTER`.
    - `abrirBanco(caminho)` cria o diretório pai quando ausente, abre o arquivo com better-sqlite3, aplica o esquema e devolve o `Database`, sem remover nem alterar registros existentes.
    - Com o `.env` copiado de `.env.example`, `npm run migrate` cria o arquivo `./dados/parallel-lab.sqlite` dentro da pasta do projeto e pode ser executado de novo sem erro.
  - **Traces:** US-1.3 / tabelas tarefas, categorias e anotacoes

### Phase 1.3: API base

- [ ] **Task:** Criar `src/servidor/comum/erros.ts`, `src/servidor/comum/texto.ts` e `src/servidor/comum/datas.ts`. Em `erros.ts`, a classe `ErroAplicacao` estende `Error`, com construtor `(status: number, mensagem: string)`, expondo `status` e `mensagem`. Em `texto.ts`, `lerTexto(valor: unknown, opcoes: { campo: string; obrigatorio: boolean; limite: number }): string | null` trata `undefined` e `null` como vazios; se o valor não for texto, lança `ErroAplicacao` com status 400; remove os espaços das extremidades; se o resultado estiver vazio, devolve `null` quando opcional e lança `ErroAplicacao` com status 400 quando obrigatório; se o resultado tiver mais caracteres que `limite`, lança `ErroAplicacao` com status 400; caso contrário devolve o texto com os espaços internos preservados. As mensagens em português citam `opcoes.campo`. Em `datas.ts`, `agoraIso(): string` devolve `new Date().toISOString()`.
  - **Acceptance criteria:**
    - `ErroAplicacao` é subclasse de `Error`, tem construtor `(status: number, mensagem: string)` e expõe as propriedades `status` e `mensagem`.
    - `lerTexto` remove os espaços das extremidades, rejeita com status 400 valores que não são texto, texto vazio em campo obrigatório e texto acima de `limite` após a remoção; devolve `null` para texto vazio em campo opcional; preserva os espaços internos.
    - `agoraIso` devolve a data atual em ISO 8601 UTC, com sufixo `Z`, obtida de `new Date().toISOString()`.
  - **Traces:** US-1.3 / API base (formato de erro e utilidades compartilhadas)

- [ ] **Task:** Criar `src/servidor/modulos.ts` com `criarModulosApi(banco: Database): { caminho: string; router: Router }[]`, que devolve, nesta ordem, as entradas com `caminho` `/tarefas`, `/categorias`, `/anotacoes` e `/painel`, cada uma com o router devolvido por `criarRotas(banco)` do módulo correspondente. Criar os stubs `src/servidor/modulos/tarefas/rotas.ts`, `src/servidor/modulos/categorias/rotas.ts`, `src/servidor/modulos/anotacoes/rotas.ts` e `src/servidor/modulos/painel/rotas.ts`; cada um exporta `criarRotas(banco: Database): Router` e devolve um Router sem nenhuma rota. Criar `src/servidor/interface.ts` com `montarInterface(app: Express): void`: se `dist/web/index.html` existir, a partir da raiz do projeto, serve `dist/web` como arquivos estáticos e responde a GET fora de `/api` que não corresponda a arquivo com `dist/web/index.html`, cobrindo `/`, `/tarefas`, `/categorias` e `/anotacoes`. Requisições GET para `/api/*` passam adiante sem receber `index.html`. Se `dist/web/index.html` não existir, a função não registra nada.
  - **Acceptance criteria:**
    - `criarModulosApi` devolve exatamente quatro entradas, com `caminho` `/tarefas`, `/categorias`, `/anotacoes` e `/painel`, cada uma com o router de `criarRotas` do seu módulo.
    - Os quatro arquivos `rotas.ts` existem, e cada `criarRotas` devolve um Router sem nenhuma rota definida.
    - `montarInterface` responde GET fora de `/api` que não corresponde a arquivo com `dist/web/index.html`, e não responde com `index.html` a nenhum GET cujo caminho começa com `/api/`.
  - **Traces:** Rotas de navegação (/, /tarefas, /categorias, /anotacoes); api.prefixo

- [ ] **Task:** Criar `src/servidor/app.ts` com `criarApp(opcoes: { banco: Database }): Express`, que aplica `express.json()`, monta cada item de `criarModulosApi(banco)` em `/api` seguido do `caminho` do item, registra `montarInterface(app)` depois das rotas da API, responde 404 `{ erro }` a qualquer `/api/*` não atendido, e registra o middleware de erro: `ErroAplicacao` responde seu `status` com `{ erro: mensagem }`; JSON inválido responde 400 com `{ erro }`; qualquer outra falha responde 500 com `{ erro: 'Erro interno do servidor.' }`. Criar `src/servidor/index.ts`, que chama `lerCaminhoBanco()`, depois `abrirBanco(caminho)`, depois `criarApp({ banco })`, e só então escuta a porta 3000.
  - **Acceptance criteria:**
    - `criarApp` monta as rotas em `/api` e responde JSON em UTF-8; a resposta 404 de `/api` inexistente, a 400 de JSON inválido, a de `ErroAplicacao` e a 500 de falha não prevista têm o corpo `{ erro }` com mensagem em português.
    - Em `src/servidor/index.ts`, a chamada a `lerCaminhoBanco` vem antes de `abrirBanco`, que vem antes de `criarApp`, e a escuta da porta 3000 vem por último.
    - `npm run build` termina sem erros, e `npm start` sobe o servidor na porta 3000 e responde a `GET /api/tarefas` com 404 e corpo `{ erro }`, porque o módulo ainda não tem rotas nesta fase.
  - **Traces:** US-1.3 / API base e inicialização

## Phase 2: Casca da interface: navegação, design, estados e entrega do build

**Goal:** A interface abre no Dashboard, navega entre as quatro páginas pela sidebar responsiva e oferece o sistema de design, os estados de carregamento e vazio, o feedback de sucesso e erro e o cliente da API, prontos para os módulos. A aplicação iniciada pelo servidor entrega a interface compilada de dist/web e responde às rotas de navegação com a página principal, sem interferir em /api. As páginas de módulo existem apenas como cascas, sem dados. · **Depends on:** Phase 1 · **Covers:** US-1.1, US-1.4, US-1.5 · **Areas:** frontend, backend, infra

- [ ] **Task:** Criar os componentes `Botao.tsx` e `Campo.tsx` em `src/web/componentes/`, com as variantes do botão e o motivo da rejeição junto ao campo.
  - **Acceptance criteria:**
    - `Botao.tsx` exporta `Botao({ variante, tipo?, desabilitado?, children, onClick? })`, com `variante` igual a `'primaria' | 'secundaria' | 'perigo'`. Cada variante recebe uma classe própria. `tipo` é `'button' | 'submit' | 'reset'` e tem `'button'` como padrão. Quando `desabilitado` é verdadeiro, o elemento tem o atributo `disabled` e `onClick` não é chamado.
    - `Campo.tsx` exporta `Campo({ rotulo, erro?, children })`: mostra `rotulo` como texto de um `<label>` que envolve `children`. Quando `erro` é informado, mostra o texto de `erro` em um elemento com a classe `campo-erro`, junto ao campo.
  - **Traces:** US-1.4 / interface.validacao

- [ ] **Task:** Criar os componentes `Estados.tsx` e `Dialogo.tsx` em `src/web/componentes/`, com os estados de carregamento e vazio e o diálogo de confirmação.
  - **Acceptance criteria:**
    - `Estados.tsx` exporta `EstadoCarregamento({ rotulo })`, que renderiza um elemento com a classe `estado-carregamento`, `role="status"` e o texto de `rotulo`. Também exporta `EstadoVazio({ mensagem, rotuloAcao, aoAcionar })`, que renderiza um elemento com a classe `estado-vazio`, o texto de `mensagem` e um `Botao` de variante `primaria` com o texto `rotuloAcao`, que chama `aoAcionar` ao ser clicado.
    - `Dialogo.tsx` exporta `Dialogo({ aberto, titulo, mensagem, aoConfirmar, aoCancelar })`. Quando `aberto` é falso, não renderiza nada. Quando é verdadeiro, renderiza um elemento com `role="dialog"` e `aria-modal="true"`, com `titulo`, `mensagem` e dois botões de texto `Confirmar` e `Cancelar`, que chamam, respectivamente, `aoConfirmar` e `aoCancelar`.
  - **Traces:** US-1.4 / interface.carregamento-e-vazio / exclusao.confirmacao

- [ ] **Task:** Criar o componente `Notificacao.tsx` em `src/web/componentes/`, com `FeedbackProvider` e o hook `useFeedback`.
  - **Acceptance criteria:**
    - `Notificacao.tsx` exporta `FeedbackProvider` e o hook `useFeedback(): { sucesso(mensagem: string): void; erro(mensagem: string): void }`. Cada chamada mostra uma única notificação, que substitui a anterior, com `role="status"` para sucesso ou `role="alert"` para erro. A notificação some sozinha após 5000 ms e tem um botão de texto `Fechar` que a remove.
  - **Traces:** US-1.4 / interface.feedback

- [ ] **Task:** Criar `src/servidor/comum/erros.ts`, `src/servidor/comum/texto.ts` e `src/servidor/comum/datas.ts`, e a lista única de montagem das rotas em `src/servidor/modulos.ts`.
  - **Acceptance criteria:**
    - `src/servidor/comum/erros.ts` exporta `class ErroAplicacao` que estende `Error`, com construtor `(status: number, mensagem: string)` e as propriedades `status` e `mensagem`.
    - `src/servidor/comum/texto.ts` exporta `lerTexto(valor: unknown, opcoes: { campo: string; obrigatorio: boolean; limite: number }): string | null`. Quando `obrigatorio` é `false`, ausência (`undefined`) e nulo são tratados como vazio e devolvem `null`; quando `obrigatorio` é `true`, ausência ou nulo são rejeitados com `ErroAplicacao(400, ...)`. Um valor presente é cortado nas extremidades. Se o resultado for vazio, devolve `null` quando `obrigatorio` é `false` e lança `ErroAplicacao(400, ...)` quando é `true`. Se o valor presente não for texto, ou se o resultado tiver mais caracteres que `limite`, lança `ErroAplicacao(400, ...)`. A mensagem cita o nome de `campo` em português do Brasil. Espaços internos e quebras de linha são preservados.
    - `src/servidor/comum/datas.ts` exporta `agoraIso(): string`, que devolve `new Date().toISOString()`.
    - `src/servidor/modulos.ts` exporta `criarModulosApi(banco: Database): { caminho: string; router: Router }[]`, que é o ponto único de montagem: cada módulo acrescenta o seu item nesse ponto.
  - **Traces:** api.formato / tarefas.titulo / tarefas.descricao / categorias.nome / anotacoes.titulo / anotacoes.conteudo / US-1.4

- [ ] **Task:** Criar `src/servidor/app.ts`, `src/servidor/interface.ts` e `src/servidor/index.ts`: a aplicação Express com a API sob `/api`, o tratamento de erros, a entrega da interface compilada e a inicialização do servidor.
  - **Acceptance criteria:**
    - `criarApp(opcoes: { banco: Database }): Express` em `app.ts` aplica `express.json()`, monta cada item de `criarModulosApi(banco)` em `/api` + `caminho` e só depois chama `montarInterface(app)`.
    - O tratamento de erros responde assim: `ErroAplicacao` devolve o `status` com `{ erro: mensagem }`; uma rota desconhecida sob `/api` devolve 404 com `{ erro }`; um corpo JSON inválido devolve 400 com `{ erro }`; qualquer outra falha devolve 500 com `{ erro: "Erro interno do servidor." }`.
    - `montarInterface(app: Express): void` em `interface.ts` procura `dist/web/index.html`, resolvido a partir de `process.cwd()`, que é a raiz do projeto quando os comandos npm são executados. Se o arquivo existir, serve `dist/web` como arquivos estáticos e responde `GET` fora de `/api` que não corresponda a um arquivo com o `dist/web/index.html`. Requisições `/api/*` nunca recebem esse fallback. Se o arquivo não existir, não registra nada.
    - `src/servidor/index.ts` chama `lerCaminhoBanco()`, depois `abrirBanco(caminho)`, depois `criarApp({ banco })`, e só então escuta a porta `3000`.
  - **Traces:** api.prefixo / api.formato / rotas-de-navegacao / aplicacao.inicializacao / aplicacao.persistencia

- [ ] **Task:** Criar `src/web/estilos/tokens.css` e `src/web/estilos/base.css`, o sistema de design em CSS.
  - **Acceptance criteria:**
    - `src/web/estilos/tokens.css` declara, em `:root`, propriedades CSS customizadas com os prefixos `--cor-`, `--espaco-`, `--texto-` e `--foco-`. As cores de superfície, texto, borda, primária, perigo e foco são declaradas com `--cor-`. A escala de espaçamento é `--espaco-1` a `--espaco-6` com os valores 4px, 8px, 12px, 16px, 24px e 32px. Há tokens de tipografia com `--texto-`, e de estilo de foco com `--foco-`.
    - Dentro de um bloco `@media (prefers-color-scheme: dark)` em `tokens.css`, cada token `--cor-` declarado em `:root` é redefinido com um valor do tema escuro. Nenhum seletor de tema manual (classe ou atributo de tema) existe em `src/web`.
    - `src/web/estilos/base.css` não contém valores de cor literais (hexadecimais, `rgb` ou `hsl`); usa apenas tokens. Define uma regra `:focus-visible` que usa `--foco-`, uma regra de hover para botões e links, e as classes `.estado-carregamento` e `.estado-vazio` estilizadas com tokens.
  - **Traces:** interface.design / US-1.5

- [ ] **Task:** Criar `src/web/api/cliente.ts` e `src/web/comum/datas.ts`, e configurar `index.html` e `vite.config.ts`.
  - **Acceptance criteria:**
    - `src/web/api/cliente.ts` exporta `requisitar<T>(metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', caminho: string, corpo?: unknown): Promise<T>`. Ele chama `'/api' + caminho`, envia o corpo em JSON com `Content-Type: application/json` quando `corpo` é informado, devolve `undefined` quando a resposta é 204 e, nos demais casos, devolve o JSON. Quando a resposta não é de sucesso, lança `ErroApi` com `mensagem` igual ao campo `erro` do corpo, ou `"Não foi possível concluir a operação."` se o campo não existir, e com `status` igual ao código HTTP. `ErroApi` é exportada da mesma pasta.
    - `src/web/comum/datas.ts` exporta `formatarDataHora(iso: string): string`, que devolve `dd/mm/aaaa hh:mm` a partir de `getDate`, `getMonth`, `getFullYear`, `getHours` e `getMinutes` do objeto `Date` (horário local do navegador), com dois dígitos em dia, mês, hora e minuto. O valor recebido não é alterado.
    - `index.html` declara `<html lang="pt-BR">`, tem um elemento `<div id="root">` e carrega `/src/web/main.tsx`. `vite.config.ts` usa o plugin de React, define `build.outDir` como `dist/web` e define `server.proxy` de `/api` para `http://localhost:3000`.
  - **Traces:** api.prefixo / interface.datas / aplicacao.idioma / US-1.4

- [ ] **Task:** Criar a página `src/web/paginas/InicioPagina.tsx` (Dashboard, casca sem dados nesta fase) e as cascas das páginas de módulo `src/web/modulos/tarefas/TarefasPagina.tsx`, `src/web/modulos/categorias/CategoriasPagina.tsx` e `src/web/modulos/anotacoes/AnotacoesPagina.tsx`.
  - **Acceptance criteria:**
    - `InicioPagina.tsx` exporta a página como padrão e renderiza um `<h1>` com o título `Dashboard`. A página não chama `requisitar` nesta fase; a ligação aos dados do painel pertence à fase do painel-api, que a entrega depois.
    - Cada uma das três cascas exporta como padrão um componente que renderiza um `<h1>` com o título `Tarefas`, `Categorias` ou `Anotações`, e não chama `requisitar` nem renderiza lista de registros.
    - `InicioPagina.tsx` não contém números nem listas de exemplo usados como dados.
  - **Traces:** interface.dashboard / workflow 1 / US-1.1 / api.painel

- [ ] **Task:** Criar `src/web/navegacao.ts`, `src/web/App.tsx`, `src/web/main.tsx`, `src/web/layout/Sidebar.tsx` e `src/web/layout/Cabecalho.tsx`, com as quatro rotas, a sidebar e o cabeçalho responsivos.
  - **Acceptance criteria:**
    - `src/web/navegacao.ts` exporta `itensNavegacao: { caminho: string; rotulo: string; componente: ComponentType }[]`, nesta ordem: `{ caminho: '/', rotulo: 'Dashboard', componente: InicioPagina }`, `{ caminho: '/tarefas', rotulo: 'Tarefas', componente: TarefasPagina }`, `{ caminho: '/categorias', rotulo: 'Categorias', componente: CategoriasPagina }` e `{ caminho: '/anotacoes', rotulo: 'Anotações', componente: AnotacoesPagina }`.
    - `App.tsx` cria uma rota para cada item de `itensNavegacao`, com o `componente` desse item. `Sidebar.tsx` lê somente `itensNavegacao` e renderiza um link por item, com o rótulo do item. O link `Dashboard` leva a `/`.
    - `Cabecalho.tsx` tem um botão de texto `Abrir menu` que alterna a sidebar. Em `src/web/estilos/base.css`, com `@media (max-width: 768px)`, a sidebar fica recolhida por padrão e o botão `Abrir menu` aparece; em telas acima de 768px a sidebar fica sempre visível e o botão fica oculto. Ao escolher um link em telas de até 768px, a sidebar fecha.
    - `src/web/main.tsx` importa `tokens.css` e `base.css`, e renderiza em `#root` a árvore `BrowserRouter` > `FeedbackProvider` > `App`.
  - **Traces:** US-1.1 / US-1.5 / rotas-de-navegacao / interface.responsiva

## Phase 3: Módulo Tarefas

**Goal:** O usuário cadastra, consulta, edita, altera o status e exclui tarefas com confirmação, e os dados permanecem após reinicialização. · **Depends on:** Phase 1, Phase 2 · **Covers:** tarefas, US-2.1, US-2.2, US-2.3, US-2.4, US-2.5, workflow 2 · **Areas:** backend, frontend

- [ ] **Task:** Criar `src/servidor/modulos/tarefas/repositorio.ts`, que lê e grava somente a tabela `tarefas` do banco recebido. Exportar estas funções, todas com `banco: Database` (better-sqlite3) como primeiro argumento: `listarTarefas(banco)`, `buscarTarefa(banco, id: number)`, `inserirTarefa(banco, dados: { titulo: string; descricao: string | null; criadoEm: string })`, `atualizarTarefa(banco, id: number, dados: { titulo: string; descricao: string | null })`, `atualizarStatusTarefa(banco, id: number, status: string)` e `excluirTarefa(banco, id: number)`. Os valores entram nas consultas como parâmetros vinculados.
  - **Acceptance criteria:**
    - O arquivo exporta as seis funções com as assinaturas indicadas.
    - `listarTarefas` usa `ORDER BY criadoEm DESC, id DESC` e devolve cada registro com as chaves `id`, `titulo`, `descricao`, `status` e `criadoEm`.
    - `buscarTarefa` devolve `undefined` quando nenhuma linha tem o `id` informado.
    - As consultas do arquivo referenciam somente a tabela `tarefas`, e nenhum valor recebido é concatenado ao texto SQL.
  - **Traces:** US-2.2, tarefas

- [ ] **Task:** Criar `src/servidor/modulos/tarefas/servico.ts` com o tipo `Tarefa = { id: number; titulo: string; descricao: string | null; status: 'pendente' | 'em andamento' | 'concluída'; criadoEm: string }`, e as funções `listarTarefas(banco: Database): Tarefa[]` e `criarTarefa(banco: Database, entrada: unknown): Tarefa`.
  - **Acceptance criteria:**
    - `criarTarefa` valida `titulo` com `lerTexto(entrada.titulo, { campo: 'titulo', obrigatorio: true, limite: 255 })` e `descricao` com `lerTexto(entrada.descricao, { campo: 'descricao', obrigatorio: false, limite: 5000 })`. Uma rejeição lança `ErroAplicacao(400, mensagem)` com a mensagem em português do Brasil.
    - `criarTarefa` grava `status` como `'pendente'` e `criadoEm` com `agoraIso()`. Os campos `id`, `status` e `criadoEm` enviados pelo cliente são ignorados.
    - `criarTarefa` devolve o registro lido da tabela `tarefas` depois do INSERT, e `listarTarefas` devolve o resultado de `repositorio.listarTarefas`.
  - **Traces:** US-2.1, US-2.2, tarefas.titulo, tarefas.descricao, tarefas.status, tarefas.criadoEm

- [ ] **Task:** Acrescentar em `src/servidor/modulos/tarefas/servico.ts` as funções `editarTarefa(banco: Database, id: number, entrada: unknown): Tarefa`, `alterarStatusTarefa(banco: Database, id: number, entrada: unknown): Tarefa` e `excluirTarefa(banco: Database, id: number): void`.
  - **Acceptance criteria:**
    - `editarTarefa` valida `titulo` e `descricao` da mesma forma que `criarTarefa`, grava somente `titulo` e `descricao`, mantém `criadoEm` e `status` e devolve o registro lido da tabela.
    - `alterarStatusTarefa` lê `entrada.status`; aceita somente `'pendente'`, `'em andamento'` e `'concluída'`, em qualquer ordem, e qualquer outro valor lança `ErroAplicacao(400, mensagem)` com mensagem em português do Brasil. A função altera somente a coluna `status`.
    - `editarTarefa`, `alterarStatusTarefa` e `excluirTarefa` lançam `ErroAplicacao(404, mensagem)` quando `buscarTarefa` devolve `undefined`. `excluirTarefa` remove o registro somente pela função `repositorio.excluirTarefa`, sem recuperação posterior.
  - **Traces:** US-2.3, US-2.4, US-2.5, tarefas.titulo, tarefas.status

- [ ] **Task:** Criar `src/servidor/modulos/tarefas/rotas.ts` com `criarRotas(banco: Database): Router` e registrar o módulo em `src/servidor/modulos.ts`, acrescentando à lista de `criarModulosApi(banco)` a entrada `{ caminho: '/tarefas', router: criarRotas(banco) }`, sem outra alteração nesse arquivo.
  - **Acceptance criteria:**
    - O router expõe exatamente: `GET /` responde 200 com a lista de `listarTarefas`; `POST /` responde 201 com a tarefa criada; `PUT /:id` responde 200 com a tarefa editada; `PATCH /:id/status` responde 200 com a tarefa com o status alterado; `DELETE /:id` responde 204 sem corpo. Montado em `/api/tarefas`, cada rota corresponde ao endpoint literal de mesmo método e caminho.
    - O arquivo não contém SQL nem regra de validação: delega a `servico.ts`, e os erros `ErroAplicacao` seguem para o middleware de erro de `api-base`, que responde `{ erro }`.
    - O módulo tem testes automatizados que chamam estas rotas pela aplicação real, contra um banco descartável criado e destruído pela própria execução, sem abrir o banco configurado em `CAMINHO_BANCO` no `.env`.
  - **Traces:** US-2.1, US-2.2, US-2.3, US-2.4, US-2.5, api.tarefas, api.formato, workflow 2

- [ ] **Task:** Criar `src/web/modulos/tarefas/api.ts`, que exporta o tipo `Tarefa` com os mesmos campos e tipos do servidor e as funções `listarTarefas()`, `criarTarefa(dados: { titulo: string; descricao?: string })`, `editarTarefa(id: number, dados: { titulo: string; descricao?: string })`, `alterarStatusTarefa(id: number, status: 'pendente' | 'em andamento' | 'concluída')` e `excluirTarefa(id: number)`. Todas usam `requisitar` de `src/web/api/cliente.ts`, com caminhos relativos à base `/api`.
  - **Acceptance criteria:**
    - As chamadas são exatamente: `requisitar<Tarefa[]>('GET', '/tarefas')`; `requisitar<Tarefa>('POST', '/tarefas', dados)`; `requisitar<Tarefa>('PUT', \`/tarefas/${id}\`, dados)`; `requisitar<Tarefa>('PATCH', \`/tarefas/${id}/status\`, { status })`; `requisitar<void>('DELETE', \`/tarefas/${id}\`)`, o que resulta em GET, POST, PUT, PATCH e DELETE sob `/api/tarefas`.
    - O arquivo não chama `fetch` diretamente e não contém dados fixos no lugar das respostas da API.
    - O tipo `Tarefa` declara `id: number`, `titulo: string`, `descricao: string | null`, `status: 'pendente' | 'em andamento' | 'concluída'` e `criadoEm: string`.
  - **Traces:** US-2.2, api.tarefas, workflow 2

- [ ] **Task:** Criar `src/web/modulos/tarefas/componentes/FormularioTarefa.tsx`, que cadastra uma tarefa quando não recebe a prop `tarefa` e edita a tarefa recebida quando a recebe. Usar `Campo`, `Botao` e `useFeedback` de `design-system`. Props: `{ tarefa?: Tarefa; aoSalvar: () => void; aoCancelar: () => void }`.
  - **Acceptance criteria:**
    - O formulário tem o campo "Título" (input de texto) e o campo "Descrição" (textarea), ambos dentro de `Campo` com o `rotulo` correspondente, e os botões "Cancelar" e "Salvar" (`Botao` com variante `secundaria` e `primaria`).
    - Antes de qualquer chamada, o título sem espaços das extremidades vazio mostra, junto ao campo, o erro "O título é obrigatório."; título com mais de 255 caracteres após remover esses espaços mostra erro com o limite de 255; descrição com mais de 5000 caracteres mostra erro com o limite de 5000. Nenhuma requisição é feita enquanto houver erro.
    - Com os campos válidos, o envio chama `criarTarefa` quando não há `tarefa` e `editarTarefa(tarefa.id, dados)` quando há, depois chama `useFeedback().sucesso` e `aoSalvar`. Em `ErroApi`, chama `useFeedback().erro` com a mensagem recebida.
  - **Traces:** US-2.1, US-2.3, tarefas.titulo, tarefas.descricao, interface.validacao, interface.feedback

- [ ] **Task:** Criar `src/web/modulos/tarefas/componentes/ListaTarefas.tsx`, que mostra as tarefas recebidas em `tarefas: Tarefa[]` e recebe `aoEditar(tarefa: Tarefa)` e `aoAlterado()`. Usar `Dialogo`, `Botao`, `useFeedback` e `formatarDataHora` de `web-shell`.
  - **Acceptance criteria:**
    - Cada linha mostra `id`, `titulo`, `descricao` (quando `descricao` é `null`, mostra um texto em português indicando ausência de descrição; quando há texto, mostra-o preservando as quebras de linha gravadas, sem convertê-lo em HTML), `status` e `criadoEm` formatado por `formatarDataHora`. As linhas seguem a ordem do array recebido, sem reordenação no cliente.
    - Cada linha tem um seletor de status com exatamente três opções, de valores `pendente`, `em andamento` e `concluída`. Ao trocar o valor, chama `alterarStatusTarefa(id, novoStatus)`, mostra `useFeedback().sucesso` ou `useFeedback().erro` e chama `aoAlterado`.
    - Cada linha tem o botão "Editar" que chama `aoEditar(tarefa)` com a tarefa da linha; o formulário de edição abre preenchido com o título e a descrição atuais.
    - O botão "Excluir" abre `Dialogo` com título e mensagem em português. Somente `aoConfirmar` chama `excluirTarefa(id)` e depois `aoAlterado`; após a confirmação, a tela mostra `useFeedback().sucesso` quando `excluirTarefa` conclui e `useFeedback().erro` com a mensagem recebida quando falha; `aoCancelar` fecha o diálogo sem chamar a API.
  - **Traces:** US-2.2, US-2.3, US-2.4, US-2.5, exclusao.confirmacao, interface.feedback, workflow 2

- [ ] **Task:** Criar `src/web/modulos/tarefas/TarefasPagina.tsx` como exportação padrão e acrescentar em `src/web/navegacao.ts` a entrada `{ caminho: '/tarefas', rotulo: 'Tarefas', componente: TarefasPagina }` em `itensNavegacao`, sem alterar as demais entradas.
  - **Acceptance criteria:**
    - Ao abrir a página, enquanto `listarTarefas` não responde, ela mostra `EstadoCarregamento` com o rótulo "Carregando tarefas...". Com a lista vazia, mostra `EstadoVazio` com a mensagem "Nenhuma tarefa cadastrada." e o `rotuloAcao` "Cadastrar a primeira tarefa", que abre `FormularioTarefa`. Com tarefas, mostra o botão "Nova tarefa" e `ListaTarefas`.
    - Depois de cadastrar, editar, alterar o status ou excluir, a página chama `listarTarefas` de novo e exibe a lista devolvida pela API; ela não mantém uma cópia local das tarefas.
    - `navegacao.ts` contém a entrada com `caminho` igual a `'/tarefas'`, `rotulo` igual a `'Tarefas'` e `componente` igual a `TarefasPagina`.
  - **Traces:** US-2.2, workflow 2, rotas-de-navegacao, interface.carregamento-e-vazio, interface.dashboard

## Phase 4: Módulo Categorias

**Goal:** O usuário cadastra, consulta, edita e exclui categorias com confirmação, com nome único e cor obrigatória, e os dados permanecem após reinicialização. · **Depends on:** Phase 1, Phase 2 · **Covers:** categorias, US-3.1, US-3.2, US-3.3, US-3.4, workflow 3 · **Areas:** backend, frontend

- [ ] **Task:** Criar o repositório da tabela `categorias` em `src/servidor/modulos/categorias/repositorio.ts`. Exportar o tipo `Categoria = { id: number; nome: string; cor: string; criadoEm: string }` e as funções `listarCategorias(banco)`, `buscarCategoria(banco, id: number)`, `inserirCategoria(banco, dados: { nome: string; cor: string; criadoEm: string })`, `alterarCategoria(banco, id: number, dados: { nome: string; cor: string })` e `removerCategoria(banco, id: number)`. Todas recebem o `Database` do better-sqlite3 como primeiro parâmetro. Somente a tabela `categorias` é lida e gravada neste arquivo.
  - **Acceptance criteria:**
    - `listarCategorias` consulta `categorias` com `ORDER BY criadoEm DESC, id DESC`.
    - Cada função mapeia as colunas `id`, `nome`, `cor` e `criadoEm` para os campos de `Categoria`, com `id` como número.
    - `inserirCategoria` devolve o registro gravado, e `buscarCategoria` devolve `undefined` quando o id não existe.
    - `removerCategoria` devolve `false` quando nenhuma linha foi removida.
  - **Traces:** US-3.1; US-3.2; US-3.4; categorias; workflow 3

- [ ] **Task:** Criar o serviço de categorias em `src/servidor/modulos/categorias/servico.ts`, usando as funções do repositório. Exportar `listarCategorias(banco)`, `criarCategoria(banco, entrada)`, `atualizarCategoria(banco, id: number, entrada)` e `excluirCategoria(banco, id: number)`, em que `entrada` é `{ nome: unknown; cor: unknown }`. Validar `nome` com `lerTexto(entrada.nome, { campo: 'nome', obrigatorio: true, limite: 255 })` e `cor` com `lerTexto(entrada.cor, { campo: 'cor', obrigatorio: true, limite: 255 })`. Erros são lançados como `ErroAplicacao`, de `src/servidor/comum/erros.ts`. Ao cadastrar, `criadoEm` recebe o valor de `agoraIso()`. `criarCategoria` e `atualizarCategoria` devolvem o `Categoria` gravado.
  - **Acceptance criteria:**
    - Nome e cor são gravados sem os espaços das extremidades, mantendo maiúsculas, minúsculas e espaços internos do valor recebido.
    - Cadastro e edição verificam a unicidade dentro de `banco.transaction`. Comparam `nome.trim().toLocaleLowerCase('pt-BR')` com o mesmo valor de cada outra categoria, ignorando a categoria de id igual ao editado. Havendo coincidência, lançam `ErroAplicacao(409, mensagem)` com mensagem em português.
    - Edição e exclusão de um id inexistente lançam `ErroAplicacao(404, mensagem)` com mensagem em português.
    - `atualizarCategoria` não grava nenhum valor em `criadoEm`, e `criarCategoria` grava `criadoEm` somente com `agoraIso()`.
  - **Traces:** US-3.1; US-3.3; US-3.4; categorias.nome; categorias.nome-unico; categorias.cor; categorias.criadoEm

- [ ] **Task:** Criar `src/servidor/modulos/categorias/rotas.ts`, exportando `criarRotas(banco: Database): Router`, com as rotas `GET /` e `POST /`, que, montadas em `/api/categorias`, formam os endpoints abaixo. As rotas só chamam o serviço da tarefa anterior e repassam os erros ao middleware de erro.
  - **Acceptance criteria:**
    - `GET /api/categorias` responde 200 com o array de `Categoria` na ordem devolvida por `listarCategorias`.
    - `POST /api/categorias` com corpo `{ nome, cor }` responde 201 com o `Categoria` criado. Entrada inválida responde 400, e nome repetido responde 409, ambos com corpo `{ erro: mensagem }`.
  - **Traces:** US-3.1; US-3.2; api.categorias; api.formato; workflow 3

- [ ] **Task:** Acrescentar ao router `criarRotas` as rotas `PUT /:id` e `DELETE /:id`, que, montadas em `/api/categorias`, formam os endpoints de alteração e exclusão abaixo. As rotas só chamam o serviço da tarefa anterior e repassam os erros ao middleware de erro.
  - **Acceptance criteria:**
    - `PUT /api/categorias/:id` com corpo `{ nome, cor }` responde 200 com o `Categoria` alterado. Id inexistente responde 404 com corpo `{ erro: mensagem }`.
    - `DELETE /api/categorias/:id` responde 204 sem corpo quando remove a categoria, e 404 com corpo `{ erro: mensagem }` quando o id não existe.
  - **Traces:** US-3.3; US-3.4; api.categorias; api.formato; workflow 3

- [ ] **Task:** Registrar o router `criarRotas(banco)` em `src/servidor/modulos.ts` como um item `{ caminho: '/categorias', router: criarRotas(banco) }` da lista devolvida por `criarModulosApi`. Nas rotas com `:id`, um valor que não seja inteiro positivo responde 404 sem consultar o banco.
  - **Acceptance criteria:**
    - Um `:id` que não seja inteiro positivo responde 404 sem consultar o banco.
    - `src/servidor/modulos.ts` contém exatamente um item com `caminho: '/categorias'`.
  - **Traces:** US-3.1; US-3.2; US-3.3; US-3.4; api.categorias; api.formato

- [ ] **Task:** Criar `src/web/modulos/categorias/api.ts`, com o tipo `Categoria` (`id: number`, `nome: string`, `cor: string`, `criadoEm: string`), o tipo `EntradaCategoria` (`nome: string`, `cor: string`) e as funções `listarCategorias(): Promise<Categoria[]>`, `criarCategoria(entrada: EntradaCategoria): Promise<Categoria>`, `atualizarCategoria(id: number, entrada: EntradaCategoria): Promise<Categoria>` e `excluirCategoria(id: number): Promise<void>`. Todas chamam `requisitar` de `src/web/api/cliente.ts`.
  - **Acceptance criteria:**
    - `listarCategorias` chama `requisitar('GET', '/categorias')`; `criarCategoria` chama `requisitar('POST', '/categorias', entrada)`; `atualizarCategoria` chama `requisitar('PUT', \`/categorias/${id}\`, entrada)`; `excluirCategoria` chama `requisitar('DELETE', \`/categorias/${id}\`)`.
    - O arquivo não usa `fetch` e não escreve o prefixo `/api` nos caminhos, pois a base `/api` é aplicada por `requisitar`.
    - O arquivo não importa código de `src/web/modulos/tarefas` nem de `src/web/modulos/anotacoes`.
  - **Traces:** US-3.1; US-3.2; US-3.3; US-3.4; workflow 3

- [ ] **Task:** Criar `src/web/modulos/categorias/componentes/FormularioCategoria.tsx`, exportando `FormularioCategoria({ valorInicial?: { nome: string; cor: string }; enviando: boolean; erroNome?: string; aoSalvar(entrada: EntradaCategoria): void; aoCancelar(): void })`. O formulário tem o campo Nome e o campo Cor, este com um `<input type="color">` e o texto "Nenhuma cor escolhida" ao lado enquanto nenhuma cor estiver escolhida. Usa `Campo` de `src/web/componentes/Campo.tsx` e `Botao` de `src/web/componentes/Botao.tsx`. O botão de envio tem o rótulo "Cadastrar categoria" sem `valorInicial` e "Salvar alterações" com `valorInicial`. O botão Cancelar aparece somente quando `valorInicial` é informado.
  - **Acceptance criteria:**
    - Sem `valorInicial`, o estado da cor começa vazio e só recebe valor no evento de alteração do seletor. O valor visual inicial do seletor não é usado como cor.
    - Com nome vazio depois de remover os espaços das extremidades, o formulário não chama `aoSalvar` e mostra "Informe o nome da categoria." junto ao campo Nome. Com mais de 255 caracteres nessa condição, mostra "O nome pode ter no máximo 255 caracteres.". Com cor vazia, não chama `aoSalvar` e mostra "Escolha uma cor para a categoria." junto ao campo Cor.
    - Havendo nome e cor válidos, chama `aoSalvar({ nome, cor })`. Quando `erroNome` é informado, ele aparece como erro do campo Nome.
    - Com `enviando` verdadeiro, o botão de envio está desabilitado.
  - **Traces:** US-3.1; US-3.3; categorias.cor; interface.validacao

- [ ] **Task:** Criar `src/web/modulos/categorias/CategoriasPagina.tsx`, com exportação padrão, e registrar a página em `src/web/navegacao.ts` como item `{ caminho: '/categorias', rotulo: 'Categorias', componente: CategoriasPagina }` de `itensNavegacao`. A página tem o título "Categorias" e carrega `listarCategorias()` ao ser montada. Enquanto carrega, mostra `EstadoCarregamento` com o rótulo "Carregando categorias…". Sem registros, mostra `EstadoVazio` com a mensagem "Nenhuma categoria cadastrada." e o rótulo de ação "Cadastrar primeira categoria". Com registros, lista cada categoria com id, nome, cor (amostra colorida e texto da cor) e criadoEm formatado por `formatarDataHora` de `src/web/comum/datas.ts`. Em cada item há o botão "Excluir", que abre o diálogo de confirmação, e a exclusão só é feita quando o usuário confirma.
  - **Acceptance criteria:**
    - `itensNavegacao` contém exatamente um item com `caminho: '/categorias'` e `componente: CategoriasPagina`.
    - A lista é exibida na ordem recebida da API, sem reordenação no cliente, e cada item mostra id, nome, cor e criadoEm.
    - O botão "Excluir" abre `Dialogo` com título "Excluir categoria" e a mensagem `A categoria "<nome>" será excluída definitivamente. Deseja continuar?`. Cancelar fecha o diálogo sem chamar `excluirCategoria`.
    - Confirmar chama `excluirCategoria(id)`, fecha o diálogo, recarrega a lista e mostra sucesso com "Categoria excluída.". Em caso de erro da API, mostra erro com a mensagem recebida e fecha o diálogo.
  - **Traces:** US-3.2; US-3.4; workflow 3; exclusao.confirmacao; interface.feedback; interface.carregamento-e-vazio; listas.ordenacao; interface.datas

- [ ] **Task:** Acrescentar à página `src/web/modulos/categorias/CategoriasPagina.tsx` o cadastro e a edição de categorias, usando `FormularioCategoria` da tarefa anterior. O botão "Nova categoria" e o rótulo de ação do estado vazio abrem o formulário sem valores. O botão "Editar" de cada item abre o formulário preenchido com o nome e a cor da categoria. Sucesso e erro são mostrados pelo `useFeedback` do `FeedbackProvider`.
  - **Acceptance criteria:**
    - Enviar o formulário sem categoria em edição chama `criarCategoria({ nome, cor })`. Em sucesso, mostra "Categoria cadastrada.", fecha o formulário e recarrega a lista.
    - Quando a API responde 409, a mensagem recebida aparece como `erroNome` do formulário e também é mostrada por `erro(mensagem)` do `useFeedback`. Quando a API responde 400 ou 404, a mensagem recebida é mostrada por `erro(mensagem)`.
    - Enviar o formulário com categoria em edição chama `atualizarCategoria(id, { nome, cor })`. Em sucesso, mostra "Categoria atualizada.", fecha o formulário e recarrega a lista, que passa a exibir os novos valores de nome e cor.
  - **Traces:** US-3.1; US-3.3; workflow 3; interface.feedback; categorias.nome-unico; categorias.cor

## Phase 5: Módulo Anotações

**Goal:** O usuário cadastra, consulta, edita e exclui anotações com confirmação, com as datas de criação e atualização mantidas conforme as regras, e os dados permanecem após reinicialização. · **Depends on:** Phase 1, Phase 2 · **Covers:** anotacoes, US-4.1, US-4.2, US-4.3, US-4.4, workflow 4 · **Areas:** backend, frontend

- [ ] **Task:** Criar `src/servidor/modulos/anotacoes/repositorio.ts`, que lê e grava somente a tabela `anotacoes`. Exportar as funções `listar(banco: Database)`, `buscarPorId(banco: Database, id: number)`, `inserir(banco: Database, titulo: string, conteudo: string, criadoEm: string, atualizadoEm: string)`, `atualizar(banco: Database, id: number, titulo: string, conteudo: string, atualizadoEm: string)` e `excluir(banco: Database, id: number)`. Os valores entram nas consultas como parâmetros preparados, nunca por concatenação.
  - **Acceptance criteria:**
    - O arquivo exporta as cinco funções, e cada uma recebe o `Database` como primeiro parâmetro; `inserir` e `atualizar` gravam `conteudo` exatamente como recebido, com as quebras de linha.
    - `listar` executa a consulta `SELECT id, titulo, conteudo, criadoEm, atualizadoEm FROM anotacoes ORDER BY criadoEm DESC, id DESC`.
    - `atualizar` altera apenas as colunas `titulo`, `conteudo` e `atualizadoEm`; nenhuma consulta do arquivo grava `criadoEm` em um registro já existente.
    - `atualizar` e `excluir` devolvem o número de linhas alteradas (`changes`), e `buscarPorId` devolve o registro ou `undefined`.
  - **Traces:** US-4.1, US-4.2, US-4.3, US-4.4 / entidade anotacoes / workflow 4

- [ ] **Task:** Criar `src/servidor/modulos/anotacoes/servico.ts` com as regras do módulo, usando o repositório da tarefa anterior, `lerTexto` e `agoraIso` de `src/servidor/comum/texto.ts` e `src/servidor/comum/datas.ts`, e `ErroAplicacao` de `src/servidor/comum/erros.ts`. Exportar `listarAnotacoes(banco: Database)`, `criarAnotacao(banco: Database, entrada: { titulo: unknown; conteudo: unknown })`, `atualizarAnotacao(banco: Database, id: number, entrada: { titulo: unknown; conteudo: unknown })` e `excluirAnotacao(banco: Database, id: number)`.
  - **Acceptance criteria:**
    - `titulo` é validado com `lerTexto(entrada.titulo, { campo: 'Título', obrigatorio: true, limite: 255 })` e `conteudo` com `lerTexto(entrada.conteudo, { campo: 'Conteúdo', obrigatorio: true, limite: 5000 })`, ambos antes de qualquer gravação; no conteúdo, somente as extremidades são aparadas e as quebras de linha internas são preservadas.
    - `criarAnotacao` obtém um único valor com `agoraIso()` e grava-o em `criadoEm` e em `atualizadoEm`, e devolve o registro gravado.
    - `atualizarAnotacao` lança `ErroAplicacao(404, 'Anotação não encontrada.')` quando `buscarPorId` não encontra o id, antes de validar a entrada; quando encontra, valida a entrada e grava `atualizadoEm` com um novo `agoraIso()`, sem alterar `criadoEm`.
    - `excluirAnotacao` lança `ErroAplicacao(404, 'Anotação não encontrada.')` quando o repositório informa zero linhas alteradas.
  - **Traces:** US-4.1, US-4.3, US-4.4 / entidade anotacoes (criadoEm, atualizadoEm) / workflow 4

- [ ] **Task:** Criar `src/servidor/modulos/anotacoes/rotas.ts`, exportando `criarRotas(banco: Database): Router`. As rotas, relativas ao ponto de montagem `/api/anotacoes`, são `GET /`, `POST /`, `PUT /:id` e `DELETE /:id`, cada uma chamando o serviço da tarefa anterior. Erros são repassados com `next(erro)` para o middleware de erro da fundação. Um `:id` que não seja inteiro positivo em notação decimal responde 404 com a mesma mensagem de anotação não encontrada.
  - **Acceptance criteria:**
    - `GET /api/anotacoes` responde 200 com um array JSON cujos objetos têm as chaves `id`, `titulo`, `conteudo`, `criadoEm` e `atualizadoEm`, e uma anotação cadastrada continua listada, com os mesmos valores de título, conteúdo, criadoEm e atualizadoEm, depois de a aplicação ser reiniciada.
    - `POST /api/anotacoes` com corpo `{ titulo, conteudo }` válido responde 201 com o registro criado, em que `criadoEm` é igual a `atualizadoEm`.
    - `PUT /api/anotacoes/:id` responde 200 com o registro atualizado, e `DELETE /api/anotacoes/:id` responde 204 sem corpo; ambos respondem 404 com `{ erro }` quando o id não existe.
    - Uma entrada com `titulo` ou `conteudo` vazio após remover espaços das extremidades, ou acima do limite, responde 400 com `{ erro }` em português.
  - **Traces:** US-4.1, US-4.2, US-4.3, US-4.4 / API /api/anotacoes / workflow 4

- [ ] **Task:** Registrar o módulo em `src/servidor/modulos.ts`. A lista devolvida por `criarModulosApi(banco: Database)` inclui o item `{ caminho: '/anotacoes', router: criarRotas(banco) }`, com `criarRotas` importado de `src/servidor/modulos/anotacoes/rotas.ts`. Se o item já estiver na lista, nenhuma alteração é feita.
  - **Acceptance criteria:**
    - O arquivo `src/servidor/modulos.ts` importa `criarRotas` de `src/servidor/modulos/anotacoes/rotas.ts`.
    - A lista de `criarModulosApi` contém um item com `caminho` igual a `'/anotacoes'` e `router` igual a `criarRotas(banco)`.
    - O módulo Anotações tem comportamento verificável por testes automatizados que exercitam as funcionalidades reais contra um banco descartável criado pela própria execução, sem ler nem alterar o banco configurado no `.env`.
  - **Traces:** API /api/anotacoes / workflow 4

- [ ] **Task:** Criar `src/web/modulos/anotacoes/api.ts`, exportando o tipo `Anotacao = { id: number; titulo: string; conteudo: string; criadoEm: string; atualizadoEm: string }` e as funções `listarAnotacoes(): Promise<Anotacao[]>`, `criarAnotacao(dados: { titulo: string; conteudo: string }): Promise<Anotacao>`, `atualizarAnotacao(id: number, dados: { titulo: string; conteudo: string }): Promise<Anotacao>` e `excluirAnotacao(id: number): Promise<void>`. Cada função chama a API somente por `requisitar` de `src/web/api/cliente.ts`, com caminhos relativos à base `/api`.
  - **Acceptance criteria:**
    - `listarAnotacoes` chama `requisitar('GET', '/anotacoes')`; `criarAnotacao` chama `requisitar('POST', '/anotacoes', dados)`.
    - `atualizarAnotacao` chama `requisitar('PUT', `/anotacoes/${id}`, dados)`; `excluirAnotacao` chama `requisitar('DELETE', `/anotacoes/${id}`)`.
    - O arquivo não contém nenhuma chamada a `fetch` ou `XMLHttpRequest`, e o caminho `/api` não aparece literalmente no arquivo.
  - **Traces:** US-4.1, US-4.2, US-4.3, US-4.4 / API /api/anotacoes / workflow 4

- [ ] **Task:** Criar em `src/web/modulos/anotacoes/componentes/` os componentes `FormularioAnotacao.tsx` e `ListaAnotacoes.tsx`, usando `Campo`, `Botao` e `EstadoVazio` de `src/web/componentes/`. `FormularioAnotacao` recebe `inicial?: { titulo: string; conteudo: string }`, `aoSalvar(dados: { titulo: string; conteudo: string })` e `aoCancelar()`, com os rótulos `Título` e `Conteúdo`. `ListaAnotacoes` recebe `anotacoes: Anotacao[]`, `aoEditar(anotacao: Anotacao)` e `aoExcluir(anotacao: Anotacao)`, e formata as datas com `formatarDataHora` de `src/web/comum/datas.ts`.
  - **Acceptance criteria:**
    - Antes de chamar `aoSalvar`, o formulário remove os espaços das extremidades de título e conteúdo, e o campo Conteúdo é uma área de várias linhas cujas quebras de linha internas são enviadas sem alteração; se um deles ficar vazio, mostra no campo a mensagem `Informe o título.` ou `Informe o conteúdo.`, e se o título passar de 255 caracteres ou o conteúdo de 5000, mostra `O título deve ter no máximo 255 caracteres.` ou `O conteúdo deve ter no máximo 5000 caracteres.`.
    - `ListaAnotacoes` exibe para cada anotação os campos `id`, `titulo`, `conteudo`, `criadoEm` e `atualizadoEm`, estes dois últimos passados por `formatarDataHora`, e o conteúdo aparece com as quebras de linha como quebras na lista.
    - Quando `anotacoes` está vazio, `ListaAnotacoes` renderiza `EstadoVazio` com `rotuloAcao` igual a `Cadastrar a primeira anotação`.
    - Cada anotação exibida tem as ações de editar e de excluir, que chamam `aoEditar` e `aoExcluir` com a anotação correspondente.
  - **Traces:** US-4.1, US-4.2, US-4.3, US-4.4 / entidade anotacoes / workflow 4

- [ ] **Task:** Criar `src/web/modulos/anotacoes/AnotacoesPagina.tsx` como página padrão exportada, e registrá-la em `src/web/navegacao.ts`: a entrada de `caminho` `'/anotacoes'` em `itensNavegacao` tem `rotulo` `'Anotações'` e `componente` igual a `AnotacoesPagina`; se a entrada não existir, é acrescentada. A página usa `listarAnotacoes` ao montar, `FormularioAnotacao` para cadastro e edição, `ListaAnotacoes` para a lista, e `Dialogo` de `src/web/componentes/Dialogo.tsx` para a exclusão. Mensagens de sucesso e erro vêm de `useFeedback()`.
  - **Acceptance criteria:**
    - Enquanto a listagem não termina, a página renderiza `EstadoCarregamento` com `rotulo` igual a `Carregando anotações...`.
    - Ao acionar excluir, a página abre `Dialogo` com `titulo` `Excluir anotação` e `mensagem` `A exclusão é definitiva. Deseja excluir esta anotação?`; `excluirAnotacao(id)` é chamada somente dentro de `aoConfirmar`, e `aoCancelar` não chama a API.
    - Após cadastrar, editar ou excluir com sucesso, a página chama `listarAnotacoes` de novo e chama `sucesso` com `Anotação cadastrada.`, `Anotação atualizada.` ou `Anotação excluída.`; em caso de falha, chama `erro` com a mensagem de `ErroApi`.
    - Em `src/web/navegacao.ts`, a entrada de `caminho` `'/anotacoes'` tem `componente` igual a `AnotacoesPagina`.
  - **Traces:** US-4.1, US-4.2, US-4.3, US-4.4 / workflow 4

## Phase 6: Dashboard com dados reais

**Goal:** O Dashboard mostra a contagem de registros de cada módulo e a distribuição das tarefas por status, a partir dos dados persistidos, com zeros quando não há registros. · **Depends on:** Phase 1, Phase 2 · **Covers:** US-1.2 · **Areas:** backend, frontend

- [ ] **Task:** Criar o serviço de contagens do painel em `src/servidor/modulos/painel/servico.ts`, exportando `lerPainel(banco: Database)`, que devolve `{ tarefas: number, categorias: number, anotacoes: number, tarefasPorStatus: { pendente: number, 'em andamento': number, 'concluída': number } }`. A função lê o banco recebido como parâmetro com consultas agregadas (COUNT) sobre as tabelas `tarefas`, `categorias` e `anotacoes`. Para `tarefasPorStatus`, conta as tarefas pela coluna `status`. Os três status aparecem sempre na resposta, com 0 quando não há tarefas naquele status.
  - **Acceptance criteria:**
    - `lerPainel` conta as linhas de `tarefas`, `categorias` e `anotacoes` com consultas agregadas executadas sobre o banco recebido; sem registros, os três contadores valem 0.
    - `tarefasPorStatus` tem exatamente as chaves `pendente`, `em andamento` e `concluída`, cada uma com a quantidade de tarefas cujo `status` é esse valor, e vale 0 quando não há tarefas com ele.
    - `servico.ts` não importa nenhum arquivo das pastas `src/servidor/modulos/tarefas`, `src/servidor/modulos/categorias` ou `src/servidor/modulos/anotacoes`.
  - **Traces:** US-1.2 / painel / workflow 1

- [ ] **Task:** Criar as rotas do painel em `src/servidor/modulos/painel/rotas.ts`, exportando `criarRotas(banco: Database): Router`. O router registra apenas `GET /`, que responde o resultado de `lerPainel(banco)`. Em seguida, registrar o módulo em `src/servidor/modulos.ts`, adicionando `{ caminho: '/painel', router: criarRotas(banco) }` à lista devolvida por `criarModulosApi`, para que a rota final seja `/api/painel`.
  - **Acceptance criteria:**
    - `GET /api/painel` responde 200 com JSON na forma `{ tarefas: number, categorias: number, anotacoes: number, tarefasPorStatus: { pendente: number, 'em andamento': number, 'concluída': number } }`.
    - O router de `rotas.ts` declara somente `GET /`; nenhum método POST, PUT, PATCH ou DELETE é declarado nesse arquivo.
    - `src/servidor/modulos.ts` contém exatamente uma entrada com `caminho: '/painel'` na lista devolvida por `criarModulosApi`.
  - **Traces:** US-1.2 / painel / api.painel / workflow 1

- [ ] **Task:** Criar a página `src/web/paginas/InicioPagina.tsx`, com exportação padrão, que representa o Dashboard. Ao ser montada, a página chama `requisitar<PainelResposta>('GET', '/painel')`, que resolve para `GET /api/painel`. Enquanto a resposta não chega, mostra `EstadoCarregamento` de `src/web/componentes/Estados.tsx` com o rótulo "Carregando o painel...". Quando a resposta chega, mostra o cabeçalho "Dashboard", três cartões de contagem com os rótulos "Tarefas", "Categorias" e "Anotações" e os valores de `tarefas`, `categorias` e `anotacoes`, e a seção "Tarefas por status" com os itens "Pendente", "Em andamento" e "Concluída" e os valores de `tarefasPorStatus`. O tipo `PainelResposta` é declarado no próprio arquivo, com a forma da resposta da API.
  - **Acceptance criteria:**
    - Enquanto a requisição está pendente, a página renderiza `EstadoCarregamento` com o rótulo "Carregando o painel..." e nenhum cartão de contagem.
    - Os valores dos cartões e dos itens de status vêm somente da resposta de `requisitar`; o arquivo não contém números nem listas de exemplo usados como dados.
    - A página faz somente a chamada `GET /painel` via `requisitar`, e cada montagem da página faz uma nova chamada, sem cache entre montagens.
  - **Traces:** US-1.2 / Dashboard / interface.dashboard / workflow 1

- [ ] **Task:** Tratar a falha da requisição em `src/web/paginas/InicioPagina.tsx` e registrar a página em `src/web/navegacao.ts`. Quando `requisitar` lança erro, a página não mostra cartões nem seção de status e exibe o texto "Não foi possível carregar o painel.". Em `src/web/navegacao.ts`, importar `InicioPagina` de `./paginas/InicioPagina` e acrescentar à lista `itensNavegacao` o item `{ caminho: '/', rotulo: 'Dashboard', componente: InicioPagina }`, sem remover os itens já presentes.
  - **Acceptance criteria:**
    - Quando a requisição falha, a página exibe o texto "Não foi possível carregar o painel." e nenhum valor numérico de contagem.
    - `src/web/navegacao.ts` contém exatamente um item com `caminho: '/'`, `rotulo: 'Dashboard'` e `componente: InicioPagina`.
    - Os itens de navegação que já estavam em `itensNavegacao` continuam na lista, na mesma ordem relativa.
  - **Traces:** US-1.2 / Dashboard / rotas-de-navegacao / workflow 1

## Phase 7: Integração da aplicação completa

**Goal:** Os três módulos, o Dashboard e a navegação funcionam como uma aplicação única: os fluxos de navegação e de persistência rodam no navegador contra a API real, com a aplicação iniciada a partir do .env.example em uma máquina sem servidor de banco, e a aplicação compila e inicia pelas instruções documentadas. · **Depends on:** Phase 3, Phase 4, Phase 5, Phase 6 · **Covers:** workflow 1, workflow 5 · **Areas:** frontend, geral, infra

- [ ] **Task:** Ajustar a navegação lateral e a responsividade da interface em `src/web/navegacao.ts`, `src/web/layout/Sidebar.tsx`, `src/web/layout/Cabecalho.tsx` e `src/web/App.tsx`. A lista `itensNavegacao` é a única fonte dos links da sidebar e das rotas do roteador, com os rótulos Dashboard, Tarefas, Categorias e Anotações e os caminhos /, /tarefas, /categorias e /anotacoes.
  - **Acceptance criteria:**
    - `src/web/navegacao.ts` exporta `itensNavegacao` do tipo `{ caminho: string; rotulo: string; componente: ComponentType }[]` com exatamente quatro itens, cujos caminhos são `/`, `/tarefas`, `/categorias` e `/anotacoes`, e cujos rótulos são `Dashboard`, `Tarefas`, `Categorias` e `Anotações`.
    - `src/web/App.tsx` registra uma rota para cada caminho de `itensNavegacao`, renderizando o `componente` do item correspondente, e `Sidebar.tsx` monta seus links somente a partir de `itensNavegacao`; o link Dashboard leva a `/`.
    - Em telas com largura acima de 768 px a sidebar fica sempre visível; em telas de até 768 px ela fica recolhida por padrão, e `Cabecalho.tsx` exibe um botão com o texto `Abrir menu` que a abre.
    - Em tela de até 768 px, escolher qualquer item da sidebar fecha a sidebar.
  - **Traces:** workflow 1 — Primeiro acesso e navegação; rotas-de-navegacao; interface.responsiva

- [ ] **Task:** Definir as chaves `scripts` de `package.json` com os comandos `migrate`, `dev:servidor`, `dev:web`, `build` e `start`.
  - **Acceptance criteria:**
    - `package.json` define as chaves de `scripts` exatamente como `migrate`, `dev:servidor`, `dev:web`, `build` e `start`.
    - `migrate` executa, com `tsx`, a função `aplicarEsquema` do código do servidor, sem etapa de compilação manual; `dev:servidor` executa o servidor da API em TypeScript com `tsx`, e `dev:web` executa o Vite.
  - **Traces:** aplicacao.inicializacao; aplicacao.persistencia

- [ ] **Task:** Configurar `vite.config.ts` com `build.outDir` em `dist/web` e o proxy de `/api` para a porta 3000.
  - **Acceptance criteria:**
    - `vite.config.ts` define `build.outDir` como `dist/web`.
    - `vite.config.ts` define `server.proxy` com a chave `/api` apontando para `http://localhost:3000`.
  - **Traces:** workflow 1 — Primeiro acesso e navegação

- [ ] **Task:** Fazer `build` compilar o servidor e a interface, e `start` iniciar a aplicação compilada sem TypeScript na execução.
  - **Acceptance criteria:**
    - `build` compila o servidor com `tsconfig.servidor.json`, cuja saída é `dist/servidor`, e compila a interface com o Vite; `npm run build` termina com código de saída 0.
    - `start` executa o JavaScript compilado em `dist/servidor` com `node` e não usa `tsx` nem TypeScript diretamente.
  - **Traces:** aplicacao.inicializacao; workflow 1 — Primeiro acesso e navegação

- [ ] **Task:** Fazer o servidor da API entregar a interface compilada e subir com o banco configurado, no ponto de entrada do servidor em `src/servidor`.
  - **Acceptance criteria:**
    - Depois de `npm run build`, `npm start` responde a `GET /`, `GET /tarefas`, `GET /categorias` e `GET /anotacoes` com o conteúdo de `dist/web/index.html`, e serve os arquivos estáticos de `dist/web`.
    - As rotas `/api` são registradas antes da resposta de fallback da interface: `GET /api/painel` responde JSON e não o conteúdo de `index.html`.
    - Antes de escutar a porta 3000, o servidor chama `aplicarEsquema` com o caminho lido de `CAMINHO_BANCO`; `aplicarEsquema` usa `CREATE TABLE IF NOT EXISTS` e, portanto, não remove registros já existentes.
    - O servidor carrega o `.env` com `process.loadEnvFile` somente se o arquivo existir, e um valor de `CAMINHO_BANCO` já definido no ambiente do processo prevalece sobre o valor do `.env`.
  - **Traces:** workflow 5 — Persistência após reinicialização; workflow 1 — Primeiro acesso e navegação; aplicacao.persistencia

- [ ] **Task:** Garantir que os registros e as contagens cadastrados antes de uma reinicialização voltem a aparecer nas listas e no Dashboard, com os mesmos valores.
  - **Acceptance criteria:**
    - Após reiniciar o servidor com o mesmo `CAMINHO_BANCO`, `GET /api/tarefas`, `GET /api/categorias`, `GET /api/anotacoes` e `GET /api/painel` devolvem os registros e as contagens cadastrados antes, com os mesmos valores.
    - A página `/` exibe a quantidade de tarefas, de categorias e de anotações e a distribuição das tarefas por pendente, em andamento e concluída, vindas de `GET /api/painel`, e mostra zeros quando não há registros.
  - **Traces:** workflow 5 — Persistência após reinicialização; workflow 1 — Primeiro acesso e navegação; interface.dashboard; aplicacao.persistencia

- [ ] **Task:** Versionar `.env.example` e `.gitignore` para a configuração do banco, e fazer o caminho do banco resolver a partir da raiz do projeto.
  - **Acceptance criteria:**
    - `.env.example` contém a linha `CAMINHO_BANCO=./dados/parallel-lab.sqlite` e não contém senha, token, nem string de conexão.
    - A busca `grep -rn "process.env" src/` mostra as leituras de variáveis de ambiente do código; cada nome de variável que aparece nessa busca tem uma linha `NOME=valor` correspondente em `.env.example`, e hoje a busca mostra somente `CAMINHO_BANCO`.
    - `.gitignore` contém, como linhas exatas, `.env` e `dados/`.
    - O código que abre o banco resolve um `CAMINHO_BANCO` relativo a partir da raiz do projeto, e cria o diretório pai do arquivo antes de abri-lo quando ele não existe.
  - **Traces:** aplicacao.persistencia; origem do banco; configuração do banco; .env.example; workflow 5 — Persistência após reinicialização

- [ ] **Task:** Escrever `README.md` em português do Brasil com as instruções de execução, na ordem: instalação, criação do `.env`, migração, desenvolvimento, build e início.
  - **Acceptance criteria:**
    - `README.md` apresenta, nesta ordem, as seções de instalação com `npm install`, de criação do `.env` copiando `.env.example`, de migração com `npm run migrate`, de desenvolvimento com `npm run dev:servidor` e `npm run dev:web`, de build com `npm run build` e de início com `npm start`.
    - Cada comando `npm run` citado no `README.md` corresponde a uma chave de `scripts` em `package.json`.
    - O `README.md` informa que um `CAMINHO_BANCO` definido no ambiente do processo tem prioridade sobre o `.env`.
  - **Traces:** aplicacao.inicializacao; configuração do banco; workflow 1 — Primeiro acesso e navegação; workflow 5 — Persistência após reinicialização
