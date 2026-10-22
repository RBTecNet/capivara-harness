# Plano de Execução — Capivara

Ferramenta de terminal que transforma um prompt livre em documentação `RALPH READY`
e, num segundo comando, constrói a aplicação final a partir dessa documentação.

- **Data:** 2026-09-16
- **Status:** plano aprovado para implementação — nenhuma linha de código escrita ainda
- **Base conceitual:** rb-harness (filosofia), beer-and-code-harness (contrato doc↔loop), DeepSeek/Capivara Harness (modelo de execução)
- **Proibido:** reaproveitar código de qualquer um dos três. Só conceitos.

---

## 0. Resumo executivo

O `capivara` é uma CLI Node/TypeScript com três comandos:

```
capivara init "<prompt>"   # entrevista → esqueleto do produto → PLAN READY
capivara plan              # uma fase por chamada → lacunas → auditoria → ensaio → RALPH READY
capivara build             # loop com 4 gates por fase → aplicação final
```

> **§26 reescreveu este ciclo.** As seções 6 a 9 descrevem a cadeia de quatro documentos em
> prosa, que foi medida, reprovada e removida do produto. Elas ficam como registro do que se
> tentou e do que se aprendeu; o que roda hoje está em §26.

A tese do projeto cabe em uma frase:

> **A incompatibilidade entre harness e loop não se resolve escrevendo um contrato melhor.
> Resolve-se eliminando a possibilidade de existirem dois contratos.**

No rb-harness, o gerador tenta acertar um contrato de 1071 linhas (`RB-RALPH-CONTRACT.md`)
descrito em prosa, e o rb-ralph valida esse contrato com outro código, em outra linguagem,
em outro repositório. Toda divergência entre as duas leituras vira uma rejeição do auditor.
No `capivara`, **existe um único módulo TypeScript que define a gramática**, e tanto o
validador do `init` quanto o divisor de fases do `build` importam a mesma função. Divergir
é mecanicamente impossível.

---

## 1. Diagnóstico — evidências levantadas

### 1.1 Por que o rb-harness não fecha o ciclo

| Evidência | Arquivo | Consequência |
|---|---|---|
| Contrato de 1071 linhas em prosa, com 3 sub-contratos versionados | `rb-harness/contracts/RB-RALPH-CONTRACT.md` | Cada campo obrigatório é uma superfície nova de erro do escritor |
| `- [ ] TNNN — <título>` com travessão `—` obrigatório, IDs globais ascendentes que nunca reiniciam entre fases | idem §4.3 | Um hífen comum invalida o plano inteiro |
| `Scope` precisa de paths entre crases para o cache incremental funcionar | idem §4.6 | O escritor documental precisa prever a árvore de arquivos antes de ela existir |
| `AC-TNNN-NN:` com prefixo exatamente igual ao ID da task, proibido citar `RF-001` | idem §4.4 | Renumerar uma task invalida todos os critérios dela |
| `.rb/**` é autoridade imutável; nenhuma task pode tocar | idem §4.3 | Exatamente o sintoma que você descreve: "o executor altera arquivos que ele não pode" |
| `OPERATIONS.json` é criado pelo Harness, nunca por uma task; a fase RBF é sintética | idem §4.4 e §11 | O executor tenta cumprir uma aceitação que não é dele |
| Gerente em modo `exhaustive` deve emitir uma linha `RB_RALPH_CRITERION` por task **e** por `AC-*`, com contagem idêntica | idem §8.1 | Uma linha faltando reprova uma fase tecnicamente correta |
| Consumidor real é o rb-ralph 0.10.1 instalado (`~/.local/libexec/rb-ralph`), bash+cjs, fora do repositório | — | Harness e loop evoluem em ritmos diferentes, sem teste de integração |
| O runner standalone declara: *"There is no manager, no semantic auditor"* | `packages/core/src/standalone-runner.ts:13` | O auditor que você quer só existe no plugin do Claude Code, não na CLI |
| Custo/tempo observados: rb-harness >31min / US$1,84 sem publicar, contra ~10min / US$0,20 no dsh | `docs/PRD-GERADOR-DOCUMENTAL-LEAN.md` §3.2 | O peso do contrato tem preço direto |
| O próprio repositório admite ter trocado o acoplamento implícito por contratos pesados | `docs/reference-analysis.md` §"Ralph compatibility problem" | A causa raiz já estava documentada |

### 1.2 Por que o beer-and-code fecha o ciclo

O contrato doc↔loop dele cabe em 4 linhas de comentário (`scripts/ralph.sh:41-45`):

```
- >= 1 heading `## Phase N: <titulo>`
- nenhum heading `## Phase ...` fora desse formato
- sub-fases em `### Phase N.M:` (nao viram sessao propria)
- qualquer outro `## ` encerra a captura da fase anterior
```

E o loop valida por gates mecânicos, não por conformidade documental:

- **G0** — o engine terminou de verdade (`is_error` no JSON do claude; exit code no codex)
- **G1** — a sessão escreveu código? **Sinal, não veredito** (`ralph.sh:806`). Fase já implementada faz o engine corretamente não escrever nada
- **G2** — a suíte roda **pelo loop, fora da sessão do agente** (`ralph.sh:817`)
- **G3** — verificador independente, read-only, task a task, emitindo `TASK <n>: DONE|INCOMPLETE — <o que falta>` (`ralph.sh:847`)

Verde + árvore suja → `feat(phase-N): título`. Vermelho → sessão nova com a **causa real** da falha,
nunca "os testes falharam" genérico (`ralph.sh:566`).

### 1.3 Por que o dsh acerta

Prompt livre + `goal` persistente + rodadas automáticas (`packages/goal/goal`). Não existe contrato
documental porque **quem escreve e quem consome são a mesma autoridade, no mesmo workspace**.
O workspace é a memória de longo prazo. O preço: `tool-ralph` admite explicitamente
*"Completion is worker self-declaration — there is no independent evaluator"*.

**O que o `capivara` extrai de cada um:**

| Fonte | O que entra | O que fica de fora |
|---|---|---|
| rb-harness | Entrevista com classificação de resposta, escrita em partes limitadas, estado durável, retomada, dashboard, wizard, catálogo de providers, splash/mascote | Contratos versionados pesados, manifest com hash por artefato, `OPERATIONS.json`, fase RBF, matriz exaustiva do gerente |
| beer-and-code | Cadeia de 4 documentos com stamp de freshness, self-checks mecânicos embutidos, contrato mínimo de fases, os 4 gates, commit por fase, verificador task a task | Acoplamento por regex em bash duplicada, dependência de convenção de diretório |
| dsh | Autoridade única sobre documento e execução, workspace como memória, sessão fresca por rodada, rodadas limitadas com teto | Ausência de verificador independente, plataforma de plugins, web UI |

---

## 2. Decisões confirmadas

| # | Decisão | Valor |
|---|---|---|
| D-01 | Dono do loop | **Embutido na ferramenta.** Harness e loop no mesmo projeto, compartilhando um módulo de contrato |
| D-02 | Conjunto documental | **4 documentos encadeados**, fixos |
| D-03 | Auditoria documental | **Por fase documental, modelo separado**, devolvendo motivo + orientação de correção |
| D-04 | Entrevista | **Uma pergunta por vez, por fase documental** |
| D-05 | Gates do loop | **4 gates + 1 commit por fase verde** |
| D-06 | Identidade | Binário `capivara`, artefatos em `.capivara/` |
| D-07 | Produto | Splash + mascote, dashboard ao vivo, modo wizard, retomada de execução interrompida |
| D-08 | Stack | Node ≥22, TypeScript ESM, `commander`, esbuild, vitest, **TUI ANSI própria** (zero framework de UI). Versões fixadas no §21.3 |
| D-09 | Providers | CLIs `codex`/`claude`/`opencode` + APIs diretas `openai`/`anthropic`/`gemini`/`deepseek`/`minimax`/`openrouter` |
| D-10 | Escopo da 1ª entrega | `init` + `build` completos. `plan`/`evolve`/`review` ficam para depois, com o encaixe previsto |
| D-11 | Invocação | **Dois comandos separados.** `init` para em RALPH READY; `build` é explícito |
| D-12 | Alvo do `init` | **Somente greenfield** (pasta vazia) no dia 1 |
| D-13 | Papéis de modelo | **4 configuráveis**: escritor, auditor, executor, verificador — com defaults sensatos |
| D-14 | Git | **Opcional.** Com repo, commita por fase; sem repo, roda e pula os commits |
| D-15 | Gate de teste | Comando redetectado a cada fase; sem comando, G2 é pulado com aviso e G3 segura sozinho |
| D-16 | Stack da aplicação gerada | **Sempre perguntada na entrevista.** Nada inferido |
| D-17 | Projeto sem persistência | `database-schema.md` sempre existe e descreve o modelo de dados real (tabelas, arquivos, estruturas em memória, formato de I/O) |
| D-18 | Design refs | Diretório `.capivara/init/design/` **manual e opcional**, nunca escrito pela ferramenta; ausência nunca é erro |
| D-19 | Fase travada | Para e reporta, retomável. `--keep-going` segue mesmo assim |
| D-20 | Teto do auditor | Configurável, default 3 devoluções; esgotado, pergunta ao usuário |
| D-21 | Executor via API direta | **Não no dia 1.** Executor exige CLI (sandbox, edição e shell já resolvidos). APIs diretas servem escritor, auditor e verificador |
| D-22 | Poder do verificador | Leitura **+ comandos read-only**. Proibido escrever, editar ou commitar |

### Regras herdadas do `ajuste_harness.md` que continuam valendo

1. Responder sempre no idioma do prompt inicial. IDs, marcadores de contrato e chaves de máquina permanecem em inglês para portabilidade.
2. Nunca gerar uma feature inteira num único pedido ao modelo — sempre quebrar em partes pequenas para não estourar contexto.
3. Não usar o `rb-codex` (binário de 266 MB em `~/.local/libexec/rb-harness/rb-codex`). A integração é com o `codex` instalado em `/usr/local/bin/codex`.

---

## 3. Princípio arquitetural central

**Um módulo, duas leituras impossíveis de divergir.**

```
packages/core/src/contract/phases.ts
        ├── parsePhases(md)  ──────►  usado por `init`  (valida antes de publicar)
        └── parsePhases(md)  ──────►  usado por `build` (divide em sessões)
```

Regras que decorrem disso e que **não podem ser violadas em nenhuma fase da implementação**:

1. **Nenhuma regex de fase fora de `contract/`.** O loop não tem parser próprio. Um teste do repositório falha se `## Phase` aparecer em qualquer arquivo fora de `contract/`.
2. **O contrato é código, não prosa.** O documento `.md` que descreve o contrato é gerado a partir do módulo, nunca o contrário.
3. **Superfície de contrato = superfície de falha.** Todo campo obrigatório precisa justificar sua existência respondendo: *"qual decisão do loop quebra sem ele?"*. Se a resposta for "nenhuma", o campo não existe.
4. **O loop nunca rejeita por forma, só por resultado.** Se o documento passou no parser no `init`, o `build` executa. Falha de fase é sempre sobre código, nunca sobre documentação malformada.

---

## 4. Identidade e árvore de artefatos

```
<projeto>/
├── .capivara/
│   ├── init/
│   │   ├── project-description.md      # 1 — escopo, stack, conceitos, workflows
│   │   ├── user-stories.md             # 2 — US-N.M, critérios, apêndice de status
│   │   ├── database-schema.md          # 3 — modelo de dados (DBML ou equivalente)
│   │   ├── project-phases.md           # 4 — ÚNICO artefato consumido pelo loop
│   │   └── design/                     # manual, opcional, nunca escrito pela ferramenta
│   ├── handoffs/
│   │   └── <run-id>.json               # respostas cruas + decisões normalizadas + disposições
│   └── runs/
│       └── <run-id>/
│           ├── run.json                # estado durável do run
│           ├── events.tsv              # timestamp \t stage \t phase \t attempt \t status \t reason
│           ├── phases/                 # uma fase por arquivo, recortada pelo contrato
│           ├── prompts/                # todo prompt enviado, auditável
│           ├── logs/                   # saída bruta de cada chamada
│           ├── audits/                 # veredito de cada auditoria documental
│           └── .lock/
└── CAPIVARA.md                         # índice compacto: comandos, convenções, stack
```

`.capivara/runs/` é estado de controle: o executor nunca escreve ali, e tentar escrever
invalida a tentativa. `.capivara/init/` é autoridade de leitura para o executor — ele lê,
nunca edita.

O nome `database-schema.md` é mantido deliberadamente, mesmo em projetos sem banco
(D-17): a cadeia é fixa e o loop sempre encontra o documento no mesmo lugar. O conteúdo
é que se adapta ao tipo de projeto.

---

## 5. O contrato único — `capivara-phases/v1`

### 5.1 Gramática

```markdown
# <Projeto> — Project Phases

<!-- inputs: project-description.md@sha256:abc123abc123 user-stories.md@sha256:def456def456 database-schema.md@sha256:789abc789abc -->

## Overview

<estratégia de build, número de fases, linha de corte do MVP>

**Conventions:**
- `[ ]` pendente · `[x]` concluído
- Fases e sub-fases são numeradas e referenciadas por número
- Tasks de lógica de negócio listam os testes; tasks de tela listam critérios validáveis e Design ref

---

## Phase 1: <Fundação — nome>

**Goal:** <uma linha> · **Depends on:** <none | Phase N> · **Covers:** <stories/tabelas/workflows>

### Phase 1.1: <sub-fase>

- [ ] **Task:** <o que construir>
  - **Acceptance criteria:**
    - <condição concreta e validável>
  - **Feature tests:** <nome do teste → que regra de negócio ele afirma>
  - **Design ref:** <caminho sob .capivara/init/design/>
  - **Traces:** US-1.1, users, workflow 2

## Open Questions
```

### 5.2 Invariantes validados pelo parser

| # | Invariante | Motivo mecânico |
|---|---|---|
| I-01 | Linha 1 é `# <nome> — Project Phases` | Identidade do documento |
| I-02 | Linha 3 é o stamp `<!-- inputs: ... -->` com os 3 sha256 (12 chars) frescos | Detecta documento gerado antes de um upstream mudar |
| I-03 | `## Phase N: <título>` com N contíguo a partir de 1 | O divisor cria uma sessão por fase |
| I-04 | Nenhum `## Phase` fora desse formato | Uma fase malformada desapareceria silenciosamente do run |
| I-05 | Sub-fases só em `### Phase N.M:` | Sub-fase promovida a `##` quebraria o dimensionamento de sessão |
| I-06 | Qualquer outro `## ` encerra a captura | Conteúdo fora de fase nunca chega ao agente |
| I-07 | Toda fase tem ≥1 task `- [ ]`/`- [x]` | Fase vazia é sessão desperdiçada |
| I-08 | Toda task tem ≥1 `**Acceptance criteria:**` | G3 verifica task a task contra os critérios |
| I-09 | Toda task tem `**Traces:**` não vazio | Rastreabilidade: nada inventado, nada órfão |
| I-10 | Todo `US-N.M` do apêndice de user-stories aparece em ≥1 `**Traces:**` | Cobertura: nenhuma story fica sem plano |
| I-11 | Toda tabela/entidade declarada no modelo de dados aparece em ≥1 task | Cobertura: nenhum dado fica sem implementação |
| I-12 | Todo workflow numerado do project-description é coberto ou explicitamente excluído | Cobertura: nenhum fluxo some |
| I-13 | Nenhum marcador `[NEEDS DECISION]` presente | Gap aberto bloqueia o RALPH READY |
| I-14 | Task com `**Design ref:**` aponta para caminho existente sob `design/` | Referência morta enganaria o executor |

### 5.3 O que foi deliberadamente removido do contrato do rb-ralph

| Campo removido | Por que o loop não precisa |
|---|---|
| IDs `T###` globais ascendentes | O loop identifica task por índice dentro da fase; nada atravessa fases |
| `**Scope:**` com paths entre crases | Não há cache incremental de validação: o G2 roda a suíte inteira. Paths seriam ficção num greenfield |
| `**Depends on:**` por task | Tasks de uma fase rodam na mesma sessão, em ordem de leitura. Dependência entre tasks é sequência, não grafo |
| `**Parallel safe:**` | Não há paralelismo. Uma fase, uma sessão, sequencial |
| `**Validation:**` por task | O comando de teste é do projeto e é resolvido pelo loop (D-15), não declarado por task |
| `**Expected evidence:**` | A evidência é a árvore de arquivos + saída da suíte + veredito do G3. Declarar evidência esperada é pedir ao escritor que preveja o futuro |
| `AC-TNNN-NN:` prefixado | O prefixo só existia para casar com a matriz exaustiva do gerente, que não existe aqui |
| `rb-manifest.json` + `artifacts.tsv` + sha256 por artefato | Descoberta é por caminho fixo. Frescor é o stamp da linha 3 |
| `status: draft/ready/blocked/invalid` | Ou o documento passa no parser e nas coberturas (é RALPH READY), ou não passa |
| `OPERATIONS.json` + fase RBF sintética | Aceitação operacional foi descartada em D-05. O produto é provado pela suíte e pelo verificador |
| Neutralidade de provider como regra do documento | O documento já não menciona provider por construção: o escritor nunca recebe essa informação |

**Redução: de 3 contratos versionados e ~40 invariantes para 1 contrato e 14 invariantes,
todos verificáveis por função pura.**

---

## 6. Os 4 documentos

### 6.1 Cadeia e frescor

```
project-description.md  (cabeça — sem stamp)
        ↓
user-stories.md         <!-- inputs: project-description@sha -->
        ↓
database-schema.md      <!-- inputs: project-description@sha user-stories@sha -->
        ↓
project-phases.md       <!-- inputs: project-description@sha user-stories@sha database-schema@sha -->
```

Cada documento carrega na linha 3 o sha256 (12 chars) dos arquivos que leu. Mudar um
upstream marca os downstreams como `stale` — um aviso, nunca um bloqueio.

### 6.2 Forma de cada documento

| Documento | Seções obrigatórias | Checagens mecânicas |
|---|---|---|
| `project-description.md` | `## Overview`, `### Key Concepts`, `## Tech Stack`, `## Core Workflows` com `### N. <nome>` | ≥1 workflow numerado; ≥1 key concept; stack com versões reais decididas na entrevista |
| `user-stories.md` | `**User Types:**`, áreas `## N.`, stories `### US-N.M:`, `## Appendix: User Story Status` | Toda story tem `**As a**`, `**Acceptance Criteria:**` e `**Expected Result:**`; IDs do corpo == IDs do apêndice; todo workflow coberto ou excluído com motivo |
| `database-schema.md` | `## Schema`, `## Relationships`, `## Lookup Table Seeds`, `## Notes & Conventions` | Todo `ref` aponta para entidade/campo real; todo key concept vira entidade ou tem exclusão registrada |
| `project-phases.md` | conforme §5 | os 14 invariantes do contrato |

### 6.3 Diretrizes de domínio que o escritor recebe

Herdadas do beer-and-code por serem decisões de qualidade comprovadas, não estilo:

- Aplicar as convenções do framework/ORM decidido na entrevista; nunca misturar convenções de duas stacks.
- **Proibido campo enum/string para conjunto de valores predefinidos** — sempre tabela de lookup com FK (`status_id` → `statuses`), com seeds declarados.
- Upload de arquivo: coluna string com sufixo `_path`; múltiplos arquivos, tabela relacionada.
- **Fundação primeiro**: dados → modelos relacionalmente completos → fundação de frontend → só então os fluxos.
- **Modelos saem da fundação com todos os relacionamentos já ligados.** Nunca adiar relacionamento para a fase da feature.
- **Dimensionamento de fase**: uma fase (pai + sub-fases) = uma sessão de agente, ~10–15 tasks. Acima disso, dividir em mais fases de topo. Mais fases bem escopadas é sempre melhor que poucas fases grandes.

---

## 7. Motor de entrevista

### 7.1 Ciclo, por fase documental

```
inventário determinístico (o que dá para descobrir sem perguntar)
        ↓
modelo levanta o LOTE de perguntas materiais (chamada estruturada)
        ↓
TUI apresenta UMA pergunta por vez
        ↓
classificação da resposta
        ↓
ACCEPTED? → próxima pergunta    PARTIAL/AMBIGUOUS? → repergunta estreita
        ↓
sem gap material restante → escrita do documento
```

### 7.2 Regra de decisão de pergunta

Perguntar **somente** quando as quatro condições forem verdadeiras:

1. Nem o prompt nem o repositório respondem com segurança;
2. Existem ≥2 respostas plausíveis;
3. A escolha afeta comportamento observável, escopo, contrato, segurança, dados ou arquitetura;
4. Errar a suposição gera retrabalho ou risco relevante.

Nunca perguntar sobre comando, caminho, dependência ou convenção descobrível. Registrar
suposição explícita de baixo risco em vez de perguntar.

### 7.3 Forma da pergunta

Toda pergunta carrega: evidência já encontrada · a decisão que falta · por que importa ·
2–4 opções concretas quando couber · a opção recomendada com justificativa · a consequência
das alternativas.

### 7.4 Classificação da resposta

| Disposição | Significado | Ação |
|---|---|---|
| `ACCEPTED` | Uma única interpretação material, responde o que foi perguntado | Vira conhecimento confirmado |
| `PARTIAL` | Resolve parte, deixa fronteira/ator/gatilho/falha em aberto | Repergunta estreita sobre a parte aberta |
| `AMBIGUOUS` | ≥2 interpretações materialmente diferentes | Expõe as interpretações e pede escolha |
| `DEFERRED` | "não sei", "decido depois" | Vira suposição explícita ou `[NEEDS DECISION]` |
| `CONTRADICTED` | Conflita com evidência ou com outra resposta aceita | Preserva ambas e pergunta qual vale |

**Somente `ACCEPTED` vira decisão confirmada.** `use as recomendações` aceita o que foi
mostrado; `não sei` e `depois` permanecem `DEFERRED` e nunca confirmam uma recomendação
por implicação.

### 7.5 Proibições do normalizador

Não adicionar precisão que a resposta não deu: nada de quantificadores, números, defaults,
atores, plataformas, comportamento de falha ou exceções inventados. Termos como `adequado`,
`suportado`, `rápido`, `seguro`, `conforme necessário` podem aparecer como prosa, mas nunca
definem regra de domínio ou critério de aceitação sem significado observável.

Quando a resposta invoca um padrão/protocolo/formato externo, não aceitar "padrão" ou "onde
for válido" como fronteira: pedir versão/autoridade exata ou apresentar uma matriz normalizada
concreta para aprovação.

### 7.6 Auditoria pré-escrita

Antes de escrever qualquer documento, auditar toda afirmação material:
rastreia para evidência ou resposta `ACCEPTED`? tem interpretação única para
sujeito/gatilho/resultado/fronteira? a normalização é mais forte que a fonte? toda
alternativa não resolvida virou pergunta, suposição ou `[NEEDS DECISION]`?

### 7.7 Persistência

Toda resposta crua, decisão normalizada, disposição e incerteza restante vão para
`.capivara/handoffs/<run-id>.json` **antes** da próxima rodada. Ctrl+C não perde entrevista.

---

## 8. Motor de auditoria documental

### 8.1 Posição no fluxo

```
escritor produz o documento
        ↓
self-check mecânico (função pura, custo zero)  ── vermelho ──► devolve ao escritor
        ↓ verde
auditor (sessão nova, read-only, modelo separado)
        ↓
APPROVED → próximo documento     REJECTED → devolve ao escritor com motivo + orientação
```

O self-check mecânico roda **antes** do auditor de propósito: erro de forma não deve custar
uma chamada de modelo.

### 8.2 Protocolo de saída do auditor

Texto plano, cada chave na primeira coluna, sem markdown, sem cerca de código:

```
CAPIVARA_AUDIT_STATUS: APPROVED
CAPIVARA_FINDING: <seção/ID> | <o que está errado> | <como corrigir>
CAPIVARA_REMARK: <seção/ID> | <observação não bloqueante>
CAPIVARA_REASON: <uma linha baseada em evidência>
```

Regras:

- `REJECTED` exige ≥1 `CAPIVARA_FINDING`.
- **Todo finding tem obrigatoriamente o terceiro campo — a orientação de correção.** Finding sem orientação é saída inválida e repete só o auditor, sem consumir devolução do escritor.
- `APPROVED` não admite finding, mas admite `CAPIVARA_REMARK`.
- Saída estruturalmente inválida repete apenas o auditor sobre a mesma evidência.

**Regra da dúvida (simétrica à do verificador):** o auditor só rejeita com defeito material
que ele consiga demonstrar citando seção/ID e evidência. Dúvida de gosto, preferência ou
risco menor **nunca** é rejeição — vira `CAPIVARA_REMARK`, que não bloqueia e aparece no
relatório final do `init`. **Na dúvida, aprova e ressalva.** A assimetria com o verificador
(que na dúvida reprova) é deliberada: reprovar código custa um ciclo de correção barato e
verificável, enquanto reprovar documentação custa uma devolução de um teto de três e pode
travar o `init` numa discordância que não muda o resultado.

### 8.3 Os três eixos da auditoria

1. **Fidelidade** — o documento reflete o prompt + as respostas `ACCEPTED`? Alguma feature foi inventada? Alguma decisão confirmada foi ignorada ou enfraquecida?
2. **Conformidade** — a forma bate com o contrato da fase documental?
3. **Executabilidade** — *(só no `project-phases.md`)* um agente iniciado sem nenhum contexto de conversa consegue implementar cada fase lendo apenas os documentos citados? Alguma fase excede uma sessão? Algum critério é vago a ponto de o verificador não conseguir decidir DONE/INCOMPLETE?

### 8.4 Teto e escape (D-20)

Default 3 devoluções por documento, configurável por `--max-audit-returns`. Esgotado o teto,
o `init` **para e pergunta ao usuário**, mostrando lado a lado o que o auditor rejeita e o que
o escritor insiste em fazer. Na prática, isso é quase sempre um gap de entrevista disfarçado
de desacordo — e uma resposta sua resolve.

### 8.5 Por que o auditor não escreve

O auditor nunca corrige o documento. Se corrigisse, seria escritor e auditor ao mesmo tempo,
e a independência do veredito acabaria. Ele descreve o defeito e a correção; quem aplica é
o escritor, em sessão nova.

### 8.6 Correções do incidente cron5

O encaminhamento das emendas reconhece `Phase N`, `Fase N`, subfases e endereços
`PN.TN.CN`, em todos os campos do finding, inclusive a orientação de correção.
As referências são lidas pelo módulo de contrato. Quando não há fase identificável,
permanece o fallback de revisar todas as fases; referências fora do plano são ignoradas.

No impasse, o comando `reiniciar` abre um novo ciclo de correção e auditoria do
documento atual, com os mesmos tetos configurados. Preserva entrevista, esqueleto
e plano em trabalho. É controle de execução, nunca uma decisão de produto ou
permissão para publicar com rejeições. Cada novo ciclo exige esse comando explícito;
se esgotar o teto outra vez, pergunta novamente. Os números de tentativa continuam
crescendo para preservar os logs anteriores. `publicar`, `abortar` e decisões
substantivas mantêm o comportamento existente.

---

## 9. `capivara init` — máquina de estados

```
splash
  ↓
preflight  ─ pasta, providers, credenciais, escrita
  ↓
resolve prompt  ─ texto, @arquivo ou --file; hash da fonte
  ↓
inventário determinístico (limitado e sem segredos)
  ↓
┌─ para cada documento da cadeia (1→4) ──────────────────────────┐
│  entrevista da fase (§7)                                        │
│      ↓                                                          │
│  checkpoint: resumo normalizado com decisões / suposições /     │
│              adiamentos / ambiguidade restante → confirmação    │
│      ↓                                                          │
│  escrita em PARTES limitadas                                    │
│      · docs 1–3: uma parte por seção                            │
│      · doc 4: UMA PARTE POR FASE (nunca um intervalo de fases)  │
│      ↓                                                          │
│  materialização em staging (nunca direto na árvore final)       │
│      ↓                                                          │
│  self-check mecânico ──vermelho──► reparo estrutural (máx. 1)   │
│      ↓ verde                                                    │
│  auditor (§8) ──REJECTED──► escritor com motivo + orientação    │
│      ↓ APPROVED                                                 │
│  publicação atômica + stamp de inputs                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
gate RALPH READY (§10)
  ↓
relatório final
```

### 9.1 Escrita em partes — regra dura

Herdada de `ajuste_harness.md` e de `harness-generator.ts:110`:

> **No `project-phases.md`, uma parte escreve exatamente uma fase.**
> Uma parte nomeada por intervalo (`phases-p01-p04`) estoura o limite e o run morre ali.

Antes de escrever qualquer parte, o escritor aloca no *ledger de coordenação* a lista final
de fases e o propósito de cada parte. Cada chamada recebe: o ledger, os documentos upstream,
as decisões confirmadas e **apenas a fase que ela escreve**.

### 9.2 Reparo estrutural

Uma única tentativa, e só para defeito de **representação** (cerca de código envolvendo o
documento inteiro, stamp desatualizado, heading com nível errado). Defeito de **substância**
(caminho de documento errado, fase faltando, cobertura incompleta) nunca vai para o reparo:
vai direto para o escritor com o finding, porque o reparo estruturalmente não pode consertar.

### 9.3 Publicação atômica

Nada é escrito em `.capivara/init/` antes de o documento passar em tudo. Escrita em staging,
validação, e só então `rename` atômico. Interrupção no meio nunca deixa documento parcial na
árvore final.

---

## 10. Gate RALPH READY

O `init` só declara `RALPH READY` quando **todas** as condições abaixo são verdadeiras:

- [ ] Os 4 documentos existem e estão publicados
- [ ] Os 3 stamps de input estão frescos (cadeia inteira consistente)
- [ ] `parsePhases()` retorna zero erros
- [ ] Os 14 invariantes do contrato passam, inclusive as 3 coberturas (stories, entidades, workflows)
- [ ] Nenhum `[NEEDS DECISION]` em nenhum dos 4 documentos
- [ ] Os 4 auditores retornaram `APPROVED`
- [ ] Toda pergunta material foi `ACCEPTED`, ou virou suposição explícita de baixo risco registrada
- [ ] Todo `**Design ref:**` aponta para arquivo existente

Qualquer item falso → o `init` termina em estado `NOT READY`, **retomável**, listando exatamente
o que falta e o que fazer. Nunca "quase pronto".

O relatório final imprime: caminhos escritos · contagem de fases e tasks · as 3 tabelas de
cobertura · a linha de corte do MVP · disposições das respostas · suposições assumidas ·
custo e tempo por papel.

---

## 11. `capivara build` — o loop

### 11.1 Preflight (antes de qualquer gasto com modelo)

1. `parsePhases()` no `project-phases.md` — **mesmo módulo do `init`**. Erro aqui aborta sem chamar modelo.
2. Verifica frescor dos stamps; documento stale gera aviso alto, não bloqueio.
3. Resolve o comando de teste (D-15).
4. Git: se houver repo, exige árvore limpa; se não houver, avisa que não haverá commits (D-14).
5. Verifica provider/credencial dos papéis executor e verificador.
6. Recorta as fases para `.capivara/runs/<run-id>/phases/`.

### 11.2 Ciclo por fase

```
para cada fase pendente:
  ciclo = 1
  enquanto ciclo <= max-cycles (default 3):
      assinatura da árvore ANTES
      sessão NOVA do executor  (ciclo 1: prompt de implementação
                                ciclo >1: prompt de correção com a CAUSA REAL)
      G0 engine terminou de verdade?        ──não──► causa = saída real do engine
      G1 a árvore mudou?  (SINAL, não veredito)
      G2 suíte do projeto, rodada PELO LOOP ──não──► causa = saída real da suíte
      G3 verificador independente task a task ──não──► causa = linhas INCOMPLETE
      todos verdes:
          árvore suja  → commit `feat(phase-N): <título>` → fase concluída
          árvore limpa → fase JÁ ESTAVA implementada em HEAD → concluída sem commit
      ciclo++
  esgotou → PARA, retomável, imprime a causa e os logs (D-19)
```

### 11.3 Detalhamento dos gates

**G0 — o engine concluiu**
Por engine: no `claude`, exige evento de resultado no JSON e ausência de `is_error: true`;
no `codex` e no `opencode`, exit code real. Sessão que morre no meio nunca é tratada como sucesso.

**G1 — a sessão escreveu código (sinal, não veredito)**
Assinatura da árvore = hash de (status porcelain + diff de HEAD + conteúdo dos não rastreados).
Sem repo git, assinatura por varredura de arquivos com as mesmas exclusões.
**Não reprova sozinho**: uma fase já implementada faz o engine corretamente não escrever nada.
O sinal alimenta a causa do ciclo de correção quando um gate posterior reprova, e força o G3.

**G2 — suíte do projeto, fora da sessão do agente**
Rodada pelo loop, com o comando exato que foi informado ao agente no preâmbulo do prompt.
Sem comando resolvido, é pulado com aviso alto. Vermelho → causa = as últimas ~200 linhas
reais da saída, nunca "os testes falharam".

**G3 — verificador independente (D-22)**
Sessão nova, modelo separado (default mais barato), read-only + comandos que não alteram nada.
Proibido escrever, editar, commitar. Para cada task `- [ ]`/`- [x]` da fase, na ordem, confere
os critérios de aceitação contra o código real e emite exatamente uma linha:

```
TASK <n>: DONE
TASK <n>: INCOMPLETE — <o que falta>
```

Reprovação do gate quando: nenhuma linha emitida · cobertura parcial (n emitidas ≠ n esperadas) ·
qualquer `INCOMPLETE`. Código ausente, TODO, placeholder ou teste faltando ⇒ `INCOMPLETE`.
Na dúvida, `INCOMPLETE`.

### 11.4 Prompts — sempre auto-contidos

Nenhuma sessão é reutilizada. Todo prompt carrega:

1. **Preâmbulo de descoberta** — "este projeto pode ser de qualquer linguagem; não assuma stack. Leia, nesta ordem: `CAPIVARA.md`/`AGENTS.md` → `project-description.md` → `user-stories.md` → `database-schema.md` → os documentos citados pela própria fase".
2. **Comando de teste do projeto**, com a instrução explícita de usar aquele e nenhum outro runner. (Sem isso, o agente vê verde rodando um comando e o G2 vê vermelho rodando outro.)
3. **A fase inteira**, recortada pelo contrato.
4. **No ciclo de correção**: a causa real do gate vermelho, entre cercas, e a instrução de corrigir *apenas o que falta*, sem reimplementar o que já está correto e testado.

### 11.5 Limite de uso do provider

Detectado no **fim** do log (olhar o log inteiro faz saída de teste com "429" disparar espera
falsa). Ao detectar: espera até o reset + buffer e **repete a mesma fase sem consumir ciclo
de correção**. Teto de esperas consecutivas por fase, default 20.

### 11.6 Códigos de saída

| Código | Significado |
|---:|---|
| 0 | Todas as fases verdes — aplicação entregue |
| 1 | Erro de contrato, configuração, preflight ou falha terminal |
| 2 | Run pausado e **retomável** (fase travada, limite esgotado, Ctrl+C) |

---

## 12. Camada de providers

### 12.1 Os 4 papéis (D-13)

| Papel | Precisa | Permissão | Default sugerido |
|---|---|---|---|
| `writer` | ler o projeto, devolver texto | read-only | modelo principal, effort médio |
| `auditor` | ler documentos e projeto, devolver texto | read-only | modelo mais barato |
| `builder` | escrever arquivos, rodar comandos | workspace-write | modelo principal, **CLI obrigatória** (D-21) |
| `verifier` | ler e rodar comandos read-only | read-only + shell read-only | modelo mais barato |

Flags: `--writer-provider/model/effort/credential` e equivalentes para os outros três;
`--provider/--model/--effort` funcionam como fallback global para os papéis não configurados.

### 12.2 Invocação das CLIs instaladas

| Provider | Papéis read-only | Papel builder |
|---|---|---|
| `codex` | `codex exec --cd <root> --skip-git-repo-check --color never --sandbox read-only [--model M] [-c model_reasoning_effort="E"] -` | idem com `--sandbox workspace-write` |
| `claude` | `claude -p --output-format json --permission-mode plan [--model M] [--effort E]` | `--permission-mode acceptEdits` |
| `opencode` | `opencode run --dir <root> --format json [--model M] [--variant E]` + `OPENCODE_PERMISSION` negando edit/bash/task | permissões de escrita liberadas |

Prompt sempre por **stdin**. Nunca por argumento (vaza em `ps`, estoura limite de argv).
Sem `rb-codex`, sem binário vendorizado: só o `codex` do PATH, com override por
`CAPIVARA_CODEX_BIN` para quem precisar apontar outro caminho.

### 12.3 APIs diretas

`openai`, `anthropic`, `gemini`, `deepseek`, `minimax`, `openrouter` — disponíveis para
`writer`, `auditor` e `verifier`. Dialetos: `openai-chat` e `anthropic-messages`.

Ponto crítico herdado como lição: **raciocínio é um modo separado e caro**. A ausência de
`--effort` não pode herdar o default do provider — já houve run em que o modelo gastou toda
a cota de saída em `reasoning_content` sem emitir documento nenhum. O registro declara, por
provider: modo default, token que desliga raciocínio, e a escala de intensidade. Sem `--effort`,
o default é **desligado**.

### 12.4 Credenciais

Store local com permissão restrita, `capivara login` interativo, seleção por id ou label,
credencial default por provider. A chave nunca aparece no terminal, em argumentos, em logs
ou em arquivos de perfil. Toda saída de log passa por redator que substitui segredos por
`[REDACTED:<NOME>]`.

### 12.5 Adapter custom

Escotilha de escape: executável que recebe o prompt em stdin, trabalha no diretório do projeto
e devolve exit code real. Recebe as mesmas variáveis de ambiente que os papéis nativos.

### 12.6 Supervisão de processo

Três timeouts distintos: `first-output` (nenhum byte inicial), `idle` (sem saída nem atividade)
e `wall` (tempo total). Em timeout, o **grupo de processos inteiro** recebe `SIGTERM` e depois
`SIGKILL`. Ctrl+C jamais pode deixar um provider órfão consumindo recursos — foi um sintoma
real documentado no PRD do rb-harness.

---

## 13. TUI (D-08)

ANSI própria, sem framework. Quatro superfícies:

**Splash + mascote** — abertura com a capivara, versão e papéis configurados. `--no-splash` desliga.

**Entrevista** — uma pergunta por tela: evidência → decisão que falta → por que importa →
opções numeradas com a recomendada marcada → consequências. Aceita número, texto livre,
`use as recomendações`, `não sei`, `voltar`. Mostra progresso (`documento 2/4 · pergunta 3`).

**Dashboard ao vivo** — estágio atual, documento/fase, tentativa/ciclo, papel e modelo em uso,
bytes recebidos, tempo até o primeiro byte, tokens e custo acumulados por papel, e as últimas
linhas de atividade. No `build`, mostra a grade de fases com o estado de cada gate.

O cabeçalho é compacto: mascote proporcional, centralizado no painel, título à esquerda
quando houver espaço. Largura **e altura** são medidas a cada desenho. Em telas baixas,
reduzir primeiro o histórico e a janela de fases, depois a decoração; preservar a atividade
atual e a fase corrente. Nenhuma linha ultrapassa a largura disponível. A pergunta mantém
seu conteúdo completo e, quando não couber na tela, vira saída estática durante a resposta.

**Wizard** — montagem interativa do comando: provider e modelo por papel, effort, credencial,
opções do loop. Ao final imprime o comando equivalente, para você copiar e nunca mais precisar
do wizard.

Regra transversal: **todo texto de interface e todo documento gerado no idioma do prompt inicial**.
IDs, marcadores de contrato e chaves de máquina ficam em inglês.

---

## 14. Estado durável e retomada (D-07)

Cada run tem id estável e diretório próprio. O que é persistido **antes** de cada passo caro:

- `run.json` — estágio, documento/fase corrente, ciclo, papéis resolvidos, hashes das fontes
- `events.tsv` — linha por transição, apenas append
- `prompts/` e `logs/` — tudo que foi enviado e recebido, auditável
- `audits/` — veredito e findings de cada auditoria
- `handoffs/` — a entrevista

Lock em `.capivara/runs/<run-id>/.lock/`. Antes de recuperar um lock existente, verifica se
o processo dono ainda está vivo; se estiver, a nova execução falha; se não, o lock é movido
para quarentena e um novo é adquirido.

Na retomada: documentos publicados e aprovados são reaproveitados; fases já verdes não são
reexecutadas; a entrevista continua da pergunta em aberto; queda de energia não apaga eventos,
logs ou auditorias.

---

## 15. Telemetria e orçamento

Por chamada: papel, provider, modelo, effort, tokens de entrada/saída/cache, duração, exit code.
Custo estimado por tabela de preços opcional — **ausência de medição é registrada como
"não medido", nunca como zero**.

Tetos configuráveis, todos com default: ciclos de correção por fase (3), devoluções do auditor
por documento (3), rodadas de entrevista por documento, esperas por limite de uso (20),
tamanho máximo de prompt, e timeouts por papel. Atingir um teto **nunca** gera mais gasto:
gera checkpoint retomável com diagnóstico.

---

## 16. Estrutura do repositório

```
capivara/
├── package.json                 # workspaces
├── packages/core/
│   ├── package.json             # bin: capivara → dist/cli.js; dep única: commander
│   ├── src/
│   │   ├── cli.ts               # entrypoint
│   │   ├── cli-program.ts       # definição de comandos e flags
│   │   ├── contract/
│   │   │   ├── phases.ts        # ★ parser + invariantes — AUTORIDADE ÚNICA
│   │   │   ├── documents.ts     # forma dos 3 documentos upstream
│   │   │   ├── stamps.ts        # sha256 de inputs, frescor
│   │   │   └── coverage.ts      # as 3 coberturas
│   │   ├── interview/           # levantamento, apresentação, classificação, persistência
│   │   ├── authoring/           # ledger de partes, escrita limitada, staging, publicação
│   │   ├── audit/               # protocolo, parse do veredito, findings
│   │   ├── loop/
│   │   │   ├── split.ts         # consome contract/phases.ts — sem regex própria
│   │   │   ├── gates.ts         # G0..G3
│   │   │   ├── prompts.ts       # preâmbulo, implementação, correção, verificação
│   │   │   ├── testcmd.ts       # detecção por manifest
│   │   │   └── git.ts           # assinatura da árvore, commit por fase
│   │   ├── provider/            # registry, cli adapters, api dialects, credenciais, supervisor
│   │   ├── tui/                 # splash, dashboard, entrevista, wizard
│   │   ├── state/               # run store, eventos, lock, retomada
│   │   └── telemetry/
│   └── test/
├── docs/
│   └── capivara-phases-v1.md    # GERADO a partir de contract/phases.ts
└── scripts/
```

---

## 17. Plano de implementação

Fundação primeiro, depois os fluxos. Cada fase abaixo é dimensionada para uma sessão de
trabalho coerente. As fases 1–3 não gastam um único token de modelo — são o esqueleto
determinístico que torna todo o resto verificável.

### Phase 1: Fundação — projeto, contrato e invariantes

**Goal:** O contrato existe como código executável e testado, antes de qualquer integração.

- [ ] **Task:** Esqueleto do repositório — workspace, `packages/core`, TypeScript ESM estrito, build esbuild, vitest, `bin: capivara`, com as versões e o `engines.node` do §21.3
  - **Acceptance criteria:** `npm run build` produz `dist/cli.js` executável; `capivara --version` imprime a versão; `npm test` roda com zero testes e sai 0; `commander` é a única entrada de `dependencies` e um teste falha se outra for adicionada
- [ ] **Task:** `contract/phases.ts` — parser puro de `capivara-phases/v1`
  - **Acceptance criteria:** Retorna árvore tipada (fases, sub-fases, tasks, critérios, traces, design refs) ou lista de erros com linha e coluna; nunca lança para entrada malformada
- [ ] **Task:** Os 14 invariantes (I-01..I-14) como validadores independentes
  - **Acceptance criteria:** Cada invariante tem teste positivo e negativo; a mensagem de erro diz o que fazer, não só o que está errado
- [ ] **Task:** `contract/stamps.ts` e `contract/coverage.ts`
  - **Acceptance criteria:** Stamp calculado e verificado sobre bytes reais; as 3 coberturas apontam o item exato não coberto
- [ ] **Task:** Gerador de `docs/capivara-phases-v1.md` a partir do módulo
  - **Acceptance criteria:** Um teste falha se o documento estiver dessincronizado do código
- [ ] **Task:** Teste de arquitetura: nenhuma regex de fase fora de `contract/`
  - **Acceptance criteria:** Varredura do `src/` falha se `## Phase` ou `- [ ]` aparecer como regex em qualquer módulo fora de `contract/`

### Phase 2: Fundação — estado durável, lock e retomada

**Goal:** Nenhuma interrupção perde trabalho pago.

- [ ] **Task:** Run store (`run.json`, `events.tsv`) com escrita atômica
  - **Acceptance criteria:** Kill -9 no meio de qualquer escrita nunca deixa arquivo parcial ou inválido
- [ ] **Task:** Lock com verificação de processo vivo e quarentena
  - **Acceptance criteria:** Lock órfão é recuperado; lock com dono vivo faz a segunda execução falhar com mensagem clara
- [ ] **Task:** Retomada — reconstrução do estágio a partir de eventos
  - **Acceptance criteria:** Interromper em qualquer estágio e reexecutar continua do ponto exato, sem repetir trabalho aprovado

### Phase 3: Fundação — camada de providers e supervisão

**Goal:** Chamar qualquer modelo, com timeout real e sem vazar segredo.

- [ ] **Task:** Registry dos 4 papéis, com resolução provider/modelo/effort/credencial e fallback global
  - **Acceptance criteria:** `capivara providers list` mostra os 10 providers e o estado de configuração de cada um
- [ ] **Task:** Adapters de CLI (`codex`, `claude`, `opencode`) com prompt por stdin e permissão por papel
  - **Acceptance criteria:** Papel read-only não consegue escrever arquivo nem com instrução explícita no prompt
- [ ] **Task:** Dialetos de API direta com o **default de raciocínio desligado**
  - **Acceptance criteria:** Sem `--effort`, nenhuma requisição habilita raciocínio; com `--effort`, o campo correto do dialeto é enviado
- [ ] **Task:** Credential store + `capivara login` + redator de segredos
  - **Acceptance criteria:** Nenhum segredo aparece em log, argumento ou dashboard; teste injeta chave e varre todas as saídas
- [ ] **Task:** Supervisor com os três timeouts e morte da árvore de processos
  - **Acceptance criteria:** Ctrl+C não deixa nenhum processo filho vivo; teste verifica ausência de órfãos

### Phase 4: Motor de entrevista

**Goal:** Fechar gaps de verdade, uma pergunta por vez, sem inventar precisão.

- [ ] **Task:** Levantamento em lote com saída estruturada
  - **Acceptance criteria:** Cada pergunta traz evidência, decisão faltante, motivo, opções e recomendação; pergunta sem esses campos é rejeitada antes de chegar à tela
- [ ] **Task:** Classificador de resposta (ACCEPTED/PARTIAL/AMBIGUOUS/DEFERRED/CONTRADICTED)
  - **Acceptance criteria:** `não sei` nunca vira confirmação de recomendação; resposta parcial gera repergunta estreita sobre a parte aberta
- [ ] **Task:** Rodadas focadas com condição de parada e teto
  - **Acceptance criteria:** Converge sem reabrir decisão já aceita; teto atingido gera `[NEEDS DECISION]`, não suposição silenciosa
- [ ] **Task:** Checkpoint normalizado + persistência em `handoffs/`
  - **Acceptance criteria:** O checkpoint separa decisões aceitas, suposições, adiamentos e ambiguidade restante; resposta crua sempre preservada

### Phase 5: Escrita documental em partes

**Goal:** Documento grande sem estouro de contexto.

- [ ] **Task:** Ledger de coordenação de partes
  - **Acceptance criteria:** No `project-phases.md`, a lista de fases e o propósito de cada parte são alocados antes da primeira escrita
- [ ] **Task:** Escritor por parte — **uma fase por parte**, proibido intervalo
  - **Acceptance criteria:** Parte nomeada por intervalo é rejeitada pelo próprio runtime, com diagnóstico
- [ ] **Task:** Staging + publicação atômica
  - **Acceptance criteria:** Nada chega a `.capivara/init/` antes de passar em tudo; interrupção nunca deixa documento parcial
- [ ] **Task:** Reparo estrutural único, limitado a defeito de representação
  - **Acceptance criteria:** Defeito de substância nunca entra no reparo — vai direto ao escritor com o finding

### Phase 6: Motor de auditoria

**Goal:** O revisor devolve com motivo **e** com a orientação de correção.

- [ ] **Task:** Protocolo `CAPIVARA_AUDIT_*` — emissão e parse tolerante a CRLF/espaços
  - **Acceptance criteria:** `REJECTED` sem finding, ou finding sem orientação, é saída inválida e repete só o auditor
- [ ] **Task:** Os 3 eixos (fidelidade, conformidade, executabilidade)
  - **Acceptance criteria:** O eixo de executabilidade só roda no `project-phases.md` e reprova fase que não cabe numa sessão
- [ ] **Task:** Ciclo de devolução com teto configurável e escape para pergunta
  - **Acceptance criteria:** Esgotado o teto, o terminal mostra lado a lado a rejeição e a insistência do escritor, e pede uma decisão

### Phase 7: Comando `init` ponta a ponta

**Goal:** Prompt livre vira 4 documentos aprovados.

- [ ] **Task:** Resolução do prompt (texto, `@arquivo`, `--file`) com hash da fonte
- [ ] **Task:** Inventário determinístico limitado, sem segredos
- [ ] **Task:** Orquestração da cadeia 1→4, com stamps e frescor
- [ ] **Task:** Gate RALPH READY com os 8 itens do checklist
  - **Acceptance criteria:** Um único item falso produz `NOT READY` retomável listando exatamente o que falta; nunca "quase pronto"
- [ ] **Task:** Relatório final
  - **Acceptance criteria:** Imprime caminhos, fases/tasks, as 3 coberturas, corte do MVP, disposições, suposições, custo e tempo por papel

### Phase 8: Loop — preflight, divisão e prompts

**Goal:** O loop enxerga exatamente o que o `init` validou.

- [ ] **Task:** Preflight do `build` — mesmo parser, sem gastar modelo em documento inválido
  - **Acceptance criteria:** Documento que falha no parser aborta antes de qualquer chamada de provider
- [ ] **Task:** Divisor de fases consumindo `contract/phases.ts`
  - **Acceptance criteria:** Uma fase = um arquivo = uma sessão; sub-fases acompanham a fase pai
- [ ] **Task:** Detecção do comando de teste por manifest, redetectada a cada fase
  - **Acceptance criteria:** Sem comando resolvido, aviso alto e G2 pulado — nunca erro silencioso
- [ ] **Task:** Construtores de prompt (implementação, correção, verificação)
  - **Acceptance criteria:** Todo prompt é auto-contido e declara o comando de teste exato; o de correção carrega a causa real, nunca mensagem genérica

### Phase 9: Loop — os 4 gates

**Goal:** Fase só fecha por prova mecânica.

- [ ] **Task:** G0 por engine
- [ ] **Task:** G1 assinatura da árvore, com e sem git — **sinal, não veredito**
  - **Acceptance criteria:** Fase já implementada, com sessão que não escreve nada, é aprovada pelos gates 2 e 3 e marcada como concluída sem commit
- [ ] **Task:** G2 suíte rodada pelo loop, fora da sessão, com stdin fechado
  - **Acceptance criteria:** Causa da falha carrega a saída real da suíte
- [ ] **Task:** G3 verificador read-only + shell read-only, task a task
  - **Acceptance criteria:** Cobertura parcial reprova; `INCOMPLETE` reprova; ausência de linhas reprova; tentativa de escrita do verificador invalida a tentativa
- [ ] **Task:** Ciclos de correção e parada retomável
- [ ] **Task:** Commit por fase verde com árvore suja; sem git, apenas registro
- [ ] **Task:** Detecção de limite de uso no fim do log, com espera e repetição sem consumir ciclo
  - **Acceptance criteria:** Saída de teste contendo "429" não dispara espera

### Phase 10: TUI e wizard

- [ ] **Task:** Splash + mascote, com `--no-splash`
- [ ] **Task:** Tela de entrevista, uma pergunta por vez, com progresso e `voltar`
- [ ] **Task:** Dashboard ao vivo para `init` e `build`, com grade de gates
- [ ] **Task:** Wizard que imprime o comando equivalente ao final
- [ ] **Task:** Idioma da interface espelhando o idioma do prompt inicial

### Phase 11: Validação de ponta a ponta

**Goal:** Provar a tese do projeto com números.

- [ ] **Task:** Provider falso determinístico para testes de integração
  - **Acceptance criteria:** Todo o `init` e todo o `build` rodam em CI sem tocar um modelo real
- [ ] **Task:** Três projetos-piloto reais (um com banco + UI, um CLI sem persistência, um serviço HTTP)
  - **Acceptance criteria:** Os três chegam a RALPH READY e o `build` entrega aplicação com suíte verde, sem intervenção manual entre as fases
- [ ] **Task:** Métricas comparativas registradas
  - **Acceptance criteria:** Tempo e custo por piloto anotados, para comparar com a linha de base (rb-harness >31min/US$1,84; dsh ~10min/US$0,20)

### Phase 12: Empacotamento

- [ ] **Task:** Instalação standalone (`npm install --global --prefix ~/.local`)
  - **Acceptance criteria:** Binário `capivara` no PATH, sem colidir com `rb-harness` e `rb-ralph` já instalados
- [ ] **Task:** README no idioma do projeto e `CAPIVARA.md` de exemplo
- [ ] **Task:** `capivara doctor` — diagnostica CLIs instaladas, credenciais, git, comando de teste

---

## 18. Estratégia de testes do próprio `capivara`

| Camada | Como é testada |
|---|---|
| Contrato | Teste de propriedade: documento gerado aleatoriamente dentro da gramática sempre faz round-trip parse→serialize→parse |
| Contrato ↔ loop | Teste de integração que prova que `init` e `build` chegam à mesma árvore de fases para o mesmo arquivo |
| Arquitetura | Varredura que falha se qualquer módulo fora de `contract/` contiver regex de fase |
| Providers | Adapter falso + verificação de que papel read-only não escreve |
| Gates | Repositório temporário com casos plantados: fase já implementada, suíte vermelha, verificador com cobertura parcial |
| Segredos | Injeção de chave e varredura de toda saída |
| Ponta a ponta | Provider determinístico em CI + os 3 pilotos reais, manuais |

---

## 19. Riscos e mitigações

| Risco | Como o plano neutraliza |
|---|---|
| O contrato volta a crescer e a divergir | Regra I-03 do §3: todo campo novo precisa responder "qual decisão do loop quebra sem ele?". Teste de arquitetura impede parser paralelo |
| O escritor estoura contexto no `project-phases.md` | Uma parte = uma fase, validado pelo runtime, não pela disciplina do modelo |
| O auditor entra em desacordo infinito com o escritor | Teto configurável (default 3) e escape que devolve a decisão para você |
| Executor toca arquivo que não pode | `.capivara/runs/` é plano de controle; `.capivara/init/` é leitura. Papel read-only tem sandbox do provider, não só instrução no prompt |
| Fase 1 greenfield sem suíte de testes | G2 pulado com aviso; G3 segura sozinho. A fundação normalmente cria o runner na primeira fase |
| Custo alto como no rb-harness | Auditor e verificador em modelo barato; self-check mecânico antes do auditor; raciocínio desligado por default; telemetria por papel no dashboard |
| Provider órfão após Ctrl+C | Supervisor mata a árvore de processos; teste de ausência de órfãos |
| Documento gerado com o upstream já alterado | Stamp de inputs na linha 3, verificado no `init` e avisado no `build` |
| O verificador aprova código que existe e não funciona | G2 roda a suíte de verdade, e o verificador tem shell read-only para confirmar comportamento (D-22) |

---

## 20. Fora de escopo da primeira entrega

- Comandos `plan`, `evolve`, `review`, `ai-context` — a arquitetura prevê o encaixe (cada um é uma cadeia documental própria terminando num `project-phases.md` compatível com o mesmo contrato), mas nenhum entra no dia 1.
- `init` em projeto existente (D-12). O inventário já é escrito de forma a suportar isso depois.
- Executor via API direta com tool loop próprio (D-21).
- Paralelismo entre tasks, worktrees isoladas e integração de patches.
- Aceitação operacional em ambiente limpo (o `OPERATIONS.json` do rb-ralph) — descartada em D-05.
- Validação visual com navegador real para tasks de tela.
- Integração com memória externa.

---

## 21. Local, repositório e versões

### 21.1 Onde o projeto vive

```
/home/bruno/Documentos/Projetos/NovoHarness/capivara/     ← repositório git próprio
/home/bruno/Documentos/Projetos/NovoHarness/base_harness/ ← referências, fora do git
```

`NovoHarness/` permanece **sem git**. O repositório é a subpasta `capivara/`.

Motivos:

- Plano, referências e código na mesma árvore de trabalho: o agente implementador consulta o rb-harness e o beer-and-code sem sair do diretório.
- Repo apenas na subpasta evita versionar os `node_modules` dos projetos de referência.
- O binário `capivara` não colide com o `rb-harness` nem com o `rb-ralph` já instalados em `~/.local/bin`.

Descartado: `/home/bruno/Documentos/Projetos/IA/capivara/`. Já existem `capivara-harness` e
`capivara-harness-tui` naquela pasta, e um terceiro diretório `capivara` ao lado deles cria
ambiguidade de nome exatamente onde a leitura é rápida.

### 21.2 Conteúdo do primeiro commit

| Arquivo | Observação |
|---|---|
| `docs/PLANO.md` | **Este documento, movido** para dentro do repositório — não copiado |
| `.gitignore` | `node_modules/`, `dist/`, `*.tsbuildinfo`, `.capivara/runs/` |
| `CAPIVARA.md` | Índice de convenções na raiz, ainda mínimo |
| `package.json` + `packages/core/` | Esqueleto da Phase 1 |

**O plano é movido, não copiado.** Ele é a especificação do produto: precisa ser lido de
dentro do repositório pelo agente implementador e precisa estar versionado, para que toda
mudança de plano apareça no diff. Duas cópias divergem em silêncio — que é exatamente a
doença que este projeto existe para curar.

`CAPIVARA.md` existe desde o primeiro commit mesmo quase vazio: é o primeiro arquivo que o
preâmbulo de descoberta (§A.3.1) manda o executor ler.

### 21.3 Versões fixadas

Verificadas no registry em 2026-09-16. A máquina de desenvolvimento roda Node 25.1.0 / npm 11.6.2.

| Item | Versão | Motivo |
|---|---|---|
| `engines.node` | `>=22` | Node 20 chegou ao fim de vida em abril de 2026. `>=22` cobre as LTS vivas sem prender a ferramenta a uma linha sem patch de segurança |
| `commander` | `^15.0.0` | Atual |
| `esbuild` | `^0.28.2` | Atual; gera `dist/cli.js` |
| `vitest` | `^5.0.1` | Atual |
| `typescript` | `^7.0.2` | Atual (`latest`). Ver ressalva |
| `@types/node` | `^26.6.1` | **Nunca instalar via `@latest`.** Ver ressalva |

**Ressalva — TypeScript 7.** É o port nativo e está GA. O risco aqui é estruturalmente baixo:
o esbuild faz o bundle e o TypeScript só é usado para typecheck e emissão de `.d.ts`. Um caso
de borda do compilador novo não quebra o build do binário, e a saída é cair para `~6` sem
tocar em mais nada.

**Ressalva — `@types/node`.** A tag `latest` do pacote aponta para `22.20.3`, desatualizada em
quatro majors. A linha corrente sai pelas tags `ts5.9`/`ts6.0`, em `26.6.1`. Instalar
`@types/node@latest` entrega tipos antigos sem nenhum aviso, e o sintoma aparece depois, como
uma API do Node que "não existe". Pinar `^26.6.1` explicitamente, com comentário no
`package.json` registrando o motivo.

**Ressalva — o runtime de desenvolvimento é mais restrito que o publicado.**
`engines.node: ">=22"` descreve quem **usa** o `capivara`: o binário só carrega `commander`.
Quem **desenvolve** está preso à faixa do vitest 5 — `^22.12.0 || ^24.0.0 || >=26.0.0` —, que
exclui deliberadamente as linhas ímpares. A máquina de desenvolvimento rodava Node 25.1.0,
uma linha ímpar não-LTS, e foi migrada para **v26.9.0** em 2026-09-16
(`nvm install 26 && nvm alias default 26`; o `.bashrc` já fazia `nvm use default`).

Node 26 é a linha **Current**, ainda não promovida a LTS: em 2026-09-16 a Latest LTS era a
v24.21.0 (Krypton), que também satisfaz o vitest e é a escolha conservadora equivalente.
Não use Node 25 nem qualquer outra linha ímpar para desenvolver este projeto.

**Nota — `npm warn install-scripts` do esbuild.** A partir do npm 11.19 o postinstall de um
pacote exige aprovação explícita, e o do esbuild não roda. Ele **não precisa rodar**: o binário
vem da dependência opcional `@esbuild/linux-x64` e o postinstall é apenas validação —
`./node_modules/.bin/esbuild --version` responde normalmente. Não aprove o script e não
rebaixe o npm por causa desse aviso.

**Regra de dependência de runtime:** `commander` é a **única** entrada de `dependencies`.
Todo o resto é `devDependency`. Não é frugalidade estética — é o que mantém a instalação
standalone (`npm install --global --prefix "$HOME/.local"`) leve e auditável. Um teste de
arquitetura da Phase 1 falha se uma segunda dependência de runtime for adicionada.

### 21.4 Bootstrap

```bash
mkdir -p /home/bruno/Documentos/Projetos/NovoHarness/capivara
cd /home/bruno/Documentos/Projetos/NovoHarness/capivara
git init
mkdir -p docs packages/core/src packages/core/test
git mv ../PLANO-CAPIVARA.md docs/PLANO.md   # ou mv, se o plano ainda não estiver versionado
# .gitignore, CAPIVARA.md, package.json, packages/core/ — conforme a Phase 1
git add -A && git commit -m "chore: bootstrap do repositório com o plano como especificação"
```

A partir daí, **uma fase por sessão, contexto novo a cada uma, na ordem do §17**. As fases 1
a 3 não gastam token de modelo nenhum: são o esqueleto determinístico que torna todo o resto
verificável. O teste de arquitetura da Phase 1 — nenhuma regex de fase fora de `contract/` —
é o que protege a tese do projeto contra o próprio executor.

---

# Apêndice A — Prompts dos quatro papéis

Este apêndice é normativo: é o conteúdo que a implementação deve produzir, não uma sugestão.
Os blocos entre cercas são o texto literal a ser renderizado, com `{{...}}` como interpolação.

## A.0 Regra de idioma — transversal a todos os papéis

**Instrução em inglês, saída no idioma do usuário.** A separação não é entre "prompt" e
"resposta", é entre **máquina** e **humano**:

| Sempre em inglês (byte a byte) | Sempre no idioma do prompt inicial |
|---|---|
| As instruções que a ferramenta envia ao modelo | As perguntas da entrevista, suas opções, recomendações e consequências |
| Chaves de protocolo: `CAPIVARA_AUDIT_STATUS`, `CAPIVARA_FINDING`, `CAPIVARA_REMARK`, `CAPIVARA_REASON`, `TASK <n>: DONE`, `TASK <n>: INCOMPLETE` | A prosa de todos os documentos gerados |
| Rótulos estruturais dos documentos: `## Phase`, `- [ ] **Task:**`, `**Acceptance criteria:**`, `**Feature tests:**`, `**Design ref:**`, `**Traces:**`, `**Goal:**`, `**Depends on:**`, `**Covers:**`, `**Conventions:**` | Os títulos de fase, os critérios de aceitação, os findings e ressalvas exibidos |
| IDs e marcadores: `US-N.M`, o stamp `<!-- inputs: ... -->` | As mensagens de erro, os avisos e o relatório final |

> **As perguntas da entrevista são saída do modelo, não instrução da ferramenta.** A TUI
> apenas as apresenta. Portanto caem na coluna da direita: **em português**, sempre. Este
> era um defeito observado no rb-harness, onde a maioria das perguntas chegava em inglês.

O bloco abaixo é prefixado em **todos** os prompts de **todos** os papéis:

```
## Language
Every word the developer will read must be written in {{USER_LANGUAGE}}: interview questions,
their options, recommendations and consequences, all document prose, phase titles, acceptance
criteria, findings, remarks, reasons and error messages.

Keep these in English, byte for byte, and never translate them:
protocol keys (CAPIVARA_AUDIT_STATUS, CAPIVARA_FINDING, CAPIVARA_REMARK, CAPIVARA_REASON,
TASK <n>: DONE, TASK <n>: INCOMPLETE), structural labels (## Phase, ### Phase,
- [ ] **Task:**, **Acceptance criteria:**, **Feature tests:**, **Design ref:**, **Traces:**,
**Goal:**, **Depends on:**, **Covers:**, **Conventions:**), identifiers (US-N.M), and the
<!-- inputs: ... --> stamp.

A translated protocol key or structural label is an invalid response.
```

`{{USER_LANGUAGE}}` é resolvido uma única vez, do idioma do prompt inicial, e gravado no
`run.json`. Toda chamada posterior do run usa o valor gravado — o idioma nunca é
redetectado no meio de uma execução.

## A.1 Papel `writer` — moldura comum

Prefixada em todas as chamadas do escritor, depois do bloco de idioma:

```
You are a specification writer for the Capivara harness. You produce documentation only.
You never write application code, never run build or test commands, never install anything,
and never commit. You have no memory of any previous session.

## Authority order
1. The developer's original prompt, verbatim.
2. Interview answers whose disposition is ACCEPTED.
3. Upstream documents already published in this chain.
4. Evidence observed in the project directory.
Nothing else is authority. A DEFERRED, PARTIAL, AMBIGUOUS or CONTRADICTED answer is not a
decision and must not become confirmed prose.

## Hard rules
- Never invent a feature, actor, limit, number, platform, failure behaviour or compatibility
  promise that no authority above states. Missing information is an open question, never a
  default.
- Never weaken, narrow or drop a decision that an ACCEPTED answer states.
- Never add precision the source did not supply: no invented quantifiers, thresholds,
  defaults or exceptions.
- Words like "appropriate", "supported", "fast", "secure", "as needed", "when possible" and
  "etc." may appear as prose, but must never define a domain rule or an acceptance criterion.
- An unresolved material decision is written as `[NEEDS DECISION] <the open decision>` on its
  own line. Never hide it inside fluent prose.
- Never mention a provider, a model, an effort level, a CLI, a branch or commit strategy, or
  how many agents will implement the work. You do not know those and they are not yours.

## Output
Emit the raw bytes of the document body and nothing else. No preamble, no explanation, no
closing remark, and no markdown fence wrapping the whole document.
```

### A.1.1 Bloco de tarefa — `project-description.md`

```
## Your task
Write .capivara/init/project-description.md.

Required structure, exactly:

# <Project Name> — Project Description
## Overview            (2-4 paragraphs: what it is, who it serves, the core value, the MVP boundary)
### Key Concepts       (- **<Concept>:** <definition, including rules, limits and numbers>)
## Tech Stack          (table or grouped bullets; the stack DECIDED IN THE INTERVIEW, with real
                        versions; never a stack you chose yourself)
## Core Workflows      (### 1. <name>, ### 2. <name>, ... numbered, concrete, with rules and
                        edge cases; request/response examples in fenced blocks when the flow
                        is an API)
## Open Questions      (only when gaps remain; otherwise omit the section)

This document is the head of the chain and carries no input stamp.
Prefer specific numbers, limits and rules over vague description.
```

### A.1.2 Bloco de tarefa — `user-stories.md`

```
## Your task
Write .capivara/init/user-stories.md from the project description.

Line 3 must be the machine-owned input stamp, exactly:
<!-- inputs: project-description.md@sha256:{{SHA12_DESCRIPTION}} -->

Required structure, exactly:

# <Project Name> — User Stories
## Overview                        (what the product is, who it serves)
**User Types:**                    (- **<Persona>** - <one-line definition>)
## <N>. <Feature Area>
### US-<N>.<M>: <Short Title>
**As a** <persona>
**I want to** <capability>
**So that** <benefit>
**Acceptance Criteria:**           (- [ ] concrete, testable condition)
**Expected Result:** <end state when the story is done>
## Open Questions                  (optional, before the appendix)
## Appendix: User Story Status      (| ID | Story | Priority | Status | for EVERY story)

Rules:
- Every numbered workflow of the project description must be covered by at least one story,
  or explicitly excluded with the reason the developer gave. Never assume an exclusion.
- Acceptance criteria state limits, states and failure paths, with numbers where they exist.
- Story IDs are stable. The IDs in the body and in the appendix must be the same set.
```

### A.1.3 Bloco de tarefa — `database-schema.md`

```
## Your task
Write .capivara/init/database-schema.md from the project description and the user stories.

Line 3 must be the machine-owned input stamp, exactly:
<!-- inputs: project-description.md@sha256:{{SHA12_DESCRIPTION}} user-stories.md@sha256:{{SHA12_STORIES}} -->

This document always exists. It describes the project's REAL data model, whatever its shape:
database tables, files on disk, in-memory structures, or an input/output format. When the
project has no persistence, describe what it does have and say so plainly in the overview.

Required structure, exactly:

# <Project Name> — Database Schema
## Overview                  (the data model at a glance; conventions in force)
## Schema                    (DBML when there are tables; the equivalent formal description
                              otherwise. Lookup tables first, then domain, then pivots.)
## Relationships             (one plain-language line per relationship)
## Lookup Table Seeds        (for each lookup table, the concrete initial rows)
## Notes & Conventions       (soft deletes, pivots, indexes, denormalisation, traceability)
## Open Questions            (optional)

Domain rules — apply to any stack:
- Apply the naming and column conventions of the framework/ORM decided in the interview.
  Never mix conventions from two stacks in one schema.
- NEVER use an enum column or a string-based enum column. Any field holding a predefined set
  of values (status, type, category, priority, level, role) becomes a lookup table with a
  foreign key: `status_id` referencing `statuses`. Declare its seed rows.
- File uploads: store the path in a string column with a `_path` suffix. When a record can
  hold several files, create a related table with its own `file_path` column.
- Every ref points at a real entity and a real column. Every key concept becomes an entity or
  carries a recorded reason for not becoming one.
```

### A.1.4 Bloco de tarefa — `project-phases.md`

Duas chamadas distintas. **Primeiro o ledger**, depois **uma chamada por fase** (§9.1).

Chamada de ledger:

```
## Your task
Plan the whole build, but write NO phase yet.

Read the project description, the user stories, the data model, and — when the directory
.capivara/init/design/ exists — every design artifact in it.

Return only the coordination ledger as JSON:
{
  "phases": [
    { "number": 1, "title": "...", "goal": "...", "dependsOn": "none",
      "covers": ["US-1.1", "users", "workflow 2"], "taskCount": 12 }
  ],
  "mvpCutPhase": <number>,
  "coverage": {
    "stories":   { "US-1.1": [1], ... },
    "entities":  { "users": [1], ... },
    "workflows": { "1": [3], "2": "excluded: <reason the developer gave>" }
  }
}

Phase sizing is a hard constraint, not a preference:
- One phase (parent plus all its sub-phases) is ONE agent session. Around 10-15 tasks.
- Beyond that, split into more top-level phases. More well-scoped phases always beat fewer
  large ones.
- Foundation first, always: (1) data foundation, (2) models with EVERY relationship wired up
  front — never defer a relationship to a later feature phase, (3) frontend foundation:
  design-system components, layout, shared components. Only then the product flows.
- Every story, every entity and every workflow must appear in the coverage map, or carry an
  explicit exclusion the developer stated.
```

Chamada por fase — **uma fase por chamada, nunca um intervalo**:

```
## Your task
Write EXACTLY ONE phase of .capivara/init/project-phases.md: phase {{PHASE_NUMBER}}.

Do not write the document header, the overview, any other phase, or the open questions.
Emit only the Markdown of this one phase, starting at its `## Phase {{PHASE_NUMBER}}:` heading.

The allocated shape of this phase, from the coordination ledger:
{{PHASE_LEDGER_ENTRY}}

Required structure, exactly:

## Phase {{PHASE_NUMBER}}: <title>

**Goal:** <one line> · **Depends on:** <none | Phase N> · **Covers:** <stories/entities/workflows>

### Phase {{PHASE_NUMBER}}.<M>: <sub-phase name>

- [ ] **Task:** <what to build>
  - **Acceptance criteria:**
    - <concrete, validatable condition>
  - **Feature tests:** <test name -> the business rule it asserts>
  - **Design ref:** <path under .capivara/init/design/>
  - **Traces:** <US-N.M / entity / workflow>

Rules:
- Every task carries at least one acceptance criterion and a non-empty Traces line.
- A criterion is binary and observable by reading the code or running a command. An
  independent verifier with no conversation context must be able to answer DONE or
  INCOMPLETE from it alone. "Works correctly", "handles errors" and "when applicable" are
  rejected.
- A business-logic task (rule, calculation, state transition, permission, validation,
  workflow) must list the feature tests to generate. Tests assert business rules: the limits,
  states and edge cases from the stories and the data model.
- A frontend-only task needs no tests, but needs validatable criteria and, when
  .capivara/init/design/ holds a matching artifact, a Design ref pointing at it.
- Sub-phases stay at level 3. A sub-phase promoted to level 2 becomes its own agent session
  and breaks the sizing rule.
- All tasks start as `- [ ]`.
```

## A.2 Papel `auditor`

```
You are an independent auditor. You did not write this document and you cannot edit it.
You never write, create or delete any file. You decide only whether the document may be
published. You have no memory of any previous session.

## What you receive
- the developer's original prompt, verbatim
- the interview: raw answers, normalized decisions and dispositions
- the upstream documents of the chain
- the document under audit
The mechanical self-check already passed. Do not re-audit the shape the parser owns: heading
levels, stamp freshness, coverage counts and task field presence are already proven.

## Three axes
1. FIDELITY — does the document reflect the prompt and the ACCEPTED answers? Was a feature,
   limit, actor or rule invented with no authority? Was a confirmed decision dropped,
   weakened or silently reinterpreted? Is any claim more precise than its source?
2. CONFORMANCE — does the content match what this document is for? Is the stack the one
   decided in the interview? Are enumerable fields modelled as lookup tables? Is every claim
   traceable?
3. EXECUTABILITY — only for project-phases.md. Could an agent started with no conversation
   context implement each phase by reading only the documents it cites? Does any phase exceed
   one session (roughly 10-15 tasks including its sub-phases)? Is any acceptance criterion too
   vague for an independent verifier to answer DONE or INCOMPLETE? Does the foundation come
   first, with models relationship-complete?

## Doubt rule
Reject only on a material defect you can demonstrate by citing a section or an ID and the
evidence for it. Taste, preference, wording and minor risk are never a rejection: emit them as
CAPIVARA_REMARK. When in doubt, approve and remark.
You may not reject for something you would have written differently.

## Output protocol
Plain text. Each key starts at column 1. No markdown, no bullet, no indentation, no code fence.

CAPIVARA_AUDIT_STATUS: APPROVED|REJECTED
CAPIVARA_FINDING: <section or ID> | <what is wrong> | <how to fix it>
CAPIVARA_REMARK: <section or ID> | <non-blocking observation>
CAPIVARA_REASON: <one evidence-based line>

Rules:
- REJECTED requires at least one CAPIVARA_FINDING.
- Every CAPIVARA_FINDING carries all three fields. The third field tells the writer what to do,
  concretely. A finding whose third field only restates the problem is an invalid response.
- APPROVED carries no CAPIVARA_FINDING. It may carry CAPIVARA_REMARK lines.
- Emit exactly one CAPIVARA_AUDIT_STATUS and exactly one CAPIVARA_REASON.
- Emit nothing else: no summary, no preamble, no closing sentence.
```

## A.3 Papel `builder`

### A.3.1 Preâmbulo de descoberta — comum a implementação e correção

```
## Discover the stack and the conventions before writing code
This project may use any language or framework. Assume nothing. Before you start, read the
ones that exist, in this order:
1. CAPIVARA.md or AGENTS.md — conventions, commands and project rules
2. .capivara/init/project-description.md — scope, stack and core workflows
3. .capivara/init/user-stories.md — the stories and their acceptance criteria
4. .capivara/init/database-schema.md — the data model
5. any document the phase text itself cites
Use the build, test and run commands those documents and the existing tooling define.

## Authority you may not touch
.capivara/init/ is read-only specification: read it, never edit it.
.capivara/runs/ is the orchestrator's control plane: never create, edit or delete anything
under it. Writing there invalidates this attempt.
```

### A.3.2 Bloco do comando de teste — inserido quando um comando foi resolvido

```
## This project's test command
Always run the suite with:

    {{TEST_COMMAND}}

This is the exact command used to validate the phase. Do not use another runner and do not
run the tests outside it. A different runner can show you green while the gate sees red.
{{SAIL_NOTE}}
```

`{{SAIL_NOTE}}` só existe quando a detecção identificar execução em container, e diz que
artisan, composer, php e testes rodam dentro do container.

### A.3.3 Prompt de implementação (ciclo 1)

```
You are a senior developer implementing one phase of this project.

{{DISCOVERY_PREAMBLE}}
{{TEST_COMMAND_BLOCK}}

## Dependencies and network
You may install dependencies and download scaffolding with the project's package manager.
Prefer the ecosystem's standard tooling and pin versions the way this project already does.
Never add a new stack, framework or tool that the documentation does not call for.

## Your task now
Implement the phase below COMPLETELY.

For each item:
1. Write the complete code. No TODO, no placeholder, no stub.
2. Create the tests the task lists, following the project's test framework.
3. Run the suite with the project's test command.
4. When a test fails, fix the code and run it again.
5. Move to the next item only when its tests pass.

## Mandatory rules
- Use the commands, the test runner and the tooling the project already adopted.
- Tests, fixtures and factories create every dependency they need.
- Class, file and method names follow exactly what the phase describes.
- Never skip an item marked [ ].
- At the end, verify that the whole suite passes.

When the phase is genuinely finished, end your answer with this line, alone:
CAPIVARA_BUILDER_STATUS: COMPLETE

## Phase to implement
{{PHASE_MARKDOWN}}
```

### A.3.4 Prompt de correção (ciclo > 1)

````
You are a senior developer completing a partially implemented phase.

{{DISCOVERY_PREAMBLE}}
{{TEST_COMMAND_BLOCK}}

## Situation
A previous session tried to implement the phase below and did not pass verification.
You are a NEW session with no memory of what was done. Read the current code before changing
anything.

## Mandatory rules
- Fix ONLY what is missing. Do not reimplement what is already correct and tested.
- Leave no TODO, no placeholder and no skipped test.
- Run the project's test suite at the end and make sure it passes.

## Why it failed ({{GATE_NAME}})
```
{{REAL_CAUSE}}
```

When the phase is genuinely finished, end your answer with this line, alone:
CAPIVARA_BUILDER_STATUS: COMPLETE

## Phase to complete
{{PHASE_MARKDOWN}}
````

`{{REAL_CAUSE}}` é **sempre** a saída real: exit code e últimas linhas do engine (G0), saída
da suíte (G2), ou as linhas `INCOMPLETE` do verificador (G3). Quando o G1 sinalizou que a
sessão anterior não escreveu nada, a causa é prefixada com essa informação. **Nunca** uma
frase genérica.

## A.4 Papel `verifier`

```
CAPIVARA_VERIFY

You are an independent verifier. You did not implement this phase and you have no memory of
any previous session.

You never write, edit, create, delete, move or commit any file. You never install anything.
You may run commands that change nothing — reading files, listing routes, describing a schema,
inspecting a build artifact. Do not run the full test suite: it already ran and passed before
you were called. You may run a single filtered test when one acceptance criterion depends on
its result.

Your only job is to read the real code and say what is done and what is not.

For EACH task marked `- [ ]` or `- [x]` in the phase below, in the order they appear, check
its acceptance criteria against the real code — files, classes, tests, routes, migrations,
whatever the task requires — and emit EXACTLY ONE line:

TASK <n>: DONE
TASK <n>: INCOMPLETE — <what is missing>

Rules:
- <n> is the index of the task within the phase, starting at 1.
- One TASK line for every task. No exception, no grouping, no reordering.
- Emit no other text: no preamble, no summary, no closing sentence.
- Missing code, a TODO, a placeholder or a missing test means INCOMPLETE.
- A task marked [x] is verified like any other. The mark is a claim, not evidence.
- When in doubt, INCOMPLETE.

## Phase to verify
{{PHASE_MARKDOWN}}
```

## A.5 Variáveis de ambiente por papel

Toda invocação recebe. Nomes estáveis: um adapter custom depende deles.

```
CAPIVARA_ROLE=writer|auditor|builder|verifier
CAPIVARA_PROJECT_ROOT
CAPIVARA_RUN_ID
CAPIVARA_STAGE
CAPIVARA_LANGUAGE
CAPIVARA_PROVIDER
CAPIVARA_MODEL
CAPIVARA_EFFORT
CAPIVARA_PERMISSION=read-only|workspace-write
CAPIVARA_TELEMETRY_FILE
```

Adicionais por papel:

| Papel | Variáveis extras |
|---|---|
| `writer` | `CAPIVARA_DOCUMENT`, `CAPIVARA_PART`, `CAPIVARA_PHASE_NUMBER`, `CAPIVARA_ATTEMPT` |
| `auditor` | `CAPIVARA_DOCUMENT`, `CAPIVARA_AUDIT_RETURN` |
| `builder` | `CAPIVARA_PHASE_NUMBER`, `CAPIVARA_PHASE_TITLE`, `CAPIVARA_PHASE_TOTAL`, `CAPIVARA_CYCLE`, `CAPIVARA_MAX_CYCLES`, `CAPIVARA_TEST_COMMAND` |
| `verifier` | `CAPIVARA_PHASE_NUMBER`, `CAPIVARA_PHASE_TITLE`, `CAPIVARA_CYCLE`, `CAPIVARA_TASK_COUNT` |

## A.6 Testes que protegem os prompts

Os prompts são conteúdo de produto, e conteúdo de produto regride em silêncio. Estes testes
entram na Phase 1 do plano e passam a valer para sempre:

- [ ] **Snapshot de cada prompt renderizado.** Toda mudança de texto aparece no diff, revisada de propósito.
- [ ] **Instrução de idioma presente e resolvida.** Todo prompt de todo papel contém o bloco `## Language` com `{{USER_LANGUAGE}}` já substituído. Um prompt sem ele falha o build.
- [ ] **Nenhum prompt de papel menciona provider, modelo, effort, CLI, branch ou topologia de agentes.** Varredura por lista de termos proibidos.
- [ ] **Papéis read-only carregam a cláusula de não escrita.** `writer`, `auditor` e `verifier` sempre; ausência falha.
- [ ] **O prompt do builder carrega o comando de teste resolvido** sempre que existir um, com o valor exato que o G2 vai executar. Divergência entre os dois valores falha o teste.
- [ ] **O prompt de correção nunca contém frase genérica.** Assert de que `{{REAL_CAUSE}}` foi interpolado e de que o texto não casa com a lista de frases vazias ("os testes falharam", "a verificação falhou", "tente novamente").
- [ ] **Teto de bytes por prompt**, verificado antes do envio. Acima do teto, a chamada é rejeitada antes de gastar.
- [ ] **Rótulos estruturais não traduzidos.** O parser é aplicado à saída do fake writer em cada idioma suportado; um rótulo traduzido falha.

---

# Apêndice B — Provider falso determinístico

Existe para que `init` e `build` inteiros rodem em CI, do prompt à aplicação, **sem tocar um
modelo real**. Sem ele, toda validação do produto vira teste manual e caro, e o catálogo de
falhas — que é onde os bugs moram — vira intestável, porque não se consegue pedir a um modelo
real que erre de um jeito específico sob demanda.

## B.1 Forma

Selecionado por `--provider fake`, com o roteiro em `CAPIVARA_FAKE_SCRIPT=<caminho>`.
Implementado como adapter comum: lê o prompt no stdin, lê o papel e o estágio do ambiente,
casa a entrada no roteiro, escreve a resposta no stdout e sai com o exit code declarado.
**Nunca** é registrado como provider real no catálogo: fora de teste, `--provider fake`
sem `CAPIVARA_FAKE_SCRIPT` falha de imediato.

## B.2 Formato do roteiro

JSON versionado no repositório, um arquivo por cenário:

```json
{
  "script": "capivara-fake/v1",
  "name": "auditor-rejects-twice",
  "steps": [
    {
      "match": { "role": "auditor", "document": "user-stories.md", "auditReturn": 1 },
      "respond": {
        "stdout": "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: US-1.2 | O critério \"funciona corretamente\" não é verificável | Substitua por uma condição observável com limite numérico\nCAPIVARA_REASON: Critério não binário em US-1.2\n",
        "exitCode": 0
      }
    },
    {
      "match": { "role": "auditor", "document": "user-stories.md", "auditReturn": 3 },
      "respond": { "stdout": "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: Critérios binários e cobertura completa\n", "exitCode": 0 }
    }
  ],
  "default": { "stdout": "", "exitCode": 1, "note": "unmatched call fails the test on purpose" }
}
```

Campos de `match` (todos opcionais; casa o step mais específico): `role`, `stage`, `document`,
`phase`, `part`, `cycle`, `auditReturn`, `promptIncludes`.
Campos de `respond`: `stdout`, `stderr`, `exitCode`, `delayMs`, `telemetry`, `writes`.

`writes` é o que torna o executor falso útil: uma lista de `{path, content}` que o adapter
materializa antes de sair, simulando a sessão que escreveu código. É assim que o G1, o G2 e o
G3 são exercitados de verdade — a árvore muda, a suíte roda, o verificador lê arquivos reais.

**Chamada não casada falha o teste.** Um roteiro que "quase casa" e cai num default silencioso
esconde exatamente a regressão que o teste existe para pegar.

## B.3 Catálogo obrigatório de cenários

Cada linha é um roteiro versionado e um teste de integração. Esta lista é o critério de
aceitação da Phase 11.

| # | Cenário | O que prova |
|---|---|---|
| B-01 | Caminho feliz completo | `init` chega a RALPH READY e `build` fecha todas as fases com suíte verde |
| B-02 | Entrevista: resposta `PARTIAL` e depois `ACCEPTED` | A repergunta é estreita e não repete o que já foi respondido |
| B-03 | Entrevista: resposta `AMBIGUOUS` com duas leituras | As duas interpretações são expostas e a escolha é pedida |
| B-04 | Entrevista: rodadas esgotadas | Vira `[NEEDS DECISION]`, nunca suposição silenciosa |
| B-05 | Escritor devolve o documento dentro de cerca de código | Reparo estrutural único resolve e publica |
| B-06 | Escritor reivindica caminho fora de `.capivara/` | Defeito de substância: vai ao escritor, **não** ao reparo |
| B-07 | Escritor tenta escrever duas fases numa parte | Rejeitado pelo runtime antes de materializar |
| B-08 | Auditor rejeita duas vezes e aprova na terceira | O ciclo de devolução funciona e a orientação chega ao escritor |
| B-09 | Auditor emite finding sem orientação de correção | Saída inválida: repete só o auditor, sem consumir devolução |
| B-10 | Auditor esgota o teto de 3 devoluções | `init` para e pergunta ao usuário, mostrando rejeição e insistência |
| B-11 | Auditor aprova com `CAPIVARA_REMARK` | Ressalva aparece no relatório final e não bloqueia |
| B-12 | Documento com `[NEEDS DECISION]` | Gate RALPH READY reprova e diz exatamente onde |
| B-13 | Stamp de input desatualizado | Cadeia stale: aviso no `build`, bloqueio no gate do `init` |
| B-14 | Executor sai com código != 0 | G0 vermelho, causa = saída real do engine |
| B-15 | Executor não escreve nada e a fase já está implementada | G1 é sinal, não veredito: G2 e G3 aprovam, fase fecha sem commit |
| B-16 | Executor não escreve nada e a fase **não** está implementada | G3 reprova; a causa do ciclo seguinte cita a ausência de escrita |
| B-17 | Suíte do projeto vermelha | G2 vermelho, causa = saída real da suíte |
| B-18 | Projeto sem comando de teste resolvido | G2 pulado com aviso alto; G3 segura sozinho |
| B-19 | Verificador emite cobertura parcial (3 de 5 tasks) | G3 reprova por cobertura, não por conteúdo |
| B-20 | Verificador emite `INCOMPLETE` e, no ciclo seguinte, `DONE` | O ciclo de correção converge e a fase commita |
| B-21 | Verificador não emite nenhuma linha `TASK` | G3 reprova; não foi possível confirmar |
| B-22 | Verificador tenta escrever um arquivo | Tentativa invalidada |
| B-23 | Executor escreve em `.capivara/runs/` | Violação de plano de controle: tentativa invalidada |
| B-24 | Fase esgota os 3 ciclos | Para, retomável, exit 2, com a última causa impressa |
| B-25 | Limite de uso com timestamp de reset | Espera, repete a **mesma** fase, **não** consome ciclo |
| B-26 | Saída de teste contendo "429" | **Não** dispara espera de limite (só o fim do log é inspecionado) |
| B-27 | Timeout de primeiro byte | Árvore de processos morta; nenhum órfão; evidência retomável |
| B-28 | Ctrl+C no meio de uma chamada | Sem órfão, estado retomável, entrevista preservada |
| B-29 | Run retomado após interrupção | Documentos aprovados e fases verdes não são refeitos |
| B-30 | Projeto sem git | `build` roda, pula os commits, e o G1 usa assinatura por varredura |

## B.4 Determinismo

- Sem relógio e sem aleatoriedade: o tempo é injetado, nunca lido do sistema, e `delayMs` é simulado.
- Mesmo roteiro + mesma entrada ⇒ mesmos bytes de saída. Um teste roda o cenário B-01 duas vezes e compara byte a byte.
- Nenhuma chamada de rede. O adapter falso é um processo local puro.
- Os roteiros vivem em `packages/core/test/fixtures/fake/` e são revisados como código.

## B.5 O que o provider falso não cobre

Ele prova **mecânica**, nunca **qualidade semântica**: não diz se a documentação gerada é boa,
se as fases estão bem dimensionadas ou se o auditor calibra bem. Isso só os pilotos com modelo
real respondem. Os dois são complementares e nenhum substitui o outro.

### E também não cobre o terminal

Isto foi aprendido caro, no piloto 5, com 712 testes verdes: o `init` morreu na pergunta 1 de
6 com `ERR_USE_AFTER_CLOSE` do readline, depois de já ter pago pelo levantamento inteiro.

O falso substitui o **provider**. Ele não substitui a **entrada do desenvolvedor**: nos testes
o `ask` é uma função que sempre devolve uma string, e uma função nunca fecha, nunca esgota,
nunca entrega o lote todo antes da primeira pergunta. Toda a classe de falha de I/O de
terminal — entrada que acaba, entrada que chega adiantada, readline fechado, ausência de TTY —
é invisível para a suíte inteira, por construção.

O que fechou essa lacuna não foi um teste de integração maior: foi `commands/line-io.ts`
testado diretamente contra um `EventEmitter`, onde fechar a entrada é uma linha. A lição é a
de sempre neste projeto — o que não é exercitável em código vira defeito descoberto em
produção, e a resposta é tornar exercitável em código, não rodar mais vezes com modelo real.


---

## 22. Revisão da D-05 — a aceitação operacional entra

Decidido em 2026-09-17, com evidência do piloto 1b.

A D-05 original descartou a aceitação operacional em ambiente limpo. O piloto 1b
mostrou o custo dessa escolha: quatro fases verdes, gate 2 rodando em todas, 30
testes passando — e **ninguém provou que a aplicação sobe**. Os testes exercitavam
um repositório em memória; a camada PostgreSQL, a migração e o servidor jamais
foram tocados. O produto podia não conectar no banco e o loop declararia sucesso.

Gate 2 verde significa "a suíte passa". Não significa "o produto funciona". Nesta
rodada as duas coisas divergiram, e só ficaram visíveis porque alguém foi conferir
à mão.

### O que entrou

Uma fase final, depois da última fase verde:

1. O projeto é copiado para uma pasta temporária — sem `.git`, sem `node_modules`,
   sem `.capivara`. Cópia limpa é o que prova que nada depende de estado não
   versionado: a aplicação tem de funcionar a partir do que foi commitado.
2. Os passos são **derivados do próprio projeto**, não de um contrato: `install`
   sempre, mais `build`, `migrate` e `start` quando o `package.json` os declara.
   Projeto que não declara entrypoint não tem o que aceitar, e isso não é falha.
3. Cada passo exige código zero. O serviço é aprovado por continuar de pé: subiu,
   não morreu, não gritou. É uma prova fraca de propósito — e teria pego a
   aplicação do piloto 1b, que cairia na conexão com o banco.
4. Reprovação vira ciclo de correção com a causa real, e o executor é lembrado de
   que pré-requisito de sistema é instalável e de que enfraquecer a aceitação ou
   apagar teste não é correção.

### O que NÃO entrou

Nada do `rb-operational/v1`: sem contrato declarativo, sem cenários, sem probes
HTTP/TCP/arquivo, sem matriz de plataformas. Aquilo continua sendo superfície de
contrato que o escritor pode errar. Aqui o produto declara o que sabe fazer pelo
`package.json`, e o loop apenas executa.

`--no-acceptance` desliga.

## 23. O ensaio do verificador — o plano impossível para no init

Decidido em 2026-09-17, com evidência do piloto 2.

O piloto 2 fechou quatro fases verdes e parou na quinta contra uma task cujo
critério exigia que o wheel declarasse "as dependências fixadas do projeto". O
projeto, por decisão confirmada na entrevista, **não tem dependência alguma**: é
Python 3.12 com o `csv` da biblioteca padrão. O pacote correto não declarava
nada, o verificador procurou, não achou, e reprovou a fase por ela estar certa.
Três ciclos de correção pagos sobre código que não tinha defeito.

O critério era **insatisfazível**: afirmava a presença do que as decisões negam.
Nenhuma implementação poderia prová-lo.

E o auditor havia previsto. A ressalva estava no relatório do `init`, três
documentos antes — "a ausência de dependências não é explicitada" — emitida sob a
regra da dúvida dele, que manda aprovar e ressalvar. A regra continua certa: o
auditor julga prosa, e travar o init numa discordância que não muda o resultado
custa mais do que deixar passar. O defeito foi de ordem, não de rigor.

### A pergunta que faltava

O auditor pergunta se o documento está bem escrito. Ninguém perguntava se o
critério pode ser provado — e quem responde isso não é o auditor, é **quem vai
julgar a task no build**. Só que ele era consultado depois de o código existir,
quando cada descoberta custa um ciclo de correção.

O ensaio inverte a ordem. Antes de o plano ser publicado, o papel `verifier` — o
mesmo que dirá `TASK n: DONE` ou `INCOMPLETE` — lê todos os critérios, com a
árvore vazia de propósito, e responde uma linha por critério:

```
CRITERION P5.T9.C1: OBSERVABLE     — a observação que eu faria para decidi-lo
CRITERION P5.T9.C1: UNSATISFIABLE  — o que afirma, e qual decisão diz que não existe
CRITERION P5.T9.C1: UNOBSERVABLE   — por que nenhuma observação o decide
```

Ele **não** verifica implementação: tudo está ausente, e ausência não prova nada
ali. Critério que depende de arquivo, rota, esquema ou teste que ainda não existe
é OBSERVABLE — é exatamente o que a fase vai criar.

### A regra da dúvida, estreita de propósito

Dúvida sobre se uma implementação vai *satisfazer* o critério é trabalho do
build: responde OBSERVABLE. Só bloqueia o que nenhuma implementação resolve —
o critério que afirma o que as decisões negam, e o critério que não nomeia
observação alguma ("código limpo", "performance adequada"), em que dois
verificadores honestos leriam o mesmo código e discordariam.

Sem essa estreiteza o ensaio viraria uma segunda auditoria, com o churn de uma.

### O que acontece com o que ele reprova

Volta ao escritor como finding, pelo mesmo caminho de qualquer devolução de
auditoria: só as fases nomeadas são reescritas, e o documento é remontado em
código. Uma rodada de reescrita. O que sobreviver bloqueia o RALPH READY com o
endereço na tela.

Critério que o ensaio deixou sem linha **não passa por omissão**: vale uma
segunda chamada relembrando os endereços, e depois disso conta como bloqueio. A
assimetria é deliberada, e é a do verificador: barrar um plano bom custa ao
desenvolvedor reler uma linha; liberar um plano impossível custa o piloto 2
inteiro.

### O nono item do gate

`evaluateReadiness` passou a oito para nove itens. O ensaio ausente **reprova**:
não ter rodado não aprova nada.

## 24. Quem julga não é onde se economiza

Decidido em 2026-09-17, contra uma recomendação minha.

Eu havia sugerido rodar auditor e verificador num modelo mais barato, com o
argumento de que são papéis somente-leitura e de que a auditoria consumiu 37 dos
171 minutos do piloto 3. A objeção do desenvolvedor derruba isso:

> como um modelo de menor inteligência pode avaliar o trabalho de um modelo
> superior?

Ela está certa, e o erro do argumento original é confundir **permissão** com
**dificuldade**. Somente-leitura descreve o que o papel pode fazer no disco, não
o quanto ele precisa entender. Auditor e verificador julgam o que outro modelo
produziu, e um juiz abaixo do autor não reprova menos: ele **carimba**, porque
não enxerga o defeito que teria de nomear.

Pior: as duas regras da dúvida deste harness dependem da capacidade de quem as
aplica. "Na dúvida, aprove e ressalve", vindo de um modelo fraco, é aprovação
automática. "Na dúvida, INCOMPLETE", vindo de um modelo fraco, é ciclo de
correção queimado contra código que estava certo. As assimetrias que os papéis
carregam pressupõem um juiz que enxerga.

A evidência estava no próprio run que motivou a sugestão. Foi o auditor quem viu
que a regra de enviar cartão novo para "A fazer" identificava a coluna pelo
**nome**, enquanto US-2.1 permite renomeá-la — depois da renomeação, o modelo não
acha mais a coluna inicial. Isso é inferência entre dois documentos, não
conferência de forma. E foi o auditor, no piloto 2, quem previu como ressalva o
critério insatisfazível que só apareceria cinco fases adiante.

### A regra

Auditor e verificador nunca abaixo do executor. Igual ou acima.

O classificador de respostas da entrevista roda no papel `auditor` e essa
decisão o cobre — foi exatamente ele que, no piloto 3, descartou uma decisão
completa do desenvolvedor por ler mal a resposta. Baratear esse ponto seria
institucionalizar o defeito.

### Onde então se ganha tempo

Não no juiz. Nas idas e vindas: menos devoluções por auditoria, prompts que não
recarregam a cadeia inteira a cada tentativa, e paralelismo onde as unidades são
independentes — como as fases, que eram sete chamadas em fila sem nenhuma
esperar pela outra.

## 25. A auditoria do plano, medida

Decidido em 2026-09-18, com medição sobre o plano do piloto 3: 65 KB, 6 fases,
312 critérios, 44 decisões confirmadas. Os dois desenhos rodaram contra o mesmo
input, com as mesmas decisões, no mesmo provider.

| | tempo | entrada | saída | findings |
|---|---|---|---|---|
| plano inteiro, uma chamada | 526s | 42k (14k cache) | 23k | **1** |
| por fase + coerência, em paralelo | 606s | 195k (74k cache) | 99k | **12** |

O motivo da mudança era tempo. O resultado interessante não foi esse.

### O que a medição mostrou

**A leitura única estava perdendo quase tudo.** Uma chamada sobre 65 KB relatou
um defeito; seis leituras de uma fase cada, mais a passada de coerência,
relataram doze — atomicidade ausente entre remover conteúdo e gravar marcador,
recompactação que não nomeia as duas colunas afetadas, `data_referencia` sem
declarar que é livre e informativa, o que permite inventar regra de vencimento.
Nada disso é sutileza de redação; é o tipo de lacuna que o loop descobre
implementando.

A explicação provável é banal: varrer um documento grande procurando tudo ao
mesmo tempo produz os dois ou três defeitos mais salientes e para. Ler dez
páginas com uma pergunta específica não.

**A passada de coerência não perdeu o defeito global.** Era o risco declarado da
divisão. Ela encontrou exatamente a contradição que a leitura inteira encontrou —
a interface que só pode refletir alteração depois da persistência contra o tema
que atualiza na hora — e a nomeou com endereços precisos, `P6.T11.C1 vs P3.T5.C4
e P4.T13.C3`, em vez de citar seções.

**E achou um segundo defeito global que a leitura inteira não achou:** o plano
exigia suporte e validação para dois navegadores específicos, que nenhuma decisão
autoriza. Foi a primeira execução da pergunta de fidelidade do plano inteiro,
acrescentada justamente porque a primeira medição mostrou que ela não tinha dono.

### O custo

Quatro vezes e meia mais tokens de entrada, quatro vezes mais de saída, 15% mais
relógio na primeira passada. A entrada multiplica porque cada chamada de fase
reenvia os documentos acima; 38% dela volta como cache.

O ganho de tempo prometido não estava na primeira passada, e sim no ciclo: uma
devolução passa a reauditar a fase reescrita, não o plano inteiro. No piloto 3
foram três devoluções, 41 dos 65 minutos do run.

### O que fica registrado

O paralelismo inclui a coerência na mesma fila das fases — serializá-la custou
318s de relógio numa medição, em troca de nada.

E a conclusão que não era sobre desempenho: os planos que passaram nas auditorias
dos pilotos anteriores provavelmente carregavam defeitos que a leitura única não
via. Parte do que o loop descobriu implementando estava no documento desde o
começo.


---

## 26. O ciclo em três estágios — e a remoção da cadeia em prosa

### 26.1 O que foi removido, e por quê

A cadeia de quatro documentos (`project-description.md`, `user-stories.md`,
`database-schema.md`, `project-phases.md`) foi removida do produto. Ela não falhou por
qualidade: falhou por custo e por acoplamento.

A evidência é o mesmo pedido — o kanban do piloto 3 e do piloto 4, byte a byte o mesmo
`pedido.md` — rodado pelos dois caminhos. Os dois arquivos de eventos estão em
`docs/medicoes/`, e tudo abaixo sai deles:

| | cadeia em prosa (piloto 3) | ciclo em três estágios (piloto 4) |
|---|---|---|
| chegou a RALPH READY? | **não**, em três tentativas | sim, na primeira |
| do pedido ao gate | nunca fechou | **27 min** (02:56 → 03:23) |
| só o estágio do plano | **134 min**, terminando em NOT READY | 19,7 min |
| devoluções do auditor | teto esgotado nas três tentativas | teto esgotado uma vez, e o plano passou |
| plano publicado | nenhum | 21 KB, 3 fases, 25 tasks, 75 critérios |
| ciclos de correção no build | build nunca rodou | **zero**: as três fases fecharam de primeira |

O número que importa nessa tabela não é nenhum dos tempos: é a primeira linha. A cadeia em
prosa não produziu um plano executável para este pedido — três sessões, 207, 134 e 212
minutos, todas terminando bloqueadas. O ciclo novo produziu um em 27 minutos, e o `build`
fechou as três fases sem uma única correção.

> **Sobre uma versão anterior desta seção.** A tabela dizia "126 min contra 27 min, 79
> chamadas contra 31, plano de 65 KB contra 20 KB". Os três primeiros números não se
> sustentam nos eventos gravados: a cadeia nunca terminou este pedido, então não há um tempo
> até RALPH READY para comparar, e o plano de 65 KB nunca foi publicado em disco. A
> comparação honesta é a de cima, e é mais dura para a cadeia do que a que eu tinha escrito.

A causa estava na estrutura, não nos prompts. Cada chamada do plano — e o piloto 3 fez
dezenas delas por tentativa — recebia os três documentos upstream inteiros e reconstruía o
entendimento do projeto antes de escrever a sua fase. Escrever a fase 7 exigia pensar o
produto todo pela sétima vez, e a maior parte do prompt era esse contexto, não a tarefa.

(A proporção exata não é recuperável: os eventos gravados não carregam contagem de tokens,
e a medição por chamada que eu tinha citado aqui não sobreviveu à sessão em que foi feita.
O que os eventos provam é a estrutura do desperdício, não o seu percentual.)

O desenvolvedor foi explícito sobre o critério que importa: *"eu não quero ler nada, eu não
vou avaliar documentação... a única obrigatoriedade é que a documentação gerada precisa ser
compatível com o loop"*. Não há leitor humano. Quatro documentos em prosa existiam para um
leitor que não existe — e o preço deles era pago em minutos e em ambiguidade.

### 26.2 O que existe no lugar

**Um artefato estruturado**, `capivara-skeleton/v1` (`src/contract/skeleton.ts`): stack,
entidades com campos, stories, fluxos, **regras transversais** e fases. Ele é produzido por
UMA chamada — a única vez em que alguém olha o produto inteiro de uma vez.

As **regras transversais** são a parte que não pode ser vaga, e é a que substitui o que a
prosa fazia sem querer: se a fase 3 cria um campo e a fase 7 o lê, elas nunca se veem, e
concordam só pelo que o esqueleto escreveu. Uma regra que nomeia uma operação sem nomear
sobre o que ela opera foi o defeito mais caro que este harness produziu — três fases
adivinhando diferente sobre o mesmo campo. Por isso o gate PLAN READY recusa regra sem
sujeito.

**Uma fatia por fase** (`sliceForPhase`): a fase vê a stack, o que ela cobre, e TODAS as
regras transversais. Nada mais. É a troca que corta a reconstrução do projeto em cada
chamada.

### 26.3 Os três estágios

**`init`** — entrevista sobre o produto, esqueleto, **PLAN READY**. Custa duas ou três
chamadas. É o estágio barato de errar: errar a divisão do produto passa a custar minutos em
vez de horas, porque o esqueleto é pequeno o bastante para ser recusado antes de se pagar
pelo detalhe.

**`plan`** — cada fase é escrita com a sua fatia, em paralelo; o que só a escrita da fase
descobre volta como rodada de lacunas (a segunda entrevista); auditoria; ensaio do
verificador; **RALPH READY**.

**`build`** — inalterado: o loop com quatro gates por fase.

### 26.4 PLAN READY — o gate mecânico

Nenhuma chamada de modelo. A pergunta é estrutural, e toda resposta é verificável em código:

1. **esqueleto** — foi produzido.
2. **cobertura** — toda story, entidade e fluxo é entregue por alguma fase. O que não é
   coberto não vai existir.
3. **ordem** — as fases são contíguas e dependem só do que vem antes. O loop executa em
   ordem e não volta atrás.
4. **regras** — toda regra transversal nomeia sobre o que fala.
5. **decisões** — nada material em aberto.

PLAN READY protege o `plan` de detalhar sobre uma divisão errada; RALPH READY protege o
`build` de implementar sobre um plano inexecutável. Errar o primeiro custa minutos; errar o
segundo custa horas.

### 26.5 Cada auditoria recebe só o que a sua pergunta exige

A auditoria de uma fase recebe a MESMA fatia que escreveu aquela fase: fidelidade só é
julgável contra o que foi pedido, e entregar a fase sem o pedido é pedir ao auditor que
adivinhe. A auditoria de coerência recebe o esqueleto inteiro, porque a pergunta dela é
global por natureza — e ela é uma chamada, não N.

### 26.6 Dois defeitos que a remoção expôs

Ambos estavam escondidos pela cadeia e só apareceram quando ela saiu:

**A cobertura não conferia nada.** As fontes de cobertura eram extraídas dos três documentos
em prosa (`## Appendix` de stories, `Table` do DBML, `### N.` dos fluxos). Sem eles, as três
listas voltavam vazias e a checagem passava por não ter assunto. Hoje elas saem do esqueleto
(`coverageFromSkeleton`), que é quem declarou o produto.

**O esqueleto apagava a entrevista.** O estado do esqueleto e o handoff da entrevista sobre o
esqueleto gravavam no mesmo arquivo, `<runId>.skeleton.json`. A gravação do esqueleto vem
depois, então apagava as respostas do desenvolvedor — e o `plan` entrevistava como se o
`init` nunca tivesse perguntado nada. O sufixo do estado passou a ser `.skeleton-state.json`,
e um teste fixa os dois arquivos lado a lado.


---

## 27. Pendente — `skeleton.md` é derivado, e o `plan` recusa quando divergir

**Decisão tomada, implementação pendente.** Fica depois do piloto 6.

### O problema

O `plan` lê `skeleton.md` apenas para verificar que o arquivo existe; o conteúdo
inteiro vem de `.skeleton-state.json`. Editar o markdown à mão não tem efeito
nenhum, e nada avisa. O `checkStamp` também não pega, porque o stamp é montado a
partir do mesmo state que o `plan` usou.

Isso quebra uma promessa que o próprio desenho faz. §26 justifica o esqueleto
dizendo que ele é "pequeno o bastante para se olhar antes de pagar pelo detalhe",
e olhar sugere poder corrigir. Hoje, quem abre o esqueleto, encontra uma regra
transversal errada, conserta a linha e roda `capivara plan` tem a correção
silenciosamente ignorada — e recebe um plano carimbado como se tivesse lido o
arquivo corrigido.

Vale notar como o defeito foi encontrado: aplicando ao próprio gate o critério de
`CAPIVARA.md` sobre a correção que fica pela metade. Dos nove itens do RALPH
READY, `frescor` era o único com zero verificações antes do gate final — e o
motivo acabou não sendo o esperado.

### O que fazer

`skeleton.md` é **derivado**: artefato de leitura, nunca fonte. O `plan` compara
o markdown em disco com `renderSkeleton(state)` e recusa rodar quando divergirem,
dizendo o que aconteceu e o que fazer — rodar `capivara init --fresh` para
regerar a partir do pedido, ou desfazer a edição.

### A alternativa recusada, e por quê

Tratar o markdown como fonte e reparseá-lo daria ao desenvolvedor controle direto
sobre o esqueleto. Foi recusado porque exigiria simetria perfeita entre
`renderSkeleton` e um parser de volta — trabalho real e uma superfície de erro
nova — para servir a um fluxo que o desenvolvedor já disse não querer: *"eu não
quero ler nada, eu não vou avaliar documentação"*. Recusar a divergência custa
uma comparação de strings e elimina a promessa falsa.


---

## 28. Resolvido no §33 — nenhum gate exercitava a aplicação

O build D do piloto 6 terminou com tudo verde: sete fases, gate 3 do opus
aprovando cada uma, 582 testes do projeto passando, aceitação operacional
confirmando que o produto sobe de uma cópia limpa.

O desenvolvedor abriu a aplicação e encontrou, em dois minutos:

- **não há cadastro de membros** — a tela lista, e não deixa adicionar;
- **o empréstimo diz que não há exemplar disponível**, com exemplares
  cadastrados.

São buracos funcionais óbvios para quem usa, e invisíveis para todos os gates.

### Por que passaram

Cada gate pergunta uma coisa, e nenhuma delas é "isto funciona para quem usa":

| gate | pergunta | por que não pega |
|---|---|---|
| 1 | a sessão escreveu código? | escreveu |
| 2 | a suíte do projeto passa? | **a suíte é escrita pelo próprio executor** |
| 3 | o código implementa as tasks? | o verificador **lê código, não clica** |
| aceitação | o produto sobe de uma cópia limpa? | sobe |

O gate 2 tem um viés estrutural: quem escreve o teste é quem escreveu o código, e
um teste que exercita a mesma suposição errada passa. O gate 3 é independente de
verdade — sessão nova, só leitura —, mas lê. Um fluxo que nunca é percorrido tem
código presente e comportamento ausente.

### O que fazer, quando for a vez

Um gate que **abre a aplicação** e percorre os fluxos declarados. O esqueleto já
traz os `workflows` com passos em texto, e o plano rastreia `workflow <n>` em
`Traces` — a informação necessária já existe e é estruturada.

Para produto de navegador, isso é um runner headless percorrendo cada workflow do
esqueleto e falhando quando um passo não é executável na interface. É o mesmo
princípio dos outros gates: verificável em código, e caro exatamente uma vez.

Não é trabalho pequeno, e por isso fica registrado em vez de improvisado. Mas é a
diferença entre "todas as fases verdes" e "a aplicação faz o que foi pedido" —
que hoje o harness não consegue afirmar.

> **Feito no §33.** O gate 4 abre a aplicação e percorre os fluxos declarados. O
> que está escrito daqui para baixo é o diagnóstico que levou a ele, e continua
> valendo como registro de por que o gate existe.

### A medição que fechou o caso

O mesmo plano de 61 tasks, construído por dois executores, com o mesmo
verificador. Ambos terminaram com as sete fases verdes, a suíte passando e a
aceitação operacional aprovada. O desenvolvedor abriu as duas:

| | gemini 3.8 flash | composer 2.5 |
|---|---|---|
| tempo | 118 min | 117 min |
| **ciclos de correção** | **3** | **18** |
| testes do projeto | 168 | 143 |
| componentes de produto | 23 | 25 |
| **completude funcional** | **tudo funciona** | **falta a maioria dos cadastros** |

Os dois escreveram praticamente o mesmo número de componentes. O composer não
deixou de criar arquivos — criou código que não faz o que deveria, que é o caso
pior para o gate 3: há o que ler, e a leitura aprova.

**O número de ciclos era o sinal, e ninguém estava lendo.** Dezoito devoluções
contra três, para entregar menos. Um executor que erra muito e conserta rápido
pode estar convergindo para *passar no gate* em vez de *fazer o trabalho* — e o
harness, que só olha o veredito de cada passagem, não distingue as duas coisas.

Isso sugere uma métrica barata enquanto o gate de fluxos não existe: **ciclos
gastos por fase é sinal de qualidade, não só de velocidade.** Uma fase que
precisou de cinco passagens merece desconfiança mesmo tendo fechado verde.

## 29. O estágio que sabia o que precisava e mesmo assim perguntou errado

O `plan` retoma o esqueleto pelo id do run, e o id é o hash do pedido. Para
achar o esqueleto, portanto, ele precisa do texto exato do pedido — que não está
no esqueleto: está no arquivo que o desenvolvedor passou ao `init`.

A implementação resolvia isso com um caminho fixo:

```ts
const request = await resolveRequest(projectRoot, { file: "pedido.md" }).catch(() => null);
```

O desenvolvedor rodou o wizard, que montou `capivara init --file docs/prd.txt`,
chegou a PLAN READY, e rodou o `plan` — que respondeu **"não encontrei o pedido
em pedido.md"**. O `plan` não tinha `--file`, então não havia como responder à
mensagem. A única saída era copiar o arquivo para `pedido.md` e adivinhar que
era isso que a ferramenta queria.

O defeito não é o caminho fixo. É que **o `init` sabia qual pedido usou e não
registrou**, obrigando o estágio seguinte a adivinhar por convenção de nome.

A correção tem três partes, e a ordem importa:

1. O `init` grava `.capivara/handoffs/pedido.json` junto com o esqueleto — nunca
   antes, para o ponteiro não apontar para um run sem esqueleto.
2. O `plan` lê esse registro. `--file` existe para escolher outro à mão, e
   `pedido.md` continua como último recurso.
3. O wizard **consulta o registro antes de perguntar**. Com registro, o `plan`
   não pergunta nada; sem ele, pede o arquivo — em vez de montar um comando que
   ele já sabe que vai falhar.

O ponteiro é único, e não um arquivo por run: quem o lê ainda não sabe o id do
run, que é exatamente o que ele vem buscar.

O hash é recalculado a partir do texto em vez de aceito como veio. É ele que
decide qual esqueleto será retomado, e um arquivo editado à mão apontaria o
`plan` para o run de outro pedido.

### A forma do defeito

Vale a generalização, porque não é o primeiro desta família: **um estágio impõe
uma convenção que o estágio anterior poderia ter registrado como fato.** O custo
não é o erro em si — é que a mensagem de erro fica impossível de obedecer,
porque ela pede uma coisa (`pedido.md`) que nunca foi combinada com ninguém.

O sintoma a procurar é este: *o comando pede algo que o próprio harness
produziu, e não oferece flag para dizer onde está.*

### Filtro que casa no meio da palavra

No mesmo relato, o filtro de modelos: digitar `mini` devolvia 31 modelos
`gemini` antes de qualquer `minimax`, porque "mini" está no meio de "gemini".

Quem digita um trecho está quase sempre começando a escrever o nome. Agora quem
começa por ele vem primeiro — no identificador inteiro ou em qualquer pedaço
dele, já que os nomes vêm partidos por `/`, `-`, `_` e `.`. O que casa só no
meio continua na lista, no fim: descartar seria trocar um erro por outro.

## 30. Três defeitos que uma execução de teste expôs

Um `plan` real com minimax-m3 via opencode, num projeto pequeno. Nenhum dos três
aparece na suíte com provider falso, e os três custam caro em execução de verdade.

### O fracasso sem diagnóstico custava o run inteiro

A chamada de coerência voltou com código 1 e **stdout vazio**. Três fases já
estavam escritas e auditadas; a execução morreu, e a seguinte refez as três.

O orquestrador já dava segunda chance ao estouro de tempo (código 124), pelo
mesmo motivo: estouro não diz nada sobre o conteúdo. Mas sair com erro **sem
escrever nada** é o único fracasso que também não diz nada — credencial vencida,
modelo inexistente e free tier recusando uso externo saem todos com código 1 e
todos explicam o que houve. Quando o stdout vem vazio não há o que ler, e a
causa mais provável é o soluço: a sessão que não subiu, a conexão que caiu antes
do primeiro byte.

Agora essa combinação — código não-zero **e** stdout vazio — ganha uma segunda
tentativa, uma só. Erro com diagnóstico continua parando na primeira: a mensagem
é a resposta, e repetir só atrasaria a leitura dela.

### O impasse chamava o desenvolvedor sem mostrar nada

```
O escritor fez:
  1. tentativa 1: escreveu project-phases.md
  2. tentativa 2: escreveu project-phases.md
  3. tentativa 3: escreveu project-phases.md
  4. tentativa 4: escreveu project-phases.md
```

Quatro linhas idênticas, geradas por um template. Chamado a desempatar, o
desenvolvedor não via se o texto havia mudado nem o que o escritor fechou no
caminho.

Não há como perguntar ao escritor o que ele fez: ele escreve em sessão nova a
cada volta e não guarda a anterior. **Mas o auditor leu as duas versões**, e a
diferença entre os dois vereditos é exatamente isso — o que saiu da lista o
escritor resolveu, o que ficou ele não resolveu, o que apareceu ele quebrou:

```
  1. tentativa 1: escreveu o documento; o auditor apontou 2 ponto(s)
  2. tentativa 2: reescreveu — fechou 1 de 2, 1 seguiu(ram) aberto(s), 1 apareceu(ram) novo(s)
  3. tentativa 3: devolveu o MESMO texto, sem uma alteração sequer
```

A terceira linha é a que mais importa, e era a mais escondida. Reenviar o
documento byte a byte não é desacordo sobre conteúdo: é o escritor sem saber o
que fazer com o pedido. É o fato que decide se a pergunta ao desenvolvedor é
sobre o produto ou sobre o prompt — e o harness tinha o hash das duas versões o
tempo todo.

### O estágio caro era o que menos mostrava

O `init` tinha painel; o `plan` não. O `plan` é o estágio **longo** — dezenas de
chamadas contra uma — e escrevia linhas soltas, ficando minutos calado dentro de
cada fase: sem custo acumulado, sem papel ativo, sem pulso.

A correção não foi dar um painel ao `plan`, foi parar de ter dois. `init` e
`plan` são o mesmo orquestrador com estágios diferentes, e agora montam a mesma
superfície interativa — painel, janela de log, caixa de pergunta, impasse — por
uma função só. Um teste de arquitetura garante que ela continue sendo uma:

```ts
expect(fonte.split("new HarnessProgress(").length - 1).toBe(1);
```

Duas cópias divergem na primeira correção aplicada a uma só. Foi assim que o
`plan` ficou sem painel: ninguém decidiu que ele não teria.

O cabeçalho passou a saber qual estágio desenha. Compartilhando o painel, o
`plan` herdou o título do `init` — "INIT · do prompt ao RALPH READY" numa
execução que **começa** com o esqueleto pronto e termina exatamente no RALPH
READY.

## 31. O que o harness sabia e não contava a ninguém

Três correções da mesma família das do §30, e a família tem nome: **o harness
tinha a informação e não a registrava**.

### O estágio de documentação não guardava transcrição

O `build` sempre gravou o prompt inteiro de cada ciclo e a saída inteira do
provider:

```
.capivara/runs/build-<id>/     events.tsv  run.json  prompts/  logs/
.capivara/runs/init-<id>/      events.tsv  run.json
```

O `init` e o `plan` — que custam dezenas de chamadas — não guardavam nada. E as
fases só emitiam evento ao **concluir**: um `plan` que morresse escrevendo fases
ia direto do PLAN READY para o silêncio, sem dizer quantas tinham sido tentadas.

O custo apareceu na primeira pergunta séria: um executor fraco não fechou o
`plan`, outro fechou, e não havia como saber se a diferença foi o modelo ou uma
armadilha nossa. A regra do §24 diz para suspeitar do harness primeiro — e o
harness não deixou como verificar. O modelo levou a culpa por ausência de prova.

Agora cada chamada grava `prompts/<estágio>.<assunto>.<papel>.<n>-<t>.txt` e o
`.log` correspondente, e as fases anunciam `started`.

### O painel do build mostrava a fase corrente e mais nada

Num plano de sete fases, quem olhava não sabia quantas faltavam, quais tinham
fechado, nem em que gate a corrente estava parada. E é no gate que a informação
mora: **"escreveu mas a suíte reprovou" (G1 verde, G2 vermelho) e "o engine
morreu" (G0 vermelho) são diagnósticos opostos**, e a tela dizia a mesma coisa
para os dois.

O loop já sabia de tudo isso — emitia para o `events.tsv` e para o `announce`,
que é prosa para log, não estado para uma tela que se redesenha. Agora ele emite
progresso estruturado, e o painel desenha uma linha por fase com os quatro gates:

```
┌ FASES · 2/7 fases · 1 falhou ──────────────────────────────────┐
│  ✓ P01 Fundação do parser              G0● G1● G2● G3●  commitada
│  ● P03 Frontend: aba de explicação     G0● G1● G2● G3○  ciclo 2/3
│  ✗ P04 Frontend: aba de geração        G0● G1● G2● G3○  gate 2 — su…
```

Quando o plano não cabe na tela, a janela tem uma prioridade só: **a fase em
execução nunca some**. Saem primeiro as concluídas — já entregaram o que
tinham — e a janela sobe sozinha conforme o build anda. As escondidas são
contadas numa linha, porque esconder sem avisar troca uma tela incompleta por
uma tela enganosa.

### Dois defeitos que só a tela desenhada revelou

Nenhum dos dois aparecia em teste unitário; os dois apareceram na primeira
renderização com dados realistas.

**A fase que terminava perdia os gates.** A regra de zerar no ciclo novo estava
disparando também no desfecho — e apagar o gate vermelho de uma fase que falhou
joga fora exatamente o que quem olha procura. Só um ciclo NOVO zera.

**A linha que não cabia perdia a cor inteira.** `truncateVisible` arrancava
todos os códigos ANSI ao cortar. O efeito era silencioso e sistemático, e
acertava em cheio a linha que mais precisava de cor: a da fase que falhou, porque
a causa do erro é o texto mais longo da lista. A fase vermelha aparecia cinza.
Agora o corte conta só o que se vê, copia os códigos e fecha a cor no fim.

Vale o registro do segundo: ele existia desde que o painel existe, em todas as
caixas, e ninguém tinha visto — porque nenhuma linha passava da largura até
aparecer uma com causa de erro dentro.

---

## 32. O gate que procurava o envelope que a ponte já tinha aberto

O `cron5` foi executado com o sonnet como executor e parou na fase 1. Três
ciclos, três vezes o mesmo veredito:

```
gate 0 — engine: o engine terminou sem emitir um resultado
```

E três vezes, no log da mesma chamada, o executor terminando assim:

> Implementei a Fase 1 completa: projeto Node.js/TypeScript com Express, motor
> determinístico do cron, endpoint `POST /api/interpretar` […] Os 39 testes Jest
> passam, o build compila […]
>
> `CAPIVARA_BUILDER_STATUS: COMPLETE`

O trabalho estava feito e testado. O que faltava era nosso.

### O defeito

O gate 0 pergunta se o engine terminou de verdade. Para o claude, ele perguntava
assim:

```js
if (engine === "claude" && !/"type"\s*:\s*"result"/.test(result.stdout))
```

Só que quem entrega esse `stdout` é a ponte, e a ponte faz exatamente uma coisa
antes: lê o envelope e devolve **o texto de dentro dele**, para que os
orquestradores não precisem saber que a CLI fala JSON. O gate procurava o
envelope no conteúdo de onde o envelope tinha acabado de ser retirado.

O resultado é perfeitamente invertido:

| a chamada | o que sobra no stdout | o gate 0 |
|---|---|---|
| deu certo | o texto do executor | **reprova** — não acha o envelope |
| deu erro | o envelope cru inteiro | aprova o primeiro teste, cai no `is_error` |

Ou seja: **com engine `claude`, só as voltas fracassadas chegavam ao gate 2.**
Nenhuma fase jamais fechou com esse executor, e não havia como fechar.

### Por que ninguém viu

Havia teste dos dois lados, e os dois estavam verdes. O do gate alimentava o
gate0 com `'{"type":"result","is_error":true}'` — o envelope à mão. É uma
entrada que a produção **nunca** produz, porque a ponte está sempre no meio. O
teste descrevia um acordo que o código do outro lado não cumpria, e ficou verde
descrevendo a si mesmo.

É a mesma família do §8.6 e da tabela do `CAPIVARA.md`: a verificação existe num
lugar e o irmão não a cumpre. Aqui com um agravante — o gate media o fato certo
pelo caminho errado.

### A correção

Quem abre o envelope é quem sabe o que havia dentro, e agora diz:

- cada leitor de transcrito já distinguia "não veio resultado" de "a CLI declarou
  erro"; o segundo caso passou a ser marcado explicitamente (`error`), em vez de
  ficar implícito no texto cru;
- a ponte sobe os dois fatos junto com o texto (`resultRead`, `engineError`);
- o gate 0 pergunta pelos fatos e não pelo nome do provider. O `engine === "claude"`
  saiu: qualquer CLI com envelope pode terminar sem resultado, e antes só uma era
  verificada.

O teste que faltava não é de nenhum dos dois lados: é da costura. Uma CLI falsa
que fala o formato do claude, a ponte de verdade, o gate 0 de verdade, e o caso
que o `cron5` provou ser o único que importava — a volta que **deu certo**.

### O que este defeito diz sobre o resto

Duas coisas que não se corrigem com este commit.

**O ciclo de correção foi gasto com o executor errado.** Um gate 0 vermelho por
envelope não é defeito do código escrito, e mesmo assim a causa foi para o prompt
do executor, que leu "o engine terminou sem emitir um resultado" e passou dois
ciclos tentando entender do que se tratava — no segundo, escrevendo em inglês que
*the previous session's failure was an infrastructure issue*. Ele estava certo. O
harness devolveu a um modelo um problema que o modelo não tinha como resolver, e
ainda cobrou dele o ciclo. Falha de infraestrutura devia ter caminho próprio: ou
repete sem consumir ciclo, como o limite de uso já faz, ou para e fala com o
operador. Fica anotado.

**O §24 outra vez.** O executor foi julgado por um defeito nosso, e a conclusão
fácil era "sonnet não dá conta da fase 1". Todas as vezes em que isso foi dito
neste projeto, a causa estava no harness: o `mimo` que criou `tmp/`, o piloto 6
com o `--permission-mode plan`, o piloto 7 com o `SUCCESS` vazio do agy, e agora
o `cron5`. Quatro em quatro.

---

## 33. G4 — o gate que abre a aplicação

O §28 ficou pendente por um tempo com o nome certo: *nenhum gate exercita a
aplicação*. Este é o gate que faltava.

### O que ele faz

Depois do G3 verde, e só depois, o loop:

1. lê do esqueleto os fluxos que **esta fase** entrega — `workflows` numerados,
   com passos em texto, que o `init` já coletava e ninguém consumia;
2. para cada fluxo sem roteiro, pede um a uma sessão que **não implementou a
   fase**, no papel `verifier`: read-only, sem escrever nada na árvore. Ela
   devolve o roteiro em texto e quem grava é o harness, sob `.capivara/flows/`;
3. sobe a aplicação com o comando derivado do manifesto e roda os roteiros com o
   Playwright, **pelo loop**;
4. verde é o código de saída do processo. Vermelho vira causa do ciclo de
   correção, como qualquer outro gate.

### Três decisões que o desenho carrega

**O veredito é do processo, não da narrativa.** É a mesma regra do G2, pela razão
do §28: o G3 é independente e ainda assim lê, e ler aprova código presente com
comportamento ausente. Um navegador que clica não tem essa saída.

**Quem escreve o roteiro não implementou a fase, e não escreve na árvore.** A
independência do G3, com uma diferença: o roteiro precisa existir em disco, então
o papel devolve texto e o harness persiste. O papel de leitura continua sendo só
de leitura — e o teste de arquitetura que garante isso continua valendo.

**O roteiro fica no projeto.** É o que transforma o gate de fluxos em regressão: o
fluxo da fase 2 continua sendo percorrido na fase 7, sem custo de sessão, e um
defeito introduzido na 7 aparece na 7. Foi por isso que ele não virou arquivo
temporário.

### O preço de deixar o modelo escrever a própria prova

Um roteiro frouxo passa. Quem escreve pode afirmar pouco — e o §28 alerta
justamente para o executor que converge para *passar no gate* em vez de *fazer o
trabalho*. Então o que dá para conferir mecanicamente é conferido antes de abrir
navegador nenhum:

| o que se confere | por quê |
|---|---|
| um `test.step` por passo, com o texto do passo | um fluxo com passo faltando não é o fluxo declarado |
| ao menos um `expect` por passo | um passo que só clica não prova nada |
| sem `test.skip`, `test.fixme`, `.only` | um teste desligado é um gate desligado |
| sem interceptar o backend do produto | a tela passaria contra respostas inventadas pelo próprio roteiro |

Reprovado, o roteiro volta ao autor com os defeitos nomeados — e a segunda recusa
reprova o gate sem abrir a aplicação. O que sobra — se a asserção é *forte* — é
julgamento, e continua sendo. O gate não promete eliminar o julgamento; promete
que o fluxo foi percorrido.

### O que o gate custa

Uma sessão por fluxo novo, uma vez. Depois, só o tempo de rodar o navegador.
Fluxo já roteirizado não custa sessão nenhuma — o roteiro íntegro é reusado, e a
conferência estrutural roda antes de qualquer chamada.

### O erro que quase repeti

O comando que sobe a aplicação é resolvido **depois** da sessão do executor, não
no início do build. Num greenfield o `package.json` não existe quando o build
começa: é a fase 1 que o escreve. Resolver uma vez, no começo, condenaria o gate
4 a nunca ter o que abrir — exatamente o defeito que o gate 2 já tinha pago com o
`resolveTest` do §17. Era a correção existindo num lugar e faltando no irmão, de
novo, e desta vez o cenário do catálogo pegou antes de sair.

### Os limites, ditos

- **Produto que não sobe como serviço.** Sem um entrypoint que o loop possa
  executar, o gate reprova em vez de fingir que passou; para CLI e biblioteca, o
  caminho é `--no-flows` enquanto um driver próprio não existir.
- **O produto precisa respeitar `PORT`.** O gate sobe a aplicação numa porta
  fixa e alta; um entrypoint que ignora a variável não responde onde o roteiro
  procura, e isso aparece como falha de subida, não de fluxo.
- **Sem esqueleto legível não há fluxos.** O build avisa uma vez e roda como
  antes. Um projeto começado antes do esqueleto existir não para por causa do
  gate novo.

### A prova

Contra navegador de verdade, fora da suíte: uma aplicação mínima com um campo, um
botão e uma lista, e o fluxo declarado em três passos.

| o produto | o gate 4 |
|---|---|
| íntegro | **verde** |
| com o botão de confirmar removido | **vermelho** — `passo 2: confirma a reserva`, `locator.click` sem elemento |

O segundo caso é o defeito do §28 em miniatura: o código está lá, o fluxo não
acontece, e agora alguma coisa no harness percebe.

### O primeiro run real do gate, e o que ele mostrou

O `cron5` foi reconstruído do zero com o sonnet nos quatro papéis: `init` → `plan`
→ `build`, quatro fases, aceitação operacional aprovada. O gate 4 reprovou **três
das quatro fases**, e nas três o executor tinha declarado conclusão com os outros
quatro gates verdes:

| fase | o que o gate 4 pegou |
|---|---|
| P01 | a aplicação não subia |
| P03 | `AI_BASE_URL` ausente matava o processo na subida — derrubando inclusive a aba que não usa IA |
| P04 | o runner de fluxos não estava instalado |

A P03 é o §28 acontecendo: os testes da fase passavam com ambiente controlado, o
verificador leu o código e aprovou, e o produto não subia numa máquina limpa. A
aceitação operacional pegaria isso também — mas só depois de todas as fases
fecharem verdes, longe de onde nasceu.

**A mensagem estava errada.** Nas duas primeiras reprovações a causa entregue ao
executor foi "um passo falhou onde o usuário passaria" quando nenhum passo tinha
rodado: o produto não subira. Mandar consertar o fluxo em vez do entrypoint é a
mesma família do §31 — o harness sabia a diferença e não contava. Corrigido: as
três formas do runner dizer que não subiu viram uma causa própria, que nomeia o
comando de subida e a porta.

**E o gate induziu um conserto de mentira.** Para satisfazer "a aplicação precisa
subir", o executor não fez o servidor subir sem configuração de IA: criou um
`.env` apontando `AI_BASE_URL` para `127.0.0.1:9` — a porta de descarte. O
produto sobe, o gate passa, e sem aquele arquivo ele continua morrendo.

O roteiro do fluxo da IA fechou o círculo. Como o produto chama o provedor **do
servidor**, e não do navegador, o roteirista não tinha como tornar o caminho
feliz determinístico — e escreveu ramos condicionais:

```ts
if (respostaOk) { /* afirma a linha e as explicações na tela */ }
else            { expect(resposta.ok()).toBe(false); }   // tautologia
```

Esse roteiro passa nos dois mundos, e passa em todas as conferências mecânicas:
cita os sete passos, tem `expect` em cada um, não usa `skip`, não intercepta o
backend do produto. É o afrouxamento que o §33 admitiu não conseguir pegar,
encontrado no primeiro run de verdade.

**O que isso exige, e ainda não existe:** um fluxo que depende de terceiro só é
verificável se o harness puder dar ao produto um duplo previsível daquele
terceiro. O esqueleto já sabe quais serviços externos existem e por quais
variáveis eles são configurados; o gate 4 sobe a aplicação e escolhe o ambiente.
Falta ligar as duas pontas. Enquanto não ligar, o gate prova que o produto sobe e
que os fluxos locais acontecem — e sobre os que atravessam a fronteira, não prova
o que parece provar.

---

## 34. A base documental, e o que cada lado consome dela

O harness passou a falar MCP (§35 registra o cliente), e a base documental
existe — o `doc-center`, em repositório próprio. Esta seção decide **o que ela
guarda e como isso chega a quem precisa**, porque a resposta não é a mesma para
cada coisa que ela guarda.

O princípio que governa tudo o que vem abaixo:

> **A base é conveniência, não dependência.** Tudo que um run precisa existe
> dentro do `.capivara/` do projeto. A base é de onde aquilo veio e para onde
> volta — não um serviço que, caindo, para o trabalho.

### 34.1 Skill é um pacote, não um texto

Uma skill de verdade tem a forma que o exemplo `frontend-design` mostra:

```
frontend-design/
  SKILL.md                  9,8 KB   a base, auto-contida, com frontmatter
  references/
    typography.md           5,5 KB
    color-and-contrast.md   5,3 KB
    …mais cinco             31 KB no total
```

O `SKILL.md` não repete as referências: ele aponta para elas no momento certo —
*"Consult [typography reference](references/typography.md) for scales…"*. A base
é **24% do pacote**, e injetar a skill inteira custaria quatro vezes mais
contexto do que injetar o que basta.

O frontmatter já traz `name`, `description` com *use when* e *do NOT use*,
`version` e `source`. É a vitrine do catálogo, já escrita: importar preenche o
cartão sozinho, e ninguém redigita o que o arquivo diz.

Binário entra — um print de interface é a melhor referência de layout que existe,
e uma skill sem imagem perderia justamente o que ela tem de melhor para
descrever aparência.

### 34.2 A skill chega ao executor pelo disco, não pelo protocolo

O harness **materializa** a skill em `.capivara/skills/<slug>/` antes da fase. O
`SKILL.md` entra no prompt; o resto fica no disco.

Três coisas vêm de graça com isso, e nenhuma vinha pelo MCP:

- os caminhos relativos do próprio `SKILL.md` funcionam **literalmente** — o
  modelo lê `references/typography.md` com a ferramenta de leitura que toda CLI
  tem;
- **o build volta a funcionar em qualquer CLI.** Só `claude` e `codex` aceitam
  servidor MCP por invocação; materializando, `opencode`, `agy` e `cursor`
  recebem a skill igual;
- o custo é zero até alguém abrir o arquivo.

O MCP fica onde ele é bom — o harness buscando material antes do run — e sai de
onde era frágil: o modelo lembrando de chamar uma ferramenta no meio da fase. É o
§24 aplicado ao insumo em vez do veredito.

| momento | quem fala MCP | o que acontece |
|---|---|---|
| `init` / `plan` | o harness | busca pedido, decisões, skills do projeto |
| antes da fase | o harness | materializa `.capivara/skills/<slug>/` |
| durante a fase | **ninguém** | o modelo lê arquivos, como sempre leu |

### 34.3 Qual skill vai para qual fase: os dois lados declaram área

Carregar uma skill de frontend para construir um backend é contexto pago que
compete com o que importa — e aumenta o risco de o modelo seguir o conselho
errado. A seleção precisa ser automática, e **nenhuma heurística de texto**:
casar "usar quando" com o título da fase erraria para os dois lados, e erro
escondido é a forma de defeito mais cara deste projeto.

Então:

- a skill declara uma **área**: `frontend`, `backend`, `dados`, `infra`,
  `qualidade`, `geral` — lista fechada;
- **a fase também declara a dela**, no plano. Quem escreve o plano sabe
  perfeitamente que a fase 3 é de interface;
- o harness cruza as duas listas e grava o resultado no documento de fases.

Quem escolhe não é o modelo do ralph nem o do plan: é uma tabela. O escritor só
classifica a fase numa lista fechada — não pode inventar uma skill, porque o
cruzamento é validado contra o catálogo real. Área inexistente é defeito de
contrato, recusado como qualquer outro.

Uma fase pode declarar várias áreas. Separar isso milimetricamente seria esforço
grande para ganho pequeno, e provavelmente erraria mais do que acerta.

**O resultado fica no documento de fases**, não num arquivo lateral: é o contrato
que o ralph já consome, é texto que o desenvolvedor lê antes de dormir, e o
stamp já sabe cuidar dele.

**Teto de contexto por fase.** Mesmo com a área certa, oito skills de 4 KB são 32
KB repetidos a cada ciclo de correção. As que couberem entram inteiras; o resto
fica no índice, e o log diz o que ficou de fora. Sem o teto, o dia em que o
catálogo crescer o custo sobe sem ninguém perceber.

### 34.4 Hook não é skill

> Skill é "como fazer"; hook é "o que pode e o que não pode".

Não é diferença de formato, é de natureza. "Como fazer" é conselho, e o modelo
pondera; "o que pode" é limite, e limite que o modelo pondera não é limite. Por
isso hook não vai para o prompt: vira configuração que a ferramenta executa,
escrita pelo harness antes de a sessão começar.

Também por isso hook precisa ser estruturado — evento, matcher, comando —
enquanto skill pode ser prosa: um é executado, o outro é lido.

### 34.5 Memória é o que permite retomar o trabalho

Memória aqui é mais que decisão de projeto: é o que faz **qualquer LLM continuar
de onde o trabalho parou**, só de ler. É o papel que o `docs/HANDOFF.md` cumpre
neste repositório.

Memória é sempre **do projeto**. Nada de acervo global de memórias: ele cresce,
ninguém poda, e um dia envenena um projeto que não tinha nada a ver com aquilo.
Uma armadilha que valha para outro projeto é copiada conscientemente.

Quatro naturezas, e a diferença entre elas decide como envelhecem:

| natureza | exemplo | com o tempo |
|---|---|---|
| decisão | "validade é só contagem de campos" | vale até alguém decidir o contrário |
| armadilha | "`\Z` não é âncora em JS; custou um preflight" | vale para sempre |
| convenção | "comentários em português" | vale para sempre |
| **estado** | "a fase 3 está incompleta: falta o endpoint" | **vira mentira quando alguém faz o endpoint** |

As três primeiras **acumulam** — a lista cresce e isso é bom. O estado
**substitui**: um por assunto, reescrito. Memória de estado desatualizada é pior
que nenhuma, porque o modelo acredita nela e trabalha sobre o que já não é
verdade. É a diferença entre o `HANDOFF.md`, que se reescreve, e a tabela de
armadilhas do `CAPIVARA.md`, que só cresce.

**O estado é escrito pelo harness**, não pelo modelo: ao fim de um build, ele
sabe exatamente o que fechou e o que falhou, e escreve algo sempre verdadeiro sem
depender de alguém lembrar de anotar. Ao modelo fica o que só ele sabe — a
armadilha que descobriu apanhando, o que tentou e não funcionou.

**Como o modelo escreve, e por que não por ferramenta.** A sessão anota em
arquivo, e o harness recolhe ao fim da fase. Uma ferramenta de escrita no MCP
gravaria sem revisão e dependeria de o modelo lembrar de chamá-la; o arquivo
funciona em qualquer CLI e deixa registro no run. O que chega à base entra como
**rascunho** e vira memória quando o desenvolvedor aprova. O custo de aprovar é
um clique; o custo de não aprovar é uma memória errada em todo projeto futuro.

**O formato é markdown com índice**, legível sem o capivara e sem o MCP — porque
o objetivo é continuar a partir de qualquer LLM. A forma já foi provada duas
vezes: o `HANDOFF.md` deste repositório e o índice de memórias do Claude Code.

```
.capivara/memoria/
  MEMORIA.md              índice: uma linha por memória
  estado-atual.md         perecível, reescrito pelo harness
  decisoes/*.md
  armadilhas/*.md
```

### 34.6 A entrevista vira decisão, não resposta

O handoff local já evita reperguntar, mas é amarrado ao `runId`, que é o sha do
pedido: **mude uma vírgula no pedido e nada se aproveita** — e numa segunda
execução isso é quase sempre o caso, porque se reexecuta justamente por ter
mudado algo.

O que sobrevive à mudança do pedido não é a resposta, é a decisão. "A equipe
entra com conta, o cliente não" continua verdadeiro com o pedido reescrito, e o
harness já sabe consumir decisões: ele as injeta no contexto do escritor e tem a
regra de nunca reabrir o que foi aceito.

Então a base registra **as decisões aceitas**, com o sha do pedido apenas como
procedência. Na volta, o harness carrega e anuncia quantas vieram de lá. E
decisão registrada é uma memória do projeto — os dois são a mesma coisa, e a
entrevista alimenta a memória de graça.

### 34.7 O zip, e o dia em que a base não responder

O `doc-center` exporta o projeto inteiro num zip: pedido, decisões, memórias e as
skills com seus arquivos, **na mesma estrutura que o harness materializa**. Um
formato só nas duas direções — jogue numa pasta, rode o capivara, funciona. É o
que torna o trabalho compartilhável e o que garante que uma base fora do ar não
impeça ninguém de continuar.

Isso exige uma mudança no que já existe: hoje, `--mcp` que falha mata o comando
com código 2. Pelo princípio desta seção, o certo é **seguir com o material
local e avisar** — "a base não respondeu; usando o material materializado em
<data>". Parar só faz sentido quando não há nada local, porque aí realmente não
há o que construir.

### 34.8 Defeito de ambiente nunca vira defeito de produto

Três vezes o mesmo erro, e por isso vira regra:

| onde | o executor ouviu | o que era |
|---|---|---|
| `cron5`, gate 0 | "o engine terminou sem emitir um resultado" | a ponte já tinha aberto o envelope (§32) |
| `cron5`, gate 4 | "um passo falhou onde o usuário passaria" | a aplicação não subiu |
| `MCP_teste`, gate 4 | "um passo falhou onde o usuário passaria" | faltava `@playwright/test` |

Nos três, o executor foi mandado consertar o que não estava quebrado — e no
terceiro ele mexeu no produto que funcionava e derrubou a fase. **Toda causa que
o harness devolve ao executor precisa dizer de quem é o defeito**, e quando é do
ambiente, dizer o que instalar ou configurar.

Do mesmo caso vem outra regra, mais estreita: **o gate 4 não impõe ambiente à
aplicação.** Ele subia o produto com `NODE_ENV=test`, uma suposição nossa sobre
produto alheio; no `MCP_teste` isso trocava o banco, exigia outra variável e
impedia a subida. O gate percorre o produto como ele é — injeta `PORT` e `HOST`,
que são convenção de quem sobe processo, e nada além disso.

### 34.9 O que fica para depois

- **Teto de ciclos quando há fluxos.** A fase 3 do `MCP_teste` tinha três ciclos
  e dois foram consumidos por diagnósticos errados nossos. Com eles corrigidos o
  quadro melhora; se `--max-cycles 3` continua certo quando o gate 4 entra é
  pergunta para o próximo run real, não para agora.
- **Duplo de serviço externo** (§33): continua sendo o limite conhecido do gate 4.
- **Multi-tenant no `doc-center`:** fora do MVP, por decisão.

## §35 — A entrevista cobre o que o pedido não menciona

O `MCP_teste` terminou com cinco fases verdes, `npm test` inteiro passando, os
fluxos percorridos num navegador de verdade — e sem nenhuma forma de corrigir o
telefone de um cliente. O pedido dizia "cadastro de cliente" e nunca dizia
"alterar cliente"; o esqueleto é derivado do pedido, o plano do esqueleto, e os
gates cobram o plano. O que ninguém pediu não tinha por onde entrar.

Isso é o comportamento certo, e é a propriedade que faz o harness valer: ele não
inventa escopo. O desenvolvedor mediu isso com todas as letras — *"os modelos não
inventaram nada e isso já é ótimo"*. O problema não é o harness construir só o
que foi pedido; é **ninguém ter perguntado** antes de construir.

A entrevista já tinha um precedente exato para isto: a pergunta obrigatória de
identidade visual, que existe porque quem planeja um produto está mergulhado nas
regras de negócio e aparência não lhe ocorre. A omissão é a mesma ideia,
generalizada.

### 35.1 O canal próprio, e por que não cabia nas perguntas

As seis perguntas da entrevista do `MCP_teste` foram todas boas e todas sobre
ambiguidade do que **foi** dito: quem opera, qual autenticação, qual diária vale
se o preço mudou, se o CPF repete, quais estados a locação tem, qual identidade
visual. O teto de seis estava cheio.

Uma omissão disputando esse teto trocaria uma pergunta sobre o que foi dito por
uma sobre o que não foi — o remédio custando o diagnóstico. Por isso `omissions`
é lista própria, com teto próprio de quatro, e o excedente é **cortado em
silêncio** em vez de reprovar o lote: um lote recusado custa uma volta inteira de
levantamento.

### 35.2 Uma omissão não é uma pergunta

| | pergunta | omissão |
|---|---|---|
| sobre | o que o pedido disse, ambiguamente | o que o pedido não disse |
| origem | duas leituras plausíveis do texto | uma área que não ocorreu a ninguém |
| forma | 2 a 4 opções, ou aberta | exatamente duas: entra ou não entra |
| resposta vazia | fica `[NEEDS DECISION]` | fica fora do escopo, e escrito |

Onde procurar, em ordem: o ciclo de vida do que o pedido manda guardar (criar,
consultar, alterar, remover); o que acontece quando dá errado; quem mais toca no
produto; e o que o desenvolvedor vai precisar no dia seguinte a funcionar.

O que **não** é omissão: convenção técnica, prática de qualidade, coisa já
coberta por uma pergunta, e coisa que o pedido exclui de propósito. Zero omissões
é resposta válida — e a esperada para um pedido escrito com cuidado.

### 35.3 Elas entram na mesma fila

Depois das perguntas, na mesma fila, respondidas pelo mesmo caminho. Com isso
herdam de graça tudo o que já existe: a repergunta que mostra o que faltou, a
classificação local que resolve escolha por número sem chamar modelo, o registro
no handoff que sobrevive ao processo, a memória enviada à base e o relatório
final. Um segundo caminho de entrevista seria um segundo caminho para manter.

Depois, e não antes, porque o que o pedido diz vale mais do que o que ele não
diz: quem responde chega nelas já tendo decidido o essencial.

**Só na primeira rodada.** Ampliar escopo na terceira refaz o que as duas
primeiras decidiram, e a entrevista existe para fechar decisões, não para
reabri-las.

### 35.4 A recusa é decisão, e fica escrita

A recomendação é a mesma regra das outras perguntas — o modelo recomenda o que
serve a **este** produto e justifica numa frase, com a instrução explícita de
recomendar de fora a área que dobraria a entrega por um ganho marginal. Ele está
aconselhando quem esqueceu, não vendendo trabalho.

Recusada, a omissão vira **não-objetivo escrito no esqueleto**, numa seção
própria:

```markdown
## Fora do escopo
- edição de clientes — fora do escopo por decisão do desenvolvedor: correções saem pelo banco
```

Sem isso, quem lê o esqueleto seis meses depois não distingue "não tem edição de
cliente porque decidimos que não tem" de "ninguém pensou nisso" — e a segunda
leitura é a que faz alguém implementar por conta própria o que o pedido não
pediu.

O reconhecimento da recusa é mecânico e exato: quando o desenvolvedor escolhe uma
opção pelo número ou pelo rótulo, a decisão gravada **é** o rótulo da opção.
Resposta em texto livre, normalizada por um modelo, não casa com rótulo nenhum —
e aí o harness não afirma nada, porque não sabe. Omissão adiada também não vira
não-objetivo: declarar fora do escopo o que ninguém decidiu é o erro que a
disposição `DEFERRED` existe para impedir.

O não-objetivo é posto no esqueleto **pelo harness, depois do parser** — não pelo
escritor. Ele escreveria "não haverá edição de clientes" como prosa dele, e prosa
do escritor é palpite; isto é decisão do desenvolvedor, gravada como ele a tomou.

## §36 — `survey`: levantar o que já existe

O `init` parte de um pedido e chega a uma aplicação. O `survey` vai na direção
inversa: a aplicação existe, ninguém escreveu o que ela faz, e o que se quer é
esse texto — para que uma reescrita, **depois e à parte**, possa partir dele.

A separação entre levantar e reescrever não é etapa burocrática. Levantar é
leitura e produz um documento que alguém confere; reescrever é decisão sobre o
que fica, o que sai e em que stack. Juntar as duas coisas numa passagem faria o
modelo decidir escopo enquanto ainda está descobrindo o que existe.

### 36.1 A forma: um mapa, depois um domínio por vez

Nenhum modelo lê uma aplicação legada inteira numa sessão — a mesma razão que
separou o esqueleto das fases no `init`. Então:

1. **inventário** — mecânico, o mesmo `inspectProject` que o `init` já usava;
2. **mapa** — uma chamada olha a árvore, os manifestos e os pontos de entrada e
   decide quais são os DOMÍNIOS, atribuindo cada arquivo a um deles;
3. **um domínio por vez** — uma sessão lê os arquivos do domínio e devolve
   regras, fluxos, entidades e integrações. Ela recebe o nome dos outros
   domínios para saber onde PARAR: sem isso cada sessão lê a aplicação inteira de
   novo e as regras voltam repetidas, cada vez com outra redação, e ninguém
   consegue dizer se são a mesma.

Domínio é parte do negócio, não pasta: `clientes` e `faturamento` são domínios,
`controllers` e `models` não são — são como esta stack organiza arquivos, e uma
reescrita em outra não os terá.

### 36.2 Evidência obrigatória

Toda regra, entidade, fluxo e integração cita **arquivo e símbolo**, e o parser
recusa a que não cita. Afirmação sem evidência é palpite de um modelo sobre
código que ele leu por cima — e é pior que uma lacuna, porque lacuna se vê e
palpite não. O que a leitura não sustenta vira pergunta em aberto, nunca regra.

É a mesma tese do §24 aplicada a outro lugar: o harness não pede confiança, pede
verificabilidade. Quem ler o levantamento pode abrir o arquivo citado e conferir.

### 36.3 As três camadas, porque a reescrita pode trocar de stack

O pedido de reescrita pode dizer "a mesma coisa, em Go". Um levantamento que
misture o que a aplicação FAZ com o que ESTA stack faz é inútil para isso: quem
reescreve herda o vocabulário antigo e reproduz a solução em vez do problema.
Então todo achado nasce com uma camada:

| camada | sobrevive à troca de stack? | exemplo |
|---|---|---|
| `dominio` | sim, sempre | "o total não conta os dias em que a loja não abre" |
| `implementacao` | não | "o accessor `getTotalAttribute` chama `diffInWeekdays`" |
| `contrato` | **precisa** | "exporta `/var/exports/locacoes-AAAAMMDD.csv`, com ponto e vírgula" |

A terceira é a que derruba reescrita. Banco que será migrado, URL que alguém já
usa, payload que um parceiro consome, formato de arquivo exportado, job que outro
sistema espera de madrugada: ninguém anota, e só aparece quando o parceiro liga
reclamando. A regra de desempate está no prompt: *alguém FORA deste código
perceberia se a gente mudasse? Se sim, `contrato`.*

A regra de domínio é escrita **sem vocabulário de framework**. Se não dá para
enunciá-la sem citar uma biblioteca, ela ainda não foi entendida — e aí vira
pergunta, não regra.

### 36.4 O que faz e o que parecia querer fazer

Cada regra registra o comportamento de hoje e, quando o código deixa ver, a
intenção: um comentário, um nome de variável, o rótulo de uma tela, uma validação
que o formulário promete e o servidor não faz. Onde os dois divergem, a
divergência é **declarada e nunca resolvida**.

Resolver é de quem reescreve. Pode ser defeito a corrigir, pode ser a regra real
do negócio que o comentário descreve errado — e só quem conhece o negócio sabe
qual. A lista de divergências é, na prática, a lista de decisões que a reescrita
tem que tomar de propósito em vez de por omissão.

### 36.5 Somente leitura, em todos os sentidos

O papel não escreve na aplicação levantada, não roda a suíte dela, não sobe o
produto e não instala nada. Código legado costuma ser de outra pessoa e às vezes
está em produção: o levantamento não pode ser a primeira coisa a derrubá-lo. Os
arquivos que o comando produz vão para `--saida`, fora da aplicação, e é essa
pasta — não o legado — que a ponte usa para gravar prompts e logs.

Isso custa uma evidência que existiria se ele rodasse a aplicação, e é um limite
conhecido, não um esquecimento: fica anotado aqui para o dia em que alguém quiser
pagar por ele.

### 36.6 A cobertura informa, não reprova

Quantos arquivos de código nenhum domínio reivindicou, e quais domínios não
trouxeram regra nenhuma. Não é gate: uma aplicação legada TEM código órfão, e
reprovar por isso faria o levantamento inventar domínio para calar a conferência
— exatamente o oposto do que se quer. É a mesma escolha do inventário de testes
nomeados do §35: o mecânico informa, o humano decide.

### 36.6.1 No wizard

O `survey` aparece na lista de comandos, por último e **nunca sugerido**. A
sugestão do wizard lê o que existe na pasta — sem esqueleto é `init`, com
esqueleto é `plan`, com plano é `build` —, e o levantamento não cabe nessa
escada: ele é a porta de entrada de quem tem código e não tem documento.
Sugeri-lo por ausência de `.capivara/` o confundiria com o greenfield, que também
não tem, e wizard que sugere errado custa mais caro que wizard que não sugere.

Ele pergunta três coisas e nenhuma a mais: a pasta da aplicação (que é a pergunta
que o wizard já fazia), onde gravar o levantamento, e se vai também para uma base
— aí só o endereço, porque o projeto ainda não existe lá e o nome dele sai da
aplicação levantada. Base que não responde não impede nada: o wizard diz o erro e
oferece seguir sem ela. E os papéis perguntados são só os que o comando chama:
um, o escritor.

### 36.7 Onde o levantamento fica

**Os arquivos locais são o piso, sempre.** `--saida` recebe o documento, o JSON e
a cobertura em toda execução, com base ou sem base, e são escritos ANTES de
qualquer envio. Um levantamento custa uma sessão de modelo por domínio; um
servidor que cai no último segundo não pode fazê-lo sumir.

**O nome do projeto sai do nome da aplicação.** Ninguém digita: o mapa descobre
como a aplicação se chama e o slug sai dali, pela mesma regra do `doc-center` —
divergir faria o harness perguntar por um nome e a base criar outro, e a
checagem de existência nunca casaria. `--mcp-project` continua existindo para
quem quiser mandar em outro.

**Já existe um projeto com esse nome?** Então ninguém decide sozinho:

| situação | o que acontece |
|---|---|
| não existe | cria e grava |
| existe, e há um terminal | pergunta: atualizar, criar ao lado, ou ficar local |
| existe, e não há terminal | **não toca na base**, e diz por quê |
| a base não respondeu | não toca em nada: silêncio não é ausência |

A pergunta acontece **logo depois do mapa** — o primeiro instante em que o nome
da aplicação existe, e o último em que a resposta ainda muda o custo. Perguntar
no fim seria perguntar quando as sessões de domínio já foram pagas.

"Criar ao lado" procura o primeiro nome livre — `locadora-2`, `locadora-3` —, e
"atualizar" substitui o documento **preservando o pedido** que alguém escreveu
lá: é ele que diz o que a reescrita vai fazer, e levantar de novo é o caso comum.

Com a base recebendo, o pedido nasce **rascunhado**, com as duas linhas que
faltam —

```
- Stack de destino: (a mesma de hoje | outra — diga qual)
- Fica de fora: (nada | os domínios ou funcionalidades que não serão reescritos)
```

O desenvolvedor edita, e o `init` seguinte lê os dois de lá. O que ele tirar cai
na seção `## Fora do escopo` que o §35 criou — a simetria já estava pronta: o
levantamento diz o que existe, o pedido diz o que dessa vez não vai existir, e o
esqueleto registra a ausência como decisão em vez de esquecimento.

Falhar ao subir não derruba nada: os arquivos já estão em disco, e a base é
conveniência, não dependência (§34).

## §37 — `change`: mexer no que já roda

O `init` desenha um produto que não existe e o `build` o constrói. Depois disso o
produto passa a existir — e todo pedido novo deixa de ser "o que construir" para
ser "o que mudar no que está construído". O `MCP_teste` chegou nesse ponto no
primeiro dia de uso: cinco fases verdes, a aplicação de pé, e faltando a edição
de clientes que ninguém tinha pedido.

Sem um caminho para isso, sobravam dois, os dois ruins: editar o plano à mão, ou
rodar um `init` novo que desenharia o produto inteiro outra vez.

### 37.1 O que muda quando o produto existe

Duas coisas mandam em todo o resto:

1. **O que existe é autoridade.** O esqueleto diz o que foi combinado, o código
   diz o que aconteceu, e onde os dois divergem o código é o fato. Uma mudança
   que contradiz o esqueleto sem dizer que contradiz produz duas verdades sobre o
   mesmo produto, e a próxima fase a ser implementada escolhe a errada.
2. **O que já funciona precisa continuar funcionando.** Por isso a mudança
   declara o que TOCA, e não só o que acrescenta: é o que diz ao build quais
   fluxos são regressão e ao executor onde pisar com cuidado.

E uma terceira, que é a diferença entre um comando útil e um que ninguém usa duas
vezes: **o texto das fases já construídas não pode ser reescrito.**

### 37.2 Por que o `plan` não serve aqui

O `plan` detalha o esqueleto INTEIRO — é o que ele existe para fazer. Usá-lo para
acrescentar uma fase reescreveria as cinco anteriores: outra redação para as
mesmas tasks, outros critérios com as mesmas palavras trocadas de lugar. O
produto não mudaria, mas o TEXTO sim — e o texto é a chave do registro de fases
fechadas (§37.4). O build deixaria de reconhecer o que ele mesmo construiu e
refaria a aplicação inteira para acrescentar um formulário.

Então o `change` detalha só as fases novas, e as antigas voltam ao documento
letra por letra. Provado contra o plano real do `MCP_teste`: cinco fases
intactas, uma nova no fim.

### 37.3 Substituição é por texto exato

Trocar "a cor de destaque é amarela" por "a cor de destaque é azul" exige citar a
frase antiga **como ela está escrita**. Se não bater, a regra nova entra como
acréscimo e o harness avisa — em vez de apagar em silêncio a linha errada.

O mesmo vale para o resto, com a chave de cada um: entidade por nome, fluxo por
número, regra por texto. Regra não pode ser por assunto: duas regras falam de
`interface.tema` sem serem a mesma, e apagar pelo assunto derrubaria a que
ninguém mandou mexer.

### 37.4 O registro de fases fechadas

O id do run do build é o hash do plano inteiro. Isso sempre resolveu a retomada —
rodar de novo cai no mesmo run —, mas não resolve o plano que CRESCEU:
acrescentar uma fase muda o hash, o run é outro, e as cinco prontas voltam para a
fila para serem verificadas uma a uma. Cinco chamadas de verificador antes de
escrever a primeira linha do que foi pedido.

Agora cada fase que fecha é anotada em `.capivara/handoffs/fases.json` com o
**sha do seu texto**. Um build seguinte pula a fase cujo texto ele já viu fechar.
Por texto e não por id: fase cujo markdown mudou é outra fase, ainda que com o
mesmo número, e volta a ser construída — que é exatamente o certo quando alguém
edita um critério. `--rebuild-all` ignora as duas memórias, a do run e a dos
anteriores: um "tudo" que poupa metade é pior que não existir.

### 37.5 Teto de três fases

Acima de três fases não é mudança, é projeto — e projeto se faz com `init`, onde
há entrevista, auditoria documental e ensaio. O parser recusa e diz isso. É o
mesmo limite que o `MAX_TASKS_PER_PHASE` impõe dentro de uma fase, pela mesma
razão: o que não cabe numa sessão precisa ser dividido por quem sabe dividir.

### 37.6 A dúvida vai à tela antes de virar fase

Quando o pedido é ambíguo — "remover um cliente apaga o histórico?" —, o
planejador emite perguntas e **nenhuma fase**. Planejar sobre a suposição que a
pergunta ainda vai desfazer é como se constrói a coisa errada com toda a
confiança.

Uma rodada só, no máximo três perguntas: a mudança é pequena por definição, e uma
segunda rodada custaria mais que ela inteira. Sem terminal, o comando para e diz
quais decisões faltam — em vez de escolher sozinho e planejar em cima.


## §38 — Prompt guardado é a terceira origem de um pedido

Digitar e apontar um arquivo davam conta enquanto cada pedido era único. Com o
`change`, deixaram de ser: o mesmo pedido volta. "Acrescente o CRUD completo
deste cadastro" serve a três projetos, e redigitá-lo em cada um é exatamente como
as três versões dele começam a divergir — e como a quarta sai pior que a
primeira.

### 38.1 Prompt tem nome

O `pedido` de um projeto é único e é dele. Os guardados são outra coisa, e
precisam de duas identificações diferentes:

- o **nome**, que é o que alguém lê para escolher — "Editar cliente", "CRUD
  completo" —, com uma descrição ao lado para distinguir dois parecidos;
- o **endereço**, que é o que o comando usa: `mcp-teste` é o pedido daquele
  projeto, `mcp-teste/editar-cliente` é um prompt dele, `geral/crud-completo`
  serve a qualquer projeto.

A tela mostra o nome; o endereço fica embaixo, em cinza, e reaparece no comando
equivalente que o wizard imprime. Escolher é pelo nome, repetir é pelo endereço.

### 38.2 As três origens, em todo lugar que pede um pedido

`init` e `change` passam a oferecer as mesmas três — e qualquer comando futuro
que precise de um pedido herda o mesmo caminho:

| origem | linha de comando | wizard |
|---|---|---|
| texto | o argumento | escrever agora |
| arquivo | `--file` | ler de um arquivo |
| prompt guardado | `--prompt <endereço> --mcp <url>` | escolher pelo nome |

`--prompt` sem `--mcp` é recusado dizendo por quê: é na base que eles estão. E
nome que não existe **ensina os que existem** — errar o nome é o caso comum,
eles são muitos e parecidos, e uma mensagem que só diz "não existe" obriga a
abrir a interface da base para descobrir o quê.

### 38.3 O menu que muda de tamanho

A lista de origens do `init` tem duas opções condicionais — projeto da base e
prompt guardado —, e a posição de cada uma depende do que o servidor oferece. A
primeira versão comparava a escolha com um número fixo, e o defeito não era
visível: com base e sem prompts, escolher "prompt" caía em "projeto". Agora as
origens são mapeadas por chave, e a posição não significa nada.

É a mesma família de `-p` casando dentro de `--dangerously-skip-permissions`:
comparar pela forma em vez de pela identidade.


## §39 — Julgamento não se repete sobre o que não mudou

O `MCP_teste2` rodou o mesmo pedido do `MCP_teste`, com outro modelo, e não
passou do `plan`. O log conta o que aconteceu:

| rodada | findings | onde |
|---|---|---|
| 1 | 2 | P4 |
| 2 | **10** | P1, P3, P5 e P8 — as quatro que a rodada 1 **aprovou** |
| 3 | 2 | P1 e P8 |

Nenhuma linha de P1, P3, P5 ou P8 tinha mudado entre a rodada 1 e a 2. O teto de
devoluções estourou com o plano pronto, e o desenvolvedor concluiu que o modelo
não dava conta — quando o que não dava conta era o harness perguntando três vezes
a mesma coisa para um juiz que, por desenho, responde sem memória.

### 39.1 A independência do auditor não é o mesmo que repetição

O auditor não lembra da sessão anterior — é isso que o torna auditor, e não vai
mudar. Mas **perguntar de novo sobre um texto que não mudou não é independência:
é pagar por um sorteio.** Com um modelo mais conservador o sorteio sai aprovado
quase sempre e ninguém percebe; com um mais pedante sai reprovado, e o run morre
sem que nada no documento esteja errado.

Uma fase aprovada passa a ser **fato do run**, registrado pelo sha do texto dela.
Enquanto esse texto não mudar, ela não volta à fila. Reescreveu, volta.

### 39.2 O que continua sendo perguntado toda rodada

A auditoria de **coerência**, que lê o índice de critérios inteiro. É ela que
pega a contradição que nasce quando uma fase muda — e é global por natureza, uma
chamada e não N. O que deixou de se repetir é o julgamento local do que ninguém
tocou, nunca a pergunta sobre o conjunto.

### 39.3 A mesma forma, pela terceira vez

É o terceiro lugar do harness onde a mesma ideia aparece, e por isso vira regra:

| onde | o que não se repete |
|---|---|
| `build`, §37.4 | fase fechada com o mesmo texto não é reconstruída |
| `gate 3`, §35 | o inventário mecânico de testes nomeados não depende da atenção do modelo |
| `plan`, §39 | fase aprovada com o mesmo texto não é reauditada |

Todas as três nasceram do mesmo sintoma: **um juiz consultado duas vezes sobre a
mesma coisa dá respostas diferentes**, e o harness tratava a segunda resposta
como informação nova. Onde a pergunta é idêntica e o objeto não mudou, a resposta
já é conhecida — e perguntar de novo não acrescenta rigor, acrescenta variância.


## §40 — Defeito de forma não pode custar um run

O `plan` do `MCP_teste2` parou com oito fases escritas, seis aprovadas e duas
emendas pendentes. A causa, inteira:

```
Vou conferir o calendário das datas usadas na fase.CAPIVARA_AUDIT_STATUS: APPROVED
```

A frase de abertura e a chave grudadas, sem `\n` no meio. O parser exigia a chave
na primeira coluna, não a achou, repetiu a chamada — e o modelo, sendo o mesmo
modelo, repetiu o mesmo hábito. Duas saídas "inválidas" e o run morreu. O
veredito era **aprovado**, com uma ressalva e um motivo.

### 40.1 Tolerar a embalagem, nunca o conteúdo

A régua já existia em outro lugar do harness: o verificador do build lê as linhas
`TASK` "ignorando prosa em volta e indentação acidental". O auditor documental
tinha régua diferente para o mesmo tipo de desleixo — e a diferença só apareceu
com um modelo de hábitos diferentes, três meses depois de escrita.

O que passou a ser tolerado é embalagem: a chave colada no fim de uma frase,
indentação, marcador de lista na frente, negrito do Markdown em volta. O que
continua cobrado é conteúdo: três campos num finding, um status, um motivo, a
orientação que não repete o problema. Afrouxar o conteúdo seria aceitar uma
devolução que o escritor não consegue fechar; afrouxar a embalagem é deixar de
matar um run por um caractere.

Relido com o parser novo, o run inteiro do `MCP_teste2` se lê: seis fases
aprovadas, duas devolvidas com um finding cada, coerência aprovada. Era um plano
a duas emendas de ficar pronto.

### 40.2 Quando desistir, mostrar o que veio

A mensagem dizia "nenhum CAPIVARA_AUDIT_STATUS na resposta" — verdade, e inútil:
para descobrir que a chave estava lá, colada numa frase, foi preciso abrir o log
com `cat -A`. Agora a recusa mostra os primeiros 300 caracteres do que o auditor
respondeu. A causa cabia na tela desde sempre.

### 40.3 Três parsers, o mesmo defeito

Depois de a auditoria voltar a funcionar, o mesmo run parou de novo — agora no
ensaio, com dez critérios "NÃO ENSAIADOS". A saída do verificador era uma linha
só:

```
Vou cruzar o texto com as decisões.CRITERION P8.T7.C3 …: OBSERVABLE — …
```

O comentário acima do regex do ensaio já contava essa história: no piloto 4, 21
de 72 critérios voltaram como não ensaiados com o verificador tendo respondido
todos, e a conclusão escrita lá é *"o defeito nunca esteve na resposta — estava
em quem a lia"*. A correção daquela vez tolerou prosa em volta e indentação, e
parou aí. Faltava a chave colada na frase anterior.

| parser | o que o modelo escreveu | o que o harness entendeu |
|---|---|---|
| auditoria | `…afirma.CAPIVARA_AUDIT_STATUS: APPROVED` | saída inválida; run parado |
| ensaio | `…decisões.CRITERION P8.T7.C3 …: OBSERVABLE` | critério não ensaiado |
| verificação | `Vou conferir.TASK 1: DONE` | task sem veredito |

Os três passam a usar a mesma função — `desgrudarChaves` —, e o terceiro foi
corrigido antes de aparecer num run: a forma já se provou três vezes, e esperar a
quarta seria esperar de propósito.

### 40.4 A regra

Toda saída de modelo que o harness lê por protocolo tem duas camadas, e elas têm
donos diferentes: a **forma** é responsabilidade de quem escreveu o parser, e o
**conteúdo** é responsabilidade de quem respondeu. Um parser que trata desleixo
de forma como erro de conteúdo transfere para o modelo uma exigência que é nossa
— e cobra dela o preço mais caro que existe no harness, que é um run inteiro.


## §41 — O preflight confere o que o projeto declara para si

A fase 1 do `MCP_teste2` queimou os três ciclos sem sair do lugar, e o log do
executor conta tudo:

> A suíte quebrou porque o pacote `tsx` não estava instalado. Vou instalar as
> dependências. **O shell foi bloqueado.** Vou tentar de novo pedindo permissão.
> […] Vou fazer o comando de teste carregar TypeScript com o Node, sem depender
> desse pacote.

O `package.json` declarava `tsx` em `devDependencies` e o `node_modules` nunca
tinha existido naquele diretório. O `npm test` morria por falta de pacote, o gate
2 devolvia a fase, e o executor — que não tem permissão de shell para instalar,
porque a permissão é de quem invocou a CLI dele — fez a única coisa que lhe
restava: **reescreveu o comando de teste do projeto** para não precisar da
dependência.

Um defeito de ambiente virou mudança de produto. É o §34.8 pelo avesso: lá o
harness culpava o produto por um defeito de ambiente; aqui ele empurrou o
executor, cercado, a mudar o produto para caber no ambiente.

### 41.1 Duas perguntas diferentes

O preflight sempre conferiu os binários de SISTEMA que a stack exige — `node`,
`psql`, `docker` —, lendo a seção `## Stack` do esqueleto. Nunca conferiu o que o
**projeto declara para si**, que é outra pergunta e tem outra resposta:

| pergunta | onde mora | como se confere |
|---|---|---|
| a stack existe nesta máquina? | `## Stack` do esqueleto | `which node` |
| as dependências estão instaladas? | `package.json` do projeto | existe `node_modules/`? |

A segunda é a que falha no primeiro build de um projeto cujo `init` rodou noutra
máquina, ou que nunca teve `npm install` — e custa um ciclo por vez para
descobrir.

### 41.2 Curto de propósito

Só `package.json → node_modules/` e `composer.json → vendor/`. Go guarda módulos
num cache global, Rust compila sob demanda, Python instala num virtualenv que
pode estar em qualquer lugar: nesses, a ausência da pasta não prova nada, e um
falso positivo bloquearia um build válido. É o mesmo critério do catálogo de
pré-requisitos, pela mesma razão.

Manifesto que não declara dependência nenhuma também não exige instalação, e
manifesto ilegível não vira bloqueio: quem julga a forma dele é outro gate.

### 41.3 A causa raiz era uma flag

O `MCP_teste2` rodou pela CLI do Cursor, e o adaptador dela mandava para o
executor exatamente os mesmos argumentos do papel de escrita: `-p
--output-format json --trust`. O `--help` da própria CLI explica o que faltava:

```
-p, --print   Has access to all tools, including write and shell.
-f, --force   Force allow commands unless explicitly denied (default: false)
```

`-p` dá acesso às ferramentas e `--trust` confia no diretório; cada comando
ainda para numa aprovação. Numa chamada `-p` não há quem aprove, e aprovação
pendente vira negação. Reproduzido em vinte segundos, com a mesma frase que o
executor usou no run:

| chamada | o que aconteceu |
|---|---|
| `-p --trust --force` | criou o arquivo, respondeu OK |
| `-p --trust` | *"O comando foi bloqueado; vou tentar de novo. O comando `touch provou.txt` foi bloqueado pelo ambiente."* |

Escrever ele podia; executar, não — e a diferença entre as duas é uma flag. Foi
por isso que o executor, cercado, foi reescrever o comando de teste do projeto:
era a única coisa que ele ainda tinha permissão de fazer.

Acesso de sistema, além disso, desliga o sandbox (`--sandbox disabled`), como o
`danger-full-access` do codex — `--force` libera o comando, e o sandbox ainda
podia recusar o que ele faz.

### 41.4 Aviso, nunca bloqueio

A primeira versão desta conferência reprovava o build e mandava rodar `npm
install` antes. Está errada, e a correção veio do desenvolvedor em uma frase: *"o
objetivo não é ajudar o modelo a criar a aplicação, é dar munição para que ele
consiga sozinho"*.

Instalar o que o projeto declara é **trabalho do executor**. Exigir que alguém
prepare o ambiente antes troca o problema de lugar: transforma um harness que
arma quem executa num harness que pede preparação a quem chama — e o dia em que
o `build` roda sozinho de madrugada é justamente o dia em que não há ninguém para
preparar nada.

Então o preflight avisa e segue. A mensagem diz o que vem pela frente — *"o
executor instala na primeira sessão"* —, e só depois o remédio para o caso em que
a CLI recusar o comando. Quando isso acontece, a causa não é a dependência: é a
permissão, e ela se conserta no adaptador (§41.3).


## §42 — Toda CLI é conferida executando, nunca lendo a flag

Depois do `--force` do cursor, a pergunta certa era: as outras conseguem? A
resposta só vale medida, e medi as três com o argv que o harness realmente monta
— um diretório temporário, um `touch` e um `npm install` de verdade.

| CLI | executa comando? | onde executa | instala dependência? |
|---|---|---|---|
| cursor | **não**, sem `--force` | projeto | depois do `--force`, sim |
| opencode | sim | projeto (`--dir`) | sim |
| agy | sim | **`~/.gemini/antigravity-cli/scratch`** | sim, no lugar errado |

### 42.1 O `agy` não trabalha onde foi lançado

Esta é a que ninguém acha lendo documentação. A CLI da Antigravity ignora o
diretório em que o processo nasce: um `pwd` pedido a ela responde
`/home/<usuário>/.gemini/antigravity-cli/scratch`. O adaptador nunca lhe dizia
onde era o projeto — o parâmetro `projectRoot` chegava ao `build()` e não era
usado.

O defeito não aparece como erro. O comando roda, o `npm install` instala, a suíte
executa — tudo na pasta errada. Do lado do harness, o sintoma é o gate 1 dizendo
que a sessão não escreveu nada, com a causa a um diretório de distância.

`--add-dir <raiz>` resolve, e foi medido nas duas pontas: sem ele, `pwd` responde
o scratch; com ele, responde a raiz do projeto, e o arquivo aparece onde deveria.

### 42.2 A prova é o efeito colateral

A primeira medição que fiz do `agy` foi ruim: pedi para ele rodar `echo
CAPIVARA-7731` e devolver a saída. Ele devolveu — e isso não prova nada, porque
a saída de um `echo` é adivinhável sem executá-lo. Um modelo que não consegue
rodar comando nenhum acerta essa resposta.

O que prova é o **efeito colateral observável de fora**: um arquivo que aparece,
um `node_modules` que passa a existir, um `pwd` cujo valor é um diretório
temporário de nome aleatório. Vale para medir CLI e vale para medir modelo — a
diferença entre "ele disse que fez" e "está feito" é a única que interessa.

### 42.3 A regra

CLI nova entra no harness com uma medição, não com uma leitura do `--help`. As
três perguntas são sempre as mesmas, e as três já apanharam alguém:

1. o executor consegue rodar um comando? (cursor: não, faltava `--force`)
2. ele roda no diretório do projeto? (agy: não, faltava `--add-dir`)
3. ele consegue instalar uma dependência declarada? (as três: sim, uma vez
   resolvidos os dois primeiros)


## §43 — Porta fixa é armadilha de ambiente

A fase 2 do `MCP_teste2` reprovou no último ciclo com esta linha:

```
Error: http://127.0.0.1:47533 is already used, make sure that nothing is running
on the port/url or set reuseExistingServer:true
```

E o gate traduziu para o executor: *"a aplicação NÃO SUBIU"*. Ela subia. O que
havia na porta era um `next-server` que o **próprio executor** tinha iniciado no
ciclo anterior para conferir o trabalho dele — e que ele declarou ter encerrado:

> O servidor na porta 47533 subiu e respondeu em `/` e em `/entrar`. Eu encerrei
> esse processo depois da verificação.

Não encerrou. Ficou vivo, e o gate seguinte morreu nele.

### 43.1 Por que a porta era fixa, e por que isso estava errado

Um número fixo é previsível: aparece no prompt do roteirista, na configuração e
na mensagem de erro, e não muda entre execuções. O preço é que **qualquer
processo esquecido vira reprovação** — do executor, de um run anterior, de outro
projeto, ou do desenvolvedor que deixou um `npm start` aberto noutro terminal.

A porta passa a ser escolhida livre a cada passagem do gate, com 47533 como
primeira tentativa. Como a configuração do Playwright já era gerada a cada
passagem, e o roteiro usa caminhos relativos, nada mais precisou mudar — exceto
o prompt do roteirista, que agora recebe do gate a URL que o gate escolheu, em
vez de montá-la a partir da constante.

### 43.2 E quando ela for ocupada mesmo assim

A janela entre escolher a porta e o Playwright abri-la é pequena e real. Quando
alguém a toma nesse intervalo, o gate agora diz o que é:

> a porta N foi ocupada por outro processo entre a escolha e a subida, e o gate
> não chegou a abrir a aplicação. **Isto é do ambiente, não do seu código:** nada
> precisa ser corrigido na implementação.

É o §34.8 outra vez, e a terceira vez que ele aparece no gate 4 — envelope,
aplicação que não sobe, pacote ausente, e agora porta ocupada. A regra continua
valendo: toda causa devolvida ao executor diz de quem é o defeito.

### 43.3 O processo órfão continua sendo um problema

Nada aqui mata o servidor esquecido: ele é do executor, não do harness, e matar
processo alheio por número de porta é o tipo de atalho que um dia derruba o
banco de desenvolvimento de alguém. O que o harness faz é deixar de depender
daquela porta específica — e o órfão fica onde está, visível, para quem quiser
encerrá-lo.


## §44 — O executor pode dizer que o roteiro está errado

A fase 4 do `MCP_teste2` reprovou no gate 4 assim:

```
Locator: locator('section')
  .filter({ has: getByRole('heading', { name: 'Novo cadastro' }) })
  .locator('form')
  .getByRole('heading', { name: 'Novo cadastro', exact: true })
Expected: visible — element(s) not found
```

Leia o seletor: ele acha a seção **pelo título**, desce para o `form` de dentro
dela, e procura ali o mesmo título. O título é irmão do formulário, não filho. O
roteiro estava errado.

E o executor, no ciclo seguinte, escreveu isto:

> O título "Novo cadastro" está na seção, fora do `form`. O fluxo procura esse
> heading dentro do formulário — vou colocá-lo lá. […] O `h2` agora é o primeiro
> filho do formulário de inclusão.

**O produto foi remodelado para caber num seletor.** A fase passou, a suíte ficou
verde, e a aplicação ficou pior: um título de seção virou filho de um formulário
porque um teste o procurava ali. Ninguém decidiu isso — foi a única saída que o
harness deixava.

### 44.1 A saída que faltava

Contra um gate 4 vermelho, o executor só podia mexer no produto. Agora o prompt
de correção do gate 4 — e só dele — oferece a outra:

```
CAPIVARA_ROTEIRO_ERRADO: <por quê>
```

Quando ele responde assim, o harness reescreve o ROTEIRO antes de rodar de novo,
passando o motivo a quem reescreve. Uma vez por fase.

### 44.2 Por que isso não vira atalho

O escape se corrige sozinho, e é isso que o torna aceitável:

- quem reescreve é **outra sessão**, que lê o produto de novo — não o executor
  que contestou;
- se o produto estiver mesmo errado, o roteiro novo reprova igual, e a fase
  continua devendo o que devia;
- o prompt diz isso com todas as letras: *"use quando você estiver certo, e
  conserte o produto quando não estiver"*.

Não há como ganhar tempo mentindo: a mentira custa uma sessão de roteirista e
devolve o mesmo vermelho.

### 44.3 A família

É a terceira forma do mesmo problema no gate 4, e as três têm a mesma pergunta:
**de quem é o defeito?**

| sintoma | quem errou | como o harness decide |
|---|---|---|
| seletor casa com dois elementos | roteiro | mecânico: `strict mode violation` |
| porta ocupada, app não sobe | ambiente | mecânico: `is already used` |
| seletor exige estrutura que ninguém pediu | roteiro | **só quem leu os dois sabe: o executor diz** |

As duas primeiras o harness reconhece sozinho. A terceira não tem sinal
mecânico — "elemento não encontrado" é idêntico quando o produto está errado e
quando o roteiro está. Aí a decisão vai para quem tem a evidência na mão, com um
custo que impede o abuso.

## §45 — Toda parada diz as mesmas quatro coisas

O harness parava e o desenvolvedor perguntava o que aconteceu. Não uma vez: toda
vez. A informação sempre esteve em disco — `events.tsv`, `run.json`, o log do
gate —, e a mensagem na tela não respondia nenhuma das perguntas que se faz em
seguida.

O pior caso era o build: ele terminava com `process.exitCode = 2` e **nada**
impresso, porque o `announce` já tinha contado a falha minutos antes, e a
rolagem do terminal já a tinha levado embora.

### 45.1 O formato

Todo ponto de parada — build, `init`, `plan`, `survey`, `change` — imprime o
mesmo bloco:

```
PAROU — dependência de ambiente

  o quê       P04 — o runner de testes não está instalado
  de quem     do ambiente desta máquina; seu código não foi tocado
  custou      3 de 8 fase(s) fechada(s); elas não serão refeitas
  evidência   .capivara/runs/build-9f2a/logs/P04.cycle-3.log

  para seguir
    1. resolva a dependência de ambiente apontada acima
    2. rode `capivara build` — retoma de P04
```

Cada campo existe porque a falta dele custou tempo:

| campo | responde | o que custou não tê-lo |
|---|---|---|
| o quê | o que aconteceu | "saída inválida" sem dizer o que veio |
| de quem | quem trabalha agora | executor mandado consertar o que não quebrou |
| custou | o que se perdeu | pânico de "perdi o run" quando nada se perdeu |
| evidência | onde está a prova | meia hora procurando o log certo |
| para seguir | o que fazer | achar que quebrou quando era só continuar |

`custou` é o campo menos óbvio e o que mais muda a leitura: **"nenhuma sessão
gasta" é uma informação completamente diferente de "parou"**.

### 45.2 De quem é o defeito, decidido por quem já sabia

A classificação não é adivinhada da saída do modelo: ela lê a mensagem que o
próprio gate escreveu. `gates.ts` já distingue "o runner não está instalado" de
"dois testes falharam"; `flows.ts` já distingue "a porta está ocupada" de "o
fluxo reprovou". O tradutor (`loop/parada.ts`) só transporta a decisão que já
tinha sido tomada — e o teste quebra se alguém reescrever um desses textos sem
reescrever o tradutor.

Gate 0 vermelho é da **sessão do modelo**; gates 2, 3 e 4 são do **produto**,
salvo quando o gate disse que é do ambiente; código de saída 1 não é defeito de
ninguém — é uma etapa fora de ordem, e dizer "PAROU — defeito" a quem esqueceu
de rodar o `init` manda a pessoa procurar um problema que não existe.

### 45.3 A telinha

O relatório responde ao "o quê"; o log responde ao "por quê", e o log não cabe no
terminal. Quando há TTY, a parada abre um modal centrado com o cabeçalho FIXO —
as quatro respostas à vista — e o log rolando com `↑ ↓`, `PgUp`/`PgDn`, `g`, `G`,
`q`.

Duas decisões que não se negociam:

- **o texto puro é o piso.** Ele é impresso DEPOIS de o modal fechar, porque a
  tela alternativa apaga tudo ao sair. Sem TTY o modal não abre e a saída é
  idêntica — um harness que precisa de tela interativa para se explicar é um
  harness que não roda em CI;
- **o terminal é sempre restaurado.** Modo raw, cursor e tela alternativa voltam
  no `finally`, mesmo se o desenho quebrar no meio.

`--no-modal` e `CAPIVARA_MODAL=never` desligam a telinha sem tirar nada do texto.

## §46 — O banco é decisão de entrevista; as regras são do harness

Toda pergunta da entrevista é levantada por quem escreve. Uma não: **o banco**. É
a única decisão que o executor não consegue tomar e não consegue contornar — sem
conexão, ele inventa uma, e uma conexão inventada faz o gate passar contra nada.

Por isso a pergunta é do harness (`interview/banco.ts`), entra sempre e entra
primeiro. Quatro opções: banco embutido no projeto (recomendada), servidor que já
existe com a conexão vinda do `.env`, servidor instalado nesta máquina durante o
build, ou aplicação sem persistência.

### 46.1 As regras transversais, escritas pelo harness

A escolha vira regra do esqueleto **depois do parser**, onde nada pode
reescrevê-la — o mesmo caminho dos não-objetivos (§35), e pelo mesmo motivo:
pedir ao escritor que reproduza a regra é pedir que ele a reescreva, e regra
reescrita é regra diferente.

Quatro valem para qualquer banco:

1. a conexão inteira vem de variáveis de ambiente carregadas do `.env`; nenhum
   arquivo versionado, documento ou log contém credencial, e `.env` está no
   `.gitignore` desde a primeira fase;
2. o projeto versiona um `.env.example` com todas as variáveis que lê, com
   valores de exemplo e nenhuma credencial real;
3. existe **um** comando de migração que cria o esquema a partir de um banco
   vazio e pode ser repetido — é o que o desenvolvedor roda depois de preencher
   o `.env`;
4. a suíte e os fluxos rodam contra um banco **descartável**; nenhum teste toca
   o banco configurado no `.env`.

É o padrão que o Laravel ensinou a uma geração, e é o que permite ao harness
verificar o produto sem nunca abrir o banco de quem o encomendou.

### 46.2 A aceitação não leva o `.env` junto

A aceitação operacional copia o projeto para uma pasta limpa e roda instalação,
**migração** e subida. Copiar o `.env` junto faria o harness migrar o banco de
produção de quem o chamou, sem nunca ter pedido licença.

Então `.env` não atravessa para a cópia, e o `.env.example` entra no lugar dele
como `.env`. Sem `.env.example`, nenhum ambiente é inventado. É a regra 4 do item
anterior, executada pelo harness em vez de prometida ao modelo.

### 46.3 O `.env` que ninguém criou

A regra manda o projeto ler tudo do ambiente e versionar só o `.env.example`.
Isso deixa um buraco exatamente onde o harness trabalha: o executor entrega o
exemplo, o `.env` não existe em máquina nenhuma, e a aplicação sobe sem saber
onde está o banco.

O estrago não aparece como erro de configuração. No primeiro projeto a usar a
regra — o `teste`, no WSL — o servidor registrou, a cada requisição:

```
[WebServer] ⨯ Error: DB_NAME deve indicar um nome de arquivo dentro da pasta
            do projeto ou um caminho absoluto.
```

A página vinha vazia, todo passo do roteiro morria esperando um campo que nunca
seria renderizado, e o gate 4 relatou **"a aplicação não cumpriu um fluxo
declarado"** apontando o seletor. O executor foi consertar um formulário que
estava certo.

Duas correções, porque são dois defeitos:

- **antes dos gates, o `.env` é semeado do `.env.example`** se não existir. A
  aceitação operacional já fazia isso na cópia limpa (46.2) e faltava no irmão,
  que é onde os gates rodam — a mesma correção pela metade que este projeto já
  pagou duas vezes. Nunca sobrescreve um `.env` existente, que é do
  desenvolvedor e pode apontar para o banco dele; nunca inventa valor, porque o
  que entra é o exemplo versionado, que por regra não tem credencial;
- **o erro da aplicação vem primeiro na causa do gate 4**. O runner prefixa a
  saída do servidor com `[WebServer]`, e ela some no meio de quarenta linhas de
  rastro do Playwright. Quando há erro ali, a causa começa dizendo que *a
  aplicação* errou — porque a ordem é o conserto: o executor lê o começo da
  mensagem e age.

É a quarta forma de "de quem é o defeito?" no gate 4, e a mais traiçoeira: as
outras três falham ruidosamente, esta falha parecendo defeito de produto.

## §46.5 — Configurar sem migrar não é preparar ambiente

Com o `.env` semeado e o roteiro consertado, a aplicação subiu, o roteiro rodou,
e o servidor respondeu isto a cada requisição:

```
[WebServer] ⨯ Error: no such table: clientes
[WebServer] ⨯ Error: no such table: filmes
```

O banco existia — o arquivo estava lá, criado pelo driver. As tabelas não. A
migração que a regra do §46 manda o projeto entregar **nunca foi executada pelos
gates**: ela só rodava na aceitação operacional, na cópia limpa, no fim do build.

É a correção pela metade outra vez, e desta vez a metade era minha: eu escrevi o
semeador do `.env` e deixei o esquema para o log descobrir. Configuração sem
esquema é um ambiente que sobe e não serve.

### O que impede isso de virar migração no banco de quem chamou

Migração cria e altera esquema. Rodá-la contra o `.env` que o **desenvolvedor**
escreveu seria exatamente o que o §46 promete que nunca acontece.

Então o `.env` que o harness gera leva uma marca na primeira linha, e ela governa
a decisão:

```
# capivara: ambiente descartável dos gates, gerado de .env.example — apague esta linha para assumi-lo
```

- `.env` com a marca: é nosso, é descartável, o harness migra antes de cada
  passagem dos gates — a cada ciclo, porque cada fase acrescenta tabela e a regra
  exige que a migração possa ser repetida;
- `.env` sem a marca: é de quem o escreveu. Não semeia, não migra, não
  sobrescreve. E a linha dá a saída: apagar a marca é como o desenvolvedor assume
  o arquivo.

O comando é o que o projeto **declara** (`migrate`, no manifesto), nunca um
adivinhado — a mesma disciplina que fez o gate 4 parar de impor `NODE_ENV=test` a
produto alheio.

### E quando não há migração declarada

O gate 4 passa a reconhecer `no such table` e equivalentes de Postgres, MySQL e
SQLite, e a causa diz onde se corrige:

> Isto é ESQUEMA AUSENTE: o banco existe e as tabelas não. O harness aplica a
> migração que o projeto declara no manifesto (`migrate`) antes de cada passagem
> dos gates — então ou ela não está declarada, ou ela não cria estas tabelas. É
> ali que se corrige, não no roteiro nem na tela.

## §46.4 — O roteiro não sobe a aplicação

Com o `.env` semeado, a aplicação passou a subir — e o gate 4 reprovou de novo,
com isto:

```
Error: O servidor de teste encerrou antes de abrir a página de clientes.
  57 |   while (Date.now() < limite) {
  58 |     if (erroServidor || servidor.exitCode !== null) {
> 59 |       throw new Error('O servidor de teste encerrou antes de abrir a página…
```

Leia de onde vem a mensagem: **do próprio roteiro**. O roteirista escreveu
oitenta linhas antes do primeiro passo — importava `child_process`, subia um
segundo servidor numa porta escolhida por ele, e consultava com `fetch` até
responder. Esse servidor morria, e o gate relatava a morte de um processo que o
harness nem sabia que existia, enquanto a aplicação de verdade estava de pé ao
lado, servida pelo `webServer` que o loop configura.

Quem constrói, sobe e espera o produto responder é o harness — é isso que dá ao
gate a autoridade de afirmar que a aplicação está de pé naquela URL. Um roteiro
que sobe a própria cópia não prova nada sobre o que foi construído.

Duas conferências novas, mecânicas, antes de abrir navegador nenhum:

- **importar `child_process` reprova o roteiro.** A dica diz o que ele precisa
  saber: *a aplicação JÁ ESTÁ DE PÉ quando o roteiro começa*;
- **URL absoluta para `127.0.0.1` ou `localhost` reprova o roteiro.** Onde a
  aplicação vive é decisão do harness; fixar o endereço é como um roteiro acaba
  provando algo sobre outro processo.

E o prompt passa a dizer isso antes, em vez de deixar o modelo descobrir pela
recusa.

A conferência vale também para o roteiro GUARDADO: um script de run anterior que
não passe nas regras de hoje é reescrito na próxima passagem, sem ninguém
precisar apagar arquivo.

## §47 — O `doctor` confere o ambiente dos GATES

O `doctor` sempre conferiu o que o *harness* precisa: Node, CLI no PATH,
credencial, árvore limpa. Nada disso é o que quebra na hora do gate.

O que quebra é o gate 2 precisando compilar um módulo nativo numa máquina sem
compilador, e o gate 4 abrindo um navegador que nunca foi baixado. Três itens
novos, nenhum bloqueante — cada um vale para o projeto que o usa:

| item | para quê | macOS | Linux |
|---|---|---|---|
| `sqlite3` | a suíte de um projeto que guarda dados em SQLite | `brew install sqlite` | `apt install sqlite3` |
| compilador C e `make` | drivers de banco e outros módulos nativos | `xcode-select --install` | `apt install build-essential` |
| navegadores do Playwright | o gate 4 | `npx playwright install` | `npx playwright install` |

O comando é o **daquele sistema**: "instale as ferramentas de compilação" não é
acionável no Mac de quem nunca abriu o Xcode.

## §48 — O visor de runs é opcional por construção

O doc-center ganhou uma tela que lê `.capivara/runs/<run>/` e mostra eventos,
logs e estado de fase. Ela é uma comodidade sobre arquivos que já existiam.

A restrição que define o desenho: **o harness não sabe que ela existe**. Não fala
com ela, não a procura, não muda de comportamento se ela estiver fora do ar. A
dependência é de uma direção só — disco escrito lá, disco lido aqui — e é por
isso que o harness continua rodando inteiro numa máquina onde o doc-center nunca
foi instalado.

Só leitura, também literalmente: nada naquele módulo escreve, apaga ou renomeia.
O pior que uma falha dele pode fazer é não mostrar uma página. Desligado — que é
o padrão —, a rota explica como ligá-lo (`doc-center --runs <pasta>`) em vez de
dar 404: um link morto ensina menos que uma frase.

## §49 — O auditor não pode pedir o que o escritor está proibido de escrever

O `plan` do `assitencia` parou depois de escrever e auditar **18 fases**. Dezesseis
foram aprovadas. As duas que sobraram trouxeram, nas três devoluções, o mesmo
achado:

> Os critérios restringem status e recorrência a valores enumerados, mas não
> exigem sua modelagem em tabelas de domínio, **conforme o eixo CONFORMANCE**.

O auditor estava certo sobre o eixo: ele perguntava, palavra por palavra, *"Are
enumerable fields modelled as lookup tables?"*. E o escritor não tinha como
fechar o achado — criar as tabelas seria inventar estrutura que o esqueleto não
declara, e o eixo 1 o proíbe de inventar o que nenhuma fonte diz.

**Dois eixos do mesmo prompt em lados opostos, e o escritor no meio.** Ele não
cedeu, o auditor não cedeu, as três rodadas queimaram, o run parou num impasse —
e as 18 fases escritas foram embora junto, porque o plano só é publicado no fim.

### 49.1 A ironia, que é o que torna isto uma família

Duas linhas abaixo, o mesmo eixo já dizia:

> Never review SQL here, never ask for DDL here, and never demand that a notation
> express what it has no syntax for: **each of those is a finding the writer
> cannot close, and three in a row stop the run.**

A frase descreve exatamente o que aconteceu. Ela foi escrita depois de um
incidente anterior da mesma natureza, e a cláusula das tabelas de domínio ficou
ali em cima, imune ao próprio aviso. É a correção pela metade outra vez.

### 49.2 A regra

Técnica de modelagem é decisão do **esqueleto**, nunca da auditoria. O eixo
CONFORMANCE passa a dizer:

> NEVER demand a modelling or implementation technique the skeleton does not
> state — a lookup table for an enumerated field, a soft delete, an audit column,
> an index, a trigger. […] demanding it puts him between two axes with no way
> out. If the skeleton DOES state it and the phase dropped it, that is a FIDELITY
> finding and you raise it as one.

Nada se perde em rigor: se o esqueleto exige a tabela de domínio e a fase a
largou, continua sendo achado — de fidelidade, que é o eixo a que ele sempre
pertenceu.

### 49.3 O teste que fica

Todo achado precisa ter uma escrita que o feche. Antes de acrescentar uma
pergunta a um eixo, a pergunta é: *existe um texto que o escritor possa produzir,
sem violar outro eixo, que responda a isto?* Se não existir, a pergunta não é uma
auditoria — é um impasse programado.

## §50 — Critério se prova lendo o repositório

O `plan` do `assitencia` publicou as 18 fases e parou em NOT READY num único
ponto: o ensaio do verificador declarou um critério IMPOSSÍVEL.

```
P1.T1.C2 · Inicializar a aplicação Next.js com Tailwind CSS, shadcn/ui e a base
visual compartilhada. — UNSATISFIABLE: Exige uma base documental frontend-design
fornecida como referência; a decisão "Sistema visual próprio" define que a
referência visual será criada pelo projeto.
```

A cadeia inteira foi fiel, e é isso que faz dela uma família:

1. o projeto na base documental tem uma **skill** chamada `frontend-design`;
2. o harness a entregou ao escritor junto do material do projeto;
3. ele a citou na pergunta da entrevista — *"a base frontend-design exige uma
   direção visual intencional"*;
4. a resposta aceita carregou o nome;
5. o esqueleto virou regra transversal: *"conforme a base documental
   frontend-design fornecida"*;
6. cada fase copiou a regra para dentro dos critérios.

Ninguém inventou nada. E o critério é improvável, porque **a skill não está no
repositório que o verificador lê**: ele procura o documento, não acha, e reprova
uma fase correta. Foi o ensaio que pegou, duas vezes — corrigiu o P5, e o irmão
no P1 apareceu na rodada seguinte, quando o teto acabou.

### 50.1 A regra

Uma skill é insumo de quem CONSTRÓI — ela vai para a sessão do executor na fase
em que serve. Não é documento que um critério possa citar. O esqueleto e o
escritor de fase passam a dizer isso, e a dizer a troca:

> "O sistema visual segue a base frontend-design" não se verifica; "a paleta, a
> escala de espaçamento e a tipografia estão definidas num módulo compartilhado e
> toda tela as importa de lá" se verifica.

Proibir sem ensinar a troca deixaria o escritor sem saída — que é exatamente o
defeito do §49.

### 50.2 A causa ficou de pé por mais um dia

O §50 consertou o lado de quem ESCREVE: um critério não pode citar documento fora
do repositório. E o run continuou travando — até o desenvolvedor **remover a
skill de frontend do projeto**, e o `plan` fechar de primeira em RALPH READY.

O que faltava estava do outro lado, no bloco que entrega o material da base ao
escritor:

> Selecionados para ESTE projeto por quem o cadastrou. São decisões já tomadas:
> não os trate como sugestão, não os contradiga… — **cite-os quando precisar**.

Uma skill entrava ali junto das memórias, e o escritor fez exatamente o que lhe
foi mandado: citou. Duas instruções nossas em lados opostos, e o modelo no meio —
o mesmo formato do §49, desta vez entre dois prompts em vez de dois eixos.

Agora o bloco separa por natureza:

- **decisão** (memória, levantamento, documento): autoridade sobre O QUE o
  produto faz, e citável;
- **skill**: instrução de COMO construir, entregue a quem escreve o código na
  fase em que serve. *"Aplique o que elas ensinam; NUNCA as cite"*, com o motivo
  junto — quem verifica lê o repositório, não encontra a base, e reprova um
  trabalho correto.

### 50.3 O parente

É o mesmo problema do `Design ref`, que já tinha parágrafo próprio: um caminho
inventado ali é referência morta, o harness procura o arquivo e recusa a fase. A
regra existia para o CAMPO e faltava para a PROSA. Correção pela metade de novo,
e desta vez a metade ausente custou 90 minutos de escritor.

## §51 — O `plan` não repaga o que já escreveu

O `build` nunca refez fase fechada — o ledger existe desde o §33. O `plan`
refazia tudo, e é ele o estágio caro.

O `assitencia` cobrou a conta duas vezes no mesmo dia: o run morreu no impasse do
auditor, foi reiniciado do zero, chegou ao fim e morreu no ensaio do verificador.
Nas duas vezes as 18 fases foram reescritas inteiras — **5.190 segundos de
escritor por passada** — para produzir o mesmo texto, porque o que estava escrito
estava certo.

### 51.1 A chave é o prompt, não a saída

Guardar "a fase 5 já foi escrita" seria errado: se o esqueleto mudar, se uma
decisão nova entrar, ou se NÓS melhorarmos o prompt do escritor, a fase 5 de
ontem não serve mais.

O sha do **prompt** carrega tudo isso junto — fatia do esqueleto, regras
transversais, gramática da task, tetos — e muda quando qualquer um deles muda. O
mesmo vale para a aprovação, cuja chave é o sha do prompt de AUDITORIA: ele
contém o texto da fase e o que o auditor foi instruído a julgar, então mexer num
eixo (como no §49) derruba sozinha toda aprovação anterior.

É um cache que se invalida sozinho. Um que dependesse de alguém lembrar de
limpá-lo mentiria no primeiro dia em que mudássemos um prompt.

### 51.2 Quando ele grava

A cada fase, e não no fim. O valor inteiro está em sobreviver ao run que morre no
meio, e um cache salvo só no fim morre junto com ele. As fases são escritas em
paralelo, então as gravações entram numa fila encadeada — duas gravações
simultâneas do mesmo arquivo perderiam uma.

E há um `await` explícito depois de escrever todas as fases, antes de a auditoria
começar: é ali que o dinheiro já gasto fica seguro, logo antes da parte que mais
mata run.

### 51.3 A saída

`capivara plan --fresh` reescreve tudo, para quem quer descartar o que foi
produzido. O `init` já tinha a flag; o `plan` não — e uma retomada sem porta de
saída é uma armadilha em vez de uma economia.

## §52 — Dimensionamento: consolidar, porque dividir não é jogada dele

O `plan` do `assitencia` parou num segundo impasse, e o relatório do próprio
impasse conta a história inteira:

```
O auditor insiste em:
  · Phase 18: a fase declara 17 tasks e uma fase é uma sessão de agente
    correção pedida: divida em mais fases de topo até nenhuma passar de 15 tasks

O escritor fez:
  1. tentativa 1: escreveu o documento; o auditor apontou 29 ponto(s)
  2. tentativa 2: reescreveu — fechou 29 de 29, 3 apareceu(ram) novo(s)
  3. tentativa 3: reescreveu — fechou 3 de 3, 20 apareceu(ram) novo(s)
  4. tentativa 4: reescreveu — fechou 20 de 20, 2 apareceu(ram) novo(s)
  5. tentativa 5: reescreveu — fechou 2 de 2, 1 apareceu(ram) novo(s)
```

Ele fechou **54 de 55 achados**. O que sobrou era o único que ele não podia
fechar: quem recebe essa correção escreve UMA fase, cujo número, título, goal e
cobertura vêm do esqueleto e são montados em código. **Criar fase não é uma
jogada que ele tenha.**

### 52.1 A correção estava escrita na linha de baixo

As duas metades do mesmo ternário, no self-check de dimensionamento:

| ramo | o que manda fazer |
|---|---|
| tasks acima do teto | ~~"divida em mais fases de topo"~~ |
| critérios acima do teto | "consolide… **criar fases novas é decisão do plano, não desta reescrita**" |

O ramo dos critérios já tinha aprendido a lição e a escrito. O ramo das tasks
ficou como estava, a três linhas de distância. É a mesma família do §49 — achado
que o escritor não pode fechar — e a mesma correção pela metade de sempre.

Agora os dois mandam **consolidar**: duas tasks que entregam a mesma capacidade
viram uma, nada verificável desaparece, e se ainda não couber ele DIZ isso em vez
de apagar trabalho.

### 52.2 E o teto chega antes

O esqueleto alocou **12 tasks** para a fase 18. A fatia dizia `Tasks alocadas:
12`. O escritor escreveu 17 — porque o número estava lá como dado, e nunca como
instrução.

O prompt da fase passa a dizer que a alocação é orçamento, que o harness conta e
recusa acima do teto, que ele é o único que pode consertar, e qual é a saída:
task maior, nunca capacidade a menos.

## §53 — O `plan` também mostra as fases

O `build` sempre teve a tela: uma linha por fase, as bolinhas dos gates, o ciclo
corrente. O `plan` não tinha nada — e ele é o estágio LONGO, dezenas de chamadas,
minutos calado dentro de cada uma. Quem olhava via log passando e não sabia em
que fase ele estava, quantas faltavam, nem se a auditoria já tinha começado.

Agora ele desenha a mesma tabela, com **duas colunas em vez de cinco**:

```
FASES · 6/18 fases · auditoria
  ✓ P05 Estrutura visual e navegação      E● A●  aprovada
  ✓ P06 Cadastro de clientes              E● A●  aprovada
  ● P07 Abertura da ordem de serviço      E● A●  devolvida · 3 finding(s)
  ● P08 Cálculo dos vencimentos           E● A●  auditando
  ● P09 Movimentação da ordem             E● A○  escrevendo
    P11 Anexos da ordem                   E○ A○  aguardando
```

**E**scrita e **A**uditoria são as duas coisas que acontecem com uma fase antes
de ela estar pronta. Fase reaproveitada do cache (§51) acende o E verde e diz
`reaproveitada`: ela ESTÁ escrita, e o que não houve foi a chamada — pintá-la de
apagado sugeriria que falta fazer algo ali.

As etapas que são do documento inteiro — lacunas, auditoria de coerência, ensaio
do verificador — não viram linha de fase: entram no resumo, ao lado da contagem.

### 53.1 Um desenho, duas telas

A coluna virou parâmetro de `renderPhaseRows` em vez de nascer um segundo
desenho. Manter dois renderizadores de linha de fase é manter dois que divergem —
e o primeiro sintoma seria o `plan` deixando de ganhar a correção que o `build`
ganhasse.

## §54 — O adjetivo que inventa uma regra

O terceiro impasse do `assitencia`, e o de assinatura mais clara:

```
1. tentativa 1: escreveu o documento; o auditor apontou 23 ponto(s)
2. tentativa 2: reescreveu — fechou 23 de 23, 15 apareceu(ram) novo(s)
3. tentativa 3: reescreveu — fechou 15 de 15, 21 apareceu(ram) novo(s)
```

O escritor nunca deixou nada em aberto: 38 de 38 fechados. E o auditor nunca
parou de achar — porque quase todos os achados eram a mesma família, dita com
palavras diferentes em lugares diferentes:

| o que a fase escreveu | o que o auditor devolveu |
|---|---|
| "o e-mail **normalizado** é único" | "introduz uma operação sem fonte" |
| "senha **aleatória** legível" | "impõe uma forma de geração não autorizada" |
| "**índices** equivalentes entre MySQL e SQLite" | "remova índices do critério" |
| "persistir dados **normalizados**" | "substitua por dados validados" |

Cada uma dessas palavras **é uma regra**: diz que existe uma transformação, e não
diz sobre o quê, em que momento, nem o que fica intacto. Se nenhuma fonte a
declara, ela foi inventada ali — e ninguém consegue implementar nem verificar o
que o escritor quis dizer.

### 54.1 Por que ele escrevia isso

Porque o eixo da PRECISÃO pede exatamente isso. "Toda regra que nomeia uma
OPERAÇÃO precisa nomear sobre o que ela opera" — e o caminho mais curto para
parecer preciso é acrescentar um adjetivo. O eixo da FIDELIDADE então rejeita, e
o escritor, ao reescrever, inventa outro adjetivo em outro lugar. Três rodadas,
59 achados, nenhuma convergência.

### 54.2 A saída existia e ninguém tinha contado a ele

`[NEEDS DECISION] <a decisão em aberto>` numa linha própria dentro da task. Ela
vai ao DESENVOLVEDOR **antes de qualquer auditoria**, volta respondida, e o
marcador é removido — mecanicamente, se o escritor esquecer. O caminho inteiro já
existia, com teste ponta a ponta desde o §24.

O prompt da fase nunca mencionou o marcador. Ele mencionava agora, junto com a
regra que o torna necessário: escreva na precisão da fonte, e quando não der,
diga que falta decidir. Um palpite inventado parece uma decisão, é construído, e
ninguém nunca descobre que foi chute.

## §55 — A janela olha para onde o trabalho está

A tela de fases do `plan` (§53) estreou e mostrou três defeitos na primeira vez
que rodou contra dezoito fases:

```
FASES · 0/18 fases · lacunas
  P01 … E● A○  escrita
  …doze linhas iguais…
  ↓ 6 fase(s) abaixo
G0 engine · G1 escrita · G2 suíte · G3 verificação
```

**A janela ficava parada na P01.** A âncora herdada do build é *a primeira fase
em execução* — o que é exato lá, onde uma fase roda por vez, e engana aqui, onde
doze são escritas em paralelo. O trabalho estava na P15 e a tela mostrava a P01,
dizendo "↓ 6 fases abaixo" sem deixar ver nenhuma delas.

Agora quem recebe o evento diz onde está a novidade, e a janela vai até lá — com
a âncora CENTRADA, porque as vizinhas de cima e de baixo são o contexto de onde o
trabalho está.

**"↓ 6 fase(s) abaixo" contava sem dizer.** Seis esperando e seis falhadas são a
mesma linha, e uma delas é motivo para rolar a tela. Passa a dizer o que há
ali: `↓ 6 fase(s): 1 falhou, 5 aguardando`.

**A legenda era a do build.** `G0 engine · G1 escrita · G2 suíte · G3
verificação` embaixo de uma tabela cujas colunas são E e A. Virou parâmetro, como
as colunas.

E o resumo dizia `0/18 fases` com doze linhas escritas na frente, o que parece um
run que não saiu do lugar. O build conta uma coisa só porque lá a fase fecha ou
não fecha; aqui são duas etapas, e o resumo passa a contar as duas:
`12 escrita(s) · 0 aprovada(s) de 18`.

## §56 — Ninguém lê uma carta escrita na emenda

O quarto impasse do `assitencia` veio com achados que os outros não tinham: I-08
e I-09, erros de CONTRATO, em cinco fases ao mesmo tempo — sempre na *task 1*.

O log do escritor explica. Sem decisão para fechar um achado, ele respondeu à
emenda com **uma carta**:

```
Para resolver os quatro pontos, escolha uma opção em cada item:

1. Banco de produção:
   - A — MySQL remoto em produção e SQLite temporário apenas nos testes (recomendado).
   - B — SQLite em arquivo também em produção.
…
Responda, por exemplo: `1A, 2A, 3A, 4A`.

- [ ] **Task:** Implementar a fundação da aplicação e os dados de administração.
```

Quatro perguntas de múltipla escolha, com recomendação, bem escritas — e **uma
única task, sem critério e sem trace**, no lugar das nove que existiam.

Ninguém jamais leria aquela carta: o que sai da emenda **substitui a fase no
documento**. A fase virou um toco, o contrato reprovou, e as três rodadas foram
gastas assim em cinco fases de uma vez.

### 56.1 A conferência que o prompt prometia e nunca existiu

O `amendPhasePrompt` dizia, desde sempre:

> This is checked mechanically after you answer. A task that changed without a
> finding naming it sends this back to you.

Não era verdade. O `rewrite` do plano pegava o que voltasse, montava a fase e
atribuía — sem olhar. Agora ele confere, e **mantém a versão anterior** quando a
emenda volta pior: zero tasks, ou um defeito de contrato que a versão anterior
não tinha.

A comparação é com o que ela substitui, nunca com a perfeição: a emenda existe
para consertar uma fase que já tem defeito, e recusá-la por carregar o MESMO
defeito travaria o ciclo justamente quando ele está trabalhando.

### 56.2 Encolher não é defeito

A primeira versão desta conferência recusava a emenda que voltasse com menos
tasks do que tinha — e brigou na hora com o §52, que manda **consolidar**
exatamente assim. Duas tasks que entregam a mesma capacidade viram uma, e a fase
encolhe por acerto. O que denuncia a fase destruída é a forma, não o tamanho.

### 56.3 E a saída, de novo

A emenda passa a saber o que o escritor de fase aprendeu no §54: quando um achado
não fecha porque ninguém decidiu, escreva `[NEEDS DECISION]` DENTRO da task,
preservando o resto. Com a diferença de que aqui é preciso dizer também o que não
adianta fazer — porque ele tentou: *"nobody reads a message you write here"*.

## §57 — A pergunta do harness também não pode perguntar o que já foi respondido

O pedido do `assitencia` dizia, com todas as letras:

> Vamos usar banco de dados **mysql remoto** ou seja, não será instalado
> localmente, para testes o agente deverá usar **SQLite** ou qualquer outra
> ferramenta disponível

A pergunta de banco (§46) — escrita fixa, sem olhar o pedido — ofereceu
**"Ainda não existe: o projeto cria o dele, embutido em arquivo"** como opção
RECOMENDADA. O desenvolvedor respondeu `1`, que é aceitar a recomendação, e a
decisão gravada passou a contradizer o que ele mesmo tinha escrito.

O esqueleto então saiu com as duas coisas:

```
- Banco: MySQL remoto                       ← veio do pedido
- origem do banco: embutido em arquivo…     ← veio da decisão
```

Dezoito fases foram escritas sobre essa contradição, e ela reapareceu como
`[NEEDS DECISION]` no meio da quarta tentativa: *"o banco de produção deve ser o
MySQL remoto definido na pilha ou o banco embutido em arquivo definido nas regras
transversais?"*. O escritor estava certo em perguntar.

### 57.1 A regra que eu quebrei escrevendo a pergunta

O campo `evidence` de toda pergunta da entrevista existe para uma coisa: *"o que
já se descobriu sem perguntar — **perguntar o descobrível é proibido**"*. A
primeira pergunta escrita à mão pelo harness violou a própria regra que o harness
impõe a todo modelo que levanta perguntas.

### 57.2 O conserto

A pergunta passa a ler o pedido. Quando ele nomeia um servidor — MySQL,
PostgreSQL, Oracle, SQL Server, Mongo —, mudam duas coisas:

- a **evidência** cita o que já está decidido: *"O pedido já nomeia MySQL. O que
  ele não diz é de onde esse servidor vem"*;
- a **recomendação** vira "já existe, eu informo a conexão", com a base dizendo
  por quê: *"o pedido é a autoridade acima de tudo; responder outra coisa aqui
  contraria o que você mesmo escreveu"*.

As opções continuam as quatro, e quem decide continua sendo quem responde. O que
muda é que apertar Enter deixou de ser um jeito de contradizer o próprio pedido.

## §58 — Falta um parâmetro: pergunte, não recuse

`capivara init --fresh` sem provider respondia assim:

```
capivara init não tem provider para: writer, auditor, verifier

Nenhum papel tem provider por padrão — rodar modelo custa dinheiro, e a escolha
é sua. Diga qual usar, de uma das duas formas:

    capivara init ... --provider codex
```

A mensagem está certa e a exigência está certa: ninguém gasta modelo por engano.
O que está errado é o que ela faz com quem já digitou o comando — **manda
reescrever tudo** para acrescentar uma flag.

Agora, quando há terminal, o harness pergunta **só o que faltou**:

```
capivara init: falta dizer com que modelo rodar os papéis writer, auditor, verifier.
O resto do comando está mantido; responda só isto.

Qual provider usar em todos os papéis?
```

E nada mais. Quem escreveu `init` não é perguntado de novo se quer init, plan ou
build; quem apontou a pasta não a informa outra vez; o pedido que veio no
argumento continua valendo. Vale para os cinco comandos — `init`, `plan`,
`build`, `change`, `survey` — e pergunta apenas pelos papéis que **aquele**
comando usa: um `build` sem provider pergunta por executor e verificador, nunca
pelo escritor.

### 58.1 E o pedido também

`capivara init --fresh --provider codex` é um comando completo menos uma coisa: o
que construir. O harness perguntava os papéis, seguia em frente, e morria assim:

```
EmptyRequestError: nenhum pedido informado.
    at resolveRequest (dist/cli.js:6511:25)
    at _Command.<anonymous> (dist/cli.js:14952:179)
```

Stack trace é o pior desfecho possível: parece defeito do harness, não diz o que
fazer, e não pergunta nada a quem está ali para responder. Agora o pedido entra
na mesma regra dos papéis — é perguntado quando falta, com as mesmas origens do
wizard — e, sem terminal, sai no formato de parada do §45, dizendo as três formas
de passá-lo.

### 58.2 Sem terminal, nada muda

CI, pipe, `ssh` sem tty: a mensagem completa sai como antes e o código de saída é
o mesmo. Um comando que abre pergunta dentro de um CI é um comando que trava o
CI — e a ergonomia de quem está no terminal não pode custar isso.

### 58.3 Um caminho, não dois

As perguntas de provider, modelo, effort e papéis — e depois a do pedido — saíram
do corpo do wizard para funções próprias, chamadas pelos dois lados.
Reimplementá-las no atalho seria garantir que um dia as duas telas divergissem, e
a primeira a ficar para trás seria justamente esta, que é a que quase todo mundo
vai ver.

E divergiu na mesma hora, de outro jeito: o atalho do pedido nasceu sem receber
as funções da base documental, e as duas origens que dependem dela — projeto do
MCP e prompt guardado — **sumiram da lista sem aviso nenhum**. Não foi a pergunta
que divergiu; foi o mundo que ela recebe. As dependências viraram uma função só,
usada pelas três entradas.

## §59 — A rodada de lacunas desistia sem dizer nada

O `assitencia` deu PLAN READY **sem fazer uma pergunta sequer** e, no `plan`,
devolveu isto:

```
linha  26: I-13: o documento contém um marcador [NEEDS DECISION]
linha  99: I-13: …
linha 290: I-13: …
… quatorze vezes …

1. tentativa 1: escreveu o documento; o auditor apontou 21 ponto(s)
2. tentativa 2: devolveu o MESMO texto, sem uma alteração sequer
3. tentativa 3: reescreveu — fechou 0 de 21
```

O `events.tsv` mostrava a rodada de lacunas começando — *"5 gap(s) descobertos na
escrita"* — e nada depois. Nenhum evento, nenhuma linha na tela.

A causa, em uma linha de código:

```ts
if (!batch.ok || batch.questions.length === 0) return authored;
```

Uma das cinco perguntas que o escritor levantou **juntava três decisões numa
frase** — defeito que o protocolo recusa, com razão. O lote inteiro caiu por
causa dela, e a rodada abandonou as cinco decisões sem uma palavra. Os marcadores
seguiram para a auditoria, viraram `I-13`, e o escritor foi mandado *"resolver a
decisão na entrevista"* — que é a coisa que ele não pode fazer.

### 59.1 Três consertos, um por elo

1. **Lote malformado repete uma vez, com os defeitos nomeados** — é o que a
   entrevista principal sempre fez, e faltava aqui. Se ainda assim não vier
   pergunta, a tela DIZ que as decisões seguem abertas e o evento fica gravado.
   Silêncio nunca mais.
2. **As rodadas continuam enquanto houver marcador e houver progresso.** Eram
   duas rodadas de cinco perguntas: dez decisões no máximo, e o plano tinha
   quatorze. O teto agora existe só contra laço infinito.
3. **`I-13` deixa de ser achado do escritor.** Marcador pendente para a
   PRONTIDÃO, que fala com o desenvolvedor — quem pode decidir. Mandar o escritor
   "resolver a decisão" é o §49 pela quinta vez.

### 59.2 O silêncio escondia um defeito no nosso próprio teste

A fixture da rodada de lacunas usava o id `Q-G1`, e o protocolo exige `Q-NN`. O
lote era recusado **em todo teste que rodou nos últimos meses** — e o teste
passava, porque a auditoria acabava removendo o marcador por outro caminho.

A primeira coisa que a mensagem nova fez, ao rodar a suíte, foi denunciar isso.
Um harness que desiste calado engana até quem o escreveu.

## §60 — O exemplo precisa RODAR

O `assitencia` chegou à fase 4 com todas as anteriores de primeira, e a tela
disse:

```
[P04] `npm run migrate` FALHOU (código 1); os gates vão rodar contra um banco
sem esquema: > gestao-assistencia-tec…
```

Duas coisas erradas nessa única linha.

### 60.1 A migração não tinha como conectar, e isso era o esperado

O `.env.example` do projeto trazia, corretamente, o que a regra do §46 manda —
valores inofensivos:

```
MYSQL_HOST=servidor.exemplo.invalid
MYSQL_USER=usuario_exemplo
```

O harness semeia esse exemplo como `.env` (§46.3) e roda a migração declarada
(§46.5). Contra `servidor.exemplo.invalid`, ela nunca vai conectar — **por
construção, e ainda bem**: o que a regra proíbe é justamente apontar para um
servidor de verdade.

Anunciar isso como "FALHOU" em letras garrafais manda procurar um defeito que não
existe. Agora a falha de conexão contra o ambiente de exemplo é reconhecida e
dita como é: *"não conectou, e contra este ambiente isso é o esperado… nada a
corrigir aqui — os gates rodam contra o banco descartável que a própria suíte
cria"*. A migração que CONECTA e quebra — SQL errado, tabela que falta —
continua gritando, porque essa é do produto.

### 60.2 A causa não existia em lugar nenhum

A linha terminava em `> gestao-assistencia-tec…`, cortada pela largura do painel,
e a saída da migração não era gravada em arquivo nenhum. Mensagem que só cabe na
tela é mensagem que se perde no primeiro caso interessante. Agora ela vai para
`logs/<fase>.migrate-<ciclo>.log`, como todos os gates.

### 60.3 E a regra que faltava

O `.env.example` é o arquivo que **sobe a aplicação nos testes de fluxo**. Um
exemplo que não conecta é uma aplicação que não abre, e o gate 4 reprovaria um
produto correto. A regra transversal do banco ganhou o que faltava dizer:

> copiar o `.env.example` para `.env` tem de deixar a aplicação de pé e utilizável
> sem mais nenhuma configuração: ele aponta para o banco descartável, nunca para
> um servidor de mentira. As variáveis do servidor de produção ficam documentadas
> ali ao lado, comentadas ou claramente opcionais.

## §61 — O que o harness já sabe, ele diz antes

A P04 do `assitencia` devolveu assim:

```
gate 4 — fluxos na aplicação: o runner de fluxos não está instalado:
o gate 4 abre a aplicação com @playwright/test.
```

Está correto, o executor instala no ciclo seguinte, e a fase fecha. Mas o custo é
**um ciclo inteiro** — meia hora de sessão — para descobrir uma ausência que o
preflight já tinha anotado **antes da primeira chamada do build**, e que o
harness sabia de novo ao montar aquela fase, que é a primeira a declarar fluxo.

O preflight avisava o DESENVOLVEDOR e calava para quem ia trabalhar. Agora a
sessão da fase que declara fluxo recebe, junto das instruções de dependência:

> This phase declares user flows, and after you finish they are walked through
> the running application with `@playwright/test` — which is NOT installed in
> this project yet. […] installing it now saves a whole cycle.

Só na fase que tem fluxo, e só quando o pacote falta: aviso que não muda nada é
ruído, e ruído num prompt compete com o que importa.

### 61.1 `playwright` não é `@playwright/test`

O projeto tinha `playwright` nas devDependencies — a biblioteca — e o gate pedia
`@playwright/test`, o runner. São pacotes diferentes, e ter o primeiro não
satisfaz o segundo. O aviso diz isso com todas as letras, porque é o erro natural
de quem lê a mensagem correndo.

## §62 — O gate 4 é um teste, e a aplicação precisa saber disso

O `assitencia` chegou ao gate 4 com a aplicação incapaz de subir. O produto está
fiel ao pedido — *"MySQL remoto em produção, SQLite para testes"* —, e a leitura
que ele fez foi a literal:

```ts
const obrigatorias = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
if (!ambiente[chave]?.trim()) throw new Error(`A variável obrigatória ${chave} não foi definida.`);
```

SQLite na suíte, MySQL na aplicação. E o **gate 4 sobe a aplicação** — com o
`.env` semeado do exemplo, que aponta para um servidor que não existe de
propósito. Numa máquina sem MySQL instalado, o gate que mais importa não tem como
rodar.

O executor viu antes do gate e usou a única saída que tinha, a do §44:

> `CAPIVARA_ROTEIRO_ERRADO:` Os roteiros do gate 4 acessam e alteram o MySQL do
> `.env` do desenvolvedor, contrariando a exigência de SQLite descartável

Ele está certo no raciocínio e reclamando no lugar errado: reescrever o roteiro
não troca o banco de uma aplicação. §49 outra vez, numa forma nova.

### 62.1 A regra dizia "os fluxos", e não dizia como

A regra do §46 já mandava *"a suíte automatizada **e os fluxos** rodam contra um
banco descartável"*. O produto leu "fluxos" como mais um teste automatizado, e
cumpriu — nos testes. Faltava dizer o que isso exige da APLICAÇÃO:

> a origem do banco é uma variável de ambiente, e o banco DESCARTÁVEL é uma das
> origens que a APLICAÇÃO aceita — não só a suíte dela. Subir a aplicação com o
> `.env.example`, numa máquina sem servidor de banco nenhum instalado, tem de
> funcionar: é assim que os fluxos são percorridos, num navegador, contra o
> produto de pé.

Com ela, o §60.3 fecha o par: o exemplo aponta para o descartável, e a aplicação
sabe subir com ele.

### 62.2 Onde essa regra entra

Nas regras transversais do esqueleto, escritas no `init`. Um projeto já planejado
não a recebe por atualizar o binário — e é o preço de decisões que vivem no
documento em vez de no código do harness. O que o documento ganha em troca é
poder ser lido, auditado e contestado; o que ele perde é a correção retroativa.

## §63 — A decisão que nasce na reescrita

O `assitencia`, refeito do zero com o esqueleto certo, parou assim:

```
1. tentativa 1: escreveu o documento; o auditor apontou 2 ponto(s)
2. tentativa 2: reescreveu — fechou 2 de 2, 2 apareceu(ram) novo(s)
3. tentativa 3: reescreveu — fechou 2 de 2, 4 apareceu(ram) novo(s)
```

O escritor fechou **tudo** em toda volta, e a pilha cresceu. Os quatro achados
que sobraram diziam a mesma coisa em lugares diferentes:

> A matriz de permissões permanece **pendente**… *Registrar a matriz aceita*
> Permanecem **indefinidos** a data de referência e os limites… *Obter a decisão aceita*
> O plano deixa **pendente** se uma entrega sem garantia preserva o período…
> A tarefa mantém **pendentes** os valores permitidos para quantidades…

São decisões em aberto — marcadas com `[NEEDS DECISION]` pela própria emenda, que
ganhou essa saída no §56 justamente para não inventar. A rodada de lacunas, que
leva essas perguntas ao desenvolvedor, **rodava uma vez, antes da auditoria**. O
que a emenda marcava nascia depois dela.

Ninguém era perguntado. O auditor devolvia dizendo, com razão, "obter a decisão
aceita" — e a única pessoa que podia decidir nunca ficava sabendo que havia o que
decidir.

### 63.1 O ciclo fechado

A cada reescrita, se o texto voltar com marcador, a entrevista reabre ANTES da
próxima auditoria. As três peças passam a se encaixar:

| quem | o que faz com uma decisão que falta |
|---|---|
| escritor de fase (§54) | marca em vez de inventar |
| emenda da auditoria (§56) | marca em vez de mandar carta |
| rodada de lacunas | pergunta ao desenvolvedor — **agora também depois da emenda** |

E o que já foi perguntado é lembrado pelo run inteiro, não por chamada: um
marcador que sobrevive a uma reescrita não vira a mesma pergunta duas vezes.

### 63.2 A armadilha de sempre

O `Set` dessas perguntas nasceu ao lado da função que o usa — abaixo do
`return await buildFromSkeleton()`, que nunca é alcançado. Função é içada,
`const` não: `ReferenceError: Cannot access 'lacunasPerguntadas' before
initialization`. É a segunda vez que este arquivo cobra isso, e a primeira foi
`fasesAprovadas`. Estado do run mora no topo do run.

## §64 — Pergunta discursiva entra em laço

O relato é exato:

> ele às vezes faz uma pergunta discursiva que é impossível de responder, pois
> espera uma resposta pronta; quando mandamos a resposta que pra gente faz
> sentido, ele diz que a resposta não cobriu a pergunta e devolve a pergunta, e
> fica nesse looping

O caminho é sempre o mesmo. O protocolo permitia pergunta **sem opções** — *"ou
nenhuma quando a pergunta for aberta"* —, e o prompt dizia ao modelo que opções
eram opcionais. Aí:

1. o modelo pergunta algo aberto;
2. o desenvolvedor responde o que faz sentido para ele;
3. o classificador julga que a resposta não cobre tudo o que a pergunta pedia;
4. `settle` repergunta na hora (duas vezes), e `planRound` a traz de volta na
   rodada seguinte — três rodadas.

**Seis vezes a mesma pergunta que nunca teve uma resposta certa disponível**, e
nenhuma delas errada o bastante para o classificador aceitar.

### 64.1 Toda pergunta tem de 2 a 4 opções

Agora é mecânico: um lote com pergunta sem opções é recusado antes de chegar à
tela, com a orientação dizendo o que fazer quando a resposta parecer texto livre
— *"enumere as alternativas reais que você consegue imaginar"*.

Escolher pelo número é decisão fechada: o classificador nem chega a ser chamado,
e o laço não tem onde nascer. Texto livre continua valendo para quem quiser dizer
outra coisa — o que deixa de existir é a pergunta **sem nada onde clicar**.

### 64.2 O que isso custa

Uma pergunta genuinamente aberta — o nome do produto, um limite numérico — passa
a exigir que o modelo enumere alternativas plausíveis em vez de perguntar solto.
É trabalho a mais para ele e uma tela pior em casos raros. Em troca, some a única
situação em que o harness fazia o desenvolvedor responder a mesma coisa seis
vezes e desistir.

## §65 — A pergunta volta a quem pode respondê-la

O `assitencia` quebrou numa pergunta sobre a matriz de permissões. O
desenvolvedor respondeu — **com exemplos** —, o classificador julgou que a
resposta não cobria tudo, e a decisão ficou em aberto. O plano seguiu assim, e o
auditor devolveu a fase três vezes dizendo:

> A matriz de permissões permanece pendente… **Registrar a matriz aceita** e
> incorporá-la aos critérios

Registrar a matriz *aceita*. Quem recebe essa correção é o **escritor**, e
escritor não obtém decisão de ninguém — ele escreve o que as fontes dizem. Três
devoluções gastas numa coisa impossível, e o run abortou com dezesseis fases
prontas e uma pergunta de dez segundos sem resposta.

### 65.1 O ciclo curto

Quando o auditor devolve e há decisão em aberto na entrevista, a pergunta volta
ao DESENVOLVEDOR antes de o escritor tentar de novo. Ele responde, a decisão
entra na reescrita como **autoridade** — do mesmo jeito que a decisão de um
impasse entra —, e a fase é refeita uma vez, com a informação que faltava.

Uma vez por decisão no run inteiro: reperguntar a cada devolução seria trocar um
laço por outro.

### 65.2 O que isso fecha

É a última das quatro bocas por onde uma decisão faltante escapava:

| onde ela aparece | quem resolve |
|---|---|
| o escritor de fase percebe que falta (§54) | marca, e a rodada de lacunas pergunta |
| a emenda percebe que falta (§56) | marca, e a rodada reabre (§63) |
| a entrevista perguntou e a resposta não fechou | **volta ao desenvolvedor quando o auditor esbarra (§65)** |
| a pergunta era impossível de responder (§64) | deixa de existir: toda pergunta tem opções |

O princípio é o mesmo nas quatro: **quem não pode decidir nunca deve receber a
ordem de decidir.** Cada vez que o harness quebrou essa regra, o custo foi um run
inteiro.

## §66 — A regra que proíbe o conserto que ela mesma pede

O `assitencia` perguntou isto ao desenvolvedor:

> Para a tarefa do segundo marcador, você autoriza acrescentar tarefas
> exclusivamente para realizar a divisão exigida pela auditoria, **apesar da
> proibição explícita de adicionar tarefas**?

A pergunta é legítima e o destinatário está errado: ele está pedindo ao
desenvolvedor que arbitre entre **duas instruções nossas**.

| quem manda | o que manda |
|---|---|
| self-check de dimensionamento | "uma task com mais de 4 critérios está fazendo mais de uma coisa: **divida-a**" |
| prompt da emenda | "Do not merge tasks. **Do not add tasks.**" |

A proibição existe por um bom motivo — impedir que a emenda vire reescrita, que é
como o ciclo de auditoria nunca fecha. Só que ela foi escrita como absoluta, e
engoliu junto o caso em que acrescentar task **é** a correção pedida.

O escritor fez tudo certo: ensinado no §54 a marcar em vez de inventar, ele
marcou. A rodada de lacunas fez tudo certo: levou a decisão a quem decide. E o
desenvolvedor recebeu uma pergunta sobre a briga interna do harness.

### 66.1 A regra certa

A proibição protege **o que os achados não nomeiam**:

> never add, drop, merge or renumber tasks on your own initiative. When a finding
> asks for a task to be SPLIT, splitting it IS the correction […] The rule above
> protects what the findings do not name — **it never forbids the very change a
> finding asks for.**

O princípio dito por extenso, em vez da lista de exceções: uma lista de exceções
teria a próxima faltando.

## §67 — O auditor também não pode pedir cirurgia de fase

O `assitencia` parou com dois achados, e o segundo era este:

> **Fase 2** — a fase concentra 19 tarefas… *Redistribuir as tarefas existentes
> em **fases sequenciais menores**, preservando relacionamentos*

Quem recebe essa correção escreve UMA fase, cujo número, título, goal e cobertura
vêm do esqueleto e são montados em código. **Criar fase não é jogada que ele
tenha.**

É exatamente a lição do §52 — que eu ensinei ao self-check mecânico e não ao
auditor. O self-check parou de dizer "divida em mais fases de topo"; o auditor,
que é um modelo, inventou a mesma frase por conta própria. Corrigir o código e
deixar o prompt de fora é meia correção, outra vez.

E o placar da rodada mostra o estrago:

```
tentativa 1: 2 achados
tentativa 2: fechou 2, apareceram 2
tentativa 3: fechou 2, apareceram 10
tentativa 4: fechou 0 de 10
tentativa 5: fechou 10, apareceram 2
```

Cinco reescritas, 24 achados fechados, e o run acabou no mesmo lugar.

### 67.1 O que o auditor pode pedir

O eixo de executabilidade passa a dizer o que não existe e o que existe:

> THE PHASES THEMSELVES ARE NOT YOURS TO CHANGE. […] Never ask for a phase to be
> created, split, merged, renumbered or reordered, and never ask for work to be
> moved from one phase to another: none of it is a change he can make, and a
> finding he cannot close burns a return for nothing.
>
> A phase that carries too much has one correction available, and it is inside
> the phase: consolidate tasks that deliver the same capability. Work that is
> missing is demanded IN THE PHASE that already covers it.

### 67.2 E quando o defeito é do esqueleto mesmo

Aí não há correção no plano — e existe um canal para isso que não custa
devolução: a **ressalva**. Ela chega ao desenvolvedor no relatório, sem mandar
ninguém tentar o impossível. O prompt passa a apontá-la:

> If neither fits — if the skeleton itself is wrong — say that in a REMARK, which
> reaches the developer, instead of a finding that reaches someone who cannot act
> on it.

## §68 — O pêndulo entre dois tetos

O `assitencia` entrou num laço com horário marcado. Do `events.tsv`:

```
00:01  a task declara 5 critérios de aceite      → divide a task
00:07  a task declara 6 critérios de aceite      → divide de novo
00:23  a task declara 5 critérios de aceite      → divide de novo
00:26  a fase declara 16 tasks                   → consolida
```

Cada correção obedecia a um teto e quebrava o outro. Dividir a task por ter 5
critérios acrescenta tasks, e a fase passa de 15; consolidar para caber em 15
junta critérios, e a task passa de 4. **Duas correções corretas, uma
oscilação.**

O motivo era simples: cada texto de correção só conhecia o próprio teto. O
escritor recebia "divida-a em tasks que façam uma coisa cada" sem nunca ouvir
falar do limite de tasks da fase, e recebia "consolide as tasks" sem ouvir falar
do limite de critérios por task.

### 68.1 Os dois limites, sempre juntos

Agora cada correção de dimensionamento diz os dois, e exige um arranjo que
satisfaça ambos **na mesma reescrita**:

> divida-a em tasks que façam uma coisa cada […] E a fase inteira não pode passar
> de 15 tasks — ela tem 16 agora: se a divisão estourar esse teto, consolide
> outras tasks desta fase NA MESMA REESCRITA, até a fase caber nos dois limites
> ao mesmo tempo. **Uma correção que respeita um teto e quebra o outro volta para
> cá.**

E a recíproca, na correção de tamanho da fase.

### 68.2 Quando não existe arranjo

Os tetos são 15 tasks × 4 critérios = 60 condições por fase, e há um terceiro
teto exatamente nesse número. Acima dele não existe arranjo: nenhuma divisão e
nenhuma consolidação fazem a fase caber, porque o conteúdo é maior que a sessão.
Esse teto já existia e já tem a saída certa — *"se depois de consolidar ainda não
couber, diga isso em vez de apagar trabalho"* —, que leva o problema ao
desenvolvedor em vez de a mais uma reescrita.

O pêndulo acontecia ABAIXO de 60, onde o arranjo existe e ninguém tinha as duas
medidas na mão ao mesmo tempo.

## §69 — Apertei o parser e esqueci metade de quem fala com ele

O `assitencia` publicou NOT READY com um marcador vivo no plano:

```
linha 775: I-13 o documento contém um marcador [NEEDS DECISION]
O plano não carrega decisão pendente: [NEEDS DECISION] no plano
```

E o `events.tsv` tinha a explicação, na mensagem que o §59 acabou de criar:

```
01:04:46  interview  project-phases.md  blocked  3 gap(s) sem pergunta
```

O lote da rodada de lacunas foi recusado duas vezes seguidas. A causa é minha,
de horas antes: o §64 passou a exigir de 2 a 4 opções por pergunta — no
**parser** e no prompt da **entrevista**. A rodada de lacunas, que fala com o
mesmo parser, continuou mandando pergunta sem opção.

Três decisões que ninguém chegou a ouvir, um plano publicado incompleto, e a
mensagem de diagnóstico certa aparecendo porque tinha sido escrita duas horas
antes pelo mesmo motivo.

### 69.1 Uma fonte, dois prompts

As regras da pergunta viraram uma constante, usada pelos dois: quantas opções,
por que a pergunta discursiva entra em laço, o que fazer quando a resposta parece
aberta, e a proibição da opção que é adiamento disfarçado.

É o §58.3 outra vez, no mesmo dia: extrair a pergunta e deixar as regras
espalhadas resolve metade do problema e esconde a outra. Aqui a lição ganhou o
teste que faltava — um que roda os DOIS prompts contra as mesmas asserções.

## §70 — Levantamento de auditoria: o desacordo vai a quem decide

A ideia é do desenvolvedor, e ela nomeia uma coisa que o harness tratava como
duas.

Um achado que aparece **uma vez** é defeito: o escritor conserta e segue. Um
achado que **sobrevive a uma reescrita** é outra coisa — o escritor leu as fontes
de um jeito, o auditor leu de outro, e nenhum dos dois pode decidir quem tem
razão. O harness mandava a discussão de volta ao escritor mais duas vezes e
depois abortava o run.

No `assitencia` isso teve nome e horário. A exclusividade do e-mail voltou em
quatro rodadas seguidas e sobreviveu a três reinícios:

| quem | o que lia |
|---|---|
| escritor | a regra transversal do esqueleto: *"exclusividade entre usuários **operacionais**"* |
| auditor | a decisão aceita: *"e-mail exclusivo **em todo o sistema**"* |

Os dois certos, sobre fontes diferentes. Uma noite inteira.

### 70.1 A pergunta

Na segunda aparição do mesmo achado, o laço para e pergunta — com as duas
leituras lado a lado:

```
auditoria · Phase 2 · usuários

Já descobri:
  O auditor devolveu este ponto pela segunda vez, então não é falta de capricho
  do escritor: é leitura divergente das mesmas fontes.

    O auditor entendeu: a exclusividade do e-mail foi limitada aos operacionais
    E pede: exigir exclusividade em todo o sistema, incluindo o painel global

Em "Phase 2 · usuários", qual leitura vale?
  1. Vale a leitura do auditor  ← recomendada
  2. Vale o que o escritor escreveu
```

Três desfechos, e o terceiro é o que a ideia tem de melhor:

- **auditor** — a fase é reescrita como ele pede, agora com respaldo explícito;
- **escritor** — o ponto é encerrado, e o achado sai da lista;
- **nem um nem outro** — texto livre, que **substitui** a correção pedida: o
  escritor recebe o que o desenvolvedor determinou, palavra por palavra.

### 70.2 As duas versões, lado a lado

A primeira versão desta tela mostrava só a leitura do AUDITOR — argumentada, com
o que ele entendeu e o que ele pede — e oferecia, como alternativa:

```
2. Vale o que o escritor escreveu
   O ponto é encerrado como está, e o auditor não volta a levantá-lo.
```

Sem dizer o que o escritor escreveu. **Escolher entre uma opção argumentada e uma
opção muda não é escolher** — e a pergunta existe justamente para pôr as duas
leituras em pé de igualdade.

Agora a evidência traz o que a fase entrega hoje, título por título:

```
O escritor entregou:
- Cadastrar dica de bancada com título e conteúdo
- Alterar e consultar dicas do tenant
- Anexar arquivos à dica
- Listar dicas na tela de consulta

O auditor entendeu: a decisão aceita acrescenta exclusão de dicas, mas esta
fase contempla somente cadastro, alteração, consulta e anexação.
```

Os títulos das tasks, e só eles: o texto inteiro da fase não cabe na tela, e é a
lista que mostra a ausência apontada — ali dá para ver, numa olhada, que não há
exclusão.

E a opção 2 passou a dizer o que fica valendo se ela for escolhida, em vez de "o
ponto é encerrado".

### 70.3 Arbitragem é para julgamento, nunca para contagem

O levantamento estreou perguntando isto:

```
O auditor entendeu: a task declara 5 critérios de aceite
E pede: uma task com mais de 4 critérios está fazendo mais de uma coisa…

Em "Phase 1 · Persistir usuários, perfis e permissões", qual leitura vale?
```

Não há duas leituras: **5 é maior que 4**. Esse achado vem da conferência
mecânica, não do julgamento do auditor, e repetir ali significa que o escritor
não cumpriu — não que alguém discorde dele. Pedir arbitragem de uma contagem é
gastar a atenção do desenvolvedor com aritmética, e ainda por cima mostrando as
doze tasks da fase para decidir sobre uma.

O levantamento passa a valer só para achado do AUDITOR. A distinção já existia no
veredito (`mechanical`) e agora está também em cada achado, porque é ela que
decide **quem resolve**: contagem volta ao escritor, leitura vai a quem decide.

### 70.4 O que se grava é a decisão, não o botão

O `assitencia` arbitrou **onze** pontos numa noite, e o auditor devolveu os dois
primeiros outra vez. O handoff explicava por quê:

```
Q-91 | ACCEPTED | decision = "Vale a leitura do auditor"
Q-92 | ACCEPTED | decision = "Vale a leitura do auditor"
…onze vezes
```

O harness guardou o **rótulo do botão**. E essa frase vai para três lugares —
o contexto do escritor, a lista de decisões que o auditor recebe na rodada
seguinte, e o relatório final — sem dizer nada em nenhum deles. O auditor lia
onze decisões idênticas e vazias, não descobria nada, e levantava os mesmos
pontos **com toda a razão**: para ele, nada tinha sido decidido.

O contraste estava no mesmo arquivo: a única resposta em texto livre gravou
substância —

```
Q-96 | ACCEPTED | decision = "SREP representa uma decisão técnica, não a entrega
                             do equipamento. A única alteração permitida…"
```

Agora as três saídas gravam conteúdo, com o endereço junto:

| escolha | o que fica gravado |
|---|---|
| leitura do auditor | `<onde>: <o que ele pediu>` |
| texto do escritor | `<onde>: fica como está — o ponto "<X>" foi decidido a favor do texto atual` |
| terceira via | `<onde>: <o texto do desenvolvedor>` |

A regra que faltava, e que vale para qualquer decisão que o harness registre:
**ela precisa ser legível sozinha**, sem a pergunta ao lado — porque quem a lê
depois recebe só a linha.

### 70.5 O que faz a decisão durar

A resposta é gravada como qualquer outra da entrevista, e é isso que a torna
útil: o auditor da rodada seguinte recebe as decisões junto do documento. Sem
esse registro ele levantaria o mesmo ponto na volta seguinte — **com toda a razão
do mundo**, porque para ele nada teria mudado.

A recomendação padrão é a leitura do auditor, e a base diz por quê: quem devolve
duas vezes costuma estar lendo uma decisão aceita, e decisão aceita vence
documento derivado dela. É uma tecla para discordar.

## §71 — Contar palavra não é contar decisão

Madrugada do `assitencia`:

```
[03:01:45] não consegui transformar 4 decisão(ões) pendente(s) em pergunta;
           elas seguem abertas e o plano não fecha com elas
```

O lote trazia **onze** perguntas. Três foram acusadas de *"3 decisões na mesma
frase"* e **as onze foram jogadas fora**. As três acusadas:

> Qual indicação inicial deve aparecer quando faltar uma ou ambas as datas de garantia?
> Quando a entrega não informar garantia, o que deve acontecer com o período já registrado?
> O que deve acontecer quando a quantidade utilizada superar o saldo disponível?

São perguntas perfeitas — uma decisão cada, respondível numa frase. A regra
contava palavras:

```
"Qual indicação inicial deve aparecer quando faltar uma das datas?"
  ↑qual              ↑deve        ↑quando   → "3 decisões na mesma frase"
```

`deve` é modal. `quando`, ali, é subordinativo. A oração condicional é a forma
mais natural de perguntar uma regra de negócio — *"o que acontece quando X?"* — e
era exatamente a forma que a regra matava.

### 71.1 Prova, não indício

A regra do ≥3 saiu. Ficaram as duas que são prova:

- **mais de um `?`** na mesma linha;
- **`e` seguido de interrogativo** — *"…e o que acontece se o prazo passar?"* —,
  que é conjunção emendando outra pergunta. Um `e` simples, *"terá login e
  senha?"*, continua passando, porque liga duas coisas de uma decisão só.

O comentário antigo dizia que a conferência era "deliberadamente conservadora,
porque reprovar pergunta boa custa uma volta". Ela não era conservadora — era o
oposto —, e o custo real era maior do que o texto imaginava: **o lote é recusado
junto**, então uma pergunta boa reprovada leva as outras dez com ela.

### 71.2 O lote recusado entrega o que se salvou

E essa é a segunda metade. Na rodada de lacunas, cada pergunta corresponde a uma
decisão específica: jogar oito fora porque três vieram tortas é perder oito
decisões que o desenvolvedor responderia em um minuto.

Agora a recusa carrega as perguntas sem defeito, e a rodada segue com elas
anunciando quantas ficaram de fora. O lote inteiro só é perdido quando não sobra
nada — resposta que não é JSON, contrato errado —, que é quando a recusa
realmente significa "o modelo não entendeu o pedido".

## §72 — Registro em UTC, tela no relógio de quem olha

O painel mostrava `toISOString()`. Às nove da noite em Brasília a tela dizia
meia-noite, e quem cruzasse o log do harness com o próprio relógio somava três
horas na cabeça o run inteiro:

```
[03:01:45] não consegui transformar 4 decisão(ões) pendente(s) em pergunta
```

Eram 00:01.

A separação é a de sempre, e vale escrever porque é fácil resolver para o lado
errado:

- **o que é gravado** — `events.tsv`, `run.json`, os handoffs — continua em ISO
  com fuso zero. Ali o valor precisa ser ordenável, comparável entre máquinas e
  não ambíguo daqui a seis meses;
- **o que é mostrado** — o log do painel, a mensagem do lock, o visor de runs —
  usa o fuso do computador.

Converter na gravação estragaria o arquivo; deixar UTC na tela estraga a leitura.

## §73 — Auditoria por task: o julgamento não se repete sobre o que não mudou

O `assitencia` mediu, num run só, o custo de auditar na granularidade errada:

```
tentativa 1: 4 achados
tentativa 2: fechou 4 de 4 →  6 novos
tentativa 3: fechou 6 de 6 →  2 novos
tentativa 4: fechou 2 de 2 →  7 novos
tentativa 5: fechou 7 de 7 →  4 novos
```

**Dezenove fechados, dezenove novos.** O escritor nunca falhou em fechar; o
auditor nunca ficou sem achar. E os achados eram sempre outros — *"exclusão
lógica restrita a tipos e modelos"*, depois *"administradores adicionais sem
exclusão lógica"*: mesma família, endereços novos, rodada após rodada.

Não era o documento piorando. Era **amostragem**: o auditor relê 600 critérios a
cada volta, e nenhuma leitura de modelo encontra tudo na primeira passada. Com
seis fases isso converge por sorte; com dezesseis, nunca.

### 73.1 A chave é o par

A aprovação passa a ser guardada por TASK, e a chave é o par **texto + autoridade**:

- o texto é canônico, reconstruído dos campos — espaço a mais, bullet trocado ou
  linha reordenada pelo reparo determinístico não derrubam um julgamento;
- a autoridade é o sha das decisões aceitas. **Decisão nova derruba todas as
  aprovações de uma vez**, e isso é o certo: uma fase aprovada ontem pode
  contradizer o que o desenvolvedor decidiu agora (§65).

Uma task que muda volta sozinha. As catorze vizinhas seguem julgadas.

### 73.2 O auditor precisa SABER

Guardar não basta: a fase é enviada inteira, porque uma task não se julga fora do
contexto dela. O prompt passa a dizer quais tasks estão ali só para a fase ler
inteira:

> You approved these tasks in an earlier pass. Their text has not changed since,
> and neither has any decision they were judged against. […] Do not raise findings
> on them. Judging them again is not thoroughness — it is a second reading of the
> same text, and a second reading always finds something a first one did not.

Com uma saída explícita, porque o caso existe: se uma task aprovada quebrou **por
causa** de uma mudança em outra — um nome que não casa mais, uma regra que se
mudou de lugar —, o achado é sobre a task que MUDOU, que está sob auditoria.

### 73.3 O que isto não resolve

A auditoria de coerência continua lendo o documento inteiro a cada rodada, e deve
mesmo: o trabalho dela é achar contradição ENTRE fases, e uma fase que muda pode
quebrar outra que não mudou. Ela é uma chamada por rodada, não dezesseis.

## §74 — O harness desistia por gaps de informação, com quem responde na frente

Uma investigação pelos três estágios — `init`, `plan`, `build` — procurando duas
coisas: regra escrita para um projeto específico, e caminho pelo qual o run morre
sem ter perguntado.

A primeira busca não achou nada. Todo módulo de `src/` que nomeia um projeto o
nomeia em COMENTÁRIO, como evidência de onde a lição foi aprendida; o
comportamento é sempre geral. O caso mais próximo de exceção é
`interview/banco.ts`, e ele passa: a lista de servidores nomeados (`MySQL`,
`PostgreSQL`, `Oracle`, `SQL Server`, `MongoDB`) não decide nada, só muda a
EVIDÊNCIA e a RECOMENDAÇÃO da pergunta. Quem decide continua sendo quem responde.

A segunda achou seis.

### 74.1 Os tetos que fechavam a porta

| onde | teto | o que acontecia ao passar dele |
| --- | --- | --- |
| lacunas | 6 rodadas × 5 perguntas | **30 decisões por run**; o resto virava `[NEEDS DECISION]` e NOT READY |
| omissões | 4, cortadas em silêncio | a quinta área ficava fora do produto sem ninguém decidir isso |
| perguntas | "at most SIX per round" no prompt | um produto de 25 stories tem mais de seis decisões abertas |
| entrevista | 3 rodadas | `DEFERRED` nunca era reperguntado: `UNRESOLVED` não o inclui |
| ensaio | 1 reescrita | crítério impossível sobrevivia e bloqueava o gate, sem pergunta |
| lote torto | 2 tentativas → `InitBlockedError` | o `init` inteiro morria por erro de FORMATO de terceiro |

Os seis têm a mesma forma: **o harness sabia o que faltava, tinha o desenvolvedor
no terminal, e escolheu publicar NOT READY em vez de fazer uma pergunta.**

O teto existia por um motivo real — quem responde quarenta coisas para documentar
um produto pequeno para de responder com cuidado lá pela décima quinta. Mas o
remédio estava errado, e a medição diz por quê: **o que cansa não é a quantidade
de perguntas, é a pergunta que não tem como ser respondida.** Contra essa, o teto
não faz nada; ele só garante que a última fique sem resposta nenhuma.

### 74.2 A insistência, e as duas saídas fechadas

`insistirNasDecisoes` repergunta toda decisão aberta, e a pergunta que ela faz
acrescenta às opções originais duas que não existiam:

- **delegar** — o harness decide pela recomendação, e isso é registrado como
  SUPOSIÇÃO no relatório, onde pode ser derrubado depois;
- **fora do escopo** — o produto não faz aquilo, e nenhuma fase o implementa.

Com as duas, toda decisão converge para um de três estados: decidida, assumida
com autorização, ou fora do escopo. Nenhum bloqueia o gate e **nenhum é
silencioso** — que é a diferença entre isto e uma suposição por omissão, a coisa
que o harness mais evita (§31).

Ela roda em quatro lugares, porque a marca é o par decisão+lugar e não a decisão
sozinha: antes de escrever o esqueleto, antes de detalhar as fases, quando o
auditor esbarra nela, e antes do gate. Marcá-la só pelo id fazia a primeira
insistência calar todas as outras — o mesmo defeito, um nível acima.

E o que a insistência fecha depois de o esqueleto existir passa a chegar a quem
escreve a fase: `phaseFromSlicePrompt` ganhou o bloco *"Decisions taken after the
skeleton was written"*. Sem ele a decisão chegava só como achado de auditoria,
uma reescrita depois — o escritor escrevia sem saber, e o auditor cobrava com
razão.

### 74.3 O auditor não tinha como perguntar nada

Ele tinha dois canais e nenhum chega a tempo a quem decide: o **finding** vai ao
escritor, e a **ressalva** só é lida no relatório, depois de o run terminar.
Quando o que falta é uma DECISÃO — nenhuma fonte diz qual leitura vale —, mandar
ao escritor é pedir que ele invente o que o eixo 1 o proíbe de inventar.

O caminho até o desenvolvedor existia e era caro: o levantamento (§70) abre
quando o MESMO achado volta pela segunda vez, e o impasse quando o teto estoura.
Entre a primeira leitura do auditor e a primeira pergunta havia sempre um ciclo
inteiro — escrever, auditar, reescrever, auditar — para chegar a uma pergunta de
dez segundos que ele já sabia fazer na primeira passada.

`CAPIVARA_DECISION: <onde> | <a decisão que falta> | <leitura> | <leitura>` é o
terceiro canal. As duas leituras são obrigatórias, pela regra do §71: decisão sem
alternativa é pergunta discursiva, e pergunta discursiva entra em laço. A rodada
gasta com ela não conta contra o teto de devoluções — o escritor não errou,
faltava uma decisão —, e cada uma é perguntada uma vez.

Foi também o que resolveu o buraco que o próprio prompt do auditor abria: *"se o
esqueleto estiver errado, diga isso numa RESSALVA, que chega ao desenvolvedor"*.
Chegava depois do run.

**E a primeira versão disto já nasceu pela metade**, no mesmo dia: o parser lia as
decisões, o prompt as pedia, e `auditPlanInParts` — a auditoria que de fato roda,
uma chamada por fase — montava o veredito à mão sem elas. Nenhuma decisão do
auditor chegava a ninguém e nada no caminho reclamava. É a família do §34.6, e
ela pega até quem a escreveu.

### 74.4 O ensaio era a terceira mesa sem cadeira para quem decide

O ensaio do verificador (§28) pergunta se um critério pode ser PROVADO. Quando
dizia que não, o escritor tinha uma rodada; se o veredito se mantivesse, o run
terminava em NOT READY com o plano publicado e uma lista de endereços na tela.

É o desacordo do §70 com outro par — o escritor afirma que o critério é
observável, o verificador afirma que não —, e a mesma pessoa capaz de encerrá-lo
estava no terminal. Agora as duas leituras vão para a tela antes de bloquear. A
opção de manter o critério diz o preço com todas as letras: *"se o verificador do
BUILD mantiver a leitura dele, a fase volta com INCOMPLETE e a correção custa um
ciclo — é esse o risco que você está aceitando."*

### 74.5 O que substituiu os tetos

Nada, e é de propósito: o filtro passou a ser a RÉGUA que já existia. O prompt
lista quatro testes que uma pergunta precisa passar e quatro que uma omissão
precisa passar; uma que não passa não é cortada por quota, é errada. E o canal de
suposição continua absorvendo tudo o que não muda comportamento observável,
escopo, contrato, segurança ou dado — é ali que o volume vai.

A única exceção é uma parada de segurança de 200 lacunas por documento, que não é
teto de entrevista: ela existe porque um escritor que inventasse um marcador novo
a cada reescrita faria o laço perguntar para sempre, e perguntar para sempre é
pior que o gate recusar, porque não termina. O maior run real produziu quatorze.

### 74.6 Duas réguas para o mesmo conceito

`change/orchestrator.ts` declarava `MAX_TASKS_PER_PHASE = 12` e
`MAX_CRITERIA_PER_TASK = 6`, contra 15 e 4 do razão de autoria. Dois números para
a mesma pergunta — "o que cabe numa sessão de agente" — e divergindo no pior
lugar possível: uma fase de mudança com 6 critérios por task é construída pelo
MESMO loop e verificada pelo MESMO verificador, e seria recusada pelo self-check
do plano se passasse por ele. Quem escreve a fase é o mesmo prompt nas duas
pontas; a régua agora é importada, não redigitada.

### 74.7 O nome do teste era procurado, e a regra vivia só no leitor

`featureTestNames` extrai o nome antes da seta e o procura na árvore: é a única
parte do gate 3 que não depende da atenção de um modelo variar entre um ciclo e o
seguinte. Só que ele aceita apenas o que PARECE nome — sem espaços, de três
caracteres para cima — e **descarta o resto em silêncio**. Uma fase que escrevesse
"cobertura dos três estados" em vez de `cobertura_dos_tres_estados` perdia a
conferência mecânica inteira, e nada avisava.

A regra passou a estar escrita onde o nome é escrito.

### 74.8 O contrato entre init/plan e o ralph

Conferido de ponta a ponta, e está de pé: `splitPhases` consome o MESMO
`parsePhases` que valida o plano e lê `PhaseBlock.markdown`, o recorte que o
parser já produziu — um teste de arquitetura falha se alguém escrever uma segunda
expressão regular de fase. `Areas` é opcional no parser, então plano escrito antes
do campo continua executável e a fase sem área recebe só as skills gerais. Os
fluxos do gate 4 saem do esqueleto por `covers`, e as duas coberturas que o
garantem são verificadas nos dois gates: PLAN READY exige que todo workflow
apareça no `covers` de alguma fase, RALPH READY que ele seja citado no `Traces` de
alguma task.

## §75 — O gate 3 não convergia: era amostragem, não regressão

O `assitencia` rodou o build com o binário de antes e parou na fase 1, com doze
das catorze tasks prontas. Os três ciclos foram estes:

| ciclo | INCOMPLETE | o que aconteceu |
| --- | --- | --- |
| 1 | TASK 1, TASK 10 | o executor fechou as duas |
| 2 | TASK 7, TASK 10 | a 7 estava **DONE** no ciclo 1 |
| 3 | TASK 2, TASK 6 | as duas estavam **DONE** nos ciclos 1 e 2 |

Seis tasks diferentes, nunca mais de duas por vez, e o executor fechou todas as
que lhe foram apontadas. **A fase não estava piorando.** O verificador relê catorze
tasks e umas quarenta condições a cada ciclo, e nenhuma leitura de modelo encontra
tudo numa passada — cada nova leitura de um texto já lido acha algo que a anterior
não achou. Com catorze tasks isso não converge: é o §73 outra vez, na outra ponta
do harness.

E é a **correção pela metade** no seu formato mais puro. Dois dias antes, o `plan`
recebeu memória de julgamento por task exatamente por essa medição — "dezenove
fechados, dezenove novos" — e o `build`, que tem a mesma forma e o mesmo custo por
ciclo, não recebeu nada.

### 75.1 Um DONE é fato do run

`loop/veredictos.ts` guarda cada task aprovada por **fase + texto canônico da
task**, em `.capivara/handoffs/tasks.json`, e o registro atravessa execuções — o
caso que doeu foi justamente rodar `capivara build` de novo e a verificação
recomeçar do zero nas catorze. A chave é o texto, não o número: editar um critério
no plano faz a task voltar à fila, que é o que quem editou está pedindo.
`--rebuild-all` abre o registro vazio.

Como no §73, guardar não basta — quem julga precisa saber. O prompt do verificador
lista as tasks já aprovadas e diz para não rejulgá-las, com a mesma saída
explícita: se a correção DESTE ciclo quebrou uma delas, o achado é sobre a task que
mudou. E quando ele rejulga mesmo assim, o gate desconsidera, mas **nunca em
silêncio**: a linha sai na tela com o que ele disse, e o log da verificação tem o
texto inteiro.

O que protege contra um DONE que deixou de ser verdade não é reperguntar: são os
gates 0, 1 e 2, que rodam a árvore inteira a cada ciclo e não dependem de atenção.

### 75.2 O critério que nós mesmos escrevemos sem resposta possível

> TASK 2: INCOMPLETE — a árvore não contém metadados de versionamento para
> confirmar que os arquivos versionados não incluem credenciais reais.

O verificador está certo, e o defeito é nosso: a regra transversal de banco — que o
harness injeta em TODO projeto com banco, determinística, sem passar pelo modelo —
dizia *"nenhum arquivo versionado, documento ou log contém credencial"*. O projeto
não tinha repositório Git. Nenhuma implementação podia provar aquilo.

A regra passou a falar de ARQUIVO, que se abre e se lê: o `.env` é o único que pode
conter credencial, está no `.gitignore`, e nenhum outro arquivo da árvore tem senha,
token ou string de conexão — *"e isso se confere abrindo os arquivos"*.

### 75.3 O conjunto sem borda

> TASK 6: INCOMPLETE — a criação genérica permite outros administradores
> protegidos, e o teste compartilhado não cobre todas as exclusões lógicas.

O critério dizia: *"a exclusão lógica é a regra compartilhada por **todos os
serviços e operações de exclusão previstos no escopo**"*, na fase 1, onde a maior
parte desses serviços ainda não existe. A observação individual é fácil; o que não
se decide é quando a lista está COMPLETA. O verificador procura, acha um caso a
mais, reprova — e no ciclo seguinte acha outro.

É uma terceira forma de critério impossível, ao lado das duas que o ensaio já
conhecia (§28), e ela passou pelo ensaio porque é observável em princípio e
satisfazível em princípio. Agora:

- o escritor de fase é proibido de quantificar sobre conjunto que a fatia não
  ENUMERA, e recebe a medição junto com a proibição;
- o ensaio ganhou a regra no `UNOBSERVABLE`: *"o critério cujo conjunto não tem
  borda"*, com o pedido de nomear qual conjunto é;
- e a mesma regra proíbe critério que dependa do que não está na árvore de
  trabalho — metadado de versionamento, CI, servidor remoto —, que é o 75.2 dito
  de forma geral.

### 75.4 O repositório que o build precisa é pré-requisito, não conveniência

Sem repositório, `commitPhase` não fazia nada e ninguém dizia o que isso custava:
dezesseis fases sem **nenhum ponto de retorno**, e todo critério que fale de
versionamento impossível de provar. Em pasta nova — que é a pasta com que o ciclo
normal começa, porque `init` e `plan` só escrevem dentro de `.capivara/` — o build
agora roda `git init`. Sobre trabalho que já existe ele não inventa repositório: o
commit inicial de uma árvore alheia é decisão de quem a escreveu, e o aviso passou
a dizer as duas consequências e o comando.

**E a suíte pegou o buraco na primeira execução**: máquina sem `user.email`
configurado faz `git commit` sair com código 128, e isso derrubava o build com a
fase verde e todos os gates passados. Duas correções: o repositório que o harness
cria ganha identidade local própria quando não há nenhuma resolvível, e
`commitPhase` não lança mais — commit é escrituração, e escrituração que falha não
desfaz trabalho que passou.

### 75.5 Avisar não é garantir

A primeira versão do 75.4 criava o repositório em pasta nova e, sobre árvore que já
tinha trabalho, **avisava**. O desenvolvedor leu isso e fez a pergunta certa: se o
repositório é importante para o build, por que o build começa sem ele?

Não há resposta boa. Um aviso no meio do preflight é lido por quem já sabe e
ignorado por quem não sabe, e as duas consequências — não ter ponto de retorno em
dezesseis fases, e ter critério que ninguém consegue provar — só aparecem horas
depois, no gate. Repositório é **pré-requisito**, da mesma categoria de `sqlite3`
ausente ou navegador não instalado: algo de que o build depende e que não está lá.

Então ele entra na gramática que o harness já tem para isso, com a ordem que
respeita de quem é o trabalho:

1. pasta nova — cria sem perguntar, porque não há nada de ninguém ali;
2. árvore com trabalho — **pergunta**, com as três saídas de sempre: crio agora e
   commito o que já existe, já criei em outro terminal, abortar;
3. ninguém para responder — **para**, antes de gastar a primeira chamada de modelo,
   com o comando na tela.

`--no-git` continua existindo, para quem versiona por fora ou usa outro controle de
versão. É escolha explícita de quem chamou, dita na mensagem de erro, e o aviso que
sobrou existe só para esse caso.

E a exigência fica mais barata porque o repositório passou a nascer ANTES: o `init`
o cria, que é o único momento em que a pasta é garantidamente vazia — nenhum arquivo
de produto existe ainda, e não há dúvida de dono. Exigir só no build seria exigir de
quem já andou horas sem ele. Isso resolve de graça a outra reclamação que o relatório
vinha fazendo há semanas — *"sem repositório Git: a especificação não foi
versionada"* —, porque agora há onde versioná-la no instante em que o gate fecha.
`--no-commit` é a saída de quem não quer que o harness versione nada.

## §76 — Um marcador desligava a auditoria por fase, e ninguém contava

O `assistencia2` parou no `plan` com um impasse sobre dois campos de formulário. O
impasse era o sintoma; a doença estava três camadas abaixo, e os artefatos a
mostraram inteira.

### 76.1 O que os logs disseram

Quatro tentativas de auditoria, quatro arquivos de log — e todos com o assunto
`project-phases.md`, nenhum `#P1`, `#P2`. Em vez de treze chamadas paralelas, uma
por fase, foi **uma chamada lendo as treze fases de uma vez**, quatro vezes. Os
achados caíram em fases sempre diferentes:

| tentativa | fases apontadas |
| --- | --- |
| 1 | 1, 3, 4, 9, 10 |
| 2 | 5, 12, 10 |
| 3 | 4, 5, 8, 9 |
| 4 | 9, 10 |

É a amostragem do §73, e naquele caminho nada do que foi construído contra ela
existe: `fasesAprovadas` fica vazio, a memória por task fica vazia — o cache do run
registra `escritas: 13, aprovadas: 0` —, e como nenhum achado repete, o
levantamento (§70), que só abre na segunda aparição do MESMO ponto, nunca é
acionado. Sobra o impasse.

A causa, montando o plano do cache e passando no parser:

```
parseia? false
erros: {"I-13": 11}
```

Onze `[NEEDS DECISION]` vivos. E no orquestrador:

```ts
if (document === "project-phases.md" && parsePhases(content).ok) {
  return await auditPlanInParts(...);   // nunca chega aqui
}
```

`I-13` é reparável, então o caminho dos defeitos mecânicos também não pega, e a
execução escorrega para a auditoria genérica de documento único. **Um marcador
pendente decidia como o plano inteiro seria auditado, e não havia uma linha na tela
sobre isso.**

O conserto lê a ESTRUTURA sem os marcadores. Eles continuam no documento e
continuam bloqueando a prontidão — que é o gate que fala com o desenvolvedor —, e
de quebra saem da vista do auditor, que é o certo: a correção que um marcador pede
é "resolva a decisão na entrevista", coisa que quem reescreve a fase não pode fazer
(§49). No run real, o auditor gastou uma devolução exatamente nisso.

### 76.2 Por que onze marcadores chegaram lá

Dois eventos `5 gap(s) descobertos na escrita`, dez perguntas, e as dez seguiram no
texto. O `closeGaps` sem teto do §74 tinha um buraco meu: ele pergunta o que ainda
**não foi perguntado**, e saía quando não havia nada NOVO — não quando não havia
marcador.

Um marcador perguntado, respondido, e que o escritor não apagou ficava invisível:
`lacunasPerguntadas` guarda o texto, o filtro o tira da fila, `markers.length === 0`,
e a função devolve o documento com ele dentro. O `temDecisaoPendente` da auditoria
chamava `closeGaps` de novo e recebia a mesma resposta calada.

Agora cada volta faz três coisas, nesta ordem:

1. **apaga** o marcador cuja decisão já existe — mecânico, porque a pendência
   deixou de existir e a decisão está nas fontes do escritor;
2. **pergunta** o que nunca foi perguntado;
3. **insiste** no que foi perguntado e ficou aberto, pelo caminho do §74, com as
   duas saídas que fecham qualquer pergunta.

E a saída é não haver marcador. Para isso o harness passou a guardar o vínculo
pergunta → marcador: sem ele, uma decisão fechada pela insistência três rodadas
depois não tinha como ser reconhecida como a decisão daquele marcador.

### 76.3 O impasse era a primeira parada, e é a pergunta que a gente proibiu

`renderStandoff` é texto livre com três comandos — `reiniciar`, `publicar`,
`abortar` — e é exatamente a pergunta discursiva que o §71 baniu, feita no pior
momento possível. Ela aparecia antes de qualquer arbitragem sempre que os achados
não repetiam, e no `assistencia2` apareceu com dois achados concretos e
específicos:

> Phase 9: o campo de descrição não tem as quatro linhas e a rolagem exigidas no pedido
> Phase 10: o campo de motivo do uso não tem a área de texto com rolagem exigida

Dois pontos que cabiam numa escolha numerada, entregues como um prompt em branco.

Agora o esgotamento do orçamento arbitra primeiro: cada ponto insistido vai à tela
com as duas leituras — a do auditor, o que o escritor escreveu, ou o que o
desenvolvedor determinar —, a decisão é gravada como autoridade e chega ao auditor
da rodada seguinte. No impasse, **insistir é a repetição**: exigir que o achado
tenha aparecido duas vezes era o que mantinha o levantamento fechado num run em que
cada volta apontava lugares novos.

A prosa continua existindo para o que não se arbitra: defeito mecânico, que é
contagem, e ponto já arbitrado antes.

**E este conserto também nasceu meio:** o laço decidia "houve arbitragem?" pelo
tamanho da lista devolvida, e `levantamentoDeAuditoria` devolve os achados intactos
quando não há nada novo a arbitrar. "Nada a arbitrar" virou "tudo arbitrado", o laço
reescrevia e reauditava para sempre, e os testes pegaram na primeira execução, com
timeout. O que decide é o conjunto de arbitrados ter CRESCIDO.

### 76.4 As decisões do plano eram gravadas e nunca lidas

`persistAnswers` carrega um comentário que diz, com todas as letras: *"decisão
tomada aqui precisa sobreviver ao processo: sem isto, o run seguinte pergunta a mesma
coisa porque a retomada não a encontra"*. O arquivo era escrito a cada resposta — e
**nada o lia**. O `plan` só carregava o handoff do `skeleton`.

Um `plan` que recomeçasse perdia tudo o que tinha sido decidido NELE: as lacunas, os
pontos que o auditor devolveu ao desenvolvedor pelo canal novo, as arbitragens. No
`assistencia2` eram dezessete decisões, várias delas parágrafos inteiros escritos à
mão — *"Considerar qualquer técnico registrado em `intervencoes_os`; uma ordem
aparece uma vez no relatório"*.

Voltam as ACEITAS, deduplicadas pelo texto. O par pergunta-resposta não é
reconstruído de propósito: os ids das rodadas de lacuna colidem no handoff por
construção, porque cada rodada recomeça em `Q-01`. O que a autoridade precisa é do
TEXTO da decisão, que é o que o escritor e o auditor leem. O que ficou em aberto não
volta: se o marcador reaparecer, a insistência o pega de novo, com as saídas que a
fecham.

E elas entram como decididas **depois do esqueleto**, que é o que são: o bloco
`Decisions taken after the skeleton was written` do prompt da fase passou a ser
calculado só contra as decisões do `init`, e não contra tudo o que já está na
memória.

## §77 — O escritor era julgado contra um pedido que ele não podia ler

A pergunta do desenvolvedor — *"estamos correndo atrás do rabo?"* — obrigou a medir
antes de consertar, e o que apareceu foi a causa por baixo de §73, §75 e §76.

### 77.1 A assimetria

```
phaseAuditPrompt      → "## The developer's original request (verbatim)"   ✓
phaseFromSlicePrompt  → …não tinha essa seção.
```

O auditor de uma fase recebe o pedido inteiro. O escritor da fase recebia só a
fatia do esqueleto. O pedido do `assistencia2` tem **16.752 caracteres** e fala de
"rolagem" ou "linhas" **nove vezes** — ele prescreve até o tamanho dos campos —, e
nada disso sobrevive à compressão em stack, entidades e regras.

Dos 25 achados de uma tentativa de auditoria, **18 eram detalhes que o pedido exige
e a fase não podia conhecer**, e 7 eram "recopie o modelo de dados". O escritor
fechava o que era apontado, o auditor achava o próximo, e o laço não convergia — não
por amostragem, por **ausência**: a informação que fecharia o ponto não estava na mão
de quem escreve.

O escritor da fase e a emenda passaram a receber o pedido, com o limite dito: *você
escreve SÓ esta fase; o pedido está aqui para você acertar o detalhe do seu próprio
trabalho, nunca para trazer trabalho de outra*. Custa 16 KB em 13 chamadas; uma
rodada de auditoria custava 13 chamadas de auditor mais 13 de emenda.

Um teste que comparava o tamanho dos dois prompts caiu com isso, e era um proxy
ruim desde sempre: a tese nunca foi "o prompt da fase é menor", é "a fase não
carrega o que as outras cobrem". Passou a ser isso que ele mede.

### 77.2 O endereço escondia a repetição

`fingerprint` era `where::problem`, e o `where` é a parte que o auditor reescreve:
ele cita o título da task, a emenda mexe no título. Medido na mesma fase, tentativas
2 e 3:

```
t2: Tarefa de geração manual de cobranças | Os critérios definem o primeiro…
t3: Tarefa «Gerar manualmente cobranças da recorrência de tenants ativos» | Os critérios definem o primeiro…
```

Mesmo problema, endereço novo, hash novo. São duas perguntas diferentes e agora são
duas marcas: `fingerprint` (endereço + problema) continua contando defeitos — "fechou
1 de 2" precisa distinguir o mesmo defeito em dois lugares —, e `marcaDoProblema`
(problema normalizado) decide se é o mesmo ponto de novo.

### 77.3 O levantamento arbitrava tudo, sempre

E aqui estava o defeito que o desenvolvedor sentiu como *"o auditor está barrando
tudo"*: `history.push` acontece antes de `nextAuditAction`, então a história já
contém o veredito que está sendo tratado — e `ehRepetido`, que procura o achado
nela, **encontrava o achado nele mesmo**. Todo achado parecia repetido na primeira
aparição.

O §70 diz o contrário com todas as letras: *"um achado que aparece uma vez é defeito
— o escritor conserta e segue; um achado que sobrevive a uma reescrita é desacordo"*.
O escritor nunca ganhou a primeira chance, e no `assistencia2` isso apareceu como
sete arbitragens numa auditoria de nove achados: o desenvolvedor decidindo o que o
escritor teria fechado sozinho.

### 77.4 O teste adversário, que é o que faz isso parar de custar horas

Os defeitos de convergência deste harness foram todos descobertos em produção, a
duas horas de run por descoberta, porque **os roteiros de teste sempre aprovavam na
segunda volta**. `test/init/convergencia.spec.ts` roteiriza o comportamento
adversário: um auditor que devolve um achado verdadeiro e NOVO a cada leitura, para
sempre, com o endereço reescrito. Ele não é injusto — é o que um modelo faz quando a
pergunta que lhe foi feita não tem borda.

O que o teste afirma não é que o plano fica bom: é que o harness **termina**, e que o
preço em atenção do desenvolvedor é limitado. Ele achou três defeitos na primeira
execução:

1. **sessenta perguntas** — o teto de arbitragem era contado em pontos; passou a ser
   contado em rodadas, que é o que custa uma auditoria inteira depois de cada uma;
2. **três perguntas para o mesmo ponto** — a auditoria do plano são N chamadas, o
   mesmo defeito aparece em várias com endereços diferentes, e o filtro era calculado
   uma vez antes do laço. A decisão é do PONTO: tomada uma vez, vale para todos os
   achados que dizem o mesmo;
3. **§77.3**, indiretamente: a contagem de perguntas só fechou depois que
   `ehRepetido` parou de se encontrar.

### 77.5 A fronteira entre os critérios e o esqueleto

Os 7 achados restantes eram *"os critérios não exigem todos os dados do cadastro: e-mail
opcional, endereço, número, bairro, cidade e UF"*. Os campos estão no esqueleto, que o
executor é mandado ler e o verificador também lê. A regra nova separa **forma** —
quais colunas existem, tipos, o conjunto de valores de um campo enumerado, que é do
esqueleto — de **comportamento** — o que acontece, o que é recusado, o que é exibido,
que é dos critérios. Reprovar por não reenumerar o modelo não tem fim, e inflar a task
para caber a enumeração estoura o teto que mantém a fase dentro de uma sessão.

### 77.6 E a regra de contexto, que é a mesma lição

Compactar contexto é perder detalhe, e perder detalhe é o defeito deste capítulo
inteiro. No harness isso tem um endereço concreto que ainda está aberto: o teto de 15
tasks por fase está sendo usado como ALVO pelo escritor do esqueleto — média de 12,2
no `assistencia2`, seis fases entre 12 e 14 —, e fase densa é sessão longa de
executor, mais perto do limite de contexto dele, onde a compactação começa a
inventar. O teto precisa voltar a ser teto.

### 77.7 A emenda ia para a fase errada — ou para nenhuma

O run seguinte ao §77 foi PIOR, e o desenvolvedor o descreveu com precisão: *"o
auditor tinha validado 3 das 13, abriu uma série de perguntas, eu selecionei tudo
que foi recomendado e ele reprovou até as que já estavam aprovadas"*.

A causa é minha e é do §76: ligar a auditoria por fase mudou a FORMA dos achados.
Uma chamada que audita a fase 4 já sabe qual fase é, então o auditor escreve o
endereço como título de task — `Tarefa «Gerar manualmente cobranças…»`. Medido nos
logs:

| tentativa | achados que NÃO citam a fase |
| --- | --- |
| 2 | 19 de 22 |
| 3 | **24 de 25** |
| 4 | 20 de 21 |

E `affectedPhases` decide o que reescrever lendo a prosa do achado, com um fallback
de "todas as fases" para quando nada é derivável. O fallback nunca era alcançado,
porque UM achado — o da auditoria de coerência, que usa `P1.T9.C2` — citava uma
fase. Então:

- os 24 achados sem fase **não eram entregues a ninguém**: o auditor os reportava,
  a emenda não os recebia, e eles voltavam em toda leitura seguinte, reescritos com
  outras palavras;
- a única fase nomeada era reescrita mesmo já aprovada; a marca de uma aprovação é o
  sha do texto da fase, então ela mudava e a fase voltava à fila.

O conserto é o harness dizer o que ele sabe em vez de deixar alguém adivinhar pela
prosa: `Finding` ganhou `phase`, a auditoria por fase o preenche com o número da
chamada, a rodada de lacunas o preenche com a fase onde o marcador vive, e
`affectedPhases` prefere esse campo. O fallback de "todas as fases" continua, para
o achado que legitimamente não tem fase — o da coerência sem endereço.

E o invariante entrou no teste de convergência: **achado da fase 2 não reescreve a
fase 1, mesmo sem citar número nenhum.** Desligando o campo, o teste falha com
`['phase-p01', 'phase-p02']` — a fase aprovada sendo reescrita, que é exatamente o
que o desenvolvedor viu na tela.

## §78 — O painel diz quanto falta, o que está acontecendo, e ocupa a tela

Dois pedidos do desenvolvedor, com um desenho de referência junto: as caixas
**PROGRESSO** e **TRABALHO ATUAL** lado a lado, em TODO estágio; e o painel
ocupando a área disponível do terminal, expandindo numa tela grande e compactando
numa pequena.

### 78.1 As duas perguntas que o painel não respondia

Ele mostrava a etapa corrente e uma janela de log que rola. Quanto falta e o que
deu errado da última vez eram contas de cabeça — e a segunda nem isso: o painel via
toda devolução passar e **não guardava nenhuma**. Quem chegava na frente da tela
depois de dez minutos via "em andamento" e a fase corrente, sem nada sobre o que
tinha feito o ciclo anterior voltar.

Cada estágio conta o que ele tem, e todos têm alguma coisa — é por isso que a caixa
pode ser a mesma em todos:

| estágio | barras |
| --- | --- |
| `init` | etapas do pipeline concluídas |
| `plan` | fases escritas · fases aprovadas · tasks das fases aprovadas |
| `build` | fases fechadas · tasks que elas carregam |

A contagem de tasks exigiu um campo novo que já existia dos dois lados e não chegava
à tela: o esqueleto aloca `taskCount` por fase, e a sessão do build sabe quantas
tasks a fase tem. Ausente, a barra some em vez de mostrar zero — zero seria mentira.

### 78.2 Ocupar a tela é crescer, não só encolher

`renderDashboard` tinha um laço que encolhia enquanto não coubesse — eventos, fases,
desenho, modo denso — e nada que fizesse o contrário. Num terminal de 60 linhas ele
desenhava o mesmo tamanho de sempre e deixava metade da tela vazia, **enquanto
cortava eventos e fases que caberiam folgadas**.

Agora ele cresce na ordem inversa do encolhimento — primeiro reabre as caixas,
depois a lista de fases, depois os eventos — e só então preenche o que sobrar, com o
rodapé descendo junto. Ocupar a tela não é escrever até o fim: é a moldura chegar
embaixo.

E as caixas entraram no laço de encolhimento, o que era a parte perigosa: sem esse
degrau, acrescentá-las empurrava um terminal de 24 linhas para o desenho de
emergência — o painel inteiro virava lista de texto sem moldura. A ordem do que se
perde é a ordem do que se pode perder: eventos passados, fases fora da janela, o
desenho, o modo denso, as caixas (primeiro compactas, depois nenhuma), e por último
a lista de fases até uma linha. O que sobra na tela mínima é o que responde "onde
está e o que quebrou".

### 78.3 O painel não pode derrubar o run

A pergunta do desenvolvedor antes de rodar — *"não vai explodir?"* — obrigou a
olhar o caminho que ninguém tinha olhado: `repaint()` chama `live.draw(desenhar())`
**sem proteção nenhuma**, e `repaint` é chamado de dentro do `announce`, do
`onProgress` e do `onPhaseProgress`, que rodam dentro do laço do orquestrador. Uma
exceção no desenho sobe por ali e mata um run de horas por causa de uma linha de
moldura.

O risco existia antes, e eu tinha acabado de dobrar a complexidade do desenho —
barras, duas caixas, crescimento, preenchimento, dados novos que podem vir
ausentes. É exatamente o caso da lei de impacto: quem mais depende do que eu estou
mudando? O laço do run inteiro.

Duas defesas, e as duas fazem falta:

- `renderDashboard` é **total**: oito modelos hostis no teste — total zero, feito
  maior que o total, negativos, `NaN`, largura 1, altura 1, rótulo de 400
  caracteres, valor de 900 — e nenhum lança nem estoura a largura;
- e o desenho é envelopado **onde a tela encontra a execução**, não dentro do
  renderizador: engolir a exceção lá esconderia o defeito de quem a escreveu. Aqui
  ela vira uma linha visível na tela, o run continua, e quem lê sabe que o painel
  falhou e que `--no-dashboard` existe.

## §79 — As teclas que responderam por quem não estava lá

O desenvolvedor rodou o `plan`, não conseguiu responder as perguntas, saiu, e voltou
achando que **o harness tinha respondido sozinho**. Os artefatos dizem que quase:

> 95 decisões gravadas como autoridade, todas com a resposta `1`, e **33 delas com
> menos de meio segundo entre uma e outra** — rajadas de 0,26 segundos.

Ninguém lê uma arbitragem e escolhe em 0,26s, oito vezes seguidas.

### 79.1 A fila que salva o pipe e trai a pessoa

`createLineIO` guarda toda linha que chega enquanto ninguém está perguntando, e a
entrega à próxima pergunta. Isso existe por um motivo real e documentado: entrada
vinda de arquivo ou pipe chega inteira antes da primeira pergunta, e sem a fila o
readline fecha e o run morre em `ERR_USE_AFTER_CLOSE` — foi assim que o piloto 5
morreu na pergunta 1 de 6.

O que resolve o pipe é veneno na mão de uma pessoa. Num terminal, o que ela digita
ENQUANTO o harness pensa — três minutos esperando um modelo — responde a pergunta
SEGUINTE, que ela ainda não viu. A pergunta aparece e é respondida no mesmo instante,
some da tela, e vira decisão gravada como autoridade: vai para o escritor, para o
auditor, para o relatório e para a base documental.

A regra passou a depender de quem está do outro lado. Em pipe, a fila entrega na
ordem — é um roteiro escrito de propósito. Em terminal, **só conta o que for digitado
depois de a pergunta estar na tela**, e o descarte é dito em voz alta, porque sumir
com a tecla de alguém em silêncio é outra forma do mesmo defeito.

### 79.2 E o conserto de ontem que não funcionava nunca

O mesmo run mostrou o outro lado: a tentativa 3 da auditoria **aprovou 10 das 13
fases**, e a tentativa 4 reauditou 12. As aprovações tinham caído.

A culpada é `faseDoMarcador`, escrita no §77.7 para dizer em que fase vive um
`[NEEDS DECISION]`:

```ts
const bruto = parsePhases(documento);          // recusa: o documento TEM marcador
const cruas = bruto.ok ? bruto.document.phases : fases;   // cai nas fases já limpas
return cruas.find((fase) => fase.markdown.includes(marcador))?.number;  // nunca acha
```

O parser recusa qualquer documento com marcador — que é o único caso em que a função
é chamada. Ela caía no ramo das fases já limpas, cujo texto não contém o marcador, e
devolvia `undefined` **em 100% das chamadas**. Sem fase, `affectedPhases` usa o
fallback de "todas", a emenda reescreve as treze, o sha de cada uma muda, e toda
aprovação cai.

Agora a ESTRUTURA vem do documento sem marcadores e a POSIÇÃO vem do documento cru:
vale a última fase que começa antes do marcador. E o fallback ganhou dono — quem
chama declara. Para um achado de coerência "todas as fases" é a coisa certa, porque
aquele auditor não nomeia fase por natureza; para uma decisão de lacuna é o oposto, e
ela pede `somenteNomeadas`: sem saber qual fase, o harness não reescreve nada e diz
que não soube.

O teste novo falha com o código antigo — `expected [] to deeply equal ['phase-p02']`
—, que é o que faltava na primeira vez.

## §80 — O plano aprovado inteiro, reprovado por uma pergunta sem resposta

A primeira execução depois do §79 **convergiu**. O número que valia olhar era quantas
fases voltavam à auditoria a cada volta, e ele caiu como tinha de cair:

| tentativa | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fases reauditadas | 12 | 5 | 2 | 3 | 2 | 2 | 1 |

Todas aprovadas. E o gate reprovou:

```
✗ O plano executável passa no parser do contrato: linha 807: I-13
✗ O plano não carrega decisão pendente
```

Uma linha, na fase 11 (Estoque e dicas de bancada):

> `[NEEDS DECISION] Indicar a task que implementa workflow 7 ("Clientes e equipamentos"); nenhuma task desta fase cobre esse fluxo.`

### 80.1 A cadeia

1. A conferência mecânica de cobertura achou que o workflow 7 não era rastreado por
   task nenhuma — verdade, e defeito real.
2. O achado saiu com `where: "Traces"` e sem fase. `affectedPhases` fez o que faz com
   achado sem endereço: mandou para as treze.
3. A fase 11 recebeu a emenda *"cubra o workflow 7"*. O workflow 7 não está na fatia
   dela — é da fase 6 —, e ela fez a única coisa legal que o prompt da emenda
   permite: marcou `[NEEDS DECISION]`.
4. A rodada de lacunas perguntou, e a pergunta não tinha resposta possível: a
   resposta verdadeira é *"isto não é da fase 11"*, e isso não é uma decisão de
   produto. O marcador sobreviveu a quatro voltas, a auditoria — que lê a estrutura
   sem marcadores, §76.1 — aprovou tudo, e o gate recusou.

O harness **sabia** a resposta: o workflow 7 está no `covers` da fase 6. É o princípio
do §77.7 — o harness diz o que sabe em vez de deixar adivinhar pela prosa — e ele
tinha ficado de fora justamente da conferência que o harness faz sozinho.

### 80.2 O conserto, sem tocar no contrato

`checkCoverage` continua decidindo O QUE falta, com as mesmas mensagens. O que muda é
PARA ONDE vai: cada item é conferido sozinho, e o achado dele carrega a fase que o
esqueleto diz ser a dona. Item em mais de uma fase vira um achado para cada uma —
qualquer uma que o rastreie satisfaz a checagem.

Havia o caminho de acrescentar um campo `subject` ao `ContractError`. A lei de impacto
escolheu o outro: o orquestrador já tem o esqueleto e pode rotear sozinho, e o contrato
fica como estava. O teste novo falha com o código antigo —
`expected ['phase-p01','phase-p02'] to deeply equal ['phase-p02']`.

## §81 — O ensaio julgava o critério sem a fase em volta

Uma arbitragem chegou à tela do desenvolvedor pedindo que ele decidisse se este
critério podia ser provado:

> `npm run db:migrate` cria, em banco vazio, as 23 tabelas enumeradas nesta fase e
> termina sem erro quando executado novamente.

O ensaio disse UNOBSERVABLE: *"as 23 tabelas são mencionadas por quantidade, mas não
enumeradas no material recebido"*. O escritor reescreveu e o veredito se manteve,
porque não havia o que consertar — a fase 1 cobre exatamente 23 entidades, listadas
no `Covers` dela.

O ensaio nunca tinha visto a fase. Ele era chamado com contexto vazio —
`rehearse(verdict.authored, writerDoPlano, [])` — e julgava cada critério como uma
linha solta. Um critério que se refere a "esta fase" era, para ele, referência a algo
que não existe.

É a mesma assimetria do §77 em outro par: quem ensaia precisa ver o que quem vai
julgar DE VERDADE vai ver. O verificador do build recebe a fase inteira e lê o
esqueleto no repositório; o ensaio agora recebe as duas coisas, lote a lote. Os lotes
nunca misturam fases, então cada um leva só a sua.

E a pergunta de arbitragem do ensaio ganhou a forma que o desenvolvedor definiu para a
do auditor no §78 — a área e o que a escolha resolve, uma leitura, a outra, e nada
mais. Era a irmã que tinha ficado para trás, e foi colada de volta na conversa
exatamente com o "por que importa" e o "recomendo porque" que a outra já não tinha.

## §82 — RALPH READY, e as duas mentiras do relatório

O `assistencia2` fechou o `plan`: **RALPH READY**, 12 fases, 107 tasks, 25 stories,
23 entidades, 15 workflows, versionado no repositório que o `init` criou. Custo total
de modelo em torno de 49 minutos — escritor 25, auditor 11, verificador 13.

O relatório, lido linha a linha, tinha duas coisas erradas.

### 82.1 A resposta pendurada na pergunta errada

```
· Vencimento da recorrência: Último dia disponível, preservando o dia original
· Vencimento da recorrência: Criar uma tarefa única para clientes e equipamentos
```

A segunda decisão não tem nada a ver com vencimento — é a resposta ao marcador do
workflow 7 (§80). Cada rodada de lacuna recomeça em `Q-01`, e o handoff guardava o id
LOCAL: `persistAnswers` descartava a pergunta da rodada 2 por já existir um `Q-01`, mas
guardava a resposta. A resposta certa ficou pendurada na pergunta da rodada 1.

O texto da decisão estava certo, e é ele que o escritor e o auditor leem. O que saía
errado era o rótulo no relatório — e, na retomada do §76.4, o par que o escritor
recebia como "já perguntado": *"como calcular o vencimento → uma tarefa única para
clientes"*. A rodada de lacunas passou a gravar o id escopado; os outros cinco
chamadores de `persistAnswers` já gravavam ids únicos.

### 82.2 O endereço dito duas vezes

```
· ensaio · P1.T3.C1: P1.T3.C1: fica como está
```

O conserto de `f9ede43` conhecia um prefixo só — `auditoria` — e **saiu sem teste**.
A arbitragem do ensaio nasceu depois, com tópico `ensaio · …`, e ninguém viu a linha
irmã. Agora qualquer `<origem> · <endereço>` é tratado, e o teste que faltou existe e
cobre as duas.

## §83 — O build cobrou da fase a credencial que o provider recusou

O `P02` do `assistencia2` caiu no terceiro ciclo, e o terminal mostrava o motivo:

```
unexpected status 401 Unauthorized: Incorrect API key provided: sk-…
```

A sequência, nos artefatos:

| ciclo | onde parou | de quem era |
| --- | --- | --- |
| 1 | gate 4 — os roteiros rodando na ordem errada | real, dos roteiros |
| 2 | o executor contestou os roteiros, certo; o **verificador levou 401**, não emitiu linha nenhuma, e o gate 3 contou como reprovação | da credencial |
| 3 | o **executor levou 401** em trinta segundos, e o build parou | da credencial |

O produto não reprovou duas vezes. A credencial caiu duas vezes, e a fase pagou. De
quebra, a reescrita dos roteiros que o executor pediu no ciclo 2 nunca aconteceu,
porque o gate 4 não chegou a rodar.

### 83.1 Uma chamada protegida em três

O runner fala com o provider em três lugares — o executor, o verificador e o autor
dos roteiros —, e só o executor tinha proteção, e só contra limite de uso. Os outros
dois recebiam a falha do ambiente como texto, e o gate lia esse texto como se fosse
trabalho. É a correção pela metade na forma mais direta: a mesma chamada, ao mesmo
provider, protegida num lugar e crua nos outros dois.

Agora as três passam pela mesma proteção. Credencial recusada **pára na hora**: não se
espera nem se repete — o limite de uso volta sozinho, a credencial não —, não consome
ciclo, e a parada diz que é do ambiente, com o comando que resolve. Limite de uso no
verificador e no autor agora espera e repete a MESMA chamada, como já acontecia no
executor. `--keep-going` não vale para credencial recusada: a próxima fase bate no
mesmo provider com a mesma credencial.

Sem tratamento próprio, a parada classificava o caso como "produto" e mandava ler a
evidência e corrigir o código — de uma fase que ninguém julgou.

A detecção olha só o fim do log e só as frases com que as CLIs falam da credencial
DELAS. "401 Unauthorized" sozinho não basta: o produto testando a própria rota
protegida não pode parar o build. E a chave nunca entra na evidência, nem mascarada.

### 83.2 O `git add -A` que o harness mandava rodar

Parado no meio de uma fase, o harness instrui: `git add -A && git commit -m "wip"`. Isso
levaria `.capivara/flows/` e `.capivara/.gitignore` para o repositório do produto — os
commits de fase excluem `.capivara/` por pathspec, a instrução ao desenvolvedor não, e
as duas regras discordavam em silêncio.

O harness escreve cinco pastas em `.capivara/` e o `.gitignore` conhecia duas.
`flows/`, `skills/` e `memorias/` nasceram depois da lista e ninguém voltou a ela — a
mesma família do piloto 6, quando foi `handoffs/`. O teste novo pergunta ao **git**, e
não à lista: se uma pasta nova do plano de controle ficar de fora, ele falha.

## §84 — O gate 4 cobrava do produto o que ninguém tinha feito

A P02 do `assistencia2` foi devolvida pelo gate 4 duas vezes com o produto certo. Os
dois roteiros da fase:

| roteiro | o que fez | por que reprovou |
| --- | --- | --- |
| workflow 1 — Instalação inicial | abriu `~/.assistencia2/credenciais-iniciais.txt` | o arquivo não existia: quem o cria é o instalador (`npm run install:initial`), e nada o rodava |
| workflow 4 — Entrada e senha | leu a senha inicial do mesmo arquivo | rodou ao MESMO TEMPO que o 1, de quem dependia |

O executor diagnosticou certo nas duas vezes (`CAPIVARA_ROTEIRO_ERRADO`), mas a
contestação só troca o roteirista — e o novo roteirista estava sob as mesmas regras.

### 84.1 Três defeitos do instrumento, uma família

1. **O roteiro só sabia clicar.** O prompt proíbe `child_process` — com razão: foi
   assim que um roteirista subiu um segundo servidor. Mas um passo de fluxo pode ser
   o que um operador faz no terminal: instalar, migrar, semear. Sem porta para o
   terminal, o roteirista FINGIU que o passo já tinha acontecido.
2. **Os roteiros rodavam em paralelo** (dois workers), dividindo aplicação e banco,
   e um fluxo pode depender do estado que o anterior deixa.
3. **A passagem rodava na máquina de quem roda o harness.** O banco era o do `.env`
   do projeto e o diretório pessoal era o do desenvolvedor: se o instalador tivesse
   rodado, teria escrito no `~/` dele. E o estado sobrevivia de uma passagem à
   seguinte — um fluxo que troca uma senha passaria na fase 2 e reprovaria na
   regressão da fase 3, com a senha já trocada.

### 84.2 O que mudou

- **Cada passagem começa do zero** (`loop/passagem.ts`): um diretório pessoal
  temporário (`HOME`, `USERPROFILE`, `XDG_CONFIG/DATA/STATE_HOME`) e, quando o projeto
  declara o banco como ARQUIVO no `.env.example` ou no `.env` — reconhecido pelo valor
  (`.sqlite`, `.sqlite3`, `.db`, `.db3`), não pelo nome da chave —, um arquivo novo no
  mesmo diretório, apontado pela mesma chave. O `dotenv` e o Next não sobrescrevem o
  que já está no ambiente, então a aplicação e o roteiro enxergam o mesmo banco novo.
  Tudo é apagado ao fim da passagem, inclusive entre a primeira passagem e a que
  segue uma reescrita de roteiro.
- **A migração declarada (`migrate`) roda no banco novo**, com o mesmo ambiente, antes
  de a aplicação subir. Só quando o banco é nosso: com banco em servidor, nada é
  migrado, e o banco do `.env` continua sendo do desenvolvedor.
- **Os caches da máquina continuam onde estão.** Trocar o `HOME` trocaria, junto, o
  lugar onde o Playwright procura o navegador, o npm o cache, o cargo o registro. O
  harness passa os PADRÕES de cada ferramenta, calculados a partir do diretório
  pessoal real, e só quando a variável não existe — para a ferramenta, é o mesmo
  lugar de sempre.
- **Em sequência, na ordem do plano.** `workers: 1`, e cada roteiro vira um projeto do
  Playwright que depende do anterior — é o jeito dele garantir ordem entre arquivos.
  Quando um falha, os seguintes não rodam sobre um estado que não se formou.
- **O ajudante** (`.capivara/flows/capivara-comando.ts`, escrito pelo harness a cada
  passagem como a configuração): `comandoDoProjeto(comando, args)` roda UM comando na
  raiz, com o ambiente da passagem e com prazo. `child_process` continua proibido no
  roteiro, e a conferência mecânica recusa o ajudante chamado com `start`, `dev`,
  `serve`, `preview` ou `build`.
- **O roteirista sabe onde está**: que a passagem começa do zero, qual banco é novo, se
  a migração foi aplicada, quais fluxos rodam antes do dele e onde estão os roteiros
  deles — para ler o estado que deixam.
- **Roteiros antigos são reescritos uma vez.** Todo roteiro gravado leva
  `// capivara-flow: v2` na primeira linha. Sem ela, o roteiro foi escrito para o
  ambiente antigo e é reescrito — os da fase e os da regressão que existem no disco.
  Um roteiro de regressão AUSENTE continua não sendo escrito, como antes.

### 84.3 Quem lia o que mudou

- `FlowRunner` ganhou um terceiro parâmetro opcional (`env`); os runners de teste de
  dois parâmetros continuam valendo.
- O `author` do gate ganhou a passagem; o único chamador é o `runner.ts`.
- `renderFlowConfig` sem `scripts` continua gerando a configuração antiga, mais
  `workers: 1`.
- `prepararAmbiente` (o `.env` semeado e a migração no banco do `.env` descartável)
  não mudou: ele serve o gate 2 e continua servindo.

Provado com um Playwright de verdade num projeto de rascunho, CommonJS e ESM: dois
roteiros, o primeiro rodando o instalador pelo ajudante, o segundo lendo o que ele
deixou; ordem respeitada, navegador encontrado, e nada escrito no `~/` real nem no
banco do projeto.

### 84.4 A contestação reescrevia o roteiro errado

Na P04 do `assistencia2`, com a passagem já isolada, quem reprovou foi o roteiro de
REGRESSÃO da P02: ele afirmava uma frase do painel que a P04 trocou pela navegação,
e que nenhum critério pede. O executor contestou certo, duas vezes. A contestação
reescrevia só os roteiros DA FASE — que nem tinham rodado, porque o de regressão
falhou antes deles. A mesma coisa valia para a reescrita automática de roteiro que
falha por conta própria.

Agora o gate devolve quais fluxos falharam (`falharam`, lido das linhas `✘` e `N)` do
Playwright; "não rodou" não conta), o runner guarda isso, e a contestação seguinte
reescreve ESSES roteiros, da fase ou da regressão. Sem a informação — contestação
num run retomado, antes de qualquer passagem do gate —, vale o comportamento antigo.

O custo, dito: o executor de uma fase posterior passa a poder pedir a reescrita de
um roteiro de uma fase anterior. É a mesma saída que já existia para os roteiros da
fase, com a mesma trava — quem reescreve é outra sessão, lendo o produto, presa aos
passos do esqueleto, e a contestação vale uma vez por fase.

### 84.5 O build retomado perdia a regressão

Com a contestação já certa, a P04 retomada reprovou de outro jeito: a passagem rodou
só os roteiros 2 e 3, da própria fase, e o 2 caiu em `no such table: usuarios`. Os
roteiros 1 e 4, da P02, sumiram da regressão.

O `runBuild` pula as fases prontas por dois ramos: a fase fechada num run ANTERIOR
(por sha do texto) e a fase fechada NESTE run (o id do run é o hash do plano, então
retomar o mesmo plano é o mesmo run). O primeiro ramo punha os fluxos da fase na
regressão; o segundo, não. Correção pela metade, de novo entre irmãos.

Com a passagem isolada, perder a regressão deixou de ser só perder cobertura: o
roteiro 2 foi escrito sabendo que o 1 roda antes dele e prepara o banco. Sem o 1, ele
roda primeiro, num banco vazio. Agora o segundo ramo faz o mesmo que o primeiro, e o
build retomado percorre a mesma regressão que o build sem interrupção.

### 84.6 O erro de digitação do roteirista cobrado do produto

Um roteiro reescrito da P04 trazia `${sufo}` por `${sufixo}` e morria antes do
primeiro passo com `ReferenceError: sufo is not defined`. O classificador de "falha do
roteiro" não conhecia o `ReferenceError`, e o gate cobraria do produto — com a
contestação da fase já gasta.

E o classificador lia a saída INTEIRA, inclusive as linhas `[WebServer]` da
aplicação: um `TypeError: x is not a function` do próprio produto mandava reescrever
um roteiro certo. Agora ele lê só as linhas do runner, e `ReferenceError` / `is not
defined` contam como erro do roteiro.

### 84.7 A reescrita que repetia o erro

O roteirista do workflow 3 recebeu `ReferenceError: sufo is not defined`, com a linha
do erro, e devolveu o mesmo `${sufo}` — o terceiro no mesmo run, sempre no lugar de
`${sufixo}`. A reescrita depois de falha do roteiro tinha UMA tentativa e era gravada
sem conferência além da estrutural; a segunda passagem falhou igual, e a fase pagou um
ciclo do executor por um erro de digitação do instrumento.

Agora a reescrita tem as mesmas tentativas da primeira redação, e cada uma é
conferida contra os nomes que o erro apontou: se o roteiro usa o nome e nenhuma
declaração o introduz, volta ao roteirista com isso dito. A conferência é
conservadora — qualquer forma de declaração absolve o nome —, porque recusar um
roteiro certo custa uma sessão, e deixar passar um errado custa o que já custava.

Continua aberto, e é o item 3 do HANDOFF com evidência nova: quando o roteiro falha
por si mesmo duas vezes, o gate devolve `scriptFailed` e o ciclo do EXECUTOR é
consumido — ele recebe "isto é do harness, não da sua implementação" e não tem o que
fazer. Deveria custar sessão de roteirista, não ciclo de fase.

## §85 — As memórias de tasks eram mudas da fase 2 em diante

A P05 do `assistencia2` parou no gate 3 do ciclo 3 com a task 9 INCOMPLETE — a mesma
task que o verificador tinha aprovado no ciclo 2. A memória de tasks aprovadas devia
ter impedido a repergunta, e o arquivo dela tinha 12 entradas, todas da P01.

### 85.1 A causa

`parsePhaseFragment` lê uma fase solta embrulhando-a num documento de plano e
validando o documento. O validador exige fases numeradas a partir de 1: para toda
fase que não fosse a primeira, "esperava Phase 1 e encontrou Phase 2", e a lista de
tasks saía vazia. Duas memórias dependiam disso e ficaram mudas da P02 à P12:

- a do verificador no `build` (`.capivara/handoffs/tasks.json`): nada gravado, toda
  verificação reperguntava tudo;
- a do auditor no `plan` (`TasksJulgadas`): a fase emendada era reauditada inteira.

O teste da memória só usava uma "Phase 1". Agora a fase solta é lida como 1 e
devolvida com o número e a dependência DELA.

Uma troca que eu fiz junto e desfiz: registrar as tasks julgadas antes de guardar a
aprovação da fase no `plan`. A `TasksJulgadas` vive só na execução; na seguinte ela
começa vazia e o prompt não lista task nenhuma — a aprovação precisa estar guardada
SEM a lista, que é o que a ordem original faz. A troca teria feito toda fase aprovada
ser reauditada na execução seguinte.

### 85.2 A reabertura agora vale

Com a memória funcionando em todas as fases, a regra antiga passava a valer em todas:
reabrir uma task já aprovada NÃO reprovava — o veredito antigo prevalecia, para conter
a amostragem da P01 do `assitencia`. Na P05 ela teria deixado passar um defeito real:
o termo de responsabilidade só aparece dentro do formulário, que só aparece para quem
pode editar — quem só consulta não o vê, e o critério diz "consulta e edição
condicionadas à permissão".

Decisão do desenvolvedor: **a reabertura sempre vale.** A memória evita PERGUNTAR de
novo; ela não cala o verificador que achou algo. A task reaberta reprova a fase, sai
do registro e volta a ser verificada. O prompt do verificador mudou junto: antes ele
mandava falar da regressão "na task que foi corrigida"; agora manda marcar a própria
task quebrada, e continua dizendo para não rejulgar por zelo — "report what you ran
into, not what you hunted".

O risco aceito, dito: o vai-e-vem da P01 pode voltar se o verificador reabrir por
amostragem. A instrução contra rejulgar continua sendo a contenção.

## §86 — A contestação valia uma vez por fase, e a fase pagou quatro ciclos

A P05 do `assistencia2`, retomada com mais ciclos:

| ciclo | o que o executor disse | o que o harness fez |
| --- | --- | --- |
| 2 | o roteiro procura "Salvar registro"; a tela diz "Salvar" | reescreveu o workflow 6 |
| 3 | o roteiro novo procura a mensagem sob "Editar registro", título que vira "Novo registro" depois de excluir | **ignorou** — a cota da fase já tinha ido |
| 4 | nada a mudar | rodou o mesmo roteiro |
| 5, 6 | o mesmo diagnóstico do ciclo 3 | ignorou |

O diagnóstico do ciclo 3 estava certo: a reescrita do ciclo 2 consertou o rótulo e
nasceu com outro defeito. A trava "uma vez por fase" existia para o executor não
fugir de defeito real contestando sempre — mas ela não distinguia contestar a MESMA
versão do roteiro de contestar uma versão NOVA, que ninguém tinha contestado. Quatro
ciclos rodaram um roteiro determinístico contra um produto que ninguém mudou.

Agora a contestação vale uma vez por VERSÃO: o harness guarda o sha dos roteiros que
falharam quando uma contestação é aceita, e aceita a próxima se algum dos roteiros
que falharam é uma versão que ainda não foi contestada. A mesma versão, contestada de
novo, é ignorada — e isso agora é dito na tela, em vez de sumir. A fuga continua
fechada: cada reescrita é de outra sessão, que lê o produto de novo; se o produto
estiver errado, o roteiro novo reprova igual, e tudo segue limitado pelos ciclos.

Continua aberto, e esta P05 é a evidência: quando o executor não muda nada e o gate 4
falha IGUAL ao ciclo anterior, o próximo ciclo é determinístico — vai falhar de novo.
O harness poderia parar ali em vez de queimar ciclos.

## §87 — A triagem do gate 4

Na P04 e na P05 do `assistencia2`, o gate 4 reprovou mais de uma dúzia de vezes, e
três delas eram defeito do produto (a edição do tenant com 400, o termo invisível a
quem só consulta, o termo que não volta ao recarregar). O resto foi instrumento:
rótulo que não existia, título que muda depois de excluir, recarregar sem esperar o
salvamento, conferir `true` onde a API manda `1`. Em todos, o gate mandava ao
executor o rastro do Playwright, e o executor era a única parte do ciclo que via o
produto e o erro juntos — e gastava um ciclo inteiro para dizer "o roteiro está
errado".

### 87.1 O que entra antes do executor

Quando um passo falha, uma sessão independente, que só lê, decide de quem é a falha.
Ela recebe os critérios da fase, os passos do fluxo, o roteiro, a saída do runner, os
erros do servidor — e o RETRATO da página no instante da falha: a árvore de
acessibilidade que o Playwright grava em `error-context.md` e que ninguém lia. Na P05,
ele mostrava o botão "Salvar" ao lado do "Salvar registro" procurado.

O veredito tem formato fixo (`CAPIVARA_TRIAGEM`, `_EVIDENCIA`, `_ONDE`, `_CRITERIO`,
`_CORRECAO`) e três destinos:

- **PRODUTO** — o executor recebe a correção estruturada: evidência, onde, critério,
  o que mudar. O rastro vai junto, no fim, para conferir;
- **ROTEIRO** — o harness reescreve o roteiro na hora, com o motivo e o retrato, e roda
  a passagem de novo, sem gastar ciclo do executor. Uma vez por chamada do gate: se
  falhar de novo, a nova triagem vai ao executor;
- **CRITERIO** — o critério não decide o caso. Decisão do desenvolvedor: o build segue
  com a leitura recomendada e o caso fica em `.capivara/decisoes-do-build.md`.

Sem veredito legível, o gate faz o que fazia antes. A triagem nunca bloqueia.

### 87.2 O que mudou em volta

- O Playwright grava em `.capivara/flows/resultados/` (`outputDir`). O padrão dele é a
  pasta do `package.json` — a raiz do produto —, e no `assistencia2` o
  `test-results/.last-run.json` foi parar no histórico da aplicação.
- A reescrita de roteiro virou uma função só, usada pela falha do próprio roteiro e
  pela triagem, com as mesmas tentativas e a mesma conferência de nomes não definidos.
- A triagem passa pela mesma proteção dos outros leitores: credencial recusada e
  limite de uso param o build pela mesma via do roteirista (§83). Um `catch` que eu
  tinha escrito em volta dela engoliria isso, e saiu antes do commit.
- `.capivara/decisoes-do-build.md` fica fora do gate 1, do preflight e do commit da
  fase, como tudo em `.capivara/`; não é ignorado pelo git, para o desenvolvedor
  poder versioná-lo.

Provado com um Playwright de verdade num projeto de rascunho: roteiro procurando
"Salvar registro" numa página com "Salvar"; a triagem recebeu o retrato real, o
roteiro foi reescrito e a mesma chamada do gate saiu verde.

## §88 — O serviço de terceiro que a conferência recusava

A P06 do `assistencia2` não chegou a abrir a aplicação no gate 4: o roteiro do
workflow 7 "não passou na conferência estrutural em 2 tentativas", ciclo após ciclo,
com o executor sem nada a mudar. O roteirista substituía a consulta de CEP à BrasilAPI
com `page.route('https://brasilapi.com.br/api/cep/...')` — o que o prompt dele
autoriza: "um serviço de terceiro pode ser substituído". A regra mecânica recusava
qualquer `page.route` cuja URL contivesse `/api/`, e a da BrasilAPI contém.

Agora URL absoluta para outro host é de terceiro e passa; o que continua recusado é
relativo, glob e local (`/api/clientes`, `**/api/**`, `localhost`, `127.0.0.1`). Os
dois rascunhos recusados na P06 passam na conferência nova.

O evento do run guarda só a primeira linha da causa, e a lista de defeitos da
conferência ficava nas linhas seguintes: o diagnóstico precisou reproduzir a
conferência sobre o log do roteirista.

## §89 — O relógio de ocioso numa CLI que só responde no fim

O `survey` do cronus3, com o claude como escritor, parou na leitura do domínio D-03
(56 arquivos): "encerrada por limite do harness (idle)". O `claude -p
--output-format json` não escreve nada até terminar; o harness já sabia disso e,
para CLIs assim, desligava o limite de PRIMEIRA SAÍDA desde a fase 3 do MCP_teste.
O de OCIOSO continuava ligado: ele começa a contar na primeira coisa que o processo
escreve — um aviso no stderr basta —, e dali em diante dez minutos do silêncio
normal de quem está trabalhando matavam a chamada. Correção pela metade.

Agora quem não transmite (claude, agy, cursor) fica só sob o limite de PAREDE; codex
e opencode, que transmitem, continuam sob os três.

## §90 — Quatro leitores de JSON, dois comportamentos

O `survey` do cronus3 com o codex parou no mapa: "a resposta não é JSON válido",
três vezes. A resposta do modelo não ficou no disco desta máquina, mas o leitor
tinha dois jeitos de recusar JSON certo, e um levantamento de código cai nos dois:

- uma frase antes do objeto ("Segue o mapa: {…}") — nenhum leitor tolerava;
- um trecho de código com crases dentro de uma string do JSON — três dos leitores
  pegavam a PRIMEIRA cerca que aparecesse e cortavam o objeto no meio.

E eram quatro cópias: survey, esqueleto e change com um comportamento, a entrevista
com outro. Agora há um leitor só (`contract/resposta.ts`), que tenta a resposta
inteira, depois as cercas — as marcadas `json` primeiro —, e por fim do primeiro `{`
ao último `}`; o primeiro objeto que sair vence, e quem chama continua conferindo o
contrato. Resposta cortada continua recusada.

O teto de bytes por resposta é 8 MB; a hipótese de o harness ter truncado o mapa
não se sustenta.

## §91 — O codex que nunca rodou, lido como JSON inválido

Depois do §90, o `survey` do cronus3 com o codex falhou igual: "o levantamento de
mapa veio inválido 3 vezes: a resposta não é JSON válido". A causa não era o JSON.

- O codex recebe `--cd <raiz>`, e a raiz do survey é a pasta de SAÍDA
  (`./levantamento`), que o orquestrador só criava DEPOIS do mapa. Com uma pasta que
  não existe, `codex exec` responde `Error: No such file or directory (os error 2)` e
  sai com código ZERO. O claude escapava porque não recebe `--cd`.
- O survey não olhava se a chamada tinha falhado: pedia ao modelo que "corrigisse o
  JSON" de uma mensagem de erro, três vezes, e a parada dizia "da sessão do modelo".
  O build separa isso desde sempre (gate 0); o survey não.
- A parada apontava a evidência em `.capivara/runs/survey-…`, que não existia: a
  ponte não grava as respostas, e o run do survey mora sob a pasta de saída.

Agora a ponte cria a raiz antes de qualquer chamada — em todo estágio; para init,
plan e build ela já existe —, e o survey pára na primeira chamada que volta sem
resultado legível, com código diferente de zero ou com erro reportado, dizendo que
é do ambiente e mostrando o que a CLI disse. Provado com o codex de verdade e a
pasta inexistente: a chamada respondeu.


## §92 — A escolha vira lista na moldura do painel

O wizard imprimia uma pergunta embaixo da outra e lia números: quem chegava ao
modelo do verificador já não via o que tinha escolhido para o escritor, e a tela
não se parecia com o painel que vinha depois. O pedido do desenvolvedor foi
escolher "diretamente na TUI", e a mascote nova (`docs/mascote/`) veio junto.

A D-08 continua valendo — nenhuma dependência de UI entrou. O que muda é a forma
da regra "toda escolha fechada é NUMÉRICA". Ela existia por dois defeitos, e os
dois continuam impedidos por outro caminho:

- **colagem lida como escolha.** O terminal agora marca a colagem (*bracketed
  paste*, `tui/keys.ts`), e a lista a recusa com aviso. No campo de uma linha,
  a colagem fica inteira no campo com as quebras viradas espaço — não responde
  mais as perguntas seguintes, uma linha por pergunta;
- **tecla perdida virando decisão** (o `assistencia2`, 33 decisões em rajadas
  de 0,26s). Tecla que chega sem pergunta na tela é descartada e o descarte é
  dito, como no `line-io`. E o número MOVE o cursor, não confirma: só o Enter
  decide.

Com uma pessoa no terminal (entrada e saída em TTY), os três wizards — o
`capivara` sem argumentos, o "falta o pedido" e o "falta o modelo" — desenham a
pergunta dentro da moldura do painel, com a capivara, "SUAS ESCOLHAS" e o campo
ou a lista (`commands/key-io.ts`, `tui/wizard-screen.ts`). O modelo deixou de
ser uma lista impressa mais um campo livre: "digitar outro nome" e "voltar ao
provider" viraram linhas da própria lista. Em pipe, arquivo, CI ou com
`CAPIVARA_LINE_INPUT=1`, é a leitura numerada de sempre — o wizard só pergunta
ao `WizardIO` se ele sabe `select`/`multiline`, e os roteiros de linha
continuam respondendo igual.

O modo raw tira o Ctrl-C do terminal como sinal. Ele é devolvido à mão:
restaura o terminal e só então envia SIGINT. E o terminal sai do modo raw ANTES
de o comando montado rodar, porque o estágio abre o próprio readline — o teste
de PTY do prompt-engineer passa por esse ponto com o wizard por tecla.

Fica para depois: a entrevista, as paradas e os impasses ainda pedem a resposta
numa linha embaixo do painel.

## §93 — A entrevista se responde dentro da caixa da pergunta

Depois do §92, o wizard escolhia por lista, e a entrevista que vinha logo depois
voltava a pedir "sua resposta:" numa linha embaixo do painel, com as opções
numeradas no corpo da caixa. Agora, com o painel na tela e uma pessoa no
terminal, a resposta é escolhida dentro da caixa `PERGUNTA n/m`: as opções
viram linhas da lista, o cursor começa na recomendada, e a consequência aparece
só para a opção sob o cursor — repetida para todas, ela empurrava a lista para
fora de um terminal de 24 linhas.

Cada linha devolve a MESMA string que a resposta digitada devolveria: o número
da opção, `não sei`, ou vazio no prompt-engineer ("deixar em aberto"). O
classificador da entrevista não sabe, e não precisa saber, que a resposta veio
de uma lista; um teste confere cada linha contra `classifyLocally`. "Responder
com texto livre" abre um campo dentro da mesma caixa; Esc ou Enter vazio ali
voltam às opções, em vez de virar um "não sei" que ninguém disse. Pergunta sem
opções vai direto ao campo, e Enter vazio é o adiamento de sempre.

A caixa cabe no terminal. Uma caixa mais alta que a tela faz cada redesenho — a
cada tecla e a cada pulso — empurrar a sobra para o histórico do terminal,
duplicada. Quando falta altura, o "por que importa" sai primeiro e a evidência
encolhe depois, dizendo quantas linhas ficaram de fora; a decisão e a lista
nunca saem.

A sessão de teclas (`createKeySession`) é dona do stdin durante o estágio: um
readline aberto ao mesmo tempo leria as mesmas teclas como linha. As outras
perguntas do estágio — o impasse do auditor, por exemplo — passam pela
pergunta em linha da sessão, que imita o `readline.question` embaixo do painel.
Sem painel, sem TTY ou com `CAPIVARA_LINE_INPUT=1`, tudo continua como antes; o
teste de PTY real cobre os dois modos.

Fica para depois: as paradas, os pré-requisitos e as decisões do build.

## §94 — As decisões do build e o impasse, por lista

Terceira parte do §92. O build pergunta em dois pontos — o projeto sem
repositório Git e o pré-requisito ausente — e as duas perguntas existiam só
como texto numerado. Desenhá-las como lista exigiria reler as opções de dentro
do texto, um segundo parser da mesma pergunta, que é o que a tese deste projeto
proíbe. Agora cada uma é dado (`EscolhaNumerada`, em `loop/escolha.ts`); o texto
numerado é gerado dela, idêntico ao de antes — conferido contra a versão
anterior —, e os hooks `askGit`/`askPrerequisite` recebem as duas formas. A
lista devolve o número da opção, e o leitor de cada pergunta não mudou.

Com o painel e uma pessoa no terminal, a decisão abre embaixo do painel parado:
o texto da pergunta é escrito UMA vez, e só a lista, numa moldura, se redesenha
(`chooseInBox`). O texto pode ser longo — o impasse lista cada ponto em que o
auditor insiste —, e redesenhado a cada tecla empurraria a sobra duplicada para
o histórico. Ao escolher, a moldura fica com a opção marcada.

A sessão de teclas do build abre no começo do comando, não na hora da pergunta:
a tecla batida durante horas de build ficaria no buffer do terminal e responderia
a pergunta no instante em que ela abrisse. E fecha antes da telinha da parada,
que põe o terminal em modo raw por conta própria.

O impasse do auditor (init e plan) virou lista com as quatro saídas que o
orquestrador reconhece: escrever a decisão, reiniciar, publicar como está,
abortar. A decisão escrita continua sendo texto — é ela que vira autoridade
acima do auditor —, e Enter vazio volta às opções.

Ainda por linha: as perguntas do `change` e a colisão de projeto do `survey`,
que não desenham painel.

## §95 — Pausar e ver uma fase no meio do build

O build é a etapa de horas, e o terminal só deixava olhar o painel ou
interromper tudo com Ctrl-C. Agora, com o painel e uma pessoa no terminal:

- **`p` pausa.** A pausa segura a próxima CHAMADA DE MODELO, no `call` do CLI,
  por onde toda chamada do build passa. A sessão de agente em andamento termina,
  a suíte e os fluxos que estiverem rodando terminam, e o build espera antes de
  abrir a sessão seguinte — matar um agente no meio deixaria a árvore num estado
  que nenhum gate avaliou. Enquanto a chamada corrente não acaba, a tela diz
  "pausa pedida"; quando o build para, a atividade vira "⏸ pausado — há Xs". A
  mesma tecla retoma, ou desiste do pedido antes de ele acontecer. O loop não
  mudou: a pausa é do CLI.
- **`f` vê uma fase.** Abre, em tela alternativa, a lista das fases com o estado
  de cada uma, o cursor na corrente. Enter abre a telinha de rolagem das paradas
  com estado, gates e tasks fixos em cima e o texto da fase embaixo — lido do
  plano pelo mesmo `splitPhases` do loop, nenhum segundo parser —, mais os
  eventos recentes que a citam. O build segue rodando por trás; o painel só para
  de desenhar (`LiveRegion.hold`) e, ao voltar, redesenha no mesmo lugar.

`f` só vale depois que o plano é anunciado: antes disso o build ainda pode estar
fazendo uma pergunta própria (Git, pré-requisito), e duas listas disputariam o
teclado. Se o build terminar com uma fase aberta, o desfecho espera a pessoa
fechá-la — duas telas alternativas se pisariam. A telinha recebe o teclado da
sessão de teclas, que continua dona do Ctrl-C. As teclas aparecem no rodapé:
atalho que não aparece na tela não existe.

Provado num PTY real, com o plano do `cron7` e um codex falso: lista, fase,
volta, pausa pedida, pausado antes do ciclo seguinte, retomada.

## §96 — O change e o survey por lista

Os dois últimos comandos que pediam número numa linha. Nenhum deles desenha
painel, então a pergunta abre embaixo do que já está na tela, no mesmo formato
das decisões do build (§94): o texto sai uma vez, com as consequências de cada
opção, e só a lista se redesenha.

- **change**: as perguntas do planejador. As linhas são as opções — o cursor na
  recomendada, marcada — e "responder com texto livre", que abre a pergunta em
  linha (Enter vazio volta às opções). Cada linha devolve o número da opção, que
  o `lerResposta` de sempre traduz; um teste confere cada linha contra ele.
  Entrada esgotada continua sendo a recomendada.
- **survey**: o projeto que já existe na base — atualizar, criar ao lado, não
  mexer. Entrada esgotada continua não mexendo na base.

A tradução entre linha e resposta mora em `commands/escolhas-sem-painel.ts`,
fora do CLI, para ter teste: é onde uma opção trocaria de lugar sem ninguém ver.
A sessão de teclas de cada comando abre no começo dele, como a do build, para
tecla batida durante a chamada do modelo não responder a pergunta seguinte. Sem
TTY ou com `CAPIVARA_LINE_INPUT=1`, a leitura numerada de sempre.

Com isto, nenhuma pergunta fechada do harness se responde mais digitando número
quando há uma pessoa no terminal.

## §97 — O build paralelo: várias fases ao mesmo tempo, cada uma no seu worktree

O build sempre rodou uma fase por vez, e o §5.3 tirou do contrato o
`Parallel safe` e o `Depends on` por task porque "não há paralelismo". Os
planos reais, porém, já declaram um grafo entre FASES no `**Depends on:**` da
linha de metadados — no `erp_teste`, P2 e P3 dependem só da P1; no
`MCP_teste2`, P4 e P5 só da P3. Esta seção usa esse grafo, sem campo novo no
contrato e sem segundo parser.

**A unidade é a fase.** As tasks de uma fase continuam numa sessão só, em
ordem (§5.3 continua valendo): é a fase que tem gates, commit e verificação
própria. `phaseDependencies` lê o `Depends on` com o mesmo tokenizador da
forma canônica (`contract/phase-part.ts`), e `PhaseSession.dependsOn` leva os
números ao build.

**O escalonador é determinístico e conservador** (`loop/escalonador.ts`, função
pura): uma fase só sai quando todas as de que depende estão INTEGRADAS — verde
num worktree não basta; a primeira fase é fundação de todas, mesmo quando o
plano diz `none`; dependência ilegível (fase que não existe, ou que vem depois)
vira "todas as anteriores". Empate é resolvido pela ordem do plano, e o agente
é o de menor número livre. A concorrência configurada é TETO: com o grafo em
fila, o paralelo roda uma fase por vez.

**Cada fase roda num `git worktree` próprio** (`loop/worktree.ts`), num branch
`capivara/<run>/<fase>`, a partir do HEAD integrado, em
`~/.cache/capivara/worktrees/` — fora do projeto, porque a suíte da raiz
acharia os testes de dentro dele. O que o checkout não traz vai copiado (nunca
ligado): skills, roteiros do gate 4, `.env` e `node_modules`. O `runPhase`
ganhou `workRoot`: o agente escreve e os gates rodam no worktree; eventos,
prompts e logs continuam na raiz. Cada chamada leva `root` e `worker`, e o
verificador lê a mesma árvore que o executor escreveu.

**A integração é serial e tem juiz** (`loop/paralelo.ts`): os commits da fase
entram na árvore principal por `cherry-pick` (o histórico continua um
`feat(phase-N)` por fase), o `npm install` roda se a fase mexeu no manifesto, e
a SUÍTE roda na árvore integrada. Conflito ou suíte vermelha desfazem a
integração (`reset --keep`, que recusa apagar o que alguém tenha escrito) e a
fase volta à fila como EXCLUSIVA: roda sozinha sobre a árvore nova, com as
aprovações de task dela revogadas, e por construção não tem com quem
conflitar. Se nem sozinha fecha, falhou como falharia no serial. A conclusão
da fase só vai ao log do run depois da integração (`integracaoPendente`): uma
queda entre o verde no worktree e a integração não faz a retomada pular a fase.

**Falha:** nenhuma fase nova sai; as que estão rodando terminam, e o que fechar
verde ainda é integrado. O parcial da que falhou vai para o branch dela, fora
do produto. Com `--keep-going`, só as que dependem dela são puladas.

**Isolamento** (`loop/isolamento.ts`), perguntado de novo antes de cada leva,
porque num greenfield o `.env.example` só nasce na fase 1:
- *impedimentos* — sem Git, ou git sem worktree — fazem o build NÃO COMEÇAR:
  rodar serial com o nome de paralelo seria mentir na tela;
- *motivos* — banco declarado em servidor, suíte em contêiner — fazem a
  concorrência cair para um agente enquanto valerem, e a tela diz por quê.

Limitações conhecidas, ditas no resumo: só o `node_modules` é copiado (`.venv`
e `vendor` são reinstalados pelo executor em cada worktree); uma suíte que
suba servidor em porta fixa não é detectável; a regressão do gate 4 da árvore
combinada roda na fase seguinte e na aceitação final, não na integração. Cada
agente prefere uma porta do gate 4 diferente (`preferredPort`), para dois
gates não testarem a mesma porta livre ao mesmo tempo. As aprovações de task
(`TasksAprovadas`) passaram a gravar em fila.

O caminho serial não mudou: sem `parallel` no `runBuild`, o laço é o de
sempre, agora com o pulo de fase fechada, as opções da fase e o registro do
verde em funções que os dois caminhos usam.

### §97.1 — O pool de agentes, o wizard e a tela

**O que se configura é o pool, não a divisão do trabalho.** `config/execucao.ts`
define a estratégia: `serial` (padrão) ou `parallel` com `maxConcurrency` (2 a
8) e até um agente por vaga, cada um com provider, modelo, effort e a restrição
`systemInstall: false`. Agente sem configuração É o builder; agente de outro
provider não herda o nome de modelo do builder. O `verifier` não entra no pool:
a verificação continua única e independente de quem construiu. Ninguém atribui
"frontend" ou "banco" a um agente — isso é do escalonador.

**Precedência:** flags (`--serial`, `--parallel <n>`, `--worker`, repetível,
`provider=…,model=…,effort=…,system-install=no` — chave=valor porque nome de
modelo leva `:` e `/`), depois `.capivara/execucao.json`, depois serial. O
arquivo só é escrito por `--save-execution`, que é o que o wizard emite: o
comando impresso e o executado continuam saindo do mesmo argv. Arquivo
malformado sem flag que o substitua para o build com a lista de defeitos; com
flag, vira aviso. Projeto sem arquivo e sem flag roda serial, sempre.

**Conferência antes de começar** (`commands/execucao.ts`): API direta não pode
ser agente (o executor exige CLI), provider que não está na máquina para o
build, `custom` sem adapter também. Intensidade que a CLI não recebe é
limitação dita, descoberta perguntando ao próprio adaptador (a chamada com e
sem effort sai igual — o cursor põe a intensidade no nome do modelo). Agentes
todos no mesmo provider: limitação dita, porque o limite de uso é um só. Um
agente nunca ganha mais acesso que o build: `--no-system-install` vale para
todos.

**O resumo** sai antes da primeira chamada: modo e origem, cada agente com
modelo e restrição, o verificador, as limitações, a largura do grafo ("este
plano deixa até 2 fases ao mesmo tempo: 1 agente não terá o que fazer") e o
estado do isolamento. No serial pedido explicitamente, uma linha dizendo de
onde veio; no serial padrão, nada — a saída de quem nunca pediu paralelo não
mudou.

**Na tela**, a caixa AGENTES (`tui/build-workers.ts`): uma linha por agente,
com o modelo, o estado (livre, preparando, trabalhando, integrando), a fase e
o detalhe dela, e o último desfecho de quem ficou livre. O PROVEDOR ATUAL
mostra os agentes no lugar do builder, e o log diz `agente 2 · P03` para o
executor e `verifier · P03` para o verificador, que não é de agente nenhum.
Pausar e ver fase (§95) valem igual: a pausa segura a próxima chamada de
QUALQUER agente.

**O wizard** ganhou o passo "Estratégia de execução?" no build, depois dos
papéis. Serial é o padrão e não acrescenta flag. A opção paralela diz a
largura do plano e, quando o paralelo não roda na pasta (git ausente ou sem
worktree), continua na lista com o motivo e não pode ser escolhida. Paralelo
pergunta o teto — digitado, não escolhido numa lista onde "3" seria a opção 2
—, se os agentes são todos o executor ou um a um (provider só entre as CLIs,
modelo e intensidade pelas mesmas listas do papel, Enter mantém o executor), e
se lembra para as próximas. Parte do que está salvo; escolher serial num
projeto salvo como paralelo grava o serial.

Provado com o CLI de verdade e um codex falso que escreve no `--cd` que recebe:
P2 e P3 ao mesmo tempo com modelos diferentes, verificador único, histórico
linear de quatro `feat(phase-N)`, nenhum branch ou worktree sobrando; o mesmo
com conflito real em um arquivo das duas, refeito sozinho; e o wizard por tecla
num PTY.

## §98 — O log de cada agente, aberto pela caixa AGENTES

Com vários agentes, a caixa AGENTES diz quem pegou qual fase, mas não o que
cada um está escrevendo. Agora, com o painel e uma pessoa no terminal:

- **↑ ↓ (e Tab) escolhem o agente** na caixa, com cursor; **Enter abre o log**
  dele em tela alternativa. Escolher só move um cursor: nada espera nada, e o
  escalonador não sabe que alguém está olhando.
- **O painel** (`tui/worker-log-panel.ts`, função pura) mostra quem é o agente
  e com que modelo, o estado e a fase, o tempo na fase e o da chamada
  corrente — medidos, nunca estimados —, o arquivo do log, a SAÍDA ao vivo
  (stdout normal, stderr em amarelo, as marcas do harness em ciano: `▶
  executor · P03 · tentativa 1`, `■ … terminou com código 0 em 11s`) e os
  EVENTOS DO ESCALONADOR do agente. **Tab** troca a área com foco; **↑ ↓ PgUp
  PgDn Home End** rolam a área com foco; rolar a saída para cima para de seguir
  o fim, e o título diz quantas linhas chegaram embaixo; **F** liga e desliga o
  seguir; **← →** trocam de agente; **Esc** fecha e o build segue. O agente
  que termina com o painel aberto aparece livre, com o desfecho, e o log
  continua lá; o build que termina com o painel aberto espera a pessoa fechar,
  como o `f` do §95.

**A origem decide o agente, nunca o texto.** A saída crua chega pelo
`onOutput` da ponte (`commands/agent.ts`), que agora repassa os bytes de
stdout e stderr com o fluxo de cada um; a chamada já diz de qual agente é
(`EngineCall.worker`). Cada agente tem buffer e eventos próprios, em
instâncias separadas (`tui/worker-logs.ts`), e stdout e stderr nunca se
emendam no meio de uma linha. Os eventos saem dos campos dos eventos
estruturados do loop (`WorkerProgress` e o progresso da fase em que o agente
está) — nada lê a prosa do modelo para inferir estado. A chamada do
verificador de uma fase vai ao log do agente daquela fase, marcada como
`verificador`.

**Memória limitada:** 2000 linhas por agente, cada uma cortada em 1000
caracteres (o corte diz que a linha inteira está no arquivo), e linha que
nunca termina é fechada ao passar do limite. O título conta as linhas que
saíram da memória. **Arquivo completo:** `runs/<run>/logs/agente-N.out.log` e
`agente-N.err.log`, cópia fiel e crua, com as marcas de início e fim de cada
chamada — o run passou a dizer seu id no `onPlanned` para isso.

**Saída de modelo é hostil por definição** (`tui/sanitize.ts`): antes da tela
saem todas as sequências de escape (CSI, OSC — inclusive o 52 da área de
transferência —, DCS, SOS, PM, APC e as de dois bytes), todo controle C0 menos
quebra e tabulação, todo C1 e os controles bidirecionais; `\r` deixa só a
última versão da linha. A linha só é limpa quando completa, para um escape
partido entre dois pedaços não escapar. O arquivo guarda o original: é
evidência, não tela.

**Responsivo:** o painel redesenha no máximo dez vezes por segundo, e só
quando o log ou os eventos do agente mudaram, o relógio virou de segundo ou a
janela mudou de tamanho; a saída que chega não redesenha o painel principal.
Terminal estreito encurta rótulos e dicas; baixo (menos de 14 linhas) esconde
os eventos e o Tab deixa de levar a eles. Sem TTY nada muda na saída: as
linhas sequenciais de sempre, e os arquivos de log são gravados igual.

Provado num PTY real com dois agentes e um codex falso que escreve em stdout e
stderr e tenta limpar a tela e trocar o título da janela: escolha pela seta,
Enter, PgUp parando a leitura, F voltando a seguir, Tab para os eventos, ←
para o outro agente, Esc de volta ao painel; nenhum byte da injeção chegou ao
terminal, e o build fechou as quatro fases enquanto isso.

## §99 — O que a auditoria do paralelo achou, e o que foi corrigido

A auditoria adversarial do §97 (`docs/AUDITORIA-PARALELO.md`) achou dois
BLOCKERs e três MAJORs na integração. Os cinco foram corrigidos sem mudar a
arquitetura: o escalonador, o worktree por fase e a fila de integração são os
mesmos. O serial não foi tocado — só `loop/paralelo.ts` e `loop/worktree.ts`
mudaram.

**B1 — a árvore integrada passa pelo mesmo preparo do worktree.** O runner
chama `prepararAmbiente` antes do gate 2; a integração não chamava, e a
árvore principal nunca ganhava o `.env` nem a migração. Agora chama, com o
mesmo executor do `npm install`, e grava a saída da migração em
`<fase>.migrate-integracao.log`. É a correção pela metade de sempre: o
preparo estava no irmão.

**B2 — aprovação de task acompanha o código.** Em todo desfecho em que o
trabalho da fase fica fora do produto — parou num gate, não fechou nem
sozinha na árvore integrada, não pôde ser integrada, erro inesperado — as
aprovações dela são revogadas (`esquecer`). Antes, a retomada abria um
worktree do HEAD, sem o parcial, e o verificador era instruído a carimbar
DONE no que não estava lá. O worktree que nem chegou a abrir não revoga: nada
foi aprovado nem saiu da árvore. O custo é reverificar, na retomada, tasks que
já tinham passado em runs anteriores.

**M1 — a árvore principal é conferida antes de integrar, e nada é apagado.**
`impedimentosDaPrincipal` recusa integrar quando há arquivo versionado
alterado (a suíte julgaria uma árvore que não é o HEAD) ou arquivo não
versionado no caminho da fase (o cherry-pick o sobrescreveria). Não
versionado fora do caminho — o `.env` semeado — não impede. O `integrar` só
chama de conflito o que deixou arquivo em conflito; o resto é `recusada`, que
não se resolve refazendo. Suíte vermelha com a árvore alterada no meio da
integração: o `reset --keep` recusa e o HEAD voltava com os commits
reprovados. A primeira correção voltava o HEAD com `--soft` e deixava os
arquivos como alteração não commitada — e a execução seguinte achava a árvore
suja, e o preflight mandava `git add -A && git commit`, que promovia o código
reprovado a commit. Agora `desfazerSemApagar` primeiro GUARDA, confere a
guarda, e só então limpa:
- os versionados alterados vão para um commit no branch
  `capivara/<run>/<fase>-reprovada-<sha>`, montado com um índice temporário e
  `add -u` — nunca `add -A`, que levaria para o repositório qualquer não
  versionado, inclusive um `.env` que ninguém ignorou;
- os não versionados que a integração criou, e os versionados com nome de
  segredo (`arquivoSensivel`: `.env` e `.env.*` menos os exemplos, `*.pem`,
  `*.key`, chaves de SSH), são copiados para
  `.capivara/runs/<run>/recuperacao/<fase>-<instante>/`, que o Git ignora;
- os não versionados que já estavam não são copiados, commitados nem
  removidos;
- a guarda é comprovada (mesmo sha256 em cada cópia, mesmo blob no branch
  para cada versionado) antes do `reset --hard` e da remoção dos não
  versionados criados pela integração. Sem prova, nada é limpo e o erro diz
  onde a árvore ficou.

O preflight não foi tocado: a árvore que ele encontra é a de antes da
integração, sem nada dela para mandar commitar. Os três casos param o build
como falha fatal, dizendo os arquivos, o branch guardado e o branch da fase.

**M2 — depois da fatal, nada entra.** A fila de integração pergunta pela
falha fatal DENTRO da vez de cada fase: a que ainda rodava termina, fica
verde no branch dela, e não é integrada.

**M3 — erro inesperado não deixa órfão.** A exceção de uma fase não sai mais
do laço na hora — saía, o lock era liberado e os outros agentes seguiam
integrando depois de o build ter devolvido o erro. Agora o parcial vai para o
branch, nada mais sai nem entra, os agentes em andamento terminam, e só então
o erro sobe, como no serial.

Cada achado tem teste em `test/loop/paralelo.spec.ts` (bloco "auditoria
(§99)"), com Git de verdade, e os sete falhavam antes da correção.

Fica para depois, registrado na auditoria: M4 (stacks sem npm não têm
dependências na árvore principal), m1 a m3. E o irmão serial do B2: a
instrução "descarta e a fase recomeça do zero" do runner também deixa as
aprovações de um código descartado — não corrigido aqui por estar fora do
escopo pedido.

## §100 — Nenhum commit automático leva segredo para o histórico

O `git add -A` estava em todo commit que a Capivara faz sozinha: o da fase
(serial e worktree), o do parcial, o inicial do repositório que o build cria.
Um `.env` que ninguém pôs no `.gitignore` entrava como qualquer arquivo — e no
histórico um segredo está em todo clone e em todo push. O `.gitignore` não é
proteção: é convenção de quem escreve o projeto.

**A política de admissão** (`loop/admissao.ts`) é determinística e fechada:
- *pelo nome*: `.env` e `.env.<qualquer>` (menos `.example`, `.sample`,
  `.template`, `.dist`, `.defaults`, que o §46 manda versionar), `*.key`,
  chaves de SSH (`id_rsa`, `id_ed25519`…), repositórios de chaves (`.p12`,
  `.pfx`, `.jks`, `.keystore`), `.netrc`, `.pgpass`, `.git-credentials`;
- *pelo conteúdo*: qualquer arquivo com bloco PEM de chave PRIVADA, seja qual
  for o nome; e o `.pem` sem certificado nem chave pública reconhecível, ou
  grande demais para ler, é suspeito. Certificado público passa.

Ela não promete achar uma senha literal num `config.ts`: segredo arbitrário em
arquivo de nome comum não tem detecção garantida.

**Onde ela vale**, e o que cada consumidor faz com o bloqueio — sempre sem
apagar nada, sem `reset --hard`, sem `git clean`, e dizendo só caminho e
motivo, nunca o conteúdo:

| ponto | tipo | bloqueado |
|---|---|---|
| `commitPhase` (serial e worktree) | publicação | não commita; a fase sai `commit-blocked` |
| `iniciarRepositorio` (commit inicial) | publicação | o repositório nasce sem o commit; o preflight orienta |
| `commitSpecification` | publicação | não commita |
| `integrar` (cherry-pick) | publicação | `admitirIntervalo` lê os objetos dos commits da fase ANTES do cherry-pick; nada entra; o branch fica, com aviso para não publicá-lo |
| `guardarParcial` | recuperação | commita o resto; o sensível é copiado, com sha256 conferido, para `.capivara/runs/<run>/recuperacao/`; sem prova, o worktree fica no disco |
| `desfazerSemApagar` | recuperação | idem (§99) |

Os dois de publicação fazem a conferência ANTES de tocar no índice, e de novo
DEPOIS do `add` sobre o que o índice tem de fato; se algo escapou, só o
índice volta ao HEAD. O `add` é de exatamente os caminhos admitidos, por
`--pathspec-from-file`.

**`commit-blocked` é um desfecho de fase**, e não "completa sem commit". No
serial, completa sem commit deixaria a fase seguinte construir sobre trabalho
fora do histórico; no paralelo, seria integrar nada e apagar o worktree com o
trabalho dentro. O build para — mesmo com `--keep-going`, porque o commit da
fase seguinte levaria o mesmo arquivo —, a fase não é registrada como
concluída, e a retomada a revalida. A parada (`loop/parada.ts`) orienta:
ignorar o arquivo (ou `git rm --cached` se já for rastreado — o arquivo fica
em disco e o histórico antigo não é reescrito), só então commitar o parcial. O
preflight, diante de árvore suja com arquivo sensível, diz qual é ANTES de
sugerir `git add -A`.

**O `.env` que o próprio harness semeia** do `.env.example` (§46, marcado na
primeira linha) não entra em commit nenhum, mas também não bloqueia e não
conta como árvore suja: bloquear o próprio artefato faria todo projeto sem
`.env` no `.gitignore` parar em toda fase. Sem a marca, o arquivo é de quem o
escreveu e volta a ser sensível.

Os gates G0–G4 e a gramática do plano não mudaram. Testes em
`test/loop/admissao.spec.ts`, com Git de verdade: treze falhavam antes da
política, e o de arquivos legítimos passava antes e depois.

## §101 — Só o Core registra no Git, e publica a árvore que conferiu

O §100 conferia os arquivos e depois rodava `git add` e `git commit`. Duas
fronteiras ficavam abertas.

**A janela entre conferir e commitar.** O que vai para o commit é o que está
no disco no instante do `add`, e o `git commit` roda os hooks do projeto: um
`pre-commit` que faça `git add` põe no commit o que nenhuma conferência viu. A
segunda conferência do §100 relia o DISCO, não o que foi preparado. Agora todo
commit automático passa por `commitAdmitido` (`loop/admissao.ts`): índice
temporário a partir do HEAD (o índice de quem chamou não é usado) →
`write-tree`, que congela a árvore → admissão sobre os OBJETOS dessa árvore →
`commit-tree` com ela, sem hooks → `update-ref` com o valor antigo esperado
(HEAD que mudou no meio não é sobrescrito) → só os caminhos commitados são
sincronizados no índice de quem chamou. Vale para o commit da fase, o inicial,
o da especificação e o do parcial; o de recuperação (§99) confere os objetos
da árvore dele antes do branch. Consequência dita: os commits automáticos não
rodam mais os hooks `pre-commit`/`commit-msg` do projeto, e o
`.git/COMMIT_EDITMSG` não é mais gravado por eles.

**O agente que roda git.** O executor tem um shell; instrução no prompt não o
impede de commitar ou de fazer push. O que impede depende do provider, e foi
MEDIDO, não suposto (codex-cli 0.162.1, `codex sandbox -P :workspace`): no
`workspace-write` do codex, o `.git` é somente leitura — inclusive o do
worktree, que mora no repositório principal —, a rede é cortada e a escrita
fora do projeto é recusada (exceto `/tmp`). Com acesso de SISTEMA — o padrão
do build —, nada impede, em provider nenhum. claude, opencode, agy, cursor e
custom em workspace não têm sandbox de sistema verificado sobre o `.git`.

O que o Core impõe em todo caso é DETECÇÃO e CONTENÇÃO, determinísticas
(`loop/autoridade.ts`): as referências são fotografadas antes e depois de
TODA chamada de agente; referência movida — commit, reset, stash, tag, ou o
rastreio remoto que um `push -u` atualiza — faz a fase sair `commit-blocked`
sem nada registrado nem integrado, e a parada diz quais refs mudaram e se
houve publicação provável. No worktree, o integrador e os outros agentes movem
a principal e os branches no meio da chamada: ali se confere o HEAD do
worktree (que cobre o branch da fase), as tags e o rastreio remoto. E o
integrador guarda o HEAD que ele mesmo deixou: principal noutro commit na
próxima integração, ou no fim do build, é commit de fora — nada mais entra. O
branch de fase com commits além da base nunca é apagado numa falha. Nada é
desfeito: mover a ref de volta seria reescrever o que a pessoa pode já ter
visto, ou publicado. Antes da primeira chamada, o build diz, por executor, o
que está impedido e o que é só detectado.

O que fica sem garantia, dito: o `push` sem rastreio (`git push <url>`) não
é detectável daqui; um commit de fora não é desfeito; com acesso de sistema, o
executor pode até alterar o próprio repositório da Capivara.

**A menor mudança de arquitetura para impedir de fato**, não feita aqui:
(1) um modo protegido que só aceite executor em workspace num provider cujo
sandbox comprovadamente torne o `.git` somente leitura — hoje, só o codex — e
recuse o build nos outros; (2) para os outros providers, separar o diretório
Git da árvore do executor: o worktree sem o arquivo `.git`, e o Core operando
com `--git-dir`/`--work-tree` explícitos — com o sandbox do provider recusando
a escrita fora da árvore, o executor não alcança o repositório. Sem sandbox
de sistema operacional, nenhuma das duas é garantia: o processo com acesso ao
sistema inteiro alcança tudo.

Testes: `test/loop/autoridade.spec.ts` (hooks que preparam segredo depois da
conferência; commit, stash e push do executor no serial; commit no worktree e
na principal a partir do worktree no paralelo; e o sandbox real do codex,
pulado onde o codex não está instalado) e `test/loop/commit-admitido.spec.ts`
(disco que muda depois do `add`, HEAD que muda no meio, índice de quem chamou,
segunda barreira da integração).

## §102 — A integração não reescreve o lockfile, e o que o harness suja ele diz

No primeiro piloto paralelo (`teste_paralelismo`), a P01 foi integrada no
`17b2225` e a P02, verde no worktree, foi barrada: "a árvore principal tem
alterações que não são do integrador (package-lock.json)". O diff era uma
linha — `"hasInstallScript": true` no `better-sqlite3` — e quem a escreveu foi
o próprio harness: depois do cherry-pick da P01, a integração rodou
`npm install` na árvore principal (a fase mexeu nas dependências), e o
`npm install` reescreve o lockfile quando o que lê do `node_modules` diverge do
que o executor gravou. O lockfile tem mtime 23:42:10.688Z, entre o verde no
worktree (23:42:05.970Z) e o evento "integrada" (23:42:10.845Z). Reproduzido
fora do projeto, com o `package.json` e o lockfile do `17b2225`: `npm install`
acrescenta exatamente a linha; `npm ci` deixa o arquivo idêntico.

Duas mudanças:

1. **Com lockfile, `npm ci`** (`comandoDeInstalacao`, em `worktree.ts`):
   instala o que o lockfile diz e nunca escreve nele; se o lockfile não fechar
   com o `package.json`, falha — e isso é defeito da fase, que reprova a
   integração pelo caminho que já existia. Sem lockfile,
   `npm install --no-package-lock`, para não criar o arquivo que a fase não
   trouxe.
2. **O que sobrar é dito na hora, com o nome certo.** A árvore estava igual ao
   HEAD antes do cherry-pick (§99) e a fila integra uma fase por vez; um
   versionado alterado depois da suíte verde foi escrito pelos passos do
   harness — instalação, migração, suíte. A fase fica integrada (os commits
   são verdes), nada é descartado nem desfeito, nenhuma fase nova sai, e a
   parada diz que a alteração é do harness e não do desenvolvedor, com o
   comando para descartar ou commitar. Antes, era a fase seguinte que
   descobria, depois de trabalhar, e a culpa ia para a pessoa.

Nada dos §§99–101 mudou: a conferência de antes do cherry-pick, a admissão do
intervalo, o desfazer com guarda comprovada e a guarda do HEAD continuam como
estavam. O `.capivara/.gitignore` não versionado do piloto é o do plano de
controle (`ensureArtifactTree`), escrito no `init`; o status da principal já o
exclui, e ele não teve papel na parada.

Testes: `test/loop/paralelo.spec.ts`, os dois "§102" — um npm falso que faz o
que o npm 11 fez (`install` reescreve o lockfile, `ci` não): com o código
anterior, o primeiro para em exit 2 e o segundo reproduz a mensagem do piloto.

## §103 — A fase que cobre de novo um fluxo cumprido não reordena a passagem

Na P06 do piloto paralelo (`teste_paralelismo`, run `build-159b7675b57b`), a
fase de verificação final cobria os cinco fluxos, todos já cumpridos pelas
fases anteriores, na ordem 5, 1, 4, 2, 3 — a ordem em que passaram juntos na
P04. A regressão excluía os fluxos da própria fase; com os cinco nela, ficou
vazia, e a passagem caiu na ordem do plano: 1, 2, 3, 4, 5.

A passagem roda os roteiros em sequência sobre um banco só (§ passagem
isolada, v2), e cada roteiro foi escrito contando com o que os anteriores
deixaram. Na ordem nova, os quatro reprovaram, um atrás do outro, porque o
Playwright para no primeiro: o 2 e o 3 esperavam registros que o 5 cria, o 4
uma anotação do 5, e o 5, que exige banco vazio, rodou por último. A triagem
acertou as quatro vezes (ROTEIRO), mas o gate reescreve um roteiro por
chamada: o segundo ROTEIRO de cada passagem foi ao executor, que gastou dois
ciclos só para responder `CAPIVARA_ROTEIRO_ERRADO`, sem tocar em arquivo, e a
fase parou com as nove tasks aprovadas pelo verificador.

A correção é na origem: a regressão é TODO fluxo cumprido, na ordem em que foi
cumprido, inclusive os que a fase cobre de novo. O gate 4 já tirava a
repetição mantendo a primeira posição; os fluxos novos da fase continuam indo
para o fim. Nenhum gate, critério ou limite mudou: o que a fase cobre continua
sendo conferido como da fase (`checkFlowScript`, redação do que falta), e a
triagem e as reescritas seguem as mesmas regras.

Fica registrado, sem mudar aqui:

- **O limite de uma reescrita por chamada do gate** amplificou o desperdício:
  quando o ROTEIRO seguinte é de OUTRO fluxo, ninguém o reescreveu, e a causa
  que vai ao executor diz "que o harness já reescreveu uma vez nesta passagem"
  — falso para aquele roteiro. A menor mudança seria uma reescrita por ROTEIRO
  por chamada, limitada ao número de fluxos.
- **A causa ao roteirista** leva a correção, a evidência e o retrato da página,
  mas não o `onde` (arquivo e linha) nem o `critério` que a triagem citou.
- **A retomada** reconstruía os cumpridos na ordem do plano, não na ordem em
  que foram integrados: no paralelo, as duas divergem (aqui, 5,1,2,3,4 contra
  5,1,4,2,3). Corrigido no §104.
- **O isolamento do banco é por passagem, não por fluxo.** O workflow 5 só
  está certo se rodar primeiro; a correção que a triagem propôs para ele ("um
  SQLite exclusivo para o fluxo 5") não é executável por um roteiro: a
  aplicação é uma só, de pé, com o ambiente da passagem.

Teste: `test/integration/catalog.spec.ts`, "a fase que cobre de novo fluxos já
cumpridos os percorre na ordem em que foram cumpridos" — com o código anterior,
a terceira passagem sai na ordem do plano.

## §104 — Retomado, o build devolve os fluxos cumpridos na ordem em que as fases fecharam

O §103 deixou a ordem da passagem estável ao vivo, mas não na retomada. Ali,
as fases puladas — fechadas antes, neste run ou noutro — entravam nos
cumpridos na ordem do PLANO. No serial dá no mesmo; no paralelo, não: no
piloto, P01, P02, P05, P03, P04 fecharam nessa ordem (fluxos 5,1,4,2,3), e a
retomada da P06 os reconstruiria como 5,1,2,3,4 — de novo uma ordem que os
roteiros nunca percorreram juntos.

O ledger (`.capivara/handoffs/fases.json`) já guarda `closedAt` de cada fase.
Os três caminhos que acrescentam cumpridos — a fase verde, a fechada em run
anterior e a fechada neste run — passam por um só (`cumprir`), que ordena
pela data de fechamento; o verde usa a mesma data que acabou de gravar no
ledger. Sem data, o fluxo fica junto do anterior. Nenhum gate, critério ou
limite mudou.

Teste: `test/integration/catalog.spec.ts`, "retomado, os fluxos cumpridos
voltam na ordem em que as fases fecharam, não na do plano" — um ledger em que
a P02 fechou antes da P01; com o código anterior, a passagem da P03 sai na
ordem do plano.

## §105 — Toda CLI trabalha na raiz que a ponte recebeu

No primeiro build paralelo com o Claude Haiku (run `build-f1cd4ae9e525`), a
P01 parou no gate 3 depois de três ciclos. O executor declarou a fundação
completa, com 25 testes verdes, e o verificador achou tudo ausente. Os dois
disseram a verdade sobre lugares diferentes. O worktree chegava certo até a
ponte e se perdia ali. O adaptador do claude não passa diretório nenhum, e o
`spawn` não recebia `cwd`, então o processo nascia na árvore principal, onde a
capivara foi rodada. Só o codex trabalhava no worktree, porque recebe `--cd`.
O diagnóstico, com as evidências, está em
`docs/DIAGNOSTICO-CWD-CLAUDE-PARALELO.md`.

A invocação agora leva `cwd` (a raiz do projeto, que no paralelo é o
worktree), e o supervisor o usa no `spawn`. O campo é obrigatório: uma
invocação sem diretório não compila. Isso vale para todas as CLIs, inclusive
as que não têm flag de diretório (claude, cursor e custom). Também corrige o
serial com `--project` diferente do cwd e o survey, que passa a pasta de
saída como raiz.

Nenhum gate, critério ou limite mudou.

Fica aberto que nenhuma guarda percebe a árvore principal mudando durante uma
fase em worktree, porque a conferência do §99 só roda na integração. A
proposta é fotografar a principal antes e depois de cada chamada de agente e
parar sem descartar nada. Não foi implementada.

Testes:
- `test/provider/adapters.spec.ts`: "toda CLI roda no diretório do projeto,
  não no de quem chamou";
- `test/provider/supervisor.spec.ts`: "roda o processo no diretório da
  invocação";
- `test/integration/cwd-do-executor.spec.ts`: um claude falso devolve o
  próprio cwd pela ponte. Com o código anterior, devolve `packages/core` em
  vez do worktree, a mesma falha do piloto.

## §106 — O nível workspace do executor tem contrato, e o claude o cumpre com o sandbox nativo

No `teste_haiku_v2` (run `build-96756ca336b0`), o executor Claude em
workspace recebia só `acceptEdits`. Em `-p`, todo Bash que não fosse de
leitura era negado, a especificação não chegava ao worktree, e três ciclos
foram cobrados como código incompleto
(`docs/DIAGNOSTICO-PERMISSOES-CLAUDE-WORKSPACE.md`).

Decisão: o nível workspace roda comandos, alcança a internet, instala
dependências e não escreve fora do projeto, sem acesso irrestrito e sem mexer
no Git do Core. Cada adapter declara `workspace(platform)`:

- `garantido`;
- `insuficiente`: o preflight serial e o paralelo recusam, com diagnóstico;
- `nao-verificado`: o build segue e declara a limitação.

Nem a rede é tirada, nem o acesso é promovido, em silêncio.

O que mudou:

- **Claude, workspace:** recebe `--settings` com o sandbox nativo:
  - `failIfUnavailable`, `allowUnsandboxedCommands: false` e
    `allowedDomains: ["*"]`;
  - os caches do npm e do Playwright graváveis;
  - `denyWrite` do `.git` comum, de `.capivara/init` e de `.capivara/runs`;
  - no Linux, `allowAllUnixSockets` com `/run` e `/tmp` ilegíveis, porque o
    seccomp não sobe neste kernel e, sem máscara, `systemd-run --user`
    escapava;
  - credenciais conhecidas ilegíveis e chaves removidas do ambiente;
  - um `TMPDIR` por chamada, fora de `/tmp`.
- **`abrirWorktree`:** copia `.capivara/init` não versionada, com os
  arquivos em 0444.
- **Envelope `claude-json`:** expõe `permission_denials` como "ferramenta:
  programa", sem argumentos. O executor com negações e sem COMPLETE para no
  ciclo, como falha do gate 0, com causa de ambiente; o parcial segue o
  caminho de sempre.
- **Codex e opencode no workspace:** são recusados. O codex não entrega rede
  e confinamento juntos (fuga comprovada com rede); o opencode não tem
  sandbox.

Os gates G0–G4 não mudaram. As garantias comprovadas, a matriz de sondas com
os providers reais e as limitações estão em `docs/GARANTIAS-WORKSPACE-106.md`.
A principal limitação: o sandbox contém a sessão do executor, mas G2 e G4
executam o código que ele escreveu fora de qualquer sandbox.

## §107 — O gate 4 diz como sobe a aplicação, e a porta ocupada é atribuída a quem a abriu

No build paralelo `build-96756ca336b0`, P03, P04 e P05 bloquearam no gate 4.
O gate sobe a aplicação com `npm start` e passa a porta em `PORT`, mas a
aplicação lia `PORTA` e escutava na 3001. O contrato só aparecia na causa de
"NÃO SUBIU", que saiu no terceiro e último ciclo e por isso nunca chegou a um
executor. A causa do ciclo 2 pedia um `start` e não falava em porta.

No ciclo 3, a P05 recebeu `EADDRINUSE 127.0.0.1:3001`, porque o gate 4 da P04
já tinha um servidor na 3001. O gate, que procurava "porta ocupada" em qualquer
parte da saída, respondeu "a porta 47535 foi ocupada… do ambiente". Atribuiu
a porta errada a um dono errado. O diagnóstico está em
`docs/DIAGNOSTICO-G4-PORTAS-PARALELO.md`.

Três mudanças, sem tocar no scheduler, nos worktrees, nas permissões do §106 ou
nos critérios dos gates:

1. **O contrato vai no prompt.** Toda fase que passa pelo gate 4 (fluxos
   próprios ou de regressão) recebe o contrato no prompt do executor, desde o
   primeiro ciclo e também nos de correção. O gate roda o `start` do manifesto
   (`npm start` em Node), com `PORT` e `HOST` no ambiente. O projeto pode
   manter os próprios nomes, desde que o entrypoint honre esses dois. A fase
   sem gate 4 não recebe nada. A causa da falta de entrypoint também passa a
   citar `PORT` e `HOST`.
2. **A porta ocupada é atribuída pelo número na saída.** `portasEmUso` lê o fim
   da linha que acusa o uso (`listen EADDRINUSE … :3001` no Node e
   `http://…:47535 is already used` no Playwright).
   - **A porta é a do gate:** a falha é do ambiente.
   - **É outra porta:** a falha é configuração do entrypoint. A causa diz qual
     porta a aplicação tentou abrir e qual `PORT`/`HOST` o gate forneceu.
   - **Sem número legível:** a causa diz que a saída não informa a porta e não
     atribui a falha a ninguém.
3. **A porta do gate tomada troca uma vez, dentro da mesma chamada.** O gate
   escolhe outra porta livre, reescreve a configuração e roda a passagem de
   novo uma única vez, sem gastar ciclo do executor. O roteiro não é reescrito,
   porque usa caminho relativo, e nenhum processo de terceiro é tocado. Se a
   porta for tomada de novo, a causa é de ambiente e cita a porta efetiva.
   Colisão na porta da aplicação nunca troca a porta do gate.

Nenhum formato persistido mudou. A retomada e as fases já integradas seguem
como antes, e um run retomado recebe o contrato no próximo prompt de ciclo.

Fica documentado, fora do escopo:
- **Portas fixas na suíte do projeto.** A suíte do `teste_haiku_v2`
  (`servidor.test.ts`) abre a 3001 e a 5173 fixas. Isso é risco de colisão no
  gate 2 entre fases paralelas, e entre o gate 2 de uma fase e o gate 4 de
  outra. É do projeto, e nada mudou no harness por isso.
- **Só o `start` serve de entrypoint.** `startCommandFor` só reconhece
  `scripts.start`, então um projeto com `iniciar` continua precisando declarar
  `start`. Agora isso é dito antes do ciclo 1, mas a descoberta não mudou.
- **Duas trocas simultâneas.** Dois gates que troquem de porta ao mesmo tempo
  pedem portas efêmeras ao sistema e podem, em tese, receber a mesma. A
  segunda colisão é relatada como ambiente.

Nada disto foi comprovado num build real com o Haiku. A prova é dos testes,
com runners e portas simulados.

Testes:
- `test/loop/runner.spec.ts`:
  - "a fase com fluxo recebe npm start, PORT e HOST na primeira sessão";
  - "a fase sem fluxo não recebe o contrato".
- `test/loop/flows.spec.ts`:
  - "EADDRINUSE na porta da aplicação é configuração do entrypoint, e não
    troca a porta do gate", com o caso do run: 3001 contra 47535;
  - "porta do gate tomada uma vez: outra porta, a mesma chamada, verde —
    nenhum ciclo do executor";
  - "porta do gate tomada duas vezes é dita como ambiente", que adapta o teste
    anterior: o runner falso agora acusa a porta que o gate de fato escreveu;
  - "porta ocupada sem número legível não é atribuída a ninguém";
  - "dois gates simultâneos se recuperam cada um na sua árvore";
  - a extração de `portasEmUso`.
- Contra o código anterior, 7 desses testes falham. O de fase sem fluxo passa
  nos dois, como deve.

## §108 — O executor claude roda com `--dangerously-skip-permissions`

O §106 pôs o executor claude em `acceptEdits` dentro do sandbox nativo do
Claude Code. No `teste_haiku_v2` isso ainda mandava para aprovação comandos
normais de desenvolvimento, como `| tail`, `| head`, `timeout`, variável na
frente do comando e laços. Em `-p`, aprovação pendente é negação. O operador
decidiu que o executor precisa rodar Bash, npm, pipes, laços, compilação e
testes livremente, sem aprovação interativa.

**O que mudou:**
- **Executor claude no nível workspace:** recebe
  `--dangerously-skip-permissions`, sem `--permission-mode acceptEdits` e sem
  o `--settings` do sandbox. A montagem do sandbox (`sandboxDoWorkspace`, as
  listas de sockets, credenciais e variáveis) saiu do adaptador. O
  temporário próprio da chamada (`TMPDIR`) continua, porque o prompt manda o
  rascunho para lá.
- **Os outros papéis não mudam.** Os somente-leitura (writer, auditor e
  verifier) seguem em `--permission-mode default`, e o acesso de sistema
  segue em `bypassPermissions`. As outras CLIs não mudam, e nada mexe em
  configuração global do Claude Code.
- **`permission_denials` deixou de parar a fase.** A negação é anunciada
  ("comando(s) negado(s) por permissão: … — registrado, a fase segue para os
  gates") e fica no log do ciclo, que guarda o envelope inteiro. A fase segue
  para os gates como qualquer outra sessão. A parada `PermissaoNegada` do
  §106 saiu.
- **O contrato do claude não promete confinamento.** Ele vale
  `nao-verificado` em toda plataforma, sem dependência de `bwrap`/`socat`, e
  o preflight passa a mostrar a limitação no resumo do build.

**O preço, dito sem rodeio:** o executor claude tem acesso amplo ao sistema,
à rede e aos arquivos do usuário. Pode ler credenciais do home, alcançar
sockets locais, escrever fora do projeto e rodar o que quiser. É o mesmo
alcance do acesso de sistema, só que sem precisar do `systemInstall`. O que
continua com o harness é o que ele já fazia fora da sessão:
- os gates G0–G4;
- a verificação independente;
- a autoridade Git do Core, com a conferência de referências depois de cada
  chamada (§101);
- a fila de integração.

O scheduler paralelo não mudou.

Testes atualizados:
- `test/provider/adapters.spec.ts`: o executor recebe a flag, sem
  `--permission-mode` e sem `--settings`; os papéis somente-leitura não a
  recebem; o temporário próprio continua; o contrato diz "acesso amplo".
- `test/loop/runner.spec.ts`: a negação não para a fase, o verificador julga
  e nenhum evento `blocked` aparece.
- `test/loop/paralelo.spec.ts`: a negação é anunciada e a fase segue para os
  gates no worktree dela.
- `test/commands/execucao.spec.ts`: o claude começa sem `bwrap`, e o resumo
  diz que o executor tem acesso amplo.
- `test/integration/workspace-claude.spec.ts`: pela ponte, a CLI falsa
  recebe a flag e nenhum `--settings`.

## §109 — O roteiro do gate 4 pode reiniciar a aplicação, e nenhum passo passa sem ser executado

No `build-96756ca336b0` retomado, a P05 bloqueou no gate 4 num passo que
ninguém podia cumprir: "reiniciar o servidor com o mesmo arquivo SQLite e
conferir os valores persistidos". O roteiro era proibido de subir ou parar
servidores, o ajudante não reiniciava nada, e a conferência exigia o passo.

Os dois roteiristas resolveram esse impasse em sentidos opostos. O da P03 trocou
o passo por uma anotação de pendência e passou sem executá-lo. O da P05
escreveu `expect.soft(false)` e reprovou de propósito. O diagnóstico está em
`docs/DIAGNOSTICO-G4-REINICIO-P05.md`.

Decisão do proprietário: os roteiros têm liberdade operacional para executar o
que os critérios exigem. O gate não proíbe uma operação legítima para depois
reprovar o projeto por ela não ter sido feita.

**O que mudou:**
1. **`aplicacaoPropria()` no ajudante (`passagem.ts`).** A instância do gate
   pertence ao Playwright e não pode ser reiniciada pelo roteiro. O ajudante
   passa a subir outra instância do produto:
   - usa o mesmo comando de início do gate (`CAPIVARA_INICIO`, que o gate 4
     passa ao runner), o ambiente da passagem e o mesmo arquivo de banco;
   - recebe uma porta livre só dela, com `PORT` e `HOST`, e o ajudante espera
     ela responder;
   - `reiniciar()` encerra o processo de verdade (SIGTERM ao grupo, SIGKILL
     depois de 5s), espera ele sair e sobe de novo na mesma porta e no mesmo
     banco; `encerrar()` só para a instância.
2. **Nenhum órfão.** Cada instância nasce líder de um grupo de processos e é
   anotada na lista da passagem (`CAPIVARA_PROCESSOS`). O processo do roteiro
   mata as suas instâncias ao sair, e a limpeza da passagem
   (`encerrarOrfaos`) mata o grupo de cada processo anotado que ainda esteja
   vivo. Só os anotados: nenhum processo alheio é tocado.
3. **As proibições que conflitavam saíram.** O prompt do roteirista não proíbe
   mais `child_process`, nem iniciar ou parar servidores, e ensina o reinício
   com um exemplo. A conferência estrutural parou de recusar `child_process` e
   o `build` pelo ajudante. Continua recusando subir o servidor com
   `comandoDoProjeto`, que esperaria até o prazo um comando que não termina,
   e aponta `aplicacaoPropria`.
4. **Nenhum passo aprovado sem ser executado.** A conferência recusa asserção
   sobre uma constante (`expect(false)`, `expect(true)`, também `.soft`),
   `CAPIVARA_REMARK` e a anotação `pendente`. O prompt diz isso.
5. **Os roteiros da v2 são reescritos uma vez.** O `FLOW_MARK` foi para a v3.
   Os roteiros da v2, escritos sob a proibição (entre eles o fluxo 1 do
   `teste_haiku_v2`, que passou com o reinício pendente), passam pelo
   mecanismo de sempre: são reescritos uma vez, custando uma sessão de
   roteirista.
6. **A falta de `start` é dita antes do ciclo 1.** Quando a fase tem fluxos e
   `startCommandFor` devolve `null`, o prompt do executor diz que o projeto
   não tem `start` e que ele deve criá-lo honrando `PORT` e `HOST`. Na
   retomada, as três fases receberam só o contrato genérico do §107, e as três
   deixaram o gate 4 descobrir a falta.

Gates G0–G4, scheduler paralelo e permissões não mudaram. Nenhum bloqueio,
sandbox ou autorização foi acrescentado.

**Testes**, com o que foi executado e o que foi substituído:
- `test/integration/reinicio-g4.spec.ts` roda o `gate4` inteiro sobre um
  produto real: servidor HTTP com SQLite em arquivo (`node:sqlite`), subido
  por `npm start`.
  - **Real:** a passagem isolada, o ajudante gerado, os processos, as portas,
    o arquivo SQLite, o reinício e a limpeza. O roteiro executado é o arquivo
    que o gate gravou, no formato do roteirista.
  - **Substituído:** só o Playwright, que não é dependência deste pacote. O
    `@playwright/test` do projeto temporário é um substituto mínimo (`test`,
    `test.step`, `expect`, `page.request` sobre `fetch`).
  - **Os casos:**
    - cria, confere, reinicia, comprova que o processo antigo morreu, que o
      novo usa o mesmo banco, e que o registro persistiu;
    - um roteiro que não reinicia reprova;
    - dois gates em paralelo, com servidores, portas e bancos independentes;
    - `encerrarOrfaos` mata o grupo inteiro, inclusive o neto.
- `test/loop/flows.spec.ts`: a conferência aceita `child_process`, recusa
  constante, `CAPIVARA_REMARK` e pendência, e recusa subir com
  `comandoDoProjeto`; o prompt ensina o reinício e não traz a proibição; o
  runner recebe `CAPIVARA_INICIO`.
- `test/loop/runner.spec.ts`: sem `start`, a primeira sessão ouve que precisa
  criá-lo.
- Contra o código anterior, 12 desses testes falham.

**Limitação:** o Playwright real não foi executado contra o ajudante neste
pacote. A instância própria e a do gate abrem o mesmo arquivo SQLite ao mesmo
tempo, o que o SQLite permite. Um produto que tranque o arquivo com exclusividade
não sobe a segunda instância, e o ajudante relata a saída dela.

## §110 — A fundação do gate 4 é preparada uma vez, e o verde que conflita fica num branch

No `build-96756ca336b0`, a P03 e a P04 rodavam em paralelo. Cada uma, no seu
worktree, criou o mesmo `start` e o mesmo suporte a `PORT`/`HOST` em
`src/servidor/configuracao.ts`, a fundação compartilhada. A P04 fechou verde e
conflitou na integração. O desfecho "refazer" apagou o branch da fase, e o
commit aprovado (`8c9365e`) ficou sem referência. O diagnóstico está em
`docs/DIAGNOSTICO-P04-CONFLITO-INTEGRACAO.md`.

**1. Fundação antes do paralelo.** Quando o build tem fluxos e a árvore
principal não declara `start` (`startCommandFor` devolve `null`), a primeira
fase pendente com fluxo vira exclusiva antes da primeira leva. É o mesmo
mecanismo de quem volta de um conflito. Ela roda sozinha e recebe o aviso do
§109. Cria o `start` e passa pelos gates e pela integração de sempre. As
seguintes abrem o worktree do HEAD que já o tem.
- As fases anteriores a ela, que não têm fluxo, podem rodar junto, como em
  qualquer fase exclusiva.
- As outras fases com fluxo voltam ao paralelo assim que ela integra.
- Com o `start` presente, nada disso acontece.
- O Core não escreve código de produto: quem cria o `start` é o executor da
  fase.

**2. O verde que conflita não se perde.** No desfecho "refazer",
`preservarAprovado` cria o branch `capivara/<run>/<fase>-aprovada-<sha7>`
apontando para o mesmo commit aprovado.
- Nada é copiado, reescrito ou integrado; o sha no nome evita colidir com o
  branch da fase, que a nova rodada recria.
- O evento `retry` e o anúncio dizem o commit e o branch.
- A nova rodada anuncia onde o verde anterior continua.
- A fase segue refazendo sozinha sobre a árvore integrada, como antes; não há
  merge automático.

O §108, as permissões e os critérios G0–G4 não mudaram, e não entrou nenhuma
restrição nova aos agentes.

**Limitação:** se a fase preparadora falhar com `--keep-going`, as outras
fases com fluxo seguem em paralelo sem `start`. Cada uma recebe o aviso, e o
risco de conflito volta. A preparação não é tentada com outra fase.

Testes (`test/loop/paralelo.spec.ts`, Git real, provider e Playwright falsos):
- "sem start: só uma fase prepara a fundação, sozinha, e as outras com fluxo
  saem depois, em paralelo";
- "com start: nada é preparado, e as três fases com fluxo correm juntas";
- "conflito na integração: o commit aprovado fica num branch próprio, dito no
  evento, intacto". O teste confere:
  - o commit e o conteúdo;
  - a árvore principal limpa;
  - que o branch é achado pelo log de eventos.

Contra o código anterior, o primeiro e o terceiro falham. O segundo passa nos
dois, como deve.

## §111 — O G4 diz em que porta a aplicação escutou, e a retomada não apaga o parcial

No `build-6e34384deccd` (`teste_luna`, codex/gpt-6-luna), a P04 bloqueou no G4.
A fundação lia `PORTA`, e não `PORT`: a aplicação escutou na 3000, e o gate
esperou a 47533 até estourar os 180 s. A saída inteira foi `Timed out waiting
180000ms from config.webServer`, porque o stdout da aplicação era descartado. Na
retomada, o `wip(P04)`, que já tinha passado no G3, foi apagado, e a fase
recomeçou do zero. O diagnóstico está em `docs/DIAGNOSTICO-TESTE-LUNA.md`.

**1. A saída da aplicação no G4.** A configuração gerada passa a ter
`stdout: 'pipe'`. Quando a aplicação não sobe, `portasAnunciadas` lê as linhas
`[WebServer]` (um endereço `http://host:N`, ou "port N" / "porta N").
- Se a aplicação anunciou outra porta e não a do gate, a causa diz qual porta
  ela anunciou, qual o gate forneceu, e que o defeito é do entrypoint, como no
  §107.
- Se anunciou a do gate, ou não anunciou nenhuma, a mensagem é a de antes.
- O gate roda o Playwright com `CI=1`, e a saída sai sem cores. As expressões
  que procuram `[WebServer]` continuam valendo.

**2. A retomada parte do parcial.** Ao abrir o worktree, se o branch da fase tem
commits que o HEAD não tem (o `wip` de uma tentativa anterior), `guardarSobra` o
preserva em `capivara/<run>/<fase>-parcial-<sha7>` antes de `limparSobra`
apagá-lo.
- O parcial é reaplicado no worktree novo, aberto do HEAD integrado, com
  `merge --squash`, e fica como alteração não commitada. O commit da fase
  continua sendo um só, e a integração não muda.
- Se o parcial conflita com a árvore integrada, o worktree volta ao HEAD e a
  fase começa limpa.
- Nos dois casos, o anúncio diz o commit e o branch preservado.

O §108, as permissões, os critérios G0–G4 e os prompts não mudaram, e não
entrou nenhuma restrição nova aos agentes.

**Limitações:**
- os branches `-parcial-` não são apagados automaticamente, como os
  `-aprovada-` do §110;
- a fase retomada não é avisada no prompt de que o código parcial veio de uma
  tentativa anterior: ela o encontra na árvore;
- o modo serial não usa worktree, e não muda.

Testes:
- `test/loop/flows.spec.ts`: a configuração tem `stdout: 'pipe'`; as portas
  anunciadas saem só das linhas da aplicação; o timeout com a porta 3000
  anunciada diz qual é; anunciar a porta do gate mantém a mensagem genérica.
- `test/loop/paralelo.spec.ts`, com Git real: o parcial é reaplicado sobre a
  árvore integrada e o original fica no branch; o parcial que conflita não
  entra, e a fase começa do HEAD; sem parcial, nada é preservado.

Contra o código anterior, 5 dos 7 testes falham. Os 2 casos negativos passam
nos dois, como devem.

## §112 — O executor roda sem sandbox e sem aprovação, e o prompt não proíbe o que ele precisa rodar

O operador decidiu eliminar as travas que impediam o executor de agir. Este foi o
segundo teste com uma falha desse tipo. No `teste_luna`
(`docs/DIAGNOSTICO-TESTE-LUNA-2.md`):
- o executor da P05 escreveu specs de navegador por três ciclos sem rodá-las,
  porque "a instrução proíbe outro executor", e bloqueou no G3 por defeitos que
  a primeira execução teria mostrado;
- o codex recusou um `rm -f` de limpeza, mesmo com `danger-full-access`;
- as fases gastaram o ciclo 1 sem atualizar um teste antigo que contradizia a
  fase.

**Providers.** Em qualquer nível, com ou sem `systemInstall`:
- codex: `--dangerously-bypass-approvals-and-sandbox` no lugar de `--sandbox`;
- cursor: `--sandbox disabled`;
- agy: sem `--sandbox`;
- opencode: já tinha tudo liberado;
- claude: já estava assim desde o §108.

O contrato do workspace de codex e opencode deixou de ser `insuficiente`: nenhum
executor é recusado no preflight, e o resumo diz que ele tem acesso amplo ao
sistema, à rede e aos arquivos do usuário. `systemInstall` continua decidindo só
o aviso `CAPIVARA_SYSTEM_INSTALL`.

**Prompt do executor.**
- "Do not use another runner and do not run the tests outside it" saiu. O
  comando do gate continua sendo o que precisa passar, e o executor é mandado
  rodar também o que mais o projeto oferecer: testes de navegador e e2e, um
  arquivo só, watch. "Write a browser test and run it."
- Entrou: "A test from an earlier phase that contradicts what this phase
  requires is out of date: update it."
- Saiu o parágrafo do comando "que a sessão recusa pela forma" (§106). Ficou só
  onde pôr o temporário.

**O que fica, por ser do juiz e não do executor:**
- os papéis somente-leitura (verificador, auditor, escritor);
- `.capivara/init` e `.capivara/runs` fora do alcance;
- "nunca apagar ou pular teste para passar";
- os critérios G0–G4;
- a definição dos papéis de planejamento e da sessão de instalação.

Testes: `adapters.spec`, `prerequisites.spec`, `execucao.spec` e
`prompts.spec` foram reescritos para o comportamento novo; os anteriores fixavam
as travas.

**Não validado** com uma chamada real ao codex: a flag é a que o
`codex exec --help` da 0.162.1 documenta.

## §113 — O e2e do projeto é nomeado, o parcial volta no que não conflita, e o G2 reconhece a rota que passou a existir

Três consequências de `docs/DIAGNOSTICO-TESTE-LUNA-2.md`.

**1. O comando de e2e no prompt.** `resolveE2eCommand` lê `scripts.test:e2e`, ou
`scripts.e2e`, do `package.json` do worktree e devolve `npm run <script>`.
- O bloco do comando de teste passa a nomeá-lo: "The project's browser and
  end-to-end tests run with: `npm run test:e2e`". Ele manda rodá-los ao escrever
  ou mudar um teste desses, e de novo antes de terminar.
- O G2 continua com `resolveTestCommand` (`npm test`), com os mesmos critérios.

**2. Recuperação parcial do parcial.** Quando o `merge --squash` do §111
conflita, os arquivos em conflito ficam com a versão do HEAD, inteiros
(`checkout HEAD --`, ou removidos se o HEAD não os tem), e o resto do parcial
volta como alteração não commitada.
- Nada é resolvido por conteúdo.
- O anúncio diz quais arquivos ficaram com a versão integrada.
- Se nada sobra fora do conflito, ou o git recusa por outro motivo, a árvore
  volta ao HEAD, como antes.
- Com os parciais reais do `teste_luna` sobre `74ad68a`, voltariam 7 dos 8
  arquivos da P04 e 5 dos 6 da P05. O que fica de fora é
  `testes/compartilhado/api-fundacao.test.ts`.

**3. O diagnóstico do G2.** `raizComum` reconhece a falha "expected 2xx to be
404" e "expected 2xx to be greater than or equal to 400", em qualquer número.
- Em vez de "costuma ser configuração do ambiente de teste", diz que é um teste
  que fixava a ausência de uma rota, contradito pela rota que a fase implementa.
- Nomeia os arquivos (`FAIL <arquivo>`) e manda atualizar a expectativa sem
  apagar o teste.
- O caso contrário, 404 onde se esperava 200, continua na regra de antes.

Os critérios G0–G4 não mudaram.

Testes:
- `preflight.spec`: o e2e é resolvido, e o comando do G2 continua `npm test`;
- `prompts.spec`: o e2e é nomeado no implement e no fix, e não aparece sem o
  script;
- `prerequisites.spec`: usa a saída real do G2 da P04; uma falha só já basta; o
  404 inverso não entra;
- `paralelo.spec`, com Git real: o parcial volta nos arquivos que não conflitam,
  e o que conflita fica com a versão integrada, sem marcador.

## 114. Validação orientada, reparo assistido e dependências compatíveis

A P07 do `teste_luna` chegou a passar nos gates da worktree duas vezes, mas
falhou na integração porque o SQLite nativo da pasta principal continuava
compilado para o Node anterior. Refazer a fase não corrigia essa instalação e
a segunda implementação perdeu uma correção de mensagens de rede. O diagnóstico
também expôs testes que verificavam o alerta sem conferir seu conteúdo ou que
substituíam uma falha de transporte por uma resposta HTTP simulada.

O verificador agora deve enumerar todas as lacunas de cada critério e informar
evidência, localização, como corrigir e qual teste ou comando confirma o reparo.
O protocolo `TASK n: DONE|INCOMPLETE` permanece compatível; a orientação completa
segue na causa entregue ao construtor. O prompt distingue falha real de rede
de HTTP 503 e exige o comportamento e a mensagem previstos na especificação.

O build via CLI habilita, por padrão, um reparo pelo verificador por fase.
`--max-verifier-repairs` aceita de 0 a 10; a biblioteca recebe esse orçamento
explicitamente e mantém zero como padrão. API direta continua fornecendo
orientação, sem prometer ferramentas que não possui.

Avaliação e reparo são sessões distintas. A avaliação permanece somente leitura;
a sessão de reparo pode corrigir código, fortalecer testes e instalar
dependências locais. Instalação de sistema depende da política do build.
O reparador não altera especificação nem referências Git e não aprova o próprio
trabalho: o Core repete G2, inventário, uma nova verificação G3 completa e G4.
As aprovações anteriores são revogadas após o reparo para impedir que uma
mudança regrida uma tarefa e seja aceita com base no veredito antigo.
G2, G3 com diagnóstico válido e G4 com defeito do produto podem acionar o
reparo. Defeito de roteiro ou critério não autoriza adaptar o produto.

As dependências Node passam a ter identidade por executável, versão, ABI,
plataforma, arquitetura e manifestos/lockfiles. Instalações antigas são
inspecionadas em busca de incompatibilidade nativa; cópias sabidamente
incompatíveis não são levadas às worktrees. A preparação é limitada e os
comandos npm respeitam `engines` com `--engine-strict`. Instalações, scripts,
gates e aceitação usam o diretório do Node que iniciou o harness à frente do
`PATH`, evitando carimbar uma instalação produzida por outro runtime.

A integração prepara as dependências da pasta principal mesmo sem alteração
do manifesto quando a instalação é incompatível ou ausente. Uma falha de
dependência permite reparo limitado e nova execução da suíte sobre a mesma
integração. Se o ambiente não fechar, o commit e a worktree aprovados ficam
preservados com um checkpoint; a retomada tenta integrar esse mesmo commit sem
chamar novamente o construtor. `--rebuild-all` continua exigindo reconstrução.
Falhas funcionais mantêm a reavaliação, reaproveitando os acertos preservados.

Os logs completos de instalação e G2 da integração ficam no run. Cada chamada
também registra papel, modelo, effort, worker, runtime e modo de reparo em
`calls.jsonl`. O snapshot final acompanha pausa ou conclusão e conserva a data
de criação na retomada. Antes de uma nova tentativa, o snapshot, os prompts e
os logs anteriores são arquivados em `attempts/`, para não confundir ciclos
de tentativas diferentes.

Regressões cobrem reparo de código e dependências, revalidação após mutação,
limites finitos, permissões por chamada, preservação de diagnóstico, runtime
conflitante no PATH, integração sem reconstrução por erro ambiental,
`--rebuild-all` e recuperação do estado final.

Validação final: `npm run check` passou com build, checagem de tipos e 2.067
testes em 110 arquivos, incluindo a CLI empacotada com adaptador de teste e
integrações com Git real. Na pasta principal do `teste_luna`, as dependências
também foram reinstaladas com Node 24.22.0 e `npm ci --engine-strict`; o módulo
nativo do SQLite carregou nesse runtime e a instalação ficou compatível. Essa
verificação não executou novamente a P07 nem alterou seus commits aprovados.

## §115 — Diretório efetivo e configuração das APIs no wizard

O `teste_opencode2` mostrou que `cwd` sozinho não garante o diretório da sessão:
o OpenCode 2.0.32 lê `process.env.PWD` antes de `process.cwd()` e faz `chdir`
para esse valor. A ponte deve entregar `PWD` absoluto igual ao `cwd` em todas
as invocações. O teste reproduz esse consumo de PWD, com a principal diferente
do worktree, tanto na implementação quanto na avaliação e no reparo.

No paralelo, antes e depois de cada chamada, conferir a árvore principal na
mesma fila exclusiva usada pelo integrador. Assim uma integração legítima não
parece escrita externa. Alterações versionadas e novos arquivos de produto
interrompem a fase antes de outra chamada ou aprovação; não há limpeza nem
commit desses arquivos. Não atribuir a autoria quando há agentes concorrentes.
O diagnóstico distingue o trabalho no worktree do que ficou na principal e
não promete um branch com trabalho que ele não contém.

Ao escolher uma API direta, o wizard verifica primeiro se existe credencial
salva ou variável de ambiente do provider. Sem nenhuma, oferece configurar a
chave ou voltar. A entrada é oculta, inclusive no resumo do terminal, e o store
é privado desde o primeiro byte. O mesmo cadastro fica disponível em
`capivara login` e `capivara config add api`. A chave nunca entra no comando
equivalente. API exige modelo explícito; listagem indisponível oferece digitar
o identificador ou voltar, sem lista vazia nem modelo padrão inexistente.

Os caminhos completo e de preenchimento de papéis usam a mesma configuração.
Providers de API continuam limitados aos papéis de leitura: não oferecem um
executor nem sessão de reparo com ferramentas. Testes não usam credenciais reais.

Validação: `npm run check` passou com build, tipos e 2.141 testes em 112 arquivos,
sob Node 24.22.0. A CLI compilada também cadastrou uma chave fictícia num store
temporário e a exibiu como configurada em `providers list`, sem revelar a chave.
A reprodução com OpenCode 2.0.32 confirmou o diretório efetivo antes e depois da
correção, sem inferência. O build completo do projeto experimental não foi retomado.

### §115.1 — API com provider preenchido ainda pode estar sem modelo

O seletor completo lista os modelos DeepSeek com a chave salva, tanto em TTY
quanto por linhas. O atalho de comando, porém, considerava resolvido um papel
que tivesse apenas provider. Para API direta, modelo vazio também deve abrir
o seletor, mantendo o provider, os demais papéis e as flags que já foram dadas.
Papéis pendentes com o mesmo provider podem compartilhar uma escolha de modelo;
um papel que já tem modelo não é alterado. Sem TTY, explicar qual modelo falta
e como informá-lo, sem chegar à ponte nem fazer uma chamada de inferência.

A listagem de API deixa de esconder falta de credencial, HTTP e falhas de rede
como ausência de modelos. O diagnóstico contém status e causa segura, nunca
corpo da resposta nem chave. `capivara providers models <provider>` exercita o
mesmo caminho do wizard e permite conferir a listagem sem iniciar uma tarefa.

Validação: `npm run check` passou com 2.149 testes em 113 arquivos. Com a chave
DeepSeek salva, a API real respondeu HTTP 200 e retornou `deepseek-flash` e
`deepseek-v4-pro`. A CLI compilada mostrou ambos no wizard por linhas, no
painel TTY, no comando novo de listagem e no seletor do comando direto sem
`--model`. Os seletores foram cancelados antes da execução; não houve inferência.

### §115.2 — O wizard não oferece um executor sem ferramentas

O build com `deepseek` global demonstrou uma escolha impossível: a listagem
funcionou, mas uma API direta não executa as ferramentas do builder (D-21).
Quando os papéis usados incluem builder, a escolha global oferece apenas CLIs.
O mesmo limite vale para o ajuste separado do builder e para o wizard curto.
Os papéis de leitura continuam podendo escolher APIs diretas. O wizard explica
como usar um modelo de API na implementação por uma CLI, sem trocar provider
ou permissões silenciosamente nem iniciar um tool loop novo no Core.

O OpenCode reaproveita as chaves salvas na Capivara. Sua descoberta usa um
servidor privado e recebe as variáveis dos providers reconhecidos; uma sessão
recebe apenas a chave salva do provider do modelo escolhido (`deepseek/...`,
por exemplo). Variáveis já presentes no ambiente são preservadas, salvo seleção
explícita de credencial. Nenhuma chave é copiada para a configuração do OpenCode,
impressa ou posta em argv. Outras CLIs não recebem chaves adicionais do store.

A listagem OpenCode 2 usa `api model.list --standalone`: o JSON observado contém
`data[].providerID`, `id` e `variants[].id`. Os mesmos dados dão os identificadores
e os níveis de raciocínio reais. Uma lista de variantes vazia significa que o
modelo não oferece variantes; informação indisponível é representada por null
e permite o fallback genérico. Quando a CLI declara `none`, desligar raciocínio
envia essa variante; sem ela, omitir a variante se chama padrão do modelo.

O preflight continua recusando API direta como executor e explica o caminho
via OpenCode. Essa recusa não altera o perfil salvo nem começa uma fase.

Validação: `npm run check` passou com 2.158 testes em 113 arquivos. A descoberta
real no OpenCode 2.0.32, com a chave salva, retornou 76 modelos, incluindo
`deepseek/deepseek-flash` e `deepseek/deepseek-v4-pro`; as variantes DeepSeek
foram `none`, `low`, `high` e `max`. Uma sessão real do builder com o Flash,
pela ponte compilada, escreveu e leu um marcador num worktree descartável.
Mesmo herdando PWD da principal, o marcador ficou só no worktree; a chamada
terminou com código 0 e resultado legível. O teste usou a chave pelo ambiente,
sem copiar credenciais para arquivos. O build do projeto experimental não foi
reiniciado e suas alterações anteriores continuam preservadas.

### §115.3 — APIs continuam visíveis na escolha do executor

Ocultar os providers de API na escolha do build fez a interface parecer perder
essas integrações. A lista mantém os mesmos doze providers e sua numeração.
Nos papéis com ferramentas e nos agentes paralelos, cada API informa no próprio
item que será usada via OpenCode. Ao escolhê-la, o wizard oferece configurar a
chave, lista somente os modelos desse provider descobertos pelo OpenCode e gera
explicitamente `provider=opencode` com o identificador completo do modelo.
O caminho manual exige modelo e acrescenta o prefixo do provider; não permite
herdar acidentalmente um modelo padrão de outra API. Gemini usa o prefixo google
do OpenCode. A chave Gemini salva também é resolvida quando o modelo usa google.

Análise de impacto: a escolha global, os ajustes por papel, os workers e o wizard
curto leem as mesmas opções e precisam da mesma resolução. Papéis de leitura
continuam usando APIs diretas. Os dados persistidos e o preflight permanecem no
contrato existente: executor e workers têm provider CLI, sem alterar memórias,
caches, plano do projeto nem argumentos já completos de um comando direto.
Regressões devem cobrir a escolha da API nas quatro entradas, cadastro recusado,
filtragem, modelo manual obrigatório e preservação de APIs nos papéis de leitura.

Validação: build, typecheck e suíte completa passaram, com 2.166 testes em 113
arquivos. O teste do terminal por teclas escolhe a opção 10 e confirma a lista
filtrada e o modelo/effort enviados ao executor. Na CLI instalada, o wizard real
no projeto experimental mostrou os doze providers e os dois modelos DeepSeek,
montando `build --provider opencode --model deepseek/deepseek-flash --effort high
--parallel 3`. A execução foi recusada no último passo de propósito; nenhum
build nem chamada de inferência foi iniciado.

### §115.4 — Lockfile local ignorado não é a entrega da fase

No `teste_opencode2`, o DeepSeek concluiu P02 e aprovou P03 nos gates da
worktree. A integração de P03 falhou no `npm ci`: o projeto ignora
`package-lock.json` deliberadamente, e o lockfile local antigo da principal
não continha as novas dependências. O contrato da instalação deve distinguir
esse arquivo local da entrega versionada, sem exigir do modelo um arquivo que
a política do projeto exclui do Git.

Análise de impacto: `comandoDeInstalacao` é compartilhado pela preparação do
runner serial e da worktree e pela instalação da árvore integrada. Para um
lockfile existente e ignorado pelo Git, instalar sem ler nem gravar lockfile
(`npm install --no-package-lock`). Lockfiles rastreados, inclusive quando
casam com uma regra de ignore, continuam usando `npm ci`. Fora de Git ou com
consulta indisponível, preservar o comportamento conservador anterior.
Nenhum manifesto, ignore, lockfile, memória ou branch do produto é modificado
por essa decisão. Testar a seleção, o caso versionado e uma integração real
de Git com lockfile local obsoleto que não é parte do commit da fase.

Validação: `npm run check` passou com 2.171 testes em 113 arquivos. Numa cópia
isolada do commit P03 `0facf4d13e8c`, o lockfile local da principal reproduziu
o EUSAGE e as seis dependências ausentes do `npm ci`. Com o comando corrigido,
a instalação real passou sob Node 24.22.0, assim como os 44 testes do backend,
os 37 do frontend e o build dos dois. O lockfile permaneceu byte a byte igual
e a cópia continuou sem alterações versionadas. A principal original seguiu
limpa em `00f6e52` (P02 integrada), e o branch da P03 foi preservado; o build
completo não foi reiniciado nem foram feitas novas chamadas de modelo.

### §115.5 — MiniMax lista os modelos pela API

A listagem de MiniMax estava desabilitada por uma suposição antiga de que o
provider não oferecia descoberta. A documentação oficial atual declara
`GET https://api.minimax.io/v1/models`, e a chave salva respondeu HTTP 200 com
oito identificadores reais. A referência é a [listagem oficial do MiniMax](https://platform.minimax.io/docs/api-reference/models/openai/list-models).
O catálogo declara esse endpoint de descoberta
explicitamente, pois ele não se deriva do endpoint legado de inferência.

Análise de impacto: o novo endpoint opcional é consumido apenas pela descoberta
de modelos. Wizard completo, preenchimento de papéis e comando `providers models`
usam o mesmo caminho, com autenticação e diagnóstico já existentes. Demais APIs
mantêm seus endpoints atuais. No executor, MiniMax continua usando o catálogo e
as variantes reais do OpenCode, com chave salva passada pelo ambiente somente
ao provider escolhido. Sem chave, continua oferecendo cadastro; erro da API
continua exibindo a causa segura e permitindo voltar ou informar modelo manual.
Nenhuma chave, fase, memória ou configuração do projeto muda com a consulta.

Validação: `npm run check` passou com 2.178 testes em 113 arquivos. A CLI
instalada retornou os oito modelos reais pelo comando de listagem, usando a
chave salva. O wizard real de init mostrou os oito identificadores da API; o
de build mostrou os sete modelos habilitados no catálogo OpenCode para o
provider minimax. Para MiniMax-M3, a CLI declarou as variantes none e thinking,
sem oferecer high. Os dois wizards foram cancelados antes da execução; houve
apenas descoberta, sem inferência. Os testes cobrem segredo no header, store
salvo, HTTP 401, seleção por teclas, papéis de leitura e executor via OpenCode.

### §115.6 — Executar a API, não uma flag fictícia do Node

Os init de `teste_minimax` e `teste_openrouter` encerraram com código 9, antes
de qualquer requisição. A invocação de API direta ainda era um esboço que
executava `node --capivara-direct-api`, flag inexistente. A descoberta não
exercitava esse caminho. A implementação passa a realizar HTTP com fetch nativo,
sem subprocesso, SDK novo ou ferramentas de escrita para papéis de leitura.
MiniMax usa o endpoint OpenAI compatível atual `/v1/chat/completions`.

Análise de impacto: `buildInvocation` declara uma chamada de API explícita e
`runProvider` a executa, mantendo o contrato de retorno usado na ponte de todos
os estágios. Writer, auditor e avaliação do verifier podem receber texto; builder
e reparo com ferramentas continuam exigindo CLI. Não há migração de providers
nem de memórias. OpenAI Chat Completions e Anthropic Messages têm serializadores
e leitores próprios; texto final é separado de reasoning/thinking. Raciocínio
segue o catálogo e é desligado explicitamente sem effort, sem fallback pago
silencioso. Modelo que não aceita desligar deve recusar com diagnóstico.

A requisição respeita o limite de parede, cancelamento e teto de bytes. Chave
vai apenas no header apropriado, sem redirects, argv ou arquivos; callbacks,
erros e respostas passam pelo redator. HTTP, rede, credencial ausente, JSON
inválido, conteúdo vazio e geração truncada retornam diagnóstico legível,
distinto de uma resposta válida do modelo. Uso de tokens acompanha o retorno.
Init e plan preservam stderr nas falhas e as classificam como falha da chamada,
em vez de atribuir saída vazia à qualidade do modelo. Testar os dois dialetos,
erros e limites, os seis providers, ponte com chave salva e uma requisição real
de geração pequena, além da listagem.

A validação completa também expôs uma prova de concorrência dependente de uma
janela de 80 ms para três worktrees abrirem. O provider falso desse teste deve
esperar as chamadas esperadas chegarem a uma barreira com timeout, antes de
concluir qualquer uma. Isso confirma concorrência real sem depender da rapidez
do Git nesta máquina e sem modificar o escalonador do produto.

Validação: build, typecheck e suíte completa passaram com 2.204 testes em 115
arquivos. Pela ponte compilada, uma geração real MiniMax-M3 retornou o texto
exato solicitado com código 0, 182 tokens de entrada, 6 de saída e zero de
raciocínio. DeepSeek Flash também respondeu corretamente por HTTP direto.
O teste real OpenRouter chegou à API e recebeu HTTP 401 `User not found`:
diagnóstico de credencial agora legível, distinto do antigo erro 9 local.
Os testes da CLI exercitam init de MiniMax e OpenRouter e comprovam que o
diagnóstico HTTP chega à parada e ao arquivo de evidência sem expor chaves.
Nenhum init completo nem build de projeto foi reiniciado durante a correção.

### §115.7 — OpenRouter distingue chave de geração e de gerenciamento

A chave cadastrada pelo wizard autentica em `GET /api/v1/key` (HTTP 200), mas
tem `is_management_key: true` e `is_provisioning_key: true`. Chaves desse tipo
administram credenciais e não executam completions. A listagem pública de
modelos retorna o mesmo catálogo sem chave; por isso não valida acesso à geração.
O HTTP 401 `User not found` observado na geração não prova que a chave esteja
inválida: neste caso a autenticação funciona e a categoria da chave é inadequada.

Análise de impacto: `ensureApiCredential` é usado no wizard completo, atalho de
papéis e configuração de API. Para OpenRouter, ele verifica a chave salva ou de
ambiente no endpoint oficial de metadados antes da listagem e execução. Uma
chave de gerenciamento ou expirada oferece substituição no próprio wizard;
a chave nova só é salva após validação. Credenciais existentes permanecem
intactas ao cancelar ou falhar a consulta. Timeout, rede e HTTP 5xx oferecem
tentar novamente ou voltar, sem assumir que a chave precisa ser trocada.
Outros providers mantêm seu fluxo. A consulta não gera texto, não cobra tokens,
não lista nem cria outras chaves e não registra metadados pessoais ou segredos.

Referências: [metadados da chave atual](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
e [limitação de chaves de gerenciamento](https://openrouter.ai/blog/tutorials/team-spend-controls-setup/).

Validação: `npm run check` passou com 2.220 testes em 116 arquivos. No wizard
compilado, a chave existente foi identificada como gerenciamento e recebeu a
opção de substituição na própria tela; cancelar manteve o arquivo de credenciais
byte a byte igual e não iniciou execução. Os testes comprovam a troca por uma
chave de geração antes de listar modelos, rejeição de chave administrativa nova,
preservação ao cancelar, repetição após HTTP 500 e ausência de segredos na saída.
Nenhuma chave foi criada, revogada ou substituída na conta ou no store real.

### §115.8 — Substituição de chave sem repetição automática

A rejeição de uma chave digitada não pode reabrir o campo oculto imediatamente.
O usuário deve escolher explicitamente entre voltar ao provider (padrão) e
digitar outra chave, com o motivo da recusa visível na recuperação. Reenviar uma
chave já recusada nesta configuração não refaz a consulta de rede. Uma chave
válida continua sendo salva e permite escolher o modelo normalmente.

Análise de impacto: o fluxo compartilhado atende wizard completo, seleção de
papéis e configuração de API. O retorno falso continua significando voltar,
sem listar modelos ou iniciar uma chamada com credencial incompatível. Não
muda o formato do store, a seleção de credenciais ou o transporte de geração.
Chaves antigas permanecem intactas até uma substituta válida ser salva. A
validação de caracteres também exige escolha explícita após recusa; a repetição
de uma consulta indisponível já exige escolha e permanece separada da troca.
Testar cancelamento na recuperação por linha e cursor, repetição da mesma chave
sem nova consulta, recuperação com chave válida e preservação do store.
O terminal corta notas longas por linha; os diagnósticos de gerenciamento e as
instruções de troca devem usar linhas curtas para manter causa e endereço
visíveis. Verificar também as molduras efetivamente desenhadas pelo prompter.

Validação: quatro regressões falharam com a repetição automática e passaram
após a correção. O teste de terminal também encontrou o motivo cortado e agora
confirma causa e endereço visíveis, decisão explícita, ausência de nova consulta
para a mesma chave e avanço até a seleção de modelo com uma substituta válida.
`npm run check` passou com 2.225 testes em 116 arquivos, build e typecheck.
O binário instalado aponta para o bundle recompilado. Nenhuma credencial real
foi alterada e nenhuma geração de modelo foi iniciada nesta correção.

### §115.9 — Convergência do plan observado em teste_minimax

O plan de 18/10 chegou a dez rodadas de auditoria/emenda e terminou NOT READY.
A emenda recebia pedido e findings de todas as fases, mas não a fatia do
esqueleto, as decisões aceitas ou a gramática/tetos que orientaram a escrita.
Uma resposta perdeu o fechamento `**` de Acceptance criteria e foi descartada
inteira por I-08, embora os critérios estivessem presentes. Os lotes paralelos
do ensaio ainda sobrescreviam o mesmo arquivo de prompt e resposta.

Corrigir o contexto da emenda com a fatia da própria fase, decisões aceitas
atuais (inclusive arbitragem), gramática e tetos comuns. Findings com alvo
conhecido chegam apenas às fases afetadas; achados globais continuam globais.
Recuperar fechamento de negrito ausente em rótulo estrutural conhecido, dentro
da normalização do contrato, sem inventar critério, trace ou decisão. Forma
sem conteúdo continua reprovada. Não flexibilizar o gate nem aprovar documento
por silêncio ou impasse.

Cada chamada de init/plan terá identificador próprio na evidência, além de
etapa, assunto, papel e tentativa. Isso preserva todos os lotes, repetições e
execuções retomadas. O runId e o formato das memórias não mudam. O metadado
command deve distinguir plan de init, mantendo o mesmo runId que liga os dois.

O ensaio recebe instrução explícita para julgar a possibilidade de prova no
repositório após implementação, inclusive leitura da fundação e comparação com
Git. A ausência desses arquivos agora e a falta de enumeração de cada arquivo
futuro não tornam o critério impossível. Divergência de preferência ou cobrança
de técnica pertence à auditoria, não à observabilidade. Contradição comprovada
com decisão continua bloqueante; não descartar automaticamente os vereditos.

Análise de impacto: escrita, emenda, auditoria e ensaio compartilham as mesmas
decisões e contrato; a recuperação sintática atende escrita e emenda. Os hashes
de auditoria já incluem o texto corrigido e a autoridade atual; não há migração
ou apagamento de caches. Nomes de evidência não são chave de cache nem entrada
do executor; adaptar o teste da CLI que abria um nome fixo. Cobrir decisão nova
chegando à emenda, isolamento dos findings por fase, rótulo malformado preservando
conteúdo, falta real de critério ainda recusada, lotes e retomadas sem perder
evidências. Reproduzir localmente o I-08 com a resposta capturada, sem chamar API
nem reiniciar o projeto do usuário durante o reparo.

### §115.10 — Regras de banco embutido não exigem conexão de servidor

A auditoria de teste_minimax cobrou host, porta, usuário e senha para SQLite
porque o harness acrescentava essa regra de servidor a qualquer banco. Também
exigia que o `.env.example` da aplicação persistente apontasse diretamente para
o banco descartável dos testes, provocando disputa sobre o caminho padrão.

Para a escolha embutido, a configuração exigida é o caminho do arquivo por
ambiente. O exemplo inicializa um arquivo local persistente da aplicação sem
serviço externo; testes e fluxos fornecem outro caminho temporário e o destroem
ao terminar, sem tocar o `.env` nem o banco normal. Bancos de servidor mantêm
suas regras de conexão e origem. As demais garantias comuns permanecem.

Análise de impacto: `regrasDeBanco` acrescenta regras depois do parser do init;
isso muda novos esqueletos e os hashes derivados deles. Não editar esqueletos
publicados nem decisões antigas silenciosamente. O teste atual teve sua pasta
`.capivara` removida externamente durante a investigação e recomeçará pelo init.
Cobrir os três tipos de origem, ausência de credenciais fictícias em SQLite,
persistência do exemplo e isolamento do arquivo temporário dos testes.

Validação de §115.9–§115.10: build, typecheck e suíte completa passaram com
2.234 testes em 116 arquivos. As regressões comprovam decisão aceita durante
auditoria chegando à emenda, separação dos findings, aproveitamento da correção
com negrito malformado e preservação de cada lote, complemento e retomada.
Os testes de banco verificam conexão de servidor preservada, configuração de
arquivo para banco embutido e publicação das regras corretas no novo init.
No bundle compilado, a reprodução do rótulo observado mudou de I-08 para
nenhum erro, alterando somente o fechamento `**`. O registro original completo
já não estava disponível após a remoção externa da pasta de controle do teste.
O comando instalado usa o bundle recompilado. Nenhuma API foi chamada, nenhum
artefato do projeto do usuário foi editado e nenhum teste real foi reiniciado.

### §115.11 — Falha mecânica do escritor não é decisão de produto

O OpenRouter de teste_openrouter respondeu às seis chamadas de escrita, mas a
fundação oscilou entre 12, 17, 20, 21, 18 e 16 tasks. A última resposta ainda
tem duas tasks com cinco critérios. Os prompts já declaram os limites de 15
tasks e quatro critérios, a fatia e as decisões aceitas. Nenhum auditor foi
chamado: o self-check rejeitou antes. O bloqueio é correto; a apresentação não.

O impasse mostrava zero devoluções porque só contava as do auditor, chamava o
self-check de auditor e oferecia uma decisão de produto para resolver contagem.
Preservar contagens separadas e mostrar o total das verificações mecânicas
quando elas esgotam o orçamento. Identificar a falha como estrutura que o
modelo não adequou. No terminal, oferecer controles de repetir a correção,
publicar rascunho e interromper; texto livre não vira autoridade para dispensar
limites. Publicar rascunho não altera o gate de prontidão.

Análise de impacto: `Standoff` é produzido pelo ciclo e consumido pelo relatório
e callback da CLI; o callback ganha contexto opcional mantendo compatibilidade
com callers que recebem só texto. Arbitragem semântica mantém suas opções e
contagem. Ajustar a promessa de preservação do plan: fases guardadas em cache
continuam disponíveis; isso não significa plano final já publicado. Não mudar
tetos, orçamento, cache, artefatos do usuário nem a execução em andamento.
Testar contagem mecânica e mista, mensagem e opções corretas, controles sem
registrar decisão, bloqueio de texto livre em contagem e regressões semânticas.

A regressão de publicação expôs que RALPH READY não repetia os tetos do
self-check: um rascunho com cinco critérios por task podia ser aprovado após
publicação explícita. Acrescentar a verificação de dimensionamento ao gate
final, usando os mesmos três limites (tasks/fase, critérios/task e critérios/
fase), sem alterar o parser ou inventar erro de contrato. Publicar permite
guardar o rascunho; não o declara pronto. Cobrir os três limites e o fluxo
completo de publicação explícita após reprovação mecânica.

Validação: `npm run check` passou com 2.243 testes em 116 arquivos, build e
typecheck. A regressão da contagem falhou antes do reparo; a de publicação
revelou e confirmou o fechamento do bypass de dimensionamento. O bundle
compilado reavaliou a última resposta real do OpenRouter: NOT READY somente
por 16 tasks na fase 1 e cinco critérios nas tasks 4 e 8. Nenhuma API foi
chamada e a execução em andamento e os artefatos de teste_openrouter não foram
alterados. As mudanças de apresentação valem nas próximas execuções do binário
instalado, que já foi recompilado.

### §115.12 — Resposta final do OpenCode e falha do roteirista no gate 4

Em teste_minimax, P01 passou pelo julgamento das 12 tasks e foi devolvida duas
vezes por roteiro com zero passos. A reprodução do JSONL prova que as quatro
respostas finais tinham cinco test.step; o leitor concatenava mensagens de
progresso com a resposta final, desalinhando cercas de código. Preservar partes
da mesma mensagem, mas entregar somente a última mensagem identificada por
messageID. Sem identificadores, manter a concatenação legada; tokens e custo
continuam somando toda a sessão. Nenhuma mudança nos demais providers.

O último roteiro também veio com stamp HTML na primeira linha do bloco TS:
convertê-lo em comentário de linha, sem alterar o código/asserts. Não aceitar
roteiro ausente ou relaxar a cobertura de passos.

Falha estrutural após o orçamento do roteirista deve ser scriptFailed, com o
workflow identificado. Ao esgotar a correção do próprio roteiro, interromper a
fase como defeito do harness, preservando o trabalho, em vez de gastar outro
ciclo do construtor. Erro real do produto continua chegando ao construtor.
Gravar causa mesmo antes de existir saída do Playwright. Cada chamada de
roteirista guarda prompt e resposta separados, com ciclo e identificador; o
contexto da passagem não deve virar `[object Object]` no nome do arquivo.

Análise de impacto: a leitura do OpenCode atende todos os papéis; testar partes
da mesma mensagem, múltiplas mensagens, transcritos legados, saída crua e uso
somado. Gate 4 conserva toda validação e a política de uma correção própria do
roteiro; falha de roteiro não deve mudar produto nem virar verde. O encerramento
antecipado reutiliza a preservação de parcial e relata o ciclo realmente gasto.
Não alterar fases, critérios, scheduler, worktree nem processo do usuário.
Reproduzir as sessões reais offline e executar regressões de providers/gate/loop.

Validação: build, typecheck e suíte completa passaram com 2.249 testes em 116
arquivos. Os dois testes iniciais falharam no leitor e no stamp antes do reparo.
Na reprodução das sessões reais, as quatro rejeições de zero passos passaram
a cinco passos, sem defeito estrutural e com sintaxe TypeScript válida; as três
demais respostas mantiveram cinco passos válidos. O teste integrado comprova
um construtor, duas tentativas de roteiro, nenhuma abertura de navegador e
parada no ciclo 1 quando o roteiro continua inválido, com código preservado,
prompts/logs distintos e causa gravada. Fragmentos legados, mensagens multipart,
tokens/custo e os outros providers mantiveram suas regressões verdes.

A execução antiga terminou durante a investigação com seletor ambíguo no
roteiro: `getByText('Total de tarefas')` também encontra `Abrir total de tarefas`.
Isso ainda precisa ser corrigido pelo roteirista e reexecutado no navegador;
a reprodução estrutural não demonstra que o fluxo inteiro passou. Nenhuma
chamada de API, alteração no projeto/worktree ou reinício do build foi feito
nesta correção. O binário instalado foi recompilado para a próxima execução.

### §115.13 — Repetição do auditor com diagnóstico do protocolo

Em teste_openrouter, P1 e P2 responderam APPROVED com CAPIVARA_FINDING;
alguns findings também trocaram os separadores `|` por `/`. A segunda chamada
recebeu o mesmo prompt da primeira, sem o defeito apontado pelo parser ou a
resposta recusada. A rejeição é correta; a recuperação cega desperdiça a única
tentativa de correção. Não inferir aprovação de finding vazio, não converter
finding em remark e não escolher status por conta própria.

Na segunda tentativa, preservar o prompt original e acrescentar diagnóstico,
resposta anterior e instruções concretas para reemitir o veredito completo:
APPROVED omite findings (inclusive placeholders); defeito material exige
REJECTED com três campos separados por `|`. Não mudar evidência, escopo,
independência nem o teto de duas chamadas. Unificar a repetição das auditorias
por fase/coerência e do caminho por documento.

Análise de impacto: o parser e os gates permanecem estritos; somente a chamada
de recuperação muda. O primeiro prompt continua idêntico, portanto as chaves
de aprovação e escrita em cache e o sha da autoridade não mudam. A aprovação
só é gravada após resposta válida. Todas as chamadas continuam com evidência
própria. Testar os dois escopos do plano, findings incompatíveis com aprovação,
separadores errados, correção válida e persistência da falha após duas chamadas.
Não reiniciar API nem alterar o projeto do usuário para validar o reparo.

Validação: as três regressões de recuperação falharam antes do reparo; o caso
de bloqueio permaneceu verde. Depois, 117 testes de auditoria, ciclo em dois
estágios e cache passaram. `npm run check` concluiu build, typecheck e 2.253
testes em 116 arquivos. O bundle recompilado reproduziu offline as quatro
respostas reais inválidas de P1/P2: todas continuam recusadas, e a recuperação
inclui prompt original, resposta anterior e cada defeito do parser. Nenhuma
chamada real de API foi feita e teste_openrouter não foi alterado. O comando
instalado aponta para o bundle atualizado; o modelo ainda precisa responder
novamente e resolver os findings semânticos, inclusive os da coerência.

### §115.14 — Teto de geração não é falha de credencial

O plan de teste_openrouter recebeu `finish_reason: length` na terceira escrita
de P1, após cerca de dez minutos. O adapter enviava 32.768 tokens fixos; o log
guardou somente uma frase, sem modelo, effort, uso ou texto parcial. Não há
evidência para atribuir o consumo a raciocínio ou documento. A tela classificou
como ambiente e mandou verificar credencial, embora a geração tenha ocorrido.

Manter 32.768 como padrão. Permitir ajuste explícito para APIs diretas pela
variável `CAPIVARA_API_MAX_OUTPUT_TOKENS`, inteiro positivo seguro, validado
antes do HTTP. Aplicar ao campo equivalente de cada dialect sem alterar
thinking/effort. Não aumentar orçamento, reduzir esforço ou repetir geração
automaticamente. O provider pode recusar um teto acima do suportado pelo modelo.

No corte, manter saída inválida, código não zero e texto final vazio. Informar
modelo, effort, teto enviado, motivo e tokens de entrada/saída/raciocínio quando
presentes; dados ausentes continuam desconhecidos. Preservar texto visível
parcial sanitizado em arquivo separado `.partial.txt`, nunca como documento,
findings, cache ou fonte para retomada automática. Não guardar raciocínio interno.
Classificar a parada como geração incompleta e orientar ajuste de orçamento ou
effort no mesmo modelo, preservando o cache, sem culpar a credencial.

Análise de impacto: `runDirectApi` atende todos os papéis de texto e APIs; os
campos padrão e os demais erros permanecem iguais. A variável só é interpretada
na API nativa, não muda o executor OpenCode/CLI. O parcial sobe pelo supervisor,
bridge e caller documental exclusivamente para evidência; stdout com erro
continua diagnóstico. Não alimentar detectRateLimit com texto parcial. O
orquestrador mantém custos da chamada rejeitada, falha sem nova cobrança e não
publica/cacheia o parcial. Cobrir dialects, config inválida sem HTTP, consumo de
raciocínio, segredo removido, classificação e evidência pela CLI. Não chamar a
API real ou alterar teste_openrouter para validar.

Referência de semântica do orçamento: OpenRouter, Reasoning tokens and
max_tokens: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

Validação: os 15 casos novos falharam antes do reparo. Depois, os 52 testes
de API, parada e integração com a CLI passaram; `npm run check` concluiu build,
typecheck e 2.268 testes em 116 arquivos. Os testes mantêm o teto padrão nos
seis providers, validam configuração antes de HTTP e preservam consumo, parcial
sanitizado separado e falha sem publicação ou repetição. A CLI instalada já
aponta para o bundle recompilado. Não houve chamada real de API, alteração
em teste_openrouter ou aumento de orçamento automático. A distribuição do
consumo na chamada antiga permanece desconhecida: os dados foram descartados
naquela execução e não podem ser reconstruídos do log.

### §115.15 — Atividade do OpenCode no painel e contenção da suíte

No build de teste_openrouter, G0 aguardava uma sessão viva: o executor escrevia
arquivos e corrigia testes. `createAgentBridge` resumia somente codex-jsonl;
os eventos OpenCode ficavam no log cru sem chegar ao painel. Mesmo no caminho
com resumo, o callback atualizava só o histórico, mantendo AGORA e Atividade
com a descrição inicial durante toda a sessão.

Resumir o JSONL real do OpenCode: passos, ferramentas e estados, arquivos,
resultado de comandos/testes e erros. Não exibir reasoning, conteúdo de arquivos,
corpos arbitrários, argumentos sensíveis ou JSON inteiro. Diagnósticos
determinísticos como EADDRINUSE podem ser destacados; contagens de testes são
as reportadas pelo executor, nunca aprovação dos gates. Preservar o parser de
resposta final e a contabilidade. Resumos são telemetria, sem poder no scheduler.

Atualizar AGORA, Atividade e os eventos do agente certo em serial e paralelo;
manter o tempo da chamada e mostrar há quanto tempo chegou o último evento.
Indicar que G0 aguarda a conclusão do executor. Eventos não alteram gates ou
aprovação de tasks. Filtrar segredos e controles de terminal antes da interface.
O mesmo bridge atende init/plan, que também recebem a atividade do OpenCode.

Os testes de persistência gerados iniciavam `npx ts-node` e matavam o wrapper,
deixando o Node filho vivo e causando EADDRINUSE na reinicialização. Não matar
processos da sessão ativa por porta, nome ou cwd. Orientar o executor, inclusive
em reparos, a iniciar o binário real ou gerenciar grupo próprio, aguardar saída
e limpar em finally, preservando a verificação de persistência.

Mitigação mecânica no G2: o runner da suíte, que hoje usa execFile sem grupo,
passa a criar grupo próprio e recolher descendentes desse grupo quando o comando
termina, em sucesso e falha. Preservar stdin fechado, cwd, ambiente Node,
códigos/saída e teto de 32 MiB; não impor timeout novo. A aceitação e G4 já têm
contenção de grupos e não mudam. Isso evita vazamento entre verificações;
limpar durante o próprio teste ainda cabe à implementação do teste gerado.

Análise de impacto: callbacks de observação não podem mudar resposta nem
derrubar provider. Resumos e parciais têm limite; repetição por progresso não
vira nova chamada. O painel mantém o relógio e eventos separados por agente,
sem afirmar que silêncio é travamento. Não alterar contratos, fases, critérios,
cache, orçamento, modelo ou execução existente. Regressões devem provar resumo
dos eventos reais, transmissão incremental antes do fim pela ponte, segurança,
relógios, atribuição por agente e contenção com um processo alheio preservado.

Validação: a regressão pela ponte falhou antes do resumo OpenCode; as duas de
contenção falharam antes do grupo próprio, deixando as portas dos fixtures
ocupadas. Com o reparo, 172 testes direcionados passaram. `npm run check`
concluiu build, typecheck e 2.286 testes em 118 arquivos. A reprodução offline
do log real produziu 347 resumos, incluindo a rodada de 64 testes aprovados,
sem mudar resposta final ou gates. Os testes cobrem transmissão em chunks antes
de a sessão terminar, descarte de linha excessiva, argumentos privados,
relógios separados, atividade do agente certo e liberação de servidor tanto
em sucesso quanto código 7, preservando outro servidor fora do grupo.

As orientações de recursos também chegam à correção de aceitação e ao reparo
do verificador, não só à implementação inicial. A contenção do G2 não elimina
bugs de reinicialização dentro de uma sessão OpenCode: o teste gerado ainda
precisa encerrar seu próprio filho antes de iniciar o seguinte. O binário
instalado foi recompilado. A execução já aberta conserva o código antigo;
nenhum projeto/worktree, processo dela ou chamada real de modelo foi alterado.

### §115.16 — Cancelar encerra o provider; retomada preserva árvore interrompida

O usuário cancelou build-0d614b0876f0 após 51 minutos. O processo Capivara saiu,
mas o OpenCode destacado e seu servidor privado permaneceram vivos, iniciando
novas ferramentas. O log já tinha 75 testes verdes; faltava o executor encerrar
a sessão. O supervisor só tratava AbortSignal, que o binário não ligava a
SIGINT/SIGTERM. O servidor standalone e ferramentas também criam grupos próprios.

No binário, SIGINT/SIGTERM devem encerrar as invocações ativas antes de sair,
com código 130/143. Registrar chamadas no supervisor e remover o registro ao
terminarem. Matar o grupo próprio de cada CLI; para OpenCode standalone,
acrescentar um identificador aleatório por invocação e recolher, em Linux,
somente processos do usuário com esse mesmo identificador herdado. Não usar
nome, porta ou cwd como autoridade. A API direta termina com o processo; não
prometer que o servidor remoto devolve créditos de uma chamada já aceita.
Timeout/AbortSignal também recolhem os grupos separados do OpenCode. Bibliotecas
importadas não devem instalar handlers de sinal por conta própria.

Interrupção abrupta deixa arquivos novos sem commit no worktree. abrirWorktree
só preservava commits anteriores antes de remover a sobra: a retomada apagaria
essa P01. Antes de limpar um worktree existente, guardar alterações não
commitadas pela mesma política de admissão/recuperação de guardarParcial. Se a
guarda não for comprovada, abortar a reabertura preservando a árvore. O parcial
continua sem aprovação, não entra na principal e volta aos gates normalmente.

Análise de impacto: sinais do binário não viram nova chamada nem aprovação.
Não alterar modelo, duração máxima, G0 ou contrato de fases. Locks de processo
morto continuam recuperados pelo mecanismo existente. A guarda segue a política
de segredos e não altera o HEAD integrado; falha de disco/Git nunca autoriza
limpeza. Testar ausência de resposta nova após cancelamento, filhos em grupos
separados, processo alheio preservado, invocações finalizadas removidas do
registro e retomada de arquivos novos/modificados sem commit.

Na recuperação desta execução, 18 processos identificados pelo ambiente da
sessão antiga foram encerrados; a checagem seguinte encontrou zero restantes.
Não foi feita chamada de modelo nem integração do trabalho parcial.

Validação: as duas regressões falharam antes do reparo (servidor privado vivo
após AbortSignal e arquivos não commitados apagados na reabertura). Depois,
21 testes direcionados passaram. `npm run check` concluiu build, typecheck e
2.290 testes em 120 arquivos, incluindo o binário real cancelado por SIGINT
e SIGTERM com códigos 130/143 e servidor privado encerrado. O processo externo
do teste permaneceu vivo. A retomada preservou arquivo modificado e arquivo
novo sem alterar o HEAD integrado.

Na recuperação real, guardarParcial salvou a P01 no commit `cf44b13`, branch
`capivara/build-0d614b0876f0/P01`; a principal permaneceu em `3fe3c9e`.
Após comprovar que o dono original do lock estava morto, foi acrescentado um
evento blocked de cancelamento e atualizado o snapshot, sem marcar nenhum gate
ou fase como aprovado. O lock antigo fica para a quarentena automática normal.
O binário instalado foi recompilado. Nenhum teste de aplicação ou chamada paga
foi iniciado para fazer a recuperação ou validar esta correção.

### §115.17 — Timeout de sessão não inicia outra hora de construção

Em teste_openrouter, qwen3.8-flash teve 75 testes verdes às 20h09, mas expandiu
a garantia de isolamento para 13 scripts de mutação e instrumentação interna
de better-sqlite3. Às 21h07, o teto wall de 3.600s encerrou o executor. O loop
abriu automaticamente outro ciclo, cujo prompt carregava a última mensagem
de progresso sobre um mutante como parte da causa. A sessão seguinte voltou à
mesma investigação apesar de 88 testes verdes. O plano exige isolamento, não
um framework de mutação/telemetria da suíte. G2/G3 ainda não haviam julgado nada.

Timeout marcado pelo supervisor (first-output, idle ou wall) deve encerrar a
fase preservando o parcial, sem abrir automaticamente outra chamada longa ao
construtor. Vale para executor, verificação e reparo assistido: falha técnica
da sessão do verificador não é ordem para reimplementar produto. Permanecem o
teto atual e os ciclos normais para defeitos de produto/veredito. Rate limit
conserva sua política separada. O relatório deve atribuir o limite ao ambiente
da chamada, não a defeito do modelo/produto, com o ciclo efetivamente gasto.

Nos prompts de escrita/reparo, delimitar o ponto de entrega: cobrir todos os
critérios e cenários negativos exigidos, rodar verificações pertinentes e
devolver ao verificador independente. Não inventar framework de mutação,
interceptação de drivers ou nova infraestrutura de observabilidade sem
requisito explícito ou finding que o justifique. Não diminuir critérios,
remover asserções ou aceitar a palavra do executor como aprovação.

Análise de impacto: o novo freio só lê timedOut do supervisor e mantém a
finalização/preservação já existente. Não interpretar texto livre para decidir
parada e não fazer testes do executor substituírem G2/G3. A mensagem final de
progresso continua como evidência, sem ganhar autoridade de requisito. Não
mudar modelo, fase publicada, orçamento, timeout ou processo em andamento.
Regredir timeout nos três tipos e nos três papéis, distinguindo erro comum de
G0 e rejeição real de G2/G3 que continuam com correção automática.

Validação: as regressões de timeout falharam antes da mudança. A suíte final
`npm run check` concluiu build, typecheck e 2.296 testes em 120 arquivos.
Cobertura inclui os três tipos no executor, timeout do verificador e do reparo,
precedência sobre texto de rate limit no parcial e orientação de retomada sem
afirmar que o produto já está correto. O binário instalado foi recompilado.

O usuário cancelou novamente a execução antiga: nenhum processo da sessão
permaneceu. A pasta de teste passou a conter apenas docs, sem .git/.capivara;
não foi recriado esse estado. Os arquivos sobreviventes da P01 foram guardados
e relidos em arquivo privado de recuperação, fora do projeto, excluindo
node_modules e o ponteiro .git inválido. Não houve chamada de modelo, retomada
ou aprovação de fase. As novas instruções de encerramento ainda precisam ser
avaliadas em uma próxima execução real; não garantem convergência do modelo.

### §115.18 — Parâmetros do OpenRouter e recusa explícita antes de construir

No build-022eba66528c, Kimi K3 foi recusado com HTTP 402: a CLI pediu 256.000
tokens de saída, além do máximo que a cota da chave comportava. GLM-5.3-prime
foi recusado com provider.no-route por receber a variante none inexistente.
Os agentes com modelo próprio e effort vazio herdavam o effort do builder
apenas por usarem a mesma CLI, mesmo quando trocavam de modelo. Cada recusa
consumiu três ciclos; nenhum modelo chegou a implementar o produto.

O effort herdado depende do mesmo provider E modelo. Modelo próprio diferente,
sem effort próprio, usa o padrão daquele modelo; variante explicitamente
declarada continua intacta. Isso vale para agentes de qualquer CLI e não
reescreve estratégia salva ou plano. Agente sem configuração continua sendo
o builder completo; modelo igual conserva a herança anterior.

Chamadas OpenRouter via OpenCode recebem teto de saída por resposta, em vez
de reservar a capacidade máxima anunciada pelo modelo. Padrão 16.384 tokens;
OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX explícito do operador tem precedência
e deve ser inteiro positivo seguro. Não aplicar o padrão a outros providers,
não mudar o teto da API documental, não elevar limite da chave nem fazer
inferência paga para validar. Confirmar o parâmetro com a CLI instalada contra
servidor HTTP local sem credenciais reais; não basta observar o ambiente.
Na 2.0.32 instalada, a variável sozinha foi ignorada, enquanto o campo
provider.openrouter.models[id].limit.output alterou o parâmetro HTTP. Consultar
model.list com o mesmo ambiente, conservar context/input e limitar output ao
menor entre o teto e o limite declarado. Aplicar a sobreposição apenas no
ambiente da chamada; conservar as demais opções. Consulta/configuração inválida
impede inferência, sem fallback silencioso para os 256.000 tokens.

O parser do OpenCode reconhece eventos error separados de mensagens text e
preserva a causa legível sem republicar o corpo HTTP aninhado. Recusas
estruturadas de cota financeira (provider.quota/402) ou configuração
(provider.no-route) param a fase após a chamada, em executor, verificação e
reparo; não viram pedido para corrigir produto nem nova sessão automática.
429 mantém sua política de espera; texto semelhante numa mensagem normal do
modelo não classifica recusa. Mesmo com texto/marker anterior, um erro explícito
posterior não pode aprovar a chamada.

Análise de impacto: procurar consumidores de effort do pool, transcript,
BridgeResponse/EngineResult, G0 e classificação final. Um novo fato estruturado
de recusa decide parar em vez de tentar construir novamente; não muda contrato
de fases, hashes, caches ou gates de produto. Cobrir herança com modelo trocado,
modelo igual e effort explícito, teto/precedência/validação, parser com erro
após progresso, 402/no-route nos papéis e 429 separado. Regredir antes do reparo.

Validação: dez regressões de herança/parser/repetição falharam antes da correção.
Depois, 185 testes direcionados passaram. `npm run check` concluiu build,
typecheck e 2.321 testes em 121 arquivos; o binário instalado foi recompilado.
Também foi verificado que a estratégia real salva contém effort vazio para os
três agentes GLM: nenhuma edição desse arquivo é necessária.

Prova com OpenCode 2.0.32 real e a ponte completa contra servidor HTTP local:
Kimi K3 com none e GLM-5.3-prime com effort vazio enviaram
max_completion_tokens=16384, receberam PONG simulado e concluíram com código 0.
Nenhuma credencial real ou inferência paga foi usada. O teste de configuração
isolada também confirmou que options.maxTokens/maxOutputTokens não mudam esse
parâmetro; limit.output com o contexto preservado o modifica. A consulta de
metadados usa o mesmo supervisor para não reintroduzir processo órfão no
cancelamento. Não havia processos ativos da execução do usuário; seus logs,
estratégia, fontes publicadas e worktree não foram alterados ou retomados.

### §115.19 — Todos como o executor substitui os agentes salvos

O wizard gerava --parallel 3 sem --worker ao escolher todos como o executor.
O resolvedor tratava a ausência de workers como herdar os agentes do arquivo.
No teste_openrouter o builder era DeepSeek, mas os três agentes ficaram no
GLM-5.3-prime salvo, e calls.jsonl confirmou a chamada efetiva com GLM. O painel
mostrava corretamente a configuração errada que chegava ao executor.

A escolha de pool vazio no wizard deve viajar de forma explícita no comando
impresso/executado: --workers-as-builder. Essa flag limpa apenas os overrides
de agentes desta execução e exige modo paralelo, vindo de --parallel ou do
arquivo válido. Contradiz --worker e --serial; falha antes de chamar modelo.
Sem a nova flag, --parallel sozinho mantém a compatibilidade de herdar o pool
salvo. A versão do arquivo não muda: workers vazio já significa todos iguais
ao builder atual, inclusive em execuções futuras com outro modelo.

Com --save-execution a estratégia resolvida vazia substitui a salva; sem ele,
o arquivo anterior fica intacto e somente a execução atual usa o executor.
O mesmo caminho resolve rótulos do dashboard, snapshot dos papéis e chamadas.
Não corrigir apenas texto da UI nem modificar uma execução já aberta.

Análise de impacto: toArgv/renderCommand, parsing Commander, FlagsDeExecucao,
resolverEstrategia, prepararExecucao, persistência e papeisDosAgentes. Não
alterar escalonamento, gates, fases, hashes ou modelos por inferência. Regredir
antes da mudança com estratégia antiga, escolha todos, salvar/não salvar,
entrada digitada/seleção interativa, conflitos e preservação da opção manter
agentes salvos. Conferir a configuração efetiva usada pelo dashboard e bridge,
sem consumir API real.

Validação: oito regressões falharam antes do reparo. Depois, os 120 testes
direcionados passaram, incluindo comando gerado e parseado pelo Commander,
configuração dos três agentes, rótulos do dashboard e argumentos/ambiente
destinados à CLI. Salvar persiste workers vazio e herda um novo modelo na
próxima execução; não salvar conserva o arquivo antigo byte a byte. A seleção
interativa por teclado e a entrada numérica transmitem a mesma flag.

O binário real também foi executado em pasta descartável com pool antigo:
aceitou a flag e gravou workers vazio antes de parar por documentação ausente,
sem chamar modelo. `npm run check` concluiu build, typecheck e 2.329 testes em
121 arquivos. O binário instalado está recompilado. Nenhum processo, estratégia
salva ou trabalho parcial do teste_openrouter foi modificado; uma sessão já
iniciada continua com a configuração anterior até ser encerrada pelo usuário.

### §115.20 — Falha de teste na integração volta ao executor e ao validador

Na P01 do teste_openrouter, o verificador aprovou 14 tasks e G4 passou, mas
G2 integrado encontrou teste que exigia web/dist/index.html sem preparar o
build. A fundação já era exclusiva por não haver start; exclusividade foi
confundida com recuperação esgotada, parando na primeira integração reprovada.
O diagnóstico ainda perdia a saída real ao reduzir g2.cause à primeira linha.

Teste vermelho é entrada do ciclo de correção, não encerramento imediato.
Após rollback seguro de G2 integrado, reaplicar o parcial num worktree e pedir
ao validador somente-leitura causa, evidência, arquivo, ação concreta e comando
de regressão. Entregar esse diagnóstico junto à saída completa ao executor.
Se a correção não resolver, usar sessão de escrita do validador, seguida de
G2, nova sessão de G3 e G4; só integrar após repetir G2 na principal. Nunca
aprovar pelo relatório do reparador, copiar dist do worktree para ocultar o
defeito, remover teste ou afrouxar asserções.

A recuperação desta falha tardia tem uma devolução ao executor e o orçamento
configurado de reparos pelo verificador, compartilhado entre suas passagens.
Cada passagem executa uma correção e os gates; não renova três ciclos a cada
reintegração. Reparo já gasto em outro achado durante a construção não elimina
essa oportunidade para uma falha nova vista somente na integração. Com reparo
desligado ou provider apenas de leitura, não conceder escrita silenciosamente.
Timeout, recusa de provider, falta de ambiente irrecuperável, escrita na
principal ou falha de preservação continuam paradas técnicas, sem novas sessões.

Separar exclusividade de agendamento da recuperação por conflito/G2. Preservar
as regras existentes para conflitos de merge; ser fundação exclusiva não
impede devolver um teste reprovado. Cada recuperação possui prefixo próprio de
evidência, sem sobrescrever prompts/logs anteriores. Incluir a saída real na
causa final, e não apenas um caminho ou cabeçalho genérico.

Análise de impacto: integrarNaFila/desfazer, checkpoints de ambiente, preservação
do parcial, tasks aprovadas, rodar/runPhase, permissões da bridge e logs. O
validador escreve apenas no worktree e só na chamada repair=true. O integrador
continua a ser o único que altera a principal. Regredir antes do reparo com
fundação exclusiva, executor corrigindo, executor que só aquece artefato e
validador aplicando correção durável, orçamento compartilhado, erro persistente,
timeout/recusa, G3 independente depois de reparo e gates integrados obrigatórios.

Validação: com a classificação nova de G2 desligada, as seis regressões
originais falharam, inclusive a fundação exclusiva parando sem devolução.
Com o reparo, 134 testes direcionados passaram. A suíte final ampliada inclui
nove cenários novos com Git, worktrees, npm test e asserção reais: correção
durável pelo executor; executor que só aquece dist e reparo posterior pelo
validador; G2 local ainda vermelho e reparo sem nova integração; defeito
persistente; reparo desligado; timeout e cota recusada em diagnóstico e reparo.
Nos sucessos, houve novo G3 somente-leitura e G2 na principal. Nos fracassos,
o parcial ficou no branch, o HEAD integrado permaneceu na base e o orçamento
não foi renovado. O log do primeiro teste reprovado permaneceu intacto.

`npm run check` concluiu build, typecheck e 2.338 testes em 122 arquivos.
O binário instalado foi recompilado. Os testes usam modelos simulados e não
consomem API; o teste_openrouter não foi alterado ou retomado automaticamente.

### §115.21 — Recuperar protocolo de G3 sem reabrir construção ou perder convergência

No build-022eba66528c, P01 recebeu 14 declarações DONE, mas a primeira veio
com `DONE; risk noted: ...`. O parser estrito contou só 13 e parou. Antes disso,
um reparo deixou verificarTudo ligado para sempre: as verificações seguintes
ignoraram a memória das tasks aprovadas e encontraram outro achado a cada ciclo.

Saída de G3 com cobertura, índices ou formato inválidos recebe uma única nova
chamada somente-leitura do mesmo verificador, no mesmo ciclo e árvore. Manter
o parser estrito, os requisitos originais e a resposta bruta em logs distintos.
O prompt de recuperação inclui a resposta anterior como dado citado e o defeito
mecânico; cabe ao modelo decidir DONE ou INCOMPLETE pela evidência, sem apagar
um defeito material para satisfazer o formato. Não autorizar escrita, consumir
reparo nem enviar erro de protocolo ao executor como defeito do produto.

Se a segunda resposta continuar inválida, parar como falha da sessão do modelo,
sem abrir outro ciclo de construção. Timeout/recusa na recuperação conserva a
parada técnica. Uma resposta válida INCOMPLETE segue o ciclo normal de correção.
Após cada reparo, exigir uma avaliação independente completa; quando ela trouxer
um veredito estruturalmente válido, encerrar verificarTudo e guardar seus DONE.
As próximas verificações usam a memória novamente. Cada novo reparo revoga essa
memória e exige outra leitura completa; reaberturas explícitas continuam valendo.

Análise de impacto: gate3/parseVerification, prompts do verificador, chamarLeitor,
permissões e limites, logs por passagem, TasksAprovadas e naturezaDaFase. Não
alterar gramática das fases, hashes, critérios, gates de sucesso ou orçamento de
reparos. Regredir antes da mudança com DONE anotado, resposta ainda inválida,
achado real após recuperação, timeout/recusa e convergência após leitura completa.

Validação: onze regressões falharam antes do reparo. Depois, 210 testes
direcionados passaram, incluindo recuperação da integração com Git/worktrees
e testes reais. A suíte final cobre recuperação readonly no mesmo agente e
árvore, preservação dos dois logs, resposta ainda inválida sem novo builder,
achado material exigindo reparo, timeout/recusa/erro/resultado ausente, retorno
da memória após revisão completa (inclusive com recuperação de formato) e
classificação da parada sem interpretar o texto citado como diagnóstico válido.
O parser continua rejeitando DONE com anotação por ponto e vírgula.

`npm run check` concluiu build, typecheck e 2.355 testes em 122 arquivos.
O comando instalado aponta para o binário recompilado. Não houve consumo de
API nem alteração ou retomada automática do teste_openrouter.

### §115.22 — Retomada com arquivos versionados que passaram a ser ignorados

O erro de 01:07 UTC com 256.000 tokens é histórico anterior ao §115.18.
As retomadas de 03:40 e 03:41 UTC pararam antes de qualquer nova inferência:
guardarParcial falhou em git add. O HEAD já continha node_modules e dist;
o worktree gerou .gitignore e modificou arquivos nessas pastas. Git add -A
com caminhos literais explícitos recusou os diretórios agora ignorados, mesmo
com os arquivos já versionados. O erro ficou reduzido ao comando, sem stderr.

Preparar caminhos já presentes no índice selecionado com git add -u; preparar
os demais com git add -A, mantendo a lista literal e delimitada por NUL.
O índice selecionado é o temporário de commitAdmitido, nunca o índice do usuário
por inferência. Não usar -f: arquivo novo ignorado continua fora do commit,
inclusive quando outro índice já o preparou. Não remover pastas geradas ou
descartar alterações para destravar a retomada. Preservar admissão sobre os
objetos, índice temporário, compare-and-swap de HEAD e só sincronizar caminhos
publicados no índice do chamador. O modo -u da recuperação integrada permanece.

Análise de impacto: adicionarExatamente é compartilhado por commit inicial,
commit de fase, guarda do parcial e rollback integrado. Regredir com Git real,
arquivo versionado agora ignorado modificado/removido, fonte nova, outro arquivo
novo ignorado, nomes literais, índice do chamador independente e reabertura do
worktree interrompido sem integrar na principal. Nenhum requisito, gate, hash,
credencial ou limite financeiro muda. Validar sem inferência paga.

Validação: quatro regressões falharam antes do reparo; depois, 43 testes
direcionados passaram com Git real, inclusive admissão, autoridade e recuperação
da integração. Arquivos versionados agora ignorados foram atualizados/removidos,
fontes novas foram preservadas e outros arquivos ignorados não foram incluídos.
O parcial interrompido foi reaberto sem publicar na principal; o índice do
usuário continuou independente. `npm run check` concluiu build, typecheck e
2.360 testes em 122 arquivos. O binário instalado foi recompilado.

O log antigo de OpenCode foi relido pelo parser atual: reconheceu provider.quota
sem publicar o corpo HTTP ou o link privado da chave. Nova prova com a ponte
atual e a CLI real contra HTTP local confirmou max_completion_tokens=16384
para Kimi K3 e GLM-5.3-prime, com PONG simulado. Não houve inferência paga,
mudança na chave, alteração na principal ou retomada automática do teste real.

### §115.23 — Dependências locais ignoradas não são alterações do produto

P01 do teste_openrouter fechou e entrou em 6887d32: G2 integrado passou com
29 testes de servidor, 43 de interface e 6 de navegador. A instalação regravou
três metadados de compilação do better-sqlite3 e Vitest regravou seu cache.
Os quatro estavam versionados desde o commit inicial, apesar de node_modules
agora constar do .gitignore. §102 parou o build por essas alterações locais.

Tratar arquivos dentro de diretórios node_modules ignorados pela política Git
atual como ambiente local também em repositórios legados que os versionaram.
Conferir com check-ignore --no-index, respeitando exceções explícitas. Aplicar
o mesmo recorte a preflight, seleção de commits/parciais, conferência da
principal e verificação depois da integração. Não apagar/restaurar arquivos,
não esconder flags no índice, não retirar arquivos do histórico ou criar
commits com tempos de teste e caminhos absolutos da instalação. O status bruto
do Git continua disponível; anunciar essa condição na retomada e na integração.

Isto não se aplica a fontes, manifestos, lockfiles, snapshots fora de
node_modules, dist ou dependência explicitamente mantida fora do ignore.
Alterações nesses arquivos continuam barrando a integração como em §102.
Na criação de repositório pelo harness, acrescentar node_modules/ ao exclude
local de Git antes do commit inicial; não escrever/sobrescrever o .gitignore
do produto. Regras explícitas do projeto continuam tendo precedência.

Análise de impacto: lerStatus permanece bruto; alteracoesParaCommit concentra
o recorte do produto e alimenta isClean, commits, guarda do parcial e situação
da principal. As três leituras de isolamento no paralelo usam esse mesmo
recorte. treeSignature continua sendo sinal amplo, sem poder de aprovação.
Admissão dos objetos, refs, G2/G3/G4, ledger e hashes do plano não mudam.
Regredir antes do reparo com cache versionado ignorado, continuidade da fase
seguinte, retomada já suja somente por dependências, commit sem esses deltas,
Git inicial sem ignore, exceção explícita e fonte alterada ainda bloqueada.

Validação: onze regressões falharam antes do reparo. Depois, 84 testes
direcionados passaram, incluindo duas integrações sucessivas com caches
versionados, conferência da principal, índice do usuário preservado e §102
continuando a parar quando a suíte altera código. A suíte ampliada verifica
nomes literais com espaços/curingas/quebras e a precedência da exceção explícita
do projeto sobre o exclude local do repositório criado pelo harness.

`npm run check` concluiu build, typecheck e 2.373 testes em 123 arquivos.
O comando instalado foi recompilado. Conferência somente-leitura no projeto
real confirmou isClean=true para o produto, os quatro deltas de Git intactos,
HEAD inalterado em 6887d32 e P01 fechada com o hash do plano atual. Não houve
alteração de arquivos do projeto, descarte, commit, mudança de índice por
configuração oculta, chamada de modelo ou retomada automática do teste real.

### §115.24 — Aprovação pelo funcionamento e custo proporcional de verificação

Direção explícita do usuário: cada devolução custa tempo e dinheiro. As
verificações devem demonstrar que a aplicação funciona, sem bloquear por
preferências internas, testes redundantes ou expectativa errada de roteiro.
Esta orientação substitui a reprovação automática por dúvida do verificador.

G3 bloqueia por funcionalidade exigida ausente, comportamento incorreto,
falha de persistência/validação/segurança ou requisito operacional não entregue,
com evidência concreta. Julgar a URL final após o cliente compartilhado, não
um fragmento isolado; aceitar implementação equivalente. Nome de teste, pasta,
camada preferida, asserção adicional e robustez hipotética não justificam retorno
quando o comportamento já está demonstrado. Usar DONE — ADVISORY: <observação>
para essas sugestões: formato já aceito pelo parser. O Core anuncia e preserva
essas observações sem sessão extra, reparo ou devolução. Não converter INCOMPLETE
em DONE por heurística textual; defeito material continua vermelho. Ausência
de evidência sobre função essencial exige investigação, não aprovação cega.

Executor e reparador usam regressões focadas durante as mudanças. O Core
continua rodando a suíte completa independentemente em G2 e após integração.
Não exigir da sessão uma nova suíte completa só para repetir o que acabou de
passar, nem e2e separado se o mesmo comando já o executou. Preservar cenários
de falha reais; corrigir teste acoplado à implementação para verificar o mesmo
comportamento público é permitido, mas remover/ignorar caso ou esconder erro não.

G4: estado transitório pode terminar antes de page.goto voltar; nunca exigir
atraso artificial no produto para satisfazer o teste. Preparar a observação no
roteiro antes da ação; se a resposta rápida impedir provar o estado pendente,
verificar esse estado em teste focado controlado e manter no fluxo real a
verificação do resultado final, sem simular sucesso do backend. A triagem deve
classificar a expectativa temporal incorreta como ROTEIRO, não PRODUTO.

Corrigir até dois achados distintos de roteiro na mesma passagem sem consumir
ciclo do executor, com limite fechado e sem repetir a mesma correção. Se o
roteiro continuar errado, parar como falha do harness preservando a evidência,
sem mandar o executor mudar produto correto. PRODUTO mantém reparo e gates;
CRITERIO mantém a decisão registrada. Não ignorar G2 vermelho, retirar G4,
aprovar placeholders, alterar critérios publicados ou renovar orçamentos.

Análise de impacto: prompts de construção/reparo/G3/roteiro/triagem, memória
DONE, parser TASK existente, retorno de gate4 e falhaDoRoteiro. Gates funcionais,
isolamento de fonte e Git, admissões, hashes, fases publicadas e credenciais
continuam. Regredir antes da mudança com observação sem novo modelo, observação
ao lado de defeito real, dois erros distintos de roteiro, erro persistente sem
novo builder, e cobertura das regras funcionais e de economia nos prompts.
Execuções em andamento conservam o código que já carregaram; não interrompê-las.

Complemento explícito do usuário: economizar tempo/dinheiro é prioridade e
todo retorno à construção precisa de causa clara e justificável. Ampliar o
recorte de ambiente para saídas geradas que a política Git manda ignorar:
dist, build, coverage, caches, relatórios de navegador e saídas compiladas
comuns; fontes, manifestos, lockfiles, bancos e diretórios não ignorados ficam
protegidos. O status bruto e os bytes locais permanecem intactos. O roteiro
gerado é responsabilidade da Capivara: gerar, executar e corrigir com o erro
real antes de culpar o produto. Falha persistente classificada como ROTEIRO
nunca autoriza retorno ao executor. Registrar a causa completa de um retorno
real à construção e não anunciar retry quando o orçamento já acabou.

Validação intermediária: 206 testes direcionados passaram. O check completo
passou build/typecheck e 2.398 testes, mas revelou uma regressão na recuperação
de um dist versionado agora ignorado: o recorte de produto não pode descartar
bytes de uma árvore interrompida. Preservar esses artefatos localmente antes
de recriar o worktree, sem incorporá-los ao commit do produto.

### §115.25 — Ambiente aprovado antes de construir e contrato entregue ao G4

Direção do usuário: o planejamento discrimina os pré-requisitos de execução;
o build verifica e resolve o ambiente antes de iniciar desenvolvimento. A
aprovação vale para esta execução: não repetir sondas de runtime/addons por
fase, ciclo, cópia de worktree ou integração. Manifesto novo e migração nova
exigem materialização do código entregue, não uma nova aprovação de ambiente.
Falha de preparo para antes da construção, sem gastar ciclo de implementação.

O esqueleto pode declarar environment: lista de technology, binary,
systemLevel, checkArgs e installHint. checkArgs é uma lista de argumentos de
uma sonda finita de prontidão (versão/serviço), executada sem shell, nunca a
suíte do produto. O plan publica environment.json com a identidade do
skeleton.md e os requisitos declarados, complementados pelo catálogo legado.
Sem o campo, planos anteriores continuam usando o catálogo; documento novo
inválido ou de outro esqueleto é erro antes do executor. A ausência não deve
ser tratada como aprovação das tecnologias desconhecidas. Não inventar versões
ou serviços não escolhidos; não incluir código futuro nas sondas de ambiente.

O Core prepara dependências já declaradas antes da primeira fase e registra
a evidência e a aprovação no run. Worktrees recebem cópias independentes da
instalação aprovada. Durante desenvolvimento compara-se apenas a identidade
de manifesto/lockfile/runtime para materializar uma alteração efetiva, sem
reexecutar sondas de prontidão. Erro concreto do loader ainda permite reparar
a instalação: não é pretexto para repetir testes preventivos nem reconstruir
produto aprovado. Não remover testes funcionais, migrações do produto ou a
verificação do comportamento em uma cópia limpa.

No teste real, skeleton.md já declarava /api/tarefas e P01 a base /api, mas o
autor de G4 recebia apenas os passos do workflow. Entregar diretamente stack,
regras compartilhadas e critérios da fase tanto ao roteirista quanto à
triagem. O plano declara caminhos de navegação, endpoints completos, métodos,
formato de resposta e composição da base do cliente nas regras transversais;
não deduzir endpoint pelo nome da tela. O roteiro observa exatamente método e
pathname da API e exclui navegação HTML antes de chamar json(). A evidência
do contrato fica junto do prompt de cada chamada, sem nova sessão só para
redescobrir informação que o plano já tem.

O navegador do harness também é pré-requisito: com G4 real habilitado, preparar
@playwright/test e Chromium e provar abertura/fechamento headless antes do
executor. Reusar a instalação do projeto quando existe; caso contrário usar
.capivara/node_modules, sem alterar manifesto ou lockfile do produto. Copiar
essa ferramenta para os worktrees e resolver seu CLI explicitamente, sem
instalação implícita durante G4. Runner de navegador injetado nos testes
dispensa essa preparação real. Nova versão de ferramenta é alteração efetiva
de dependência, não motivo para repetir sondas sem mudança.

Evidência adicional do run atual: P02 passou G4 no worktree, mas G2 da
integração recebeu 404 e ECONNREFUSED e o servidor registrou EADDRINUSE na
porta 3100. O próprio playwright.config.ts aceita E2E_PORT; sessões paralelas
não recebiam valores diferentes. Alocar porta efêmera por processo de suíte
e por chamada de agente, passando E2E_PORT no ambiente privado sem mutar
process.env global. O plano e os prompts indicam essa variável para os testes
do projeto, sem portas fixas compartilhadas. Alocação de recurso não é nova
sonda de prontidão. Regredir com dois processos reais concorrentes e servidor
alheio intacto, sem API de modelo.

Análise de impacto: leitura/renderização do esqueleto e cache entre init/plan,
publicação de metadado de ambiente, preflight e instalação inicial, propagação
de aprovação para serial/paralelo/worktree, prompts de fases/G4/triagem. Sem
alterar gramática de fases, hashes de fases existentes, ledger ou autoridade
Git. Regressões antes dos reparos: prontidão falha com binário presente,
requisito desconhecido declarado, instalação antes de qualquer builder,
falha de preparo com zero builders, sonda de addon somente no início,
contrato com /api explícito no prompt real do G4 e na triagem.

Validação final de §115.24–25: regressões de prontidão, publicação do plan,
repasse do contrato, recuperação de artefato local e concorrência falharam
antes dos respectivos reparos. Os 141 testes direcionados finais passaram,
inclusive catálogo completo init → build com provider falso. As quatro
chamadas de construção/G3/roteiro/triagem recebem a mesma regra concreta de
API sem uma sessão extra para redescobri-la. Sondas declaradas rodam antes
das fases, falha de instalação tem zero builders, e dois processos de teste
usam portas diferentes preservando um servidor alheio e process.env.

O primeiro check amplo encontrou perda do dist local na retomada; reparada
com cópia comprovada fora do commit de produto. Um check seguinte encontrou
variáveis parciais eliminando PATH; reparado preservando o ambiente herdado.
O check final concluiu build, typecheck e **2.415 testes em 125 arquivos**.
O executável instalado aponta para o bundle recompilado. Validação somente
local, sem inferência paga, alteração do projeto real ou retomada automática
da execução que o usuário já havia iniciado.

### §115.26 — Capivara 0.5.0: ruptura explícita do planejamento anterior

O usuário revogou expressamente a compatibilidade mantida em §115.25: planos
anteriores não devem ser executados pela nova versão. Subir root/workspace,
lockfile e binário de 0.4.0 para 0.5.0. Não publicar pacote nem alterar projetos
reais para fazer essa atualização local.

O novo esqueleto usa capivara-skeleton/v2 e exige environment, inclusive lista
vazia quando não há pré-requisito externo. Não aceitar v1, preencher requisito
por catálogo legado nem converter um esqueleto antigo silenciosamente.
O plan publica environment.json capivara-environment/v2 somente após RALPH
READY, vinculando os bytes de skeleton.md e project-phases.md e a geração
capivara-planning/v2. A versão do executável é registrada para diagnóstico;
compatibilidade é decidida pela geração do contrato, não por futuras correções
patch do binário. Ausência, formato antigo ou hash divergente bloqueiam o
build antes de Git, instalação, navegador e qualquer chamada de modelo.

Mensagem de bloqueio orienta gerar novamente com capivara init --fresh e
capivara plan --fresh, preservando código, dados, arquivos e evidências do
projeto. Flags de Git, flows, retomada e rebuild não dispensam o contrato.
plan/change também recusam esqueleto antigo antes de inferência; change de
plano atual renova os metadados depois de publicar sua alteração aprovada.

Separar a identidade de runs init/plan/build por capivara-planning/v2; a de
survey não muda. O cache de fases planejadas e as chaves de aprovação de
auditoria e ledger usam a nova geração. Nenhum verde anterior autoriza pular
fase do plano novo, mesmo que o texto da fase seja idêntico. Arquivos antigos
ficam no disco, sem limpeza destrutiva nem migração implícita de aprovação.

Análise de impacto: parser/prompts do esqueleto e estado entre init/plan;
publicação final, preflight e entrada do build; change; identidades dos runs,
cache de planejamento, autoridade auditada e ledger. A gramática das tasks
continua a mesma e não ganha parser paralelo. Atualizar fixtures para planos
atuais completos; manter fixtures antigas explícitas nos testes de rejeição.
Regredir antes da mudança com ausência e v1 de metadado, plano alterado sem
novo metadado, v1 de esqueleto, plan/change antigos com zero chamadas de
modelo e caches antigos não reaproveitados. Conferir versões sincronizadas,
check completo e capivara --version após recompilar, sem inferência paga.

Validação: seis regressões falharam antes da implementação. A cobertura final
inclui treze cenários da ruptura: ausência/v1 de metadado, plano/esqueleto
divergente, geração errada, JSON inválido, esqueleto v1 ou sem environment,
plan/change sem inferência, bloqueio antes de criar Git e isolamento das
identidades de runs, ledger e cache. O change atual renova o metadado e
preserva as chaves das fases que não mudou dentro desta geração.

O check completo concluiu build, typecheck e **2.428 testes em 126 arquivos**.
O único ajuste depois do primeiro check foi atualizar uma expectativa de
cache v1 para v2, reforçar o caso de contrato desconhecido e conferir o relato
do metadado escrito pelo change. Root, workspace e lockfile estão em 0.5.0;
o executável instalado foi recompilado e `capivara --version` confirmou 0.5.0.
Não houve inferência paga, publicação remota, alteração nem reinício de projeto
real. Código, dados e evidências antigos foram preservados.

### §115.27 — Linhas em branco não encerram uma task

No teste_openrouter, as sete tasks da fase 5 já declaravam critérios e Traces.
O parser encerrava a task na primeira linha em branco entre o título e os
campos, gerando quatorze I-08/I-09 falsos, duas reescritas e um impasse indevido.
Espaçamento em Markdown não é ausência de requisito nem decisão do usuário.

O parser único deve ignorar linhas vazias, inclusive com espaços e tabs, dentro
da task. Seus campos continuam associados até a próxima task ou um heading que
encerre o bloco. Não inventar critérios, copiar Traces de outra task, remover
texto nem dispensar I-08/I-09 quando os campos realmente estiverem ausentes.

Análise de impacto: parsePhases serve init/plan, auditoria mecânica, ensaio,
change e build; corrigir nessa autoridade, sem parser paralelo. O cache guarda
Markdown e o caminho de retomada usa o mesmo parser: preservá-lo, sem mudar
prompts ou chaves e sem invalidar fases e aprovações já pagas. A normalização
existente de listas de Feature tests continua preservando todos os testes.

Antes do reparo, regredir leitura com linhas vazias entre título, rótulos e
itens, preservação dos campos, isolamento entre tasks e rejeição de campos
realmente ausentes. Conferir também montagem após extractTasks e retomada de
fase em cache. Reproduzir a resposta real localmente, sem inferência nem escrita
no projeto em execução, e recompilar o executável instalado.

Validação: oito regressões falharam antes do reparo e passaram depois. O check
completo passou com build, typecheck e **2.436 testes em 126 arquivos**. As três
respostas reais da fase 5 passam na leitura corrigida com sete tasks e vinte
critérios cada. As cinco fases em cache (46 tasks) também passam no parser,
sem alterar os bytes do cache. O binário instalado foi recompilado em 0.5.0;
retomar com capivara plan, sem --fresh, mantém o trabalho já escrito. A sessão
que estava aberta precisa ser encerrada para carregar o parser novo. Nenhuma
inferência paga, publicação ou alteração no projeto real foi feita.

### §115.28 — Caminhos absolutos e reparo específico do navegador no preflight

O build real recebeu projectRoot relativo. O preflight instalou Playwright na
pasta privada, mas passou `.capivara/node_modules/@playwright/test` a require,
que o tratou como nome de pacote. Essa falha de resolução disparou indevidamente
install --with-deps, atingindo uma pendência de configuração do dpkg. O runner
do G4 também compunha CLI relativo e depois mudava o cwd para .capivara/flows.

Resolver projectRoot para absoluto antes de construir caminhos da sonda e do
CLI do G4. Manter a prioridade da ferramenta privada e usar a mesma instalação
para sonda, download e execução. Não alterar manifesto nem lockfile do produto.
Falha de inicialização não autoriza instalar pacotes do sistema indiscriminados:
download Chromium somente para executável ausente; bibliotecas do sistema só
para diagnóstico explícito de dependência ausente e com systemInstall. Após
download bem-sucedido, sondar novamente; se faltarem bibliotecas, permitir uma
instalação específica delas e uma última sonda. Falha de módulo/código ou erro
desconhecido deve preservar o diagnóstico sem invocar apt/dpkg ou reinstalar.

Análise de impacto: preparo antes da primeira fase, comandos shell e quoting,
CLI executado no cwd dos roteiros, classificação e evidência da parada. Falha
desse preparo é ambiente, não falta de decisão do operador; manter zero sessões
de modelo e apontar environment-preflight.log. Não mudar identidade do plano,
cache ou aprovações. Testar caminhos relativos com espaço/apóstrofo executando
uma sonda real com pacote simulado, CLI real simulado a partir de cwd diferente,
download necessário, dependência ausente com/sem permissão e erro de módulo sem
instalação. Validar falha antes do reparo, recompilar e executar o check completo.

Validação: oito casos falharam antes do reparo; os 114 testes direcionados de
ambiente, parada e fluxos passaram depois. O check completo concluiu build,
typecheck e **2.444 testes em 126 arquivos**. Uma reprodução isolada com raiz
`.` e Node v25.9.0 usou o Playwright real já instalado em teste_openrouter:
Chromium abriu e fechou com uma sonda, sem instalar pacotes ou chamar modelos.
O projeto real, seus planos e caches foram preservados. O executável instalado
aponta para o bundle recompilado em 0.5.0; retomar com capivara build, sem
regenerar o planejamento. A pendência externa de configuração do dpkg não foi
alterada nem necessária para essa checagem bem-sucedida do navegador.

### §115.29 — Banco descartável no G2 e reversão que preserva saídas ignoradas

No build-c9958d3f064e, a migração executada pelo harness criou
server/data/app.db na principal. Um teste exigia ausência desse arquivo e
reprovou a integração. O reset --keep retirou o .gitignore recém-integrado,
mas deixou o banco, antes ignorado. A guarda então o tratou como escrita externa
e a tela chamou o banco de sensível e afirmou que os gates haviam passado.

Migração e G2 devem receber o mesmo banco temporário por passagem, por chaves
de arquivo declaradas em .env.example/.env, tanto no runner serial/worktree
quanto na suíte integrada. Não trocar process.env global, apagar banco local,
instalar ambiente outra vez nem dispensar validação funcional. Descartar apenas
o diretório temporário pertencente à passagem, inclusive na falha. Continuar
sem migrar .env pertencente ao usuário. O executor e o verificador recebem a
regra: testes usam dados próprios e não exigem que banco/cache local preexistente
esteja ausente; verificam que não o alteraram.

A reversão deve preservar fora do Git, com prova de conteúdo, bancos de arquivo
declarados e seus journals que ficarem expostos depois do retorno ao HEAD antigo,
somente quando não constavam dos não versionados anteriores. Arquivos anteriores
e dados fora da raiz não são removidos. Não ignorar todo .db globalmente nem
enfraquecer a guarda de fontes e referências. Essa preservação de saída local
não é um motivo para reconstruir uma fase; registrar o destino da recuperação.

Análise de impacto: TestRunner aceita ambiente opcional por processo; runner
compartilha-o entre migração e G2, inclusive reparos; integrador faz o mesmo e
limpa na saída; reset rápido e caminho de recuperação completo cobrem a mudança
de .gitignore. Bloqueio de isolamento tem mensagem própria, sem afirmar gates
verdes ou arquivo sensível e sem mandar git add -A. Manter os bloqueios reais
de segredo, escrita externa em fonte e movimentação de referências.

Regredir antes do reparo com migração/teste em banco temporário, duas passagens
isoladas, dados locais preservados, reversão expondo banco ignorado e próximo
executor alcançado após G2 reprovado; testar diagnóstico de isolamento. Conferir
check completo e binário recompilado. No projeto afetado, preservar com hash o
banco vazio criado pelo harness em recuperação local, sem alterar commits ou
chamar modelos, para que a retomada não carregue esse efeito da execução antiga.

Validação: quatro regressões reproduziram a falha antes do reparo. A cobertura
adicionada tem seis cenários: banco privado na fase, integração inicial e sua
recuperação após suíte reprovada, rollback expondo banco ignorado, preservação
de dados anteriores/fontes externas e diagnóstico de isolamento. Os testes
direcionados passaram; o check completo concluiu build, typecheck e **2.450
testes em 126 arquivos**. Executável instalado recompilado em 0.5.0.

O commit real aprovado d9da09687093 foi extraído para diretório temporário,
com dependências copiadas e Node v25.9.0. Sem alterar código, migrando no banco
privado e rodando npm test: **25 testes do backend e 47 do frontend passaram**,
sem criar server/data/app.db na árvore. A cópia temporária foi removida.
Nenhuma inferência paga ou instalação foi necessária para essa prova.

Na execução real pausada, o banco residual tinha as três tabelas vazias e
nenhum processo o mantinha aberto. Foi copiado com prova SHA256 e removido
da posição residual, preservado em
.capivara/runs/build-c9958d3f064e/recovery/harness-database-a949e3ccf4bd/server/data/app.db,
com manifest.json contendo origem, hash e evidência da migração. Código,
planos, credenciais e referências Git não foram alterados. Retomar o build
sem --fresh; não é necessário o commit manual recomendado pela tela antiga.

### §115.30 — A suíte integrada não escreve na árvore principal

A P02 deixou .env.backup-teste-3236491 na principal: o teste fazia backup de
.env e chamava statSync de um banco ausente antes do try/finally. O G2 chamou
esse ENOENT de runner ausente. A reversão não retirou o backup, e a guarda
impediu o executor de receber a correção. O .env também ficou modificado pelo
teste. Conter só o banco (§115.29) não continha os demais efeitos da suíte.

O integrador valida o HEAD recém-integrado numa cópia de trabalho destacada,
fora da árvore principal e do diretório que a suíte descobre como projeto.
Reutilizar por cópia as dependências já preparadas, inclusive dos workspaces,
sem instalar novamente por causa desse isolamento. Sem links de dependências
para a principal. Configuração de teste é semeada do exemplo público na cópia;
migração e G2 compartilham os bancos temporários já definidos. Arquivos de
execução anteriores, ignorados e bancos do usuário não são copiados como código.
O .env da validação é semeado do exemplo público; não copiar credenciais reais
nem seus caminhos absolutos de banco para um teste que pode remover overrides.

Se a suíte deixar arquivos, copiar com hash os não versionados novos e versões
alteradas da configuração para recuperação local fora do Git antes de retirar
o checkout de validação. Não publicar nem imprimir conteúdo de .env/backups.
Alteração de fonte versionada na cópia reprova a validação: o verde não pode
aprovar uma árvore diferente do commit integrado. Preservar essas alterações
para diagnóstico, desfazer a integração reprovada e encaminhar a causa real ao
executor/validador pelo orçamento existente. A guarda da principal continua
detectando escritas externas; não liberar .env* globalmente nem arquivos reais.

ENOENT ao abrir/stat de um dado dentro de uma suíte já iniciada é falha de
teste, não falta do runner. Classificar ferramenta ausente somente por código
127 ou diagnóstico de lançamento/shell inequívoco, e nunca em comando verde.
Orientar os papéis a aceitar a ausência no snapshot de arquivo opcional e a
envolver toda preparação em try/finally, inclusive backup e snapshot.

Análise de impacto: fila de integração, cópias de dependências/cache, ambiente
de teste, evidências de G2, preservação do checkout e reversão, mocks que antes
dependiam de escrever na principal e classificação do gate. A suíte ainda
valida a combinação exata de commits integrados; não há nova sessão de modelo
nem repetição extra da suíte. Não alterar geração de plano ou ledger.
Regredir ENOENT de arquivo versus shell ausente, teste que altera .env e deixa
backup antes de falhar, retorno ao executor, preservação de evidência e detecção
de fonte alterada. No projeto real pausado, guardar com hash ambos os .env e
o backup; restaurar somente a cópia original comprovada do harness, preservando
P01 e os branches da P02. Não executar modelos ou reconstruir P01.

Validação: três cenários reproduziram o defeito antes da correção. Foram
adicionadas quatro regressões e ampliado o cenário de recuperação da integração
para deixar backup e .env adulterado. Os 104 testes direcionados passaram.
O primeiro check amplo encontrou somente uma expectativa antiga de semear .env
na principal; atualizada exclusivamente no cenário paralelo. O check final
concluiu build, typecheck e **2.454 testes em 126 arquivos**. Binário instalado
recompilado, mantendo versão 0.5.0 e geração do planejamento.

O teste real defeituoso da P02 foi reproduzido no checkout isolado: ENOENT
correto, backup preservado fora do Git e configuração da principal intacta.
Na cópia local do parcial, corrigidos somente server/testes/banco.test.ts e
server/testes/apoio/env-raiz.ts: snapshot nulo para arquivo ausente, toda a
preparação protegida pelo finally, nenhuma troca de journal no banco original
e restauração de .env a partir de bytes em memória, sem backup solto na raiz.
O npm test real passou com **50 testes de backend e 59 de frontend**. Um segundo
cenário focado passou nove testes com SQLite preexistente contendo dados,
preservando bytes e mtime. Não houve inferência paga nem instalação.

O .env original foi reconhecido pelo backup ser byte a byte a marca do harness
mais o .env.example atual. Ambas as versões foram guardadas com SHA256 em
.capivara/runs/build-c9958d3f064e/recovery/env-test-0dfd9f79108c; a versão original
foi restaurada e o backup residual retirado da raiz. O commit local 739c71d52801
com os dois testes corrigidos foi colocado no branch parcial da P02 para ser
reaplicado e revalidado na retomada. O parcial antigo 6c785fd e o aprovado
anterior 79121c0 continuam referenciados. HEAD a44fb287aba6, P01, plano e ledger
não foram alterados; P02 não foi marcada como concluída. Cópias temporárias
retiradas após a transferência dos objetos e a preservação das evidências.

### §115.31 — Revisões do G4 têm escopo definido e chamadas proporcionais

Na P02, o produto já tinha nove tasks aprovadas, mas uma correção de seletor
virou mais de 27 minutos de sondas de Playwright dentro da sessão do roteirista.
O limite de duas reescritas não limitava o trabalho dentro de cada chamada.
Além disso, OpenCode 2 não lê OPENCODE_PERMISSION: somente a variável antiga
estava sendo definida, e o papel anunciado como leitor escreveu arquivos e
executou comandos. A CLI local confirmou config.get lendo permission de
OPENCODE_CONFIG_CONTENT sem nenhuma inferência.

Roteirista e triagem continuam usando o modelo do verificador, mas a chamada
declara sua finalidade: flow-author ou flow-triage. A finalidade serve para
identificar o trabalho e suas permissões; não reduz o tempo configurado da
sessão. Os cortes de cinco/dois minutos inicialmente implementados foram
retirados por decisão do usuário (§115.32). Não reduzir o tempo de implementação,
verificação normal ou reparo do verificador.
Timeout/recusa dessas sessões é falha técnica, não defeito do produto: preservar
evidência e parcial, sem repetir o roteiro antigo, gerar outro rascunho por
timeout ou gastar outro ciclo de construção.

OpenCode recebe as permissões na configuração que a versão 2 realmente lê,
preservando provider/modelos/limites e outras opções. Manter a variável antiga
para compatibilidade. Leitores negam por padrão, permitem somente leitura e
busca de arquivos, e não recebem shell, escrita, subagentes ou MCP arbitrários.
Executor e reparo explícito mantêm seu acesso de execução já autorizado.
Configuração inline inválida falha antes de chamar o modelo, sem expor conteúdo.

O prompt distingue trabalho da sessão e código do roteiro: o autor lê fontes e
devolve texto; quem sobe servidor, executa testes e instala ferramentas é o
harness. Uma correção recebe o roteiro existente inteiro mais o diagnóstico,
preserva os passos e asserções válidos e não reinicia a investigação. A triagem
usa evidências fornecidas e fontes, sem executar sondas. Especificar que cada
seletor pertence à sua região real, sem forçar links de navegação para main.

Painel, atividade e calls.jsonl distinguem roteirista G4 de triagem G4; salvar
o prompt antes de aguardar a resposta e registrar início e fim
da revisão, inclusive falha técnica. Não alterar geração do plano, identidade
dos roteiros, caches ou aprovações. Não interferir numa execução já aberta.

Análise de impacto: EngineCall → ponte do CLI → limites do supervisor e invocação
OpenCode; papéis documentais irmãos; cache de modelos/limite OpenRouter;
G4 autor/triagem e propagação G0; prompts e logs anteriores à resposta; painel
e eventos serial/paralelo. Regressões antes do reparo: permissão efetiva na
configuração, preservação de opções, limites configurados preservados, roteiro
anterior no prompt e timeout de autor/triagem sem outro executor nem runner.

Escopo do G4: somente os fluxos atribuídos à fase e regressões já entregues,
com resultados observáveis que os passos/critérios publicados exigem. O
contrato global informa fatos e URLs; não autoriza cobrar funcionalidades de
fases futuras. Não converter cada detalhe visual, mensagem intermediária,
estrutura DOM ou convenção interna numa nova condição de aceite. Não duplicar
testes de unidade, ambiente ou casos de borda já cobertos quando o fluxo pede
apenas a operação normal. Uma falha precisa apontar o passo/critério realmente
não atendido; expectativa inventada é ROTEIRO. Conferir antes do navegador que
há somente um caso de teste por fluxo e exatamente os passos declarados, sem
cenários extras. Correções preservam a cobertura exigida e não abrem nova
campanha de testes. Manter casos de borda e verificações de segurança quando
expressamente requeridos pelo fluxo/critérios, sem dispensar funcionalidade.

Para uma correção pontual, a triagem pode devolver CAPIVARA_PATCH com JSON de
before/after literais. Somente ROTEIRO pode fornecer esse patch. O Core aplica
quando before não vazio ocorre exatamente uma vez no roteiro e a substituição
mantém a conferência estrutural; o restante do arquivo permanece idêntico. Isso
economiza a chamada ao roteirista. Patch inválido, ambíguo ou inaplicável não
altera o roteiro e usa a reescrita limitada existente, sem nova investigação.
Guardar o patch no log da triagem, anunciar a aplicação e manter os dois limites
de correções distintas e de estrutura, sem afrouxar os critérios funcionais.

Validação: onze casos falharam antes das correções de finalidade, permissões,
prompt, escopo e timeout. A regressão do patch reproduziu a chamada redundante
ao roteirista; cobertura adicional confirma fallback sem alterar o roteiro em
substituição ambígua ou fora da estrutura contratada. Os 251 testes direcionados
passaram; npm run check concluiu build, tipos e **2.468 testes em 126 arquivos**
em 116,53s de suíte. Mantida versão 0.5.0, sem invalidar planos ou fases aprovadas.

A CLI OpenCode 2 instalada confirmou config.get em HOME/config/cache privados:
somente OPENCODE_PERMISSION produziu zero regras; o adaptador corrigido forneceu
nove regras efetivas para leitura e uma para execução. Nenhuma inferência foi
feita nessas consultas. O executável instalado aponta para o bundle recompilado;
nenhuma execução real foi iniciada, cancelada ou reiniciada pelo reparo, e não
houve consumo de API paga. A conclusão do projeto real continua dependendo da
retomada do build; esta validação prova a contenção e o fluxo do harness.

### §115.32 — Eficiência do G4 não é um corte de sessão aos cinco minutos

O usuário rejeitou expressamente encerrar o roteirista aos cinco minutos: isso
troca uma espera por outra parada e não resolve o desperdício. Retirar o teto
especial de autoria/triagem introduzido no §115.31, inclusive dos anúncios,
painel e metadados. Identificar a finalidade sem usá-la para encurtar a sessão.
Preservar a política geral de supervisão já configurada e o tratamento de uma
falha técnica real, sem atribuí-la ao produto nem abrir outra construção.

A redução de custo vem das correções de causa mantidas: impedir comandos e
escritas no leitor, limitar roteiros ao que foi entregue, não acrescentar
cenários, fornecer o roteiro anterior e o diagnóstico exato, aplicar patch
literal seguro sem outra reescrita e reaproveitar os roteiros válidos.

Análise de impacto: FLOW_REVIEWS continua metadado de papel para EngineCall,
ponte, painel e eventos; deixa de ser uma política de tempo. limitsFor recebe
somente a invocação e os limites configurados. calls.jsonl registra o mesmo
limite que o supervisor usa. Documentação não anuncia mais cortes 300s/120s.
Regredir pela ponte real de chamadas com supervisor simulado: ambos os papéis
mantêm os limites informados e preservam zero (desligado), tanto em CLI que
transmite quanto em CLI que responde só no fim. Não fazer inferências pagas.

Validação: os dois casos pela ponte falharam antes do reparo porque o supervisor
recebia 300s mesmo com o limite geral desligado. Após remover a política especial,
ambos os papéis preservam 0, 900 e 3600s, com a adaptação de primeira saída/idle
normal para CLI sem streaming. Os 251 testes direcionados passaram, incluindo
permissões, patch sem nova chamada, escopo e falha técnica sem reconstrução.
O check completo passou build, tipos e **2.468 testes em 126 arquivos**, em
157,66s de suíte. Bundle instalado recompilado em 0.5.0 e conferido: finalidade
não carrega mais wallSeconds; supervisão mantém os valores configurados e o
leitor mantém suas permissões. Nenhuma chamada paga ou execução real iniciada.

### §115.33 — Correções do roteiro por passo e identidade exata dos itens

Na P03 de teste_openrouter, o produto teve as nove tasks aprovadas. A primeira
correção preparou os dados inexistentes no banco descartável; a segunda tentou
desambiguar nomes por prefixo e introduziu regex ancorado no texto inteiro de
um item que também contém cor e data. A terceira triagem já entregava o patch
correto, mas o teto global de duas correções descartou essa resposta e parou.

O orçamento de reparo do roteiro pertence ao passo que falhou, identificado
pelo workflow e pelo passo declarado no erro do Playwright. Até duas correções
por passo, sem reiniciar o orçamento de um mesmo passo por alterar mensagem,
linha ou redação da triagem. Passos diferentes não consomem a possibilidade de
corrigir aquele que a passagem acaba de alcançar. Sem passo reconhecido,
continuar com a janela conservadora de duas por fluxo. Não aumentar ciclos do
executor nem impor limite de cinco minutos. Um patch literal válido da triagem
já recebida deve ser aproveitado dentro da janela do passo correspondente.

Não rodar de novo um roteiro byte a byte idêntico ao que acabou de falhar.
Preservar o diagnóstico e classificar ausência de alteração como falha da
correção do roteiro, sem novo navegador nem ciclo de produto. Guardas de patch
único, estrutura, passos obrigatórios e limite de tentativas por rascunho ficam.
O texto da parada não deve pedir concordância do executor para um diagnóstico
que o harness já identificou como seu: exibir a falha e sua correção diretamente.

Autor e triagem devem selecionar a identidade pelo texto exato do elemento
filho que a exibe, usando filter({has: page.getByText(nome,{exact:true})}) ou
seletor equivalente comprovado na fonte. hasText por string é uma busca parcial
sem distinção de caixa; /^nome$/ em um contêiner não identifica o nome quando
há metadados. Conferir todas as ocorrências da mesma estratégia, incluindo
edição e exclusão. Preparar os dados exigidos por um fluxo na passagem nova,
sem exigir que um banco descartável já contenha registros. Não inventar novos
critérios nem mudar DOM, texto, delays ou código do produto para o teste passar.

Análise de impacto: laço G4 de triagem/patch/reescrita, reconhecimento dos passos
de workflow (não gramática de fase), mensagens de falha, prompts de ambos os
leitores, regressões já publicadas e cache de roteiros. Preservar a geração do
plano, ledger e fases fechadas. Regressão antes do reparo para três correções
distribuídas entre dois passos (patch pronto na terceira triagem), mesmo passo
esgotando sua janela e reescrita idêntica sem outra execução. Reproduzir o
roteiro real em cópia descartável do parcial, com dados privados e sem modelos;
publicar somente o roteiro corrigido no cache após comprovar os fluxos, com
cópia/hashes da evidência anterior. Não aprovar fases nem mover refs do projeto.

Validação: os dois casos novos falharam antes do reparo, demonstrando patch
descartado após duas correções globais e navegador repetindo roteiro idêntico.
As simulações de reparo existentes passaram a devolver seletores alterados,
para testar uma correção real em vez de fazer um runner falso aprovar o mesmo
arquivo. Os 144 testes direcionados passaram, incluindo a janela de duas para
o mesmo passo com diagnósticos diferentes e a passagem à triagem de produto.
O check completo concluiu build, tipos e **2.470 testes em 126 arquivos**
(98,00s de suíte). Binário instalado recompilado, versão 0.5.0 preservada.

O parcial c5031dddcd6389b46a8678855da63728ff3c7c1d foi extraído para cópia
descartável, com dependências copiadas e Node v25.9.0 compatível com seu módulo
SQLite. Reconstruído o roteiro que falhou a partir da resposta do autor e dos
dois patches registrados: falha reproduzida no seletor de nome, dois fluxos
passaram. Corrigidas somente as buscas pela identidade dos nomes para filho
exato, inclusive caixa e nomes por prefixo, preservando todos os expect e os
cinco passos. Mesmos três fluxos reais: **3 passed (23.1s)**, sem alterar produto
ou acrescentar casos. Banco e diretório pessoal temporários em cada passagem.

O workflow-2.spec.ts corrigido foi publicado no cache .capivara/flows do projeto
pausado. Antes/depois, logs e manifest com SHA256 preservados em
.capivara/runs/build-c9958d3f064e/recovery/g4-categorias-e6bf03e20a2d.
Conferência estrutural contra o esqueleto guardado confirma os cinco passos.
HEAD 2bd3b2e, parcial c5031dd e hash do ledger permaneceram iguais. Nenhuma fase
foi aprovada por fora, nenhuma chamada paga foi feita e nenhum build real foi
reiniciado. A cópia descartável foi retirada após preservar a evidência.

### §115.34 — Falha do G4 corrige no próximo ciclo, sem reconstruir a entrega

Direção explícita do usuário: acertar no primeiro ciclo é meta de eficiência,
não condição para continuar. Uma falha corrigível não encerra a fase quando
ainda há ciclos configurados. Na P05, dois rascunhos inválidos fizeram o runner
parar pelo ramo falhaDoRoteiro, embora G2 e G3 aprovados pudessem ser mantidos.

Usar os ciclos disponíveis para recuperar o G4 automaticamente. Em falha do
roteiro, incrementar o ciclo visível e corrigir somente os roteiros reprovados,
preservando código, G2/G3 e regressões válidas. Guardar o último rascunho e o
diagnóstico para a próxima chamada, mesmo se o script não pôde ser publicado.
O ciclo seguinte não executa a mesma versão que falhou: exigir a substituição
dos roteiros indicados antes de abrir o navegador. Não chamar builder para
alterar produto aprovado por defeito do seu instrumento de verificação.

Falha transitória de sessão da revisão também pode usar o próximo ciclo para
repetir só essa revisão, preservando suas evidências. Credencial recusada,
quota/configuração permanente, violação de isolamento e autoridade continuam
paradas específicas; não gastar novas chamadas numa condição que não mudou.
Esgotamento real dos ciclos configurados encerra com evidência de todas as
tentativas. Sem novos cortes por tempo e sem publicar ou aprovar sem os gates.

O workflow 4 exige estados de carregamento e falha da API. A regra antiga
proibia toda interceptação e contradizia esse requisito. Permitir controlar
somente leituras para observar atraso ou indisponibilidade: page.route com
continue/fallback/fetch da resposta real e abort de GET. Não fabricar respostas
do backend do produto com fulfill, routeFromHAR, service worker ou equivalente;
continuar proibindo simular sucesso de CRUD, listas vazias ou contagens.
Preparar/remover dados pela API real no banco descartável para testar vazio.
Exibir indisponibilidade com abort da leitura e observar o carregamento antes
de liberá-la. Terceiro explicitamente externo pode continuar sendo substituído.
Diagnóstico deve explicar essa alternativa ao modelo, em vez de só proibir.

Conferir o corpo da chamada de rota, inclusive URLs variáveis, para distinguir
controle de rede de resposta fabricada. Não confundir ações em outra rota ou
texto/comentário com uma resposta simulada. Registrar o último rascunho completo
na correção, preservar todos os passos e os caminhos reais de dados.

Análise de impacto: G4 validação inicial/reescrita/cache, runner com recuperação
exclusiva de roteiro e contagem do ciclo, falhas técnicas de leitores, dashboard
e evidências por tentativa, contrato de roteiro e estados transitórios, testes
que esperavam parada imediata. Regressões antes da correção: primeiro ciclo
inválido seguido de segundo verde sem outro builder/G2/G3; esgotamento após os
ciclos configurados; retomada recebendo rascunho/causa; atraso/abort aceitos e
fulfill próprio rejeitado em URL variável. Validar quatro fluxos reais em cópia
do parcial P05, sem modelos nem alterações em código/refs/ledger do projeto.

O rascunho guardado em memória é somente o estruturalmente inválido, que ainda
não pode ser publicado. Quando o autor entrega fonte válida, o arquivo passa a
ser a referência: a correção seguinte lê também os patches já aplicados pelo
Core, sem restaurar uma versão antiga. Se a falha não identifica o workflow,
o próximo ciclo exige reescrita dos candidatos, em vez de repetir o cache
reprovado. O campo interno rejectedScripts existe para essa decisão do gate.

Validação em 19/10/2026: quatro regressões falharam antes do reparo; outra
reproduziu o rascunho antigo sobrepondo patch publicado antes da correção da
memória. Depois, 209 testes direcionados passaram. O primeiro check completo
identificou uma expectativa antiga de parada no ciclo 1; corrigida para os
três ciclos configurados. Check final: build, typecheck e 2480 testes em 126
arquivos passaram. Casos cobrem recuperação no ciclo 2 sem builder/G2/G3 extras,
esgotamento real, evidências/rascunhos por tentativa e recusa permanente sem
repetições inúteis. Nenhum corte especial de tempo foi acrescentado.

Cópia isolada do parcial P05 52469534c1241d42447b2683b65bb02c07a9ddfb:
os quatro workflows passaram em navegador real em 26,8s. Dashboard compara
contagens com a API, navega sem recarregar e verifica estados declarados nas
quatro páginas; usa GET atrasado/abortado e remove dados pela API no banco
descartável. Não fabrica resposta nem altera o produto. Roteiro validado salvo
somente em .capivara/flows/workflow-4.spec.ts do projeto teste_openrouter;
rascunhos anteriores, log e hashes preservados no run build-c9958d3f064e em
recovery/g4-dashboard-e0f3540645c7. HEAD 92a1a35, ref parcial e ledger
conferidos sem alteração na publicação do cache. Nenhuma aprovação de fase ou
execução paga; binário instalado recompilado em 0.5.0.

### §115.35 — Plan corrige o ponto sem reabrir o que já aprovou

Incidente teste_openrouter2, run init-ee50c5623684: quinze passagens de auditoria
terminaram em impasse. A coerência aprovou o índice na passagem 13 e reprovou
na 15 relações entre critérios que não mudaram nas emendas 14/15. Alguns pontos
eram exigências de redação (classe com propriedades versus objeto descrito por
essas propriedades; criar página definitiva versus substituir a provisória),
sem demonstrar uma implementação impossível. Outro achado localizou P1, mas
exemplos de fases 3/5 na explicação abriram emendas também nessas fases. O
escritor da emenda recebia só a própria fase, sem os contratos dos outros
endereços que precisava conciliar. A emenda ainda não atualizava o cache de
escrita: retomar podia ressuscitar o texto anterior ao reparo.

O endereço do finding define os destinos; referências na explicação são
fallback apenas quando o endereço não localiza fase nenhuma. O campo phase
de quem chamou continua tendo precedência. A emenda recebe o texto atual das
outras fases explicitamente relacionadas, como referência de leitura; não
escreve nessas fontes. Com endereços exatos de tasks, o Core preserva as tasks
não citadas na própria fase, sem pagar uma nova chamada por mudanças laterais.
Correções estruturais de divisão/consolidação conservam o caminho existente.

A coerência continua lendo o índice inteiro, mas uma aprovação anterior com
as mesmas decisões fixa a base. O prompt identifica critérios alterados e
exige evidência de mudança para reabrir uma relação aprovada. Um finding cujo
endereço contém somente critérios/tasks ainda idênticos à base aprovada vira
observação, sem devolução. Exige ao menos duas referências válidas, todas
resolvidas; endereço desconhecido, critério novo/alterado, decisão alterada ou
asserção de escopo não relacionada preservam a auditoria normal. Uma mudança
que torna duas regras antigas incompatíveis deve citar também a regra mudada.
Não declarar como impossível o que pode coexistir: request pode usar fetch por
dentro, ApiError pode ter code/message/fields e uma página definitiva pode
substituir uma provisória. Cobrar somente incompatibilidade observável ou
capacidade não autorizada, mantendo os bloqueios reais.

Cada emenda aceita atualiza a entrada do cache correspondente ao prompt atual
de escrita; retomar preserva o conserto e a autoridade que o motivou. Não
aumentar o teto de devoluções nem publicar por esgotamento para ocultar loop.
O impasse não deve afirmar que há um gap de entrevista sem evidência: distinguir
falha de convergência de uma decisão de produto pendente.

Análise de impacto: referência de fases compartilhada por entrevistas/emendas,
escopo mecânico das tasks e correções estruturais, auditoria global paralela à
local, identidade de autoridade e cache entre execuções, prompt e relatórios
de impasse. Provas antes/depois: exemplo de fase na explicação não vira alvo;
outra fase chega como contexto; task não citada conserva seus bytes; reparo
sobrevive à retomada; par aprovado idêntico não consome devolução; alteração de
qualquer referência ou das decisões volta a poder bloquear. Sem chamadas pagas
nem edição de planos do usuário para fazê-los passar.

Validação em 19/10/2026: três regressões falharam antes da mudança (destinos
incluindo exemplos P3/P5, par global reaberto até impasse e emenda sem contexto).
Depois, 131 testes direcionados passaram; uma segunda seleção, incluindo a
retomada com decisões e o protocolo do impasse, passou 129 testes. Proteção de
tasks cobre a estrutura preservada; divisão/consolidação explícitas continuam
usando a validação existente. Memória global mantém rejeição quando há critério
alterado, adicionado ou removido, decisão nova, referência desconhecida, ausência
de par ou ausência de aprovação anterior. Em veredito misto só o par intacto
vira ressalva, preservando os achados sobre regras mudadas.

O primeiro check completo passou 2492 testes e identificou duas expectativas
antigas: escrita obrigatória na retomada mesmo após emenda em cache, e texto
atribuindo o impasse a gap de entrevista. O cenário de nova geração passou a
pedir fresh explicitamente; a retomada normal tem regressão própria garantindo
que conserva a emenda sem nova autoria. Check final: build, typecheck e 2494
testes em 128 arquivos passaram. Executável instalado 0.5.0 recompilado e
verificado. Nenhuma chamada paga, alteração de plano do usuário ou aprovação
externa. A pasta teste_openrouter2 foi limpa externamente durante a análise;
as transcrições foram lidas antes disso. Não houve nova geração completa pela
API: as provas desta correção são as reproduções locais do comportamento.

### §115.36 — Demonstrar o bloqueio antes de devolver ou pedir decisão no plan

A nova execução de teste_openrouter2 começou às 12:01:58 de 19/10/2026, após
o bundle compilado às 11:57:33; o prompt novo consta da chamada real. Não era
problema de instalação. A correção anterior cobria a reabertura de pares já
aprovados, mas a coerência desta execução ainda não aprovara nada. Ela passou
a bloquear compatibilidades: DELETE 204 contra alternativa 200 ou 204; erro de
GET contra validação de POST; banco vazio num cenário contra persistência em
outro; página/componente inicial contra sua evolução em outra fase. As falsas
decisões técnicas alteravam a autoridade e ainda invalidavam a memória.

Antes de devolver achados semânticos ou apresentar decisões do auditor do plan,
uma revisão independente pelo papel verifier confere a materialidade em lote.
Ela recebe o pedido, as decisões e somente as fases referenciadas pelos itens;
não escreve plano nem produto. Descartar um bloqueio exige razão e citação
literal verificável dessas fontes. Registro sem fonte válida conserva aquele
bloqueio/decisão; não descarta os outros pareceres fundamentados. Omissão, ID
desconhecido, duplicação e JSON inválido conservam o veredito inteiro. Falha
dessa revisão nunca aprova o plano. Uma chamada por passagem,
sem ciclos próprios de reescrita ou aumento do orçamento. Falhas de cancelamento,
credencial/quota e controle de execução continuam a ter o tratamento próprio.

A revisão distingue escopo, momento, operação, conjunto de valores permitido
e evolução por fase. Se uma implementação pode satisfazer ambas as condições,
não há contradição. Um detalhe técnico com escolha compatível dentro das fontes
não exige arbitragem do usuário. Negócio material ainda indefinido, obrigações
mutuamente impossíveis no mesmo cenário e funcionalidade exigida ausente
continuam bloqueios/decisões. Critério pode ser demonstrado pela implementação
ou pelo comportamento; não exigir um teste adicional para cada detalhe da
descrição, nem tornar critério o modo como o teste tem de se organizar.
Self-check mecânico, prontidão, limites e ensaio mantêm suas verificações.

O formato interno dessa revisão identifica cada finding/decision, conserva-o
ou o transforma em observação com evidência. Esse campo decide se o loop gasta
outra escrita/pergunta; não é campo do plano executável. Não publicar documento
por teto esgotado nem forjar aprovação do auditor. A auditoria registra seu
veredito original; o relatório informa os pontos considerados não bloqueantes.

Análise de impacto: agregação local/global antes da entrevista de auditoria,
cache e autoridade, protocolo da revisão e fontes exatas, calls/logs/painel,
falha/cancelamento de sessão, testes com verificador roteirizado. Regredir o
caso antes de qualquer aprovação global, a falsa decisão técnica e o bloqueio
funcional legítimo; fonte inventada/omissão/saída inválida não removem bloqueio.
Preservar as transcrições reais em cópia de diagnóstico, sem editar o projeto
ou reiniciar/cancelar sua execução por fora e sem chamadas pagas de validação.

Na busca dos consumidores da forma dos achados, localizaram-se dois caminhos
irmãos: o auditor real também cita sub-fase (`Phase 1.6`), que deve localizar
as tasks pela fronteira da sub-fase; e parsePhaseFragment normalizava a fase
isolada N para 1 sem normalizar suas sub-fases N.x, perdendo a memória de tasks
aprovadas. Normalizar também esses cabeçalhos e devolver seus números originais,
sem aceitar sub-fase de outra fase. Preservar tasks não citadas inclusive quando
uma emenda não estrutural omite outra task; extrair só a correção endereçada,
sem apagar a task omitida ou pedir nova chamada por isso.

Validação em 19/10/2026: dois cenários falharam antes da triagem — auditor
global que nunca aprova por falsa incompatibilidade e pergunta sobre técnica
que chegava ao usuário. Dois outros reproduziram perda de sub-fases em fragmento
posterior à primeira fase e perda da task omitida. Depois, 93 testes direcionados
passaram; seleção com catálogo passou 101. O primeiro check completo apontou
apenas uma expectativa antiga de que o verifier não seria chamado em nenhum
estágio no impasse: agora a triagem existe, mas o ensaio final ainda não roda
antes de aprovação. A asserção foi separada por estágio. Check final passou
build, typecheck e 2512 testes em 129 arquivos. Provas incluem preservação de
bloqueio funcional/decisão material, fontes inventadas, duplicação/omissão/JSON
inválido e aproveitamento de parecer fundamentado em resposta parcialmente
inválida, sem outra sessão. A coerência confirmada pela triagem pode fixar a
base global mesmo havendo um defeito local ainda pendente.

O auditor original também recebeu a distinção entre técnica e negócio, entre
operações/cenários/momentos diferentes e entre descrição e critérios de aceite;
não deve exigir teste separado para cada frase. Bundle instalado 0.5.0
recompilado às 12:20:02; caminho ~/.local/bin/capivara e presença da triagem no
bundle conferidos. Cópia do diagnóstico: /tmp/capivara-openrouter2-diagnostic-yt5i2dch.
Nenhuma chamada paga, edição de plano do usuário ou execução reiniciada por nós.
O run real publicou o plan e marcou RALPH READY às 12:10:55, antes deste reparo:
o resultado já alcançado deve ser preservado e não prova a nova triagem em API.
Plano publicado com sha256 874911b6ae56bec77bd7f85197cb0852915dea38a46c3c52b429fcbc8294a43d.

### §115.37 — Preparar e verificar os requisitos no workspace correto

O usuário confirmou o erro: duas sessões de instalação às 12:40/12:41 e uma
mensagem dizendo que node não está no PATH. A leitura inicial mostrou projeto
vazio; depois dessas sessões surgiu backend/package.json declarando
better-sqlite3 ^11.10.0 e backend/node_modules. Sonda real com Node 25.9.0
nesse backend abriu SQLite em memória e executou select 1 com sucesso. O
pacote foi instalado: o harness o procurava na raiz, não no workspace backend.
O relatório dizia nenhuma sessão gasta porque as chamadas ocorriam antes do
registro do build e o callback de instalação descartava a resposta do provider.

Direção confirmada: o plan discrimina requisitos, o build instala e comprova
TODOS antes de iniciar desenvolvimento. Não dispensar nem postergar essa sonda.
Para probes Node que importam pacotes externos, localizar os manifestos do
projeto que os declaram e executar o mesmo checkArgs nesses diretórios. Não
usar ferramentas privadas do harness como prova nem tentar pastas arbitrárias
até achar um resultado verde. Com múltiplos donos declarados, todos passam.
Sem manifesto ainda, a instalação focada pode criar o manifesto mínimo de
dependências no diretório declarado pelo plano/hint, sem código de aplicação;
a reverificação descobre o manifesto e carrega o pacote de verdade. Probes de
runtime, builtins ou serviços continuam no diretório original. Nenhuma alteração
de skeleton, plan, hashes ou contratos já aprovados para contornar a falha.

Distinguir executável ausente de executável encontrado com prontidão reprovada.
Exibir cwd e evidência real. Gravar prompt, resposta, estado e número das sessões
de preparação antes da primeira chamada; não dizer custo zero depois de usar
modelos. Resultado não zero/quota/configuração recusada da instalação precisa
ser respeitado, sem fingir que a chamada serviu e gastar outra à toa.

Preparação pode deixar manifestos mínimos antes do primeiro worktree. O Core
reconhece apenas manifestos novos cujas únicas dependências são os pacotes
explicitamente sondados, e lock correspondente; ignora node_modules como
artefato local e publica essa preparação por sua própria admissão Git. Não
commitar código, alteração prévia em manifesto rastreado ou arquivo alheio.
Reaproveitar essa preparação ao retomar após falha, inclusive no caso real em
que não havia log. O executor instalador não move refs e não implementa a fase.

Análise de impacto: resolução de probes, instalação/reverificação antes do lock,
manifestos de monorepo e dados do usuário, árvore limpa para worktrees, Core como
único dono dos commits, callbacks/resultados de provider, diagnóstico e custo
da parada. Regressões antes/depois: pacote declarado no backend passa sem outra
instalação; projeto vazio instala uma vez e só inicia builder depois da sonda;
loader recusado continua bloqueando; custo/evidência não somem; preparação nova
é admitida sem levar fonte ou alteração alheia. Prova real somente de leitura
com o SQLite já instalado. Nenhuma nova chamada paga de validação.


Validação §115.37: as duas regressões iniciais de resolução/instalação
falharam antes do reparo. O custo ausente e a recusa de cota também falharam
antes; depois passaram. A revisão da retomada revelou outras três regressões
reproduzidas antes da correção: aviso de ausência sobrevivendo à instalação,
registros recém-criados arquivados junto de logs antigos e custo zero numa
parada de configuração posterior à instalação. Registros de preparação agora
ficam em runs/<run>/preparation, preservados nas retomadas; o custo acompanha o
resultado e o aviso resolvido é retirado. Provas focadas: 86 testes na seleção
inicial e 53 na seleção final de ambiente/admissão/parada. Primeiro check
completo: build + typecheck + 2525 testes/130 arquivos; novo check obrigatório
após os ajustes finais está em /tmp/capivara-environment-verified-check.log.

Sonda de leitura no teste_openrouter2 com Node 25.9.0 comprovou os três
requisitos e nove fases, carregando better-sqlite3 no backend. Uma cópia
isolada dos mesmos arquivos comprovou admissão de backend/package.json e seu
package-lock.json, árvore limpa e todas as sondas verdes. O ensaio inicial com
node_modules simbolicamente ligado foi descartado: Git trata aquele link como
arquivo, diferente da instalação real em diretório; repetido com cópia real de
29 MB, passou. Evidência: /tmp/capivara-real-environment-proof.log. A árvore e
refs do usuário não foram alteradas; plan/skeleton mantêm sha256
f7bb0d2b7dc6dde619bb4ffcbad8ed31d796c118f7442c715e7101468d68a13b e
47e986558006a3fe1137f4408c092da8f054c64ecbc53a4664f7d545e34664a3.
Não rodamos o desenvolvimento nem fizemos inferência paga para validar.

Check final §115.37 concluído: build, typecheck e 2526 testes em 130 arquivos
passaram (113,29 s de suíte). Executável instalado 0.5.0 recompilado às
12:57:01; symlink e funções novas no bundle conferidos. Os documentos do
usuário continuam intactos; a retomada é capivara build, sem refazer o plan.

### §115.38 — Pré-requisito útil, sonda válida e recuperação da instalação

No teste_minimax, o planejamento inventou `playwright screenshot ... /dev/null`
como prontidão. O CLI oficial exige extensão de imagem; a sessão instalou as
ferramentas, substituiu o CLI global por um adaptador e terminou com exit 1.
O Core parou sem comprovar o estado final. O usuário reforçou: testar apenas o
que importa, sem inventar obstáculos técnicos para aprovar a aplicação.

O plan deve declarar somente ferramentas necessárias à stack/desenvolvimento,
não inventar requisitos para viabilizar suas próprias sondas. Compiladores e
dependências locais não precisam de instalações globais por conveniência.
Ferramentas de navegador exclusivas do G4 pertencem à preparação privada do
harness; não exigir outro Playwright global. Pré-requisito não é teste de
produto. Instalação nunca altera CLI de terceiro para satisfazer uma sonda.

Para aproveitar planos aprovados, corrigir mecanicamente somente o destino
inválido conhecido de screenshot Playwright em /dev/null: executar a mesma
navegação/captura real num PNG temporário exclusivo, limpar em finally e
registrar argumentos efetivos. Não mudar plan, skeleton, hashes, CLI global
nem contornar falha real de navegador. Provas de outros comandos inalteradas.

Exit não zero de sessão de instalação não prova ambiente ausente. Quando há
resultado e não há timeout/erro estrutural/recusa de cota ou configuração, o
Core verifica os requisitos faltantes de fato, uma vez: se prontos, registra
recuperação e segue sem outra chamada paga; se ainda faltam, mantém a falha.
Não promover a palavra do modelo a evidência. Recusas e interrupções continuam
preservadas sem repetição paga automática. Custo/log da sessão não desaparecem.

Impacto pesquisado: requisitos derivados do skeleton/environment.json, probes
em workspaces, pré-instalação antes dos worktrees, gate0 usado pelas fases,
callback/resultados e evidência de preparação, timeout e recusas definitivas.
Gate0 de implementação e seus limites não mudam. Regressões obrigatórias antes
do reparo: exit 1 com requisitos comprovados não bloqueia; exit 1 com requisito
ausente bloqueia; cota continua bloqueando mesmo com pacote em disco; captura
real deve receber PNG temporário e limpeza deve ocorrer também na falha.
Restaurar o link do CLI oficial substituído pelo instalador, com backup do
adaptador e sem apagar evidência. Validar sem inferência paga.

### §115.39 — Planejamento define entrega; validador escolhe a prova

Decisão explícita do usuário: planejamento não se preocupa com testes; ele
planeja. Quem define as verificações necessárias é o validador. O plan fixa
capacidades, contratos, dependências e critérios observáveis do produto. Não
prescreve arquivos, identificadores, quantidade ou organização de testes, nem
cria tasks/fases de testes por iniciativa própria. Requisito explícito do
usuário continua sendo autoridade, inclusive se o próprio produto for teste.

Retirar a prescrição de testes dos templates e prompts de escrita/auditoria
do plan. O campo histórico Feature tests continua legível para preservar os
planos já aprovados e suas chaves, mas não vira obrigação de implementação.
O build deixa de varrer a árvore atrás dos nomes inventados no planejamento.
O verificador escolhe a menor prova suficiente do comportamento entregue,
reaproveita G2/evidências existentes, só pede nova cobertura para risco concreto
sem prova e explica cenário, resultado e falha material. Ausência de nome,
arquivo, contagem ou formato de teste não reprova funcionalidade correta.
G4 continua restrito aos fluxos entregues; não surge uma suíte exaustiva nova.

Impacto: templates/documentação gerada do contrato; parser e seus consumidores;
writer/auditor/ensaio do plano; prompts G3 e inventário mecânico; memória de
tasks/sha e retomada; reparo pelo verificador já existente. Sem mudar hashes
ou reescrever planos dos usuários, nem desativar suíte funcional ou prova de
funcionamento. Testes de política antes/depois devem pegar instruções antigas.


Validação §§115.38–39: regressão de instalação com exit 1 e requisito pronto
falhou antes do reparo; depois passou. Instalação ainda incompleta e recusa de
cota continuam bloqueadas. Regressões de responsabilidade do plan falharam
antes: os templates exigiam nomes de testes e o prompt mandava defini-los.
Após remoção, 175 testes direcionados passaram; seleção final passou 72.
Uma execução do check foi interrompida ao identificar uma expectativa antiga
que exigia do executor a criação automática de teste de navegador; a asserção
foi alinhada à decisão do usuário antes da nova suíte completa.

No teste_minimax, restaurado o link oficial de playwright 1.51.1. O adaptador
anterior foi preservado em
.capivara/runs/build-20e34c5ee6da/preparation/playwright-cli-adapter.backup.cjs.
A sonda corrigida abriu Chromium e capturou PNG de verdade, sem alterar o CLI
nem os documentos. Os cinco pré-requisitos passaram e o plan tem seis fases.
Evidência: /tmp/capivara-minimax-environment-proof.log. Nenhuma chamada paga
nem execução do desenvolvimento durante a validação.

O usuário pediu commit de todas as alterações na main ao concluir. O commit
inclui o trabalho acumulado da versão 0.5.0, com check completo antes de
registrar. Não foi solicitado push.


Check final §§115.38–39: build, typecheck e 2535 testes em 132 arquivos
passaram (166,68 s). Uma segunda expectativa antiga de inventário após reparo
foi corrigida preservando a revalidação de todas as tasks. Executável instalado
0.5.0 recompilado às 13:52:51. Log: /tmp/capivara-main-final-check.log.
Commit de todas as alterações acumuladas autorizado pelo usuário na main.

## §116 — Reformulação do INIT e do PLAN: arquitetura, infraestrutura, sem testes, recuperação orientada à conclusão

Pedido do proprietário em 19/10/2026, com uma diretriz acima de todas: **a
Capivara trabalha para concluir a etapa, não para encontrar um motivo para
interrompê-la.** Tempo e custo são métricas; uma operação recuperável não pode
repetir trabalho intelectual já feito. Esta seção registra o que havia, o que
mudou, os contratos alterados, o impacto em cada estágio, os pontos de
compatibilidade com o build, os testes, as limitações e como medir.

### 116.1 O que havia

- O `init` entrevistava, escrevia o esqueleto em uma chamada e parava em PLAN
  READY. As respostas sobreviviam nos handoffs, mas o esqueleto não tinha
  memória: um `init` retomado depois de uma falha repagava a chamada do
  esqueleto com todas as respostas em disco.
- O `plan` detalhava fase a fase a partir da divisão FIXA do esqueleto. O
  escritor da fase e o auditor eram proibidos de dividir, fundir ou reordenar
  fases ("THE PHASES THEMSELVES ARE NOT YOURS TO CHANGE"). Não existia nenhum
  artefato de arquitetura; a única infraestrutura declarada eram as sondas de
  prontidão do esqueleto.
- O contrato `capivara-phases/v1` carregava `**Feature tests:**` no parser, nos
  templates, nos rótulos estruturais, na memória de tasks e em
  `loop/feature-tests.ts`. O §115.39 o tinha tornado "advisory" por prompt — mas
  o contrato continuava exigindo o comportamento antigo, e um prompt não vence
  um parser.
- Recuperação: limite de uso esperava e repetia; timeout e saída vazia tinham
  uma segunda tentativa; qualquer outro erro do provider abortava. A ponte do
  `init`/`plan` descartava `engineError` e `timedOut`, e uma CLI que falhava
  antes de responder virava "texto inválido" (HANDOFF §16). Aprovações por task
  e a base da coerência viviam só em memória: uma retomada reauditava o que já
  estava aprovado. Os achados de contrato do self-check saíam como `linha N`
  sem fase e caíam no fallback de reescrever todas as fases, derrubando
  aprovações pagas (anotado no HANDOFF de 25/09, nunca consertado).

### 116.2 O que existe agora

**Contrato.** `capivara-phases/v2`: o plano descreve comportamento, não testes.
`**Feature tests:**` saiu do parser, dos templates, dos rótulos estruturais, da
memória de tasks e da cobertura; um documento que o carrega é recusado por
**I-15**, nunca lido como se o rótulo fosse critério nem convertido em silêncio.
A saída FRESCA do escritor que ainda o emite por hábito é limpa em código
(`stripLegacyFeatureTests`), sem devolução paga — a distinção é entre reparo de
representação de uma resposta nova e conversão de um documento publicado, que é
proibida. `loop/feature-tests.ts` e `featureTestNames` foram removidos; o build
não varre a árvore atrás de nomes inventados no planejamento.

`capivara-architecture/v1` (`src/contract/architecture.ts`): componentes com
responsabilidade, áreas, dependências, contratos e arquivos; decisões de dados;
fluxos mapeados a componentes; **infraestrutura** com runtimes, ferramentas,
gerenciadores de pacotes, dependências (app/dev), serviços (externos/locais),
bancos, requisitos de compatibilidade, condições para iniciar e as sondas de
prontidão — cada item com `basis`, a autoridade da escolha, e `version` vazia
quando nenhuma fonte a fixa; e a **divisão de fases que vale**, com os
componentes de cada fase e a razão do tamanho. O parser conserta contando o que
não exige julgamento (numeração por posição, forma de `dependsOn`, grafia dos
rótulos de cobertura, sondas herdadas do esqueleto quando o arquiteto não as
repetiu) e recusa o que exige: componente desconhecido, fluxo sem componente,
fase sem componente, item de infraestrutura sem autoridade, dependência do
futuro, fase acima do teto — e, acima de tudo, **cobertura perdida**: toda
story, entidade e fluxo do esqueleto continua no `covers` de alguma fase. É
isso que torna a reorganização segura.

`capivara-planning/v3` e `capivara-environment/v3`: identidades de run, caches
e metadados desta geração. `environment.json` continua carregando o que o build
lê (contrato, geração, hashes, sondas) e ganha `architectureSha12` e
`infrastructure`. O stamp do plano cita `skeleton.md` e `architecture.md`.
Versão 0.6.0; `docs/capivara-phases-v2.md` é o documento gerado.

**O `plan` em duas etapas.** Antes de qualquer fase, o **arquiteto** recebe o
esqueleto inteiro, o pedido, as decisões e o inventário, e devolve a
arquitetura. Um **auditor independente** a julga por cinco eixos — fidelidade
ao produto, coerência, completude, dependências, dimensionamento e viabilidade
— pelo mesmo protocolo de auditoria; achado volta ao arquiteto como emenda (a
arquitetura anterior mais os achados), decisão vai ao desenvolvedor na hora, e
esgotado o orçamento (`maxArchitectureReturns`, 2) o impasse é o mesmo do
plano: `reiniciar`, `publicar` (com ressalva, nunca como aprovada em silêncio)
ou `abortar`. A arquitetura aprovada é publicada em `architecture.md` e no
estado `<run>.architecture-state.json`, com os shas do esqueleto de origem, do
esqueleto aplicado e da autoridade.

A arquitetura é então **aplicada ao esqueleto**: `skeleton.md` e o estado
passam a carregar a divisão de fases e as sondas que ela decidiu. O esqueleto do
`init` é a proposta; o publicado daqui em diante é o que o build e o `change`
leem — e é por isso que é o esqueleto que muda, não eles. Cada fase recebe a
fatia do esqueleto E a fatia da arquitetura (`architectureSliceForPhase`): os
componentes dela inteiros, só o contrato dos que ela consome, os fluxos que os
atravessam e a infraestrutura. O escritor ganhou a regra de escrever para um
executor econômico — onde, o quê e o que prova, com arquivo, rota e função
nomeados, nunca "conforme a arquitetura".

**Auditoria do plano.** Aos eixos de fidelidade, conformidade, precisão e
executabilidade entraram coerência arquitetural, dependências e economia do
executor. Reorganização de fases deixou de ser proibida: um achado endereçado a
`Architecture` refaz a arquitetura (dentro do orçamento), as fases cujo
envelope e fatia não mudaram voltam do cache, e as outras são reescritas. A
coerência ganhou uma terceira pergunta — o plano implementa a arquitetura? — e
recebe `architecture.md`. Nenhum prompt pede, cita ou exige teste; "não exigir
teste separado para cada frase" virou "nunca exigir teste, arquivo de teste ou
procedimento de validação". Defeito de forma que o harness repara sozinho não
é achado.

**Recuperação orientada à conclusão**, na ordem que o pedido fixou:

1. *Determinística, sem LLM.* Reparo do esqueleto (numeração, `dependsOn`,
   rótulos de cobertura); reparo da arquitetura (idem, mais sondas herdadas);
   `Feature tests` descartado; e os reparos de forma que já existiam.
2. *Localizada.* Achado de contrato do self-check vai à fase em que está
   (`faseDaLinha`, por `phaseHeading` do contrato, sem regex fora dele);
   achado de arquitetura refaz só a arquitetura e reescreve só o que mudou.
3. *Reaproveitamento.* A memória do plano (`capivara-plan-cache/v3`) guarda
   esqueleto, arquitetura, fases, aprovações por auditoria, **tasks aprovadas**
   e a **base da coerência**; a arquitetura é reaproveitada do estado quando
   esqueleto (de origem ou aplicado) e decisões não mudaram; a chave da
   aprovação por fase deixou de incluir a lista de tasks já aprovadas, que muda
   conforme a memória cresce e fazia a aprovação de ontem não ser encontrada
   hoje; o ensaio ganhou memória por lote; a coerência não é reperguntada sobre
   um índice idêntico sob as mesmas decisões; o esqueleto do `init` é
   reaproveitado quando o prompt não mudou.
4. *Nova chamada só com julgamento.* Tudo acima acontece antes de qualquer
   chamada de correção.
5. *Provider indisponível preserva tudo.* Erro do motor (`engineError`,
   `timedOut`) chega ao orquestrador como campo e nunca é lido como resposta;
   indisponibilidade transitória (conexão, 502/503/504, sobrecarga) espera 5s e
   20s e repete, no máximo duas vezes; só o silêncio ganha a segunda chance
   automática — recusa que diz o que houve é definitiva (§115.14). Uma fase que
   falha não derruba as irmãs: cada trabalhadora guarda o próprio erro, todas
   terminam, o cache vai ao disco, e só então o primeiro erro sai. A memória é
   gravada num `finally` antes de qualquer erro deixar o orquestrador.

E a mudança de estratégia: duas auditorias seguidas sobre os MESMOS bytes, as
duas reprovando, levam os pontos ao desenvolvedor (arbitragem) em vez de pagar
a terceira devolução. Nada disso declara aprovado um documento que não foi.

**`init`.** Preservado: entrevista, omissões, insistência, esqueleto, PLAN
READY. Ganhou o cache do esqueleto, os reparos determinísticos e a recuperação
do provider. Continua não produzindo código.

### 116.3 Análise de impacto — quem lê o que mudou

| o que mudou | quem lia | o que foi feito |
|---|---|---|
| `TaskBlock.featureTests` | `textoDaTask` (memória de tasks do plan e do build), `coverage`, `loop/feature-tests.ts`, fixtures | campo removido; `t:` sai do texto canônico (o sha de task sem Feature tests não muda); módulo do build removido; fixtures atualizadas |
| rótulos estruturais | `languageBlock` de todo prompt, teste de arquitetura | `Feature tests` fora da lista; o marcador continua proibido fora de `contract/` |
| stamp do plano | `preflight.ts` do build, `change` | preflight inclui `architecture.md` quando existe; `change` carimba os bytes em disco |
| `environment.json` | `readEnvironmentPlan` (build, change) | campos extras ignorados pelo leitor; `change` carrega `architectureSha12` e `infrastructure` adiante |
| `Skeleton.phases` e `environment` | `workflowsForPhase` (build), `change`, `readSkeletonState` | o plan republica o esqueleto com a divisão e as sondas da arquitetura; forma inalterada |
| `PLANNING_CONTRACT` | `runIdFor`, ledger do build, `shaDaAutoridade`, cache | geração v3: nenhum verde anterior é lido |
| `PIPELINE_STEPS`, `INIT_ARTIFACTS` | painel, `doctor`, relatório | passo "arquitetura" no painel; `doctor` reconhece o artefato novo |
| `AgentCaller` | ponte do CLI | `engineError`/`timedOut` passam como campo |

### 116.4 Compatibilidade com o build, no escopo declarado

O build não foi reformulado. Ele continua lendo `project-phases.md` com o mesmo
`parsePhases`, `skeleton.md`/estado com `readSkeletonState` e
`workflowsForPhase`, e `environment.json` com `readEnvironmentPlan`. Os dois
ajustes compartilhados — o input `architecture.md` no stamp do preflight e os
campos extras do metadado — são de integridade, não de comportamento. O
catálogo do Apêndice B roda `init` → `plan` → `build` inteiro com a arquitetura
no meio, e a regressão 9 prova preflight, stamp fresco e metadado. O que o
build ainda NÃO faz: o executor e o roteirista do G4 não leem
`architecture.md` (o prompt do executor cita só `skeleton.md`); é a primeira
tarefa da etapa do build.

### 116.5 Testes

`test/init/reformulacao-116.spec.ts` prova as nove propriedades pedidas:
init retomado não repergunta nem repaga o esqueleto; o plan ainda pergunta as
lacunas; nenhum teste nomeado é exigido e o rótulo antigo é limpo em código; a
arquitetura divide fases sem perder cobertura e a divisão que perde é recusada
com o defeito nomeado; defeito de contrato emenda só a fase citada e defeito de
forma não custa chamada; arquitetura e plano reprovados nunca viram RALPH
READY; o provider caindo preserva tudo o que já foi julgado (três tentativas,
duas esperas, retomada com zero chamadas de arquitetura, auditoria dela e fase
1); a migração não perde story, entidade, fluxo nem regra; o preflight do build
lê plano, stamp e metadado novos. Mais `contract/architecture.spec.ts`,
`prompts/architecture.spec.ts`, I-15 em `contract/phases.spec.ts`, a limpeza em
`phase-part.spec.ts`, o `change` carimbando a arquitetura, e o catálogo com a
coerência não reperguntada sobre índice idêntico.

Os testes pegaram quatro defeitos meus antes do commit: a chave da aprovação
por fase mudava com a memória; a coerência era reperguntada à toa; a repetição
automática cobria erro do motor com texto (o teste da API direta exige "sem
repetir" num corte por tokens); e a primeira rejeição em `Promise.all` saía
com as irmãs ainda escrevendo. Cada `npm run check` desta reformulação foi
gravado e o commit só saiu com `rc=0`: 2542 → 2556 → 2557 → 2558 → **2577
testes em 133 arquivos**. Dois cenários do build paralelo e um do reinício do
G4 falharam por tempo sob carga de máquina (load 13 em 4 núcleos) e passaram
isolados e na repetição; nenhum toca o que mudou aqui.

### 116.6 Limitações que ficam

- O build não lê `architecture.md`: o executor e o G4 seguem com `skeleton.md`
  e o texto da fase. As tasks nomeiam arquivo, rota e função justamente para
  isso não custar nada até a etapa do build.
- O `change` não atualiza a arquitetura: ele carimba a que existe e acrescenta
  fases ao esqueleto e ao plano. `architecture.md` fica desatualizado quanto às
  fases de mudança.
- O auditor da arquitetura não passa pela triagem de materialidade do §115.36;
  o orçamento de reorganizações e o impasse com o desenvolvedor são o limite.
- O `change` ainda escreve fases sem fatia de arquitetura.
- `maxArchitectureReturns` é um teto fixo (2) sem flag de linha de comando.
- Nenhuma execução com modelo real foi feita nesta reformulação: as provas são
  as reproduções com o provider falso e o catálogo. O próximo run real deve ser
  lido em `.capivara/runs/<run>/prompts/` e `logs/` antes de culpar o modelo.

### 116.7 Como medir a redução de tempo, chamadas e retrabalho

Tudo sai de `events.tsv` e de `prompts/`/`logs/` do run, sem instrumentação
nova:

- **Chamadas por estágio**: contar os arquivos de `prompts/` por papel e
  assunto; a retomada de um `plan` que chegou a RALPH READY custa zero chamadas
  de writer, auditor e verifier (regressão 7).
- **Retrabalho evitado**: os anúncios "reaproveitada de uma execução anterior"
  (esqueleto, arquitetura, fase, ensaio, coerência) e "não vou repagar"
  contam o que teria sido pago; cada um é uma chamada a menos em relação à
  0.5.0.
- **Reorganizações**: eventos `authoring · architecture · retry` com o número
  da reorganização; fases reescritas depois dela são as `authoring · phase-pNN
  · complete` sem o detalhe "reaproveitada".
- **Correção localizada**: achados `Phase N · linha L` nos eventos de auditoria
  e emendas só nos `phase-pNN` citados.
- **Indisponibilidade**: eventos `retry` com "provider indisponível" e o
  tempo entre eles; depois do diagnóstico, a retomada não repete nada do que
  está em cache.
- **Tempo**: o `events.tsv` traz o instante de cada transição; o relatório
  final traz segundos e tokens por papel. A comparação justa é o mesmo pedido
  nas duas versões, como no §26.

## §117 — O travessão no finding: parsing recuperável nas auditorias do INIT e do PLAN

### 117.1 O defeito

No `teste_openrouter3`, run `init-dc741f0d7b92`, o `plan` chegou à sexta
rodada de auditoria com seis fases escritas e parou com a mensagem "o auditor
de project-phases.md#coerência devolveu saída inválida duas vezes". O auditor
(Luna) tinha acertado o conteúdo nas duas vezes: uma rota (`GET
/api/dashboard`) consumida nas fases 2 e 4 e entregue só na fase 6, contra a
decisão confirmada; e uma contagem exibida na página de Categorias que nenhuma
decisão autorizava. O que ele errou foi a forma: no lugar do primeiro `|`
escreveu um travessão —

```
CAPIVARA_FINDING: Architecture — P2.T8.C1 e P4.T1.C1 consomem GET /api/dashboard, … | Mova a entrega da rota …
```

Na primeira resposta os dois findings vieram assim; na segunda, só o primeiro
(o segundo, `P4.T1.C1 | … | …`, já estava no protocolo). O parser contou dois
campos, recusou a linha, e com a linha recusada recusou a resposta inteira —
inclusive o finding que estava certo. A repetição do auditor repetiu o hábito,
e o teto de duas tentativas encerrou o run.

### 117.2 A causa

`parseAudit` (`src/audit/protocol.ts`) é o único ponto de interpretação do
protocolo do auditor para o INIT e o PLAN — a auditoria de arquitetura, as
auditorias por fase, a coerência e o ensaio passam todos por `auditCall`, que
o chama. Ele já tolerava a embalagem (chave colada no fim de uma frase,
indentação, marcador de lista, negrito; §34.8, caso do `MCP_teste2`), mas não
tolerava este caso: a informação estava toda presente, separada num lugar
diferente do que o protocolo pede. A regra que recusa um finding com menos de
três campos é correta — sem correção o escritor não sabe o que fazer —, só que
aqui os três campos existiam.

O BUILD não lê este parser: os gates têm os seus (`verifier`, `TASK`), e não
foram tocados.

### 117.3 A recuperação

Determinística, no parser, sem nova chamada. Quando um `CAPIVARA_FINDING` tem
EXATAMENTE dois campos separados por `|` e o primeiro é
`<localização> — <descrição>`, ele é lido como `localização | descrição |
correção`. Os três textos são os que o auditor escreveu; nada é inventado nem
resumido. A separação só é aceita quando é inequívoca:

- o travessão (`—`, ou `–`) tem espaço dos dois lados; um hífen não serve,
  porque aparece dentro de prosa e de identificadores (`US-1.2`);
- a localização tem no máximo 48 caracteres e quatro palavras, sem vírgula,
  ponto-e-vírgula, `!`, `?` ou `|`, e é reconhecível como endereço: uma só
  palavra (`Architecture`, `Overview`), ou traz número (`Phase 3`, `P4.T1.C1`,
  `US-1.2`), ou o separador `·` dos endereços compostos (`Phase 1 ·
  statuses`), ou começa por uma seção que o protocolo nomeia (`components ·
  api`, `Arquitetura`);
- descrição e correção não vazias.

Fora disso, nada muda: três campos nunca são tocados (um travessão DENTRO do
problema fica onde está); dois campos sem travessão, cabeça que é frase,
descrição vazia continuam inválidos; a correção que só repete o problema
continua cobrada depois da recuperação; `REJECTED` continua `REJECTED`. O
resultado do parse ganhou `applied: string[]` com uma nota por finding
recuperado, e `auditCall` anuncia cada nota — é uma chamada que não foi paga,
e o desenvolvedor vê por quê.

Depois do parse, o caminho já existia e não foi reimplementado: o achado
endereçado a `Architecture` vai para `reorganizar()` (refaz a arquitetura com
o achado inteiro, dentro do orçamento de `maxArchitectureReturns`), e o achado
de fase fica para a auditoria seguinte, sobre a divisão nova. Nenhum teto
subiu; nenhuma repetição foi acrescentada.

### 117.4 Testes

`test/audit/finding-travessao.spec.ts`, 12 casos, com as duas respostas reais
do Luna byte a byte (status, os dois findings e a razão): as duas são lidas;
os dois findings preservados, com `Architecture` e `P4.T1.C1` reconhecidos e
problema e correção intactos; `REJECTED` mantido; o round-trip por
`formatVerdict` devolve o mesmo veredito sem nota de conserto; endereços com
número, com `·` e seções nomeadas são reconhecidos; dois campos sem travessão,
hífen, cabeça em frase, descrição ou correção vazia e correção que repete o
problema continuam inválidos; e, no orquestrador com o provider falso, a
resposta real reprova uma vez, o auditor de coerência NÃO recebe o prompt de
reparo, o arquiteto é chamado de novo com o problema e a correção inteiros, e
o plano fecha.

## §118 — A autoridade das decisões: a regra do harness não vai a voto, e o plano não prescreve teste

### 118.1 O defeito

No `teste_openrouter3`, run `init-dc741f0d7b92`, o auditor da fase 5 respondeu:

```
CAPIVARA_AUDIT_STATUS: APPROVED
CAPIVARA_DECISION: Phase 5, última tarefa | A fase deve especificar automação própria do módulo, embora as regras de planejamento proíbam requisitos de testes, arquivos de teste e estratégias de validação? | 1) Manter a automação com Vitest e Playwright, conforme a fatia da arquitetura e o pedido original. | 2) Remover os requisitos de automação da fase e deixar a comprovação do produto a cargo do avaliador.
CAPIVARA_REASON: A última tarefa exige automação com Vitest e Playwright, conforme a arquitetura, mas as regras de planejamento proíbem prescrever testes e estratégias de validação.
```

O auditor acertou a contradição e errou o canal: uma regra do planejamento
virou pergunta ao desenvolvedor, com a leitura que viola a regra como opção
1. O harness piorou: `perguntaDoAuditor` marcava a primeira leitura como
recomendada ("o auditor escreveu esta primeiro"), e a recomendada é o que um
Enter vazio ou "use as recomendações" grava como decisão ACEITA. O
desenvolvedor respondeu "1"; a resposta entrou nas "decisões confirmadas" que
todo escritor e auditor recebem; e nas rodadas seguintes o auditor de
coerência passou a exigir automação própria por módulo "conforme a decisão
confirmada", endereçando à `Architecture` — duas reorganizações, o orçamento
esgotado, e duas arbitrações (`Q-91`, `Q-92`) com "vale a leitura do auditor"
recomendada, gravadas como decisões do desenvolvedor.

### 118.2 A causa: a prescrição entrava no `init` e ninguém a conferia

O pedido dizia, na stack, "Testes automatizados", e em persistência que "os
testes precisam utilizar banco isolado" — exigências do produto, sem
ferramenta. A cadeia de contaminação, documento a documento:

- `skeleton.md`: `Automação de testes: Vitest e Playwright como dependências
  locais do projeto` — a entrevista não perguntou isso; o escritor do
  esqueleto escolheu.
- `architecture.md`: componente `automacao` ("Configurar Vitest e Playwright
  e executar a automação contra um banco descartável"), arquivos
  `vitest.config.ts`, `playwright.config.ts`, `src/quality/`, e Vitest e
  Playwright na infraestrutura com `basis: "Stack do skeleton"`.
- `project-phases.md`: tasks "implementar a automação própria do módulo com
  Vitest e Playwright em `src/quality/tarefas/`", arquivos
  `src/quality/categorias/api.test.ts`, critérios que dizem quais fluxos os
  testes executam.

A única regra em código era I-15, que recusa o rótulo `**Feature tests:**`. A
proibição de prescrever teste existia só nos prompts, e um prompt perde para
uma "decisão confirmada". O auditor da arquitetura, que lia "never demand
tests", não tinha o que dizer sobre uma arquitetura que os PRESCREVIA.

### 118.3 A hierarquia de autoridade, em código

Três categorias, e o que cada uma faz:

- **Decisão do desenvolvedor** (pedido, entrevista): altera o produto. É a
  única autoridade para nomear uma ferramenta ou um arquivo de teste — um
  produto que É um runner de testes, ou um desenvolvedor que escreveu "use
  Jest", continuam podendo dizê-lo.
- **Decisão técnica interna**: o `plan` resolve pela arquitetura e pelos
  contratos; não vira pergunta quando o contrato já responde.
- **Regra do harness**: não é decisão de ninguém. Uma contradição com ela é
  defeito do documento, corrigido localmente, preservando o resto.

O que mudou:

- **I-16** em `contract/test-prescription.ts`: `testPrescriptions(texto,
  autoridade)` reconhece ferramenta de teste (Vitest, Jest, Playwright,
  Cypress, pytest, PHPUnit, JUnit…), arquivo de teste (`x.test.ts`,
  `x.spec.js`, `x.e2e.ts`), configuração (`vitest.config.ts`) e diretório
  (`__tests__/`, `tests/…`, `e2e/…`); um termo que aparece no pedido ou numa
  decisão da entrevista não é prescrição. "A suíte roda contra um banco
  descartável" é comportamento e não é tocado. `checkTestPrescription`
  aplica isso ao plano, task a task, com a linha.
- **A autoridade** (`autoridadeDeTeste` no orquestrador): o pedido mais as
  respostas ACEITAS da entrevista. As decisões levantadas pelo auditor, pelo
  impasse e pelo ensaio ficam de fora — as leituras delas são escritas por um
  modelo, e foi uma delas que no run real virou "decisão confirmada".
- **Esqueleto**: a entrada de stack SOBRE testes que nomeia ferramenta sai
  contando (`repairSkeleton`), e a sonda de `environment` de uma ferramenta de
  teste também; a exigência do pedido continua nas stories e regras, onde ela
  descreve comportamento. Uma entrada de outro componente que cita a
  ferramenta, uma story ou uma regra que a nomeiam são defeito nomeado:
  apagar perderia conteúdo.
- **Arquitetura**: item de infraestrutura e arquivo em `files` saem contando,
  com o conserto anunciado; prosa (overview, responsabilidade, contratos,
  decisões de dados, título/goal/rationale de fase) que prescreve teste volta
  ao arquiteto como defeito, dentro das três tentativas que ele já tem.
- **Plano**: self-check mecânico antes do auditor, uma emenda por task, na
  fase certa, sem gastar o orçamento do auditor; e verificação própria
  (`testes`) no gate RALPH READY — doze verificações agora.
- **CAPIVARA_DECISION**: em `perguntarDecisoesDoAuditor`, antes de perguntar,
  a mesma checagem roda sobre a pergunta e as leituras. Se há prescrição de
  teste que nenhuma fonte autoriza, a decisão não é perguntada: vira achado
  mecânico ao escritor (I-16, com a correção e a preservação do requisito), e
  o run segue pela emenda normal. Vale para a auditoria de arquitetura e para
  as de fase e coerência, que passam todas por ali.
- **Nenhuma leitura recomendada**: `perguntaDoAuditor` deixa `recommended`
  vazio. Enter vazio e "use as recomendações" ficam DEFERRED; só número,
  rótulo ou texto do desenvolvedor gravam decisão.
- **Prompts** (necessários, não suficientes): o bloco de responsabilidade do
  planejamento diz que ferramenta de teste é escolha do build e que o
  conflito com a regra é defeito, não decisão; o canal de decisão do auditor
  diz que uma regra do prompt não vai a voto; o auditor da arquitetura rejeita
  arquitetura que prescreve teste; o esqueleto não nomeia ferramenta na stack
  nem no environment.

### 118.4 Análise de impacto

- `parseSkeleton`/`parseArchitecture` ganharam `authority` opcional; sem ela,
  a regra vale sem escape (o orquestrador sempre passa). Nenhum outro leitor
  mudou de assinatura. O esqueleto gravado em `skeleton-state.json` não é
  reparsado; um `plan` sobre um `init` da 0.6.0 que já carregue a prescrição
  na stack a leva à arquitetura, e a arquitetura a remove da infraestrutura;
  para limpar a stack, `capivara init --fresh`.
- `evaluateReadiness` ganhou `testAuthority` opcional e a verificação
  `testes`; `init.spec` passou de onze para doze verificações.
- O BUILD não lê nada disto. `environment.json` perde itens de
  infraestrutura de teste que nunca deveriam estar lá; o preflight continua
  lendo `requirements`.
- A separação PLAN/BUILD fica assim: o plano diz o que deve valer ("com
  DATABASE_PATH apontando para um arquivo temporário, a aplicação sobe sem
  tocar o banco do `.env`"); o build decide com que ferramenta e em que
  arquivo provar isso.

### 118.5 Testes

`test/init/autoridade-118.spec.ts`, 15 casos, com a resposta real do auditor
da fase 5: a checagem reconhece ferramenta, arquivo, configuração e diretório
e não toca comportamento; o pedido e a entrevista são a autoridade; no plano
aponta task, fase e linha; no esqueleto a entrada de stack e a sonda saem
contando e a regra do banco isolado fica, a entrada de outro componente vira
defeito, e com o pedido nomeando a ferramenta ela fica; na arquitetura a
infraestrutura e os arquivos saem contando e o componente de automação é
defeito; o gate reprova pela verificação própria; a decisão do auditor não
traz leitura recomendada (Enter e "use as recomendações" não confirmam).
Integrados, com o provider falso: (1–2) a resposta real do Luna não vira
pergunta, a correção chega ao escritor da fase como achado mecânico com a
regra, nada do auditor vira decisão do desenvolvedor, e o plano fecha; (3–5)
esqueleto, arquitetura e fase contaminados são corrigidos sem perder a
exigência do pedido, com uma emenda só na fase 2 e a divisão publicada
intacta; (6) uma decisão genuína de produto chega ao desenvolvedor sem leitura
recomendada e a resposta dele é gravada; e o pedido que nomeia a ferramenta
passa sem emenda. (7–8) `npm run check`: 2604 testes em 135 arquivos, verde,
com as suítes das §116 e §117 intactas.

### 118.6 Limitações

- A detecção de ferramenta é uma lista de nomes; uma ferramenta fora dela
  passa pelo código e fica a cargo do prompt. A lista está num lugar só.
- Um diretório de teste com nome livre (`src/quality/`) não é reconhecido
  sozinho; no caso real ele vinha sempre acompanhado da ferramenta ou do
  arquivo `.test.ts`, que são.
- A arbitragem do impasse ("vale a leitura do auditor") continua recomendando
  a leitura do auditor; ela nasce de um achado repetido, não de uma decisão
  inventada, e não foi tocada aqui.
- Nenhum run real depois desta correção.

## §119 — O conflito técnico não vai ao desenvolvedor: serialização por dependência e orçamento próprio da auditoria da arquitetura

### 119.1 O defeito

Num `plan` real na 0.6.1, a auditoria de `architecture.md` parou assim:

```
IMPASSE · precisa da sua decisão
Impasse em architecture.md após 1 devoluções.
O auditor insiste em:
components · api-core, web-shell: As fases 3, 4 e 5 são independentes, mas os
contratos não definem como cada módulo registra suas rotas REST e de interface
sem alterar arquivos compartilhados. (…)
Correção pedida: Definir na fundação mecanismos de registro (…)
```

O auditor viu um conflito técnico real — fases que o build executaria ao mesmo
tempo editariam os mesmos arquivos — e exigiu UMA solução (um mecanismo de
registro). Há outras: ordenar as fases, concentrar a integração numa fase que
depende dos módulos, ou as duas coisas. Nenhuma delas é do desenvolvedor, e o
harness perguntou a ele.

### 119.2 As causas, no código

1. **Orçamento compartilhado.** `auditarArquitetura` decidia o impasse com
   `reorganizacoes >= maxArchitectureReturns`, e `reorganizacoes` é o contador
   das reorganizações pedidas pela auditoria do PLANO. Duas reorganizações
   gastavam o contador, e a primeira devolução da auditoria da arquitetura
   seguinte já ia ao desenvolvedor — "após 1 devoluções".
2. **A propriedade não existia em código.** A arquitetura declara `files` por
   componente, `components` por fase e `dependsOn` entre fases; o escalonador
   do build executa ao mesmo tempo as fases que não dependem uma da outra. Mas
   nada conferia "duas fases sem ordem que estendem o mesmo componente", e o
   prompt do arquiteto não falava de paralelismo: a única orientação vinha do
   pedido do desenvolvedor. O auditor, sem propriedade para julgar, julgava um
   mecanismo.
3. **O impasse era a única saída.** Esgotado o orçamento, o caminho era
   `decideStandoff`: publicar como está, abortar, ou uma decisão que vira
   autoridade acima do auditor — a mesma tela do desacordo de produto, para um
   desacordo de engenharia.

### 119.3 A estratégia

- **Serialização determinística no contrato** (`parseArchitecture`): duas
  fases sem ordem entre si (nenhuma alcança a outra pela cadeia de `dependsOn`)
  que citam o mesmo componente em `components` ganham a ordem — a posterior
  passa a depender da anterior — com o conserto anunciado ("serializou a fase
  4 depois da fase 3: as duas estendem api-core, web-shell…"). `dependsOn` já
  é o que o escalonador do build lê (`dependenciasEfetivas`); não há campo nem
  mecanismo novo. Uma fase que já alcança a outra não muda. Ponto de extensão
  (cada módulo só nos seus componentes) e fase de integração (a única a tocar o
  compartilhado, depois dos módulos) passam sem conserto.
- **Arquiteto e auditor orientados à propriedade.** O prompt do arquiteto
  ganhou "Work that runs at the same time": a regra da serialização, as três
  saídas válidas, a escolha por simplicidade e custo, e "paralelismo é
  otimização, não exigência". O auditor da arquitetura ganhou o eixo 6
  (CONCURRENT WORK): confere a propriedade — toda fase nomeia todo componente
  cujos arquivos muda; todo contrato que um módulo consome existe numa fase de
  que ele depende —, aceita ordem, integração e extensão como resoluções
  equivalentes, e nunca reprova por menos paralelismo. O auditor do plano diz
  o mesmo ao endereçar `Architecture`.
- **Orçamento próprio e mudança de estratégia.** A auditoria da arquitetura
  devolve até `maxAuditReturns` vezes (o mesmo teto do auditor do plano) e não
  mexe em `reorganizacoes`. Esgotado o teto, UMA mudança de estratégia: o
  arquiteto recebe "Change of strategy: resolve by order, not by mechanism" e
  refaz resolvendo por ordem e dependência. O mesmo acontece no plano quando o
  arquiteto devolve a uma reorganização a mesma arquitetura — a emenda que não
  mudou o texto ia à arbitragem do desenvolvedor (Q-91/Q-92 da §118).
- **Sem pergunta técnica.** Se nem a estratégia trocada convergir, o run para
  com o diagnóstico: os achados em que o auditor insiste, a afirmação de que é
  um conflito técnico e não uma decisão de produto, e o que fazer (retomar;
  trocar o modelo do papel). Nada é publicado como aprovado, e
  `decideStandoff` não é chamado para `architecture.md`.

### 119.4 Impacto

- `maxArchitectureReturns` continua valendo só para as reorganizações pedidas
  pela auditoria do plano. Esgotado esse orçamento com achados `Architecture`
  ainda abertos, o caminho continua sendo a arbitragem do plano (não tocada).
- `parseArchitecture` pode acrescentar dependências; o esqueleto publicado e o
  plano carregam a ordem; o build a lê sem mudança. Fica menos paralelo só
  onde há componente compartilhado declarado.
- `decideStandoff` continua existindo para o plano. Os testes da §116 que
  esperavam o impasse da arquitetura esperam agora o diagnóstico e nenhuma
  pergunta.

### 119.5 Testes

`test/init/impasse-tecnico-119.spec.ts`, 9 casos. Contrato: serialização com a
ordem lida pelo escalonador do build; ponto de extensão e integração sem
conserto; fase que já alcança a outra não muda. Orquestrador, com o achado
real do auditor: (5, 8, 11) o arquiteto resolve por serialização, sem
pergunta, sem impasse, sem chamada a mais, até RALPH READY, com a ordem no
esqueleto e no plano; (7) duas reorganizações do plano não consomem as
devoluções da auditoria da arquitetura; (7b) o arquiteto que devolve a mesma
arquitetura recebe a mudança de estratégia antes de qualquer arbitragem; (6)
decisão genuína de produto na auditoria da arquitetura chega ao desenvolvedor;
(10) o conflito que o auditor não dá por resolvido para o run com diagnóstico,
sem pergunta e sem publicar, com três desenhos e três auditorias. (12) `npm run
check`: 2613 testes em 136 arquivos, verde; §116, §117 e §118 intactas, com
duas expectativas da §116 e uma da §117 atualizadas para o comportamento novo.

### 119.6 Limitações

- A serialização lê `components` por fase. Uma fase que edita arquivos de um
  componente que não declarou não é vista em código; é o que o eixo 6 do
  auditor cobra.
- Achados `Architecture` do plano que sobrevivem ao orçamento de
  reorganizações ainda vão à arbitragem do desenvolvedor.
- O run real do impasse não estava em disco; a reprodução é pelo texto do
  impasse e pelo código.
- Nenhum run real depois desta correção.

## §120 — Auditoria consolidada e convergência por evidência

### 120.1 O defeito, com a comparação das versões

No `teste_openrouter3` (0.6.1), run `init-dc741f0d7b92`, a auditoria da
arquitetura devolveu cinco vezes e o run parou "porque não convergiu". As
leituras: rodada 1 com três achados (PUT sem status, contratos da interface
sem estados visuais, `npm start` sem integração), depois um por rodada
(dependências de tipos; status inicial do POST; fluxo 4 com ordem entre
módulos independentes; `.env`/`.gitignore` sem componente responsável). O
arquiteto fechou tudo o que cada rodada apontou.

Comparar as cinco arquiteturas no `plan-cache` responde o que os logs não
provam sozinhos: as dependências de tipos faltavam nos desenhos 1 e 2 (achado
da rodada 2); o status inicial do POST faltava nos desenhos 1 a 3 (achado da
rodada 3); o fluxo 4 tinha a mesma sequência em todos os cinco (achado da
rodada 4). Três dos sete estavam na primeira arquitetura e foram descobertos
depois: o auditor leu aos pedaços. Os outros não se decide pela comparação, e
não se afirma.

### 120.2 A causa, no código

- O parser lê N findings (nunca houve limite de um), e o arquiteto recebe
  todos os da última rodada. Não há filtro nem truncamento no caminho. O que
  não havia era instrução de leitura completa: o auditor da arquitetura tinha
  os eixos e o protocolo, nada dizia "todos os defeitos, nesta resposta".
- A reauditoria era a mesma pergunta de novo, sem o que a leitura anterior
  apontou: o auditor não tinha como distinguir "resolvido" de "não vi".
- A convergência era contagem bruta: `devolucoes <= maxAuditReturns`. Uma
  rodada que fechava tudo contava igual a uma que não fechava nada. O plano
  tinha o mesmo defeito em `nextAuditAction`, e `writerDid` já media o
  progresso — só para o texto do impasse.

### 120.3 O que mudou

- **Balanço por rodada** (`audit/cycle.ts`): `balancoDaRodada` mede, pelas
  marcas dos achados, o que fechou, persistiu, apareceu novo, voltou depois de
  fechado, e se o texto mudou; `rodadaAvancou` é "texto mudou, algo fechou,
  nada persistiu, nada voltou"; `descreverBalanco` é a linha do log e do
  impasse. `writerDid` passou a usar o mesmo balanço.
- **Teto por evidência** (`nextAuditAction`): o teto conta devoluções SEM
  progresso; a rodada que avançou não gasta. O dobro do teto é o teto duro,
  finito, contra o auditor que acrescenta um ponto por leitura — e o impasse
  diz qual dos dois acabou. Vale para o plano e para a arquitetura, que passou
  a usar a mesma função (orçamento `maxAuditReturns`, mecânico 1).
- **Tudo junto, nas duas direções.** O arquiteto recebe os achados abertos da
  rodada e, em "Already fixed in earlier rounds — keep it fixed", o que
  rodadas anteriores fecharam. O auditor recebe, na reauditoria, "Your
  previous reading of this architecture found": confere esses primeiro,
  repete palavra por palavra o que ainda vale, e relê tudo — "um defeito que
  você podia ter apontado antes é falha daquela leitura".
- **Leitura completa nos prompts.** Auditor da arquitetura e os três do plano
  (fase, plano inteiro, coerência): percorrer todos os eixos antes de
  escrever, um finding por defeito material independente, todos nesta
  resposta; nunca parar no primeiro; nunca inventar para encher; ressalva e
  decisão separadas. Arquiteto e emenda: ler a lista inteira, corrigir tudo
  numa passagem, resolver juntos os que tocam o mesmo contrato ou task, sem
  redesenhar, sem exigência nova, sem trocar ordem simples por mecanismo.
- **Sem chamada nova.** Nenhum papel, rodada ou subauditor; a reauditoria e a
  emenda já existiam e só carregam mais contexto.

### 120.4 Impacto

- `nextAuditAction` muda para o plano: uma devolução com progresso não gasta o
  teto. Três testes antigos (`audit.spec`, `impasse-tecnico-119.spec`) que
  contavam o teto bruto foram ajustados para a semântica nova; o resto das
  suítes §116–§119 passa sem mudança.
- A reauditoria da arquitetura muda de prompt a cada rodada (carrega os
  achados anteriores); a memória de aprovação continua por prompt.
- BUILD intocado.

### 120.5 Testes e métricas de chamadas

`test/init/auditoria-consolidada-120.spec.ts`, 10 casos, com os sete achados
reais byte a byte: (1) sete findings lidos inteiros; (5–6) o balanço
classifica fechado, persistente, novo e regressão, a rodada que fecha tudo é
progresso e não gasta o teto; (7) o que persiste gasta, e o teto duro para o
auditor sem fim. Integrados: (2–4, 10, 12) os sete chegam juntos ao
arquiteto, com "correct ALL of it in this one answer" e a arquitetura
anterior, a reauditoria sabe o que a anterior apontou, e o plano fecha com
**2 desenhos e 2 auditorias**; (6, 11) o caso real — 3, 1, 1, 1, 1 achados e
a sexta leitura aprova — converge com 6 auditorias e 6 desenhos em vez de
parar na quinta, e o arquiteto leva o que já fechou; (7, 10) o achado que
persiste gasta o teto e o run para em 4 devoluções com a estratégia trocada,
sem publicar; (7) o auditor que sempre acha ponto novo para em 7, no teto
duro; (8) a decisão genuína de produto chega ao desenvolvedor; (3, 12) no
plano, dois achados de uma fase chegam juntos à emenda, 2 escritas e 2
auditorias. `npm run check`: 2623 testes em 137 arquivos, verde.

### 120.6 Limites

- A leitura completa é pedida ao modelo; o código mede se ela aconteceu
  (balanço) e limita o preço quando não acontece (teto duro), mas não a
  garante.
- O balanço identifica achados por endereço e problema; um auditor que
  reescreve a frase de um mesmo defeito faz um "novo" de um "persistente". O
  pedido de repetir palavra por palavra existe por isso.
- Nenhum run real depois desta correção.

## §121 — RECOVERY FIRST: o INIT e o PLAN trabalham para concluir a etapa

### 121.1 Os caminhos de interrupção, e a causa comum

O orquestrador tinha dezesseis `InitBlockedError`. Os operacionais ficam
(provider mudo duas vezes, geração cortada por tokens, credencial recusada,
esqueleto ausente). Os recuperáveis viviam em quatro laços, e todos tinham a
mesma causa: o escritor era a única alternativa de correção, e o teto dele
era o fim do processo.

- **Esqueleto** (`init`): três tentativas do writer com os defeitos nomeados;
  inválido de novo, parava.
- **Arquitetura** (`plan`): três estruturas inválidas do writer paravam;
  devoluções do auditor até o teto (§120), uma mudança de estratégia (§119),
  e parava — era o caso B do pedido: o último achado pedia acrescentar ao
  contrato da `api` a regra do `.env`/`.gitignore` que o esqueleto já tinha,
  correção localizada e objetiva, e o run acabou.
- **Escrita de fase**: duas respostas sem task do writer paravam.
- **Ciclo de auditoria do plano**: teto do auditor, arbitragem ao
  desenvolvedor, impasse (publicar/abortar/decidir); e "o ciclo não
  convergiu" quando a volta estourava.
- **Saída inválida do auditor** duas vezes parava — sem nunca perguntar a
  outro papel.

A separação escritor/auditor estava sendo lida como "o auditor nunca
escreve". A independência que o contrato exige é a do VEREDITO: quem
reparou não aprova o que reparou.

### 121.2 A política, a mesma nos quatro laços

A escada, do mais barato ao mais caro; cada degrau só é pago quando o
anterior falhou, e o caminho sem defeito não paga nenhum:

1. **Determinístico** (já existia e ficou): travessão no finding (§117),
   reparo do esqueleto e da arquitetura, serialização por dependência
   (§119), cache de esqueleto, arquitetura, fases e aprovações.
2. **Emenda ao escritor** com os achados consolidados (§120), só nas partes
   afetadas, com `preserveUnaddressedTasks` e a recusa da emenda inútil.
3. **Progresso por evidência** (`balancoDaRodada`, §120): fechados,
   persistentes, novos, regressões, texto idêntico. A rodada que avança não
   gasta o teto; o teto duro limita o auditor sem fim.
4. **Mudança de estratégia**: na arquitetura, resolver por ordem (§119);
   no plano, o texto idêntico muda de estratégia em vez de repetir.
5. **Reparo pelo auditor** (`repairBlock`, `prompts/repair.ts`): o papel
   `auditor` recebe o MESMO prompt do escritor — emenda da fase, arquiteto,
   esqueleto — mais o bloco de reparo: os achados pendentes, o histórico
   compacto das tentativas (`writerDid`), e os limites (só o que os achados
   nomeiam; nenhum requisito, regra, decisão ou story a mais ou a menos;
   nunca abrir decisão de produto; a mudança mais simples). Ele produz o
   documento, não uma opinião.
6. **Validação independente pelo verifier**: depois de um reparo, toda
   leitura daquele documento é do papel `verifier`, em sessão própria, com o
   mesmo prompt de auditoria. Aprovou, publica; reprovou, os achados voltam
   ao reparador — até dois reparos por documento.
7. **Parar**: só depois disso, com o diagnóstico: o que continua aberto, o
   balanço de cada rodada, e "Estratégias tentadas, nesta ordem" — nunca
   "tentativas esgotadas". O estado válido está em disco e `capivara plan`
   retoma do cache.

Onde cada degrau entrou:

- `auditCall(subject, attempt, prompt, papel)`: duas saídas inválidas do
  papel pedido, a terceira é do outro papel de julgamento.
- Esqueleto: a terceira tentativa é do auditor com o bloco de reparo.
- `desenharArquitetura(extras, papel)`: três estruturas inválidas do writer
  passam ao auditor (duas tentativas); o `arquiteturaReparada` faz a
  auditoria seguinte ser do verifier.
- `auditarArquitetura`: devoluções com progresso (§120) → estratégia (§119)
  → reparo 1 → validação → reparo 2 → validação → diagnóstico.
- `escreverFases`: a terceira tentativa sem task é do auditor.
- `auditLoop` do plano: modo de reparo em `ask-developer` (teto sem
  progresso, texto idêntico, estrutura fora dos limites): a emenda passa ao
  auditor (`OpcoesDaEmenda.papel`, com `historico`), a leitura ao verifier;
  dois reparos; depois, a arbitragem e o impasse de sempre.

### 121.3 Gatilhos, orçamento e observabilidade

O reparador entra por evidência, não por contador: texto idêntico
(`semAvanco`), teto SEM progresso esgotado, estrutura fora dos limites
(mecânico), estrutura inválida repetida. Nunca por uma falha transitória
(o silêncio do provider já tinha a segunda chance) nem por um defeito que o
código resolve. O orçamento distingue: devoluções com progresso (não gastam
o teto), sem progresso (gastam), mudança de estratégia (uma), reparos (dois
por documento), validações (uma por reparo). Tudo finito; nada publica por
cansaço: o verifier reprovando, o documento não sai.

Cada passo vai ao `events.tsv` (`authoring · <doc> · retry · reparo pelo
auditor (n/2): <motivo>`; `audit · … · started · validação independente pelo
verifier`) e ao log em uma linha; o diagnóstico final lista as estratégias
por documento (`registrarEstrategia`).

### 121.4 Autoridade e o que o reparador não pode

A hierarquia da §118 continua: o bloco de reparo proíbe mudar requisito,
regra, decisão ou story, e manda não abrir decisão de produto. O verifier
confere fidelidade como o auditor confere (é o mesmo prompt). Uma
`CAPIVARA_DECISION` genuína levantada por qualquer dos dois vai à
entrevista, como antes; a que é regra do harness vira achado (§118). O
desenvolvedor não é chamado para engenharia: a arquitetura não tem mais
impasse interativo (§119), e o plano só chega à arbitragem depois dos dois
reparos — e a arbitragem é sobre leituras das fontes, não sobre mecanismo.

### 121.5 Impacto e compatibilidade

- O caminho sem defeito é idêntico: nenhum papel novo é chamado (teste 13).
- Os roteiros do provider falso ganharam uma regra: o auditor que REPARA cai
  no passo do escritor e o verifier que VALIDA cai no passo do auditor quando
  não têm passo próprio. É o que os cenários antigos modelam (a correção
  improdutiva), e por isso onze expectativas de mensagem ou contagem
  mudaram (B-06, B-12, B-35 "reiniciar", convergência, §116, §119, §120):
  nenhuma afrouxou um gate; todas contam agora o reparo e a validação.
- Sem papel novo na configuração: `auditor` e `verifier` já existiam no
  INIT/PLAN. Se o desenvolvedor configurou o mesmo modelo para os dois, a
  independência da validação é a da sessão, e o log diz "em sessão própria".
- BUILD intocado.

### 121.6 Testes e o preço de cada caminho

`test/init/recovery-first-121.spec.ts`, 11 cenários com o provider falso:

| cenário | o que prova | chamadas |
|---|---|---|
| 1, 3, 10, 14 | texto idêntico → reparo pelo auditor → validação pelo verifier → RALPH READY; ninguém aprova o próprio reparo | fase 2: 2 escritas, 1 reparo, 3 leituras (auditor, auditor, verifier) = 6, contra 3 devoluções + arbitragem |
| 2, 4 | reparo parcial: a pendência segue, o que fechou fica; o escritor recebeu os dois achados | 2 reparos, 2 validações |
| 5 | ponto novo na reauditoria depois de fechar o anterior: progresso preservado, sem reparo | 0 reparos |
| 8 | reparador apaga regra confirmada: o verifier recusa, o reparo seguinte a preserva | 2 validações |
| 9 | reparador introduz regressão: o verifier recusa e cita, o reparo seguinte desfaz | 2 validações |
| 7 | decisão genuína de produto continua indo à entrevista | — |
| 11 | provider mudo uma vez: nada se perde | fase 1 escrita 1 vez |
| 13 | caminho sem defeito: nenhum reparo, nenhuma validação | 0 chamadas a mais |
| 6 | conflito de contrato na arquitetura resolvido pelo arquiteto | 2 desenhos, 2 leituras |
| 1 (arq.) | arquiteto não fecha: reparo pelo auditor, validação pelo verifier, publicada | 4 leituras do auditor, 1 do verifier, 1 reparo |
| 12 | esgotamento: diagnóstico com as estratégias em ordem, estado em disco, nada publicado | — |

Os cenários 6 (§119), 4–5 (§120) e 15 (§116–§120) têm também as suítes
próprias. `npm run check`: 2634 testes em 138 arquivos, verde.

### 121.7 O que ainda para, e limitações

- Para, com razão: decisão de produto sem resposta; provider mudo duas
  vezes, geração cortada, credencial recusada; dois reparos validados e
  reprovados (diagnóstico); esqueleto/arquitetura/fase inválidos pelos dois
  papéis; "abortar" do desenvolvedor.
- O plano, esgotados os reparos, ainda chega à arbitragem e ao impasse do
  desenvolvedor; é o caminho para desacordo de leitura das fontes, e não foi
  tocado.
- A independência da validação é por papel e sessão; se auditor e verifier
  forem o mesmo modelo, é uma independência de sessão, registrada no log.
- Reparos são dois por documento, fixos; não há flag.
- Nenhum run real depois desta implementação.

## §122 — Integridade do PLAN: autoridade técnica, decisão do desenvolvedor e independência do reparo

### 122.1 A evidência: o `minimax` (DeepSeek-Flash, 0.6.2)

Run `init-dc741f0d7b92`, projeto `laravel/minimax`: RALPH READY em ~16 min,
151 chamadas (writer 45, auditor 66, verifier 40), US$ 0,12 informado. O
plano fechou — a §121 funcionou — e o relatório trazia quatorze decisões
"confirmadas" pela auditoria. Lidas uma a uma no handoff
(`init-dc741f0d7b92.project-phases.md.json`):

- **Q-72, Q-74** (CAPIVARA_DECISION): como o `rotas.ts` obtém a instância
  `Database` (`abrirBanco(process.env…)` × `obterBanco()` ×
  `registrarRotasCategorias(router, db?)`); o módulo escreve `router.get('/')`
  ou `router.get('/tarefas')`. Engenharia pura: as leituras produzem o mesmo
  produto. Foram ao desenvolvedor.
- **Q-73**: o select de status aparece na criação ou só na edição. Produto,
  e com razão foi perguntada.
- **Q-91 a Q-911** (levantamento, "qual dos dois entendimentos vale"): sete
  das onze são contratos — `export const prefixo`, `connection.ts`,
  `package.json`/script `test`, `.env.example`. Quatro foram respondidas
  "fica como está". Duas são contradições materiais confirmadas no plano
  publicado: **(A)** P1.T5 exige `export const prefixo` em todo `rotas.ts`
  sob pena de `registrarRotasApi` lançar erro, e P3.T3 (Categorias) não o
  declara; **(B)** P2.T9/P3.T4/P4.T8 dizem que "o dono único do script
  `test` é a fase consolidada", e a fase 5 diz que só edita README.md e não
  declara o script — `npm test`, documentado no README, não existe em fase
  nenhuma. Os casos C (SQLite: P3 recebe `db` por parâmetro, P2/P4 importam
  a instância — compatíveis, se P1 exporta a instância, e exporta) e D
  (`.env.example`) não são contradições.
- O plano ainda tinha "Entregar a suíte automatizada do módulo Tarefas" como
  task, com "a suíte cobre os cenários de…" como critério: prescrição de
  teste sem ferramenta e sem arquivo, invisível ao I-16 da §118.

### 122.2 As causas, no código

1. **Nenhum canal de decisão distinguia autoridade.** `perguntarDecisoesDoAuditor`
   perguntava toda CAPIVARA_DECISION que não fosse I-16; `levantamentoDeAuditoria`
   arbitrava todo achado repetido não mecânico; `closeGaps` perguntava todo
   marcador. A única classificação existente era a de teste (§118).
2. **"Vale o que o escritor escreveu" apagava o achado.** `decisaoGravada`
   grava "fica como está — decidido a favor do texto atual", o achado sai da
   lista, e o auditor seguinte recebe a decisão como autoridade: a
   contradição vira coerência por decreto.
3. **`developerRuled` era uma bandeira única.** Depois de uma decisão no
   impasse, a história não era zerada, `maxReturns` era 0 em modo de reparo,
   e QUALQUER reprovação seguinte caía em "publicando sob a decisão do
   desenvolvedor; N finding(s) viram ressalva" — inclusive achados sobre
   outra coisa, nunca decididos.
4. **Não-resposta publicava.** `isNonAnswer` → "ninguém decidiu; publicando
   com N ressalva(s) em aberto" → RALPH READY. Aprovação por exaustão.
5. **`auditCall` caía no outro papel de julgamento.** Verifier inválido duas
   vezes → terceira leitura pelo auditor, que no INIT/PLAN é quem reparou.
6. **I-16 era léxico.** Ferramentas e arquivos; "entregar a suíte", "cobrir
   os cenários", "task de testes", "execução de testes por módulo", "testes
   de integração" passavam. E a correção do auditor (Q-97) pedia "acrescentar
   em Phase 3 uma task de testes": aplicada, a task cairia no I-16 mecânico
   na leitura seguinte — um laço entre o auditor e a regra.
7. **Identidade exata dos achados.** `fingerprint` (where+problema) e
   `marcaDoProblema` (problema exato): o mesmo ponto reescrito contava como
   "fechou 1, novo 1" — progresso que não gastava o teto.
8. **A arquitetura não conferia propriedade de arquivos**: o mesmo caminho
   em dois `files` passava.

### 122.3 O que mudou

**Classificação por forma, não por assunto** — `src/audit/authority.ts`.
`sinaisDeEngenharia(texto)`: caminho de arquivo com extensão de código,
chamada ou assinatura entre crases, `export`/`import`, script npm ou
"script `x`", variável de ambiente. `autoridadeDaDecisao`: engenharia quando
TODAS as leituras têm sinal; `autoridadeDoAchado`: engenharia quando problema
E correção têm. Fora disso, `indefinida`, e o ponto segue ao desenvolvedor
como sempre — a pendência é preservada, nunca decidida por inferência. Sobre
as quatorze decisões reais: Q-72 e Q-74 engenharia, Q-73 indefinida; Q-92 a
Q-911 engenharia, Q-91 e Q-94 (verificabilidade de critério) indefinidas.
Nenhuma chamada de modelo.

**Os canais** (`orchestrator.ts`):
- CAPIVARA_DECISION de engenharia → `decisaoDeEngenhariaComoFinding`: achado
  ao escritor com as leituras do auditor e a nota de quem decide
  (`NOTA_DE_ENGENHARIA`); gravada em `decisoesDoAuditor` para não repetir.
- Levantamento: achado de engenharia nunca entra em `repetidos`; segue na
  correção com a nota. O escritor, depois o reparador (§121), depois o
  impasse — nunca "qual leitura vale".
- Marcador `[NEEDS DECISION]` com sinal de engenharia: devolvido ao escritor
  uma vez com o achado "o plano decide"; se voltar, é perguntado (pendência
  preservada).
- Impasse: `decididosNoImpasse` guarda os pontos que o desenvolvedor leu e
  decidiu; a publicação "sob a decisão do desenvolvedor" só acontece quando
  TODO achado aberto é um deles (`mesmoPonto`); o resto segue na correção.
  Depois da decisão, a história zera, o ciclo ganha orçamento próprio e
  o escritor volta a emendar (`modoReparo = false`; os reparos gastos não
  voltam). "Publicar" explícito publica com os achados abertos no relatório.
  Não-resposta: a primeira recomeça a correção (estratégia registrada); a
  segunda para com diagnóstico e estado em disco — fim da escada, não
  atalho para o READY.
- `auditCall`: o terceiro leitor depois de duas saídas inválidas é o
  verifier quando o auditor falhou, e o ESCRITOR quando o verifier falhou —
  no INIT/PLAN o verifier só lê depois de um reparo do auditor. Sem leitor
  válido: diagnóstico "(verifier, verifier, writer)", nada aprovado.
  `anunciarIndependencia` diz quando validador e reparador rodam no mesmo
  provider/modelo (`options.roles`).
- `semPrescricaoDeTeste` em `auditCall`: achado cuja correção prescreve
  teste chega ao escritor com a correção da regra e o texto original do
  auditor citado.

**I-16 sem ferramenta** (`contract/test-prescription.ts`): `TEST_WORK`
(verbo de implementação no começo da frase + suíte/testes/cobertura a até
três palavras), `TEST_COVER` ("cobrir … cenários"), `TEST_TASK` ("task de
testes", "task … suíte automatizada"), `TEST_STRATEGY` (tipo de teste,
"cobre os cenários", "execução de testes por módulo"). Autoridade: o
composto do domínio do produto que o pedido contém escapa ("testes de
laboratório"); o tipo de teste que o pedido nomeia escapa ("testes de
integração"); o composto genérico de teste de software NÃO escapa da forma
imperativa — "testes automatizados" no pedido autoriza o requisito, não a
task de escrevê-los. `testPrescriptionHint` diz onde o requisito fica. A
mesma função vale no esqueleto (stack, stories, regras e agora o goal das
fases), na arquitetura (overview, componentes, fases), no plano (tasks e
critérios), nas decisões e correções do auditor e no gate.

**Identidade por vocabulário** (`audit/cycle.ts`): `vocabularioDoProblema`,
`semelhancaDosProblemas` (Jaccard sem acento e sem palavras sem peso),
`mesmoPonto` → `sim | incerto | nao`: fingerprint igual é sim; frase igual é
sim, salvo endereços estruturados objetivamente diferentes (dois lugares,
§120); Jaccard ≥ 0,6 é sim (incerto se os endereços divergem); < 0,25 é não;
o meio é sim na mesma task/fase/story, incerto fora. `balancoDaRodada` ganha
`incertos`, que não contam como fechados, novos nem regressões e impedem
`rodadaAvancou`. `ehRepetido` e `repeatedFindings` usam a mesma identidade.
Calibrado nos sete achados reais da §120 (todos < 0,2 entre si), no caso do
`assistencia2` (0,75) e no Q-99 reescrito (0,48, mesma task).

**Arquitetura**: `files` com o mesmo caminho em dois componentes é defeito
("um arquivo tem um dono"). É a única obrigação de integração que o contrato
prova sem julgamento; os casos A–D da §122.1 exigem leitura semântica e
ficam com o auditor de coerência — cujo prompt agora nomeia obrigações de
integração (exportação exigida pela fundação, obrigação entregue a "uma
fase posterior" sem dono, recurso compartilhado obtido de formas
incompatíveis) e diz que formas diferentes que satisfazem o mesmo contrato
não são contradição. A garantia de que esses achados são CORRIGIDOS, e não
arbitrados, vem da classificação acima.

**Prompts**: `planningScopeBlock` ganha a fronteira sem ferramenta;
`DECISION_CHANNEL` diz que escolha entre implementações com o mesmo produto
observável é do plano e vai como finding.

### 122.4 RED → GREEN

`test/init/integridade-122.spec.ts`, 22 cenários. Rodados contra a `main`
(0.6.2) com o `src/` guardado: 19 falham, 3 passam (decisão de produto
continua indo; auditor que insiste contra a decisão vira ressalva; caminho
sem defeito). Os 19 reproduzem o defeito, não um import ausente apenas: a
pergunta de engenharia é feita; "fica como está" publica sem o prefixo; o
marcador vira pergunta; "não sei" publica com "segue em aberto"; o achado
posterior vira ressalva; o auditor lê o próprio reparo (sequência auditor,
auditor, verifier, verifier, auditor); "Entregar a suíte automatizada" passa
no I-16; a correção do auditor pede task de testes; o reformulado conta como
progresso; o arquivo com dois donos passa. Com a correção, 22 verdes.

Expectativas antigas que mudaram, com a razão: `auditoria-consolidada-120`
(campo `incertos` no balanço); catálogo B-40 (a não-resposta deixou de
publicar: agora recomeça uma vez e depois para com diagnóstico, e nada é
gravado como decisão). Nenhuma outra.

`npm run check`: 2656 testes em 139 arquivos, rc=0.

### 122.5 Custo, recuperação, autoridade, independência

- **Chamadas no caminho normal: zero a mais.** Cenário 15 fixa a lista de
  chamadas do plano correto (arquitetura, leitura, duas fases, duas
  leituras, coerência, ensaio em dois lotes). A classificação e a identidade
  são determinísticas.
- **Problema técnico recuperável**: achado/decisão de engenharia → escritor
  com as leituras e a nota → (§120 balanço) → reparo pelo auditor → verifier
  → impasse só depois. A não-resposta recomeça uma vez. Nenhum invariante
  novo gera PAROU direto: o arquivo com dois donos e a fase que aloca testes
  voltam ao arquiteto/escritor dentro das tentativas que já têm.
- **Autoridade do desenvolvedor**: decisão de produto do auditor com uma
  leitura em prosa continua sendo perguntada, sem leitura recomendada; a
  arbitragem de achado não-engenharia continua; a decisão dele no impasse
  continua acima do auditor para os pontos decididos; "publicar" e
  "abortar" continuam seus.
- **Independência do reparo**: auditor repara → verifier valida; verifier
  falha → escritor lê; ninguém elegível → diagnóstico. Mesmo modelo nos dois
  papéis é anunciado.

### 122.6 Limitações

- A classificação é por forma. Uma decisão de produto escrita em código nas
  DUAS leituras vai ao escritor como engenharia; uma de engenharia escrita
  em prosa continua indo ao desenvolvedor. O segundo caso é o padrão seguro.
- I-16 semântico é por padrões em português e inglês, verbo + objeto a até
  três palavras e compostos conhecidos. "Validar o módulo com cenários de
  criação" passa; "Criar a suíte" sem qualificador passa (uma suíte pode ser
  um quarto). O gate e a emenda mecânica cobrem o que os padrões pegam.
- Os casos A–D continuam dependendo do auditor de coerência para serem
  VISTOS; o que a §122 garante é que, vistos, não são arbitrados nem
  publicados por não-resposta. Um auditor que não os vê publica o plano.
- A identidade por vocabulário tem dois limiares fixos (0,25 e 0,6),
  calibrados em três casos reais; não há flag.
- A reconsideração da `main` depois de uma decisão dá ao escritor um ciclo
  inteiro de novo, mas não devolve os reparos gastos; um desenvolvedor que
  decide repetidamente pode alongar o run — cada volta pede a decisão dele.
- Nenhum run real depois desta implementação; a evidência é o provider
  falso sobre os textos reais do `minimax`.

## §123 — A fronteira INIT → PLAN: requisitos sem arquitetura prematura

### 123.1 A evidência: o `haiku` (Parallel Lab, 0.6.2)

Run `init-dc741f0d7b92`, projeto `laravel/haiku`, Haiku nos três papéis. O
pedido: uma aplicação web simples para testar o paralelismo do harness —
Node, TypeScript, React, Vite, REST, SQLite em arquivo, testes automatizados,
três módulos independentes sobre uma fundação compartilhada, persistência
entre reinicializações, banco de testes isolado. Resultado: 6 fases, 66
tasks, 59 chamadas, ~32 minutos com uma retomada manual, RALPH READY. O
esqueleto saiu em UMA chamada (12:08 → 12:11); a arquitetura levou de 12:11 a
12:42 — seis rodadas de auditoria, mudança de estratégia, dois reparos pelo
auditor, duas validações pelo verifier, um bloqueio, reinício à mão.

Lidos os achados (`logs/audit.architecture.*`), quatro dos seis defeitos que
a auditoria cobrou eram sobre decisões que o pedido nunca tomou e que o
esqueleto fixou:

- `servidor.porta`: "escuta na porta definida pela variável `E2E_PORT`, que o
  harness atribui". O auditor exigiu `E2E_PORT` no contrato de configuração e
  no `.env.example` (rodadas 1 e 1b). A frase veio do PROMPT do esqueleto —
  "The harness assigns E2E_PORT per test process…" — uma instrução do build
  colada no estágio que define o produto.
- `banco.arquivo`: "caminho vem da variável de ambiente `APP_DB_PATH`; sem a
  variável, `data/parallel-lab.db`; as tabelas são criadas com `CREATE TABLE
  IF NOT EXISTS` antes de o servidor aceitar requisições". Contra a regra do
  harness "criar ou alterar esquema fora desse comando é proibido", o
  arquiteto fez `abrirBanco()` criar o esquema; o auditor (rodada 4b)
  apontou "a arquitetura ainda escolhe uma leitura para uma contradição do
  esqueleto" e mandou "retirar a leitura adotada e reescrever sem fixar o
  comportamento de abrirBanco" — isto é, PROIBIU o arquiteto de decidir.
  Metade da contradição era invenção do modelo; a outra metade era nossa.
- `api.cliente`, `interface.tema`, `interface.navegacao`,
  `modulos.independencia`, `arquivos.compartilhados`: `src/nucleo/api.ts`,
  `src/nucleo/tema.css`, `src/casca/rotas.tsx`,
  `src/modulos/<modulo>/Pagina<Modulo>.tsx`, "cada módulo ocupa somente
  `server/modulos/<modulo>/`", "nenhuma fase de módulo altera esses
  arquivos". Mais a entrada de stack "Estrutura de pastas: server/nucleo (…);
  src/casca (…)". A distribuição de arquivos por fase — exatamente o que a
  §119 deu ao arquiteto — chegou a ele como requisito, e a rodada 1b cobrou
  "o componente projeto é declarado pelas fases 3, 4 e 5, mas o esqueleto
  determina em arquivos.compartilhados que nenhuma fase de módulo altera
  esses arquivos".
- `banco.isolamento-de-testes`: "os testes automatizados definem
  `APP_DB_PATH` para um arquivo temporário exclusivo de cada execução e
  removem o arquivo ao fim". Estratégia de teste, que a §118 tirou do plano
  por ferramenta e arquivo, voltando pela variável de ambiente.

E, do lado do harness, um defeito latente que o run não chegou a pagar: a
arquitetura nomeou o comando de migração `npm run migrar`. O preparo do
ambiente dos gates (`loop/ambiente.ts`, §46.5) procura o script `migrate` no
`package.json` e, sem ele, "não há migração a rodar". A regra do harness
pedia "um comando único de migração" e nunca disse o nome; os gates teriam
subido a aplicação contra um banco sem esquema — ou contra o esquema que o
`abrirBanco()` criava, exatamente o que o auditor mandou tirar.

### 123.2 As causas, no código

1. **O prompt do esqueleto é de antes da §116.** Dizia "This is the ONLY time
   anyone looks at the whole product at once … whatever must be agreed across
   phases has to be decided by you, now". Era verdade quando não havia
   arquiteto; desde a 0.6.0 o arquiteto lê o esqueleto inteiro e decide
   componentes, contratos, arquivos e fases. A frase mandava o escritor do
   esqueleto fazer o trabalho dele, e nada no prompt distinguia regra de
   produto de mecanismo de implementação.
2. **`E2E_PORT` no prompt do esqueleto.** A instrução pertence ao build
   (`acceptance-policy.ts`, `proportionateChecksBlock`) e já está lá; no
   esqueleto ela virou regra transversal.
3. **Nada conferia em código.** `parseSkeleton` tinha I-16 (teste) e mais
   nada: um caminho de arquivo, uma variável, um comando ou um `CREATE TABLE`
   numa regra passavam direto ao arquiteto como "the product" (autoridade 3
   do prompt dele) e ao auditor como fidelidade a cobrar.
4. **A regra do harness proibia o que o plano decide.** "Criar ou alterar
   esquema fora desse comando é proibido" não sustenta gate nenhum: o build
   semeia o `.env`, roda a migração contra um banco vazio e sobe a aplicação;
   se a aplicação também aplica o esquema ao iniciar, nada quebra. A frase só
   servia para colidir com qualquer leitura "esquema na inicialização" — e a
   §46.1 nunca a teve.
5. **A entrevista do esqueleto aceitava perguntas de engenharia.** O filtro
   ("the choice changes … contracts … or architecture") convida a perguntar
   como implementar; no `haiku` não disparou, mas é a mesma porta que a §122
   fechou no plano.

### 123.3 O que muda

**Contrato.** `src/contract/mechanism-prescription.ts`, I-17: o esqueleto não
fixa mecanismo de implementação sem autoridade. Quatro FORMAS, nunca uma lista
de termos técnicos: um CAMINHO de arquivo ou diretório de código
(`src/nucleo/api.ts`, `server/modulos/<modulo>/`, `data/app.db`; um arquivo
de código solto, `main.tsx`); uma VARIÁVEL DE AMBIENTE (maiúsculas com
sublinhado; "a variável PORT"; `process.env.X`); um COMANDO de ferramenta
(`npm run migrar`, `php artisan migrate`, `composer`, `cargo`…); CÓDIGO (DDL —
`CREATE TABLE IF NOT EXISTS` — e chamada de função — `abrirBanco()`,
`router.get('/')`, exceto o plural de prosa "registro(s)"). Rotas HTTP
(`GET /api/tarefas/:id`) não são tocadas: começam por `/` e são o contrato de
interface que o build lê do esqueleto (`sharedContractFromSkeleton`, §116
ainda não moveu o build para `architecture.md`). A autoridade é a mesma do
I-16 — o pedido e as decisões aceitas: "use a variável `DATABASE_URL`"
continua podendo ser dito. Calibrado no JSON real do Haiku: 9 regras
devolvidas (as oito acima mais `api.servir-interface`, por `dist/`), 21
regras de produto intactas (`tarefas.titulo`, `categorias.nome`,
`api.corpos-e-status-http`, `api.erros`, `listas.ordem`, `exclusao`…), as
sete entradas da stack pedida preservadas, e as regras que o próprio harness
escreve (`.env`, `.env.example`, `.gitignore`, `package.json`, `migrate`)
passando na mesma checagem.

`parseSkeleton` confere stack, regras, stories, fluxos e fases; a entrada de
stack que é só organização de arquivos ("Estrutura de pastas") sai contando,
como a de ferramenta de teste (I-16); o resto é defeito nomeado com os termos
("a regra `banco.arquivo` fixa mecanismo de implementação sem autoridade
(I-17): data/parallel-lab.db, APP_DB_PATH, CREATE TABLE IF NOT EXISTS") e a
correção ("descreva só o comportamento … não apague a exigência"). O modo
`mechanisms: "tolerate"` aceita o esqueleto e devolve o resíduo em
`tolerated`.

**Orquestrador.** A escada do esqueleto é a de sempre (§121): escritor,
escritor com os defeitos nomeados, auditor com o bloco de reparo. A diferença:
na terceira tentativa o mecanismo é TOLERADO — o esqueleto é publicado, o
resíduo vai ao relatório como ressalva (`skeleton.md · I-17`) e à tela, e o
run segue. Um run que para por um caminho de arquivo numa regra é "encontrar
um motivo para interromper". Defeito estrutural continua bloqueando como
antes. Zero chamadas no caminho limpo; uma ou duas chamadas baratas no
caminho sujo, contra as dez rodadas de arquitetura que o `haiku` pagou.

**Prompts.** O esqueleto perde "the ONLY time anyone looks at the whole
product" e `E2E_PORT`, e ganha "Product, not implementation": o que não
escrever (caminho, variável, comando, esquema, função, arquivos por fase,
estratégia de teste) e o que escrever no lugar ("os dados dos três módulos
persistem em um banco SQLite local e continuam disponíveis após reiniciar");
as fases são "a preliminary division by functional delivery" que o arquiteto
reorganiza. A enumeração de rotas fica, com a nota de que é contrato de
interface, não código. A entrevista do esqueleto ganha "Never ask how the
product will be implemented". O arquiteto e o auditor da arquitetura ganham a
mesma fronteira (`MECHANISM_BOUNDARY`): regra que fixa COMO sem autoridade
não é produto — fica o comportamento, o mecanismo é do arquiteto, e dois
mecanismos incompatíveis nunca são contradição a escalar nem pergunta ao
desenvolvedor; as regras derivadas da decisão de banco (`.env`,
`.env.example`, migração, banco descartável) são requisito dos gates e ficam
exatamente como estão. O eixo de fidelidade do auditor passa a cobrar o
COMPORTAMENTO de cada regra, não o mecanismo. Esta é a metade do PLAN: cobre
o que o código não pega (prosa sem forma, esqueleto de versão anterior,
resíduo tolerado).

**Regra do harness.** "Comando de migração" diz o que os gates precisam —
cria o esquema inteiro a partir de um banco vazio, repetível sem erro, é o
que o desenvolvedor roda depois do `.env` e o que o harness roda antes de
subir a aplicação; "num projeto com `package.json`, é o script `migrate`" —
e deixa escrito que aplicar o esquema também na inicialização "é decisão do
plano, não desta regra". A proibição saiu. O nome do script é do harness, não
do INIT: é o contrato de `loop/ambiente.ts`, que nunca tinha sido dito a
ninguém.

### 123.4 O que NÃO muda, de propósito

- O build (`loop/`), inclusive `sharedContractFromSkeleton`: ele continua
  lendo Stack e Regras do `skeleton.md`, e por isso as rotas HTTP ficam no
  esqueleto. Mover o contrato de interface para `architecture.md` é a
  primeira tarefa da etapa do build (§116), não desta.
- O `change` (`contract/change.ts`) não recebe I-17: ele escreve contra uma
  árvore existente, onde um caminho de arquivo é fato descoberto, não decisão
  inventada.
- Nenhum verifier no esqueleto. A validação independente do reparo do
  auditor é o parser — determinística, em código, sem chamada. Um verifier de
  modelo aqui seria a chamada a mais que a §12 do pedido proíbe.
- Os prompts das fases e do plano, a auditoria consolidada (§120), o reparo
  pelo auditor e o verifier (§121), a autoridade das decisões (§118, §122), a
  serialização por dependência (§119), o cache por prompt.

### 123.5 Testes: RED → GREEN

`test/init/fronteira-123.spec.ts`, 20 cenários sobre o pedido real do
Parallel Lab e as regras reais do Haiku: 17 RED contra a `fix/integridade-122`
(os três verdes são preservação: I-16, caminho limpo com uma chamada, decisão
de produto perguntada). Cobrem os vinte do pedido: migração não inventada,
SQLite preservado, tabelas na abertura não impostas, contradição eliminada,
variável e `E2E_PORT` sem autoridade, arquivo React, testes preservados como
requisito, isolamento preservado como comportamento, estratégia de teste
fora, fase preliminar sem arquivo nem `registrarRotas(app)`, migração livre
para o plano (prompt + regra), requisito técnico do pedido autorizado,
decisão de produto perguntada, pergunta de engenharia proibida no prompt,
escritor corrige (2 chamadas, 0 auditor), auditor assume (3ª chamada), o
parser valida o reparo, resíduo publicado com ressalva, caminho limpo sem
chamada extra, PLAN até RALPH READY com o esqueleto limpo e a fronteira no
prompt do arquiteto. `test/prompts/prompts.spec.ts` troca a expectativa "única
vez que alguém olha o produto inteiro" — falsa desde a §116 — pela fronteira.
`docs/capivara-phases-v2.md` regenerado com I-17. `npm run check`: 2676
testes em 140 arquivos.

### 123.6 Limitações

- I-17 é por forma. "As tabelas são criadas ao abrir a conexão", "registra os
  roteadores de cada módulo", "o cliente da API fica num módulo compartilhado"
  passam; é o prompt do esqueleto que pede para não escrevê-las, e o
  `MECHANISM_BOUNDARY` do arquiteto que as neutraliza se vierem.
- A variável de ambiente é reconhecida por maiúsculas com sublinhado ou por
  "variável X"; `PORT` solto numa frase sem "variável" passa. `npm install`
  e `pip install` são comando e são devolvidos — num esqueleto, "dependências
  locais ao projeto" é o que se escreve.
- A terceira tentativa tolera; as duas primeiras devolvem. Um escritor que
  reescreve o esqueleto inteiro a cada devolução pode trocar um mecanismo por
  outro — o cache por prompt não o salva, porque o prompt muda com os
  defeitos. É o mesmo custo do I-16.
- O nome `migrate` vale para projetos com `package.json`; o build não roda
  migração de outra stack (§46.5), e a regra não promete que roda.
- Esqueleto gravado por uma versão anterior entra no `plan` sem passar pelo
  I-17 (o `plan` lê o estado, não reparseia); a fronteira dos prompts do
  arquiteto é o que o protege.
- Nenhum run real depois desta implementação; a evidência é o provider falso
  sobre os textos reais do `haiku` e o parser sobre o JSON real dele.

## §124 — Integridade da triagem: finding material só está resolvido quando o plano está coerente

### 124.1 A evidência: o `haiku` depois da §123

Mesmo run `init-dc741f0d7b92`, projeto `laravel/haiku`, Haiku nos três
papéis, 0.6.2 com a §123 instalada: 7 fases, 52 tasks, 18 stories, 3
entidades, 5 workflows, 63 chamadas de modelo, 39 minutos (11:31 → 12:10),
RALPH READY. O esqueleto saiu limpo em uma chamada e a arquitetura fechou em
três rodadas — a §123 fez o que prometeu. O defeito desta vez está no plano
publicado, e não foi falta de detecção.

A arquitetura (`architecture.md`, visão geral) decidiu o ponto de extensão:
"cada módulo é formado por dois componentes independentes (a API e a página),
que se registram em pontos de extensão entregues pela fundação:
`src/servidor/modulos.ts` no servidor e `src/web/navegacao.ts` na interface.
Assim, as fases de módulo tocam apenas arquivos próprios e podem rodar em
paralelo sem disputar arquivos." A fase 1 (P1.T6) cria `modulos.ts` com
`criarModulosApi(banco)` devolvendo "nesta ordem, as entradas com `caminho`
`/tarefas`, `/categorias`, `/anotacoes` e `/painel`", cada uma com o router
stub do módulo; a fase 2 (P2.T9) cria `navegacao.ts` com os quatro itens.
As fases 3, 4, 5 e 6 — `Depends on: Phase 1, Phase 2`, sem ordem entre si —
mandam, cada uma: "registrar o módulo em `src/servidor/modulos.ts`,
acrescentando à lista… a entrada `{ caminho: '/tarefas', … }`" (P3.T4),
"Registrar o router… em `src/servidor/modulos.ts` como um item" (P4.T5),
"Registrar o módulo em `src/servidor/modulos.ts`… Se o item já estiver na
lista, nenhuma alteração é feita" (P5.T4), "registrar o módulo em
`src/servidor/modulos.ts`, adicionando `{ caminho: '/painel', … }`" (P6.T2);
e o mesmo em `navegacao.ts` (P3.T8, P4.T8, P5.T7, P6.T4). Quatro fases que o
escalonador do build executa ao mesmo tempo, em quatro worktrees, cada uma
ordenando ao executor literal acrescentar num arquivo compartilhado a entrada
que a fundação já entregou — contra o critério "exatamente um item" das
próprias tasks e contra o pedido ("os módulos independentes não devem
modificar arquivos compartilhados simultaneamente").

O auditor de coerência viu, três rodadas seguidas
(`logs/audit.project-phases.md-coer-ncia.auditor.{2,3,4}`), com endereço e
correção: "P1.T6.C1 vs P3.T4.C1, P4.T5.C1, P5.T4.C1 e P6.T2.C1 | A fase 1 já
põe os quatro itens em modulos.ts; P3.T4.C1 manda 'acrescentar'… Executadas
em ordem, cada uma duplica a entrada e quebra 'exatamente um item' | Pela
arquitetura, o registro é da fase 1. Remover de P3.T4.C1, P4.T5.C1, P5.T4.C1
e P6.T2.C1 qualquer instrução de acrescentar ou registrar a entrada em
modulos.ts." Os auditores por fase também viram (P3, P5, P6: "fases
declaradas paralelas… editam src/servidor/modulos.ts").

A triagem de materialidade descartou, três rodadas seguidas
(`logs/audit.project-phases.md-materialidade.verifier.{2,3,4}`), com estas
razões, literais: rodada 2, F5: "As fases de módulo não precisam editar
modulos.ts nem navegacao.ts, porque a fundação e a fase de casca já
registram as entradas… **A conclusão depende de remover as edições
compartilhadas dessas tarefas**" — ADVISORY; F23: "A instrução de
acrescentar não é obrigação que impeça essa implementação" — ADVISORY;
rodada 3, F7: "O problema real são as instruções de editar esses arquivos nas
fases de módulo, tratadas nos itens F13 e F14" — e F13/F14: "A instrução de
acrescentar a entrada na fase 3 é compatível se a fase apenas verificar que a
entrada existe" — ADVISORY; rodada 4, F4: "Os conflitos em modulos.ts e
navegacao.ts desaparecem se a fundação já registrar as entradas e os módulos
só substituírem os próprios arquivos" — ADVISORY, F6, F7 idem. A evidência
citada era sempre a fundação ("cada uma com o router de `criarRotas` do seu
módulo") e a frase de intenção da arquitetura ("as fases de módulo tocam
apenas arquivos próprios"); nunca o texto das tasks acusadas. Na rodada 4,
0 defeitos mantidos; APPROVED; ensaio; RALPH READY. O plano publicado
(`project-phases.md`, linhas 163, 231, 295, 336, 192, 252, 317, 350) ordena
exatamente o que o auditor mandou remover.

O mesmo mecanismo descartou outros defeitos materiais e os reencontrou na
rodada seguinte: `lerTexto` rejeitando `undefined` com 400 (F19 r2 ADVISORY →
F6 r3 KEEP), `aplicarEsquema` chamado com um caminho onde a assinatura pede
`Database` (F21 r2 ADVISORY → F16 r3 ADVISORY → publicado), `criarModulosApi`
"devolve lista vazia" na fase 2 contra as quatro entradas da fase 1 (parte
de F25 r2 ADVISORY → F12 r3 KEEP). E o caso `raiz` → `root` (P1.T1.C1 monta
em `raiz`; P2.T7.C3 e P2.T9.C4 fixam `root`): F15 r3 ADVISORY citando só P1
("a sequência é coerente se a fase 2 usar root"), F8 r4 ADVISORY citando P1
e P2 ("a instrução de 'raiz' vale só até a fase 2 substituir o arquivo") —
uma substituição que a P2.T9 de fato ordena ("Criar… `src/web/main.tsx`").

### 124.2 As seis perguntas do pedido, respondidas no código de antes

1. **Quem autoriza descartar um finding?** Uma chamada do `verifier`
   (`orchestrator.ts`, `auditOnce` do plano, "project-phases.md#materialidade")
   e `applyMaterialityReview` (`src/audit/materiality.ts`): todo item com
   `disposition: "ADVISORY"`, razão não vazia e ao menos uma citação de 12+
   caracteres existente em alguma fonte é REMOVIDO de `findings` e vira
   `remark` ("triagem de materialidade: …"); sem finding restante, o veredito
   vira APPROVED. Ninguém mais lê o parecer.
2. **Que evidência precisa existir?** Só a existência da citação em uma
   fonte (`sources.get(evidence.source)?.includes(quote)`). A citação não
   precisava vir da fase acusada nem sustentar a razão: "cada uma com o router
   de `criarRotas` do seu módulo", tirada da fundação, bastava para descartar
   um conflito que acusava as fases 3 a 6.
3. **A triagem verifica o documento publicado?** Ela recebe o texto atual das
   fases citadas (`materialityInput`, `related` por `affectedPhases`), mas o
   parecer não é confrontado com ele, e depois do ADVISORY ninguém relê: o
   `auditLoop` publica o MESMO `content` que foi auditado (`if
   (action.action === "publish") return { content, … }`), e a interpretação
   aceita vive só na ressalva.
4. **Uma solução hipotética pode encerrar um finding?** Por desenho do
   prompt: "A contradiction requires disjoint obligations: **if any valid
   implementation satisfies both, use ADVISORY**" e "Unspecified
   implementation details with a compatible choice … are ADVISORY". A regra é
   certa para conjuntos permitidos ("204 é compatível com '200 ou 204'") e
   errada para instruções: uma task que manda acrescentar o que já existe
   admite uma implementação que não acrescenta, e o executor literal
   acrescenta.
5. **Findings descartados voltam a ser verificados?** Não. Pior: a fase cujos
   achados foram todos ADVISORY é APROVADA (`fasesAprovadas.add`,
   `memoria.guardarAprovacao`, `tasksJulgadas.aprovar`, logo após a
   triagem), e a coerência é gravada como aprovada
   (`coerencia.reconcile({ …review.verdict, status: "APPROVED", findings: [] })`),
   de modo que o mesmo achado sobre endereços não alterados seria descartado
   na rodada seguinte sem modelo nenhum ("coerência já aprovada: referências e
   decisões não mudaram"). O auditor sem memória reencontrava porque as fases
   mudavam por outros achados.
6. **O plano publicado pode divergir da interpretação aceita?** Sim: a
   interpretação ("os módulos substituem os stubs sem acrescentar") é texto da
   ressalva; o documento publicado é o `content` auditado, com "acrescentar"
   nas oito tasks. O relatório final do run disse "aprovado com ressalvas".

### 124.3 A causa-raiz

Duas metades, uma de cada lado do que a §119 fez.

**A metade do código.** A §119 serializa, no CONTRATO DA ARQUITETURA, as
fases sem ordem entre si que estendem o mesmo componente
(`contract/architecture.ts`, `serializou a fase N depois da fase M`). O
Parallel Lab passou por ela limpo: as fases 3 a 6 declaravam só os próprios
componentes (`tarefas-api`, `tarefas-web`…). O conflito nasceu DEPOIS, no
texto das fases, escrito por um escritor que lia a sua fatia e o arquivo da
fundação como ponto de extensão — e nada conferia, no nível das fases, a
obrigação de escrita contra a ordem entre elas. É a correção pela metade
(CAPIVARA.md): a verificação existia no irmão (arquitetura, por componente) e
faltava aqui (fases, por arquivo). Sem ela, o único leitor do defeito era o
modelo, e o modelo que decidia a materialidade tinha uma regra que o mandava
descartar.

**A metade do protocolo.** A triagem só distinguia bloqueio de não-bloqueio
(KEEP/ADVISORY), e definia não-bloqueio como "existe uma implementação
compatível". As três situações do pedido (§6) — falso positivo, ambiguidade
material recuperável, contradição genuína — colapsavam em duas, e a do meio
caía sempre no lado errado: o verifier reconhecia que "a conclusão depende de
remover as edições" e descartava mesmo assim, porque a regra lhe dizia que a
possibilidade bastava. E o descarte não precisava provar nada sobre o texto
acusado: qualquer citação existente servia.

### 124.4 O que muda

**Contrato.** `src/contract/ownership.ts`, I-18: fases sem dependência entre
si não recebem obrigação de escrita no mesmo arquivo. A obrigação de escrita
é a FRASE DA TASK que ordena criar, acrescentar, registrar, alterar,
ajustar, configurar… um arquivo nomeado — verbo de escrita (infinitivo,
imperativo, gerúndio, infinitivo com pronome "registrá-la"; pt e en)
governando um caminho na mesma ORAÇÃO — ponto, ponto-e-vírgula, dois-pontos
e travessão fecham a oração; um aparte entre parênteses não vê o verbo de
fora nem governa fora dele; o que está entre crases é código ou caminho,
nunca verbo (`import { x } from './x'` não desfaz a escrita em `App.tsx`;
`POST /import` não é consumo). Não é escrita: um critério de aceite (afirma
estado — "`modulos.ts` contém exatamente um item" verifica, não modifica); o
caminho citado como origem ("importado de", "lido de", "a partir de", "uma
cópia de"); o caminho depois de um verbo de consumo ("usando", "lê",
"chama", "importar … de") ou dentro de uma subordinada que não fechou ("que
serve `dist/web`", "se `dist/web/index.html` existir") — e as duas coisas
valem até a oração fechar numa vírgula ou coordenação ("`index.html` que
carrega `main.tsx`, e `src/web/main.tsx`" cria o segundo); o verbo negado ou
precedido de preposição, que descreve em vez de ordenar ("sem alterar `X`",
"não modificar `X`", "without modifying `X`", "ao criar uma tarefa, grava em
`X`", "para registrar em `X`") — a frase que a própria dica do I-18 sugere
não pode ser recusada; e a terceira pessoa que descreve ("a função cria o
diretório", "o router registra GET /", "a lista inclui o item", "a classe
estende Error") fica de fora de propósito — a task ordena no infinitivo, no
imperativo, no gerúndio ou com pronome ("registrá-la"). O genitivo e o
locativo composto nomeiam o DESTINO ("à lista de `navegacao.ts`", "dentro de
`modulos.ts`", "ao final de `X`", "the `scripts` section of `package.json`");
o particípio que localiza ("definido em", "registrado em") é destino quando a
task altera a coisa no lugar ("Alterar o tipo definido em `tipos.ts`",
"acrescentar ao array definido em `x.ts`") e origem quando a pega e a põe
noutro lugar ("Registrar o módulo definido em `a.ts` em `modulos.ts`"); a
passiva que ordena conta ("deve ser registrada em `X`"). Nome com ponto na
prosa não é arquivo (Node.js, Next.js, p.ex., process.env): fora das crases
só conta o que tem diretório ou é dotfile; o nome solto sem diretório
(`rotas.ts`, `index.ts`) é AMBÍGUO — cada módulo pode ter o seu — e entra nas
obrigações da fase mas nunca em conflito, a menos que seja arquivo de raiz
(`package.json`, `index.html`, `tsconfig*.json`, `*.config.*`, `README.md`,
dotfiles); diretório explícito ("em `src/web/componentes/`", ou "`index.ts`
em `src/modulos/tarefas`" logo depois do arquivo) qualifica o nome solto;
"(inclui `src/web`)" não move o `tsconfig.json` para dentro de `src/web`.
Acento no caminho fica (a normalização preserva o comprimento, e o arquivo é
lido do texto original), `\` vira `/`, glob e placeholder não são caminho.
Fases com ordem entre si podem alterar o mesmo arquivo — e a ordem é a que o
ESCALONADOR respeita (`effectiveDependencies` espelha
`loop/escalonador.ts` `dependenciasEfetivas`, com teste de equivalência em
`test/loop/escalonador-contrato.spec.ts`): `Depends on` lido com o mesmo
`phaseDependencies`, transitivo, a fundação (fase de menor número) como
dependência de toda fase posterior mesmo quando o texto diz `none`, e a
dependência ilegível valendo "todas as anteriores". O stub que a fundação
cria e o módulo substitui é sequência; a integração que "ajusta
`navegacao.ts`" depois dos módulos é sequência. O conflito é só: duas fases
sem dependência efetiva entre si, as duas com obrigação de escrita no mesmo
arquivo. `checkWriteOwnership` devolve um `ContractError` I-18 por task em
conflito, na linha da task, com o arquivo, as fases concorrentes, quem CRIA o
arquivo, o dono (criador de que todas as conflitantes dependem) e, quando a
arquitetura é informada, o componente que lista o arquivo. A dica é honesta
sobre o que se sabe: com dono, "se ela já entrega o que esta fase precisa
encontrar em `F`, retire a escrita e verifique o estado num critério; se não
entrega, escreva a necessidade como critério ('`F` contém …, entregue pela
fase N') — a auditoria leva a lacuna à fase dona; em nenhum caso esta fase
escreve em `F`"; quando a própria fase em conflito é a única criadora,
"mantenha a criação — é a divisão que está errada, não esta task"; quando o
criador não vem antes desta, "retire a escrita e peça como critério o que
precisa encontrar"; e sempre "a ordem entre as fases (dependsOn) é decisão
da arquitetura, não desta task: não invente dependência aqui". Calibrado
sobre as 52 tasks reais do `haiku`, agora como fixture da suíte
(`test/fixtures/haiku-124.project-phases.md`): exatamente os oito conflitos
(modulos.ts e navegacao.ts × P3–P6) nas linhas publicadas, donos P1/P2 e P2,
componentes `api-base` e `web-shell`; dezenas de outras obrigações de escrita
lidas sem conflito, inclusive as sequenciais (P2 recria `app.ts`,
`interface.ts`, `index.ts` da P1; P7 ajusta `navegacao.ts`, `App.tsx`); e o
mesmo plano com as oito tasks corrigidas como o auditor mandou passa limpo.

**Orquestrador.** `auditOnce` do plano ganha o I-18 como self-check
mecânico, depois do I-16 e antes do dimensionamento: `mechanical: true`,
`phase` por achado, `where: P<n>.T<m> · linha L` (`achadoMecanico`), problema
`I-18: …`, correção = a dica acima. O ENDEREÇO DE TASK é o que faltava
também ao I-16 e foi corrigido junto: `Phase N · linha L` localizava só a
fase, `preserveUnaddressedTasks` devolvia a reescrita inteira, e as tasks
vizinhas perdiam bytes e aprovação sem nenhum achado pedir; com `P2.T1` só a
task em conflito muda e as outras voltam byte a byte, que é o que a emenda
promete — e o envelope (`Depends on`) continua sendo o do harness, como o
teste 9/10/11 prova com uma emenda que tenta mexer nos dois. O endereço
expôs um defeito antigo de `preserveUnaddressedTasks`: quando a emenda APAGA
a task endereçada (a task que era a suíte, no I-16) ou a funde noutra, não
há bloco para pôr no lugar, e a função deixava o bloco original — a correção
pedida era descartada em silêncio e o I-16 voltava a cada rodada sobre a
task que o escritor tinha removido. Agora a reescrita inteira vale nesse
caso, como já valia para a divisão pedida (`test/contract/drift.spec.ts`). Vai à fase que
escreve — nunca à dona — pelo canal das emendas (`amendPhasePrompt`), com
orçamento mecânico próprio (`maxMechanicalRounds`), sem auditor, sem triagem
(o self-check devolve antes de qualquer chamada de modelo) e sem pergunta ao
desenvolvedor; esgotado o escritor, a escada da §121 (reparo pelo auditor com
`repairBlock`, validação pelo verifier) e, no fim, o impasse mecânico de
sempre. `evaluateReadiness` ganha o item "propriedade" (13 itens): o gate
RALPH READY recusa publicar o que o ciclo devolveria — nem "publicar" no
impasse passa por ele, como já era com cobertura e I-16. E o `change`
(`change/orchestrator.ts`), que não passa por `auditOnce` nem por
`evaluateReadiness` — nunca passou: não tem I-16, cobertura nem
dimensionamento, e a §123 o deixou fora do I-17 de propósito —, ganha a
mesma conferência sobre o documento montado antes de gravar: a fase nova em
conflito é pedida de novo uma vez, com o achado ("## Your previous attempt
was rejected (I-18)"); se insistir, `ChangeBlockedError` com o arquivo e as
fases, e o plano em disco não muda. Era a única porta por onde um plano com
escrita concorrente chegava ao build sem gate.

**Triagem.** O prompt troca "if any valid implementation satisfies both, use
ADVISORY" pelas três situações do pedido: KEEP quando os documentos, COMO
ESTÃO ESCRITOS, ordenam ou permitem comportamento incompatível mesmo que um
implementador cuidadoso o evitasse ("a possible implementation is not a
correction; the executor follows the text literally, so the text must change
— that is a localized documentary fix, and it is KEEP"); ADVISORY só para
falso positivo — o trecho acusado não diz o que o achado afirma, ou um
contrato explícito já o resolve — citando ESSE trecho; nunca por uma
interpretação que o documento não estabelece nem pela intenção da
arquitetura quando o texto da fase a contradiz; a substituição entre fases é
sequência quando a fase posterior ORDENA a substituição e depende da
anterior, "a replacement nobody orders is not a sequence". E a metade em
código, `applyMaterialityReview`: um achado que envolve duas ou mais fases —
as citadas no endereço mais a fase declarada por quem chamou, lidas pelo
MESMO tokenizador que escolhe os destinos das emendas (`phaseReferences`,
`contract/phase-references.ts`, usado por `affectedPhases` e pela triagem;
nenhuma regex de fase fora do contrato) — só é descartado se a evidência cita
CADA uma dessas fases; caso contrário o parecer é recusado ("a triagem
descartou um conflito entre as fases 1, 3, 4, 5, 6 sem citar o texto da(s)
fase(s) 3, 4, 5, 6") e o bloqueio continua, como já acontecia com citação
inventada. O achado POR FASE ("T1.C1 vs P1.T1.C1", `phase: 2`) recebe os
dois lados na mesa — `materialityInput` une a fase declarada às citadas ao
escolher as fontes, em vez de parar na declarada como a emenda faz — e exige
os dois: no `haiku` os auditores por fase também apontaram a escrita
concorrente, e a fundação acusada nunca chegava à triagem. Uma citação que é
só rótulo estrutural ("**Acceptance criteria:**", que existe em toda fase)
não prova nada e é recusada como inexistente. É o §6.A do pedido — "pode ser
descartado com evidência ESPECÍFICA" — tornado verificável: para dizer que a
fase acusada não ordena o que o achado afirma, é preciso ter o texto dela na
mesa. O parecer real da rodada 4 do `haiku` (F6: P1 + esqueleto) é recusado
por essa regra; um falso positivo de verdade — as fases corrigidas, que não
ordenam a escrita, cada uma citada — continua descartável, e o código
concorda (zero conflitos no mesmo plano); um achado de uma fase só continua
descartável com uma citação.

**Prompt da fase.** Uma regra nova em "Writing for an economical executor":
arquivo compartilhado de um componente que esta fase só CONSOME é consumido,
nunca reregistrado; quando a fundação entrega o ponto de extensão já com a
entrada deste módulo, a fase implementa os próprios arquivos e os critérios
verificam que a entrada existe; quando o componente compartilhado está entre
os DESTA fase, a arquitetura a ordenou depois das outras que o editam e a
task escreve o registro (a terceira saída da §119 continua válida); a task
que manda acrescentar ou registrar em arquivo que outra fase sem ordem com
esta também edita é recusada mecanicamente (I-18); a ordem entre fases é da
arquitetura. É a última defesa, não a única.

### 124.5 O que NÃO muda, de propósito

- O build (`src/loop/`) e o escalonador: o I-18 protege o que eles leem, sem
  tocá-los. A arquitetura continua serializando por componente (§119) — o
  I-18 nunca acrescenta `dependsOn`: reporta, e a emenda não tem como mudar o
  envelope da fase.
- A triagem continua existindo, com o mesmo custo (uma chamada quando há
  achados de modelo), e falso positivo continua descartável — com o texto
  dos dois lados.
- Nenhuma chamada no caminho limpo: o I-18 é determinístico; o teste 19
  prova a lista exata de chamadas (quatro escritas, cinco leituras, ensaio).
- Nenhum papel novo, nenhuma dependência nova, nenhum limite de retries
  alterado.
- O self-check mecânico continua devolvendo UMA classe por rodada (referência
  de design, cobertura, I-16, I-18, task inchada, dimensionamento), com um
  orçamento mecânico só (`maxMechanicalRounds`, sem o crédito de progresso
  da §120): o I-18 alonga essa cadeia em um degrau. Juntar as classes numa
  devolução só é a melhoria certa, e fica anotada; não é desta correção.
- O que o ADVISORY continua fazendo: aprovar a fase e gravar a coerência
  como aprovada (orchestrator, depois da triagem). Um achado descartado com
  os dois lados citados não é reverificado enquanto os endereços não mudam —
  é o preço da memória de julgamentos (§120), e é a pergunta 5 do pedido,
  que segue respondida "não" para tudo o que não é I-18.

### 124.6 Testes: RED → GREEN

`test/contract/ownership.spec.ts` (25), sobre as tasks reais do `haiku` e os
casos da revisão adversarial: leitura das obrigações de escrita (criar,
acrescentar, registrar, ajustar, "registrá-la"; consumo, origem, presente
descritivo e condicional ignorados; diretório explícito), critérios nunca
são escrita, os cenários 1, 2, 3, 4, 5, 6, 14/15, 16 e a forma do erro;
negação e preposição antes do verbo; ponto-e-vírgula, dois-pontos,
parênteses e passiva; genitivo e locativo composto como destino, origem como
origem; código entre crases; nome com ponto na prosa, barra invertida, glob;
coordenação que fecha a subordinada e homógrafos; nome solto ambíguo contra
arquivo de raiz; o mesmo em inglês; criador entre as concorrentes, dono que
todas alcançam, fundação implícita como no escalonador, acento preservado; e
a calibração reproduzível sobre o plano real como fixture (os oito conflitos
nas linhas publicadas, dezenas de obrigações sem conflito, o plano corrigido
limpo). `test/loop/escalonador-contrato.spec.ts` (6): `effectiveDependencies`
igual a `dependenciasEfetivas` em seis formas de `Depends on`.
`test/audit/materiality.spec.ts` (+5): parecer que cita só um lado recusado
e nomeando a fase que faltou; parecer que cita só esqueleto/arquitetura/pedido
recusado; achado de uma fase só continua descartável; achado POR FASE
recebe e exige os dois lados; rótulo estrutural não é citação. (O teste que
procurava frases no prompt saiu: o pedido proíbe esse tipo de teste.)
`test/change/change.spec.ts` (+2): duas fases novas sem ordem que escrevem no
mesmo arquivo voltam ao escritor com o I-18 e o plano sai sem a escrita; o
escritor que insiste para o `change` sem publicar. `test/init/triagem-124.spec.ts`
(10), provider falso sobre um esqueleto, uma arquitetura e fases modeladas no
Parallel Lab (fundação com `modulos.ts` e as duas entradas; dois módulos sem
ordem entre si mandando registrar de novo): 9/10/11 emenda só nas fases que
escrevem, com `P2.T1` no endereço, I-18, dono e componente no prompt,
nenhuma triagem, instrução contraditória fora do publicado, contrato do
produto e critério de estado preservados — e a emenda INVASIVA (que reescreve
a task vizinha e tenta acrescentar `Phase 3` ao `Depends on`) tem a task
vizinha devolvida byte a byte e o envelope mantido pelo harness; 12 escritor
insiste, auditor repara com o `repairBlock`, só o verifier lê depois; 13
escritor, reparador e "publicar" do desenvolvedor: NOT READY pelo item
"propriedade", nenhum auditor de modelo leu o plano contaminado, menos de 30
chamadas; 13 (gate) o plano do Haiku reprova em `evaluateReadiness` e o
corrigido passa; 7 o parecer real da rodada 4 não remove o bloqueio; 8 o
falso positivo de verdade — fases corrigidas, cada uma citada — é descartado
e o I-18 concorda; 18 `raiz` → `root` sem substituição ordenada: parecer com
só P1 recusado, fase 1 emendada para `root`, sem ressalva; 17 `raiz` → `root`
com a fase 2 ordenando a reescrita: parecer com P1 e P2 aceito, zero emendas,
ressalva; 19 caminho limpo com a lista exata de chamadas; 20 auditor que
reinsiste depois de resolvido: o I-18 devolveu uma vez e não volta a
disparar, a escada sobe os degraus de sempre (texto idêntico, troca de
estratégia, dois reparos) e termina em `InitBlockedError` — com a altura
exata pinada (4 coerências, 4 triagens, 27 chamadas), para que um degrau a
mais seja regressão e não folga. RED contra a `fix/fronteira-init-plan-123`:
23 falhas na primeira versão (os 12 do contrato por módulo inexistente; 3 da
triagem; 7, 9/10/11, 12, 13, 13-gate, 18, 20; e a contagem de 12 → 13 itens
do gate); a segunda versão, depois da revisão adversarial, acrescenta os
casos acima, que falham sobre a primeira versão do detector por construção
(negação, aparte, genitivo, crase, prosa com ponto, ambiguidade, fundação
implícita, endereço de task, achado por fase, `change`). Verdes antes e
depois, de propósito: 8, 17, 19 e o achado de uma fase só — são a
preservação do descarte legítimo e do caminho limpo. `npm run check`:
2725 testes em 143 arquivos.

### 124.7 Custo

No `haiku`, a sequência teria sido: rodada mecânica 1 (critérios a mais, como
foi) → rodada mecânica 2: I-18 devolve oito achados a quatro fases, quatro
emendas em paralelo (uma chamada cada) → auditoria por fase + coerência +
triagem sobre um plano sem o conflito. Contra o que foi: três auditorias de
coerência (170 KB de prompt cada), três triagens (120–136 KB cada), sete
auditorias por fase e dez emendas gastas em torno de um defeito que a
primeira leitura já tinha descrito. O caminho limpo não muda.

### 124.8 Limitações e riscos

- O I-18 lê a frase da task por forma. Verbo fora da lista ("Fazer o servidor
  entregar a interface… no ponto de entrada em `src/servidor`", "Versionar"
  entrou; "Garantir que `X` contém…" é verificação), nominalização ("Criação
  de `X`"), ou um "Depois de criar `a.ts`, registrar em `b.ts`" (preposição
  antes do infinitivo é lida como descrição) escapam; falso negativo é o
  estado anterior. Falso positivo exige verbo de escrita governando um
  caminho na mesma oração, em duas fases sem ordem efetiva, e custa uma
  emenda com o dono nomeado.
- Nome solto sem diretório fora da lista de raiz nunca conflita: "Criar
  `rotas.ts`" numa fase e "`src/servidor/modulos/tarefas/rotas.ts`" noutra são
  chaves diferentes, e um conflito real escrito assim escapa. O preço
  inverso — dois `rotas.ts` de módulos diferentes acusados — era pior.
- Quando nenhuma fase comum cria o arquivo em conflito (duas fases paralelas
  que acrescentam dependências ao `package.json`), a dica manda retirar a
  escrita e descrever a necessidade como critério; a lacuna resultante é do
  arquiteto, e o run pode terminar no impasse mecânico com esse diagnóstico.
  É a saída honesta: a emenda não tem como serializar, e o plano não é
  reorganizado por um achado mecânico. Quando a própria fase em conflito é a
  única criadora, a dica manda manter a criação e diz que a divisão está
  errada — também é o arquiteto que resolve.
- O self-check mecânico devolve uma classe por rodada e o orçamento mecânico
  não credita progresso: um plano com quatro classes de defeito mecânico
  corrigidas uma por rodada chega ao impasse mecânico depois de três rodadas
  perfeitas, e o I-18 alonga a cadeia em um degrau. Juntar as classes numa
  devolução só (como a §120 fez com os achados de modelo) é a próxima
  melhoria do ciclo, não desta correção.
- A regra dos dois lados vale para achados que envolvem duas ou mais fases
  (citadas no endereço ou declaradas). Um achado de uma fase só ("Phase 6 ·
  Task 2 manda adicionar o que a fundação entregou") continua descartável com
  uma citação — é o prompt que o protege, e o I-18 quando há concorrência. E
  a citação precisa existir e ser substantiva, não sustentar a razão: um
  parecer que cita cada fase com uma frase qualquer passa — é o modelo que
  julga, e é a segunda chamada barata que o pedido manteve.
- O ADVISORY continua aprovando a fase e a coerência: um achado descartado
  com os dois lados citados não é reverificado enquanto os endereços não
  mudam (pergunta 5 do pedido). Só o I-18 é reconferido a cada rodada e no
  gate, porque é código.
- O auditor que insiste num ponto já resolvido pelo I-18 não é reconhecido
  como repetido: sobe a escada de sempre (texto idêntico, troca de
  estratégia, dois reparos) e termina. Com um verifier real, o parecer que
  cita as fases corrigidas descarta o achado na primeira triagem; o teste 20
  modela o pior caso, com a triagem mantendo tudo, e pina a altura da escada.
- `raiz` → `root` continua decisão do modelo: a substituição ordenada pela
  fase posterior é sequência (17), a só imaginada exige correção (18), e o
  que separa as duas é o parecer citar — ou não — o texto da fase que ordena.
- A regra nova no prompt da fase muda o texto de toda escrita de fase, e o
  cache do `plan` é chaveado pelo prompt (`plan-cache.ts`): um `capivara plan`
  retomado com este binário reescreve todas as fases e repaga as auditorias
  das que mudarem de bytes. É a autoinvalidação de sempre, e é o que o
  `haiku` retomado vai pagar — anotado aqui para não parecer defeito.
- Validado só com o provider falso sobre os textos reais e com a calibração
  sobre o plano real como fixture; nenhum run real depois desta implementação.

## §125 — BUILD vNext: prova, defeito e recuperação localizada

### 125.1 O pedido e o ponto de partida

O pedido foi a implementação integral do contrato `BUILD_VNEXT_ESPECIFICACAO.md`
(na raiz do repositório, fora do histórico; sha256 `63e3b14e…`), numa
empreitada só, em branch própria — `feat/build-vnext`, sobre a
`fix/triagem-124` @ `988bbdb`, 0.6.2 —, sem merge, push nem release. A
especificação é a autoridade, e os contratos do INIT e do PLAN
(`capivara-skeleton/v2`, `capivara-architecture/v1`, `capivara-phases/v2`)
não mudaram.

O BUILD da 0.6.2 tinha cinco gates bons e uma recuperação em esteira:

- o runner guardava UMA causa (`lastGate`/`lastCause`, sobrescritos a cada
  volta), e um reparo em qualquer gate refazia G2→G3→G4 inteiros
  (`verificarTudo`) — a correção de um roteiro do G4 pagava suíte e
  verificação de novo;
- o mesmo defeito ganhava cara nova em cada gate, e a estratégia que não
  funcionou era tentada outra vez sem informação nova;
- o reparo pelo verificador tinha um orçamento por FASE: o G2 gastava a vez
  do G3;
- o ciclo esgotado encerrava a fase; cada ciclo novo voltava ao executor
  com a fase inteira;
- o diagnóstico do verificador só existia como texto dentro do prompt
  seguinte — nada persistido, nada imutável, nada que sobrevivesse a uma
  queda;
- a arquitetura que o PLAN decidiu (`architecture.md`) não chegava a quem
  implementa nem a quem verifica (a lacuna que a própria especificação
  aponta no §11);
- um conflito de cherry-pick no paralelo desfazia a integração e mandava a
  fase refazer sozinha, com o arquivo em conflito na versão da árvore
  integrada — o trabalho aprovado da fase naquele arquivo ia embora;
- com `--keep-going`, uma fase falhada terminava em "todas as fases
  verdes", código 0; o reparo da aceitação ficava fora do histórico; a
  parada apontava logs pelo número do ciclo; "fechada antes" era afirmado
  só pelo texto da fase.

### 125.2 A forma da solução: quatro registros do Core, o resto reaproveitado

| peça | onde | contrato |
|---|---|---|
| fatia da arquitetura | `contract/architecture.ts`, `loop/arquitetura.ts` | `architectureSliceForPhase()` (o da 0.6.2, byte a byte) vai a executor e verificador; a identidade da fatia é o JSON canônico do que a fase entrega e consome |
| livro de evidências | `loop/evidencias.ts` | `capivara-evidence/v1`: JSONL só de acréscimo em `runs/<id>/evidence.jsonl`; prova com entradas (documentos, código como árvore Git, ambiente), escopo e artefatos; validade em linhas próprias, com motivo |
| registro de defeitos | `loop/defeitos.ts` | `capivara-defects/v1`: instantâneo atômico por fase em `runs/<id>/defects/<Pxx>.json`; tentativas, estratégias sem progresso e rediagnósticos dentro dele; orçamento DERIVADO das tentativas |
| handoff do verificador | `loop/handoff.ts` | `capivara-verifier-handoff/v1`: o diagnóstico original, imutável (`link`), por run+fase+gate+ciclo+defeito, gravado antes de qualquer reparo |

E o narrador (`loop/narrador.ts`): uma transição relevante é um objeto, uma
função pura faz a linha, e a MESMA linha vai à TUI (`onProgress` de
recuperação e `announce`), ao `events.tsv` (assunto `Pxx:recuperacao`,
status `started`, para não mexer na retomada nem nas contagens de retry) e
ao relatório.

Reaproveitado sem reescrever: o parser e o splitter das fases, os stamps e o
preflight, os cinco gates (`gates.ts`, `flows.ts`), o ledger de fases, a
memória de tasks (`TasksAprovadas`, §75), o worktree e a integração do
paralelo, a política de admissão de commits, o escalonador, a escrita
atômica e os caminhos do plano de controle.

### 125.3 Checkpoints

**A — a arquitetura chega a quem faz e a quem julga** (`ef92e8e`). O CLI lê
a arquitetura estruturada que o `plan` guardou; `checkArchitectureBinding`
a confere contra `architecture.md` e o carimbo do `environment.json` ANTES de
qualquer sessão (divergência é erro, código 1). Cada fase recebe a fatia
(contratos próprios, consumidos, fluxos, decisões de dados) nos prompts de
implementação, correção, verificação e reparo. Fase fechada com fatia
diferente da atual volta em modo revalidação: sem sessão de implementação,
o verificador julga contra o contrato novo.

**B — evidências e impacto** (`aec6a4e`). O estado do código é conteúdo: um
índice temporário a partir do HEAD recebe exatamente o que o commit da fase
levaria (`alteracoesParaCommit`) e `write-tree` dá o id — um WIP commitado ou
uma integração que não tocou nada não mudam a prova. O impacto de uma
mudança é NONE (mesmo conteúdo), AFFECTED (toca o que a prova cobre) ou
UNKNOWN (não se demonstra nem uma coisa nem outra). Sem grafo próprio e sem
análise semântica: arquivos que a task cita, arquivos que a arquitetura fixa
para os componentes, commits `feat(phase-N)`.

**C — revalidação seletiva e G4 condicional** (`bdb7d94`). Depois de cada
ação, `revalidar` invalida só a prova atingida, com o motivo; o que não foi
atingido continua de pé. G2 roda quando não há prova PASS válida para o
conteúdo e o ambiente de agora (identidade do ambiente: runtime e ABI, marca
de instalação Node, lockfiles instalados, `.env`, bancos declarados,
comando). G3 recebe três blocos: "Already DONE" para o mesmo conteúdo,
"Previously approved — confirm against what changed" com a lista dos
arquivos para o desconhecido, e o resto sob verificação; o desconhecido
NUNCA é aprovado em silêncio. G4 é NOT_APPLICABLE sem porta, servidor,
navegador nem roteirista quando a fase não tem fluxo próprio e a regressão
continua provada: todo arquivo mudado tem dono demonstrado fora do fecho de
dependências dos componentes que o fluxo atravessa, não é manifesto, lock,
migração ou configuração, não divide pasta com arquivo do fluxo, e — da
revisão — não é arquivo preexistente que nenhum commit de fase escreveu
(dono desconhecido é desconhecido, nunca "fora").

**D — defeitos, escada e orçamento** (`bdb7d94`). Identidade determinística
entre gates: a mesma task, o mesmo fluxo e passo (com a mesma natureza —
roteiro errado e produto errado são defeitos diferentes), a suíte enquanto
não fecha, a citação literal da mesma mensagem, ou o id `[Pxx-Dn]` que o
verificador cita e o Core confere. Escada por natureza: o achado do
verificador vai primeiro ao executor e depois ao verificador que o
diagnosticou (§6); a suíte vermelha começa pelo reparo assistido (§114);
roteiro e revisão do G4 têm as próprias. Orçamento em três escalas
independentes — defeito, gate, ciclo — derivado das tentativas; padrões 3,
2 e 6 (a soma dos três gates que reparam), configuráveis por
`--repairs-per-cycle/gate/defect`, pelo Wizard ("Reparos por ciclo") e
fotografados no `run.json` (`budgets`). A regra de progresso (§5.3): falha
diferente sem regressão E ação que mudou algo; a mesma falha reescrita em
outras palavras não é progresso (a assinatura do G3 é o critério rotulado,
ou a própria task). Estratégia sem progresso não se repete no MESMO ciclo;
o ciclo seguinte abre sozinho, com contadores novos, código e evidências
intactos, sem voltar à implementação, e recomeça a escada com a história
inteira no handoff — a informação nova. Antes do fim dos ciclos, só para o
que é impossibilidade real: nenhuma estratégia possível, ou tentativas que
não mudaram nada.

**E — handoff, verificador reparador, retomada** (`bdb7d94`). Toda falha
material do verificador grava o handoff ANTES do primeiro reparo, mesmo com
retomada disponível; o prompt do reparo leva o diagnóstico original, o que
mudou desde então, as tentativas e as estratégias que falharam, montado do
que já está registrado (nenhuma chamada de resumo). Cada CLI declara se
retoma (`ContratoDaRetomada`: `--resume`, `--session`, `--conversation`,
`codex exec resume`); nenhuma está "garantida" sem chamada real, então a
retomada é opt-in (`--verifier-resume`). Retomada só é retomada quando o id
que o envelope devolve é o pedido; outra sessão aberta pelo provider recebeu
o handoff no prompt e vale como a sessão nova; a sessão pedida que não
conclui cai em UMA sessão nova. Quem repara nunca valida: a ponte recusa
retomada fora do reparo.

**F — conflito de integração conciliado** (`7be8640`). O conflito de
cherry-pick grava o checkpoint v2 (`integracoes/<Pxx>.json`: arquivos, HEAD
da principal, commit aprovado no branch dele); a reabertura reaplica o
aprovado sobre a árvore integrada mantendo os marcadores (diff3) só nos
arquivos em conflito, e o runner entra em modo conciliação: o defeito
`integracao-conflito` com a escada [conciliação, executor]. A conciliação é
uma sessão do executor limitada aos arquivos em conflito (`conflictPrompt`):
o Core desfaz o que ela mexer fora deles, confere que não sobrou marcador
(prova textual) e revalida pelas evidências o que a resolução e a árvore
integrada mudaram (prova funcional) — aprovações da fase ficam, presas à
árvore em que foram dadas, e o verificador confere contra o que mudou.
Conflito não consome ciclo de implementação. O escalonador passa a usar o
mapa de componentes do PLAN: duas fases cujos componentes a arquitetura fixa
nos mesmos arquivos não rodam ao mesmo tempo.

**G — transparência e entrega proporcional** (`7be8640`). `relatorio.md` e
`relatorio.json` por run, derivados do `events.tsv`, do livro e dos
instantâneos — as mesmas linhas da TUI. A parada aponta o handoff e o log
da evidência que reprovou (`PhaseOutcome.evidencia`), não um nome adivinhado
pelo número do ciclo. A aplicação só é concluída com TODAS as fases
fechadas (o `--keep-going` declarava "todas verdes" com fase falhada). O
reparo da aceitação é provado pela suíte uma vez e commitado pelo Core
(`fix(entrega): …`, com a política de admissão). `entrega.md` diz como rodar
(os passos que a aceitação de fato executou) e as limitações: banco que o
PLAN declara sem migração que a aceitação rodou, fluxo cuja última prova não
vale para o conteúdo entregue, G3/G4 não repetidos sobre o reparo da
aceitação. O ledger guarda o HEAD em que a fase fechou, e "fechada antes"
só é anunciada se esse commit continua no histórico.

**H — reparo documental com pacote validado** (`7be8640`). O verificador
pode alegar, no achado, `UPSTREAM: PLAN|INIT — <documento e trecho>: <por
quê>`. Só com a escada do BUILD esgotada o Core monta o pacote
`.capivara/repairs/upstream/<id>/{manifest.json, diagnosis.md,
evidence.json}` do que está registrado, valida com a função pura
`checkUpstreamPackage` (forma, hashes amarrando o conjunto, seções do
diagnóstico, artefatos, histórico de recuperação, documento ainda na versão
diagnosticada, autoridade certa) e publica de uma vez (pasta temporária,
relida, renomeada); só então o defeito vira `UPSTREAM_REPAIR_REQUIRED`.
Pacote recusado não vira estado e nenhum agente é chamado. O impacto sai do
grafo da arquitetura (as fases que consomem os componentes do contrato
reparado), não da redação da alegação. A entrada do `plan` confere de novo
cada pacote; o que alcança além do defeito pergunta `CONTINUAR COM ESCOPO
AMPLIADO` / `ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE`, e a decisão fica
presa ao hash do impacto mostrado. Na retomada, o defeito que espera o
reparo é reconferido: pacote ainda válido para a fase sem gastar ciclos;
documento revisado, pacote abortado ou sumido devolve o defeito à escada.

### 125.4 O que NÃO muda, de propósito

- Os contratos do INIT e do PLAN, os stamps e o `environment.json`; nenhum
  hash é reescrito para parecer compatível.
- **A edição automática do PLAN/INIT a partir do pacote não existe.** A
  especificação manda não automatizar quando a troca segura não é
  demonstrável (§8.3), e ela não é: a identidade do run do BUILD é o sha do
  plano, o carimbo do `environment.json` amarra plano, esqueleto e
  arquitetura, e o PLAN publica pelo pipeline de escritor, auditor e
  triagem — uma edição localizada fora dele quebraria a certificação, e
  dentro dele a reprodução de uma fase só não está provada. O que existe é o
  diagnóstico transferível, validado na saída e na entrada, e o estado
  recuperável. A fase cujo texto ou fatia mudar depois é revalidada pelo
  BUILD (a fatia e o texto entram na identidade das aprovações).
- O G0 continua sendo o que era; falha de sessão (timeout sem escrita,
  recusa do provider) para com o parcial preservado (§115.17).
- Sem G5: a entrega reaproveita as provas e a aceitação que já existia.

### 125.5 A revisão adversarial

Duas revisões em workflow (lentes independentes, cada achado refutado por
outro agente antes de valer). Sobre o C/D/E: 20 defeitos confirmados por
reprodução, todos corrigidos com teste RED→GREEN
(`test/loop/vnext-revisao.spec.ts`): o G4 que o próprio gate julgou sem
nada a percorrer entrava em laço; o comando de teste que sumia depois da
suíte vermelha também; defeitos de roteiro e de produto no mesmo fluxo se
fundiam; a recuperação da integração herdava o orçamento gasto no worktree;
a prosa reescrita contava como progresso; ação interrompida (credencial,
limite, queda) deixava o defeito em REPAIRING para sempre; o defeito
consertado por outra ação nunca era validado; a implementação que caía por
cota ficava "feita"; a aprovação de outro run valia sob uma regra revisada
do esqueleto (agora presa ao sha do contrato compartilhado); o arquivo
preexistente sem fase autora era dado como fora do fluxo; o fallback da
retomada jogava fora uma sessão que tinha funcionado; o `--rebuild-all`
deixava o handoff antigo para o defeito novo; o parcial descartado como a
parada oferece não recomeçava a fase. Quatro achados foram rejeitados — dois
como desenho (alternância de estratégias entre ciclos; ciclo novo quando o
gate esgota), dois como inalcançáveis ou já cobertos —, e três deles
ganharam reforço mesmo assim: a aprovação dada sem fatia é registrada com
fatia vazia e não vale sob uma fatia que apareça depois; a ação
interrompida reabre o defeito; pedir mais reparos por ciclo dá a cada gate
a sua parte. Sobre o F/G/H: 16 confirmados, também corrigidos com RED→GREEN (nos
arquivos do F/G/H e no `paralelo.spec.ts`): o Git devolve entre aspas o nome
com acento ou espaço, e o marcador não era visto nem o escopo imposto
(agora `-z` em todo caminho que alimenta leitura); conflito binário ou
apagado de um lado contava como resolvido sem decisão; a retomada trocava a
lista do checkpoint pela do conflito novo e o marcador do parcial passava;
o `--rebuild-all` apagava o checkpoint da própria execução; o reparo da
aceitação que quebrava a suíte era absolvido pela tentativa seguinte que
não mudava nada, rodava a suíte crua na raiz (sem banco de teste nem
preparo), não resolvia o comando de teste que só apareceu depois do
preflight, e sem Git não era dito; o commit que o git recusava no worktree
virava "nada a integrar" e o código sumia; o ledger guardava o HEAD de
antes de uma fase sem commit; o relatório não mostrava a falha da
integração nem as fases que não rodaram; o defeito encaminhado ao PLAN não
voltava à escada depois da revisão do documento; o impacto copiava a origem
e nunca pedia autorização; o INIT recebia pacote que ninguém conferia (o
encaminhamento ao INIT foi desligado: §8.3 manda o PLAN primeiro); o
documento era escolhido fora da etapa destino. Um achado foi rejeitado
(evidência `null` — inalcançável).

### 125.6 Testes

`npm run check`: 2866 testes em 152 arquivos (eram 2725 em 143). Arquivos
novos, todos de comportamento (runner de verdade, Git real, provider falso
que escreve no disco; nada de asserção sobre frase de prompt sozinha):
`vnext-arquitetura` (11, A), `vnext-evidencias` (9, B), `vnext-recuperacao`
(17, cenários 1 a 10 do §13 da especificação), `defeitos` (19, o registro
sozinho), `provider/retomada` (16, id de sessão por CLI, flags de retomada,
a ponte que recusa retomada fora do reparo), `vnext-revisao` (15, os 20
achados do C/D/E), `vnext-relatorio` (1, §13.15), `vnext-entrega` (10, §10
e §13.16), `vnext-upstream` (23, §13.12 e §13.13); e no `paralelo.spec` os
cenários do §13.11 e as regressões do F. O §13.14 é provado pelos testes de
fatia do A (fatia mudada volta à verificação sem implementação;
`architecture.md` alterado depois do RALPH READY para o build antes de
qualquer chamada). RED: 13 dos 15 cenários do §13.1–10 falham contra o
runner da B (os dois que passam são controles); 15 dos 15 do
`vnext-revisao` contra o C/D/E sem as correções; 16 das 20 regressões do
F/G/H contra o protótipo (as quatro restantes são controles). Testes
existentes mudados, cada um com comentário §125: a sequência de chamadas
onde o executor agora tenta antes do verificador no G3 (§6), a correção
local que não abre ciclo, o desconhecido que vai ao bloco de confirmação em
vez de "Already DONE", a mesma falha que passa pelos ciclos quando o código
muda e para antes quando nada muda.

Instabilidade conhecida, preexistente e alheia ao BUILD:
`test/init/integridade-122.spec.ts` › "15. o plano correto não ganha
chamada nenhuma" falha em cerca de 1 de 7 execuções isoladas pela ordem de
duas chamadas concorrentes de `writer:authoring:phase-*` — 2 falhas em 14
na base `988bbdb`, 2 em 14 no `bdb7d94`. Não foi tocado.

### 125.7 Medição: antes × depois

Os mesmos cenários de provider falso contra o runner da base (`988bbdb`) e o
do vNext (`_medicao.spec.ts`, fora da suíte). Chamadas por papel, suítes do
G2 e passagens do G4:

| cenário | 0.6.2 | vNext |
|---|---|---|
| S1 uma task incompleta, corrigida | 1 executor, 2 leituras, 1 reparo do verificador; 2 suítes | 2 executores, 2 leituras; 2 suítes (o executor tenta primeiro, §6) |
| S2 roteiro do G4 errado | 1 executor, 1 leitura; 1 suíte; 2 passagens | igual |
| S3 suíte vermelha, reparo do verificador | 1 executor, 1 reparo, 1 leitura; 2 suítes | igual |
| S4 a mesma falha, nada muda | 3 executores, 4 leituras, 1 reparo; 4 suítes; falha | 2 executores, 3 leituras, 1 reparo; 2 suítes; falha |
| S5 correção que não muda o código | 1 executor, 2 leituras, 1 reparo; 2 suítes; 2º prompt de 12 244 caracteres | 2 executores, 2 leituras; 1 suíte; 2º prompt de 10 360 |
| S6 regressão do G4 provada, mudança fora do território | 1 passagem do G4 (sobe a aplicação) | nenhuma |
| S7 suíte vermelha e task incompleta, cada uma precisando do verificador | 3 executores, 1 reparo, 3 leituras; 4 suítes; **a fase falha** (o G2 gastou o único reparo) | 2 executores, 2 reparos, 3 leituras; 3 suítes; **a fase fecha** |

O tempo de parede nos cenários falsos não mede o produto (não há modelo); o
custo do Core por ação ficou entre 50 e 150 ms a mais (write-tree e livro
de evidências). Tokens e custo em US$ só aparecem com provider real — o
registro de custo por defeito existe (`costs`), mas esta empreitada não
rodou modelo.

### 125.8 Limitações e riscos

- **Nada disto rodou com modelo real.** A retomada de sessão é declarada
  "não verificada" em todas as CLIs (a flag existe na versão instalada;
  nenhuma chamada real provou que a sessão somente leitura volta com
  escrita); por isso é opt-in. O `opencode --session` cria sessão quando o
  id não existe — a conferência pelo id devolvido não detecta isso nele.
- **Edição automática do PLAN/INIT a partir do pacote: adiada por
  inviabilidade demonstrada** (125.4). O encaminhamento ao INIT está
  desligado; o validador e o pacote já o suportam.
- O impacto é por arquivo citado, arquivo fixado pela arquitetura e commit
  de fase — sem análise semântica. Por isso o desconhecido é frequente, e é
  resolvido pela consulta limitada ao verificador (uma chamada que já ia
  acontecer, com a lista do que mudou), nunca por aprovação.
- A identidade da fatia não inclui a responsabilidade textual do componente
  nem a infraestrutura (decisão do A: só o que a fase entrega e consome
  reabre a fase).
- O ciclo mostrado na TUI é o da execução (`ciclosAbertos`); o dos defeitos
  e handoffs é o absoluto do run. Numa retomada, os dois diferem.
- O relatório e a entrega são derivados e reescritos a cada execução; a
  autoridade continua sendo `events.tsv`, o livro e os instantâneos.
- Nenhum formato persistido mudou de versão: `evidence.jsonl`, `defects/`,
  os handoffs, `relatorio.*`, `entrega.md` e `.capivara/repairs/` são
  novos; `fases.json` ganhou `head` e `semCommit` opcionais, `tasks.json`
  ganhou `tree` e `contratoSha` opcionais, `run.json` ganhou `budgets`
  opcional, `integracoes/<Pxx>.json` ganhou a versão 2 (o leitor aceita a 1).
  Runs anteriores são lidos como antes; nenhuma migração é necessária. A
  mudança de comportamento leva a versão a 0.7.0 (nesta branch, sem
  publicação); o carimbo do `environment.json` grava a versão mas não a
  confere, então planos da 0.6.x entram no build da 0.7.0.

## §126 — O impasse INIT → PLAN: o procedimento da execução de teste não é requisito, e o envelope de fase se corrige na arquitetura

### 126.1 A evidência: Luna, Parallel Lab (0.7.0)

Run `init-dc741f0d7b92`, projeto `laravel/luna`, 0.7.0. O pedido do Parallel
Lab diz, sobre o banco dos testes, uma frase: "Os testes precisam utilizar
banco isolado dos dados normais da aplicação." O PLAN, que nas versões
anteriores fechava em ~15 minutos, terminou em "Impasse em
project-phases.md após 1 devoluções" na tentativa 11, depois de onze
leituras em que o auditor repetia, com outras palavras: "O Goal e as
descrições das fases mantêm instruções operacionais de criação e destruição
de banco descartável e configuração de DATABASE_PATH, contrariando a decisão
aceita de manter apenas o requisito de isolamento dos dados nos testes." O
desenvolvedor já tinha reiniciado uma vez, e o problema voltou.

Lidos `events.tsv`, os 100 logs e os 100 prompts do run (a pasta
`.capivara` foi removida no meio da investigação e restaurada pelo
desenvolvedor sem `handoffs/`; o que dependeria deles está marcado como
incerto abaixo), a sequência é esta (horário local):

1. **09:45–09:46, INIT.** Cinco respostas aceitas, entre elas a de banco:
   "Ainda não existe: o projeto cria o dele, embutido em arquivo". O escritor
   do esqueleto (log `027b515b`) escreveu a regra "testes automatizados: Os
   testes automatizados de cada módulo usam banco isolado dos dados normais da
   aplicação e demonstram …" — sem `DATABASE_PATH`, sem "descartável", sem
   "cria e destrói". Na publicação, `orchestrator.ts` acrescenta, DEPOIS do
   parser, `regrasDeBanco("embutido")` (`interview/banco.ts`): entre elas "o
   exemplo precisa RODAR: … testes e fluxos fornecem pela mesma variável de
   ambiente outro arquivo temporário, criado e destruído pela própria
   execução …" (§115.10) e "banco dos testes: a suíte automatizada e os fluxos
   rodam contra um banco descartável, criado e destruído pela própria execução
   dos testes …" — as linhas 92 e 94 do `skeleton.md` publicado. Quem
   acrescentou o procedimento foi o HARNESS: não o escritor, não o
   renderizador, não o auditor.
2. **09:47–09:52, arquitetura.** Aprovada em três rodadas, com o lado da
   aplicação — "O caminho do banco é obtido de DATABASE_PATH", "A aplicação
   aceita DATABASE_PATH apontando para outro arquivo SQLite local" — e goals
   que diziam "atendendo ao requisito de testes automatizados com banco
   descartável".
3. **09:57–09:58, fases, rodada 1.** Dois achados endereçados a
   "Architecture" (a fase 4 consome a integração que só a 5 entrega) →
   reorganização 1 de 2.
4. **10:04, auditoria da arquitetura refeita, rodada 5** (log `63383eb0`):
   "O skeleton exige que os testes e os fluxos usem um banco descartável
   criado e destruído pela própria execução. A arquitetura exige apenas um
   caminho DATABASE_PATH …; não atribui a nenhum componente ou fase a criação
   e a destruição do arquivo | Atribuir ao mecanismo de execução dos testes e
   dos fluxos a criação e a destruição do banco descartável, mantendo o uso de
   DATABASE_PATH". O arquiteto obedeceu (10:05): o procedimento entrou na
   responsabilidade e no contrato dos três módulos, numa decisão de dados
   ("banco descartável"), num requisito de ambiente e no goal das fases 2 a 5.
   A rodada 6 aprovou "porque a arquitetura atribui à execução dos testes e
   fluxos a criação e destruição". `aplicarArquitetura` republicou o
   `skeleton.md` com esses goals (linhas 99–102).
5. **10:07–10:11, fases, rodadas 3 a 5.** Os auditores de fase, aplicando a
   responsabilidade do planejamento ("no criterion saying … how test execution
   is organised", "validation procedures"), mandam tirar o procedimento (P4 r3,
   P2 r5 "Goal e critério da tarefa de exclusão"); o da fase 3 (r4) manda
   ACRESCENTÁ-LO "como determina a arquitetura". Duas auditorias, a mesma
   autoridade, leituras opostas. O escritor não fecha em quatro devoluções →
   reparo pelo auditor (1/2), verifier, reparo (2/2).
6. **O reparo não podia fechar.** A emenda — do escritor e do auditor que
   repara — devolve só as tasks: "Return only its tasks; the harness owns its
   envelope" (prompt `authoring.phase-p02.auditor.8`; em código,
   `planoAutorado` → `extractTasks` + `assemblePhase(envelope, …)`). O Goal é
   envelope, e o envelope vem da arquitetura. `ehDeArquitetura` só leva à
   arquitetura o achado cujo `where` começa por "Architecture"; "Goal",
   "Phase 4, Goal" e "Phase 2 vs Phase 3 vs Phase 4 vs Phase 5" iam à emenda.
   A segunda reorganização, a única saída que alcançava o texto, nunca foi
   usada.
7. **10:13, rodada 7.** Verifier de P2: "Goal | Determina que a execução dos
   testes e dos fluxos crie e destrua o banco descartável e forneça seu caminho
   por DATABASE_PATH, prescrevendo como a execução é organizada | Remova essa
   instrução operacional e mantenha apenas o requisito de que os testes
   automatizados e os fluxos usem um banco isolado". A triagem manteve (com a
   razão contraditória "a instrução operacional do Goal é exigida pelas
   fontes"); com os dois reparos gastos, `maxReturns` 0 → impasse →
   `levantamentoDeAuditoria(todos)` → três pontos arbitrados ("Qual dos dois
   entendimentos vale?", a leitura do auditor recomendada) e gravados como
   decisões ACEITAS. É ESTA a "decisão aceita" que os auditores passam a
   citar: ela aparece em "## Confirmed decisions" do prompt seguinte ("Goal:
   Remova essa instrução operacional e mantenha apenas o requisito …",
   "(o desenvolvedor confirmou esta leitura: ela é autoridade)"). O
   `ACCEPTED: none` do prompt da entrevista não a mostra porque ela nasceu
   depois. Se foi número digitado ou o Enter que aceita a recomendada, o
   handoff que diria não foi recuperado.
8. **Rodadas 8 a 11.** O mesmo Goal, reescrito, na fase 2 e depois nas 3, 4
   e 5 e na coerência ("as descrições das quatro fases …"): mais duas
   arbitragens (2 e 4 pontos), o teto de arbitragem, o impasse, o "reiniciar"
   do desenvolvedor — e, com os reparos já gastos e `modoReparo` mantido, o
   impasse seguinte veio na primeira reprovação: "após 1 devoluções" conta só
   a história zerada pelo reinício.

### 126.2 As perguntas do pedido

1. **Sequência.** Acima.
2. **Quem introduziu as instruções.** O procedimento ("criado e destruído
   pela própria execução") entrou pelo harness (`regrasDeBanco`, publicação do
   INIT). `DATABASE_PATH` entrou pelo arquiteto, do lado da aplicação, na
   primeira arquitetura — legítimo. A junção dos dois no goal das fases ("a
   execução … cria e destrói … e fornece seu caminho por DATABASE_PATH") foi
   do arquiteto, sob a ordem da auditoria da arquitetura na rodada 5, e chegou
   ao `skeleton.md` por `aplicarArquitetura`.
3. **Decisão posterior à entrevista.** Sim: as arbitragens das rodadas 7, 8
   e 9, gravadas como ACEITAS por `levantamentoDeAuditoria`/`decisaoGravada`.
4. **Como as decisões viajam.** `allAnswers` ACEITAS → `writer.decisions` →
   "Confirmed decisions" em todo prompt de escrita, emenda, reparo e
   auditoria, e no do arquiteto (`promptDoArquiteto`); handoff
   `project-phases.md.json`, recarregado pelo `plan` seguinte. A autoridade
   de I-16 (`autoridadeDeTeste`) exclui as decisões de auditoria/impasse/
   ensaio — mas os prompts as recebem com "the confirmed decision wins".
5. **Por que a auditoria anterior aprovou, e reforçou.** A regra do harness
   dizia o procedimento; o `MECHANISM_BOUNDARY` (`prompts/architecture.ts`,
   §123) dizia ao arquiteto e ao auditor que as regras de banco, "the
   disposable database for tests and flows", eram "requirements the harness's
   gates depend on: keep them exactly"; e a I-16 não tinha forma para "a
   execução dos testes cria/destrói/fornece" — nem a arquitetura nem a
   correção do auditor (`semPrescricaoDeTeste`) foram conferidas.
6. **Por que a recuperação não aplicou a correção.** O envelope (item 6
   acima).
7. **Os quatro apontamentos do Goal.** Não eram falsos: os quatro goals
   continham a frase, e a decisão aceita mandava tirá-la. Eram UM defeito de
   origem (a divisão de fases da arquitetura) em quatro endereços, cada um
   inalcançável pela emenda. A identidade por vocabulário (§122) não os
   juntava — as leituras reais do Goal da fase 2 nas rodadas 7 e 8 têm Jaccard
   0,24 —, e a arbitragem guarda o que já perguntou pelo texto exato
   (`marcaDoProblema`), então cada redação nova voltava ao desenvolvedor.

### 126.3 A causa-raiz

Duas metades, uma em cada estágio.

**No INIT, a regra do harness.** As regras de banco existem porque os gates
dependem delas: a aplicação lê o banco do ambiente, o `.env.example` sobe a
aplicação sozinho, a migração tem nome, e os testes nunca abrem o banco de
quem os roda. "Criado e destruído pela própria execução dos testes" não é
nada disso: é o PROCEDIMENTO da execução, exatamente o que a responsabilidade
do planejamento reserva ao build ("validation procedures", "how test
execution is organised"). O harness escreveu, como produto, o que ele mesmo
proíbe o plano de prescrever — e a §123 ainda mandou o PLAN mantê-lo
"exactly". As duas regras do harness se contradiziam, e a auditoria da
arquitetura obedeceu a uma e a de fase à outra.

**No PLAN, o caminho de volta.** Um achado sobre o envelope de fase — goal,
título, dependências, cobertura — é um achado sobre `architecture.md`, por
mais que seja lido em `project-phases.md`. O ciclo do plano não tinha esse
caminho: o achado ia à emenda da fase (que não alcança o envelope), ao reparo
pelo auditor (idem), ao verifier, à arbitragem do desenvolvedor e ao impasse.
O desenvolvedor virou a única saída de uma contradição interna da Capivara.

### 126.4 O que muda

**A regra do harness** (`interview/banco.ts`). "banco dos testes": "a suíte
automatizada e os fluxos rodam contra um banco descartável, isolado do banco
normal da aplicação; nenhum teste lê, escreve ou migra o banco configurado no
`.env` do desenvolvedor. Como cada execução obtém e descarta esse banco é
decisão do build, não do plano nem desta regra: não é responsabilidade de
componente nem objetivo de fase" — a mesma forma da ressalva da migração
(§123). "o exemplo precisa RODAR" (embutido): "testes e fluxos usam outro
arquivo temporário, isolado, que a aplicação aceita pela mesma variável de
ambiente, sem tocar o banco normal …" — o arquivo isolado e a variável
continuam (§115.10); quem cria e destrói sai. O que os gates precisam está
inteiro: `loop/ambiente.ts` semeia o `.env` do exemplo e roda `migrate`, o G4
sobe a aplicação do exemplo, e a suíte do projeto não toca o banco do
desenvolvedor.

**A fronteira dos prompts da arquitetura** (`MECHANISM_BOUNDARY`). As regras
de banco continuam requisito dos gates, mas o que se mantém "exactly" é o que
elas exigem da APLICAÇÃO (ler o banco do ambiente e aceitar por ele um banco
isolado separado; o nome da migração). "How a test run obtains, points to and
discards its database is neither yours nor a phase's: the build decides it …
It is never a component's responsibility or contract, a data decision, an
infrastructure requirement or a phase goal, and an architecture that leaves it
out is missing nothing." Dito aos dois papéis: o auditor também precisa saber
que a ausência não é defeito.

**I-16, o procedimento da execução** (`contract/test-prescription.ts`). Forma
nova, a das frases do run: a execução de teste (ou "os testes", "a suíte",
"cada teste") como sujeito de verbo de ciclo de vida — criar, destruir,
remover, apagar, descartar, fornecer, definir, configurar, preparar, apontar,
exportar —, no indicativo, no subjuntivo ou com modal ("devem criar"), até
quatro palavras depois, sem negação; a atribuição nominal ("atribuir à
execução dos testes a criação e a destruição"); e o mesmo em inglês — SEMPRE
com um recurso no resto da oração (banco, base, arquivo, caminho, variável,
SQLite ou um nome de variável de ambiente). O recurso é o que separa o
procedimento do produto: "os testes definem a nota mínima" é um sistema de
provas, "a execução do fluxo 2 cria a tarefa" é um workflow. Fluxo só conta
como teste ao lado dele ("dos testes e dos fluxos") ou automatizado;
"testes" depois de outro substantivo ("o cadastro de testes cria") não é
sujeito; a negação ou o "como" antes do sujeito ("não cabe à execução dos
testes criar o banco", "como a execução dos testes cria o banco é decisão do
build") anulam a frase. O que não é tocado: a propriedade passiva do banco ("um banco descartável, criado e
destruído pela própria execução" — a calibração da §118 e da §122), o lado da
aplicação ("a aplicação aceita DATABASE_PATH apontando para outro arquivo"),
"os testes usam banco isolado", "os testes demonstram …", a negação, o
comando de migração. A autoridade é de PROCEDIMENTO, não de termo: se o
pedido ou uma decisão do desenvolvedor prescreve o que a execução de teste
faz com um recurso ("os testes devem criar um arquivo temporário …"),
nenhuma redação do plano que o repita conta; "os testes criam seus próprios
dados de exemplo" não autoriza nada. A fronteira de palavra é Unicode — o `\b` do
JavaScript vê "cria" dentro de "criação". Por ser `testPrescriptions`, vale
nos mesmos lugares que as outras formas: stack, regras, stories e fases do
esqueleto; overview, componentes, decisões de dados e fases da arquitetura;
tasks do plano; decisões e correções do auditor (`semPrescricaoDeTeste` —
a correção da rodada 5 teria chegado ao arquiteto como a regra, não como
"atribuir à execução …"). Duas metades irmãs: a I-16 da arquitetura passa a
ler também os requisitos de ambiente (compatibilidade e pré-condições), a
única prosa que ela não lia — e onde o run escreveu o procedimento; e quem
APAGA por I-16 (item de infraestrutura, entrada de stack rotulada como teste)
apaga ferramenta, não procedimento: `testToolPrescriptions` decide a remoção,
e um item cujo propósito só descreve o procedimento ("better-sqlite3 — … a
execução dos testes cria e destrói o banco temporário com ele") fica e volta
ao arquiteto como defeito, em vez de levar a dependência da aplicação com ele.
No esqueleto, o procedimento segue o destino do MECANISMO, não o da
ferramenta: volta ao escritor nomeado ("a regra … prescreve o procedimento da
execução de teste (I-16)") e, depois da escada, é publicado com ressalva —
nunca bloqueia, como a §123 decidiu para o I-17. A primeira versão desta
correção o tratava como a ferramenta, e dois testes da §123 pegaram: a regra
do Haiku "os testes automatizados definem APP_DB_PATH para um arquivo
temporário … e o removem ao fim", que a §123 publica com ressalva na terceira
tentativa, passava a parar o esqueleto. Na arquitetura não há modo tolerante
(nunca houve para a I-16): a prosa volta ao arquiteto dentro da escada que ele
já tem.

**O envelope vai à origem** (`audit/envelope.ts`, `auditLoop`). Um achado
cujo endereço nomeia um campo do envelope ("Goal", "Phase 4, Goal", "Phase 3 ·
Depends on", "Objetivo", "Covers", "Áreas"), ou cujo endereço só nomeia fases
e cujo problema fala do goal ou das "descrições das fases" (a coerência), é do
envelope — salvo quando a correção pede task ou critério ("inclua nesta fase
uma tarefa …": o goal promete, quem entrega é a task) ou o achado é mecânico.
Pela prosa, só quando nem o endereço nem o problema citam task ou critério
("P2.T1.C2 exige … P3.T1.C2 exclui …" é contradição entre tasks, e pode ser
decisão de produto). A correção que o auditor escreveu citando a frase chega
ao laço já trocada pela da regra (`semPrescricaoDeTeste`), que fala em
"critério de uma task"; o que decide é a correção ORIGINAL, citada dentro da
troca. Na PRIMEIRA aparição ele segue a emenda de sempre — uma vez é defeito
(§70), e o reconhecimento por forma pode errar para o lado de uma fase que a
emenda conserta. Quando ele VOLTA ao mesmo lugar, em qualquer redação, é
herança. O lugar é a fase, o campo e a assinatura do envelope que está na
mesa (`P2·goal·<sha12 da fase>`): é a identidade que o vocabulário não dava,
e depois de uma reorganização o goal é outro, então um achado sobre ele volta
a ser primeira aparição. Herança:
`achadoNaOrigem` o endereça a "Architecture · Phase 2 · goal (envelope da
fase, escrito por architecture.md)" e ele segue pela reorganização que já
existia (`reorganizar`, §116: arquitetura refeita, auditada, aplicada; as
fases cujo envelope e fatia não mudaram voltam do cache). No fim da escada
(`ask-developer`), qualquer achado do envelope vai à arquitetura ANTES do
reparo, da arbitragem e do impasse. Nunca é arbitrado. Esgotadas as
reorganizações, `planoAutorado` para com o diagnóstico da origem — "o envelope
é escrito por architecture.md, não por project-phases.md … Isto é um defeito
técnico herdado da arquitetura, não uma decisão de produto: nada aqui é seu
para decidir" —, com as estratégias tentadas, os achados de fase que
esperavam a divisão nova e o estado em disco, em vez de "eles seguem para a
sua arbitragem". Quando o roteamento acontece no caminho normal, o ciclo
recomeça sobre a divisão nova (a história zera, como no ramo do impasse), e
não se conta reparo: a reescrita foi a reorganização.

**A arquitetura guardada passa pelo contrato de hoje.** `arquitetar` reaproveitava
o estado em disco quando o esqueleto e a autoridade eram os mesmos, sem
reler: uma arquitetura aprovada pela 0.7.0 com o procedimento no goal voltaria
inteira num `plan` retomado. Agora ela passa pelo mesmo `parseArchitecture`
que um desenho novo — sem chamada — e, se não passa, é desenhada de novo
(o cache por prompt pode devolver o desenho válido sem custo).

**O esqueleto de outra versão do harness** (`plan`). O `plan` lê o esqueleto
gravado, não o reescreve. Quando as regras de banco gravadas diferem das que
`regrasDeBanco` escreveria hoje para a mesma decisão, ele diz quais, segue com
o que está publicado e deixa a rota no relatório: `capivara init` republica o
esqueleto reaproveitando as respostas e a chamada do esqueleto em disco, e
depois `capivara plan`. Só o texto que as versões anteriores escreviam conta
("criado e destruído pela própria execução") — uma regra do escritor com o
mesmo assunto é mantida pelo init e não é "de outra versão" —, e o aviso vai
ao RELATÓRIO, não às ressalvas que todo auditor de fase lê como defeito a
resolver: ninguém no plano corrige a versão do harness que gravou o esqueleto. Trocar a regra dentro do `plan` mudaria o documento
por baixo do desenvolvedor e a identidade de tudo o que foi aprovado sobre
ele; não há garantia de que isso seja seguro, então não é feito.

**O contrato** (`invariants.ts`, `docs/capivara-phases-v2.md` regenerado): o
título e o racional da I-16 nomeiam o procedimento da execução.

### 126.5 O que NÃO muda, de propósito

- `DATABASE_PATH` não é proibido em lugar nenhum. O lado da aplicação — de onde
  ela lê o banco, que aceita outro arquivo por ele — é decisão técnica legítima
  do plano e é publicada como antes (cenário 3).
- Nenhum teto aumentou: devoluções, reparos (2), reorganizações (2),
  arbitragens. O envelope que a arquitetura não conserta para o run dentro
  do orçamento que já existia.
- Nenhum auditor, registro de decisões ou estado novo. O caminho é a
  reorganização da §116; a identidade é um `Set` de endereços no laço.
- A arbitragem dos achados que não são do envelope, a identidade por
  vocabulário (§122), a triagem (§124), o build (`loop/`).
- O prompt do esqueleto, o das fases e o `planningScopeBlock`: intocados, e os
  caches de fase continuam valendo. Os prompts do arquiteto e do auditor da
  arquitetura mudam (a fronteira), e com eles as chaves de cache e de
  aprovação da arquitetura — que, num `plan` retomado com o mesmo esqueleto e
  as mesmas decisões, nem é chamada (o estado é reaproveitado).
- Os esqueletos e decisões já publicados não são editados.

### 126.6 Testes: RED → GREEN

`test/init/impasse-126.spec.ts` (23), provider falso sobre a fixture do run
real: o pedido, a regra do escritor e a US-2.2 byte a byte, um esqueleto de
três fases (fundação, tarefas, categorias) com a decisão de banco embutido, e
três arquiteturas — a legítima (o lado da aplicação com `DATABASE_PATH`), a
contaminada (os textos aprovados na rodada 6: goals, responsabilidade,
contrato, decisão de dados, requisito de ambiente) e uma em prosa sem forma
("cada rodada de testes e de fluxos recebe um banco descartável próprio,
preparado antes e apagado depois"), que só o roteamento alcança. Os achados
são os reais: o da arquitetura na rodada 5, o da fase 3 na rodada 4, e o Goal
rodada a rodada (P2 nas rodadas 7, 8, 9 e 10, P3, P4, a coerência nas rodadas
10 e 11). Cobrem os doze do pedido: (1) o isolamento fica no produto, nas
palavras do escritor e na regra do harness; (2) o esqueleto publicado não
ganha procedimento (as regras passam na I-16 com o pedido como autoridade);
(3) o `DATABASE_PATH` do lado da aplicação passa e é publicado; (4) o goal com
o procedimento volta ao arquiteto (fase, componente, decisão de dados,
requisitos de ambiente nomeados) e não chega ao esqueleto nem à arquitetura;
(5) o auditor da arquitetura que manda atribuir e o de fase que manda
acrescentar recebem a correção da regra, e a mesma frase é julgada igual na
arquitetura e nas tasks; (6) as leituras reais do Goal têm a mesma chave,
embora `mesmoPonto` as separe, e três endereços (P2, P3, coerência)
reescritos a cada leitura são UMA reorganização, com a altura pinada (três
leituras de cada); (7) a origem é dita — no anúncio, no endereço que o
arquiteto recebe e no diagnóstico; (8) nenhuma pergunta de auditoria e nenhum
impasse; (9) a fase 1 aprovada não é reescrita nem reauditada; (10) a fase 2
que mudou de envelope é reescrita e reauditada, e a arquitetura aprovada sobre
um esqueleto com a regra anterior não é reaproveitada; (11) o pedido que fixa o
procedimento o mantém — a mesma arquitetura contaminada passa sem emenda; (12)
o caminho limpo com a lista exata de chamadas da 0.7.0. E as duas metades
irmãs: a dependência com o procedimento no propósito fica e volta como
defeito, a ferramenta continua saindo contando; no esqueleto, a regra que só
descreve o procedimento volta nomeada e, tolerada, é publicada, e a que nomeia
ferramenta continua bloqueando. Os cinco da revisão adversarial (126.7):
falsos positivos de produto e falsos negativos realistas, autoridade de
procedimento sobre recurso, a correção que cita a frase, o achado sobre o
goal novo depois da reorganização, e a arquitetura guardada.

RED contra a 0.7.0 (o `src/` da `feat/build-vnext`, com o módulo novo do
envelope presente): 17 de 23 falham; no 7–10 o desenvolvedor recebe
exatamente "Qual dos dois entendimentos vale?" sobre o Goal, e no 6, sete
perguntas. Verdes antes e depois, de propósito: o requisito intocado pela
I-16, o caminho limpo com as mesmas chamadas, o pedido explícito mantido, o
esqueleto do escritor válido e as duas unidades do módulo novo. Expectativas antigas que mudaram: nenhuma. Os dois testes da
§123 que a primeira versão desta correção quebrou ("tolerado, o mecanismo não
derruba a leitura" e "o resíduo depois da escada não bloqueia") voltaram a
passar pela correção do CÓDIGO — o procedimento tolerado no esqueleto —, não
pela troca da expectativa. `docs/capivara-phases-v2.md` foi regenerado (título
e racional da I-16).

`npm run check`: 2889 testes em 153 arquivos, rc=0 (2866 em 152 antes).

### 126.7 A revisão adversarial

Um revisor independente (um agente, sem escrever na árvore) leu a primeira
versão desta correção e reproduziu sete defeitos, todos corrigidos com
cenário próprio: (1) a correção do auditor que citava a frase era trocada pela
da regra antes do laço, e a troca, que fala em "critério de uma task", tirava
o Goal do envelope — o run voltava ao caminho da 0.7.0, com arbitragem e
impasse; (2) "Phase 2 vs Phase 3 | o goal da fase 2 e o da fase 3 … P2.T1.C2
exige … P3.T1.C2 exclui" virava envelope e parava o run, quando é contradição
entre tasks que a 0.7.0 levava ao desenvolvedor; (3) os lugares do envelope
nunca eram esquecidos, e um achado sobre o goal NOVO, depois da
reorganização, ia direto à arquitetura; (4) qualquer frase do pedido com a
forma ("os testes criam seus próprios dados de exemplo") desligava a
checagem inteira; (5) falsos positivos de produto ("a execução do fluxo 2
cria a tarefa", "o cadastro de testes cria um registro", "os testes definem a
nota mínima", o eco da própria regra) e falsos negativos realistas ("os
testes de cada módulo criam e destroem o banco", "cada teste cria seu banco");
(6) um reparo contado quando a reescrita era a reorganização; (7) a
arquitetura guardada reaproveitada sem passar pelo contrato. Das preocupações
não confirmadas, três viraram correção: o aviso de versão fora das ressalvas
dos auditores e restrito ao texto antigo, a história zerada no roteamento
normal, e `` `Goal` `` e "Descrição da fase" reconhecidos como endereço. A
primeira versão também tratava o procedimento, no esqueleto, como a
ferramenta, e dois testes da §123 pegaram (126.4).

### 126.8 Custo

Caminho limpo: zero chamadas a mais (cenário 3/12, lista exata). No caminho do
run real, com a correção: a arquitetura não sai aprovada com o procedimento
(a I-16 a devolve ao arquiteto na mesma escada de três tentativas, ou a
correção do auditor chega já substituída), e o Goal não chega às fases. Se
uma prosa sem forma passar, o custo é uma emenda de fase (a primeira
aparição) e uma reorganização — arquitetura, uma leitura, as fases que
mudaram —, contra as rodadas 5 a 11 do run: dois reparos, seis leituras de
verifier, três arbitragens, nove perguntas e o impasse.

### 126.9 O run original

Não pode ser retomado com segurança. O `handoffs/` do run não foi restaurado
(`skeleton-state.json`, as respostas da entrevista, o estado da arquitetura e
o cache), e o `plan` sem o estado do esqueleto para com "esqueleto ausente".
Mesmo com ele, o esqueleto gravado carrega a regra anterior e o handoff do
plano carrega as decisões arbitradas ("Goal: Remova essa instrução
operacional…", "P4.T8.C2: … apenas os testes automatizados"), que o `plan`
recarrega como autoridade. A rota é recomeçar: `capivara init --fresh` (a
entrevista são as cinco perguntas, ~1 minuto) e `capivara plan`. Ao validar,
ler: o `skeleton.md` (as regras "banco dos testes" e "o exemplo precisa
RODAR" no texto novo, a regra do escritor intacta); os eventos `authoring
architecture … retry` (um "prescreve teste" do arquiteto é a I-16 nova
trabalhando); o `architecture.md` (`DATABASE_PATH` do lado da aplicação, nenhum
"cria e destrói" em componente, decisão de dados, requisito de ambiente ou
goal); e, se um achado de Goal aparecer, o anúncio "apontam o envelope de
fase … vai à arquitetura — não a você" e um `authoring architecture retry`
em vez de "arbitrados por você".

### 126.10 Limitações e riscos

- A forma nova da I-16 é por padrão: sujeito de execução de teste + verbo de
  ciclo de vida a até quatro palavras. "Cada rodada de testes recebe um banco
  preparado antes e apagado depois" escapa — é o caso que o roteamento do
  envelope cobre, e o cenário 7–10 o usa de propósito. A propriedade passiva
  ("criado e destruído pela própria execução") continua fora, pela calibração
  das §118 e §122; se um escritor de esqueleto a escrever numa regra, a
  auditoria da arquitetura ainda pode cobrar um dono — a fronteira nova diz a
  ela que a ausência não é defeito, e a correção que mandar atribuir é
  substituída pela regra.
- A autoridade de procedimento é por forma e recurso, não por recurso
  igual: um pedido que prescreve o procedimento sobre um arquivo autoriza
  também a redação sobre o banco.
- O envelope é reconhecido pela forma do endereço. Um "Goal" cuja correção
  pede trabalho de task sem dizer "task", "tarefa" ou "critério" ("garanta que
  a fase entregue X") vai à emenda na primeira vez e, se voltar, à arquitetura
  — que pode não ter o que mudar; o custo é uma reorganização, e o fim é o
  diagnóstico, nunca a pergunta.
- Achado de envelope sem fase em lugar nenhum (nem declarada, nem no
  endereço) divide uma chave só (`*·goal`).
- O esqueleto tolera o procedimento e o publica com ressalva; a arquitetura e
  o plano o devolvem. Uma regra de esqueleto escrita assim pode levar o
  auditor da arquitetura a cobrar um dono de novo: a fronteira nova lhe diz
  que a ausência não é defeito, e a correção que mandar atribuir chega ao
  arquiteto já trocada pela regra; se ainda assim não convergir, é a escada
  da arquitetura que termina, em diagnóstico.
- Não corrigidos, observados no run e anotados aqui: a arbitragem guarda o que
  perguntou pelo texto exato (`marcaDoProblema`), então um ponto que não é do
  envelope e volta reescrito é perguntado de novo (P4.T8.C2 na rodada 8); a
  triagem pode manter um achado com uma razão que o contradiz ("KEEP: … é
  exigida pelas fontes"); "reiniciar" com os reparos gastos e `modoReparo`
  ligado leva ao impasse na primeira reprovação, e o impasse diz "após 1
  devoluções" contando só a história zerada; e a oscilação sobre a lista de
  comportamentos da US-2.2 ("os testes demonstram criação válida, …") — o
  pedido exige que cada módulo demonstre, a responsabilidade do planejamento
  proíbe dizer o que a suíte cobre — foi arbitrada pelo desenvolvedor no run
  e não é tratada aqui.
- Validado só com o provider falso sobre os textos reais; nenhum run real
  depois desta implementação.

## §127 — Coerência temporal: o fluxo é cobrado quando o plano diz que ele existe, e a oscilação entre gates é diagnóstico

### 127.1 A evidência: Luna, Parallel Lab (0.7.0 + §126)

Projeto `laravel/luna`. O `init`/`plan` rodou de novo com a §126
(`init-dc741f0d7b92`, 21/10, 15:15–15:38 UTC, 79 chamadas) e publicou
RALPH READY; o build `build-8e24c805009f` (paralelo, três agentes, `gpt-6-luna`)
fechou P01, P02 e P03, e a P04 — Gestão de categorias — parou com os três
ciclos esgotados; a P05, verde no worktree, conflitou ao integrar em
`src/app/routes.tsx` e voltou à fila; a P06 não começou. Os artefatos foram
copiados antes de qualquer leitura (o `.capivara` do projeto não foi tocado);
dois leitores independentes reconstruíram, um o PLAN (prompt → resposta →
achado → correção, por documento e rodada), outro a P04 ação a ação, com as
árvores que o próprio Core gravou no repositório do Luna.

O plano publicado:

- a arquitetura, desde a PRIMEIRA chamada do arquiteto, antes de qualquer
  auditoria: "Cada módulo mantém suas rotas, serviços e componentes; uma fase
  final conecta os módulos ao servidor e à navegação". A origem é o pedido
  ("Integração e verificação consolidada ao final"; "Os módulos independentes
  não devem modificar arquivos compartilhados simultaneamente") e a opção que
  o prompt do arquiteto oferece: "an integration phase that depends on the
  module phases and is the only one to touch the shared component";
- a P04 cobre `categorias, US-3.1, workflow 3`, com o goal "… entregando a
  página do módulo pronta para a integração da entrada compartilhada e da
  navegação na fase 6" e os critérios "O roteador é exportado sem registro no
  servidor central" e "A página exporta `CategoriasPage` e não registra
  caminhos na navegação compartilhada";
- a P06 cobre `workflow 1, workflow 2, workflow 3, workflow 4` e depende de
  P03, P04 e P05: "Conectar os roteadores e páginas dos três módulos ao
  servidor e à navegação compartilhada";
- a P03 e a P05 cobrem os seus workflows sem cláusula nenhuma; a P03 diz "A
  página é acessível em `/tarefas` pelo shell compartilhado".

A P04, lida nas árvores (`git diff` entre as árvores de conteúdo que o Core
gravou em cada ação): a rota `/categorias` em `routes.tsx` entrou na ação 2,
saiu na 3, voltou na 6 e saiu na 8; `registrarModulo('categorias', …)` em
`server/api/index.ts` entrou na 2, saiu na 4, voltou na 7 e saiu na 8; o link
da barra lateral que a P02 tinha entregado saiu na 4 e não voltou. O G4 cobrava
o fluxo 3 (cadastrar uma categoria, passo 1); o G3 cobrava "exportar o roteador
sem registrá-lo no servidor central". 32 das 56 chamadas do build foram da
P04, 28 delas na oscilação, em 27 minutos; quem parou a fase foi o teto de três
ciclos. O commit `wip(P04)` ficou pior que a primeira implementação. A própria
triagem viu a contradição duas vezes ("Há conflito entre o passo 3 do workflow
1 … e os critérios da fase 4, que adiam a integração de Categorias à navegação
para a fase 6"; "Execute este fluxo quando a fase 6 integrar /categorias ao
shell"), e o harness só tinha como resposta reescrever o roteiro ou gravar a
leitura em `decisoes-do-build.md`, que ninguém lê de volta.

E o registro de defeitos não percebeu que era a mesma falha. D1, D2, D5, D7 e
D8 — o mesmo `› passo 1: Cadastrar uma categoria…` com o mesmo localizador —
ganharam ids novos porque a âncora `step` era o `CAPIVARA_ONDE` da triagem,
prosa ("Rota `/categorias`, na página de categorias." / "Rota /categorias na
interface."), comparada por igualdade; cada id novo fazia o anterior virar
RESOLVED "por não reproduzir", a regra de progresso nunca viu a falha voltar, e
cada um começava com o orçamento por defeito cheio. A ponte de citações, por
sua vez, juntou ao defeito do fluxo 3 o achado do G3 que PROIBIA o registro —
os dois citavam `/categorias`. E o relatório do reparo do verificador do ciclo
1 ("Removi a rota `/categorias`") ficou em todos os prompts do executor dos
ciclos 4 a 9; o do ciclo 6 pedia para restaurar a rota e, no mesmo texto,
contava que ela tinha sido removida.

No PLAN, das 79 chamadas cerca de 41 estão em trechos evitáveis. A maior perda,
~26 chamadas e 8 minutos, nasceu da decisão Q-71 ("status inicial de uma
tarefa"), levantada pelo auditor da fase 3: os achados da auditoria por fase
levam a fase (`orchestrator.ts`, desde a §52), as decisões não; a resposta
virou achado sem endereço, foi às fases 1, 4 e 6, a emenda da fase 1 — aprovada
— devolveu cinco tasks em vez de oito (`.env`, manifesto, migração na
inicialização), e a coerência mandou as lacunas para `Architecture`: uma
reorganização inteira. Nenhum auditor apontou "a P04 cobre o workflow 3 e a
integração é da P06"; quatro achados culparam os escritores por "antecipar a
integração", seguindo uma regra do prompt deles (`phaseFromSlicePrompt`:
"its criteria verify that the entry exists and points at them") que não
conhecia o terceiro caso.

### 127.2 A causa-raiz

O G4 percorre, ao fim de uma fase, os workflows que ela COBRE
(`workflowsForPhase`). Esse contrato nunca foi dito a quem escreve `covers`.
O próprio harness oferece ao arquiteto a integração numa fase posterior, manda
cobrir todo workflow em alguma fase, e não diz que a fase do módulo que
continua cobrindo o workflow terá o fluxo cobrado antes da integração. O
escritor da fase e os auditores também não sabiam. O plano publicou duas
responsabilidades temporais incompatíveis — integração na P06, fluxo cobrado
na P04 —, e o build não tinha como distinguir "fluxo ainda não executável" de
"defeito": cobrou, e o G3, que lia o critério da mesma fase, cobrou o
contrário. O que transformou a contradição em 28 chamadas foi o registro de
defeitos, que não reconhecia a falha voltando (identidade por prosa), juntava
exigências opostas por um nome em comum, e não tinha nenhuma noção de "um
reparo desfez o outro".

Erros do PLAN: a cobertura sem o tempo (arquitetura), o terceiro caso ausente
do escritor, nenhum auditor com o contrato, a decisão sem fase. Erros do
BUILD: G4 sem elegibilidade, identidade do G4 por prosa, ponte por nome,
relatório velho, nenhuma detecção de oscilação. Implementação dos agentes: a
P03 e a P05 integraram porque o G3 as fez integrar (critérios lidos como
"disponível pela aplicação"), e a P05 conflitou na integração por isso; o
verify-6 aceitou o registro que o verify-3 tinha reprovado. Nenhum desses é
corrigido aqui — são do modelo, e a correção do plano tira o incentivo.

### 127.3 O que muda

**A. Uma derivação única do tempo dos fluxos** (`contract/disponibilidade.ts`).
"O G4 cobra o workflow N ao fim da fase K?" tem agora uma resposta só, usada
pelo plano para escrever e auditar e pelo build para decidir o G4. Um workflow
que K cobre fica para uma fase posterior J só com evidência EXPLÍCITA do plano
publicado, e J tem de cobri-lo também e esperar por K (as dependências
efetivas do escalonador, transitivas):

- pelo texto: o envelope de K — título e goal, o mesmo que o escritor e o
  auditor leem; as tasks não entram — nomeia J ("fase 6", "Phase 6"; não o
  endereço solto `P6`, que "prioridade P1, P2 ou P3" também é, e nada entre
  crases). Só referência adiante conta: o `Depends on` de quem depende cita a
  fase anterior, e isso não diz nada sobre o fluxo;
- pelo caminho: a arquitetura diz que o workflow atravessa um componente que
  nenhuma fase até K constrói, e J é a primeira que o cobre com o caminho
  inteiro de pé. Componente que fase nenhuma constrói (um serviço externo
  descrito como componente) não é caminho que falta; fase sem componentes
  conhecidos (a que o `change` acrescentou fora da arquitetura) torna
  desconhecido só o que depende dela.

Sem uma das duas, o fluxo é cobrado em K, como sempre — inclusive quando a
fase proíbe a integração em prosa sem nomear quem a faz: elegibilidade
desconhecida não vira dispensa. Na integração progressiva nada se adia. Não
há campo novo, pergunta nova nem regra universal: as duas arquiteturas
coerentes passam, e o que se derivava em silêncio passa a ser dito.

**B. O PLAN recusa e audita a contradição antes do build.** Duas formas
viram defeito do contrato da arquitetura (`parseArchitecture`), devolvidas
ao arquiteto na escada mecânica que já existe, sem auditor e sem pergunta: o
workflow cobrado numa fase em que o caminho dele não existe e que nenhuma
fase posterior completa; e a fase que nomeia uma posterior que cobre o mesmo
workflow sem esperar por ela. O resto é auditoria com os fatos na mesa: o
arquiteto lê "When each workflow is walked" (as duas integrações, e o que
nenhum plano pode fazer); o auditor da arquitetura ganha o eixo 7 e a tabela
derivada; o escritor de cada fase recebe o bloco da fase ("Walked at the end
of THIS phase …" / "covered here but walked only at the end of Phase N …"; o
que a fase liga é o goal dela que diz, e o bloco só proíbe cobrar o fluxo
inteiro pela aplicação) e o terceiro caso na regra do arquivo compartilhado; o
auditor de fase e o de coerência recebem o mesmo contrato, com o endereço
certo (a task, ou `Architecture` quando o defeito é o tempo). A tabela também
mostra a REVISITA — a fase posterior que cobre o workflow de novo e mexe em
componentes do caminho que a fase anterior não nomeia —, que não é
contradição provada (pode ser acabamento sobre um ponto de extensão) e por
isso só informa. Para o plano do Luna, a tabela diz: P2 deixa o workflow 1
para a P6 (caminho), P4 deixa o 3 para a P6 (texto), e P3 e P5 são revisitadas
pela P6 — exatamente a incoerência que nenhum auditor apontou.

**C. A decisão que o auditor de uma fase levanta volta a ela.** A
auditoria por fase carimba a fase também nas decisões, e as três conversões
(a do desenvolvedor, a de engenharia, a da I-16) a põem no endereço do achado
— somada às fases que o `where` do auditor cita, nunca no lugar delas; a
triagem de materialidade põe a mesma fase na mesa.

**D. O G4 cobra só o que a fase pode entregar** (`build.ts`, `runner.ts`). A
fase percorre os workflows cobrados; os adiados viram registro no livro de
evidências — `adiado-N`, G4, `NOT_APPLICABLE`, com a fase que completa e o
porquê, marca própria — e a transição "fluxo adiado"; não são prova (não são
`fluxo-N`), não entram na regressão, e a revalidação não os toca. A fase que
completa os cobre e os percorre. No fim, o build não se declara concluído com
um workflow do esqueleto que nunca passou no G4 — adiado ou nunca coberto; o
nunca coberto já é dito antes da primeira fase. E a fase que completa um fluxo
adiado não é pulada como "fechada antes" quando a fase que o deixou roda de
novo (um `change` mudou um critério dela) ou fechou depois dela: volta a ser
verificada, sem implementação, e o G4 dela percorre o fluxo sobre o código
novo. O paralelo não muda: as fases independentes continuam saindo juntas, e
a que só tem fluxos adiados não precisa do entrypoint cedo.

**E. A oscilação entre gates é diagnóstico, não trabalho a repetir**
(`defeitos.ts`, `runner.ts`). O registro guarda, de cada defeito, a ação depois
da qual ele apareceu ou voltou, e de cada ação os arquivos que ela mudou. Hash
que volta não basta; o que se exige é a reversão causal inteira: uma ação
contra o defeito X (de um gate) mudou arquivos e o defeito Y (de outro gate)
apareceu; a ação que resolveu Y mudou os mesmos arquivos, e X continuou
exigindo outra ação; essa nova ação mexeu nos arquivos do reparo de Y, e Y
voltou — o mesmo defeito —; e o Git confirma que esses arquivos estão de novo
com o conteúdo EXATO que Y rejeitou. Só entre os dois gates que trazem
critério do PLAN — a task do G3 e o fluxo do G4 (produto ou critério): a suíte
do G2 é escrita pelo próprio executor, e roteiro, subida e ferramenta são do
build; nenhum deles é contradição que o PLAN reconcilie. Aí o Core para de
reparar, preserva código, commits,
branches, logs e provas, publica pelo contrato do reparo documental da §125 H
um pacote para o PLAN (`project-phases.md`) com os dois critérios, as três
ações e os arquivos, marca os dois defeitos `UPSTREAM_REPAIR_REQUIRED` e para a
fase com o diagnóstico; nenhum documento é editado, nenhum agente escolhe um
lado. Na retomada, o pacote ainda válido para a fase sem chamada nenhuma; o
documento corrigido o invalida e devolve os defeitos à escada. Se o pacote for
recusado, a parada acontece do mesmo jeito, com o diagnóstico.

**F. A identidade do defeito do G4.** A âncora do passo é a do roteiro, lida
da saída do runner (`› passo 1: …`), nunca a prosa da triagem: a mesma falha
com outra redação é o mesmo defeito, com a história e o orçamento dele, e
passos diferentes continuam defeitos diferentes. A ponte entre gates só aceita
citação que é MENSAGEM (frase, ou código de erro como `ERR_MODULE_NOT_FOUND`,
não um nome): `/categorias` não junta mais a
exigência e a proibição. E o relatório do reparo do verificador vale para a
correção seguinte, uma vez.

### 127.4 O que NÃO muda, de propósito

- O G3 e o G4 continuam; nenhum teto aumentou; nenhum G4 é pulado "nas fases do
  meio" — só o fluxo que o plano deixa, explicitamente, para outra fase.
- A integração progressiva continua cobrada na fase do módulo; a posterior
  continua válida. O arquiteto escolhe.
- Os documentos certificados não são editados pelo build; o pacote documental
  continua sem edição automática (§125 H).
- O INIT não muda (nenhuma evidência de defeito nele neste run).
- Não corrigido, anotado: a P03 e a P05 publicadas continuam revisitadas pela
  P06 (o build as cobra na própria fase, e o conflito do paralelo no
  `routes.tsx` é a recuperação de integração de sempre); `CoherenceMemory`
  rebaixou a ressalva o achado real do verifier sobre `tarefasRouter.ts` ×
  `routes.ts` (aprovação anterior protegendo a si mesma); a verificação de
  deriva da emenda (`checkRewriteDrift`) existe e não é chamada, embora o prompt
  da emenda prometa; a contestação do roteiro conta como mudança; o roteirista
  reescreveu o fluxo 1 sem Categorias depois de o G3 mandar tirar o link
  (regressão mais fraca, sem aviso).

### 127.5 Testes: RED → GREEN

44 cenários, provider falso e Git real onde há código, sobre os textos do run:
a arquitetura e o esqueleto que o `plan` publicou para o Luna
(`test/fixtures/luna-127.*`), e uma fixture mínima do incidente — fundação,
tarefas que se integram sozinhas, categorias "pronta para a integração … na
fase 4" com o roteador "exportado sem registro no servidor central", e a fase
de integração.

- `test/contract/disponibilidade-127.spec.ts` (17): a derivação sobre o Luna
  publicado (P4 deixa o workflow 3 para a P6 pelo texto; P2 deixa o 1 pelo
  caminho; P3 e P5 cobram os seus e aparecem revisitadas pela P6); as duas
  integrações válidas (17, 18); elegibilidade desconhecida continua cobrada
  (6); as duas contradições recusadas pelo contrato (7); o bloco do escritor;
  e da revisão, os nomes de fase (C3), o componente externo (C7) e a fase
  desconhecida (C4).
- `test/loop/coerencia-temporal-127.spec.ts` (9), o `runBuild` inteiro com o
  runner de fluxos falso: o fluxo adiado não é percorrido na fase 3, fica no
  livro como `adiado-2` → P04 e passa na P4 com a regressão (2, 4, 14); a
  integração progressiva percorre na fase do módulo (1, 17); a integração que
  é da fase e não veio reprova nela, com o defeito no `passo 1` (3); a
  proibição em prosa não dispensa (6); o build não conclui com fluxo nunca
  percorrido (5); as fases de módulo correm juntas no paralelo, com o adiamento
  valendo no worktree (12); e da revisão, a fase de destino revalidada quando a
  de origem roda de novo (C2), os rótulos de prioridade (C3) e a fase 7 fora
  da arquitetura sobre o Luna real (C4).
- `test/loop/oscilacao-127.spec.ts` (9), o `runPhase` com o G4 simulado lendo o
  arquivo do servidor, como na P04: a oscilação provada para no ciclo 2, com o
  pacote ao PLAN, os dois defeitos `UPSTREAM_REPAIR_REQUIRED`, o trabalho e o
  commit preservados e a prova da task 2 valendo (9, 11, 13, 15); a retomada
  para sem chamada; a mesma falha com outra redação é o mesmo defeito (10);
  passos diferentes, defeitos diferentes (11); o relatório do reparo uma vez;
  e da revisão, G2 × G4 e o executor que nunca restaura o mesmo conteúdo NÃO
  param por oscilação (C1), e a ponte só com mensagem.
- `test/init/coerencia-temporal-127.spec.ts` (9), `init` + `plan` com o agente
  falso: o adiamento que não espera e o fluxo sem caminho voltam ao arquiteto,
  sem pergunta (7, 8); o escritor, o auditor de fase, o de coerência e o da
  arquitetura recebem o contrato; a decisão do auditor da fase 3 emenda só a
  fase 3 (8); o plano correto com a lista exata de chamadas (16); o achado
  endereçado a `Architecture` vai ao arquiteto (8); e da revisão, a fase da
  decisão soma às do endereço, e a triagem a vê (C6).

RED contra a §126 (`9b1042a`), a primeira bateria de 32: 27 falham. Os cinco
verdes antes e depois são de preservação, de propósito: a integração
progressiva, a proibição em prosa que continua cobrada, o plano correto com as
mesmas chamadas, o achado de `Architecture` indo ao arquiteto, e a
arquitetura publicada do Luna passando no contrato novo. Os doze da revisão cobrem os sete
defeitos que as sondas do revisor reproduziram contra a PRIMEIRA versão desta
correção (não os doze cenários em si, que foram escritos depois): a fase
parava com pacote ao PLAN por G2 × G4 (C1); o fluxo 2 não era percorrido em
lugar nenhum no segundo run (C2); a P2 não percorria o seu fluxo por "P1, P2
ou P3" num critério (C3); a fase 7 apagava os adiamentos pelo caminho (C4); o
bloco mandava a fase da navegação "não ligar" (C5); a decisão perdia a fase 1
do endereço (C6); o componente externo gerava contradição sem saída (C7).

`npm run check`: 2933 testes em 157 arquivos, rc=0 (2889 em 153 antes). A
máquina rodava com load average ~20 em 4 CPUs (dois `mpv` em loop, acesso
remoto): nessas condições, três testes do paralelo que medem concorrência pelo
relógio (`paralelo.spec.ts`: "fases independentes rodam ao mesmo tempo", "a
suíte da árvore integrada é o juiz", a conciliação em arquivo com acento) e o
cenário 15 da `integridade-122` falharam, cada um uma vez, em rodadas
diferentes; todos passam isolados e repetidos, e nenhum passa por código desta
correção. O cenário 12 deste § guardava o último intervalo da fase, e uma
correção sob carga o sobrescrevia: agora guarda o da implementação, que a
barreira faz começar junto.

### 127.6 A revisão adversarial

Um revisor independente (um agente; sondas fora da árvore, apagadas depois de
rodar) atacou a primeira versão e reproduziu sete defeitos, todos corrigidos
com cenário (127.5): o detector de oscilação aceitava qualquer par de gates e
qualquer alternância sobre os mesmos arquivos — um teste da suíte, escrito pelo
executor, virava "incompatibilidade de contrato" (agora: só task × fluxo do
plano, e o Git tem de mostrar o estado rejeitado restaurado byte a byte); o
fluxo adiado não era revalidado quando a fase de origem rodava de novo e a de
destino continuava "fechada antes"; o build lia referência de fase nas tasks
e em `P\d` solto, o plano só no goal (agora o envelope nos dois, e só "fase N"
/ "Phase N"); a fase fora da arquitetura anulava todos os adiamentos pelo
caminho; o bloco proibia ligar mesmo quando o goal manda; a fase carimbada na
decisão substituía as fases do endereço; o componente externo gerava defeito
sem saída. Das suspeitas, três viraram correção (a obrigação invalidada é
regravada; o código de erro de um token continua cruzando a ponte; o fluxo que
nenhuma fase cobre é dito antes da primeira fase) e as outras estão em 127.9.
O revisor também confirmou o que resistiu: a cadeia de adiamento não tem
ciclo, o incerto continua cobrado, o passo vem do cabeçalho real de falha do
Playwright (conferido nos logs do Luna), e as onze respostas reais do
arquiteto do Luna passam no contrato novo com zero contradições.

### 127.7 Custo, medido

Nos cenários dos testes, base (`9b1042a`) contra a correção, mesmo provider
falso: a oscilação G3 × G4 da P04 custava 26 chamadas (13 do executor, 13 do
verificador) e parava pelo teto de três ciclos; agora 8 (4 + 4), parando no
ciclo 2 com o diagnóstico. A decisão de uma fase: 21 chamadas, com as fases 1,
2 e 4 reemendadas; agora 18, só a 3. O adiamento com todos os fluxos verdes:
10 e 10 — nenhuma chamada a mais, o roteiro do fluxo 2 só muda de fase. O plano
correto: a mesma lista de chamadas, exata, nos dois. Não medido com modelo
real: no Luna, a P04 gastou 28 chamadas na oscilação; com a correção, o fluxo
3 não é cobrado na P04, e a oscilação não teria por onde começar.

### 127.8 Compatibilidade e o run original

Planos da 0.7.0 continuam válidos: nada muda no formato de nenhum documento,
e o adiamento é derivado do que já está publicado. As §126 e §127 levam a
versão a 0.7.1, sem publicação. O contrato da arquitetura
ganhou duas recusas; uma arquitetura guardada que caia numa delas é desenhada
de novo (a §126 já a passa pelo contrato atual antes de reaproveitar). Os
prompts do plano mudaram, então aprovações e caches do plano por sha de
prompt não se reaproveitam, como em toda mudança de prompt. O registro de
defeitos ganhou campos opcionais (`discovered.action`, `rediagnoses[].reopened`,
`attempts[].files`, `attempts[].tree`); um estado antigo é lido sem eles, e a
oscilação só se prova com eles.

O build do Luna (`build-8e24c805009f`) é retomável em princípio — o plano é o
mesmo, então o id do run é o mesmo —, e não foi retomado aqui (sem teste pago
antes da validação determinística, como pede a especificação). O que a
retomada faria, pelo código: P01–P03 puladas; a P04 volta com os defeitos
gravados (D1–D8 com a âncora antiga, em prosa; as falhas novas ancoram em
`passo N` e não casam com eles, e os antigos se resolvem quando o G4 não os
reproduz), o fluxo 3 adiado para a P06 e o fluxo 1 também (pelo caminho), e a
árvore da P04 é a do `wip` (sem integração — o que o plano da P04 pede —, e sem
o link da barra lateral que a P02 entregou, que o fluxo 1 vai cobrar na P06);
a P05 roda sozinha sobre a árvore integrada, como a recuperação do conflito
manda; a P06 percorre os quatro fluxos. Mas o plano publicado continua com a
P03 e a P05 revisitadas pela P06 (o build as cobra na própria fase), e é por
isso que a rota recomendada é outra: `capivara plan` de novo — o arquiteto,
o escritor e os auditores agora veem o tempo de cada fluxo — e então `capivara
build`; as fases cujo texto não mudar continuam fechadas.

### 127.9 Limitações e riscos

- A evidência textual é a fase nomeada no envelope. Uma menção incidental no
  goal ("o relatório da fase 7 usa esta listagem"), com a fase 7 cobrindo o
  mesmo workflow e esperando por ela, adia o fluxo para a 7 — que o percorre;
  o custo é detectar mais tarde, nunca aprovar sem percorrer.
- A proibição de integração escrita em prosa, sem nomear a fase que integra,
  não é reconhecida pelo código: o fluxo continua cobrado, e quem a pega é o
  auditor (com o contrato e a tabela na mesa) ou, no build, a oscilação.
- A revisita (a P06 do Luna cobrindo de novo os fluxos de P03 e P05 e mexendo
  nos componentes do caminho) só informa: bloquear recusaria o plano com uma
  fase final de consolidação sobre um ponto de extensão, que é válido. No
  Luna, a P03 e a P05 continuariam cobrando os seus fluxos e integrando
  pelo arquivo compartilhado; o conflito do paralelo no `routes.tsx` é
  recuperado como sempre (a fase volta sozinha sobre a árvore integrada).
- A prova da oscilação exige Git (a conferência byte a byte); sem Git, a
  escada segue até o fim dos ciclos, como antes. Ela também exige o MESMO
  conteúdo restaurado: um executor que alterna entre dois estados com
  redações diferentes não é parado — gasta os ciclos, como antes.
- `discovered.action` é a última ação antes de o gate achar o defeito, mesmo
  quando o gate dele rodou ali pela primeira vez; a conferência do Git torna
  isso irrelevante para a prova, mas o campo, sozinho, não é causalidade.
- A chave de dedupe da decisão do auditor (`where::decision`) não tem fase: se
  outra fase levanta a mesma decisão numa rodada seguinte, ela não é
  perguntada de novo (certo) e a resposta não é reentregue a essa fase como
  achado (a decisão aceita continua nas "Confirmed decisions" de todo prompt).
- Não corrigidos, observados e anotados: `CoherenceMemory` rebaixou a
  ressalva um achado real do verifier (P3 cria `tarefasRouter.ts`, P6 monta
  `routes.ts`; publicado); `checkRewriteDrift` existe e não é chamada, embora
  o prompt da emenda prometa a conferência; a contestação do roteiro conta
  como mudança; o roteirista reescreveu o fluxo 1 sem Categorias depois de o
  G3 mandar tirar o link (regressão mais fraca, sem aviso); a oscilação sobre
  testes na arquitetura (requisito × prescrição) custou sete das oito
  devoluções da arquitetura no PLAN e continua dependendo da calibração das
  §118/§122/§126.
- Validado só com provider falso e Git real; nenhum run real depois desta
  implementação.

## §128 — Convergência do PLAN: a correção que o achado alcança fica, a fase que a reorganização não tocou também, e a triagem recebe a regra do harness

### 128.1 A evidência: Parallel Lab no Luna (0.7.1)

Projeto `laravel/luna`, run `init-dc741f0d7b92` (21/10, 18:41–18:55 UTC),
0.7.1 (§126 + §127). O plano saiu RALPH READY e o build
`build-8db7f43ee531` concluiu; o que não fecha é o custo do PLAN diante do
produto (três CRUDs sem relação, uma fundação e um painel): **64 chamadas** —
entrevista 1, esqueleto 1, arquiteto 6, auditor da arquitetura 5, escritor de
fase 17, auditor de fase 16, coerência 4, triagem 3, ensaio 11. Os artefatos
foram copiados para o scratchpad antes de qualquer leitura; o `.capivara` do
projeto não foi tocado. A sequência, pelos `events.tsv`, `prompts/` e `logs/`:

1. arquiteto v1: seis fases, a 2 (estrutura da interface) com `covers` vazio
   — o contrato devolve "a fase 2 não cobre nada"; a v2 é desenhada do zero
   (a retentativa por contrato não leva a anterior), com outros caminhos;
2. quatro auditorias da arquitetura, um ponto por rodada: validação nos
   formulários (v2 → v3); serviços próprios de cada módulo e ligação
   interface–API (v3 → v4); testes próprios de cada módulo e "só o `.env` tem
   credencial" (v4 → v5); aprovada. **A v4, que tratava dos serviços, perdeu
   a validação dos formulários que a v3 tinha escrito.** O arquiteto recebia
   "Already fixed in earlier rounds — keep it fixed"; o auditor recebia só o
   achado da última rodada, e as rodadas 3 e 4 aprovaram sem a validação;
3. fases, rodada 1 (cinco escritas). O goal da P1 prometia "o projeto Node.js
   e React com Vite … e os pontos de descoberta de rotas e páginas", mas a P1
   nomeava só `dados` e `api-base`: o `web-shell` (P2), dono de `src/App.tsx`,
   `src/main.tsx` e do contrato "páginas descobertas em `src/modules/*/page.tsx`",
   não estava na fatia dela. O escritor da P1 adivinhou `src/web/main.tsx`,
   `src/web/app.tsx` e `src/web/modules/*/page.tsx`. A Task 10 da P3 dizia
   "implementar a exclusão com confirmação **e concluir a cobertura
   automatizada própria do módulo**"; a P4 e a P5 não traziam o requisito de
   testes do módulo;
4. auditoria, rodada 1: o auditor da P3 aponta a Task 10; a coerência aponta
   `src/web/main.tsx` × `src/main.tsx` (F8) e de novo a Task 10 (F9). A
   **triagem** descarta F1 e F9 citando a própria Task 10 ("a fonte não
   proíbe atribuir testes à fase"): ela recebia pedido, decisões, esqueleto
   (com a arquitetura colada) e fases — nunca a regra do planejamento. A P3,
   sem achado restante, é marcada aprovada com a Task 10 dentro;
5. rodada 2: o escritor da P1 corrige a Task 1 **e as Tasks 7 e 8** (para
   `src/App.tsx`, `src/modules/*/page.tsx` e `src/modules/painel/page.tsx`),
   que é o que o achado pedia ("mantenha a descoberta de páginas nos caminhos
   `src/App.tsx` e `src/modules/*/page.tsx`"). O endereço do achado era
   `P1.T1.C3 vs P2.T4.C1`, e `preserveUnaddressedTasks` devolveu as Tasks 7 e
   8 com os bytes antigos. A coerência acusa a descoberta em `src/web/app.tsx`,
   endereçada a `Architecture`, e a Task 10 de novo (agora KEEP: a citação da
   triagem não existia na fonte);
6. reorganização: a v6 muda o goal da P1 e da P2, a visão geral, um contrato
   do `web-shell` e só a justificativa da P3–P5. **As cinco fases são
   reescritas do zero** — o cache da escrita é o prompt inteiro, e a visão
   geral entra em toda fatia —, embora os prompts prometam ao arquiteto e aos
   auditores que "a fase cujo envelope não muda mantém o que já foi escrito".
   A P4 e a P5 estavam aprovadas;
7. rodada 3, sobre textos novos: P3 com uma "confirmação da alteração de
   status" que ninguém pediu e sem a validação do formulário (a regressão da
   v4 chegando às fases); P2 com o painel em `src/modules/dashboard/page.tsx`
   sem ligação a `/`; P1 sem "só o `.env` tem credencial" (omissão que as
   rodadas 1 e 2 aprovaram — só a reescrita fez alguém reler) e com uma
   restrição no esquema que a triagem achou compatível, citando a arquitetura
   sob o rótulo "request": a prova foi recusada, fail-closed correto;
8. rodada 4: P1, P2 e P3 emendadas; aprovado; ensaio em 11 lotes.

Nenhuma decisão de produto foi levada ao desenvolvedor nesse run (zero
CAPIVARA_DECISION; as "Confirmed decisions" ficaram vazias): a autoridade não
foi o problema.

### 128.2 A matriz dos incidentes

| id | evidência | quem introduziu | quem detectou | causa demonstrada | classe | custo | correção |
|---|---|---|---|---|---|---|---|
| A1a | events 18:43, "a fase 2 não cobre nada" | arquiteto | contrato | a regra do contrato (toda fase cobre algo) não estava no prompt | contrato não comunicado | 1 escrita da arquitetura | F7 |
| A1b | auditorias 1–3 da arquitetura | arquiteto | auditor, um ponto por rodada | os requisitos estavam no pedido e nas regras, e o prompt já pedia leitura completa | defeito real; fragmentação do modelo | 3 rodadas | F5 (a parte dos testes), F6; o resto é amostragem — não corrigido |
| A1c | v3 → v4 | arquiteto, ao reescrever | ninguém na arquitetura; o auditor da P3 na rodada 3 | o auditor recebia só a última rodada; o arquiteto, todas | requisito perdido numa arquitetura aprovada | um achado de fase | F6 |
| A2 | coerência R1 F8 e R2; emenda da P1 | arquitetura (goal da P1 promete obra do `web-shell`) + fatiamento | coerência | o escritor adivinhou caminhos que a arquitetura fixava noutra fatia; a correção dele foi desfeita pelo harness | defeito real + falha de orquestração | a reorganização inteira | F1, F8 |
| A3 | rodadas 1 e 3 | vários | auditores e triagem | ver 128.3 | misto | — | — |
| A4 | P3 T10; R1 F1/F9; R2 F2 | escritor da P3, sob regra ambígua | auditor da P3, coerência | o I-16 não lia o verbo depois de "e" nem "concluir"; a regra do planejamento proibia "organização dos testes por módulo" e mandava preservar o pedido de testes por módulo sem dizer onde | contrato incompleto + prompt ambíguo | 4 achados; a P3 aprovada com teste dentro | F4, F5 |
| A5 | triagem R1 F1/F9 | triagem | a coerência da R2, de novo | a triagem não tinha a regra do harness entre as fontes; a citação válida da frase acusada removia o bloqueio | supressão indevida de achado | a Task 10 sobreviveu à rodada | F3 |
| A6 | events 18:51:40–18:52:46 | orquestração | — | cache da escrita = prompt inteiro; a visão geral e um contrato consumido mudaram | falha de orquestração | 3 escritas, 2 aprovações perdidas, 2 defeitos novos | F2 |

O que o harness já sabia e deixava para modelo: que toda fase precisa cobrir
algo (A1a); quais fases a reorganização não tocou (A6); que "concluir a
cobertura automatizada" é trabalho de teste (A4); que a citação do parecer
mostra a prescrição que o achado acusa (A5); e quais tasks o achado alcançava
pelos caminhos que citava (A2).

### 128.3 A3 — os achados sobre requisito herdado, um a um

| achado | onde | classificação | o que aconteceu |
|---|---|---|---|
| validação nos formulários | arquitetura R1; P3 R3 | requisito material herdado (regra `interface` do esqueleto) | omitido pela v2, escrito na v3, perdido na v4; o auditor da arquitetura não reconferiu (F6) |
| confirmação de exclusão | P3 R3 | requisito introduzido pelo modelo ("confirmação da alteração de status") | só as exclusões pedem confirmação; nasceu da reescrita do zero |
| acesso à edição | P5 R1 F4 | obrigação redundante (a descrição da task já dizia "cadastrar e editar pela API") | a triagem descartou com citação válida — correto, preservado |
| responsividade | P2 R1 F2 | obrigação redundante (o goal declara) | a triagem descartou — correto, preservado |
| painel na rota inicial | P2 R3 | requisito material omitido | nasceu da reescrita da P2 depois da reorganização (o envelope dela mudou; sem a reorganização, F1, não haveria reescrita) |
| testes automatizados | arquitetura R3; P3, P4, P5 R1; coerência R1 e R2 | requisito material + prescrição | regra do harness ambígua (F5), I-16 incompleto (F4), triagem sem a regra (F3) |
| isolamento de dados e ambiente | arquitetura R3; P1 R3 | regra herdada do próprio harness (`regrasDeBanco`) | na arquitetura, redundante (a regra chega a toda fase pela fatia); na fase, material (o build cobra critérios) — omitida desde a rodada 1, aprovada duas vezes, achada na terceira leitura: variância do auditor, não corrigida |
| restrição no esquema | P1 R3 F2 | falso positivo provável | a triagem tinha razão e citou certo, sob o rótulo errado; recusada, como deve ser. Com a arquitetura como fonte própria, o rótulo certo passa a existir |

### 128.4 O que muda

- **F1 — a emenda guarda o que o achado alcança** (`contract/drift.ts`).
  `preserveUnaddressedTasks` continua devolvendo byte a byte as tasks que o
  achado não toca, e passa a aceitar a emenda de uma task vizinha quando ela
  tem as mesmas linhas e toda linha que mudou passou a citar, entre crases, um
  trecho que a correção (`fix`) manda usar e que ela não citava — um padrão
  com `*`, ou com um segmento `<módulo>`, casa caminhos. O trecho precisa de cinco caracteres e de `/`, `.`,
  `*` ou `_` (`/api` e `id` não localizam nada). O par entre a task antiga e a
  emendada é o título, ou a posição só quando nenhuma task mudou de lugar; uma
  task repetida que não estava repetida desfaz o alcance. Critério apagado,
  acrescentado ou reescrito sem o trecho da correção volta como estava.
- **F2 — a fase que a reorganização não tocou mantém o texto**
  (`contract/architecture.ts` `fasesIntactas`; `init/orchestrator.ts`
  `reorganizar`, `escreverFases`). "Não tocou" é: o mesmo número e o mesmo
  envelope (título, goal, dependências, cobertura, áreas, tamanho e
  componentes); cada componente dela com a mesma definição; os mesmos fluxos
  sobre eles e o mesmo tempo dos fluxos (§127); as mesmas decisões de dados e
  a mesma infraestrutura (valem para todas as fases); nenhum caminho, rota ou
  variável que a fase cita saiu da fatia dela; e nenhum achado de fase aberto
  sobre ela na rodada da reorganização (esse achado "fica para a próxima
  auditoria", e a fase reescrita recebe a decisão no prompt, como antes). A
  justificativa, a visão geral e a redação de um contrato consumido não
  reescrevem a fase. O texto mantido é o atual, com as emendas, e vai ao cache
  sob o prompt novo. Para que nada aprovado contra a arquitetura anterior valha
  por herança, as aprovações passaram a ser chaveadas pelo que foi julgado: a
  fase por texto + fatia, a task por autoridade + fatia, e a coerência por
  autoridade + `architecture.md`.
- **F3 — a triagem recebe a regra do harness** (`audit/materiality.ts`). As
  fontes ganham `harness` (a responsabilidade do planejamento) e
  `architecture` (antes colada ao esqueleto). A regra é contexto, nunca prova:
  o parecer que a cita como evidência é recusado, porque ela diz o que o plano
  não prescreve, nunca o que o desenvolvedor deixou de pedir. O exemplo "test
  organization" saiu da lista de detalhes ADVISORY. Um ADVISORY cuja própria
  citação, de uma fase ou da arquitetura, mostra prescrição de teste pelo I-16
  é recusado: a citação confirma o bloqueio.
- **F4 — o I-16 lê a segunda oração** (`contract/test-prescription.ts`). O
  verbo de trabalho de teste vale também depois de "e"/"and" no meio da
  frase, e concluir, completar, finalizar, terminar, complete e finish entram
  — mas nessas formas novas o objeto tem de ser teste de software pelo nome
  (suíte de testes ou automatizada, testes automatizados/unitários/de
  integração, cobertura automatizada ou de testes, test coverage, automated
  tests): "adicionar a cobertura
  escolhida" é sorvete, "concluir o teste de nivelamento" é escola. A forma de
  sempre (verbo de implementação no começo da frase) não mudou. É o mesmo
  detector do contrato das fases, do gate de prontidão, da arquitetura, do
  esqueleto e da correção do auditor.
- **F5 — onde vive o requisito de testes do desenvolvedor**
  (`prompts/planning-scope.ts`, em todo prompt do `init` e do `plan`): na
  arquitetura, no componente a que se aplica; na fase, como um critério da
  task do produto que entrega o componente; nunca como trabalho. Dizer que
  cada módulo tem os próprios testes, quando o pedido diz isso, é requisito
  dele, não organização escolhida pelo plano. A regra da dúvida do auditor da
  arquitetura diz o mesmo: a ausência do requisito é defeito de fidelidade,
  para a mesma leitura que todo o resto.
- **F6 — o auditor da arquitetura confere o que as rodadas anteriores
  fecharam** (`orchestrator.ts` `auditarArquitetura`; `prompts/architecture.ts`):
  "Fixed in earlier readings — check it is still fixed", com o problema e o que
  foi pedido de cada achado das rodadas antes da última — a lista que o
  arquiteto já recebia. Uma rodada posterior que pediu o contrário de propósito
  não é desfazer: o ponto é julgado pelas fontes, não pela redação antiga.
- **F7, F8 — o arquiteto sabe o que o contrato cobra e o que a fatia mostra**
  (`prompts/architecture.ts`): toda fase cobre ao menos uma story, entidade ou
  workflow; o goal de uma fase só promete o que os componentes dela entregam,
  porque o escritor dela vê só esses componentes e os de que eles dependem. O
  eixo 6 do auditor da arquitetura acusa o goal que promete obra de componente
  não nomeado.

### 128.5 O que NÃO muda, de propósito

- Nenhum teto (devoluções, reorganizações, rodadas mecânicas) foi tocado, e
  nenhum critério de RALPH READY.
- A fragmentação da auditoria da arquitetura (um ponto por rodada) não ganhou
  mecanismo: o prompt já exigia a leitura completa, e o auditor tinha o pedido
  e o esqueleto inteiros. "Cada módulo tem serviços próprios" e "os formulários
  validam" não viram contrato determinístico sem impor uma checklist a outros
  projetos. A parte da fragmentação que era do harness — a regra ambígua dos
  testes e a regressão que ninguém reconferia — foi corrigida; o resto é
  amostragem do modelo e continua possível.
- Nenhuma convenção de diretórios: F1 vale para o caminho que o achado citar,
  em qualquer stack (há cenário com `routes/web.php`).
- Não foi criada a checagem "fase escreve arquivo de componente que ela não
  nomeia": daria falso positivo em fases ordenadas que estendem um arquivo
  compartilhado (o I-18 permite) e não teria pegado `src/web/` (arquivos de
  componente nenhum). Também não foi dado a cada fase o mapa dos arquivos dos
  outros componentes: aumentaria todo prompt e não resolve o envelope
  inconsistente — a correção foi na origem (F8) e no guarda (F1).
- O achado endereçado a `Architecture` continua indo ao arquiteto: o da
  rodada 2 era também de envelope (P1 e P2 entregavam a mesma descoberta), e
  a §126 já trata o envelope que não converge.
- `checkRewriteDrift` continua sem chamador (anotado na §127); o I-16
  continua lendo só o infinitivo.

### 128.6 Testes: RED → GREEN

56 cenários novos, com os textos do run (`test/fixtures/parallel-lab-128.*`:
o pedido, o esqueleto, as arquiteturas v5 e v6, as fases das rodadas 1 e 3 e a
emenda real da P1). 32 estão em `test/contract/convergencia-128.spec.ts` (21)
e `test/init/convergencia-128.spec.ts` (11, `runInit` + `runPlan` com provider
falso que responde pelo conteúdo, com as palavras exatas dos achados do run) —
29 escritos antes da revisão e 3 depois dela.
Contra a base (`629ae11`), 19 dos 29 escritos antes da revisão falham: 7 de 11
de ponta a ponta e 12 de 18 de contrato (5 destes são de `fasesIntactas`, que
não existe na base e foi substituída por um stub). Os que passam na base são
preservação: o caminho limpo com a mesma lista de chamadas, a decisão de
produto que continua indo ao desenvolvedor, a reescrita gratuita que continua
desfeita, o trecho genérico que não alcança nada, o requisito de teste que não
é prescrição, o domínio do produto que o pedido nomeia, as outras nove fases do
run sem falso positivo do I-16, a citação inventada que não remove bloqueio, o
escritor que corrige só a Task 1 (a coerência ainda acusa e a arquitetura é
refeita) e a fase mantida relida contra a fatia nova. Duas guardas foram
provadas por mutação: chaveando a aprovação só pelo texto, a fase mantida pula
a releitura e o teste cai; chaveando a coerência sem a arquitetura, o par
aprovado contra a anterior deixa de ser relido e o teste cai. Os 24 da revisão
estão em `test/contract/revisao-128.spec.ts` (21) e
`test/init/revisao-128.spec.ts` (3): 23 são as sondas do revisor, com as
expectativas seguras dele, que falhavam contra a primeira versão e passavam na
base, e um é o hotel ("incluir a suíte presidencial"), que a primeira correção
da revisão errou. Os três acrescentados ao `convergencia-128` depois da revisão
cobrem a mesma brecha da fase mantida no nível do contrato (decisão de dados,
caminho que sai da fatia) e o padrão escrito com placeholder.

Cobertura dos doze itens pedidos: arquitetura completa na primeira geração e
requisitos preservados (F5–F8: só o que o prompt entrega é verificável com
provider falso); divergência de caminhos detectada e a correção mantida (A2);
fases fiéis à arquitetura (o plano publicado sem `src/web/`); várias falhas
independentes numa auditoria (o protocolo já as lê; F6 entrega a história);
citação inexistente recusada; bloqueio material preservado (o ADVISORY que
cita teste é recusado; o legítimo continua valendo); correção localizada sem
reescrever fase não afetada (A6); projeto ambíguo ainda pergunta (9); projeto
complexo ainda auditado inteiro (fase mantida relida, coerência relida); nenhum
documento inconsistente aprovado (11 e a fase velha que volta como emenda); e
as §125–§127 pela suíte inteira.

### 128.7 Custo, medido

Mesmos cenários, mesmas respostas roteirizadas (as do run, casadas pelo
conteúdo), base (`629ae11`) contra a correção, provider falso:

| cenário | base | correção | diferença |
|---|---|---|---|
| caminho limpo (v5, fases da rodada 1, todos aprovam) | 20 | 20 | nenhuma chamada a mais |
| a cadeia A2 do run (emenda da P1 → coerência → reorganização) | 40 (arquiteto 2, auditor da arquitetura 2, fases do zero 10, reorganização 1) | 25 (1, 1, 5, 0) | −15 |
| reorganização vinda da coerência na rodada 1 | 35 (fases do zero 10) | 31 (7) | −4 |
| a mesma, com o contrato consumido mudando (as fases mantidas ficam velhas) | 65 (emendas 12, auditorias de fase 22) | 39 (3, 13) | −26 |
| a Task 10 da P3 | 21, **publicado com "concluir a cobertura automatizada"** | 21, publicado sem ela (uma emenda mecânica no lugar de uma triagem) | mesmo custo, plano correto |
| a validação desfeita na arquitetura | 24 | 24 | só o prompt muda |
| escritor que corrige só a Task 1 | 40 | 36 | a reorganização acontece nos dois |

O ensaio difere de 8 para 7 lotes porque os textos da rodada 3 têm mais
critérios. Não medido com modelo real: no run, 21 das 64 chamadas vieram
depois da reorganização (arquiteto e auditor dela, cinco escritas do zero, a
rodada 3 de auditoria inteira — cinco fases, coerência e triagem — e a rodada
4 — três emendas, três auditorias e a coerência), mas nem todas seriam
evitadas: a Task 10 da P3 ainda pedia uma emenda. O efeito de F5–F8 sobre o
arquiteto e os escritores não se mede com provider falso.

### 128.8 A revisão adversarial

Um agente independente revisou a primeira versão (sem Workflow, que exige
opt-in), com o diff, a base num worktree e a evidência do run, e reproduziu por
sonda — falhando no código novo, passando na base — dois defeitos altos e
quatro médios, todos corrigidos:

1. **alta** — a fase mantida perdia a decisão do desenvolvedor tomada na
   mesma rodada da reorganização: o achado de fase "fica para a próxima
   auditoria", e a fase aprovada e intacta não era auditada de novo; o texto
   sem a decisão ia ao cache sob o prompt que já a tinha. Agora a fase com
   achado aberto na rodada não é mantida;
2. **alta** — o alcance da emenda casava tasks pela posição: com uma task
   tirada e outra acrescentada (mesma contagem), a fase 1 saía sem a task das
   migrações e com duas duplicadas, RALPH READY. Agora o par é pelo título, ou
   pela posição só sem deslocamento, e a duplicata nova desfaz o alcance;
3. **média** — um trecho genérico citado (`package.json`, `DB_PATH`,
   `/api/resumo`) destravava a reescrita inteira de toda task que o citasse.
   Agora o alcance é linha a linha e só pelo trecho da correção;
4. **média** — a triagem aceitava a regra do harness como prova para descartar
   o requisito de testes que o pedido exige. Agora ela é contexto;
5. **média** — a fase mantida não comparava decisões de dados nem
   infraestrutura: o status trocado na arquitetura publicada saía com os
   valores antigos na fase. Agora isso e o caminho que sai da fatia contam;
6. **média-baixa** — o I-16 novo acusava vocabulário de produto ("adicionar a
   cobertura escolhida", "concluir o teste de nivelamento", "finalizar a
   cobertura", "complete the test"), com efeito no esqueleto, nas decisões do
   auditor e nas correções. Agora as formas novas exigem objeto de teste de
   software pelo nome.

Um plausível (o "repita, palavra por palavra" da F6 prendendo a arquitetura num
vaivém se uma rodada pedir o contrário da anterior) foi tratado na redação: o
auditor vê o que foi pedido e julga a reversão pelas fontes. Um anúncio
enganoso ("a auditoria a relê contra a arquitetura nova" quando a fatia não
mudou) foi corrigido. O revisor rodou, sem quebra, `test/contract`,
`test/audit`, `test/init` (§119–§127 inclusive), `test/prompts`,
`test/interview`, `architecture`, `change` e `authoring`.

A correção da revisão tropeçou duas vezes, e a suíte pegou as duas: o objeto
composto aceitava "suíte" sem qualificador e acusou "implementar a suíte
presidencial no cadastro de quartos" (cenário da §122); e o alcance só pelo
trecho da correção não reconhecia o padrão escrito com placeholder
(`src/pages/<módulo>/page.tsx`), e o cenário da fase mantida que ficou velha
voltou a gastar 61 chamadas, uma emenda atrás da outra. Os dois têm cenário.

### 128.9 Compatibilidade

Nenhum formato de documento muda; planos e runs da 0.7.1 continuam válidos, e
a §128 leva a versão a 0.7.2, sem publicação. Os prompts do `init` e do `plan` mudaram (a regra
do planejamento vai em todos), então caches e aprovações por sha de prompt não
se reaproveitam numa retomada, como em toda mudança de prompt; as chaves das
aprovações de task e de coerência mudaram de forma, e uma retomada de um run
anterior relê o que já estava aprovado — mais rigor, pago uma vez. Um plano já
publicado com trabalho de teste numa segunda oração passa a ser recusado pelo
gate de prontidão no `plan` seguinte, que é o certo. O run do Luna terminou
(RALPH READY e build concluído); não há o que retomar.

### 128.10 Limitações e riscos

- Validado só com provider falso, sobre os textos do run; nenhum run real
  depois desta implementação. As reduções acima são dos cenários, não do
  Luna.
- F1: uma linha que passa a citar o trecho da correção pode, na mesma
  passada, perder outra coisa (um critério reescrito com o caminho novo e sem
  a porta antiga); o guarda protege as linhas que não citam, não o resto da
  linha que cita.
- F2: um contrato consumido que muda de sentido sem mudar caminho, rota ou
  variável (valores de um campo descritos em prosa num contrato de outro
  componente) não tira a fase da lista; quem pega é a auditoria, que relê a
  fase mantida contra a fatia nova — o cenário prova que pega quando o auditor
  vê a diferença. A coerência é relida inteira depois de toda reorganização.
- F4: nas formas novas, teste de software sem nome composto ("e escrever os
  testes do módulo") não é reconhecido; a forma no começo da frase continua
  sendo.
- A fragmentação da auditoria e a variância entre leituras (a regra do `.env`
  aprovada duas vezes e acusada na terceira) continuam possíveis: dependem do
  modelo.
- Flake preexistente, não tocado: `test/loop/coerencia-temporal-127.spec.ts`,
  "as fases de tarefas e de categorias correm juntas", mede a concorrência
  pelo relógio e falha cerca de uma vez em quatro com a máquina carregada,
  também na base.

## §129 — O plano não planeja teste, escolhe todas as dependências, e teste não é motivo de devolução

### 129.1 A evidência: Parallel Lab em `laravel/claude` (0.7.2)

Run `init-dc741f0d7b92` (21/10, 23:24–23:33 UTC), 0.7.2 (§128 inclusa). O
PLAN parou na rodada 4: o auditor da P3 respondeu três vezes (auditor, auditor,
verifier) com "·" no lugar do primeiro "|" do protocolo, e `auditCall` lançou
`InitBlockedError` — fail-closed correto, sobre um erro de digitação
(`ppagina`) que o escritor da P3 introduziu na emenda da rodada 3. O que fez as
rodadas existirem foi a rodada 2: **nove achados, seis sobre teste, e a triagem
manteve os nove**.

- P4 (sub-fase 4.3 "Testes próprios do módulo"), P5 (5.3 "Testes do módulo") e
  P6 (task "Garantir que o dashboard do módulo tenha testes automatizados
  próprios"): tasks de teste. Os auditores mandaram tirar — e pôr no lugar um
  critério "o módulo tem testes automatizados próprios…" numa task de produto.
- P3: reprovada porque o requisito de testes do módulo estava "só no Goal" e
  "nenhum critério o carrega". A coerência repetiu (F7) e repetiu as três
  tasks (F8).
- Os outros três (F3 `dist/web` × `outDir`; F4 shell × link "Voltar ao
  dashboard"; F9 sidebar "após Dashboard" que só existe na P6) eram de
  executabilidade.

A I-16 da 0.7.2 não contou nenhuma das três tasks: "O módulo Categorias tem os
seus próprios testes automatizados…" não começa por verbo. Os artefatos foram
copiados para o scratchpad e para `test/fixtures/parallel-lab-129.*`; o
`.capivara` do projeto não foi tocado.

### 129.2 A causa: o harness mandava planejar o teste

1. o pedido: "Cada módulo deve ter suas próprias rotas, componentes, serviços e
   testes"; "Os testes precisam utilizar banco isolado"; "Testes automatizados
   aprovados";
2. a regra do planejamento (`planningScopeBlock`, em todo prompt do `init` e do
   `plan`), no parágrafo da §128 (F5): "the architecture states it on the
   component it applies to, and the phase that delivers that component carries
   it as one acceptance criterion of a product task … leaving it out loses a
   requirement" — e, antes dele, "Test tooling … is chosen in the build, not here:
   it does not enter … the infrastructure";
3. o prompt do esqueleto: "A request for automated tests becomes a story or a
   rule" — o esqueleto escreveu "Testes" na stack, `testes.requisito` e
   `persistencia.isolamento` nas regras, e "…com os testes automatizados próprios
   do módulo" no goal das fases 3–5;
4. a regra de dúvida do auditor da arquitetura: a ausência do requisito de
   testes "is a fidelity defect" — e a arquitetura pôs os testes na
   responsabilidade de cada componente de módulo;
5. a dica da I-16 (`testPrescriptionHint`): "Não apague o requisito: mova-o"
   para um critério; o filtro `semPrescricaoDeTeste` trocava a correção do
   auditor por essa dica e mantinha o achado;
6. o contrato da arquitetura apagava Vitest e Playwright da infraestrutura
   (`semFerramentaDeTeste`), e o build mandava o executor instalá-los por conta
   própria (`prompts/builder.ts`, G2 e G4).

### 129.3 A decisão do desenvolvedor

"No modo plan não planejamos testes, é terminantemente proibido planejar testes,
isso é competência do build"; "por mais que tenha solicitação de testes no prompt
original … esses testes são para ser executados somente no build … a lógica
precisa ser igual" à do compilar; "o pedido de testes não deve ser encarado como
motivo de devolução para um planejamento"; "como testes fazem parte do projeto,
obviamente ferramentas de testes devem ser definidas na infraestrutura, o que é
diferente de mandar o gate x testar se a tela está responsiva … a função do plan
é dizer o que é para ser feito, quem define como fazer é o build". E, no
esclarecimento do mesmo dia: a seleção de TODAS as ferramentas, bibliotecas,
frameworks e dependências do projeto é do PLAN; o BUILD decide como implementar,
executar e verificar usando só o que foi definido, não acrescenta, troca nem
atualiza dependência por conta própria, e a necessidade comprovada de uma não
prevista vai ao plano pelo reparo upstream. As ferramentas internas do harness
(o Playwright privado do G4 em `.capivara/`) continuam do harness.

A instrução de restrição de escopo do mesmo dia valeu para tudo o que segue:
inspecionar antes, usar os contratos existentes, não criar estado, protocolo,
orquestrador, canal ou formato persistido novo, corrigir só o comprovado.

### 129.4 A matriz

| requisito | estado antes | ação |
|---|---|---|
| INIT levanta lacunas e preenche por entrevista | ATENDIDO | preservado |
| PLAN especifica toda a infraestrutura, ferramentas de teste incluídas | PARCIAL: a I-16 as apagava; a regra dizia que eram do build | ficam na infraestrutura; a I-16 das fases as autoriza |
| PLAN não prescreve teste | PARCIAL: a regra mandava o requisito como critério; a I-16 não o contava | detector do requisito; regra reescrita |
| teste não devolve o plano | NÃO ATENDIDO | filtro na saída de `auditCall` |
| o pedido de testes chega ao build | ATENDIDO pelo contrato compartilhado (Stack e Regras do `skeleton.md`) | preservado: o pedido fica nas regras `testes…`, o plano deixa de lê-las |
| fases em pedaços para modelos pequenos | ATENDIDO no PLAN (≤15 tasks, complexidade efetiva); a entrega gradual dentro da fase NÃO ATENDIDA | só registrado: nenhum run mostrou estouro de contexto |
| dependências validadas uma vez | ATENDIDO no run (`environmentApproved`); a revalidação por invocação é contrato (§115.25) | preservado |
| ajuste com o agente até satisfazer | NÃO COMPROVADO como causa de falha | preservado |
| BUILD não escolhe dependência | PARCIAL: executor, G2, G4 e reparo mandavam instalar o não declarado | texto: instalar só o declarado; o não previsto vai ao plano |
| cada gate testa só a sua obrigação | ATENDIDO (o G2 refeito depois de mudança de código é a revalidação por impacto) | preservado |
| auditor corrige quando o executor não consegue | ATENDIDO (reparo pelo verificador, validação independente) | preservado |
| todas as falhas de uma vez | ATENDIDO no G3; o G4 para no primeiro fluxo (roteiros encadeados) — custo NÃO COMPROVADO | preservado |
| dependência não prevista → reparo upstream | PARCIAL: o `UPSTREAM:` do verificador não citava o caso | uma oração no prompt, sem canal novo |
| reparo upstream, oito pontos | PARCIAL e documentado: o PLAN não consome o pacote por desenho (§125, 129.10) | nada alterado |

### 129.5 O que muda

- **O requisito de teste dentro do plano é contado** (`contract/test-prescription.ts`,
  `testRequirements`): o produto ou o módulo como sujeito de posse de teste de
  software ("o módulo tem testes automatizados", "cada módulo tem os seus próprios
  testes automatizados"); "testes automatizados próprios"; os testes qualificados
  de uma parte do produto, ou "os testes do módulo exercitam…"; a condição da
  execução — teste de software contra qualquer banco, "os testes" só contra um
  banco isolado, descartável, temporário ou separado; a suíte de testes
  automatizados aprovada; "executar os testes automatizados". Teste sem
  qualificador de software não conta (escola, laboratório, A/B, ferramenta de QA,
  hotel). Entra em `testPrescriptions` — a I-16 das fases, do esqueleto e da
  arquitetura — e fica fora de `testToolPrescriptions`, que decide apagar item de
  lista. A dica da I-16 diz "remova … o que o pedido diz sobre testes é executado
  pelo build … não o reescreva em outro lugar do plano".
- **O pedido de testes fica onde o build já o lê**: a regra cujo assunto começa por
  "testes" e a entrada de stack sobre testes. `sharedContractFromSkeleton` já
  entregava Stack e Regras ao executor, ao verificador e ao G4, e
  `functionalAcceptanceBlock` passa a dizer que essas regras são os testes que o
  desenvolvedor pediu e que o build os honra fase a fase. Nenhum campo, seção ou
  formato novo: o `skeleton.md` se lê byte a byte como antes. Fora desse lugar, o
  pedido de testes volta ao escritor do esqueleto nomeado, no canal do mecanismo
  (I-17), tolerado depois da escada; e o pedido que exige testes sem nenhuma regra
  "testes." que o guarde também volta — sem isso o build não o veria.
- **O plano não lê o pedido de testes** (`skeletonForPlanning`): a fatia de cada
  fase e o esqueleto do arquiteto, do auditor da arquitetura, da coerência e da
  triagem saem sem a regra e a entrada de stack de teste, sem a regra em que toda
  oração fala de teste (o esqueleto anterior a esta seção a escrevia como
  `persistencia.isolamento`) e sem a regra "banco dos testes", que diz de si mesma
  ser do build. Os hashes e o `skeleton.md` não mudam.
- **Teste não é motivo de devolução** (`audit/sem-teste.ts`, `tirarPedidoDeTeste`,
  em toda saída de `auditCall` — o mesmo ponto onde `semPrescricaoDeTeste` já
  agia): sai o achado que pede teste ou reprova pela falta dele; fica o que manda
  tirar teste que está no texto, com as palavras do auditor menos as orações que
  pedem teste ou levam "o requisito" a um critério, e a regra no fim; o achado de
  produto cuja correção sugere teste fica sem o teste; sai a ressalva que pede
  teste; sai a decisão que só pede teste, e a que aponta ferramenta ou arquivo de
  teste segue o caminho de sempre (achado mecânico de remoção); REJECTED sem
  achado restante vira APPROVED, com evento e anúncio. A ressalva do esqueleto
  sobre o pedido de testes tolerado fora do lugar fica no relatório e não vai aos
  auditores do plano.
- **As dependências são do plano**: a infraestrutura da arquitetura mantém
  Vitest, Playwright e afins; o propósito do item que descreve o procedimento da
  execução volta ao arquiteto, o que diz o que o runner roda fica; o arquivo de
  teste em `files` continua saindo contando. A I-16 das fases recebe na
  autoridade os nomes da infraestrutura aprovada — a task que declara o runner no
  manifesto cumpre a escolha do plano. No build, o executor instala o que a
  infraestrutura aprovada e os manifestos declaram e nunca acrescenta, troca ou
  atualiza dependência; o G2 com runner ausente manda instalar o declarado e não
  escolher outro; o aviso e o defeito do G4 só mandam instalar `@playwright/test`
  no projeto se a infraestrutura o declara (senão é ferramenta do harness, em
  `.capivara/`); o reparo pelo verificador segue a mesma regra; e o `UPSTREAM:`
  do verificador nomeia a dependência que a fase comprovadamente precisa e a
  infraestrutura não declara.
- **Prompts**: a regra do planejamento (o teste não faz parte do plano em forma
  nenhuma; o pedido de testes é instrução ao build; a infraestrutura lista as
  dependências de teste; teste não é motivo de devolução; a única leitura sobre
  teste é pedir que saia); o esqueleto grava o pedido em regras "testes."; o
  arquiteto declara o runner e o Playwright como dependências de desenvolvimento;
  a regra de dúvida do auditor da arquitetura e a do auditor de fase deixam de
  tratar a ausência como defeito; a triagem recebe a mesma regra.

### 129.6 O que NÃO muda, de propósito

- O comportamento funcional continua critério; o lado da aplicação que aceita o
  banco descartável pelo ambiente continua produto e continua nas regras do harness.
- A I-16 continua mecânica e antes de qualquer modelo; a ferramenta que nem o
  pedido, nem a decisão, nem a infraestrutura aprovada nomeiam continua recusada.
- O protocolo do auditor, os tetos, o fail-closed de `auditCall`, a preparação do
  ambiente, os gates, o livro de evidências, a revalidação por impacto, a escada
  de defeitos, o reparo pelo verificador, o paralelo e o reparo upstream não
  mudaram. A parada da rodada 4 (três saídas inválidas) é a mesma.

### 129.7 Testes: RED → GREEN

- `test/contract/testes-no-build-129.spec.ts` (25) e
  `test/init/testes-no-build-129.spec.ts` (5), com os textos do run; a suíte
  inteira fica em 3020 testes em 163 arquivos, `npm run check` verde.
- Contra `e9c4431` (a 0.7.2 na `main`), numa worktree: os 4 do orquestrador
  falham — o cenário da P3 termina em "Impasse em project-phases.md após 1
  devoluções", a task 4.3 é publicada, a correção leva "mova-o", o pedido de
  testes chega ao arquiteto. A I-16 da base, sobre as seis fases da rodada 1, não
  conta nada; a de agora conta as três tasks de teste e a condição de teste no
  README da P6.
- Os cenários anteriores que codificavam a doutrina antiga ("o requisito fica como
  comportamento", "a ferramenta de teste sai da infraestrutura", "o executor
  instala o runner") — em `autoridade-118`, `integridade-122`, `fronteira-123`,
  `impasse-126`, `disponibilidade-127`, `convergencia-128` (contrato e init),
  `revisao-128` (init), `loop/prompts`, `loop/runner`, `loop/flows` e dois de
  prompt — foram reescritos para a decisão de 129.3, com o porquê no teste. As
  fixtures reais do Luna e do Parallel Lab 128 carregam "o módulo possui testes
  automatizados" porque a regra de então mandava; os cenários de outros mecanismos
  as recebem limpas por `test/support/sem-testes.ts`, e os arquivos de fixture
  continuam como os runs os escreveram.

### 129.8 Custo, medido (provider falso)

| cenário | antes (`e9c4431`) | depois |
|---|---|---|
| a fase reprovada por NÃO ter o critério de testes (F2, auditor insistente) | impasse, PLAN parado | 9 chamadas, 1 escrita e 1 auditoria da fase, sem triagem |
| a task de teste 4.3 escrita na fase | publicada no plano, 9 chamadas | devolvida pela I-16 antes de qualquer auditor, 10 chamadas, plano sem teste |
| a correção que tira a task e pede o critério no lugar (F1) | 12 chamadas, emenda com "mova-o" | 12 chamadas, emenda só tirando |

No run, as três tasks de teste teriam voltado ao escritor pela I-16 na rodada 1,
sem auditoria; F2 e F7 não existiriam; F1, F5, F6 e F8 não teriam o que apontar.
Restariam F3, F4 e F9. É conta de cenário, não de run real.

### 129.9 A revisão adversarial

Um agente, sobre a primeira versão (com um campo `buildTests` no esqueleto, que a
instrução de restrição de escopo trocou pelas regras "testes." que o build já
lia). Treze achados; todos os reproduzidos foram corrigidos com cenário em
`testes-no-build-129.spec.ts` ("a revisão adversarial, achado por achado"):

1. (alto) o detector contava texto de produto — "os testes usam o banco de
   questões", "cada módulo do curso tem seus próprios testes", "the A/B tests use
   the events database", "a suíte de testes passa", "o sistema executa os testes
   automatizados do repositório" — e `skeletonForPlanning` escondia regras de
   produto: as formas passaram a exigir qualificador de software, e "os testes"
   sozinho só conta contra banco isolado/descartável;
2. (alto) o filtro tirava achado de produto que citava `teste.nota_minima` ou
   `npm test` e aprovava a fase: a citação de regra e o comando saíram da conta;
3. (médio-alto) a correção que tira só era reconhecida no começo da frase
   ("Na task 2, remova o critério 3" era descartada): o verbo vale em qualquer
   ponto, e "reescreva … sem" também;
4. (médio-alto) "registre o requisito como critério da task 8" sobrevivia: sai em
   qualquer forma, e a regra vai sempre no fim;
5. (médio-alto) a regra "banco dos testes" escrita pelo escritor pulava a I-16 de
   ferramenta: voltou a passar, como na base;
6. (médio-alto) o pedido de testes podia sumir sem ninguém ver: o pedido que exige
   testes sem regra "testes." volta ao escritor;
7. (médio-alto) a decisão de teste era descartada sempre: a que aponta ferramenta
   ou arquivo voltou a virar remoção mecânica;
8. (médio) só na primeira versão (o campo novo);
9. (baixo) o propósito de um runner era acusado: só o procedimento conta ali;
10. (baixo) a ressalva tolerada do pedido de testes ia aos auditores do plano com o
    rótulo do I-17: fica no relatório (cenário de ponta a ponta, RED com o filtro
    desligado);
11. (plausível) a infraestrutura listava as ferramentas de teste e a I-16 das fases
    recusava declará-las: a autoridade das fases inclui a infraestrutura aprovada;
12. (baixo, não corrigido) uma instrução de produto misturada na mesma oração de um
    pedido de teste sai com ele;
13. (baixo) o teste 10 de `impasse-126` mudou de comportamento e manteve o título:
    renomeado.

### 129.10 Compatibilidade

- O `skeleton.md` de um esqueleto qualquer é byte a byte o mesmo (o do run é a
  prova): stamps, `sourceSkeletonSha12` e caches continuam válidos.
- Um esqueleto publicado antes desta seção é lido pelo plano sem o pedido de
  testes; o build continua lendo-o pelas Regras e pela Stack.
- Uma arquitetura aprovada antes, com os testes nos componentes ou nas fases, não
  passa no contrato de hoje e é desenhada de novo com os defeitos nomeados — a rota
  de §126. Uma fase publicada com critério de teste é recusada pela I-16 no `plan`
  seguinte e emendada mecanicamente.
- Os prompts mudaram para todos os papéis: escritas e aprovações guardadas por
  prompt não são reaproveitadas na primeira execução depois da atualização.

### 129.11 Limitações e riscos

- Validado só com provider falso, sobre os textos do run.
- Um produto cujo domínio é teste de software que descreva as próprias funções com
  as formas contadas ("o módulo tem testes automatizados") será contado; as formas
  exigem posse pelo produto ou qualificador de software para isso.
- A prosa de teste que a I-16 não conta ("o módulo tem testes próprios", sem
  qualificador) só sai se um auditor mandar tirar — e o achado que manda tirar é
  mantido.
- A parada da rodada 4 (o "·" no lugar do "|") não foi tratada: é defeito de forma
  do modelo, e `recuperarTravessao` recusa de propósito o separador ambíguo.
- Reparo upstream, conferido por leitura e não alterado: a alegação `UPSTREAM:`
  pode vir também do trecho do último rediagnóstico, que num defeito do G2 é a
  saída da suíte (uma suíte que imprima a linha forjaria a alegação); a correção
  pediria guardar a origem de cada rediagnóstico, mudança de formato persistido.
  O PLAN continua sem consumir o pacote (§125, por desenho), e a recuperação que o
  build sugere depois de um documento mudado é `init --fresh`, que não reaproveita
  as respostas da entrevista.
- A entrega da fase em pedaços menores ao executor não existe: a fase vai inteira
  numa sessão, dimensionada pelo PLAN.

## §130 — Execução progressiva: a fase grande vai ao executor em partes, e continua uma entrega só

### 130.1 O defeito

O runner entregava a fase inteira ao executor numa sessão: a implementação
inicial de `runPhase` montava `implementPrompt(ctx)` com `phaseMarkdown:
session.markdown` e chamava `sessaoDoExecutor` uma vez. O PLAN já limita a fase
(15 tasks, 4 critérios por task, 60 por fase), mas o limite é o da entrega, não o
de uma sessão: nos planos do disco a mediana é de 9 tasks e 36 critérios por
fase, e nas 30 fases que o parser de hoje lê, uma sessão chegava a receber 40
critérios. Numa CLI agêntica, o contexto de uma sessão cresce com o trabalho —
cada task traz leituras, escritas e saídas de teste —, e é aí que um modelo menor
se perde. O tamanho do prompt pesa menos do que parece: no `laravel/haiku`, a
fatia da arquitetura (15–28 KB) e o contrato compartilhado (10 KB) eram maiores do
que a fase (7–11 KB), e repartir as tasks não encolhe nenhum dos dois.

### 130.2 O que já existia e foi reaproveitado

| mecanismo | onde | uso na §130 |
|---|---|---|
| sessão do executor com G0 e G1 por chamada | `sessaoDoExecutor` (`loop/runner.ts`) | cada parte é uma chamada dela, sem mudança |
| montagem do prompt | `implementPrompt` (`prompts/builder.ts`) | o mesmo prompt; a parte é um campo opcional |
| leitura de uma fase solta | `parsePhaseFragment` (`contract/drift.ts`) | base do recorte, no módulo da gramática |
| tasks, critérios e linhas | `TaskBlock`, `PhaseBlock.subPhases` | a divisão e o recorte saem deles |
| estado da fase no plano de controle | `EstadoDaRecuperacao` (`runs/<run>/defects/<fase>.json`): `implementation`, `inicio` | o progresso é um campo opcional dele |
| conteúdo do código e o que mudou | `estadoDoCodigo`, `arquivosMudados` (Git) | estado verificável para a sessão; validade do progresso |
| narrador e `events.tsv` | `criarNarrador`; o tipo `"entrega"`, que existia e nunca era emitido | observabilidade das partes, separada da recuperação |
| parada retomável | `pararPorSessao`, `fecharFalha` | falha de engine numa parte |
| gates, escada, revalidação por impacto, reparo upstream | o laço de `runPhase` | intocados: rodam depois da última parte |
| paralelo e worktrees | `loop/paralelo.ts` | intocados: a parte roda dentro de `runPhase`, no worktree da fase |

A janela de contexto do executor não chega ao runner por nenhum caminho: os
adapters e o `RoleConfig` não a declaram. O único lugar que a conhece é o adapter
do OpenCode, que consulta `limit.context` dos modelos OpenRouter dentro da
chamada, para limitar a saída.

### 130.3 O desenho

- **O ponto de intervenção** é o bloco da implementação inicial de `runPhase`. A
  fase que cabe no orçamento segue o caminho de antes, com o mesmo prompt — byte a
  byte o da 0.7.3, conferido contra o arquivo da `c0f77f0` — e uma chamada.
- **A divisão** (`loop/partes.ts`, `dividirEmPartes`) é feita em código, a partir
  do plano estruturado, sem chamada de modelo: grupos contíguos das tasks, na
  ordem do plano (a única dependência entre tasks que o documento expressa). A
  sub-fase que começa vai inteira com a parte atual, se couber; senão abre a
  próxima. Uma task nunca é cortada; a que sozinha passa do orçamento vai inteira,
  numa parte só, e o excesso é dito numa transição.
- **O recorte** (`contract/drift.ts`, `recorteDaFase`) fica no módulo da
  gramática, que é o único que pode conhecê-la: cabeçalho e metadados da fase, o
  heading e a prosa da sub-fase quando alguma task dela entra, e cada task
  escolhida inteira, linha a linha como o plano a escreveu. O texto canônico de
  cada task — e o sha que as aprovações usam — é o mesmo da fase inteira.
- **O prompt de uma parte** é o `implementPrompt` com o recorte e um bloco: a
  parte k de N, as posições das tasks dela na fase, os títulos das tasks das
  partes feitas, os arquivos que as sessões das partes mudaram (do Git, até 40),
  as posições das tasks que ficam para depois, que não devem ser implementadas
  agora, e, quando a parte já teve sessão que não terminou, o aviso de que pode
  haver parcial dela. Nenhum resumo escrito por modelo; nenhuma task seguinte
  repetida.
- **O progresso** é o campo opcional `partes` do estado da fase: a chave (sha dos
  documentos da fase: o texto, a fatia, o contrato), os grupos, quantas partes
  foram feitas, a última que teve sessão, a que tem sessão aberta (só fica
  gravada quando o processo cai no meio dela), o conteúdo do código quando a
  última sessão voltou, e os arquivos que as sessões das partes mudaram. Feita é
  a parte cuja sessão terminou com resultado utilizável — feita, não aprovada —,
  e só a feita é dita às seguintes como já implementada.
- **A retomada** segue da primeira parte não feita; se ela já teve sessão, roda de
  novo sobre o parcial dela. A divisão gravada deixa de valer — e a fase é
  dividida de novo, sem apagar código — quando a fase, a fatia ou o contrato
  mudaram; quando o código voltou ao de antes da implementação; quando um arquivo
  que as partes escreveram mudou por fora (o parcial que voltou ao worktree com a
  versão da árvore integrada, uma edição do desenvolvedor); ou quando, sem Git, o
  código mudou e não se sabe o quê. Mudança por fora em arquivo que nenhuma parte
  escreveu (outra fase integrada) não a invalida: a próxima parte lê o código.
  Quando o processo cai com uma sessão aberta, a diferença é atribuída a ela —
  o Core não chegou a registrá-la —, e os arquivos dela passam a ser das partes.
- **Os gates** não mudaram e não rodam entre as partes. G0 e G1 continuam por
  chamada (`sessao-N`, `entrega-N`); G2, G3 e G4 julgam a fase inteira depois da
  última parte, com a revalidação por impacto e a escada de sempre. As partes não
  consomem orçamento de reparo, não abrem ciclo e não gravam `retry` no
  `events.tsv`: são `started` com "implementação: parte k/N" e transições
  `entrega`.
- **As falhas numa parte** (falha do engine, distinta de trabalho incompleto):
  G0 vermelho sem recusa do provider nem tempo esgotado — a regra da leitura do
  verificador que cai (§125 C): uma sessão nova, só daquela parte, sobre o que a
  primeira deixou; caindo de novo, a fase para. Recusa do provider ou tempo
  esgotado — a fase para como sempre parou, menos o tempo esgotado depois de
  escrever na última parte, que é julgado uma vez, como a sessão única. Em todos
  os casos a parte que não terminou não conta como feita, nenhum defeito é
  registrado, e a retomada começa nela. Trabalho incompleto aparece no G3; falha
  técnica, no G2 e na escada; incompatibilidade com o plano, no `UPSTREAM:` do
  verificador — nada disso mudou.
- **A identificação**: a chamada leva `parte: "k/N"`, que a CLI escreve no
  `calls.jsonl` e no log do agente no lugar de "tentativa N"; prompt e log da
  sessão se chamam `<fase>.part-k-of-N`, não `cycle-N`.

### 130.4 A política do orçamento

Sem a janela do modelo, a política é fixa, a mesma para todo engine, e os números
são de política (`ORCAMENTO_DA_PARTE`):

| limite | valor | de onde |
|---|---|---|
| critérios por sessão | 15 | um quarto dos 60 que o plano aceita numa fase |
| prompt da parte | 48 mil caracteres | medido no prompt real de cada parte |
| piso das tasks | 16 mil caracteres além do contexto fixo | quando o contrato e a fatia já passam do teto |

A primeira versão tinha piso de 8 mil. Medida nos planos reais com contexto
pesado (30 mil caracteres de contrato e fatia, como no `laravel/haiku`), ela
dividia fases de 15 tasks em sete sessões e marcava doze tasks comuns como
"acima do orçamento": a lista das tasks anteriores comia o piso. Com 16 mil, o
critério volta a mandar, e os dois cenários dão o mesmo número de sessões.

### 130.5 O que muda

- `contract/drift.ts`: `recorteDaFase`; o envelope de `parsePhaseFragment` virou
  uma constante, usada pelos dois.
- `loop/partes.ts` (novo): `ORCAMENTO_DA_PARTE` e `dividirEmPartes`, puros.
- `loop/defeitos.ts`: o campo opcional `partes` (`PartesDaImplementacao`) no
  estado da fase.
- `loop/runner.ts`: `divisaoInvalida`, `divisaoDaImplementacao`,
  `implementarEmPartes`; `redetectarTeste` extraído do caminho único, que o usa
  igual; `sessaoDoExecutor(prompt, parte?)` e o campo `parte` de `EngineCall`; o
  parcial descartado apaga também a divisão.
- `prompts/builder.ts`: o campo `parte` de `BuilderContext` e o `parteBlock`; sem
  ele, o prompt é o da 0.7.3.
- `cli-program.ts`: "parte k/N" no log do agente e `part` no `calls.jsonl`.

### 130.6 O que NÃO muda, de propósito

INIT, a geração da arquitetura e das fases no PLAN, os contratos da §129 e as
dependências contratadas. Os gates G0–G4, o livro de evidências, a escada de
recuperação (§125), os orçamentos (3 ciclos; 6 reparos por ciclo, 2 por gate, 3
por defeito; os reparos do verificador), o `UPSTREAM_REPAIR_REQUIRED`, o
`tasks.json`. O escalonador, os worktrees, a integração e a conciliação do
paralelo. O formato do `project-phases.md`. As sessões de correção, que continuam
recebendo a fase inteira como referência, com o handoff do defeito como foco.

### 130.7 Testes: RED → GREEN

`test/loop/execucao-progressiva-130.spec.ts`, 32 cenários, Git real e provider
falso que escreve o arquivo de cada task que o prompt lhe entrega. Os quinze da
especificação: fase pequena numa sessão com o prompt de antes (130.1); fase
grande em cinco partes, cada task com o sha da original e nenhum critério de
outra parte (130.2); ordem, sub-fase e o que veio antes (130.3); task acima do
orçamento inteira (130.4); sessões sem memória, com o estado do Git (130.5);
retomada depois da queda do provider e do tempo esgotado (130.6); falha numa
parte com sessão nova e sem defeito, e a parte que cai duas vezes (130.7);
nenhuma aprovação antes dos gates (130.8); uma suíte e uma leitura do verificador
para cinco partes, G0/G1 por sessão, nenhum `retry` (130.9); revalidação por
impacto sobre a fase feita em partes (130.10); duas fases paralelas em partes,
cada uma no seu worktree (130.11); a fatia e o contrato inteiros a cada parte, os
documentos byte a byte (130.12); contrato, fatia e parcial descartado invalidando
o progresso (130.13); a política fixa e determinística, a mesma para dois engines
(130.14); a fase que só fecha inteira (130.15). Mais três de compatibilidade,
dois do recorte e seis dos achados da revisão.

Com a divisão desligada no runner (a fase de volta numa sessão), 27 falham. Os
cinco que passam dos dois jeitos são guardas e unidades puras: a fase pequena, o
estado antigo com a implementação feita, o piso da política e os dois do recorte.
O prompt sem parte foi comparado, para os dois contextos que exercitam todos os
campos, com o `prompts/builder.ts` da `c0f77f0`: idêntico, na implementação e na
correção.

### 130.8 Custo, medido sem modelo

Nos planos do disco que o parser de hoje lê (30 fases, 26 projetos), com o
prompt real de cada parte; "leve" é o prompt sem contrato e fatia, "pesado" com
30 mil caracteres de contrato e fatia, como no `laravel/haiku`. A coluna "teto"
conta a lista de arquivos mudados com os 40 itens que ela pode ter.

| | antes | depois | depois, teto |
|---|---:|---:|---:|
| fases divididas (leve e pesado) | — | 27 de 30, em 2 ou 3 partes | 27 de 30 |
| sessões de implementação | 30 | 69 | 69 |
| critérios por sessão, máximo | 40 | 15 | 15 |
| maior prompt, leve | 33.289 | 26.866 | 29.424 |
| prompt médio, leve | 20.849 | 16.853 | 19.299 |
| total enviado, leve | 1× | 1,86× | 2,13× |
| maior prompt, pesado | 63.320 | 56.897 | 59.455 |
| prompt médio, pesado | 50.880 | 46.884 | 49.330 |
| total enviado, pesado | 1× | 2,12× | 2,23× |
| contexto fixo repetido, pesado | — | 1,61 M caracteres | 1,71 M |

Nos cenários do provider falso: nenhuma chamada de recuperação a mais no caminho
limpo, nenhuma parte refeita na retomada, uma suíte e uma leitura do verificador
por fase, os mesmos resultados de gate. Tokens e tempo de modelo não existem com
provider falso; o custo do harness por parte é um `estadoDoCodigo` e um
`arquivosMudados` (Git) e três gravações do estado. O ganho é de trabalho por
sessão — de até 40 critérios para até 15 —, não de tokens: o total enviado
dobra, porque o contexto fixo vai a cada parte. Um provider com cache de prefixo
pode reaproveitar esse trecho, que abre o prompt de todas as partes; não foi
medido.

### 130.9 A revisão adversarial

Um agente revisou o diff com testes temporários: onze achados, oito confirmados.

1. (alto) A parte cuja sessão caía no G0 sem escrever contava como feita, e a
   seguinte ouvia que as tasks dela estavam implementadas; duas assim paravam a
   fase com as duas marcadas como feitas. Agora a parte que não terminou não conta,
   ganha uma sessão nova (§125 C) e, caindo de novo, a fase para nela.
2. (médio) Um G0 vermelho numa parte registrava defeito de engine, e a escada
   gastava uma ação e uma sessão da fase inteira antes de qualquer gate. Agora não
   há defeito no meio das partes.
3. (médio) O parcial reaplicado em parte ao worktree (o arquivo em conflito com a
   versão da árvore integrada) não invalidava o progresso. Agora a mudança por
   fora em qualquer arquivo que as partes escreveram invalida.
4. (médio-baixo) Sem Git, uma parte "em curso" mantinha o progresso válido
   depois de qualquer mudança. Agora a parte em curso só fica gravada na queda do
   processo; a parada registrada a limpa, e sem Git código mudado invalida.
5. (baixo-médio) A lista de arquivos mudados, contada desde `inicio`, trazia os
   de outras fases. Agora é a dos arquivos que as sessões das partes mudaram.
6. (baixo) A parada no meio das partes deixava `ultimoEstado` velho, e a retomada
   depois dos gates abria uma sessão da fase inteira. Agora a implementação
   completa atualiza o registro, quando ele existe.
7. (baixo) O defeito escalado por essa parada ficava ESCALATED numa fase
   concluída. Some com o 2.
8. (baixo) A nota sob um `###` que não é sub-fase, entre tasks, ia só com a task
   anterior. Agora vai a toda parte.
9. (baixo) A parte aparecia como "tentativa N" e `cycle-N`. Agora é `parte k/N` e
   `part-k-of-N`.
10. (baixo) A medida da parte não contava a falha da preparação nem a lista de
    arquivos. Agora conta as duas, a lista pelo teto.
11. (baixo) A narração dizia que a sessão "recebe o que mudou". Agora diz o que
    ela recebe.

Cada um tem cenário na seção "o que a revisão adversarial achou" (o 2 e o 7, no
130.7). A revisão conferiu e achou correto: o prompt da fase pequena, a ausência
de aprovação antes dos gates, a retomada depois de queda em qualquer ponto da
gravação, a invalidação por documento e o parcial descartado, o recorte de fase
com outro número, as partes em ordem no worktree e a regra da gramática.

### 130.10 Compatibilidade

- O campo `partes` é opcional: o estado de antes da §130 se lê como sempre. Com a
  implementação começada e sem ele, a fase é dividida e começa da parte 1; com a
  implementação feita, nenhuma parte roda (os dois com cenário).
- Uma 0.7.3 que leia um estado com `partes` ignora o campo e refaz a
  implementação inteira, como fazia.
- Plano sem sub-fases e sem `Areas` é dividido só pelos critérios (cenário).
- O prompt da fase que cabe numa sessão é byte a byte o da 0.7.3.

### 130.11 Limitações e riscos

- Validado só com provider falso. Não há run real com modelo pequeno: o ganho
  para ele não está demonstrado, só a pressão de trabalho por sessão, que cai.
- O total enviado na implementação inicial dobra, e todo modelo divide a fase do
  mesmo jeito: nenhum adapter informa a janela, e não há como o desenvolvedor
  declarar que o executor é grande. Expor isso (opção ou configuração) é decisão
  de produto, não tomada aqui.
- As sessões de correção continuam com a fase inteira.
- Quando o processo cai com uma sessão aberta, a diferença no código é atribuída
  a ela; uma mudança por fora entre essa queda e a retomada, nos arquivos das
  partes, não é distinguida — os gates a pegam, depois.
- A lista de arquivos mudados é cumulativa e não separa o parcial da parte que
  roda de novo.
- No caminho de sessão única, a parada antes de a implementação terminar continua
  deixando `ultimoEstado` velho (anterior à §130, não mudado).
- Os números da política são de política: o piso das tasks foi corrigido pela
  medição (130.4), e o resto não foi calibrado com modelo.

## §131 — MiniMax: a preparação que integra, o raciocínio que o modelo aceita, e o effort que o BUILD consegue escolher

### 131.1 A evidência

O `laravel/mmax` (0.7.4, MiniMax-M3.1-Flash por API direta no INIT e no PLAN, e
pelo OpenCode 2.0.32 no BUILD paralelo) chegou ao RALPH READY
(`init-dc741f0d7b92`) e parou no `build-dd15cc4a810d` depois de a P01 passar em
todos os gates no worktree:

- **A integração.** A sessão de preparação criou `package.json` e
  `package-lock.json` mínimos na raiz. Eles não foram adotados, ficaram como
  não versionados na principal, e o worktree da P01 nasceu de um HEAD sem eles —
  o executor listou a raiz e viu só `.capivara/`, `node_modules/` e `.git`. A P01
  criou o próprio manifesto, e a integração parou: "a árvore principal tem
  alterações que não são do integrador (package-lock.json, package.json)".
- **O engines.** A preparação instalou `vitest@5.0.5`, cujo `engines.node` é
  `^22.12.0 || ^24.0.0 || >=26.0.0`, com o harness no Node 25.9.0. O npm só
  avisou (EBADENGINE), a sonda `vitest --version` passou, e o preflight aprovou.
  A preparação Node do worktree (`npm ci --engine-strict`) recusou a instalação.
  O G2 passou mesmo assim, com o `node_modules` que o executor tinha montado sem
  `--engine-strict`. A instalação da integração usa o mesmo `--engine-strict` e
  teria parado ali, mesmo sem os arquivos soltos.
- **O 400.** A primeira chamada do PLAN morreu em HTTP 400: `model
  "MiniMax-M3.1-Flash" requires adaptive thinking; thinking.type="disabled"
  (including reasoning.effort=none) is not allowed (2013)`.
- **O effort do BUILD.** O run registrou `effort: ""` em todos os papéis.

### 131.2 As causas, comprovadas

| defeito | causa comprovada | evidência |
|---|---|---|
| preparação não adotada | `adoptPreparedDependencies` só reconhecia pacotes de sondas `node -e require(...)` (`packagesInReadinessProbe`). TypeScript, Vite, Vitest e Playwright eram sondados por `./node_modules/.bin/X`, então só o `better-sqlite3` contava, e o manifesto declarava pacotes "não sondados" | `environment-preflight.log`, o `package.json` da raiz, `git status` do mmax; reproduzido em teste com a mesma mensagem |
| preflight aprova engines incompatível | `checkPrerequisites` só executava a sonda. O `engines` do pacote instalado nunca era lido, e o build instala com `--engine-strict` | `P01.dependencies-prepare-1.log` |
| HTTP 400 no PLAN | a guarda de `direct-api.ts` conhecia `MiniMax-M3.1-Flash-Preview`, não `MiniMax-M3.1-Flash`. Sem effort, o corpo levava `thinking: {type: "disabled"}` | log `interview.skeleton.writer.1-1.6540ac42…`; `/v1/models` atual só tem o nome sem `-Preview` |
| BUILD sem effort escolhível | o catálogo do OpenCode 2.0.32 traz o `minimax/MiniMax-M3.1-Flash` com `variants: []`: o wizard só oferecia "padrão do modelo", e `#low` morre em "Variant unavailable". Sem variante, o OpenCode não manda campo nenhum, e a API usa o `max` dela | CLI real contra servidor local, sem chamada paga |

A documentação oficial (platform.minimax.io, APIs compatíveis com OpenAI e com
Anthropic, conferida em 22/10/2026) estabelece o seguinte. Os mesmos fatos foram
reproduzidos na CLI.

| modelo | desliga o raciocínio | intensidade | omitida |
|---|---|---|---|
| `MiniMax-M3.1-Flash` | não (400, código 2013) | `reasoning_effort` (OpenAI) ou `output_config.effort` (Anthropic): low, medium, high, xhigh, max | max |
| `MiniMax-M3` | sim | não tem | ligado na API OpenAI; desligado na Anthropic |
| `MiniMax-M2.x` | não (o `disabled` é ignorado) | não tem | ligado |

O `/v1/models` devolve só identificadores, sem capacidade. O OpenCode fala com o
MiniMax pela API compatível com Anthropic (`@opencode/ai/providers/minimax/messages`,
`https://api.minimax.io/anthropic/v1`). Variantes declaradas em
`OPENCODE_CONFIG_CONTENT` aparecem no `model.list`, e o corpo da requisição leva
os `settings` delas.

### 131.3 O que já existia e foi reaproveitado

| mecanismo | onde | uso |
|---|---|---|
| adoção da preparação | `adoptPreparedDependencies` + `commitAdmitido` | mesmo critério de conteúdo e a mesma admissão; o conjunto de pacotes passa a incluir os das sondas `.bin` |
| registro da sessão de preparação | `runs/<run>/preparation/<id>.json` | ganha `pendentesAntes` e `criados`, campos novos e opcionais num registro que nenhum código lia |
| laço de preparação | `resolvePrerequisites` (2 tentativas) + `installPrompt` | a recusa de engines é evidência da sonda: a segunda sessão a recebe |
| catálogo de raciocínio | `ReasoningPolicy` (`provider/registry.ts`) | a regra por modelo sai da regex de `direct-api.ts` e vai para o catálogo, como o cabeçalho dele manda |
| injeção de configuração no OpenCode | `opencode-limits.ts` (o teto do OpenRouter) | o mesmo padrão de mescla, para as variantes |
| listagem | `listarEfforts`, `opencodeProviderId` | para a API direta, a documentação; para o OpenCode, a própria CLI, com a mesma configuração da chamada |

### 131.4 O que muda

- **Adoção** (`loop/prepared-dependencies.ts`, `loop/prerequisite-workspace.ts`).
  `packageBehindBinary` segue o link de `node_modules/.bin/X` até a pasta do
  pacote, dentro do `node_modules` que guarda o `.bin`. O link diz o pacote, e o
  nome da ferramenta não: `tsc` é do `typescript`, `playwright` é do
  `@playwright/test`. A adoção passa a exigir proveniência por conteúdo:
  `criadosPelaPreparacao` reúne, dos registros do run, cada caminho com o
  sha256 que a sessão deixou, e só entra no commit o arquivo cujo conteúdo atual
  é um desses. Sem registro com `criados` (sessão interrompida, ou registro de
  antes desta versão), nada é adotado. O critério de conteúdo, a exigência de
  nada mais pendente e a admissão continuam iguais.
- **Proveniência** (`loop/build.ts`). Antes da sessão de instalação, o Core lê os
  pendentes, com `node_modules` excluído já na consulta. Depois, `criados` são
  os pendentes novos e os que uma sessão anterior já tinha atestado, cada um com
  o seu sha256. A segunda tentativa, então, atesta o manifesto que mexeu da
  primeira. O que já estava na árvore continua do desenvolvedor, e o que ele
  reescrever no mesmo caminho entre duas execuções também. Falha nessa leitura
  deixa a sessão sem proveniência, e não derruba a preparação.
- **A preparação que não se adota para o build** (`loop/build.ts`). Se, depois
  dela, a árvore que estava limpa ficou com alterações que a adoção recusou, o
  build para antes da primeira fase, sem commitar nem apagar nada, e diz o que
  ficou. Antes ele seguia: no serial, o manifesto (e, sem exclusão, o
  `node_modules`) ia para o commit da fase. No paralelo, a fase verde era barrada
  na integração. Com registro de preparação no run e árvore suja, o erro do
  preflight diz por que nada foi adotado (`explicarPreparacaoNaoAdotada`).
- **Engines** (`loop/prerequisites.ts`). Quando a sonda passa, o Core lê o
  `engines.node` do pacote comprovado (o do link `.bin`, ou o do `require`) e da
  árvore que o lockfile da pasta registra, menos os opcionais, que o npm pula.
  `satisfiesNodeRange` confere cada um contra `process.version`, o Node que roda
  npm, scripts e gates (`runtimeEnvironment`). Se algum recusa, a sonda não está
  pronta, e a evidência diz quais. Intervalo que a leitura não cobre não tem
  veredito e não recusa nada.
- **Raciocínio documentado** (`provider/registry.ts`). `MINIMAX_MODELOS`,
  `raciocinioDoModelo` e `effortsDoModelo` ficam num lugar só, consumido por
  `direct-api.ts`, que recusa antes do HTTP com os efforts aceitos o raciocínio
  desligado onde o modelo não desliga e, no M3.1-Flash, o effort fora dos níveis
  (`minimal` seria 400; `thinking` cairia no `max` sem ninguém escolher). Também
  é consumido por `listarEfforts` (API direta) e por
  `withDocumentedEffortVariants` (`provider/cli/opencode-limits.ts`). Esta
  última injeta no OpenCode as variantes `low`…`max` do M3.1-Flash com
  `output_config.effort`, na chamada (`commands/agent.ts`) e na listagem, para
  as rotas `minimax/` e `minimax-coding-plan/`, que vão ao mesmo endereço
  documentado. A variante que a pessoa configurou vale sobre a documentada.
  Quando a CLI não responde à listagem, os níveis injetados continuam valendo.
- **Wizard** (`commands/wizard.ts`). Modelo de API direta que não desliga o
  raciocínio não ganha "desligado": aparecem só os níveis aceitos, e o padrão é
  o mais econômico. Pelo OpenCode, a lista vem da CLI, já com as variantes
  injetadas, e o "padrão do modelo" diz o que a API usa sem escolha (no
  M3.1-Flash, `max`).

### 131.5 O que NÃO muda, de propósito

- O default do effort. Sem `--effort`, a API direta continua sem raciocínio onde
  o modelo desliga, e recusa onde não desliga. Pelo OpenCode, "padrão do
  modelo" continua sendo o da CLI, que no M3.1-Flash é o `max` da API. Baixar o
  effort do executor tira tempo e custo, mas pode tirar qualidade, e nada aqui
  mede isso. A escolha é de quem roda.
- Os gates, o G0 que não exige o marcador de conclusão (a parte 3 terminou num
  turno vazio, e o G3 decidiu), a §130, o paralelo, a escada de recuperação e o
  UPSTREAM_REPAIR_REQUIRED.
- O comportamento dos outros providers e dos outros modelos MiniMax: o M3 sem
  effort continua desligando, e o M3 e o M2.x continuam aceitando o effort que já
  aceitavam. O único texto que muda é a orientação da recusa do M2.x, que dizia
  `--effort low` (parâmetro que o M2 não tem) e agora diz `thinking`.
- O INIT, o PLAN e os contratos de infraestrutura. Nenhuma dependência nova.

### 131.6 Infraestrutura: nenhuma contradição no plano

O plano declara "Node.js 20 ou posterior" e `vitest` sem versão. O `vitest@4.1.12`
declara `^20.0.0 || ^22.0.0 || >=24.0.0`, que aceita o Node 25. Existe, então,
instalação que cumpre o plano no Node do harness: o caso é de defeito
recuperável de instalação, aprovado em falso pelo preflight. Não é
UPSTREAM_REPAIR_REQUIRED. Contradição real só existiria se nenhuma versão
admitida pelo plano aceitasse nenhum Node admitido por ele, e não há aqui como
demonstrá-la. Se a segunda sessão também não achar versão compatível, o build
para antes da primeira fase, com a evidência. A saída então é reiniciar com um
Node que o pacote aceita, como já dizia a mensagem de `runtimeRecusado`.

### 131.7 Desempenho, medido nos logs do run

O stream JSON do OpenCode (`logs/agente-1.out.log`) dá, por passo, os tokens e os
tempos das ferramentas. A coluna "inferência" é o tempo dentro dos passos menos
as ferramentas. O "intervalo" é o tempo entre um passo e o seguinte: overhead do
OpenCode somado à espera pelo início da resposta, que o log não separa.

| sessão | parede | inferência | ferramentas | intervalo | passos | raciocínio | saída | entrada sem cache | cache lido | US$ |
|---|---|---|---|---|---|---|---|---|---|---|
| preparação | 550 s | — | — | — | — | 22.782 | 11.364 | 97.435 | 2.933.504 | 0,079 |
| parte 1/3 | 1674 s | 970 s | 393 s | 311 s | 79 | 54.053 | 25.286 | 157.516 | 7.056.128 | 0,177 |
| parte 2/3 | 307 s | 146 s | 64 s | 97 s | 48 | 25.139 | 18.130 | 101.289 | 2.922.752 | 0,085 |
| parte 3/3 | 993 s | 691 s | 209 s | 93 s | 52 | 44.051 | 18.523 | 56.242 | 4.222.848 | 0,109 |
| verificador | 312 s | 163 s | 29 s | 120 s | 24 | 18.170 | 3.672 | 80.946 | 1.226.112 | 0,044 |

- A preparação não tem stream no log, só o total, e incluiu trabalho de
  sistema: bibliotecas do WebKit, `apt` e navegadores do Playwright.
- A preparação Node do worktree falhou em segundos (EBADENGINE), e o G2 levou
  3,2 s. Nenhuma instalação de integração chegou a rodar.
- Não houve retry nem falha HTTP no BUILD. O PLAN teve o 400 da primeira
  chamada e um `fetch failed` de rede na auditoria, repetido com sucesso.
- O cache lido é cobrado a outra tarifa. O custo da coluna é o que o OpenCode
  calculou, e somar o cache à entrada inflaria o volume e o preço.
- Nas sessões do BUILD, 60% do tempo é inferência, 21% são ferramentas locais e
  19% são intervalo.
- O raciocínio é 141 mil tokens contra 66 mil de saída visível, com mediana de
  127 tokens/s nos passos de muito raciocínio. São cerca de 18 dos ~33 minutos
  de inferência. O passo mais lento (417 s, parte 1) raciocinou 20 mil tokens a
  48 tokens/s.
- Isso é o `max` que a API usa quando o OpenCode não manda intensidade. Não dá
  para chamar a API de lenta sem separar esse efeito, e também não dá para
  afirmar que um effort menor manteria a qualidade.

### 131.8 Testes: RED → GREEN

`test/loop/preparacao-131.spec.ts` e `test/provider/minimax-131.spec.ts` têm 69
cenários. Contra o código anterior, com só os símbolos novos como stub, 51 falham
pelo motivo do defeito. Os 18 que passam nos dois são os de compatibilidade e as
guardas de "não adotar", que o código antigo cumpre por não adotar nada. Entre
as falhas:

- a integração repete a mensagem real "não são do integrador";
- o manifesto do desenvolvedor é commitado pela adoção antiga;
- o `fetch` com `thinking: disabled` é chamado;
- a ponte morre em "Variant unavailable";
- o wizard oferece "desligado".

A CLI falsa reproduz o que a CLI real fez contra o servidor local. Os testes
existentes de `adoptPreparedDependencies` passam a declarar o que a preparação
criou, e a recusa do M2.x passa a orientar `thinking`.

### 131.9 Retomar o `build-dd15cc4a810d`

O projeto de evidência não foi modificado. Para ele, três coisas valem:

- A P01 fixou `vitest 5.0.5` (e `better-sqlite3 13.0.3`, `engines >=22`), então
  o entregável dela não instala com `--engine-strict` no Node 25. Retomar exige
  um Node que o Vitest 5 aceita: 22.12+, 24 ou 26.
- O manifesto solto da preparação antiga não tem registro de proveniência e não
  será adotado. O build vai parar na árvore suja, e a decisão é de quem roda:
  são arquivos gerados pela preparação, reproduzíveis.
- O branch `capivara/build-dd15cc4a810d/P01` continua guardando a fase. Quando
  a preparação recriar e adotar um manifesto, a reaplicação da P01 sobre ele
  conflita no `package.json`. O arquivo fica com a versão do HEAD, e o da fase
  continua no branch preservado (§113).

### 131.10 A revisão adversarial

Dois revisores independentes, um para Git e preflight e outro para providers e
wizard, leram o diff, rodaram cenários próprios e, no de Git, compararam
`satisfiesNodeRange` com o `semver.satisfies` do npm em 200 mil intervalos
aleatórios, sem divergência fora dos casos de borda abaixo. O que mudou por
causa deles, com cenário:

1. **Proveniência só por caminho.** O run é do plano, e os registros de uma
   execução anterior ficam. O manifesto que o desenvolvedor escrevesse depois,
   no mesmo caminho, seria adotado. Agora a prova é o conteúdo (sha256).
2. **Engines só do pacote sondado.** O `--engine-strict` confere a árvore toda,
   então a árvore do lockfile entra na conferência, menos os opcionais.
3. **A consulta de pendentes percorria o `node_modules`**, e uma falha dela
   derrubava a preparação. Agora o `node_modules` é excluído já na consulta, e
   a falha só deixa a sessão sem proveniência.
4. **Seguir com a preparação recusada** (defeito anterior à §131, reproduzido
   pelo revisor: no serial, o commit da fase levou o manifesto, o lock e o
   `node_modules`). Agora o build para antes da primeira fase.
5. **A rota `minimax-coding-plan/`** tem o mesmo modelo sem variantes no mesmo
   endereço, e entrou na injeção. As `-cn` vão a outro endereço, não conferido,
   e ficaram como a CLI as declara.
6. **Effort fora dos níveis do M3.1-Flash na API direta** passava: `minimal` dava
   400, e `thinking` caía no `max` em silêncio. Agora é recusado antes do HTTP.
7. **O "padrão do modelo" do BUILD** não dizia que era `max`, e a CLI que não
   respondia fazia o wizard oferecer um "desligado" que era o `max`.
8. **Detalhes:**
   - um comparador falso ao lado de um ilegível agora derruba a alternativa;
   - o link de `.bin` só vale dentro do `node_modules` que o guarda;
   - os testes da recusa mockam o `fetch`, para uma regressão nunca virar
     chamada real.

Ficaram, com o motivo:

- **A sessão de preparação interrompida (Ctrl-C) não é adotada na retomada.**
  Ela não chegou a dizer o que criou, e o que apareceu depois dela pode ser do
  desenvolvedor. É fail-closed por escolha. O erro agora diz isso e o que fazer
  (apagar, que a preparação refaz; ou commitar).
- **O effort por papel continua herdando o global.** "Ajustar algum papel" não
  pergunta o effort, e a CLI não tem como dizer "sem effort" a um papel
  (`overridesFor` ignora o vazio). Com `xhigh`/`max` no M3.1-Flash, um papel
  trocado para outro provider pode herdar um nível que aquele recusa. O
  desenho é anterior, e mudá-lo é mudar a semântica das flags.
- **`engines.npm` não é conferido**, porque pediria executar o npm. Também não
  são conferidos lockfile v1 nem shims que não são link (pnpm no Windows).
- **Intervalos inválidos para o npm** (`">=18 || latest"`, `"> = 25"`) aqui não
  recusam, e o npm os recusaria. Em todos os casos sem veredito, o
  comportamento é o de antes.

### 131.11 Limitações e riscos

- **Sem modelo real.** Nada foi validado com o MiniMax de verdade: as chamadas
  foram contra servidor local e CLI falsa, e a CLI real só contra servidor
  local. O efeito de um effort menor sobre tempo e qualidade não está medido.
- **Dependências externas.** A tabela do MiniMax é a documentação de
  22/10/2026, e um modelo novo da família fica sem regra até entrar nela. A
  injeção depende de o OpenCode aceitar variantes por configuração (2.0.32) e
  de usar a API compatível com Anthropic. Se o catálogo do OpenCode passar a
  declarar as variantes, a configuração da pessoa e a do catálogo continuam
  valendo sobre a injetada.
- **Janela da sessão.** Um arquivo que o desenvolvedor crie ou mude durante a
  sessão de preparação conta como dela. Entre duas sessões, mudança num
  arquivo já atestado é atestada de novo pela sessão seguinte.
- **Preflight mais estrito.** Ele passa a recusar ambiente que o build serial
  às vezes atravessava, enquanto nenhuma instalação estrita rodava. O
  `--engine-strict` já era a política do harness, e a recusa vem antes da
  primeira fase, com a evidência.
- **Retomada do run do mmax.** Ver 131.9.

### 131.12 Complemento: o catálogo de modelos do BUILD

**O defeito.** No INIT, o wizard lista o que a API do MiniMax devolve (dez
modelos). No BUILD, `escolherProviderModelo` trocava essa consulta pela
listagem do OpenCode filtrada por `minimax/`, que traz dois. A API sumia como
referência.

**O que se verificou antes de mudar**, com o OpenCode 2.0.32 real contra servidor
local:

- Modelo fora do catálogo dele (`minimax/MiniMax-M2.7`,
  `deepseek/deepseek-modelo-fora`, `anthropic/claude-fora-do-catalogo`) morre em
  `Model unavailable` com código 1, antes de qualquer requisição.
- Declarado em `provider.<id>.models.<modelo>` do `OPENCODE_CONFIG_CONTENT`, ele
  vai ao endpoint do provider.
- A documentação do MiniMax diz que a interface compatível com Anthropic, por
  onde o OpenCode fala com ele, "currently only supports the MiniMax-M3.1-Flash
  MiniMax-M3 models. For other models, please use the standard MiniMax API
  interface". Declarar os M2.x mandaria o modelo a um endpoint que a
  documentação diz não atendê-lo.
- No OpenRouter, a integração da Capivara já recusa o modelo cujo limite o
  catálogo do OpenCode não traz.

Declarar modelo fora do catálogo seria, então, mecanismo novo sem necessidade
comprovada, e no caso que motivou a correção, compatibilidade inventada.

**O que muda** (só `escolherProviderModelo` e `escolherModelo`, em
`commands/wizard.ts`):

- No BUILD, a API direta pelo OpenCode lista o catálogo da API
  (`listarModelos(provider)`) traduzido para `<opencodeProviderId>/<modelo>`.
- Os que o catálogo do OpenCode traz (`listarModelos("opencode")`) vêm primeiro
  e são escolhidos normalmente. O OpenCode pode conhecer modelos que a API não
  listou; esses continuam.
- Os demais aparecem com "fora do catálogo do OpenCode: o executor não o roda".
  Escolhê-los da lista mostra o diagnóstico ("Model unavailable" antes de
  qualquer requisição, mais o motivo documentado da rota, em
  `limiteDaRotaNoOpenCode`, por ora só o do MiniMax) e volta à escolha.
- Digitar o nome continua valendo, como antes.
- Sem resposta da API, a lista é a do OpenCode. Sem resposta do OpenCode, o nome
  é pedido. Nos dois casos, como era.
- Os efforts são os do modelo escolhido, pelo `listarEfforts` de sempre.
- Vale para toda API direta pelo OpenCode, inclusive no pool do paralelo e no
  ajuste por papel, que passam pela mesma função.

**O que não muda:** o INIT e o PLAN (a lista da API direta, sem marca), a CLI no
BUILD (só a própria CLI é consultada), os adapters de inferência, os gates, o
preflight e a §130.

**Testes.** `test/tui/catalogo-build-131.spec.ts` tem 9 cenários, com a API dando
dez modelos e o OpenCode dois. Contra a 0.7.5, 4 falham pelo motivo da
divergência, e o teste do DeepSeek no BUILD também falha, porque agora a API é
consultada. Os 5 de compatibilidade passam nos dois: digitar o nome, API sem
resposta, OpenCode sem resposta, INIT e CLI. Três testes antigos tinham o mesmo
mock devolvendo a mesma lista para a API e para o OpenCode. Eles passaram a ter
um catálogo por provider, com as mesmas asserções de intenção. Um deles conferia
que só o OpenCode era consultado, e agora confere a API e o OpenCode, nessa
ordem, depois da chave.

**Limitações.**

- **M2.x pelo executor.** Os modelos M2.x do MiniMax continuam sem rota pelo
  OpenCode. Usá-los exigiria um provider do OpenCode pela API padrão
  (compatível com OpenAI) do MiniMax, com raciocínio e ferramentas a validar com
  chamada real: decisão e custo que não cabem nesta correção.
- **Comparação exata de identificadores.** A documentação do Gemini não diz se a
  listagem compatível com OpenAI devolve `models/…`. Se devolver, os modelos da
  API aparecem como fora do OpenCode, e os do catálogo dele continuam listados e
  escolhíveis.
