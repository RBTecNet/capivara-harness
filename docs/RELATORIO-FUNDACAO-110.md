# Relatório da §110 — fundação do gate 4 e preservação de fases aprovadas

- Branch: `correcao/fundacao-110`, derivada da `main` em `b3f1990`.
- Commit da implementação: `51205a2`.
- Origem: as propostas 1 e 2 de `docs/DIAGNOSTICO-P04-CONFLITO-INTEGRACAO.md`.
- Validação: `npm run check` com rc=0, 104 arquivos de teste e 1975 testes aprovados.

## Problema

No `build-96756ca336b0`, a P03 e a P04 rodavam em paralelo. Cada uma, no seu worktree, criou o mesmo `start` e o mesmo suporte a `PORT`/`HOST` na fundação compartilhada (`src/servidor/configuracao.ts`).

A P04 fechou verde e conflitou na integração. O desfecho "refazer" apagou o branch da fase, e o commit aprovado (`8c9365e`) ficou sem referência, à espera do `git gc`.

## O que mudou (5 arquivos, +304/−2)

### 1. A fundação do G4 é preparada uma vez, antes do paralelo

Arquivos: `packages/core/src/loop/paralelo.ts` e `packages/core/src/loop/build.ts`.

Quando o build tem fluxos e a árvore principal não declara `start` (`startCommandFor` devolve `null`), a primeira fase pendente com fluxo vira exclusiva antes da primeira leva. É o mesmo mecanismo da fase que volta de um conflito. Nessa fase:

- ela recebe o aviso do §109, de que o projeto não tem `start`;
- ela cria o `start` e passa pelos gates e pela integração de sempre;
- as outras fases com fluxo abrem o worktree a partir do HEAD, que já tem o `start`, e voltam ao paralelo.

Também:
- O Core não escreve código de produto: quem cria o `start` é o executor da fase.
- Com o `start` presente, nada disso acontece. A pergunta é feita uma vez, antes da primeira leva.
- Só essa fase roda sozinha; nem todas as fases são serializadas.

O build passa ao paralelo dois retornos novos e opcionais: `semEntrypoint()` e `comFluxos(session)`.

### 2. O verde que conflita fica num branch recuperável

Arquivos: `packages/core/src/loop/worktree.ts` (`preservarAprovado`) e `packages/core/src/loop/paralelo.ts`.

No desfecho "refazer", o commit aprovado ganha o branch `capivara/<run>/<fase>-aprovada-<sha7>`.

- **Integridade:** o branch aponta para o mesmo commit. Nada é copiado, reescrito ou integrado, e não há merge automático.
- **Sem colisão:** o sha no nome impede colisão com o branch da fase, que a nova rodada recria, e com o de outra tentativa.
- **Localização:** o evento `retry` registra o commit e o branch (`… o commit aprovado <sha12> ficou no branch <nome>`), e a retomada o encontra pelo log de eventos. A nova rodada também anuncia onde o verde anterior continua.
- **Estratégia mantida:** a fase continua sendo refeita sozinha sobre a árvore integrada.

## Testes

Os testes estão em `packages/core/test/loop/paralelo.spec.ts`. Git, worktrees, cherry-pick e eventos são reais; o provider e o Playwright são falsos.

| Teste | O que comprova |
|---|---|
| Sem `start`: só uma fase prepara a fundação | Só a P02 recebeu o aviso e criou o `start`. Ela rodou sozinha. A P03 e a P04 começaram depois dela e correram juntas, com 2 fases ao mesmo tempo no máximo. Não houve conflito, e o `start` integrado é o da P02. |
| Com `start`: nada é preparado | Nenhum aviso e nenhuma fase exclusiva. As três fases com fluxo correram juntas, com 3 ao mesmo tempo no máximo. |
| Conflito: o commit aprovado fica num branch | O commit e o branch são lidos do evento. O branch aponta para o commit aprovado, com o conteúdo e a mensagem `feat(phase-3)`. A árvore principal fica limpa, e só o branch preservado sobra. |

Contra o código anterior, o primeiro e o terceiro testes falham. O segundo passa nos dois, como deve: ele garante que nada muda quando o `start` já existe.

## Restrições respeitadas

- A §108 e as permissões do Claude não mudaram.
- Os critérios G0–G4 não mudaram.
- Não entrou nenhuma restrição nova aos agentes.
- O projeto experimental `teste_haiku_v2` não foi modificado.
- Não há resolução automática de conflitos.
- Não houve merge na `main`.

## Limitações

- Se a fase preparadora falhar com `--keep-going`, as outras fases com fluxo seguem em paralelo sem `start`. Cada uma recebe o aviso, e o risco de conflito volta. A preparação não é tentada com outra fase.
- Enquanto a preparadora roda, as fases posteriores a ela no plano esperam, mesmo as sem fluxo. É o comportamento de qualquer fase exclusiva. As anteriores podem rodar junto.
- Os branches `-aprovada-` não são apagados automaticamente.
- Nada foi validado num build real com o Haiku. A prova é dos testes.
