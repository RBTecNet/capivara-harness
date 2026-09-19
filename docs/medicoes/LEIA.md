# Medições — a cadeia em prosa contra o ciclo em três estágios

O mesmo pedido, `pedido.md`, rodado pelos dois caminhos. É a evidência bruta por trás da
tabela de `docs/PLANO.md` §26.1, guardada aqui porque os diretórios dos pilotos foram
descartados e uma afirmação sem evidência em disco não é falsificável.

| arquivo | o que é |
|---|---|
| `pedido.md` | o pedido, idêntico nos dois pilotos |
| `piloto-3-cadeia-em-prosa.events.tsv` | a cadeia de quatro documentos, três tentativas, todas bloqueadas |
| `piloto-4-ciclo-novo.events.tsv` | `init` + `plan` do ciclo atual, de ponta a ponta até RALPH READY |

O formato é `timestamp · estágio · assunto · tentativa · status · detalhe`, separado por tab.

## Como ler o do piloto 3

Três sessões, separadas por horas de intervalo. Quebre-as por lacunas maiores que 30 minutos:

```
09-17 23:52 → 03:19   207 min   terminou bloqueada
09-18 11:22 → 13:36   134 min   terminou bloqueada  (só o estágio do plano)
09-18 14:59 → 18:31   212 min   terminou bloqueada
```

Nenhuma publicou um plano executável. Os detalhes das linhas `audit ... retry` são os
findings reais do auditor — vale lê-los: quase todos são sobre ambiguidade que a prosa
deixou passar e que hoje o esqueleto resolve com regras transversais nomeadas.

## Como ler o do piloto 4

Uma sessão, 17 linhas, 02:56:23 → 03:23:20. O `ready ... PLAN READY` no meio é o corte
entre `init` e `plan`. O `build` que veio depois fechou as três fases sem nenhum ciclo de
correção — esse run não está aqui porque o que se quer comparar é a documentação.
