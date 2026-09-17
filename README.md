# capivara

Do prompt à aplicação final, em dois comandos.

```bash
capivara init "um sistema de reservas para uma pousada de 8 quartos"
capivara build
```

O primeiro entrevista você, escreve quatro documentos, audita cada um e para
quando não há mais nenhum gap: **RALPH READY**. O segundo constrói a aplicação a
partir dessa documentação, uma fase por sessão, até o fim.

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

Confira o ambiente antes de gastar a primeira chamada:

```bash
capivara doctor
```

## Os dois comandos

### `capivara init`

Percorre quatro documentos encadeados, cada um com sua própria entrevista:

```
project-description.md  →  user-stories.md  →  database-schema.md  →  project-phases.md
```

Cada documento passa por um **self-check mecânico** (custo zero) e depois por um
**auditor independente**, em sessão nova, que aprova ou devolve com o motivo *e*
a orientação de correção. Só `project-phases.md` é consumido pelo loop; os outros
três são a autoridade que o executor lê.

A entrevista pergunta uma coisa por vez, mostra a evidência antes da pergunta, e
classifica cada resposta. Só uma resposta aceita vira decisão confirmada —
`não sei` nunca confirma a recomendação que estava na tela.

Termina em `RALPH READY` ou em `NOT READY` dizendo exatamente o que falta. Nunca
"quase pronto".

### `capivara build`

Uma fase = uma sessão de agente. Por fase, quatro gates:

| Gate | O que verifica |
|---|---|
| G0 | o engine terminou de verdade |
| G1 | a sessão escreveu código — **sinal, não veredito** |
| G2 | a suíte do projeto, rodada **pelo loop**, fora da sessão do agente |
| G3 | um verificador independente, read-only, task a task |

Todos verdes com a árvore suja → um commit por fase. Todos verdes com a árvore
limpa → a fase já estava implementada. Qualquer um vermelho → sessão nova com a
**causa real**, nunca "os testes falharam".

Esgotados os ciclos, o loop para e é retomável: `capivara build` de novo continua
de onde parou, sem refazer o que já ficou verde.

## Os quatro papéis

| Papel | O que faz | Permissão |
|---|---|---|
| `writer` | escreve os documentos | somente leitura |
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
│   ├── project-description.md
│   ├── user-stories.md
│   ├── database-schema.md
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
