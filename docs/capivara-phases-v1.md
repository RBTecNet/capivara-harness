# Contrato `capivara-phases/v1`

> Documento gerado por `npm run docs:contract` a partir de
> `packages/core/src/contract/`. Não edite à mão: um teste falha quando esta
> página diverge do código que a produz.

O contrato é lido por um único módulo. `capivara init` valida o documento com
`parsePhases`; `capivara build` divide o documento em sessões com o mesmo
`parsePhases`. Não existe um segundo parser, então o que se valida e o que se
executa não podem divergir.

## Gramática

```markdown
# <Projeto> — Project Phases

<!-- inputs: skeleton.md@sha256:abc123abc123 -->

## Overview

<estratégia de build, número de fases, linha de corte do MVP>

**Conventions:**
- `[ ]` pendente · `[x]` concluído

## Phase 1: <título>

**Goal:** <resultado observável> · **Depends on:** <none | Phase N> · **Covers:** <stories/entidades/workflows> · **Areas:** <frontend|backend|dados|infra|qualidade>

### Phase 1.1: <sub-fase>

- [ ] **Task:** <o que construir>
  - **Acceptance criteria:**
    - <condição concreta e validável>
  - **Feature tests:** <nome do teste → a regra de negócio que ele afirma>
  - **Design ref:** <caminho sob o diretório de design>
  - **Traces:** US-1.1, users, workflow 2

## Open Questions
```

`**Feature tests:**` e `**Design ref:**` são opcionais: o primeiro é exigido de
tasks com lógica de negócio e o segundo de tasks de tela, e essa exigência
pertence ao auditor, não ao parser. Os rótulos são casados literalmente e nunca
são traduzidos; a indentação dos sub-itens é livre.

## Invariantes

| Código | Invariante | Verificado por | Manifestação |
| --- | --- | --- | --- |
| I-01 | A linha 1 é `# <nome> — Project Phases` | `parser` | `rejects` |
| I-02 | A linha 3 é o stamp `<!-- inputs: ... -->` com os três sha256 de 12 caracteres, frescos | `stamps` | `rejects` |
| I-03 | Toda fase é `## Phase N: <título>`, com N contíguo a partir de 1, seguida da linha de metadados `**Goal:** · **Depends on:** · **Covers:**` | `parser` | `rejects` |
| I-04 | Nenhum heading `## Phase` fora desse formato | `parser` | `rejects` |
| I-05 | Sub-fases existem apenas como `### Phase N.M: <título>`, com N igual ao da fase corrente | `parser` | `rejects` |
| I-06 | Qualquer outro heading de nível 2 encerra a captura da fase anterior | `parser` | `behaviour` |
| I-07 | Toda fase declara pelo menos uma task | `parser` | `rejects` |
| I-08 | Toda task declara pelo menos um critério de aceitação | `parser` | `rejects` |
| I-09 | Toda task declara `**Traces:**` não vazio | `parser` | `rejects` |
| I-10 | Toda story `US-N.M` declarada no esqueleto aparece em pelo menos um `**Traces:**` | `coverage` | `rejects` |
| I-11 | Toda entidade declarada no modelo de dados aparece em pelo menos uma task | `coverage` | `rejects` |
| I-12 | Todo workflow numerado do esqueleto é coberto por uma task ou explicitamente excluído | `coverage` | `rejects` |
| I-13 | Nenhum marcador `[NEEDS DECISION]` no documento | `parser` | `rejects` |
| I-14 | Todo `**Design ref:**` aponta para um caminho existente sob o diretório de design | `design-refs` | `rejects` |

`rejects` produz um erro com o código do invariante; `behaviour` descreve como o
parser lê o documento e é provado por teste de comportamento, sem código de erro.

`parser` é puro: recebe texto e devolve árvore ou erros. `stamps`, `coverage` e
`design-refs` recebem o mundo por parâmetro — bytes dos upstreams e existência de
caminhos —, de modo que nenhum deles toca o disco por conta própria.

## Por que cada invariante existe

- **I-01** — Identidade do documento. Sem ela o loop não sabe se recebeu um plano de execução ou outro markdown qualquer.
- **I-02** — Detecta documento gerado antes de um upstream mudar. A forma é verificada pelo parser; o frescor exige os bytes atuais dos arquivos citados.
- **I-03** — O divisor cria uma sessão de agente por fase. Numeração com buraco ou repetição torna a referência por número ambígua, e sem Goal o agente frio não sabe o resultado observável que a fase possui.
- **I-04** — Uma fase malformada desapareceria silenciosamente do run: o divisor não a reconhece e ninguém percebe a ausência.
- **I-05** — Sub-fase promovida a nível 2 vira sessão própria e quebra a regra de dimensionamento: pai e sub-fases compartilham uma sessão.
- **I-06** — Conteúdo fora de fase nunca chega ao agente. Tornar isso explícito evita que texto de `## Overview` ou `## Open Questions` seja confundido com trabalho a implementar.
- **I-07** — Fase sem task é uma sessão de agente paga sem nada a fazer.
- **I-08** — O verificador independente decide DONE ou INCOMPLETE task a task contra os critérios. Sem critério não há veredito possível.
- **I-09** — Rastreabilidade em ambas as direções: nada inventado e nada órfão. É também o que alimenta as coberturas I-10 a I-12.
- **I-10** — Cobertura: uma story sem task é trabalho que o plano esqueceu, e o loop entregaria uma aplicação incompleta sem nunca reprovar.
- **I-11** — Cobertura: uma tabela citada em lugar nenhum do plano é um dado que nunca será implementado.
- **I-12** — Cobertura: um fluxo principal pode sumir entre a descrição e o plano sem que nenhuma verificação perceba.
- **I-13** — Gap aberto bloqueia o RALPH READY. Mandar o loop implementar uma decisão que ninguém tomou produz código que será descartado.
- **I-14** — Referência morta engana o executor: ele implementa por conta própria acreditando ter seguido um design que não existe.

## Campos removidos de propósito

Superfície de contrato é superfície de falha: todo campo obrigatório é um campo
que o escritor pode errar. Estes existiam no contrato anterior e foram removidos
porque nenhuma decisão do loop quebra sem eles.

| Campo | Por que o loop não precisa |
| --- | --- |
| IDs `T###` globais ascendentes | o loop identifica a task pelo índice dentro da fase; nada atravessa fases |
| `**Scope:**` com paths entre crases | não há cache incremental de validação: a suíte roda inteira. Num greenfield, paths seriam ficção |
| `**Depends on:**` por task | as tasks de uma fase rodam na mesma sessão, em ordem de leitura; dependência entre tasks é sequência, não grafo |
| `**Parallel safe:**` | não há paralelismo: uma fase, uma sessão, sequencial |
| `**Validation:**` por task | o comando de teste é do projeto e é resolvido pelo loop, não declarado task a task |
| `**Expected evidence:**` | a evidência é a árvore de arquivos, a saída da suíte e o veredito do verificador; declará-la seria pedir ao escritor que preveja o futuro |
| `AC-TNNN-NN:` prefixado | o prefixo só existia para casar com a matriz exaustiva de um gerente que aqui não existe |
| manifesto com sha256 por artefato | a descoberta é por caminho fixo e o frescor é o stamp da linha 3 |
| `status: draft/ready/blocked/invalid` | ou o documento passa no parser e nas coberturas, ou não passa |
| contrato operacional e fase final sintética | a aceitação operacional em ambiente limpo ficou fora do escopo; o produto é provado pela suíte e pelo verificador |

Um campo novo só entra depois de responder: **qual decisão do loop quebra sem
ele?** Se a resposta for "nenhuma", o campo não existe.
