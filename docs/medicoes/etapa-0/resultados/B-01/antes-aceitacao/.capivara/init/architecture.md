# Tarefas locais por terminal — Arquitetura e infraestrutura

## Visão geral
Aplicação local organizada em três componentes: persistência em arquivo JSON, operações sobre tarefas e entrada pelo terminal. Os contratos internos separam o armazenamento das regras das tarefas e da apresentação das respostas. Cada execução realiza o comando solicitado e termina; o arquivo preserva as tarefas e a sequência de identificadores para os processos posteriores.

## Componentes
### persistencia
- responsabilidade: Resolver o caminho do arquivo, carregar o estado persistido e gravar suas alterações, preservando a sequência de identificadores.
- áreas: dados
- arquivos: src/persistencia.js
- contratos:
  - resolverArquivo(valor: string | undefined, diretorioAtual: string): string → caminho absoluto; valor undefined seleciona ./data/tasks.json relativo ao diretório informado.
  - lerEstado(caminho: string): Promise<Estado> → retorna {proximoId, tarefas}; somente a ausência do arquivo representa o estado inicial {proximoId: 1, tarefas: []}, sem criar arquivos ou diretórios.
  - gravarEstado(caminho: string, estado: Estado): Promise<void> → cria os diretórios pais necessários e persiste o documento JSON completo, mantendo proximoId mesmo quando tarefas está vazio.

### dominio
- responsabilidade: Executar listagem, criação, conclusão e remoção, aplicando as regras das tarefas antes de solicitar qualquer gravação.
- áreas: backend, dados
- depende de: persistencia
- entidades: tarefas
- arquivos: src/dominio.js
- contratos:
  - Tarefa = {id: number, title: string, done: boolean}; Estado = {proximoId: number, tarefas: Tarefa[]}.
  - listar(caminho: string): Promise<Tarefa[]> → retorna as tarefas ordenadas por id crescente, sem gravar.
  - adicionar(caminho: string, titulo: string): Promise<Tarefa> → aplica trim ao título, recusa resultado vazio, atribui proximoId, define done como false, incrementa proximoId e persiste antes de retornar.
  - concluir(caminho: string, identificador: string): Promise<Tarefa> → exige identificador inteiro positivo e tarefa existente; persiste done como true quando necessário e retorna a tarefa, inclusive quando já estava concluída.
  - remover(caminho: string, identificador: string): Promise<{removed: number}> → exige identificador inteiro positivo e tarefa existente; remove a tarefa, preserva proximoId e persiste antes de retornar.
  - ErroDeEntrada, exportado por src/dominio.js → erro com message explicativa em português para título vazio, identificador inválido ou tarefa inexistente; nenhuma dessas recusas chama gravarEstado.

### terminal
- responsabilidade: Interpretar os comandos públicos, selecionar o arquivo pela configuração do processo, apresentar respostas e recusas e fornecer os arquivos de distribuição e orientação de uso.
- áreas: geral, infra
- depende de: dominio, persistencia
- arquivos: src/cli.js, package.json, README.md
- contratos:
  - node src/cli.js list → código 0 e uma linha na saída padrão contendo o array JSON retornado por listar.
  - node src/cli.js add TITULO → código 0 e uma linha na saída padrão contendo somente o objeto JSON {id, title, done} retornado por adicionar.
  - node src/cli.js done ID → código 0 e uma linha na saída padrão contendo somente o objeto JSON {id, title, done} retornado por concluir.
  - node src/cli.js remove ID → código 0 e uma linha na saída padrão contendo somente o objeto JSON {removed: ID}, com ID numérico.
  - Configuração por execução → passa process.env.TASKS_FILE e process.cwd() para resolverArquivo e utiliza o caminho resultante em toda a operação.
  - Argumentos → o comando é o primeiro argumento; TITULO ou ID é o argumento seguinte; título ausente é tratado como vazio e identificador ausente é inválido.
  - Recusa de entrada → código 1, mensagem explicativa em português no stderr e nenhuma resposta de sucesso na saída padrão; comando desconhecido é recusado antes de executar operações sobre tarefas.
  - package.json → type igual a module e start igual a node src/cli.js.
  - README.md → instruções curtas em português para execução, configuração por TASKS_FILE e exemplos de list, add, done e remove; títulos com espaços são apresentados entre aspas.

## Decisões de dados
- Formato do arquivo: Persistir um documento JSON com a estrutura {proximoId, tarefas}. Cada item de tarefas contém exclusivamente os campos id, title e done. proximoId é metadado interno de armazenamento, necessário para preservar o histórico de identificadores sem acrescentar campos à entidade.
- Sequência de identificadores: Um arquivo sem histórico começa com proximoId igual a 1. Cada criação consome esse valor e incrementa o metadado na mesma gravação. Conclusões e remoções não alteram proximoId; remover todas as tarefas mantém o documento com a sequência acumulada.
- Seleção e independência do arquivo: Resolver caminhos relativos a partir do diretório de trabalho de cada execução. TASKS_FILE, quando definida, seleciona o arquivo; quando ausente, utilizar ./data/tasks.json. Todo o estado, inclusive a sequência, pertence ao arquivo selecionado.
- Leitura sem efeitos de gravação: A ausência do arquivo produz somente um estado inicial em memória. Listar não cria arquivo nem diretórios. Arquivo existente não é tratado como ausente quando sua leitura não puder ser concluída.
- Gravação do estado: Usar os recursos embutidos de arquivos do Node.js. Criar os diretórios pais apenas durante a gravação, escrever o documento completo em arquivo temporário no mesmo diretório e substituir o destino por renomeação após concluir a escrita. Não há SQL, criação de esquema ou migrações.
- Preservação diante de recusas: Validar o título e a forma numérica do identificador antes de qualquer gravação. Para conclusão e remoção, confirmar também a existência da tarefa antes de alterar o estado. A conclusão repetida retorna a tarefa já concluída sem exigir nova gravação.
- Representação pública: Usar números JSON para id e removed, texto para title e booleano para done. A listagem ordena numericamente por id; nenhum comando expõe proximoId.

