# Dashboard: isolamento e custo de renderização

O CLI executa a interface em processo próprio, com event loop separado e prioridade de CPU reduzida quando o sistema permite. O pai não monta nem envia o modelo ou o histórico por IPC; o painel lê o SQLite. O canal entre processos transporta decisões e controle da interface. Falhas ou fechamento do painel não interrompem a construção; cancelamento explícito continua disponível.

O leitor mantém cursor de eventos e consulta a revisão do projeto antes de buscar e interpretar novamente seu JSON. A leitura inicial do histórico avança por páginas com orçamento de tempo. O renderer conserva o histórico inteiro, indexa linhas por largura e materializa apenas o viewport. Rolagem, expansão, Unicode e alterações do conteúdo continuam disponíveis.

O log mostra operações reais de inspeção, hashing, revisão, integração e aceite, com duração observada; contagens aparecem quando existem. Ausência de denominador não produz percentual. A sondagem do processo dono permite exibir “Sem execução ativa” quando o estado salvo ainda diz `working`, sem modificar esse estado ou fabricar atividade. Existência de um PID não comprova avanço nem detecta travamento.

## Reprodução somente leitura

Com as dependências do harness instaladas, execute na raiz:

```sh
node scripts/profile-dashboard.mjs /caminho/do/projeto
```

O script abre o banco em modo somente leitura e captura projeto e eventos na **mesma transação**. Constrói um modelo atual e um único snapshot; compara o renderer de `064d610` com o atual, compilados temporariamente com esbuild. Não executa modelos, instalação, comandos do produto ou retomada do harness. O argumento opcional seguinte troca o commit; outro argumento define o JSON de saída.

São três frames por implementação e modo, em 120×40, incluindo overlay do log. O primeiro frame inclui indexação; mediana e p95 dos quentes usam apenas os dois seguintes. Com duas amostras, esse p95 corresponde ao maior valor, sem representar um teste de carga. A comparação exige texto idêntico após retirar ANSI, mesmas contagens de células e frames dentro da área disponível.

## Medição registrada

[dashboard-performance.json](rc2-evidence/dashboard-performance.json), capturado em 28/10/2026 com Node 24.22.1: 13.010 eventos, 108.201 linhas no log e 8,63 milhões de caracteres. Ambos os renderizadores receberam exatamente o mesmo snapshot; os seis pares de frames preservaram texto e células.

| Modo | Primeiro, antes → depois | Mediana quente, antes → depois | p95 quente, antes → depois |
| --- | --- | --- | --- |
| Dashboard | 666,19 → 23,90 ms | 621,99 → 3,17 ms | 628,53 → 3,61 ms |
| Log ampliado | 919,07 → 421,40 ms | 826,42 → 2,15 ms | 834,72 → 2,74 ms |

A primeira expansão numa largura nova ainda precisa indexar as quebras do histórico completo; o processo separado mantém esse custo fora do event loop do motor. Mudanças no histórico invalidam o índice afetado. Tempos dependem da carga do host.

Uma amostra anterior, com 107.038 linhas, observou 633–699 ms por frame antes e 2,5–5,1 ms nos quentes depois. Outra medição em cópias temporárias do banco observou mediana de update de 677 → 517 ms ao evitar parse e formatação repetidos do snapshot de recuperação. São amostras distintas; este script não mede persistência.

O JSON exporta apenas contagens, hashes, tempos e limites da medição. Não inclui logs, prompts, configuração ou código do projeto. Esse perfil não comprova funcionamento do PTY, isolamento do CLI em execução ou conclusão do projeto; essas validações são independentes.

## Validação da execução e do terminal

O [registro de validação](rc2-evidence/dashboard-live-validation.json) confirma `samba_admin` novamente em `complete/build`, 10/10 tarefas, nenhum bloqueador e nenhuma recuperação pendente. A execução aproveitou as 151 provas preservadas: zero registros novos de prova e zero chamadas de modelo. Os quatro registros adicionais de aceite apontam para provas existentes.

Em uma fixture temporária, um terminal real executou a CLI instalada com motor e painel em PIDs distintos, prioridades 0 e 10. Uma pergunta material foi entregue por IPC, respondida pelo painel e gravada como `hello`; o INIT concluiu sem chamar um provider real. Outro ensaio em PTY confirmou as três mudanças de cabeçalho: execução com dono ativo, conclusão persistida e estado `working` sem processo ativo. Fechar o painel por `q` não cancela o motor.

`npm run check` passou com build, tipos e 306 testes em 45 arquivos. Os testes de processos incluem progresso do pai durante CPU intensa da UI, correlação de respostas e encerramento limitado de um painel travado, sem cancelar o executor. A persistência mantém transação, respostas atuais, flush e publicação atômica; JSON inválido conserva a cópia válida anterior.

As validações ocorreram em Linux. A primeira indexação do histórico ainda custa tempo no processo de apresentação. Sondagens, isolamento e hashes das provas também têm custo próprio no motor; não se declara retomada instantânea. O PID observado no início desapareceu antes de qualquer sinal desta investigação; a causa de sua saída não foi estabelecida.
