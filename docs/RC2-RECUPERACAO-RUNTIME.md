# Recuperação estrutural do motor RC2

A investigação da execução em `samba_admin` revelou falhas adicionais do harness após a entrega inicial de RC2. Elas foram corrigidas no motor. O [snapshot histórico das 14:13](rc2-evidence/samba-admin-recovery-latest-snapshot.json) registra `waiting/build`, com 7 de 10 tarefas integradas. Após as correções seguintes, o [snapshot das 14:28 de 28/10/2026, horário de São Paulo](rc2-evidence/samba-admin-recovery-live-snapshot.json) registra **`working/build`, 8 de 10 tarefas integradas**. A prova real de Tarefas no navegador passou e sua integração avançou; a execução continua com a composição web e o aceite integrado pendentes. Isso não é conclusão nem aceite do projeto.

## Causas corrigidas

**Invocação e ambiente.** `provides.command: ["node", "npm"]` era aplicado como um único argv, produzindo `node npm --version`. Um wrapper gerado pelo próprio harness inutilizava o Node instalado. O motor agora sonda a invocação concreta, distingue argumentos de declarações independentes e conserva suas transformações. Valores descritivos de configuração e arquivos de produto não são injetados como variáveis ou diretórios executáveis. Recuperação de ambiente usa tarefa própria e workspace privado; somente dependências e instalações podem ser publicadas. Alterações indevidas de produto permanecem em proposta preservada. Instalações mantêm executáveis e links e possuem transação retomável.

**Autoridade.** A preposição portuguesa em “Fluxos reais executados no navegador” era interpretada como a negação inglesa “no browser”. A correção limita negações aos seus objetos, reconcilia interpretações persistidas e preserva a origem da transformação. Um requisito positivo de navegador continua obrigatório.

**Asserções e progresso.** Na retomada das 12:02–12:08, a API terminou com código zero e saída concreta, mas `expected` continha apenas uma descrição humana. O coordenador repetia reparos da receita e considerava mudanças na redação como progresso. Agora critério semântico, observação persistida e asserção executável são dados separados. Uma árvore tipada admite texto literal, regex validada, JSON, código de saída e composição. A recuperação associa uma asserção à observação existente; uma interpretação inválida segue para diagnóstico independente e reconciliação do contrato de prova. Reformular prosa não equivale a mudar uma receita. Código zero não vira aprovação automática de comportamento.

**Contexto e revisão.** O pacote informa quais fontes foram entregues completas, parcialmente, omitidas ou ausentes, com hash e intervalos de linhas. Uma alegação baseada em fonte incompleta pede a fonte necessária e mantém o achado pendente. Citações explícitas são confrontadas com arquivo, hash e linhas reais. Alegações de ausência exigem cobertura apropriada; arquivo realmente inexistente, indicado no inventário e confirmado por `ENOENT` com ancestrais seguros, continua sendo um defeito material que o editor pode corrigir. Não há descarte por palavras da mensagem nem aprovação por silêncio. A revisão independente continua responsável pelo vínculo semântico entre requisito e evidência.

**Replanejamento e linhagem.** Reparar um instrumento não autoriza substituir uma entrega de CRUD por uma tarefa administrativa de registrar parecer. O escopo de reparo preserva o contrato da entrega. Propostas já órfãs são recuperadas somente quando a definição histórica possui hash exatamente igual ao checkpoint, há correspondência única de arquivos e requisitos e a proposta ainda existe. Contrato, arquivos e dependências originais são restaurados; configuração de provas pode ser atualizada. O conteúdo continua sujeito a verificação, revisão e integração normais. O [dry-run registrado](rc2-evidence/plan-lineage-dry-run.json) confirmou essa identidade no caso real, sem modificar o projeto.

**Recursos e persistência.** Binários de navegador usam gerações compartilhadas em armazenamento canônico, com identidade do provider, lock de preparação e lançamento headless real. Esse caminho é fixo e não é reescrito para outra cópia de verificação. Instalação sem efeito é registrada, caches utilizáveis são reaproveitados e prontidão pode ser revalidada sem nova implementação. O callback de persistência recebe plano e estado da mesma revisão e os grava juntos, evitando checkpoint associado a um plano anterior. Suspensões normais também registram bloqueadores e `lastFailure`; trabalho parcial existente passa por provas antes de outro editor.

**Adoção de planos e cancelamento.** Uma proposta de replanejamento concluída podia perder sua fila antes de ser adotada; outra janela gravava o plano proposto com o estado antigo. Agora a proposta fica persistida em `action.planProposal`, ainda pendente, até a adoção conjunta de plano e estado. Jobs novos criados durante a recuperação permanecem na fila; consumir um job não apaga uma causa posterior do mesmo task. A recuperação recebe as checks efetivas, inclusive em reparos de ambiente, e não descarta uma receita recuperada por uma alteração sem relação com ela. Cancelamento preserva operações interrompidas como interrompidas, sem aprovar observações canceladas ou marcar uma estratégia incompleta como esgotada. A retomada de uma proposta já obtida não chama novamente seu planejador. Esses registros protegem interrupções reais; não são motivo para encerrar trabalho recuperável.

