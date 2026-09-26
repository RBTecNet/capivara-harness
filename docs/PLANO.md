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

