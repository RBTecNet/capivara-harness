# Handoff — onde o trabalho está

Escrito em 2026-09-20, no commit `4b08b08`, para quem pega o projeto sem o
histórico da conversa que o produziu.

Isto **não** repete o que o `README.md` e o `CAPIVARA.md` já dizem. Leia aqueles
primeiro: eles explicam o que a capivara é. Este arquivo diz em que ponto ela
está, o que não está feito, e as armadilhas que custaram caro para descobrir.

---

## O estado, em números

| | |
|---|---|
| branch | `ciclo-unico`, **39 commits à frente de `main`** |
| versão | 0.2.0 (`capivara --ver`) |
| suíte | 874 testes em 46 arquivos, `npm run check` verde |
| CLIs integradas | `codex`, `claude`, `opencode`, `agy`, `cursor` |

`main` está velho. Toda a estrutura de três estágios vive em `ciclo-unico`, e a
decisão de fundir (ou abrir PR) ainda não foi tomada.

## O que está pronto e medido

O ciclo de três estágios — `init` → `plan` → `build` — funciona de ponta a ponta
com modelo real. As medições estão em `docs/medicoes/referencia.md`; o resumo é
que **o mesmo plano de 61 tasks foi construído por cinco executores diferentes**,
e a conclusão que mudou o projeto foi esta:

> Número de ciclos de correção é sinal de **qualidade**, não só de velocidade.
> 18 devoluções entregaram menos produto que 3, no mesmo tempo de relógio.

O §24 do plano — *quem julga não é onde se economiza* — foi provado
experimentalmente: o mesmo executor fraco que morria na fase 1 com um auditor
caro terminou as sete fases quando o harness parou de esconder informação dele.

## O que NÃO está feito

Em ordem de importância, não de esforço:

1. **§28 — nenhum gate exercita a aplicação.** É o buraco real. Os quatro gates
   leem código; nenhum abre o produto e clica. Foi assim que um build fechou com
   as sete fases verdes e metade dos cadastros sem funcionar. O esqueleto já traz
   os `workflows` em texto e o plano os rastreia em `Traces` — a informação
   existe e é estruturada. Falta o runner.
2. **§27 — `skeleton.md` é derivado e ninguém confere.** O `plan` deveria
   recusar quando o markdown publicado divergir de `.skeleton-state.json`.
3. **Cosmético:** o painel do `plan` mostra "esqueleto do produto — aguardando"
   mesmo lendo um esqueleto que já existe. O pipeline foi desenhado para o `init`
   e o `plan` o herdou.
4. **A decisão de fundir `ciclo-unico` em `main`.**

## As armadilhas, em uma linha cada

Coisas que custaram um run inteiro para descobrir e que **não são óbvias no
código**. Todas já corrigidas — estão aqui para não serem reintroduzidas.

- **Quando um modelo fraco falha, a primeira suspeita é o harness.** Foi errado
  duas vezes por mim: culpei o haiku e culpei o composer, e nas duas o defeito
  era nosso. O §30 e o §31 do plano são a lista do que estava escondido.
- **`--permission-mode plan` do claude escreve arquivos.** Um papel read-only
  configurado assim devolve a mensagem de erro da CLI como se fosse conteúdo.
- **`\Z` não é âncora em JavaScript.** É a letra Z. Um preflight passou meses
  sem verificar nada por causa disso.
- **Nunca apague `.capivara/runs/` sem checar o lock.** Eu apaguei `src/` de um
  build vivo por diagnosticar como morto um processo que estava rodando.
- **Compare argv entrada por entrada, nunca a string juntada.** `-p` casa dentro
  de `--dangerously-skip-permissions`; `--mode` casa dentro de `--model`.
- **A correção que fica pela metade** é a forma de defeito mais comum aqui: a
  verificação existe num lugar e falta no irmão. Ver a tabela no `CAPIVARA.md`.

## Como verificar que nada quebrou

```bash
npm run check     # build + typecheck + 874 testes
```

O teste que mais protege a tese está em `test/architecture.spec.ts`: ele falha se
qualquer módulo fora de `src/contract/` recriar a gramática do plano, e se os
estágios de documentação voltarem a ter painéis separados.

Para exercitar sem gastar dinheiro, o catálogo de cenários do Apêndice B roda a
cadeia inteira contra um provider falso.

## Onde olhar quando algo falhar num run real

Desde o commit `4b08b08` os três estágios guardam transcrição:

```
.capivara/runs/<runId>/prompts/<estágio>.<assunto>.<papel>.<n>-<t>.txt
.capivara/runs/<runId>/logs/<mesma coisa>.log
.capivara/runs/<runId>/events.tsv
```

Antes disso, só o `build` guardava — e por isso não há como diagnosticar, hoje,
por que o minimax-m3 não fechou o `plan` do projeto `cron6`. Da próxima vez
haverá.

## O histórico da decisão

`docs/PLANO.md` é o registro de por que cada coisa é como é, em seções numeradas.
As mais recentes são as mais úteis para quem chega agora:

- **§26** — o ciclo de três estágios e a remoção da cadeia em prosa
- **§29** — o estágio que impunha uma convenção em vez de registrar um fato
- **§30** — três defeitos que uma execução de teste expôs
- **§31** — o que o harness sabia e não contava a ninguém