**Instrumentos opcionais.** Um alias de conveniência com nome inválido ou maior que o limite do sistema de arquivos não pode impedir a chamada do provider concreto. Sua omissão é registrada em `action.instrumentRepairs`, com o motivo e a invocação preservados. Isso não dispensa a prontidão do provider nem transforma uma ferramenta ausente em disponível.

## Reprodução antes/depois

```sh
node scripts/reproduce-runtime-recovery.mjs
```

O script arquiva o commit `0f193a3914c06307d60a48f17c1dc816da7e747d` e copia os fontes atuais para diretórios temporários. Ambos são compilados com o esbuild já instalado. As mesmas quatro fixtures usam APIs existentes nas duas versões, comandos Node reais e agentes determinísticos. Não há instalação de pacotes nem inferência paga.

| Observação | RC2 anterior | Fontes corrigidos |
| --- | --- | --- |
| Prontidão com `["node", "npm"]` | `false` | `true` |
| Navegador solicitado permitido | `false` | `true` |
| Chamadas de editor para fonte parcial correta | 1 | 0; provas e revisão continuam obrigatórias |
| Suspensão normal com causa persistida | `lastFailure: null` | Causa concreta |

Saídas, comandos e hashes dos dois conjuntos de fontes ficam em [runtime-recovery-before-after.json](rc2-evidence/runtime-recovery-before-after.json). Esses quatro casos não pretendem demonstrar todos os novos subsistemas; os testes focais de asserções, contexto, revisão, linhagem e recursos estão em `packages/core/test`. Nenhuma fixture equivale ao aceite funcional do projeto real.

A validação do motor por `npm run check` passou: build, tipos e **257 testes em 40 arquivos**. As regressões incluem interrupção antes e depois do resultado de replanejamento e a gravação consistente de plano e execução. O reprodutor das quatro comparações também foi regenerado sobre os fontes atuais; o hash desse snapshot de código está no JSON. A suíte não depende de chamadas pagas de modelos.

## Histórico e custo observado

A primeira execução, até 11:37, fez nove chamadas e não registrou provas. O [snapshot das 12:17](rc2-evidence/samba-admin-recovery-snapshot.json) preserva o primeiro bloqueio após a retomada: uma tarefa integrada e 12 chamadas adicionais. O snapshot posterior separa os trechos do diário por eventos explícitos de suspensão:

| Eventos | Chamadas iniciadas | Encerramento registrado |
| --- | ---: | --- |
| 228–786 | 12 | Instrumento da prova da API |
| 787–824 | 0 | Mesma pendência preservada |
| 825–1540 | 16 | Diagnóstico sem estratégia executável diferente |
| 1541–4507 | 55 | Revisão da interface ainda não resolvida |
| 4508–6331 | 33 | Prova web ainda não reconhecida como compatível |

Até o evento 6334 foram **116 chamadas desde a primeira retomada**: planejador 7, reparador 43, revisor 55 e editor 11. O provedor reportou 15.863.101 tokens de entrada, dos quais 13.968.000 em cache, e 119.571 de saída; não reportou valor financeiro. O pico persistido de agentes simultâneos foi dois. Somar durações de chamadas concorrentes não fornece o tempo de parede. Esses números incluem desenvolvimento e depuração durante as retomadas e não demonstram economia financeira nem recuperação de 99%.

O snapshot seguinte, até o evento 6811 às 14:28, registra **123 chamadas desde o evento 228**: planejador 8, reparador 44, revisor 59 e editor 12. O uso informado acumulado nesse recorte é de 18.644.368 tokens de entrada, 16.543.104 em cache e 137.181 de saída. O valor financeiro continua desconhecido. Essa nova evidência preserva o snapshot anterior e não apresenta a depuração como uma execução concluída de baixo custo.

Para produzir outra captura sem iniciar ou parar o harness:

```sh
node scripts/capture-execution-evidence.mjs /caminho/do/projeto docs/rc2-evidence/execution-snapshot.json 228
```

A leitura transacional mantém plano, estado e diário consistentes. O relatório separa tarefas do plano atual de registros aposentados, preserva métricas cumulativas e identifica provas históricas como históricas. Exporta contadores, horários e uso informado, sem prompts, configuração, comandos ou stdout dos agentes. Fases específicas são atribuídas pelo papel e pela ação persistida próxima; épocas terminam em eventos `waiting`, sem inventar paradas de processo ou duração da depuração manual.

## Limites da evidência

As validações locais ocorreram em Linux. A instrumentação de provider observa subprocessos Node previstos pelo adaptador; não é rastreamento universal de toda stack. Contexto completo e citação válida sustentam uma revisão, mas não provam sozinhos a interpretação semântica do parecer. Hash de linhagem insuficiente ou correspondência ambígua não autoriza reconstruir histórico por suposição. Uma preparação de navegador bem-sucedida também não equivale à interação funcional exigida: o harness precisa reconhecer e registrar a execução apropriada e terminar o aceite integrado antes de declarar a entrega concluída.
