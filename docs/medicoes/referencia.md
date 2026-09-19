# A referência de comparação entre pilotos

Números medidos, não lembrados. Cada linha sai dos eventos do run, que ficam em
`.capivara/runs/<runId>/events.tsv` dentro do piloto.

## Piloto 5 — controle de gastos · todos os papéis em codex

| | |
|---|---|
| pedido | 17 linhas, 3 entidades, 6 fluxos |
| `init` | **6,5 min** → PLAN READY · 3 fases, 12 regras transversais |
| `plan` | **35,2 min** → RALPH READY · 35 tasks, 85 critérios |
| `build` | 87 min · 3 fases verdes · 1 ciclo de correção |
| escritor | 8 chamadas · 126k entrada / 69k saída · 1268s |
| auditor | 16 chamadas · 325k entrada / 128k saída · 2383s |
| verificador | 7 chamadas · 111k entrada / 12k saída · 250s |
| artefatos | esqueleto 7,1 KB · plano 26,6 KB |

O auditor sozinho consumiu mais tempo de modelo que o escritor e o verificador
somados. É o gargalo conhecido no momento em que o piloto 6 começa.

**Ressalva:** a medição de esforço da fase 1 do build está contaminada — eu
apaguei arquivos de um executor em sessão ativa e ele refez parte do trabalho.
As fases 2 e 3 são limpas, e o resultado final é válido (todas verdes,
verificadas, 72 testes do projeto passando).

## Piloto 6 — biblioteca comunitária · haiku escreve, opus julga

### Resultado

`init` **6,4 min** → PLAN READY · 7 fases, 7 entidades, 12 regras transversais.
`plan` → RALPH READY na **quinta** rodada · 7 fases, 61 tasks, 198 critérios,
todos observáveis no ensaio.

As cinco rodadas do `plan` não são cinco tentativas do modelo: são cinco defeitos
do harness, um por rodada, cada um escondendo o seguinte.

| rodada | o que mudou | devoluções | onde parou |
|---|---|---|---|
| 1 | — | 4 → 17 → 15 | contrato, stamp, cobertura |
| 2 | envelope montado em código | 5 → 78 | I-08 × 39, I-09 × 10 |
| 3 | reparo de markdown | 3 → 24 | uma fase sem tasks (plan mode) |
| 4 | adapter fora do plan mode | 8 → 5 | 20 UNOBSERVABLE (leitura do parser) |
| 5 | parser blindado + listas | 1 → 17 → 3 → 14 | **RALPH READY** |

Custo da quinta rodada, medido com a contagem de tokens já corrigida:

| papel | chamadas | entrada | tempo |
|---|---|---|---|
| escritor (haiku) | 25 | 679k | 1566s |
| auditor (opus) | 16 | 482k | 385s |
| verificador (opus) | 29 | 705k | 335s |

**O gargalo inverteu.** No piloto 5 o auditor consumiu 2383s, mais que escritor e
verificador somados; aqui levou 385s, e quem domina o relógio é o escritor
barato. É o que a tese previa: julgar é pouco trabalho por chamada, escrever é
volume.

**Os 170 minutos da quinta rodada não são o custo de um plano.** Incluem quatro
auditorias com oscilação — 1, 17, 3, 14 findings sobre um documento quase igual —
e um impasse. O número honesto de "quanto custa um plano com haiku" só sai de um
pedido novo, rodado uma vez, com o harness já corrigido.

### O que a rodada respondeu

Que um escritor barato, julgado por um auditor caro, **produz documentação
executável** — desde que o harness não lhe peça o que é determinístico. Dos
defeitos que derrubaram as quatro primeiras rodadas, nenhum era capacidade do
modelo: dois eram trabalho que o harness empurrava para ele, um era o adapter, e
um era a leitura do próprio plano.

### O desenho original desta rodada

Duas variáveis mudam ao mesmo tempo, e isso é deliberado:

1. **O tamanho do pedido.** 36 linhas, 6 entidades, 9 fluxos. O piloto 5 rendeu 3
   fases, e com 3 fases a fatia de uma fase e o esqueleto inteiro quase se
   confundem — `sliceForPhase`, que é o coração da economia do ciclo, segue
   praticamente não exercitado. Se este também sair com 3 fases, o achado é sobre
   o esqueleto subdimensionar, não sobre o pedido.
2. **Os modelos.** `writer` em haiku 4.5, `auditor` e `verifier` em opus 5. A
   direção respeita §24 — o juiz é mais forte que o autor, nunca o contrário.

O `builder` fica em codex nesta rodada, de propósito: medir `init` e `plan`
primeiro isola se a lentidão observada era do codex ou do desenho.

Como duas variáveis mudam juntas, um tempo diferente não atribui causa sozinho.
O que esta rodada responde com clareza é outra coisa: **um escritor barato,
julgado por um auditor caro, produz documentação executável?** Se produzir, a
configuração vale por si, independentemente de qual variável moveu o relógio.
