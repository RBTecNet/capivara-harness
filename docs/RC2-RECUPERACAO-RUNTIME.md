# Recuperação estrutural do motor RC2

A execução corrigida de `samba_admin` concluiu com código zero, **10 de 10 tarefas integradas e aceite global aprovado**. O [snapshot final das 17:14:12 de 28/10/2026, horário de São Paulo](rc2-evidence/samba-admin-recovery-final.json) registra `complete/build`, `lastFailure: null` e o diário até o evento 12763. A [conferência separada da retomada instalada](rc2-evidence/samba-admin-completed-resume.json) também passou: plano idêntico, zero chamadas a modelos, zero novas provas e conclusão preservada. Essa conferência levou 165.926 ms para sondar o ambiente e conferir os inputs; a retomada ainda tem esse custo de tempo.

As [observações funcionais registradas](rc2-evidence/functional-verification-runtime-recovery.json) incluem build de produção, 13 testes em seis arquivos, cinco fluxos reais em Chromium e execução da API com o runtime Node e o SQLite locais. Os fluxos de navegador cobrem CRUD, validação, confirmação de exclusão, navegação e persistência após reiniciar a API. As saídas resumidas conservam os IDs e horários das observações; extraí-las não repetiu os comandos.

A primeira conclusão, às **16:52:33**, está preservada no evento 12155 e no [registro real anterior à retomada](rc2-evidence/samba-admin-first-completion.json). A retomada instalada seguinte revelou um defeito adicional: ressuscitou uma tarefa aposentada e reativou seu replanejamento. Ela não foi uma retomada limpa. O resultado final acima veio depois da correção de linhagem e fila e da revalidação de contratos alterados durante essa tentativa defeituosa.

Os pontos anteriores foram mantidos como histórico: [14:13, esperando com 7/10](rc2-evidence/samba-admin-recovery-latest-snapshot.json), [14:28, trabalhando com 8/10](rc2-evidence/samba-admin-recovery-live-snapshot.json), [15:02, aceite em execução com 9/10](rc2-evidence/samba-admin-acceptance-progress-snapshot.json) e [17:00, retomada já em execução](rc2-evidence/samba-admin-resume-in-progress.json). Este último é um snapshot genuíno de `working`; não foi convertido artificialmente em estado concluído.

## Causas corrigidas

**Invocação e ambiente.** `provides.command: ["node", "npm"]` era aplicado como um único argv, produzindo `node npm --version`. Um wrapper gerado pelo próprio harness inutilizava o Node instalado. O motor agora sonda a invocação concreta, distingue argumentos de declarações independentes e conserva suas transformações. Valores descritivos de configuração e arquivos de produto não são injetados como variáveis ou diretórios executáveis. Recuperação de ambiente usa tarefa própria e workspace privado; somente dependências e instalações podem ser publicadas. Alterações indevidas de produto permanecem em proposta preservada. Instalações mantêm executáveis e links e possuem transação retomável.

**Launcher e runtime nativo.** Após a integração das dez tarefas surgiu outro erro do instrumento: o binding da capacidade Node.js invocava npm, e o observador tentava sondar esse launcher com argumentos de Node. A API executava, mas o harness não registrava o testemunho exigido. A resolução agora segue o shebang real e o PATH declarado até o interpretador nativo. O recibo conserva capability, kind, provider, fingerprint do binding, comando original, hashes do launcher e do binário nativo. A conformidade exige esse recibo e os hashes atuais dos módulos de produto efetivamente carregados; disponibilidade isolada do runtime continua insuficiente.

O [ensaio da API real](rc2-evidence/native-provider-real.json) terminou com código zero, observação habilitada e nenhum problema de conformidade. Ele registrou Node nativo e o carregamento de `server/src/index.ts` e `server/src/db.ts` com seus hashes, usando SQLite temporário e HTTP de verificação, sem editar o produto. A versão 2 desse observador invalida as provas de conformidade de runtime afetadas; não torna obsoletas todas as provas do projeto.

