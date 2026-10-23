# capivara

Do prompt à aplicação final, em três comandos.

Versão **0.7.7**: o `build` recupera por defeito e revalida só a prova que a
correção atingiu (§125), cobra cada fluxo quando o plano diz que ele existe
(§127), entrega a fase grande ao executor em partes, julgando-a inteira (§130),
e só aprova o ambiente que a instalação estrita aceita, com o MiniMax nos efforts
que o modelo aceita da API direta ao OpenCode e o catálogo da API como referência
dos modelos no BUILD (§131); não exige navegador de produto que não o tem e
deixa o fluxo dele pendente e nomeado, nunca aprovado, e o verificador não
bloqueia pelo que nenhuma sessão consegue observar (§133);
o `plan` mantém a correção que o achado alcança e a fase que a
reorganização não tocou (§128), não planeja teste, escolhe todas as dependências
do projeto — as de teste incluídas — e não devolve por teste (§129). Planos e
runs da 0.6.x e da 0.7.x continuam valendo. O contrato dos três estágios está em
[`docs/CONTRATO.md`](docs/CONTRATO.md).
Planejamentos da 0.5.0 e anteriores são incompatíveis: o plano deixou de prescrever testes (`capivara-phases/v2`) e passou a vir com a
arquitetura e a infraestrutura decididas pelo `plan` (`capivara-planning/v3`).
Em projetos existentes, gere novamente com `capivara init --fresh` e depois
`capivara plan --fresh` antes de executar o build. Código, dados e evidências
existentes são preservados; planos, caches e aprovações da geração anterior não
são lidos nem convertidos.

```bash
capivara init "um sistema de reservas para uma pousada de 8 quartos"
capivara plan
capivara build
```

O `init` entrevista você e desenha o produto: **PLAN READY**. O `plan` decide a
arquitetura e a infraestrutura, reorganiza as fases se a arquitetura pedir,
detalha cada uma, audita, ensaia e para quando não há mais nenhum gap:
**RALPH READY**. O `build` constrói a aplicação a partir desse plano, uma fase
por sessão, até o fim.

O corte entre os dois primeiros está onde o custo muda de ordem de grandeza. O
`init` são duas ou três chamadas; o `plan` são dezenas. Errar a divisão do
produto custa minutos, não horas.

## A tese

A incompatibilidade entre um gerador de documentação e o loop que a consome não
se resolve escrevendo um contrato melhor. Resolve-se **eliminando a possibilidade
de existirem dois contratos**.

Existe um único módulo que define a gramática do plano
(`packages/core/src/contract/`). O `init` valida o documento com ele; o `build`
divide o documento em sessões com ele. Não há um segundo parser, e um teste de
arquitetura falha se alguém escrever um. Divergir é mecanicamente impossível.

## Instalação

Exige **Node 22 ou maior** (o desenvolvimento exige 22.12+, 24 ou 26+ — veja
`docs/PLANO.md` §21.3).

```bash
git clone <este repositório> && cd capivara
npm install
npm run build
npm run install:user     # instala o binário em ~/.local
```

### Conectar ao doc-center autenticado

Crie um token na página **Minha conta** do doc-center. Um token de
`leitura` permite carregar o pedido e os documentos aprovados. Para
enviar levantamentos e memórias, use a permissão `workflow`. Para usar a
mesma conexão em vários projetos, escolha um token com acesso a todos os
seus projetos. Um token de projeto funciona somente com aquele slug em
`--mcp-project`.
As memórias enviadas entram como rascunho para aprovação na interface.

Configure a conexão uma vez:

```bash
capivara config
```

Escolha **Adicionar MCP** e informe o endereço, a porta e o token. O token
fica oculto durante a digitação. O atalho faz as mesmas três perguntas:

```bash
capivara config add mcp
```

Para o MCP HTTP na porta `7777`, informe
`http://doc-center.rbtecnologia.net.br/mcp` e porta `7777`.
Inclua `http://` quando o endpoint não usa TLS. Para um endpoint publicado
por HTTPS, use `https://doc-center.rbtecnologia.net.br/mcp` e porta `443`,
com o proxy encaminhando `/mcp` ao listener MCP na porta 7777.
O site e o MCP têm endereços independentes. No host do doc-center, use
`http://127.0.0.1/mcp` e porta `7777`.
A porta informada prevalece sobre uma porta existente no endereço.
Sem caminho, o configurador acrescenta `/mcp`.

