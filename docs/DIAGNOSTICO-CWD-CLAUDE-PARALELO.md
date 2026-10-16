# Diagnóstico: o executor Claude que escreveu fora do worktree

Este é o primeiro build paralelo com Claude Haiku. Ele rodou no projeto
experimental `teste_paralelismo` (run `build-f1cd4ae9e525`), com o agente 1 em
`claude-haiku-5-5` e o verificador em codex.

A investigação foi somente leitura. O projeto experimental não foi modificado,
e nenhum build nem chamada de LLM foi feito.

## O sintoma

- A P01 falhou no G3 depois de três ciclos.
- O Haiku declarou a fundação completa, com 25 testes passando.
- O verificador afirmou que quase todos os arquivos estavam ausentes.
- `git worktree list` mostrava só a principal, e não havia branch
  `capivara/*/P01`.
- Os arquivos da fase existiam, sem versionamento, na raiz principal.

## A causa (comprovada)

**O harness não fixa o diretório de execução do processo da CLI.**

O worktree é passado corretamente até `buildInvocation`:

```
paralelo.ts:422     workRoot: worktree.dir
runner.ts:214       root: arvore
cli-program.ts:2197 createAgentBridge({ projectRoot: call.root ?? projectRoot })
agent.ts:74         buildInvocation(..., { projectRoot })
```

A partir daí, o valor se perde:

- `src/provider/cli/claude.ts` ignora o `projectRoot` e não passa nenhuma flag
  de diretório;
- `runProvider` (`src/provider/supervisor.ts:76`) chama `spawn` sem `cwd`.

O processo do Claude herdou então o cwd de quem rodou `capivara build`, que é a
raiz principal. O codex só funciona porque recebe `--cd <worktree>`
(`codex.ts:22`).

## As evidências

| Pergunta | Resposta | Evidência |
| --- | --- | --- |
| O Haiku escreveu fora do worktree? | Sim | As três sessões do executor (`bbce43b2…`, `ac5a04bc…` e `93856cbd…`, em `~/.claude/projects/-home-bruno-Documentos-Projetos-laravel-teste-paralelismo/`) registram `"cwd":"/home/bruno/Documentos/Projetos/laravel/teste_paralelismo"` em todas as entradas. Todos os `file_path` gravados estão na raiz principal. |
| O harness passou um diretório incorreto? | Não | A cadeia acima entrega o worktree. O valor é descartado no adapter e no `spawn`. |
| O verificador leu o diretório errado? | Não | O verificador é o codex. O log dele (`agente-1.out.log`) procura `AGENTS.md` a partir de `~/.cache/capivara/worktrees/bdc824d2766d/build-f1cd4ae9e525/P01`. Ele disse a verdade: o worktree estava vazio. |
| Os gates usaram qual diretório? | O worktree, corretamente | Todos usam `arvore` (`runner.ts:359`, `386`, `405` e `575`). O G1 avisou três vezes: "a sessão anterior terminou sem alterar nenhum arquivo". Era verdade no worktree. |
| Os arquivos são de outra execução? | Não | Os mtimes caem nas janelas dos ciclos deste run (ver abaixo). O commit inicial é de 09:45:54, o mesmo instante em que o run começou. |
| O Haiku declarou resultados falsos? | Não | Os resultados existem, mas no lugar errado. As sessões mostram `vitest run` com "Test Files 8 passed (8) / Tests 25 passed (25)" e "1 passed" no Playwright, executados na raiz principal. Nos ciclos 2 e 3, ele respondeu, com coerência, que "os arquivos existem agora". |
| O trabalho parcial foi preservado? | Nada se perdeu | O worktree estava limpo, então `guardarParcial` não tinha o que guardar e o branch não tinha commits. O worktree foi removido às 10:06:13.49, depois do `blocked`. O trabalho real ficou intacto, sem versionamento, na principal. |

Os mtimes por janela de ciclo (horário local):

| Ciclo | Janela | Escritas na principal |
| --- | --- | --- |
| 1 | 09:45:54–09:57:35 | `package.json` às 09:50:00, `tsconfig.base.json` às 09:51:51, `banco.ts` às 09:56:10 |
| 2 | 09:58:19–10:01:32 | `node_modules` às 10:00:18 |
| 3 | 10:02:19–10:05:29 | `docs/verificacao.md` às 10:05:02 |

## Observações secundárias

- O defeito já tinha acontecido antes. As sessões Claude de 15/10 (run
  `build-c7844236d2c9`) também têm cwd na principal e gravaram nela.
- O serial também é afetado: com `--project` diferente do cwd, o executor
  Claude escreve no lugar errado. O survey passa a pasta de saída como raiz e
  tem o mesmo problema.
- Os adapters `cursor` e `custom` têm o mesmo defeito. O `agy` recebe só
  `--add-dir`.
- Nenhuma guarda percebeu a principal sendo alterada no meio de uma fase em
  worktree. A conferência do §99 só roda na integração, e a integração nunca
  chegou a acontecer.
- O `run.json` registra `builder: codex gpt-6.1-sol`. O executor real era o
  `claude-haiku-5-5` do agente 1.

## A menor correção (proposta, não implementada)

1. Em `Invocation` (`adapters.ts`), adicionar `cwd: context.projectRoot`.
2. Em `runProvider`, fazer `spawn(..., { cwd: invocation.cwd, ... })`.

Isso corrige todos os adapters de uma vez. O `--cd` do codex continua valendo.
A pasta já existe antes da chamada, por causa do `mkdir` em `agent.ts`.

Impacto:

- O único chamador em produção é `createAgentBridge`.
- init, plan e build hoje passam `"."`, que dá o mesmo resultado.
- O survey com Claude passa a trabalhar na pasta de saída, como já faz com o
  codex.
- Falta conferir se a ponte de API direta (`--capivara-direct-api`) resolve
  algum caminho relativo.

Há também uma guarda complementar, opcional. No modo worktree, fotografar a
árvore principal antes e depois de cada chamada de agente. Se ela mudar, parar
com "o agente escreveu na árvore principal", sem descartar nada.

## Testes de regressão recomendados (antes da correção)

1. `test/provider/adapters.spec.ts`: para cada adapter de CLI, conferir que
   `buildInvocation(...).cwd === context.projectRoot`.
2. `test/provider/supervisor.spec.ts`: rodar `runProvider` com
   `node -e "process.stdout.write(process.cwd())"` e um `cwd` temporário. A
   saída deve ser essa pasta.
3. Reprodução do piloto, por `createAgentBridge`: um claude falso, via
   `CAPIVARA_CLAUDE_BIN`, devolve o próprio `process.cwd()` no envelope JSON.
   - A chamada usa um `projectRoot` diferente do cwd do vitest.
   - O esperado é o diretório temporário. Hoje viria `packages/core`.
   - O falso só imprime e não grava nada, então o teste não suja o repositório
     quando falha.

## Estado do projeto experimental

O trabalho do Haiku na P01 está na raiz principal, sem versionamento:

- 36 arquivos novos;
- `docs/contratos-api.md` e `docs/verificacao.md` modificados;
- as pastas `node_modules`, `dist`, `dados` e `.testes`.

Antes de retomar, é preciso decidir o destino desse trabalho: commitar,
mover ou descartar. Se ficar como está, a conferência do §99 bloqueia a
integração da primeira fase que fechar.