**Autoridade.** A preposição portuguesa em “Fluxos reais executados no navegador” era interpretada como a negação inglesa “no browser”. A correção limita negações aos seus objetos, reconcilia interpretações persistidas e preserva a origem da transformação. Um requisito positivo de navegador continua obrigatório.

**Asserções e progresso.** Na retomada das 12:02–12:08, a API terminou com código zero e saída concreta, mas `expected` continha apenas uma descrição humana. O coordenador repetia reparos da receita e considerava mudanças na redação como progresso. Agora critério semântico, observação persistida e asserção executável são dados separados. Uma árvore tipada admite texto literal, regex validada, JSON, código de saída e composição. A recuperação associa uma asserção à observação existente; uma interpretação inválida segue para diagnóstico independente e reconciliação do contrato de prova. Reformular prosa não equivale a mudar uma receita. Código zero não vira aprovação automática de comportamento.

**Observação e prova têm identidades distintas.** O aceite real expôs um defeito restante: o modelo vinculou uma asserção à duração literal impressa pelo runner. Corrigir esse predicado mudava a identidade da prova e disparava novamente o comando, que imprimia outra duração. O próximo reparo perseguia um valor novo, mantendo uma repetição sem progresso. A correção está no executor: `observationHash` identifica a execução e exclui somente `expected`, `assertion` e `assertionIssue`; a identidade da prova inclui esses campos. Comando, argumentos, fonte, ambiente, capacidades, contratos e demais entradas continuam identificados.

A reinterpretação exige observação real com saída zero, sem erro, timeout ou cancelamento, identidade de execução igual e artefatos atuais compatíveis. Uma reprovação material não vira aprovação por trocar o predicado: é necessária classificação independente de instrumento antes de reutilizar um negativo dessa origem. A prova negativa original permanece imutável; a nova possui ID próprio, `reinterpretedFrom` e o mesmo `observedAt`. O critério semântico continua sob revisão independente. Os quatro testes de `observation-reuse.spec.ts` incluem uma saída volátil executada uma única vez, vínculo do predicado e retomada sem outro comando ou editor; também preservam um defeito real de CLI.

**Contexto e revisão.** O pacote informa quais fontes foram entregues completas, parcialmente, omitidas ou ausentes, com hash e intervalos de linhas. Uma alegação baseada em fonte incompleta pede a fonte necessária e mantém o achado pendente. Citações explícitas são confrontadas com arquivo, hash e linhas reais. Alegações de ausência exigem cobertura apropriada; arquivo realmente inexistente, indicado no inventário e confirmado por `ENOENT` com ancestrais seguros, continua sendo um defeito material que o editor pode corrigir. Não há descarte por palavras da mensagem nem aprovação por silêncio. A revisão independente continua responsável pelo vínculo semântico entre requisito e evidência.

O arquivo citado no achado mais recente ganha prioridade no orçamento de contexto, incluindo seu intervalo de linhas. A ordem de um conjunto histórico de pendências não pode continuar escondendo a fonte necessária para resolver o defeito atual.

**Provas corretas no pacote do revisor.** Selecionar os últimos N registros do histórico misturava negativos antigos com provas atuais, mesmo após a correção da causa. O pacote agora usa os IDs e hashes exatos do lote verificado para cada check. Recibos ausentes, ambíguos, negativos ou com interface diferente impedem uma aprovação fundada nesse lote e exigem verificação. Até três provas relacionadas podem fornecer contexto, dentro de 20% do pacote; não substituem as provas da unidade. Os dados históricos completos continuam preservados, e os trechos exibidos declaram seus cortes.

**Inspeção independente tem validade própria.** Refazer uma prova mecânica após mudar um manifesto descoberto automaticamente ou a receita não exige outra chamada ao auditor se a inspeção aprovada permanece vinculada às mesmas fontes, critérios, requisitos, restrições, leituras explícitas e identidades de provider. O motor só reaproveita essa aprovação depois que todas as provas atuais aplicáveis passaram e seus recibos foram confrontados com os hashes atuais. Mudança em fonte pertencente à entrega, leitura explícita ou critério invalida a inspeção. Um parecer antigo sem essa identidade só pode valer pelo seu hash completo exato; não se inventa uma identidade histórica para permitir reaproveitamento mais amplo.

