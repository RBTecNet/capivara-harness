# Diagnóstico — P05 bloqueada no G4 por um passo de reinício

- Run: `build-96756ca336b0`, projeto `teste_haiku_v2`, retomado às 00:28Z de 2026-10-17 com a §108 instalada (`ca1e5da`). Três agentes claude/haiku com `--dangerously-skip-permissions`.
- Fases simultâneas: P03, P04 e P05.
- Investigação feita só em leitura: nenhuma correção, nenhuma mudança no projeto experimental, nenhum build reiniciado, nenhum LLM chamado.

## Conclusão

A P05 bloqueou por uma lacuna do harness, não por defeito do produto.

O fluxo 3 do esqueleto (`.capivara/init/skeleton.md:73`) pede "Reiniciar o servidor com o mesmo arquivo SQLite e conferir os valores persistidos". O G4, porém:
- proíbe o roteiro de iniciar ou parar servidores (`packages/core/src/prompts/flows.ts:74-78`);
- não oferece reinício no ajudante, porque o `capivara-comando.ts` só exporta `comandoDoProjeto`;
- exige que o roteiro cite cada passo.

O passo não tem como ser percorrido, e nem o executor nem o roteirista conseguem resolver isso.

O verificador deu as 12 tasks como DONE nos ciclos 2 e 3, e a suíte passou (102 testes Vitest, 31 specs Playwright). Nenhuma permissão foi negada neste run.

## Linha do tempo (`events.tsv` e `logs/P05.*`)

| Ciclo | O que aconteceu |
|---|---|
| 1 | O G3 reprovou a task 8, com razão: depois de um cadastro com sucesso, uma falha seguinte mantinha "Anotação cadastrada." visível. |
| 2 | A task 8 foi corrigida e o G3 ficou verde. O G4 reprovou: "o projeto não declara um entrypoint (`start`)". |
| 3 | O executor criou o `start` honrando `PORT` e `HOST`. O G4 subiu a aplicação, mas o roteiro do fluxo 3 falhou, a triagem disse ROTEIRO duas vezes e a fase bloqueou às 01:05:59Z. |

## O passo 6 do fluxo 3

O roteirista da P05 escreveu uma falha deliberada (`.capivara/flows/workflow-3.spec.ts:302-304`, no worktree da P05):

```
expect.soft(false, 'A persistência após reiniciar o servidor não foi verificada: as regras proíbem encerrar ou iniciar servidores, e o auxiliar fornecido não oferece uma operação de reinício…').toBe(true)
```

O que veio depois:
- **Triagem 1** (`logs/P05.triagem-3-1.log`): ROTEIRO. A correção sugerida foi "substituir a falha incondicional por reinício real mediante auxiliar autorizado". Esse auxiliar não existe.
- **Reescrita** (`logs/P05.flow-3-3.log`): o roteirista devolveu texto em vez de roteiro: "O auxiliar disponível só exporta `comandoDoProjeto`; não oferece reinício… Preciso do módulo e da assinatura do auxiliar autorizado". O gate manteve o roteiro anterior, que falhou de novo.
- **Triagem 2** (`logs/P05.triagem-3-2.log`): ROTEIRO outra vez. A causa foi entregue ao executor no ciclo 3, o último, e a fase bloqueou. Fora do último ciclo, o executor também não resolveria, porque o defeito não está no produto.

A P03 tem um passo equivalente no fluxo 1 (`skeleton.md:54`) e passou por acaso. O roteirista dela tratou o reinício como pendência: anotou com `CAPIVARA_REMARK`, conferiu só o estado atual e não reprovou (`.capivara/flows/workflow-1.spec.ts:259-272`). Os dois roteiristas tiveram o mesmo impasse e o resolveram em sentidos opostos.

## Defeito secundário do roteiro

No passo 8 (`workflow-3.spec.ts:340`), o roteiro lê `resposta.text()` de uma resposta 204 depois que a página já navegou. O Playwright não consegue mais ler esse corpo: "Response body is not available for a response that was navigated away from".

É erro do roteiro, e a reescrita o resolveria; ela só não chegou a acontecer. A triagem registrou que a exclusão funcionou: a página mostrava "Anotação excluída." e a lista vazia.

## Achado lateral — o contrato da §107 não evitou a falta de `start`

O bloco "How the application is started for the flow gate" chegou aos prompts dos três ciclos da P05. Mesmo assim, nas três fases o G4 é que descobriu a falta de `start`, e isso custou um ciclo a cada uma: a P04 no ciclo 1, a P03 e a P05 no ciclo 2.

O texto diz que o entrypoint precisa existir, mas não diz que neste projeto ele não existe. O harness sabe disso antes do ciclo 1, porque `startCommandFor` devolve `null`. Já existe o padrão para o runner ausente (`runnerDeFluxosAusente`), um aviso específico que só aparece quando a falta é real.

## Propostas (não implementadas)

1. **O passo que o G4 não percorre.** A menor mudança é transformar em regra o que a P03 fez:
   - o roteirista é instruído a registrar com `CAPIVARA_REMARK` o passo que exige reiniciar ou parar o servidor, conferir o estado atual e não reprovar, porque a persistência depois do reinício é provada pela suíte no G2;
   - a conferência estrutural passa a rejeitar a falha incondicional (`expect(false)` / `expect.soft(false)`).

   A alternativa maior é dar ao gate um reinício próprio da aplicação, o que mexe na forma como o Playwright sobe o webServer.
2. **Falta de `start` dita antes.** Quando a fase tem fluxos e `startCommandFor` devolve `null`, o prompt do ciclo 1 diz que o projeto não tem `start` e que o executor deve criá-lo.
3. **Opcional.** Quando a reescrita do roteiro volta sem código, a causa diz que o defeito é do harness, em vez de entregar ao executor um ROTEIRO que ele não pode corrigir.

## Estado do run

- A P03 foi integrada (`7a9e541`).
- A P05 bloqueou. O trabalho dela está no worktree `~/.cache/capivara/worktrees/beaf0f189052/build-96756ca336b0/P05`.
- A P04 ficou sem desfecho. O último evento é "ciclo de correção 2, started", às 00:46Z, e não há processo `capivara build` ativo.
