> Registro histórico anterior à reconstrução 0.9.0_RC1. Não define comandos nem regras do motor atual. Consulte [README](../README.md) e [reconstrução](RECONSTRUCAO-0.9.0_RC1.md).

# Diagnóstico — `teste_luna`: P04 e P05 bloqueadas com codex/gpt-6-luna

- Run: `build-6e34384deccd`, projeto `/home/bruno/Documentos/Projetos/laravel/teste_luna`, branch `master`, em 2026-10-17. A primeira execução foi das 10:17Z às 11:13Z, e a retomada das 11:18Z às 11:37Z.
- `execucao.json`: modo paralelo, três agentes `codex` / `gpt-6-luna` / `high`. O `run.json` registra como papéis padrão `codex` / `gpt-6.1-sol` / `xhigh` para o executor e o verificador. Os logs não dizem qual modelo atendeu cada chamada.
- Harness instalado: a branch `correcao/fundacao-110` (§107–§110).
- Investigação feita só em leitura, sem correções, sem build reiniciado e sem LLM. `git fsck --unreachable --no-reflogs` foi usado sem `--lost-found` e não gravou nada.

## Conclusão

O run fez 4 das 6 fases implementadas: P01, P02, P03 e P06 foram integradas. A P04 (tarefas) e a P05 (categorias) bloquearam, e o build pausou.

Três defeitos do harness influíram no resultado; os outros bloqueios vieram de o modelo não cumprir os testes nomeados pelo plano.

1. **A P04 bloqueou no G4 por um defeito simples, que o gate não deixou ver.** A aplicação escutava em `PORTA` (3000), e não em `PORT`. O G4 só esperou 180 s e devolveu `Timed out waiting 180000ms from config.webServer`, sem a saída da aplicação. Como era o último ciclo, a fase bloqueou sem chance de correção.
2. **A retomada jogou fora o trabalho da P04.** O parcial da primeira tentativa, que passou por G1–G3, ficou num `wip(P04)` (`883f7d4`). Na retomada, `abrirWorktree` apagou esse branch, e a P04 recomeçou do zero, sobre a árvore integrada. Na segunda tentativa, ela não passou do G3.
3. **Os testes de navegador do projeto nunca são executados.** `npm test` é só o Vitest (`*.test.ts`), enquanto as specs Playwright do produto (`*.spec.ts`) rodam por `test:e2e`. O prompt proíbe o executor de usar outro runner, e o G2 roda só `npm test`. As specs são escritas às cegas, e o verificador as julga só pela leitura. Boa parte das recusas do G3 é sobre comportamento no navegador.

## Linha do tempo (`events.tsv`)

| Fase | Ciclos | Desfecho |
|---|---|---|
| P01 Fundação | G3 ✗, G3 ✗, verde | integrada 10:32Z |
| P02 Contratos e API | G3 ✗, G3 ✗, verde | integrada 10:42Z |
| P03 Interface compartilhada | G3 ✗, verde | integrada 10:56Z |
| P04 Tarefas (1ª) | G2 ✗, G3 ✗, **G4 ✗ no ciclo 3** | bloqueada 11:13Z; build pausado |
| P04 Tarefas (retomada) | G2 ✗, G3 ✗, G3 ✗ | bloqueada 11:29Z |
| P05 Categorias | G2 ✗, G3 ✗, G3 ✗ | bloqueada 11:27Z |
| P06 Anotações | G3 ✗, **G4 ✗ no ciclo 2**, verde | integrada 11:37Z; build pausado |

A P07 não chegou a rodar. Na retomada, a P04, a P05 e a P06 rodaram em paralelo, sem conflito de integração.

## 1. O G4 da P04: a porta errada, e o gate sem a saída da aplicação

A configuração da fundação (`src/servidor/configuracao.ts`, da P01) lia só `PORTA`:

```ts
porta: Number(ambiente.PORTA ?? 3000),
```

O `start` existia (`node dist/servidor/servidor/index.js`), então o aviso de entrypoint ausente da §109 não se aplicava e a §110 não preparou nada. O contrato da §107 ("How the application is started for the flow gate") estava nos três prompts da P04. O executor não o cumpriu: tratou só as recusas do G3.

O G4 rodou pela primeira vez no ciclo 3:
- subiu `npm run build && npm start` com `PORT=47533`;
- a aplicação escutou em 3000;
- o Playwright esperou os 180 s.

O log inteiro da passagem (`logs/P04.flow-run-3.log`) é esta linha:

```
Error: Timed out waiting 180000ms from config.webServer.
```

A aplicação escreve `Parallel Lab em http://127.0.0.1:3000` no stdout (`src/servidor/index.ts`). O `webServer` que o capivara gera (`packages/core/src/loop/flows.ts:350-354`) não define `stdout`, e o padrão do Playwright é ignorá-lo. A linha que diria "escutei na 3000" se perdeu.

A classificação da §107 cobre só `EADDRINUSE`. O timeout cai na mensagem genérica, "a aplicação NÃO SUBIU… O entrypoint precisa escutar na porta que vem em PORT" (`flows.ts:1045-1056`), e a fase bloqueou ali mesmo.

**A mensagem basta quando sobra ciclo.** A P06 teve a mesma falha no ciclo 2. No ciclo 3, o executor trocou uma linha (`ambiente.PORT ?? ambiente.PORTA ?? 3000`), e o G4 passou: `1 passed`, em `logs/P06.flow-run-3.log`. O defeito da P04 é o G4 só ter rodado no último ciclo, com uma mensagem que não aponta a porta usada.

## 2. A retomada apagou o parcial da P04

