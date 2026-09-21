# Handoff — onde o trabalho está

Escrito em 2026-09-20 e atualizado no mesmo dia, depois do incidente `cron5`,
para quem pega o projeto sem o histórico da conversa que o produziu. O último
commit é o que corrigiu o gate 0 (§32 do plano), e a árvore está limpa.

Isto **não** repete o que o `README.md` e o `CAPIVARA.md` já dizem. Leia aqueles
primeiro: eles explicam o que a capivara é. Este arquivo diz em que ponto ela
está, o que não está feito, e as armadilhas que custaram caro para descobrir.

---

## O estado, em números

| | |
|---|---|
| branch | `main` — é onde tudo está |
| versão | 0.2.0 (`capivara --ver`) |
| suíte | 984 testes em 53 arquivos, `npm run check` verde |
| CLIs integradas | `codex`, `claude`, `opencode`, `agy`, `cursor` |

O ciclo de três estágios foi desenvolvido no branch `ciclo-unico` e fundido em
`main` por fast-forward — `main` não tinha commits próprios, então o histórico é
uma linha reta e não há commit de merge. O branch foi apagado depois disso; a tag
`checkpoint-2026-09-20` marca esse ponto, no commit `49d32e6`. Dois commits
vieram depois dela; o que eles trouxeram está na seção seguinte.

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

## O que veio depois do checkpoint

Quatro frentes, todas nascidas de um run real. As três primeiras estão
commitadas; o gate 4 é o trabalho corrente.

**§34 — a base documental.** O harness lê o pedido, as decisões e as skills de
uma base MCP (`doc-center`, em repositório próprio), materializa as skills em
`.capivara/skills/` e escolhe por área quais entram em cada fase. De volta,
registra as decisões da entrevista, o que o executor aprendeu e onde o trabalho
parou — tudo como rascunho, que não é servido a run nenhum até alguém aprovar. A
base é conveniência: fora do ar, o build segue com o que está no disco.

**§33 — o gate 4, que abre a aplicação.** O §28 deixou de ser pendente. Os fluxos
que o esqueleto sempre declarou viram roteiros Playwright, escritos por uma sessão
que não implementou a fase, guardados em `.capivara/flows/` e rodados pelo loop
contra o produto de pé. O roteiro fica no projeto, então o fluxo da fase 2
continua sendo percorrido na fase 7. O que dá para conferir sem abrir navegador —
um passo por `test.step`, um `expect` por passo, nada de `skip`, nada de
interceptar o próprio backend — é conferido antes. Provado contra navegador de
verdade: produto íntegro verde, produto sem o botão vermelho no passo 2.

**§8.6 do plano — as correções do incidente `cron5`.** A função que decide de
quais fases os findings falam saiu do `init/orchestrator.ts` para
`src/contract/phase-references.ts`: a gramática do plano mora no contrato, e o
`architecture.spec.ts` cobra isso. Ela passou a reconhecer `Phase N`, `Fase N` e o
endereço `P2.T2.C1`, e a ler também a orientação de correção, não só o `where`.
Sem o terceiro formato, a correção do `cron5` foi inteira para a fase 1 enquanto o
defeito estava na 2. Sem fase identificável, o fallback conservador continua:
revisar todas.

No impasse existe agora o comando `reiniciar`, que abre um ciclo novo de correção e
auditoria do documento atual com os mesmos tetos, preservando entrevista, esqueleto
e plano. É controle de execução, nunca decisão de produto — o `cron5` gravou a
palavra como ACCEPTED e com isso liberou a rejeição seguinte como ressalva. Cada
reinício precisa ser pedido outra vez, e os números de tentativa seguem crescendo
para não sobrescrever os logs anteriores.

**§32 — o gate 0 reprovava toda volta bem-sucedida do claude.** É o mais grave
dos três, e foi o que travou o `cron5` com o sonnet.
 O gate procurava
o envelope JSON dentro do stdout; a ponte entrega o texto de dentro do envelope,
que ela mesma acabou de abrir. Com engine `claude`, só as chamadas que falhavam
passavam no primeiro teste do gate — nenhuma fase jamais fechou com esse executor.
Agora quem abre o envelope reporta os dois fatos (`resultRead`, `engineError`) e o
gate pergunta pelos fatos, para qualquer CLI com envelope, não só a do claude. O
teste que faltava é o da costura: CLI falsa, ponte de verdade, gate de verdade.

