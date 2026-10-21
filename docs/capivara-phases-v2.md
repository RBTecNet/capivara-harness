# Contrato `capivara-phases/v2`

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

<!-- inputs: skeleton.md@sha256:abc123abc123 architecture.md@sha256:def456def456 -->

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
  - **Design ref:** <caminho sob o diretório de design>
  - **Traces:** US-1.1, users, workflow 2

## Open Questions
```

O planejamento descreve entregas e critérios de aceite observáveis. Quem decide
como provar o produto é o avaliador do build, lendo o código entregue: o plano
não nomeia testes, arquivos de teste nem procedimentos de validação, e o rótulo
`**Feature tests:**` da geração anterior é recusado (I-15). `**Design ref:**` é
opcional e só aponta para artefato de design existente. Os rótulos são literais e
nunca são traduzidos; a indentação dos sub-itens é livre.

O stamp da linha 3 cita os dois documentos que o plano leu: `skeleton.md`, o
produto definido pelo `init`, e `architecture.md`, a arquitetura e a
infraestrutura decididas pelo `plan` antes de escrever as fases.

**Documentos de versões anteriores são incompatíveis.** Um plano `capivara-phases/v1`
não é lido nem convertido: gere de novo com `capivara init --fresh` e `capivara plan --fresh`.

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
| I-15 | Nenhum rótulo `**Feature tests:**`: o plano descreve comportamento, não testes | `parser` | `rejects` |
| I-16 | Nenhuma prescrição de teste: ferramenta, arquivo, diretório, configuração, task de teste, cobertura, tipo de teste ou procedimento da execução não entram no plano | `test-prescription` | `rejects` |
| I-17 | O esqueleto não fixa mecanismo de implementação sem autoridade: caminho de arquivo, variável de ambiente, comando ou código não entram nas regras, na stack, nas stories, nos fluxos nem nas fases | `mechanism-prescription` | `rejects` |
| I-18 | Fases sem dependência entre si não recebem obrigação de escrita no mesmo arquivo: um arquivo compartilhado tem um dono por vez, e quem pode rodar ao mesmo tempo escreve só nos seus | `write-ownership` | `rejects` |

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
- **I-15** — Quem decide como provar o produto é o avaliador do build, lendo o código entregue. Um teste nomeado no plano vira obrigação inventada antes de existir código, e um plano da geração anterior que o carrega é incompatível: ele é recusado, nunca convertido em silêncio.
- **I-16** — O plano descreve o produto e o caminho de implementação; a estratégia de validação — qual ferramenta, quais arquivos, quais cenários, que trabalho de teste em que fase, que tipo e organização — é do build. Um termo que o pedido ou uma decisão aceita do desenvolvedor contém não é prescrição do plano: é dele, e passa; o pedido que exige testes automatizados autoriza o requisito (um critério de comportamento do produto), não a task de escrevê-los. O mesmo critério vale para a stack e as fases do esqueleto e para a infraestrutura e as fases da arquitetura, que são de onde a prescrição se propagava. O procedimento da execução — quem cria, aponta e destrói o banco que os testes usam — também é do build: o isolamento é requisito do produto; a execução que o produz não é responsabilidade de componente, decisão de dados, requisito de ambiente nem goal de fase.
- **I-17** — O init levanta o produto; o plan decide a engenharia. Um mecanismo escrito no esqueleto chega ao arquiteto como requisito, a auditoria da arquitetura o cobra como fidelidade, e dois mecanismos inventados em regras diferentes viram uma contradição que ninguém tem autoridade para resolver — foi o CREATE TABLE do esqueleto contra a regra de migração no Parallel Lab. Um termo que o pedido ou uma decisão aceita do desenvolvedor contém não é prescrição: é dele, e passa. A entrada de stack que é só estrutura de pastas sai contando; o resto volta ao escritor nomeado, e o resíduo depois da escada de recuperação é publicado com ressalva, nunca bloqueia.
- **I-18** — O build executa ao mesmo tempo as fases que não dependem uma da outra, e a arquitetura serializa as que estendem o mesmo componente (§119) — mas a task de uma fase pode ordenar "acrescentar em modulos.ts" um registro que a fundação já entrega, e quatro fases paralelas editariam o mesmo arquivo, duplicando a entrada. No Parallel Lab o auditor viu, a triagem descartou por existir uma implementação que evitaria o conflito, e o plano foi publicado ordenando o que o executor literal não pode cumprir. A obrigação de escrita é a frase da task que ordena criar, acrescentar, registrar ou alterar um arquivo nomeado; um critério que verifica o estado final de um arquivo não é escrita, um arquivo citado como fonte é consumo, e fases com ordem entre si podem alterar o mesmo arquivo. A correção é documental e local — a fase escreve só nos seus arquivos — e a ordem entre fases é da arquitetura (dependsOn), nunca inventada por esta checagem.

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
| `**Feature tests:**` por task (v1) | o plano descreve comportamento; quem decide como prová-lo é o avaliador do build, lendo o código entregue. Um teste nomeado antes de existir código virava obrigação inventada, e o rótulo é recusado (I-15) em vez de lido como sugestão |

Um campo novo só entra depois de responder: **qual decisão do loop quebra sem
ele?** Se a resposta for "nenhuma", o campo não existe.