## Fluxos e componentes
- workflow 1 (Gerenciar tarefas em processos separados): terminal → dominio → persistencia — Em cada processo, terminal resolve o arquivo e aciona dominio, que consulta persistencia. A primeira listagem retorna [] se o arquivo estiver ausente. Duas criações persistem tarefas e sequência; uma listagem posterior recupera ambas. A conclusão persiste o novo estado e a remoção preserva a sequência. As listagens seguintes observam essas alterações no mesmo arquivo selecionado.

## Infraestrutura
### Runtimes
- Node.js 24.22.1 — Executar diretamente os módulos JavaScript ESM e disponibilizar os recursos embutidos necessários. (autoridade: Pedido original e stack do skeleton exigem Node.js >=22; o inventário informa Node.js 24.22.1 disponível.)

### Ferramentas de desenvolvimento
- nenhum declarado

### Gerenciadores de pacotes
- npm 11.19.1 — Executar os scripts declarados em package.json, sem instalação de pacotes. (autoridade: O pedido exige scripts em package.json e o inventário informa npm 11.19.1 disponível.)

### Dependências
- node:fs/promises [app] — Ler e gravar JSON, criar diretórios e renomear o arquivo temporário. (autoridade: Persistência em arquivo JSON e uso exclusivo dos recursos embutidos do Node.js.)
- node:path [app] — Resolver o arquivo selecionado e identificar seu diretório pai. (autoridade: TASKS_FILE aceita a seleção do arquivo e o caminho padrão é relativo ao diretório de trabalho.)
- node:process [app] — Acessar argumentos, ambiente, diretório de trabalho, saídas e código de encerramento. (autoridade: Contrato público por comandos de terminal, configuração por TASKS_FILE e recusas por stderr e código diferente de zero.)
- node:test [dev] — Disponibilizar o executor embutido node --test, sem pacote externo. (autoridade: O pedido original exige testes automatizados com o executor embutido do Node.js.)

### Serviços
- nenhum declarado

### Bancos de dados
- nenhum declarado

### Requisitos de ambiente e compatibilidade
- JavaScript ESM executado diretamente em Node.js >=22, sem transpilação.
- Utilizar o Node.js 24.22.1 e o npm 11.19.1 presentes no ambiente Linux informado.
- Execução exclusivamente pelo terminal, sem interface web, servidor ou serviço permanente.
- Todas as dependências declaradas são embutidas no Node.js; nenhuma instalação de pacote é necessária.

### Condições para iniciar a implementação
- Executar as sondas de prontidão uma vez antes da primeira fase, utilizando o ambiente já disponível.
- O diretório do projeto deve permitir a criação dos arquivos da aplicação.
- Para comandos que gravam, o processo deve ter permissão para criar os diretórios necessários e gravar no destino selecionado.

### Sondas de prontidão
O build confere estas sondas uma vez, antes da primeira fase. Nenhuma fase as repete.
- Node.js >=22: ["node","--eval","if (Number(process.versions.node.split('.')[0]) < 22) { console.error('É necessário Node.js 22 ou superior.'); process.exit(1); }"]
  - preparação: Utilizar o Node.js 24.22.1 já disponível na máquina; nenhuma instalação é necessária.
- Recursos embutidos do Node.js: ["node","--input-type=module","--eval","await Promise.all(['node:fs/promises', 'node:path', 'node:process', 'node:test'].map(nome => import(nome)));"]
  - preparação: Os módulos declarados acompanham o Node.js disponível; nenhuma instalação de pacote ou serviço é necessária.

## Fases
- Phase 1: Persistência e operações sobre tarefas — Entregar os módulos de persistência e domínio com seleção do arquivo, operações sobre tarefas, preservação entre processos e sequência de identificadores que permanece após remoções. · depende de none · cobre tarefas, US-1.5 · componentes persistencia, dominio · 5 tasks · Reúne o formato persistido e suas operações consumidoras porque ambos compartilham as decisões de identidade e gravação. Os dois módulos têm contratos definidos e ficam prontos antes da interface que os utiliza.
- Phase 2: Comandos públicos e instruções de uso — Integrar os módulos existentes à entrada src/cli.js, disponibilizar todos os comandos com respostas JSON e recusas explicativas e entregar package.json e README.md, tornando o fluxo completo acessível em processos separados. · depende de Phase 1 · cobre US-1.1, US-1.2, US-1.3, US-1.4, US-1.5, US-1.6, US-1.7, workflow 1 · componentes terminal · 4 tasks · Concentra a integração pública e a documentação em um único componente, consumindo contratos já concluídos. O fluxo pertence a esta fase porque todos os comandos e o caminho completo até o arquivo estarão disponíveis ao seu término.

MVP fecha na fase 2.
