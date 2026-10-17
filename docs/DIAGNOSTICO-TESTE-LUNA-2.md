# Diagnóstico — `teste_luna`, segunda retomada: P04 integrada, P05 bloqueada no G3

- Run: `build-6e34384deccd`, retomado às 14:06Z de 2026-10-17 com a `main` em `7b6b519` (§107–§111) instalada.
- Agentes: dois codex/gpt-6-luna em paralelo, rodando a P04 (tarefas) e a P05 (categorias).
- Antes: `docs/DIAGNOSTICO-TESTE-LUNA.md`.
- Investigação feita só em leitura: nenhuma correção, nenhum build reiniciado, nenhum LLM chamado. A reaplicação dos parciais foi reproduzida num clone descartável, no scratchpad; o repositório do projeto não foi tocado.

## Conclusão

- **A P04 fechou verde e foi integrada** (`5d5a1fa`). O G4 subiu a aplicação na porta do gate e percorreu os fluxos 1 e 3: `2 passed`.
- **A P05 bloqueou no G3 no ciclo 3, pela terceira vez.** O build pausou de novo.

Em relação ao relatório anterior:

| Proposta | Situação |
|---|---|
| 1 — a saída da aplicação no G4 | Funcionou. A saída da aplicação agora aparece no log do gate (`[WebServer] Parallel Lab em http://127.0.0.1:47533`). Desta vez a porta já estava certa, porque a P06 corrigiu a fundação, e a mensagem nova não foi exercida. |
| 2 — o parcial na retomada | Os dois parciais foram preservados (`P04-parcial-5aee6ab` e `P05-parcial-0b677a5`), mas **nenhum foi reaplicado**: os dois conflitam com a árvore integrada no mesmo arquivo compartilhado. As fases recomeçaram do zero. |
| 3 — testes de navegador (não implementada) | É a causa do bloqueio da P05. |

## 1. A P05 bloqueou por defeitos que só aparecem rodando os testes de navegador

As recusas do G3 no ciclo 3 (`logs/P05.verify-3.log`):

- **TASK 6:** "o teste existente exige o link Categorias visível em 375 pixels sem abrir Menu, embora a navegação esteja oculta".
- **TASK 11:** "o fluxo principal usa seletores que encontram elementos duplicados; o teste de estados procura um nome acessível inexistente no indicador de carregamento".
- **TASK 8:** falta um teste que salve só a cor mantendo o nome.

As da TASK 6 e da TASK 11 são specs Playwright que falhariam na primeira execução. O executor não as rodou (`logs/P05.cycle-3.log`): "Não executei o Playwright; a instrução desta fase determina `npm test` como comando de testes e proíbe outro executor."

**A comparação com a P04 confirma.** No ciclo 1, o executor da P04 ignorou a proibição e rodou `npm run test:e2e -- testes/modulos/tarefas` (`logs/P04.cycle-1.log`). Nos ciclos 2 e 3 ele não rodou, mas as specs já tinham sido corrigidas contra o navegador real. A P04 fechou o G3 no ciclo 3. A P05 escreveu as specs às cegas nos três ciclos e não fechou.

A causa é a mesma do relatório anterior, seção 3. O prompt diz "Always run the suite with: `npm test`… Do not use another runner". Neste projeto, `npm test` é só o Vitest, e as specs `*.spec.ts` rodam por `test:e2e`. Nenhum gate executa essas specs: o G2 roda `npm test`, e o G4 roda só os roteiros do próprio harness.

## 2. Os parciais não se reaplicam: o conflito está num arquivo compartilhado

Reproduzi a reaplicação num clone, com `merge --squash` sobre `74ad68a`, que era o HEAD da retomada:

```
P04 (5aee6ab): conflito em testes/compartilhado/api-fundacao.test.ts
P05 (0b677a5): conflito em testes/compartilhado/api-fundacao.test.ts
```

As duas tentativas anteriores e a P06 alteraram esse arquivo, cada uma de um jeito (seção 3). A P06 integrou primeiro, e a reaplicação, que é tudo ou nada, desistiu do parcial inteiro por causa de um único arquivo. O parcial da P04 tinha 8 arquivos e o da P05 tinha 6.

Os números confirmam:
- só 56 das 339 linhas do parcial da P04 aparecem no commit integrado;
- só 36 das 282 do parcial da P05 aparecem no novo `wip`.

São linhas que o executor reescreveu do zero de forma parecida.

Os branches preservados estão intactos. O comportamento segue o projetado (§111: "se conflita, a fase começa limpa"), e a utilidade, neste projeto, foi nenhuma.

## 3. O primeiro ciclo de cada fase é gasto com o mesmo teste antigo

A P02 escreveu em `testes/compartilhado/api-fundacao.test.ts` verificações de que as rotas dos módulos ainda não implementados respondem 404. Cada fase que implementa um módulo quebra essas verificações. Nas seis tentativas de P04 e P05, o G2 do ciclo 1 falhou por isso: "expected 200 to be 404".

- No ciclo 1, o executor recusa alterar o arquivo: "Mantive esses testes intactos porque a especificação limita as alterações aos diretórios de tarefas" (P04); "fora do escopo permitido" (P05).
- No ciclo 2, com o G2 vermelho na mão, ele altera.

São seis ciclos perdidos no run, e é esse mesmo arquivo que impede a reaplicação na seção 2.

A dica do G2 piora a situação. A mensagem "4 das 6 falhas trazem a MESMA mensagem… costuma ser configuração do ambiente de teste, não defeito de lógica. Verifique o setup do runner" aponta para o lugar errado: a causa é um teste de fase anterior que fixa a ausência do módulo.

## Propostas (não implementadas)

1. **Os testes de navegador do projeto** (é a proposta 3 do relatório anterior, e o que bloqueou a P05). Quando o manifesto declara um script de e2e, como `test:e2e`, o prompt passa a nomeá-lo como o comando para os testes de navegador, em vez de proibir "outro runner". `npm test` continua sendo o comando do G2. O critério do gate não muda, e o executor deixa de escrever specs às cegas.
2. **Reaplicação por arquivo.** Quando o `merge --squash` conflita, manter o parcial nos arquivos que não conflitam e a versão do HEAD nos que conflitam (`-X ours`, ou um checkout do HEAD só nesses caminhos). O anúncio passa a dizer quais arquivos ficaram de fora. Aqui, 7 dos 8 arquivos da P04 e 5 dos 6 da P05 teriam voltado.
3. **Opcional:** a heurística da "mesma mensagem" no G2 deixa de sugerir configuração do ambiente quando as falhas vêm de um arquivo de teste que a fase não alterou. Também pode dizer que um teste de fase anterior que contradiz a fase atual pode ser atualizado.

## Estado do run

- Integradas: P01, P02, P03, P04 (`5d5a1fa`) e P06.
- P05 bloqueada, com o parcial em `capivara/build-6e34384deccd/P05` (`ef23ed8`). Os anteriores estão em `P05-parcial-0b677a5` e `P04-parcial-5aee6ab`.
- P07 não rodou. O build está pausado. O processo `capivara` aberto no projeto é a interface, sem build em andamento.