Os cinco testes de `inspection.spec.ts` incluem uma sequência completa: primeira entrega com um editor, uma revisão e uma prova; mudança somente no manifesto automático produz uma segunda prova e mantém uma revisão; alteração de fonte exige a segunda revisão; alteração de critério exige a terceira. Esses testes demonstram o comportamento dos fontes novos. Não significam que a execução anterior, carregada com outro controlador, já evitou as chamadas históricas gastas durante sua revalidação.

Uma referência de arquivo inválida, fora do workspace, emitida pelo modelo agora permanece como metadado não resolvido no contexto, com a alegação original preservada. Ela exige resolução e não derruba o montador do pacote nem autoriza editar outro caminho.

**Replanejamento e linhagem.** Reparar um instrumento não autoriza substituir uma entrega de CRUD por uma tarefa administrativa de registrar parecer. O escopo de reparo preserva o contrato da entrega. O resgate exige uma definição histórica com hash exatamente igual ao checkpoint existente ou ao contrato aprovado persistido. Uma proposta incompleta precisa existir em fase de verificação ou revisão; restaurar um contrato já aprovado não inventa outra proposta de fonte. Arquivos e requisitos precisam identificar um sucessor único; candidatos igualmente abrangentes permanecem ambíguos. Contrato, arquivos e dependências originais são restaurados, com configuração de provas apropriada ao estado salvo. Verificação, revisão e integração continuam obrigatórias. O [dry-run inicial registrado](rc2-evidence/plan-lineage-dry-run.json) confirmou a identidade da proposta no caso real, sem modificar o projeto.

O mesmo princípio foi aplicado ao último bloqueio de conformidade. A ausência do testemunho do provider havia encaminhado o problema ao reparo da entrega e substituído indevidamente a fundação por uma tarefa de consumo visual; o plano continuou com dez tarefas. Falta de prova do provider e asserção virtual exigem agora escopo de verificação ou ambiente, preservando o produto. Retentativas também consideram configuração e versão do protocolo que realmente mudaram o caminho executável.

A primeira retomada instalada mostrou que preservar uma proposta histórica não significa que ela ainda deva ser executada. A recuperação de linhagem reativou uma entrega já aposentada e sua fila antiga, desencadeando outro planejamento. Esse é um defeito do motor, não uma pendência nova do produto. A fila agora é confrontada com o plano antes da restauração e depois de cada adoção. Jobs aposentados conservam incidente e métrica causal; não voltam a executar. Uma adoção que elimina o dono de outro job também impede acessar esse dono inexistente. A regressão da fila órfã falhou antes e passou após a correção; outra cobre dois jobs consolidados por um plano, com apenas uma chamada de planejamento.

A aposentadoria de linhagem identifica o hash exato do contrato substituído e sua proposta, em vez de proibir um ID para sempre. Um registro aposentado não volta só porque possuía aprovação; uma proposta genuinamente nova do mesmo ID continua preservada. O resgate já reconciliado permanece estável após reinício, inclusive com definições legadas aprovadas. O dry-run sobre o plano atual corrigido retornou `restored: []`. Os testes também conservam o resgate legítimo de uma entrega de produto substituída por tarefa administrativa sem prova comportamental.

**Recursos e persistência.** Binários de navegador usam gerações compartilhadas em armazenamento canônico, com identidade do provider, lock de preparação e lançamento headless real. Esse caminho é fixo e não é reescrito para outra cópia de verificação. Instalação sem efeito é registrada, caches utilizáveis são reaproveitados e prontidão pode ser revalidada sem nova implementação. O callback de persistência recebe plano e estado da mesma revisão e os grava juntos, evitando checkpoint associado a um plano anterior. Suspensões normais também registram bloqueadores e `lastFailure`; trabalho parcial existente passa por provas antes de outro editor.