**O painel.** Cabeçalho compacto, com o mascote proporcional centralizado no painel
e o título à esquerda quando couber. A altura passou a ser medida a cada desenho,
como já era a largura: em tela baixa encolhem primeiro o histórico e a janela de
fases, depois a decoração, e a fase corrente e a atividade sobrevivem. A pergunta
mantém o conteúdo completo e vira saída estática quando não couber. O piso de 60
colunas saiu — ele fazia o terminal estreito quebrar linha e invalidar a contagem
que a região viva usa para redesenhar.

## O que NÃO está feito

Em ordem de importância, não de esforço:

1. **§27 — `skeleton.md` é derivado e ninguém confere.** O `plan` deveria
   recusar quando o markdown publicado divergir de `.skeleton-state.json`.
2. **O gate 4 só serve a produto que sobe como serviço.** Para CLI e biblioteca
   não há driver, e o caminho hoje é `--no-flows`. Os limites estão ditos no fim
   do §33.
3. **Falha de infraestrutura ainda consome ciclo de correção** e é devolvida ao
   executor como se fosse defeito do código dele. Está no fim do §32.
4. **Cosmético:** o painel do `plan` mostra "esqueleto do produto — aguardando"
   mesmo lendo um esqueleto que já existe. O pipeline foi desenhado para o `init`
   e o `plan` o herdou.

## As armadilhas, em uma linha cada

Coisas que custaram um run inteiro para descobrir e que **não são óbvias no
código**. Todas já corrigidas — estão aqui para não serem reintroduzidas.

- **Quando um modelo fraco falha, a primeira suspeita é o harness.** Foi errado
  duas vezes por mim: culpei o haiku e culpei o composer, e nas duas o defeito
  era nosso. O §30 e o §31 do plano são a lista do que estava escondido.
- **`--permission-mode plan` do claude escreve arquivos.** Um papel read-only
  configurado assim devolve a mensagem de erro da CLI como se fosse conteúdo.
- **`\Z` não é âncora em JavaScript.** É a letra Z. Um preflight passou meses
  sem verificar nada por causa disso — e o mesmo `\Z` ainda estava vivo na
  leitura do `pyproject`, onde derrubava o passo que prova que o produto sobe.
  O fim de texto se escreve `$(?![\s\S])`.
- **Nunca apague `.capivara/runs/` sem checar o lock.** Eu apaguei `src/` de um
  build vivo por diagnosticar como morto um processo que estava rodando.
- **Compare argv entrada por entrada, nunca a string juntada.** `-p` casa dentro
  de `--dangerously-skip-permissions`; `--mode` casa dentro de `--model`.
- **O auditor cita fase em três formatos.** `Phase 2`, `Fase 2` e `P2.T2.C1`. Quem
  conhece só dois manda a emenda para a fase errada — e a orientação de correção
  aponta a fase tanto quanto o campo do local.
- **Depois de um resize, a contagem de linhas do desenho anterior é ficção.** O
  terminal refluiu cada linha antiga; subir por aquele número apaga a coisa errada.
- **Quem abre o envelope é quem sabe o que havia dentro.** Depois da ponte, o
  stdout é o texto do agente; procurar ali o envelope da CLI é procurar o que foi
  retirado. Fato de envelope viaja como campo, nunca como regex sobre o texto.
- **Defeito de ambiente nunca vira defeito de produto.** Três vezes o executor
  foi mandado consertar o que não estava quebrado — envelope aberto pela ponte,
  aplicação que não subiu, pacote não instalado. A causa precisa dizer de quem é
  o defeito. Ver §34.8.
- **A correção que fica pela metade** é a forma de defeito mais comum aqui: a
  verificação existe num lugar e falta no irmão. Ver a tabela no `CAPIVARA.md`.

## Como verificar que nada quebrou

```bash
npm run check     # build + typecheck + 984 testes
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
- **§32** — o gate que procurava o envelope que a ponte já tinha aberto (`cron5`)
- **§8.6** — as correções do incidente `cron5`, fora da ordem por ser emenda do §8
- **§34** — a base documental: o que ela guarda e como chega a quem precisa
