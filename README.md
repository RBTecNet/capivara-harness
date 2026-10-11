# capivara

Do prompt à aplicação final, em três comandos.

```bash
capivara init "um sistema de reservas para uma pousada de 8 quartos"
capivara plan
capivara build
```

O `init` entrevista você e desenha as fases do projeto: **PLAN READY**. O `plan`
detalha cada fase, audita, ensaia e para quando não há mais nenhum gap:
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

Escreve uma fase por chamada, **cada uma vendo só a sua fatia**: a stack, o que
aquela fase entrega, e todas as regras transversais. Nada mais. O que precisava
ser acordado entre as fases já foi, no esqueleto.

O que só a escrita da fase descobre volta como uma segunda rodada de entrevista.
Depois vêm o self-check mecânico (custo zero), o **auditor independente** — uma
chamada por fase, mais uma de coerência sobre o plano inteiro — e o **ensaio do
verificador**, que julga cada critério de aceite antes de existir código: um
critério impossível de observar para aqui, e não três ciclos de correção adiante.

Termina em `RALPH READY` ou em `NOT READY` dizendo exatamente o que falta. Nunca
"quase pronto".

### `capivara build`

Uma fase = uma sessão de agente. Por fase, cinco gates:

| Gate | O que verifica |
|---|---|
| G0 | o engine terminou de verdade |
| G1 | a sessão escreveu código — **sinal, não veredito** |
| G2 | a suíte do projeto, rodada **pelo loop**, fora da sessão do agente |
| G3 | um verificador independente, read-only, task a task |
| G4 | os fluxos do esqueleto, percorridos **na aplicação de pé** |

Os quatro primeiros leem; o G4 abre o produto e clica. Cada fluxo declarado no
esqueleto vira um roteiro Playwright, escrito por uma sessão que não implementou
a fase, guardado em `.capivara/flows/` e executado pelo loop — e como ele fica no
projeto, o fluxo da fase 2 continua sendo percorrido na fase 7. `--no-flows`
desliga o gate.

Todos verdes com a árvore suja → um commit por fase. Todos verdes com a árvore
limpa → a fase já estava implementada. Qualquer um vermelho → sessão nova com a
**causa real**, nunca "os testes falharam".

Esgotados os ciclos, o loop para e é retomável: `capivara build` de novo continua
de onde parou, sem refazer o que já ficou verde.

## Os quatro papéis

| Papel | O que faz | Permissão |
|---|---|---|
| `writer` | escreve o esqueleto e as fases | somente leitura |
| `auditor` | aprova ou devolve com orientação | somente leitura |
| `builder` | implementa a fase | escrita + rede |
| `verifier` | diz o que está feito e o que não está | leitura + comandos read-only |

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

O papel `builder` exige uma CLI: ele escreve arquivos e roda comandos, e as CLIs
já resolvem sandbox, edição e shell. Os outros três só leem e devolvem texto, e
funcionam em qualquer provider.

O prompt viaja sempre por stdin e o segredo sempre pelo ambiente. Nenhum dos dois
aparece em `argv`, onde ficariam visíveis em `ps`.

## Árvore de artefatos

```
.capivara/
├── init/                    autoridade de leitura para o executor
│   ├── skeleton.md          o produto: stack, dados, stories, fluxos, regras
│   ├── project-phases.md    o único documento que o loop consome
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
npm run docs:contract   # regenera docs/capivara-phases-v1.md a partir do código
```

`docs/PLANO.md` é a especificação do produto e a autoridade deste repositório.
`CAPIVARA.md` traz as convenções e as cinco proibições que mantêm o desenho
coerente. `docs/PILOTOS.md` é o protocolo dos três pilotos com modelo real.

## Licença

Uso próprio.