**Adoção de planos e cancelamento.** Uma proposta de replanejamento concluída podia perder sua fila antes de ser adotada; outra janela gravava o plano proposto com o estado antigo. Agora a proposta fica persistida em `action.planProposal`, ainda pendente, até a adoção conjunta de plano e estado. Jobs novos criados durante a recuperação permanecem na fila; consumir um job não apaga uma causa posterior do mesmo task. A recuperação recebe as checks efetivas, inclusive em reparos de ambiente, e não descarta uma receita recuperada por uma alteração sem relação com ela. Cancelamento preserva operações interrompidas como interrompidas, sem aprovar observações canceladas ou marcar uma estratégia incompleta como esgotada. A retomada de uma proposta já obtida não chama novamente seu planejador. Esses registros protegem interrupções reais; não são motivo para encerrar trabalho recuperável.

**Instrumentos opcionais.** Um alias de conveniência com nome inválido ou maior que o limite do sistema de arquivos não pode impedir a chamada do provider concreto. Sua omissão é registrada em `action.instrumentRepairs`, com o motivo e a invocação preservados. Isso não dispensa a prontidão do provider nem transforma uma ferramenta ausente em disponível.

**Entradas reais das provas.** A identidade incorpora operandos de leitura de argv, diretórios e arquivos ainda ausentes. Criar um arquivo consumido pelo comando invalida a prova negativa e a cópia de verificação correspondentes. Para Playwright configurado, o adaptador usa o coletor do próprio provider instalado para identificar os specs selecionados, a configuração e suas dependências; não adivinha um diretório padrão de testes. O ensaio real focal do adaptador identificou um spec E2E selecionado, além de configuração e manifesto, reaproveitou o recurso existente, iniciou Chromium e terminou sem instalação nova nem alteração de fonte do produto.

Filtros de arquivo da CLI também passam pelo protocolo do Playwright instalado. Ao mudar a seleção de specs, o motor substitui as entradas derivadas da seleção anterior; preserva as entradas declaradas no plano. Assim, um spec não selecionado do mesmo projeto não invalida uma prova focada sem relação com ele, enquanto mudanças nos specs consumidos e seus imports continuam invalidando-a.

Uma asserção explícita malformada também impede aceitar um build apenas porque o comando terminou com código zero. O predicado precisa ser recuperado; sua identidade de prova é invalidada de forma localizada, conservando a observação disponível para reinterpretação segura. Um build mecânico sem asserção continua podendo comprovar compilação pelo resultado do compilador. Isso não comprova interação ou comportamento por consequência.

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

A [validação final dos fontes congelados](rc2-evidence/validation-runtime-recovery.json) por `npm run check` passou: build, tipos e **296 testes em 44 arquivos**. O registro também confirma que a CLI instalada possui exatamente os bytes do build testado. As regressões incluem interrupção antes e depois do resultado de replanejamento, gravação consistente de plano e execução, seletores de argv, fontes efetivas de Playwright, prioridade do achado atual, separação de observação/prova, identidade nativa do provider, validade independente da inspeção e retomada idempotente de linhagem e fila. A otimização localizada do resolvedor, descrita abaixo, também passou pelos 36 testes existentes de provas de ambiente e controle de execução. O reprodutor das quatro comparações foi regenerado sobre os fontes finais; o hash do snapshot de código está no JSON. A suíte não depende de chamadas pagas de modelos.

Os [cinco pilotos atualizados](rc2-evidence/pilots-runtime-recovery.json) executam produtos e comandos reais com agentes determinísticos:

| Piloto | Tempo medido | Concorrência observada |
| --- | ---: | --- |
| Node serial, 3 editores e 3 revisores | 972 ms | 1 |
| Mesmo produto Node paralelo, mesmas chamadas | 583 ms | 2; sobreposição alpha/beta |
| Node com prova de uso do runtime obrigatório | 1.772 ms | 2 |
| Python com dependências estritas | 537 ms | 1; sem sobreposição |
| TUI com interação em PTY real | 328 ms | 1 |

Esses tempos pertencem aos pilotos controlados, não à latência ou ao custo de modelos pagos.

## Custo da identificação das provas

