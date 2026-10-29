# Recuperação do PLAN — 29/10/2026

O estado relatado pelo usuário foi reproduzido: `plan: waiting`, com 12 tarefas e uma colisão de `task-foundation`. A validação anterior de retomada de BUILD não cobria esse caminho de criação do plano.

Foram corrigidas três causas no motor:

1. A cobertura de requisitos anexava uma atualização como outra tarefa. Agora aplica emendas por ID, conservando arquivos, requisitos, critérios, verificações e dependências anteriores. A equivalência entre propostas independentes continua conservadora.
2. Colisões reais escapavam da recuperação do domínio. Agora há uma transação de correção de identidades e referências: as definições permanecem intactas e cada dependência ambígua exige seleção explícita de seu dono. Ciclos continuam pendentes para a recuperação de grafo; não são aprovados por renomeação.
3. Incidentes cujo sujeito era um nó de ambiente recebiam contexto vazio, porque a seleção procurava somente requisitos e tarefas. O motor também rejeitava uma atualização de identidade sem requisito vinculado. A seleção e a identidade da recuperação agora incluem o nó e seus pré-requisitos; as escolhas obrigatórias do usuário continuam protegidas pela validação.

A primeira execução real após a correção das emendas avançou, resolveu três ciclos e revelou o terceiro defeito. Seu resultado `waiting` foi preservado no [relatório intermediário](rc2-evidence/plan-amendment-recovery-first-run-20261029.json). Após corrigir a seleção e a adoção da identidade de ambiente, a CLI instalada retornou **`plan: complete`**, com plano `ready`, 12 tarefas preservadas, todos os requisitos cobertos, nenhuma violação estrutural e `lastFailure: null`.

A repetição do comando levou 1.264 ms, não chamou modelos e manteve o plano idêntico. A recuperação total nesta investigação fez seis chamadas de planner: três correções distintas de ciclo, duas tentativas sem o contexto correto e uma recuperação final com o contexto corrigido. Não se afirma economia financeira a partir disso.

Comando real de validação:

```sh
capivara plan --project /home/bruno/Documentos/Projetos/testes_capivara/samba_admin --no-dashboard
```

[Evidência final da CLI instalada](rc2-evidence/plan-recovery-complete-20261029.json). A versão permanece `0.9.0-rc2`; o relatório registra a igualdade entre o SHA-256 da instalação e o build local. Esta validação cobre prontidão e repetição do PLAN; não certifica o BUILD do novo estado.

Build e checagem de tipos passaram. As regressões selecionadas cobrem a emenda que falhava antes da correção, a seleção explícita de dependências em colisões reais e o reparo de um nó de ambiente sem requisito de stack. Os casos executaram em menos de um segundo por rodada; não foi executada a suíte completa.