No bloqueio das 11:13Z, o parcial da P04 foi guardado no commit `wip(P04)` `883f7d4` (9 arquivos, +569). Esse trabalho já tinha passado pelo G3 no ciclo 3; faltava só a porta.

Na retomada, `abrirWorktree` (`packages/core/src/loop/worktree.ts:120-131`) chama `limparSobra`, que roda `git branch -D` no branch da fase, e recria o branch a partir do HEAD integrado. O reflog confirma:

```
capivara/build-6e34384deccd/P04@{08:18:58 -0300}: branch: Created from b952fed
```

`883f7d4` agora é inalcançável e aparece no `git fsck --unreachable`. A nova P04 repetiu desde o ciclo 1 a mesma falha do G2 da primeira tentativa, e o verificador fez recusas novas no G3.

O efeito é o mesmo achado secundário de `DIAGNOSTICO-P04-CONFLITO-INTEGRACAO.md`, por outro caminho:
- a §110 preservou o verde que conflita;
- o `wip` do bloqueio continua morrendo na retomada.

**Isso vale também para o `teste_haiku_v2`.** O parcial da P05 está em `capivara/build-96756ca336b0/P05` e será apagado do mesmo jeito quando aquele run for retomado.

## 3. As specs Playwright do produto ficam fora do G2 e do executor

O `testcmd.ts` resolve `npm test` a partir de `scripts.test`. Neste projeto:

- `npm test` é `vitest run`, que inclui só `*.test.ts(x)` (`vitest.config.ts`);
- `test:e2e` é `npm run build && playwright test`, que roda as specs `*.spec.ts`: `navegacao.spec.ts`, `fundacao.spec.ts`, `tarefas/pagina.spec.ts`, `anotacoes.spec.ts`…

O prompt diz: "Always run the suite with: npm test… Do not use another runner and do not run the tests outside it." O executor obedece. Na P04, ciclo 3, ele escreveu: "Não executei os fluxos do navegador, conforme a instrução de não usar outro executor de testes."

O plano pede testes de navegador nomeados, por exemplo `categorias_pagina_acessivel_em_duas_larguras`, em `phases/P05.md:48`. As specs são escritas sem nunca rodar. O G3 lê o código e recusa o que não está coberto ou parece errado:

- **P05, ciclo 2:** "o fluxo em 375 pixels tenta acessar Categorias com o menu fechado"; "a validação espera um alerta quando são renderizados três".
- **P05, ciclo 3:** "Falta verificar no navegador o controle Excluir em 375 pixels. O teste `categorias_pagina_acessivel_em_duas_larguras` está ausente". Esta é a mensagem da pausa final.
- **P04 (retomada), ciclo 3:** quatro tasks INCOMPLETE por cobertura que falta, nove combinações de status, carregamento pendente, cancelamento sem DELETE e outras.

Algumas dessas recusas são legítimas: o teste nomeado não existia. Com as specs rodando, porém, o executor teria visto, por exemplo, o menu fechado em 375 px.

## Achados menores

- **Testes antigos que fixam a ausência do módulo.** A P02 escreveu em `testes/compartilhado/api-fundacao.test.ts` verificações de que `/api/tarefas` e `/api/categorias` respondem 404. Isso fez o G2 da P04 e da P05 falhar no ciclo 1 ("expected 200 to be 404"). A P05 declarou INCOMPLETE em vez de ajustar o teste antigo (`logs/P05.cycle-1.log`). A P06 ajustou o dela. Cada fase paralela mexe no mesmo arquivo compartilhado, como na fundação do `teste_haiku_v2`. Desta vez não houve conflito.
- **O G3 recusou pelo menos uma vez em todas as fases.** O verificador cobra cada teste nomeado no plano. É o critério do G3, e não foi alterado.
- **Erros do `apply_patch`** aparecem em `agente-*.err.log` ("Failed to find expected lines"). São do próprio codex e foram recuperados na mesma sessão. Não influíram nos desfechos.

## Propostas (não implementadas)

1. **A saída da aplicação no G4.** Gerar o `webServer` com `stdout: 'pipe'` (o `stderr` já é `pipe`) e procurar, no timeout, uma porta anunciada diferente de `PORT`. Isso a encaixa na mensagem da §107, "a aplicação tentou escutar na porta X…". É uma mudança pequena, e a P04 teria recebido a causa exata.
2. **Não apagar o `wip` na retomada.** No `abrirWorktree`, quando o branch da fase já tem commits além do HEAD, preservá-lo antes da limpeza, como faz o `preservarAprovado` da §110, ou abrir o worktree a partir dele. A nova sessão parte do parcial, em vez de recomeçar.
3. **As specs de navegador do projeto.** Quando o manifesto tem um script de e2e (`test:e2e`, ou Playwright em `devDependencies` com `*.spec.ts` fora do runner principal), o prompt deixa de proibir esse comando e o nomeia como o modo de rodar os testes de navegador. Mudar o que o G2 executa mexe no critério do gate e fica para decisão separada.
4. **Opcional:** subir a aplicação uma vez, logo depois do G3, mesmo sem fluxo no ciclo, para o defeito de porta aparecer num ciclo que ainda pode corrigi-lo.

## Estado do run

- Integradas: P01 (`f3b47d1`), P02 (`04d8207`), P03 (`b952fed`) e P06 (`74ad68a`).
- P04 bloqueada. O parcial da retomada está em `capivara/build-6e34384deccd/P04` (`5aee6ab`), e o da primeira tentativa (`883f7d4`) está inalcançável.
- P05 bloqueada, com o parcial em `capivara/build-6e34384deccd/P05` (`0b677a5`).
- P07 não rodou. O build está pausado, e não há processo `capivara` ativo.