A execução real também revelou demora do próprio instrumento: uma verificação com comando curto gastava dezenas de segundos antes de iniciar o produto. O [perfil somente de leitura](rc2-evidence/input-profile-runtime-recovery.json) mediu 22,29 segundos na expansão das dependências e 1,33 segundo na leitura e hash dos arquivos. O diário registra, por exemplo, 37,45 segundos anteriores ao comando E2E e 2,68 segundos para comando e finalização. `checkedAt` é gravado depois da resolução e do hash; não foi inventada uma duração isolada do comando.

O resolvedor consultava os mesmos manifests em cada ancestral para milhares de fontes e enfileirava novamente caminhos relativos, embora o conjunto de visitados guardasse caminhos absolutos. A correção mantém inventários de diretórios, resoluções de import/package e caminhos enfileirados **somente durante uma chamada**. Uma prova posterior volta a observar os arquivos e as ausências atuais; não há cache entre provas que possa aceitar código obsoleto.

Na [comparação reproduzível](rc2-evidence/input-graph-comparison-runtime-recovery.json), a mesma cópia privada e o mesmo check produziram exatamente as mesmas 3.436 entradas e os mesmos hashes de conteúdo: **19,95 s antes; 4,90 s depois**, aproximadamente 4,1 vezes mais rápido nessa etapa. Nenhuma dependência ou prova foi retirada. A leitura e hash dos conteúdos continuou em aproximadamente um segundo. A identidade calculada para consultar o cache agora também é passada à execução dessa prova, evitando resolver o mesmo grafo imediatamente outra vez. Permanecem leituras em outras etapas de validade e integração; essa medição não equivale a uma promessa de tempo total para projetos arbitrários.

```sh
node scripts/profile-input-graph.mjs /caminho/do/projeto integrated-acceptance web-interface-e2e 5c27692
```

O comando lê o checkpoint de verificação existente e exige igualdade dos hashes antes/depois. Não executa a aplicação, agentes ou instaladores e não modifica o projeto.

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

Às 15:02, o registro parcial do aceite contém 141 chamadas nesse mesmo recorte: planejador 10, reparador 53, revisor 65 e editor 13. Os detalhes por fase e por intervalo do diário estão no snapshot, sem atribuir custo financeiro não informado. São medidas de uma investigação e correção em andamento, não um benchmark de economia da ferramenta.

Às 15:17 foi necessária uma substituição controlada do processo para carregar a correção da observação/prova: o binário anterior repetia as asserções de duração. O [registro da troca](rc2-evidence/controller-observation-upgrade.json) confirma zero agentes ativos, nenhum processo filho de produto e estado preservado. Foi intervenção de engenharia durante a investigação; não é evidência de que o binário anterior se recuperou sozinho. No controlador corrigido, a prova E2E encontrou o predicado de duração incorreto uma vez, passou por diagnóstico independente e vínculo da asserção e, na próxima avaliação, reutilizou a observação sem repetir o comando. As quatro provas dessa unidade passaram e ela seguiu para revisão; o aceite global ainda depende da conclusão registrada pelo motor.

Uma segunda troca controlada foi necessária para carregar a correção do observador nativo. O [registro correspondente](rc2-evidence/controller-native-runtime-upgrade.json), com estado de 16:17, também registra zero agentes ativos e nenhum filho de produto. A limitação do controlador antigo era de instrumentação: não conseguia provar o consumo do runtime pela API existente. Essa aplicação de uma correção nova também é intervenção de engenharia, não recuperação autônoma retrospectiva do executável anterior. Dez tarefas integradas não bastam para declarar conclusão enquanto a conformidade global permanece pendente.

A conformidade nativa e o aceite global passaram antes do evento de conclusão das 16:52. Às 16:59, o registro anterior à retomada confirma `complete`, 10/10 tarefas, 148 registros de prova e 28 de aceite. São contagens históricas, não 176 execuções distintas nem comprovação de que todos os registros antigos continuam válidos. A retomada instalada começou a partir desse estado e expôs a reativação indevida de trabalho aposentado; não deve ser apresentada como simples conferência sem chamadas ou sem replay.