A conexão é salva como padrão em `~/.capybara/config.json`, com diretório
privado (`0700`) e arquivo privado (`0600`). Ela fica disponível em todos
os diretórios de projetos, em novos terminais e depois de reiniciar a
máquina. Não é necessário exportar o token a cada sessão. O menu também
permite **Listar MCPs**, **Definir MCP padrão** e **Remover MCP**, mostrando
o status da credencial sem exibir seu valor. A configuração pode ser salva
mesmo quando o servidor está fora do ar.

Depois, execute normalmente:

```bash
capivara init --mcp-project biblioteca --provider codex
capivara plan --provider codex
capivara build --provider codex
```

Quando houver mais de uma instalação do harness, verifique qual binário
está no `PATH`. Para testar diretamente o construído neste repositório:

```bash
npm run build
node "$PWD/packages/core/dist/cli.js" config
```

Flags e variáveis continuam disponíveis para substituir a configuração:

| Configuração | Precedência |
| --- | --- |
| URL MCP | `--mcp`, `CAPIVARA_MCP_URL`, `DOC_CENTER_URL`, conexão global padrão |
| Token Bearer | `CAPIVARA_MCP_TOKEN`, `DOC_CENTER_TOKEN`, token salvo para a URL escolhida |
| Projeto | `--mcp-project`; o build herda o slug do init quando não recebe a flag |
| Pasta de configuração | `CAPIVARA_CONFIG_DIR`; padrão `~/.capybara` |

Evite colocar tokens em argumentos, URLs ou arquivos do projeto. Tokens
salvos só acompanham a URL da respectiva conexão. Quando o ambiente também
define uma URL correspondente ao token, ela precisa coincidir com o
endpoint escolhido; divergência é recusada antes do envio da credencial.
URLs usam HTTP ou HTTPS, sem credenciais, query ou fragmento. Ambos
aceitam token, inclusive em servidores remotos. Em HTTP, o token trafega
sem criptografia.
Bases MCP genéricas continuam funcionando sem token.

`init --mcp-project biblioteca` usa a conexão padrão.
`init --prompt nome` também pode ler um prompt dessa base.
Um pedido literal como `init "um sistema de reservas"` continua local,
mesmo quando há uma conexão configurada. O build retoma o projeto do init
e usa a URL atual do ambiente ou da configuração global para substituir
um endereço local antigo; flags explícitas continuam tendo precedência.

Para enviar um levantamento com token de projeto:

```bash
capivara survey --project /caminho/da/aplicacao \
  --saida ./levantamento --mcp-project biblioteca --provider codex
```

### O que os gates precisam da máquina

O harness tem uma dependência de runtime só (`commander`) e não precisa de mais
nada. Os **gates**, sim: eles rodam a suíte e abrem o navegador do projeto que
está sendo construído, e é aí que uma máquina nova quebra. O `doctor` confere os
três, e nenhum deles bloqueia — cada um vale para o projeto que o usa:

| o quê | para quê | macOS | Linux |
|---|---|---|---|
| `sqlite3` | a suíte de um projeto que guarda dados em SQLite | `brew install sqlite` | `sudo apt install sqlite3` |
| compilador C e `make` | drivers de banco e outros módulos nativos | `xcode-select --install` | `sudo apt install build-essential` |
| navegadores do Playwright | o gate 4, que percorre os fluxos na aplicação de pé | `npx playwright install` | `npx playwright install` |

Confira o ambiente antes de gastar a primeira chamada:

```bash
capivara doctor
```

## Prompt Engineer

No wizard (`capivara` ou `capivara wizard`), escolha **6) Prompt Engineer**
para transformar um pedido cru em um prompt reutilizável. As origens são as
mesmas do `init`: texto digitado ou colado, arquivo, pedido de um projeto MCP
ou prompt guardado na base. Pela CLI:

```bash
capivara prompt-engineer "quero organizar as reservas da pousada" --provider codex
capivara prompt-engineer --file pedido.md --provider claude --saida prompts/reservas.md
capivara prompt-engineer --mcp-project pousada --provider codex
capivara prompt-engineer --prompt nome-do-prompt --provider codex
```

