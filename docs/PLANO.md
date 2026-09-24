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

### 50.2 O parente

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

### 58.1 Sem terminal, nada muda

CI, pipe, `ssh` sem tty: a mensagem completa sai como antes e o código de saída é
o mesmo. Um comando que abre pergunta dentro de um CI é um comando que trava o
CI — e a ergonomia de quem está no terminal não pode custar isso.

### 58.2 Um caminho, não dois

As perguntas de provider, modelo, effort e papéis saíram do corpo do wizard para
uma função própria, chamada pelos dois lados. Reimplementá-las no atalho seria
garantir que um dia as duas telas divergissem — e a primeira a ficar para trás
seria justamente esta, que é a que quase todo mundo vai ver.