Para aplicar a correção recém identificada de linhagem e fila, o processo dessa retomada foi congelado de forma controlada. O [registro da intervenção](rc2-evidence/controller-lineage-upgrade.json) confirma zero agentes ativos, zero filhos e nenhuma chamada de domínio em andamento. Fontes e propostas foram preservadas. O controlador antigo terminou com código 130 antes de a nova execução instalada assumir o projeto; uma tentativa antecipada de lançamento foi recusada, preservando exclusividade. Isso também é engenharia para substituir um controlador defeituoso; não é recuperação autônoma nem conclusão limpa da primeira tentativa de retomada. A suíte anterior de 291 testes não incluía esse último reparo; a validação final acima registra 296.

A execução instalada com o reparo de linhagem manteve o plano atual, sem novas restaurações e sem jobs pendentes, e concluiu. Ela ainda precisou revisar contratos alterados pelo planejador da retomada defeituosa anterior. Essas chamadas não são apresentadas como uma retomada inteira com custo zero.

O [snapshot final](rc2-evidence/samba-admin-recovery-final.json) registra **204 chamadas desde o evento 228**: planejador 14, reparador 66, revisor 111 e editor 13. O uso informado nesse recorte é de 26.542.724 tokens de entrada, 23.036.800 em cache e 177.950 de saída; o provedor não informou valor financeiro. A primeira execução anterior ao evento 228 teve outras nove chamadas. O custo dessa investigação e das intervenções não foi ocultado nem convertido em uma alegação de economia.

O histórico final mantém 151 registros de provas e 32 de aceite, incluindo negativos anteriores e sete reinterpretações vinculadas à observação original. Esses totais não são uma contagem de critérios finais reprovados nem de execuções únicas. A conformidade final contém recibo do Node nativo e testemunho dos arquivos atuais da API e do banco, além das provas de interface e build selecionadas pelo motor.

A chamada separada de conferência terminou com código zero e `complete/build`, 10/10 tarefas, sem bloqueadores nem replanejamentos pendentes. Comparou IDs únicos de prova, hash do plano e eventos de início de agentes: **zero chamadas a modelos, zero novas provas e plano inalterado**. O ledger de aceite passou de 32 para 36 entradas ao referenciar quatro provas existentes; nenhum ID novo foi criado. Sondagens de prontidão e hashing continuam necessários e consumiram aproximadamente 2min46s neste projeto. Não se declara retomada instantânea ou ausência de todo custo operacional.

```sh
node scripts/verify-completed-resume.mjs /caminho/do/projeto docs/rc2-evidence/completed-resume.json /caminho/da/cli.js
```

O script exige um projeto já concluído antes de iniciar a CLI real. Registra o estado antes/depois e falha se a conclusão não for preservada, o plano mudar, houver chamada a modelo ou surgirem novos IDs de prova. Não simula agentes nem produz aprovações.

Para produzir outra captura sem iniciar ou parar o harness:

```sh
node scripts/capture-execution-evidence.mjs /caminho/do/projeto docs/rc2-evidence/execution-snapshot.json 228
```

A leitura transacional mantém plano, estado e diário consistentes. O relatório separa tarefas do plano atual de registros aposentados, preserva métricas cumulativas e identifica provas históricas como históricas. Exporta contadores, horários e uso informado, sem prompts, configuração, comandos ou stdout dos agentes. Fases específicas são atribuídas pelo papel e pela ação persistida próxima; épocas terminam em eventos `waiting`, sem inventar paradas de processo ou duração da depuração manual.

## Limites da evidência

As validações locais ocorreram em Linux. A instrumentação de provider observa subprocessos Node previstos pelo adaptador; não é rastreamento universal de toda stack. Contexto completo e citação válida sustentam uma revisão, mas não provam sozinhos a interpretação semântica do parecer. Hash de linhagem insuficiente ou correspondência ambígua não autoriza reconstruir histórico por suposição. Uma preparação de navegador bem-sucedida também não equivale à interação funcional exigida: o harness precisa reconhecer e registrar a execução apropriada e terminar o aceite integrado antes de declarar a entrega concluída.