No terminal, o dashboard mostra a etapa atual, o modelo em atividade, o tempo
de espera e o consumo por chamada. Quando precisa de uma decisão, apresenta
a pergunta e as alternativas, com um campo que aceita número ou texto;
Enter deixa a questão em aberto. O painel pausa enquanto você digita e volta
quando a LLM continua. Use `--no-dashboard` para acompanhar só as linhas de
progresso e as perguntas.

O escritor identifica dúvidas de objetivo, contexto, escopo, restrições e
critérios de aceite, pergunta uma decisão por vez e considera as respostas nas
rodadas seguintes. As perguntas são em português; o prompt final é em inglês
por padrão (`--language pt` gera em português). Respostas como `não sei`
permanecem como questões abertas; decisões delegadas ficam identificadas como
suposições. O limite de descoberta (`--max-interview-rounds`, padrão 3) é
informado quando ainda há lacunas.

O resultado organiza objetivo, contexto, requisitos, restrições, etapas,
critérios de aceite e entregáveis, com as decisões, suposições e questões
abertas da entrevista. As orientações seguem os princípios do
[Ponytail](https://github.com/DietrichGebert/ponytail): resolver o pedido
completo com a menor mudança necessária, reutilizar recursos existentes e
verificar o resultado.

O comando mostra o prompt e salva `prompt-engineered.md` na pasta do projeto
(`--project`); `--saida` escolhe outro caminho relativo a essa pasta. Ele usa
somente o papel `writer`. Para continuar na Capivara:

```bash
capivara init --file prompt-engineered.md --provider codex
```

Para outra LLM, use o arquivo conforme a entrada de prompt suportada pela CLI
dela. Respostas da entrevista também podem ser fornecidas por pipe; se a
entrada acabar antes de uma resposta, o comando informa a pergunta pendente
e preserva o arquivo de saída anterior.

## Os três comandos

### `capivara init`

Entrevista você e produz o **esqueleto** do produto: stack, entidades com campos,
stories, fluxos, regras transversais e fases. É a única chamada que olha o
produto inteiro de uma vez.

As **regras transversais** são a parte que não pode ser vaga. Se a fase 3 cria um
campo e a fase 7 o lê, elas nunca se veem — concordam só pelo que o esqueleto
escreveu. Por isso o gate recusa regra que não nomeie sobre o que fala.

A entrevista pergunta uma coisa por vez, mostra a evidência antes da pergunta, e
classifica cada resposta. Só uma resposta aceita vira decisão confirmada —
`não sei` nunca confirma a recomendação que estava na tela.

Termina em **PLAN READY**, que é mecânico: nenhuma chamada de modelo. As fases
cobrem tudo o que foi declarado, são contíguas, dependem só do que vem antes, e
nenhuma decisão material ficou em aberto.

### `capivara plan`

Começa pela **arquitetura**: uma chamada olha o esqueleto inteiro e decide os
componentes do código, os contratos entre eles, as decisões de dados, a
infraestrutura necessária — runtimes, ferramentas, gerenciadores de pacotes,
dependências, serviços, bancos, requisitos de ambiente e condições para começar,
cada item com a autoridade da escolha — e a divisão de fases que vale. A divisão
do `init` é proposta: a arquitetura pode dividir, fundir e reordenar, e o harness
confere em código que nenhuma story, entidade ou fluxo se perdeu. Um auditor
independente julga a arquitetura antes de qualquer fase ser escrita. O resultado
é `architecture.md`.

Depois escreve uma fase por chamada, **cada uma vendo só a sua fatia**: a stack,
o que aquela fase entrega, as regras transversais, e os componentes e contratos
que a arquitetura lhe atribuiu. As tasks nomeiam arquivo, rota e função, para que
um executor econômico nunca precise de uma decisão arquitetural. O plano
descreve comportamento e critérios de aceite; ele não nomeia testes, arquivos de
teste nem procedimentos de validação — quem decide como provar o produto é o
avaliador do build, lendo o código entregue.

O que só a escrita da fase descobre volta como uma segunda rodada de entrevista.
Depois vêm o self-check mecânico (custo zero), o **auditor independente** — uma
chamada por fase, mais uma de coerência sobre o plano inteiro, julgando
fidelidade ao produto, coerência arquitetural, completude, dependências,
dimensionamento e viabilidade para um executor econômico — e o **ensaio do
verificador**, que julga cada critério de aceite antes de existir código: um
critério impossível de observar para aqui, e não três ciclos de correção adiante.
Um achado que pede reorganização de fases volta à arquitetura, e as fases cujo
envelope não mudou voltam do cache.

A recuperação é orientada à conclusão: o que se conserta contando é consertado
em código; uma emenda toca só a fase citada; esqueleto, arquitetura, fases,
aprovações por task e coerência sobrevivem em disco, e uma retomada depois de o
provider cair recomeça de onde parou. Uma emenda que não muda o texto leva os
pontos a você em vez de pagar outra devolução. Nada disso declara aprovado um
documento que não foi.

Termina em `RALPH READY` ou em `NOT READY` dizendo exatamente o que falta. Nunca
"quase pronto".

APIs diretas usam um teto de **32.768 tokens de saída por chamada**. Para ajustar
esse teto explicitamente, defina `CAPIVARA_API_MAX_OUTPUT_TOKENS` com um inteiro
positivo antes do comando. Exemplo, para um modelo que aceite 65.536 tokens:

```bash
CAPIVARA_API_MAX_OUTPUT_TOKENS=65536 capivara plan
```

O teto pode incluir raciocínio e texto final, conforme o provider. Aumentá-lo
permite maior consumo; a Capivara mantém o padrão até você escolher outro valor.
Se a geração for cortada, ela para sem repetir automaticamente e grava o consumo
informado pela API no diagnóstico. No `init` e no `plan`, o texto visível
incompleto fica em `.partial.txt`, separado do documento e do cache. Isso não
muda os limites das CLIs.

### `capivara build`

Cada fase usa sessões separadas de construção e validação. Por fase, cinco gates:

| Gate | O que verifica |
|---|---|
| G0 | o engine terminou de verdade |
| G1 | a sessão escreveu código — **sinal, não veredito** |
| G2 | a suíte do projeto, rodada **pelo loop**, fora da sessão do agente |
| G3 | um verificador independente, read-only, task a task |
| G4 | os fluxos do esqueleto, percorridos **na aplicação de pé** |

Enquanto G0 aguarda o executor concluir, o painel mostra a atividade reportada
pelo Codex ou OpenCode: arquivos, comandos e resultados de testes, com o tempo
desde o último evento. No paralelo, a atividade aparece no agente correspondente.
Testes executados dentro da sessão são informação de progresso; G2 continua
rodando sua verificação independente. Ao terminar a suíte do G2, o harness
encerra os processos que ficaram no grupo dessa execução.

Ctrl+C encerra as invocações ativas. No OpenCode standalone em Linux, isso
inclui o servidor privado e filhos identificados por uma marca da chamada,
mesmo em grupos separados. Na retomada, alterações sem commit do worktree são
guardadas como parcial antes da limpeza; a fase volta aos gates normalmente.

Os quatro primeiros leem; o G4 abre o produto e clica. Cada fluxo declarado no
esqueleto vira um roteiro Playwright, escrito por uma sessão que não implementou
a fase, guardado em `.capivara/flows/` e executado pelo loop — e como ele fica no
projeto, o fluxo da fase 2 continua sendo percorrido na fase 7. `--no-flows`
desliga o gate.

Todos verdes com a árvore suja → um commit por fase. Todos verdes com a árvore
limpa → a fase já estava implementada. Defeito funcional vermelho recebe a
**causa real** para correção; erro do roteiro do harness é corrigido no próprio G4.

Esgotados os ciclos, o loop para e é retomável: `capivara build` de novo continua
de onde parou, sem refazer o que já ficou verde.

O verificador informa, para cada pendência, a evidência, como corrigir e qual
teste ou comando confirma a correção. Ele deve cobrir todos os critérios da
tarefa, incluindo o comportamento e a mensagem apresentados em falhas reais.

A aprovação prioriza funcionamento e custo: implementação equivalente é aceita,
e sugestões de cobertura ou organização aparecem como observações não bloqueantes.
Durante a construção, os agentes recebem orientação para usar verificações focadas;
G2 continua rodando a suíte completa independentemente. Uma nova construção registra
o motivo completo da devolução. Defeitos reais de funcionalidade, dados e segurança
continuam exigindo correção.

Roteiros do G4 são gerados, executados e corrigidos pelo harness, com até duas
correções distintas de roteiro por passagem. Erro persistente de roteiro não pede
ao executor que altere produto aprovado. Um carregamento que terminou antes de o
teste começar a observá-lo exige ajustar o teste, sem atrasar artificialmente o produto.
O roteirista e a triagem recebem as regras compartilhadas do esqueleto e os critérios
da fase: endpoints, métodos e base do cliente já publicados não precisam ser adivinhados
a partir do nome da tela.

O `plan` publica `environment.json` com os pré-requisitos e sondas de prontidão
decididos pela arquitetura, mais a infraestrutura declarada. O `build` verifica e prepara o ambiente antes de iniciar
as fases, incluindo dependências existentes e Chromium quando G4 está habilitado.
A aprovação vale para a execução: as fases não repetem essas sondas. Dependência
ou migração criada pelo código continua sendo instalada/aplicada quando necessário.
O build exige o metadado atual vinculado ao plano e ao esqueleto; não há fallback
para planos antigos nem conversão automática pelo catálogo da stack.

Se a resposta de verificação vier com formato ou cobertura inválidos, o Core
pede uma correção somente leitura no mesmo ciclo, preservando a resposta original.
Isso não consome um reparo nem envia o executor para alterar código por erro de
protocolo. Após um reparo, uma revisão completa renova os vereditos; as tasks
aprovadas voltam a ser lembradas nas rodadas seguintes, mantendo a possibilidade
de reabrir uma regressão real.

Com um verificador via CLI, o build também permite uma sessão de reparo por
fase, por padrão. Nessa sessão separada, o verificador pode corrigir código,
fortalecer testes e instalar as dependências declaradas do projeto que o
construtor não conseguiu preparar — nunca uma que a infraestrutura aprovada não
declare (§129). Depois, o Core executa novamente a suíte, uma nova
verificação somente leitura e os fluxos. O reparador não aprova sua própria
alteração nem faz commits. `--max-verifier-repairs 0` desliga os reparos;
valores de 1 a 10 definem o orçamento por fase. Com API direta, o verificador
fornece orientação, e o construtor continua responsável pelas alterações.
`--no-system-install` também se aplica aos reparos do verificador.

Se um teste falhar somente na integração, a fase volta ao ciclo de correção:
o validador lê o erro completo e entrega ao executor a causa, a evidência, o
arquivo a alterar e o comando de regressão. Se a devolução não resolver, uma
sessão de reparo do validador pode corrigir a entrega no worktree. Essa falha
nova tem uma devolução ao executor e o orçamento configurado de reparos,
compartilhado entre as passagens de recuperação. Todos os gates são exigidos
novamente, inclusive a suíte da árvore integrada; um teste vermelho não vira
aprovação nem encerra imediatamente a recuperação. Uma fase que já roda
sozinha por preparar a fundação também recebe essa oportunidade.

Dependências Node são conferidas pelo runtime e pelos manifestos/lockfiles.
Uma instalação incompatível é preparada novamente com o runtime do harness,
respeitando `engines`. No paralelo, falhas desse ambiente na integração têm
reparo limitado e log completo; se persistirem, o commit aprovado é preservado
para retomar a integração, sem reconstruir a fase. Logs de cada chamada em
`calls.jsonl` registram papel, modelo, agente e se houve reparo.

Artefatos gerados e dependências locais que o projeto manda ignorar ficam
fora das alterações do produto, mesmo em históricos antigos que as versionaram.
Isso inclui `node_modules`, `dist`, cobertura, caches e relatórios. Os arquivos ficam
intactos no disco; fontes, lockfiles e dependências explicitamente fora do ignore
continuam sujeitos às conferências de alteração e integração.

## Os quatro papéis

| Papel | O que faz | Permissão |
|---|---|---|
| `writer` | escreve o esqueleto e as fases | somente leitura |
| `auditor` | aprova ou devolve com orientação | somente leitura |
| `builder` | implementa a fase | escrita + rede |
| `verifier` | verifica e orienta a correção; pode reparar em sessão separada | avaliação somente leitura; escrita + rede na sessão de reparo |

Cada um aceita provider, modelo e effort próprios; sem configuração, herdam o
global.

```bash
capivara init "..." \
  --provider codex --model <modelo> \
  --auditor-provider anthropic --auditor-model <modelo mais barato>
```

**Raciocínio é desligado por padrão.** Sem `--effort`, nenhuma requisição habilita
raciocínio — omitir a flag nunca herda o default caro do provider.

## Providers

CLIs instaladas na máquina: `codex`, `claude`, `opencode`, mais um adapter
custom. APIs diretas: `openai`, `anthropic`, `gemini`, `deepseek`, `minimax`,
`openrouter`.

```bash
capivara providers list
```

Ao escolher uma API sem chave no wizard, a Capivara oferece configurá-la antes
de listar os modelos. A chave é digitada num campo oculto e fica salva para as
próximas execuções. Também é possível configurar diretamente:

```bash
capivara login deepseek
# ou: capivara config add api deepseek
capivara providers models deepseek
capivara providers models minimax
```

Uma chave já definida na variável de ambiente do provider também é reconhecida.
Se a API não retornar uma lista, o wizard permite digitar o identificador exato
do modelo ou voltar ao provider.

No OpenRouter, o wizard verifica se a chave permite geração antes de listar os
modelos. Chaves de gerenciamento oferecem substituição ali mesmo; use uma chave
de API criada em [OpenRouter → Keys](https://openrouter.ai/settings/keys).

Em comandos diretos com `--provider deepseek` e sem `--model`, um terminal
interativo abre a escolha do modelo sem pedir novamente o provider. Falhas na
consulta mostram a causa (credencial, HTTP ou conexão) antes da opção manual.

O papel `builder` exige uma CLI: ele escreve arquivos e roda comandos, e as CLIs
já resolvem sandbox, edição e shell. Os outros três só leem e devolvem texto, e
funcionam em qualquer provider.

No wizard do `build`, as APIs continuam na lista após `custom`, identificadas
como **API via OpenCode**. Escolha `deepseek` para ver somente seus modelos;
o comando equivalente usa `opencode` e `deepseek/deepseek-flash`. A chave cadastrada com
`capivara login deepseek` é reaproveitada na descoberta e na execução, sem ser
copiada para arquivos do OpenCode. Os níveis de raciocínio vêm da própria CLI.

```bash
capivara build --provider opencode --model deepseek/deepseek-flash --effort high --parallel 3 --workers-as-builder
```

“Todos como o executor” substitui os agentes antigos do projeto, mesmo sem
salvar a estratégia. O comando equivalente inclui `--workers-as-builder` para
que o modelo efetivo corresponda à escolha. Com `--save-execution`, as próximas
execuções também usam todos os agentes como o executor atual. `--parallel`
sozinho conserva os agentes salvos; `--worker` permite definir um pool próprio.

Nas CLIs, o prompt viaja por stdin e a chave pelo ambiente. Nas APIs diretas,
o cliente HTTP nativo envia o prompt no corpo e a chave no header de autenticação.
Nenhum dos dois aparece em `argv`, onde ficariam visíveis em `ps`.

## Árvore de artefatos

```
.capivara/
├── init/                    autoridade de leitura para o executor
│   ├── skeleton.md          o produto: stack, dados, stories, fluxos, regras, fases
│   ├── architecture.md      componentes, contratos, infraestrutura e a divisão de fases
│   ├── project-phases.md    o único documento que o loop consome
│   ├── environment.json     sondas de prontidão e infraestrutura, vinculadas aos três acima
│   └── design/              manual e opcional; a ferramenta nunca escreve aqui
├── handoffs/                a entrevista, preservada entre execuções
└── runs/<run-id>/           plano de controle: nunca entra num commit de fase
```

## Códigos de saída

| Código | Significado |
|---:|---|
| 0 | concluído |
| 1 | erro de contrato, configuração ou preflight |
| 2 | pausado e **retomável** |

## Desenvolvimento

```bash
npm run check           # build + typecheck + suíte
npm run docs:contract   # regenera docs/capivara-phases-v2.md a partir do código
```

`docs/PLANO.md` é a especificação do produto e a autoridade deste repositório.
`CAPIVARA.md` traz as convenções e as cinco proibições que mantêm o desenho
coerente. `docs/PILOTOS.md` é o protocolo dos três pilotos com modelo real.

## Licença

Uso próprio.
