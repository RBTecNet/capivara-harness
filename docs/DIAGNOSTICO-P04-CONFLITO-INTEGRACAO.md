> Registro histórico anterior à reconstrução 0.9.0_RC1. Não define comandos nem regras do motor atual. Consulte [README](../README.md) e [reconstrução](RECONSTRUCAO-0.9.0_RC1.md).

# Diagnóstico — P04 verde no worktree e devolvida à fila por conflito de integração

- Run: `build-96756ca336b0`, projeto `teste_haiku_v2`, retomado às 00:28Z de 2026-10-17 com a §108. Três agentes claude/haiku em paralelo: P03, P04 e P05.
- Código citado: `main` em `b0a349b` (§109).
- Investigação em leitura, com uma exceção, registrada aqui: um `git fsck --lost-found` criou `.git/lost-found` no projeto experimental. A pasta, que acabara de nascer, foi removida em seguida, e o repositório voltou ao estado anterior.

## Conclusão

A P04 não falhou nos gates. Ela fechou verde no ciclo 2, mas o cherry-pick dela na árvore principal conflitou com a P03, integrada antes. O harness desfez a integração e devolveu a fase à fila para rodar sozinha sobre a árvore integrada. Antes disso, o build pausou pela parada da P05, e a P04 ficou pendente, sem desfecho.

## Linha do tempo (`events.tsv`)

| Momento | O que aconteceu |
|---|---|
| Ciclo 1 | G3 verde; o G4 reprovou: "o projeto não declara um entrypoint (`start`)". |
| Ciclo 2 | O executor criou `start` (`npm run compilar && npm run iniciar`) e fez o servidor aceitar `PORT`/`HOST`. O G4 reprovou uma vez por defeito do roteiro (triagem ROTEIRO) e passou na reescrita: `1 passed` (`logs/P04.flow-run-2.log`). |
| 01:12:04Z | "verde no worktree, aguardando integração: feat(phase-4): Módulo independente de categorias" (`8c9365e`). |
| 01:12:05Z | "conflito ao integrar em .env.example, README.md, docs/verificacao.md, src/servidor/configuracao.ts, src/servidor/inicializacao.ts, testes/fundacao/configuracao.test.ts; volta à fila para rodar sozinha sobre a árvore integrada". |
| 01:12:05Z | `paused`, causado pela parada da P05 (`docs/DIAGNOSTICO-G4-REINICIO-P05.md`). A P04 nunca chegou a rodar de novo. |

## Causa raiz — duas fases mudaram a mesma fundação

O contrato do G4 é um `start` que honre `PORT` e `HOST`. Ele não é tarefa de nenhuma fase. A fundação do projeto lia só `PORTA` e não tinha `start`, e cada uma das três fases paralelas precisou alterá-la no próprio worktree.

A P03 (`7a9e541`) e a P04 (`8c9365e`), ambas sobre `4655c9c`, escreveram praticamente o mesmo código em `src/servidor/configuracao.ts`:

```ts
const portaBruta = ambiente.PORTA ?? ambiente.PORT ?? doArquivo.PORTA ?? doArquivo.PORT;
const hostBruto = ambiente.HOST ?? doArquivo.HOST ?? HOST_PADRAO;
```

O mesmo vale para `HOST_PADRAO`, para o campo `host` na `Configuracao`, para o `start` no manifesto e para os testes e textos de README e documentação. A diferença está nos comentários e na redação, e isso basta para o cherry-pick conflitar.

O plano dividiu as fases como "módulos independentes", mas a infraestrutura que o G4 exige mora na fundação compartilhada.

**A §109 agrava isso.** Quando o projeto não tem `start`, o aviso novo vai, desde o ciclo 1, a todas as fases paralelas que têm fluxos. As três alterarão a fundação ao mesmo tempo, e o conflito deixa de ser acaso para virar regra. Na retomada deste run isso não se repete, porque a P03 já integrou o `start`.

## Achado secundário — o verde da P04 ficou sem branch

No desfecho "refazer" (`packages/core/src/loop/paralelo.ts:317-321` e `:440-448`), o branch da fase não é mantido, e `fecharWorktree` o apaga (`packages/core/src/loop/worktree.ts:184`).

O commit verde `8c9365e` ainda existe, mas inalcançável, e um `git gc` acabaria com ele. A retomada vai refazer a P04 do zero sobre a árvore integrada, o que significa mais uns 15–20 minutos de executor, quando o que a diferenciava da P03 era um comentário.

Os outros desfechos guardam o parcial num branch `wip(...)`; o da P05 continua lá. Só o "refazer" perde o trabalho.

## Observação — o reinício no roteiro da P04

O passo "Reiniciar o servidor com o mesmo arquivo SQLite" passou porque o roteirista o delegou a um teste da suíte do projeto (`logs/P04.flow-2-2.log:361`):

```ts
await comandoDoProjeto('npm', ['run', 'testar', '--', 'testes/modulos/categorias/persistencia.test.ts', ...]);
```

Esse teste reinicia processos reais, mas num banco à parte, não no da passagem. Com a §109 e o `FLOW_MARK` v3, o roteiro será reescrito na retomada e poderá usar `aplicacaoPropria()`.

## Propostas (não implementadas)

1. **A infraestrutura do G4 feita uma vez, antes do paralelo.** Quando há fluxos e `startCommandFor` devolve `null`, criar o contrato antes da leva paralela. Pode ser numa sessão curta de escopo único, como a `installPrompt` que já existe, ou rodando sozinha a primeira fase com fluxos. O aviso da §109 passa a valer só no serial ou depois de o `start` existir.
2. **Guardar o verde no "refazer".** Manter o branch da fase quando a integração conflita (`manterBranch = true` nesse ramo). O trabalho fica recuperável e a nova rodada pode consultá-lo.
3. **Opcional:** antes de refazer a fase inteira, tentar integrar o que não conflita ou reconhecer hunks equivalentes. É mais invasivo e não é recomendado agora.

## Estado do run

- A P03 foi integrada (`7a9e541`).
- A P04 está pendente e, na retomada, roda sozinha sobre a árvore integrada.
- A P05 está bloqueada, com o parcial no branch `capivara/build-96756ca336b0/P05`.
