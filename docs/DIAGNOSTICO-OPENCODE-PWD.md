> Registro histórico anterior à reconstrução 0.9.0_RC1. Não define comandos nem regras do motor atual. Consulte [README](../README.md) e [reconstrução](RECONSTRUCAO-0.9.0_RC1.md).

# OpenCode 2: cwd correto, PWD herdado

O run `build-6b52f050649d`, em `teste_opencode2`, parou em 18/10/2026 às
09:41:20 de Brasília. O executor escreveu a P02 na principal; o verificador
também leu essa pasta e aprovou as sete tasks. Os gates locais continuaram no
worktree sem alterações. O integrador recusou a principal suja.

## Evidência e causa

- `logs/calls.jsonl`: todas as chamadas da tentativa das 09:33 receberam
  `~/.cache/capivara/worktrees/b848086f2ac8/build-6b52f050649d/P02`.
- O log do OpenCode registra `serve --stdio --port 0` nascendo nesse cwd,
  seguido de `location services booted` na principal.
- O JavaScript embarcado na CLI 2.0.32, em `runNonInteractiveWithOptions`,
  contém `n.root ?? process.env.PWD ?? process.cwd()`, seguido de `process.chdir`.
  O PWD herdado do harness era a principal.
- O branch P02 continuou no commit da P01, sem implementação própria. A
  mensagem que prometia o trabalho nesse branch não descrevia os arquivos reais.

O REA informou que os provedores de análise nativa não estão configurados nesta
máquina. A leitura do trecho JavaScript embarcado foi complementada por uma
reprodução controlada com o binário instalado; não se baseia só em strings.

## Reprodução controlada

Criados um repositório temporário `principal` e um worktree `isolado`. As duas
chamadas usam cwd `isolado`, `run --standalone --format json --print-logs` e um
modelo deliberadamente inexistente. Os diretórios XDG são privados e temporários.
Nenhuma chamada de modelo foi feita.

| PWD passado ao processo | Diretório registrado pelo servidor |
|---|---|
| `principal` | `principal` |
| `isolado` | `isolado` |

As duas chamadas terminam em `provider.no-route`, depois da criação da sessão.
A diferença de diretório acontece antes de o modelo poder participar.

## Correção e alcance

A ponte alinha PWD absoluto e cwd para todos os providers. O teste de integração
do OpenCode reproduz o consumo de PWD em implementação, avaliação e reparo.
No paralelo, a conferência da principal roda antes e depois de cada chamada,
sob a mesma fila exclusiva das integrações. Escrita externa interrompe a fase,
preserva os arquivos e impede aprová-los como se estivessem no worktree.

Os testes com Git real cobrem escritas do executor e do verificador, preservação
do parcial, integradores concorrentes, arquivos locais deixados pela suíte e
pausa global mesmo com `keepGoing`. Não há promessa de sandbox: esta guarda
detecta alterações de produto visíveis pelo Git e não atribui autoria entre
agentes concorrentes. Arquivos ignorados e alterações revertidas durante uma
mesma chamada não são abrangidos por essa detecção.

O projeto experimental e seus arquivos sem commit foram preservados. O build
completo dele não foi retomado durante esta correção.
