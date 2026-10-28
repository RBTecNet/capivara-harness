# Auditoria de init, plan e contratos

Escopo: `capivara/packages/core/src/{init,interview,contract,authoring,survey,prompt-engineer}` e testes correspondentes. Nenhuma implementação alterada; nenhuma API paga chamada. Concluída revisão do original integral de 59 arquivos de produção (14.022 linhas originais) e 61 arquivos de teste (13.861 linhas originais), total de 120 arquivos e 27.883 linhas. A primeira passagem compactou comentários e transpilou parte dos testes para ler a lógica; todas essas lacunas foram fechadas depois com leitura RAW dos originais, incluindo comentários e tipos. Nos 47 fontes de init/interview/contract, a leitura original prévia de código/tipos foi complementada por todos os comentários omitidos, preservando números de linha; os outros 12 fontes e todos os testes foram lidos ou relidos integralmente RAW, em blocos sem truncamento. Nenhuma linha de conteúdo original ficou sem revisão. Inventário por arquivo/LOC/SHA256 e método: `/tmp/novoharness-audit-init-inventory.tsv`; releitura delegada de 43 arquivos/9.865 linhas: `/tmp/novoharness-raw-contract-tests.tsv`; complemento dos comentários: `/tmp/novoharness-raw-comments-init.txt`. Todos os hashes originais foram reconferidos ao fechar a auditoria. Lido também o gerador `scripts/generate-contract-doc.mjs`.

## Fluxo real

`runPlan` (`src/init/plan.ts:17`) é wrapper de `runInit({stage:'plan'})`. Os dois motores não são separados: residem no mesmo `runInit` de 3.844 linhas, com estado mutável capturado por dezenas de funções internas.

INIT: inventário -> pergunta de banco obrigatória -> perguntas por modelo -> classificação local ou por modelo -> repergunta/insistência -> esqueleto JSON (até 3 tentativas; auditor assume a terceira) -> parser e prontidão -> regras de banco/plataforma injetadas -> publicar skeleton e estado JSON -> PLAN READY.

PLAN: ler skeleton MD + estado JSON + handoffs -> insistir decisões -> arquitetura (3 tentativas writer + 2 auditor) -> auditoria arquitetural com devoluções, serialização e reparador -> substituir divisão de fases no skeleton -> fases paralelas (cada uma 2 writer + 1 auditor) -> lacunas (até 200) -> autoconferência por famílias -> auditoria integral do plano -> emendas -> volta arquitetural -> pergunta de contradição ao usuário -> publicação -> prontidão final -> environment.json.

## Achados confirmados no código

1. **Não existe modalidade estruturada para rotear o produto.** `contract/skeleton.ts:102–122` e `contract/architecture.ts:102–116` não declaram formato de aplicação, plataformas alvo, ambiente de teste alvo ou capacidades de interação. `interview/protocol.ts:112–276` valida forma da pergunta, nunca pertinência por modalidade. O motor aceita pergunta de layout web para TUI se JSON satisfizer o protocolo. Não é solucionável garantindo somente outro texto no prompt.

2. **Contrato injeta navegador universalmente.** `contract/disponibilidade.ts:365–408` gera no motor frases `walks, in a browser`, `pages or routes`, sem parâmetro de modalidade. São inseridas por `init/orchestrator.ts:217–230`, `1516–1520`, `1796`. Workflow TUI/desktop é enquadrado em navegação web antes do código.

3. **Banco é perguntado mesmo quando o produto o exclui.** `init/orchestrator.ts:762` chama `perguntaDoBanco` incondicionalmente no skeleton. `interview/banco.ts:77–86` detecta exclusão mas apenas muda recomendação; continua questionando decisão explícita. Pedido sem qualquer persistência recebe recomendação padrão SQLite e pode ganhar sete regras de infraestrutura.

4. **Banco é acoplado a exigências universais de ambiente e testes.** `interview/banco.ts:186–321` injeta `.env`, `.env.example`, `migrate`, isolamento e aplicação funcionando sem servidor. Para banco informado, fixa o banco escolhido e exige exemplo operacional sem configuração e sem servidor local instalado; uma instância remota descartável pode ser compatível, portanto não é contradição universal. O texto injeta escolhas de produto/arquitetura por um catálogo estreito; a modalidade nem participa. Há sete regras retornadas (específica + seis comuns).

5. **Host muda recomendação de stack alvo.** `interview/plataforma.ts:30–75` detecta só cinco famílias (WinForms/WPF/WinUI/UWP/AppKit), e recomenda sempre Avalonia quando host diverge. Não modela um alvo Windows/macOS testado via máquina/runner externo. SwiftUI nem está no catálogo. A execução verificável local se sobrepõe à interpretação do objetivo.

6. **Fatiamento não impõe orçamento de contexto.** `init/orchestrator.ts:1512–1526` envia pedido completo, todas decisões pós-esqueleto e fatias. `contract/skeleton.ts:578–613` inclui toda stack, todo ambiente e todas regras em cada fatia. `contract/architecture.ts:721–725` inclui TODAS decisões de dados e TODA infraestrutura em cada fatia. `init/orchestrator.ts:3525–3532` envia skeleton + architecture + plano inteiro ao auditor. Não há medição/teto de tokens de entrada nem resolução por índice sob demanda.

7. **Regra de redução de testes vira rejeição documental, não seleção de verificações por defeito.** `contract/test-prescription.ts:30–244` usa grande coleção de regex linguísticas; `368–382` produz I-16 por menção de teste na task. `init/orchestrator.ts:3317–3327` gera REJECTED e nova emenda; `3612–3619` encerra após teto mecânico. `init/readiness.ts:122–129` ainda impede READY pela mesma regra. Isso não calcula necessidade ou custo de nenhum teste executado.

8. **Prescrição I-17 gera mais trabalho antes da engenharia existir.** `contract/mechanism-prescription.ts:101–123` bloqueia caminhos, nomes de variável, comandos e chamadas em fonte livre com exceção por substring da autoridade. `init/orchestrator.ts:1292–1367` tenta reescrever até três vezes, terceira tolerante. São chamadas pagas para distribuir texto entre estágios; não há defeito de código demonstrado.

9. **Autoconferência descobre um tipo de erro por vez.** `init/orchestrator.ts:3269–3505` retorna cedo nas famílias design, cobertura, testes, ownership, critérios/task e tamanho/fase. `3607–3627` usa orçamento mecânico global (padrão 3). Plano com quatro famílias independentes pode esgotar tentativas mesmo que cada reescrita corrija exatamente a pendência pedida.

10. **Quotas documentais rígidas se fazem passar por limite de modelo.** `authoring/ledger.ts:7,22,42`: 15 tasks/fase, 30 critérios/fase, 2 critérios/task, iguais para todos modelos. `init/orchestrator.ts:3363–3455` exige consolidar sem perder condições e sem poder criar nova fase; ultrapassar teto reabre escrita. Não há estimativa real de contexto/complexidade ou subdivisão automática do trabalho.

11. **Lacunas associadas por posição, não identidade.** `init/orchestrator.ts:3191–3194,3230,3235–3238` liga perguntas e marcadores por índice. `parseQuestionBatch` pode devolver apenas as perguntas válidas e o modelo pode reordenar lotes; a resposta da pergunta B então passa a fechar/apagar marcador A. A remoção em `authoring/repair.ts:122–137` apaga a linha inteira que contém marcador/trecho, sem verificar se a decisão foi implementada.

12. **Respostas da entrevista não são persistidas a cada resposta.** `init/orchestrator.ts:915–937` grava handoff ao fim da rodada; interrupção durante a pergunta seguinte perde respostas anteriores daquela rodada. `interview/handoff.ts:26–34` só confere contract e faz cast, engolindo todos erros como ausência; JSON válido de estrutura errada pode quebrar `retomado.answers.length` em `orchestrator.ts:766`.

13. **Estado de autoridade considera histórico ACCEPTED, não decisões vigentes.** `init/orchestrator.ts:1212,1567,1789,2126–2132,2256,2483–2501` filtra todas respostas com ACCEPTED; não chama `latestAnswers`. A estrutura permite revisão posterior/decisão que substitui anterior, mas ambas as versões seguem no contexto. `interview/rounds.ts:27–31` tem leitura de última resposta somente para prontidão/checkpoint; transmissão de autoridade usa outro caminho.

14. **Decisões finais da insistência podem não dirigir regras mecânicas.** INIT chama insistência e atualiza `allAnswers` (`orchestrator.ts:1210,2699–2701`), mas `naoObjetivos`, `decisaoDeBanco`, `decisaoDaPlataforma` usam `entrevista.answers` antigo (`1223,1382,1392`). A escolha fechada depois da entrevista fica visível ao escritor mas não necessariamente à tradução mecânica de banco/plataforma/não objetivos.

15. **Timeout vira decisão aceita, além de suposição.** `init/orchestrator.ts:688–720` assume recomendação depois de 10 minutos no PLAN, retorna número escolhido; `settle` o converte em ACCEPTED. `test/init/plano-de-uma-passada.spec.ts:165–174` confirma que a recomendação aparece em decisões E suposições. Uma decisão material não respondida pode ser apresentada como autoridade do usuário.

16. **Recuperação de limite de saída apenas pede texto compacto.** `init/orchestrator.ts:530–554` repete o mesmo pedido com um bloco adicional e para na segunda ocorrência. Não divide estrutura, reduz lote, solicita trecho faltante nem retoma streaming estruturado. `test/init/limite-de-tokens.spec.ts:43–64` exige esse comportamento.

17. **Recuperação pode enfraquecer requisito de runtime.** `init/orchestrator.ts:1676–1741` confronta sondas com Node/npm do harness; após uma devolução substitui teste de compatibilidade por `binary --version`. Não instala runtime por projeto. Uma sonda de compatibilidade substituída por --version passa a verificar existência; isso não demonstra, isoladamente, que toda exigência anterior veio do usuário ou que Node >=22 seja incompatível com Node 24. Evidência de falha de ambiente deve iniciar preparação/isolamento; não modificar o requisito para passar.

18. **Recuperação é orçamento local rígido, não catálogo único de recursos.** `track` repete timeout/silêncio 1 vez, rede em 5/20s e rate limit 2 janelas, depois lança (`orchestrator.ts:194–211,403–589`). Auditoria de arquitetura tem troca de estratégia/auditor/verifier; auditoria de plano só repete saída inválida 1 vez e para (`3548–3564`). Não há failover de provedor/modelo, redução do trabalho ou recuperação comum aplicada às três etapas.

19. **A arquitetura é publicada e muda o skeleton antes de o plano estar pronto.** `init/orchestrator.ts:1938–1962` escreve architecture/skeleton/estado em chamadas separadas; `authoring/staging.ts:57–66` só é atômico por arquivo. Queda entre arquivos pode deixar MD/JSON/stamp de gerações distintas. Não há commit de snapshot completo do projeto.

20. **Dependências de ambiente são listas, não árvore executável.** `contract/architecture.ts:63–100` possui arrays de runtimes/tools/packageManagers/dependencies/services/databases, cada item sem `dependsOn`, procedimento estruturado de instalação ou plataforma. `environment.ts:11–18` só tem binário, flag systemLevel e installHint textual. O grafo de componentes não substitui árvore de preparação do ambiente.

21. **Validações não equivalem a completude semântica.** `contract/coverage.ts:35–91` verifica referências por substring/regex; citar US/workflow faz passar sem implementar seu comportamento. `parseArchitecture` só recusa referência inexistente e auto-dependência (`architecture.ts:275–285`), não ciclo entre A->B->A. `checkDesignRefs` (`phases.ts:456–474`) aceita qualquer caminho existente e não verifica estar sob designRoot, apesar da descrição do invariante.

22. **Erro cosmético de contrato é entrada obrigatória para executar.** `contract/phases.ts:80–104,354–383` exige título literal, travessão, stamp na terceira linha e rótulos em inglês. `phase-part.ts` tem 483 linhas para reparar representações. Motor depende de Markdown produzido por LLM para estado de execução, criando superfície desnecessária de falha que JSON estruturado interno com apresentação derivada elimina.

23. **Survey não audita evidências declaradas.** `survey/orchestrator.ts:150–191` só parseia a resposta; `contract/survey.ts:291–306` valida existência de campo evidence sem confrontar arquivo/locator com código. `init/inventory.ts:135–150` resume manifestos pelos nomes, embora tenha lido conteúdos. A confiança na leitura por domínio é responsabilidade do modelo, sem garantia de cobertura por linha.

24. **Prompt engineer tem outro conjunto de loops e regras de parada.** `prompt-engineer/engine.ts:14–187` reimplementa descoberta, classificação, delegação e limites sem persistência de respostas. `170–173` só confere exitCode, ignorando engineError/timedOut do mesmo tipo AgentCaller que INIT trata. `protocol.ts:30–47` prova IDs preservados, não fidelidade dos conteúdos traduzidos. Não há motivo para copiar esse motor para a reconstrução.

25. **Relatório final erra MVP e custo histórico.** `init/orchestrator.ts:3813` usa número total de fases como corte MVP, em vez de skeleton.mvpCutPhase. Custo considera somente chamadas do run corrente, e uso parcial pode parecer total: RoleCost agrega tokens medidos e descarta ausência em outras chamadas (`orchestrator.ts:442–451`).

## Testes: diagnóstico, sem exclusão por contagem

Os arquivos `test/init/testes-no-build-129.spec.ts` e `test/contract/testes-no-build-129.spec.ts` verificam remoção/filtragem de conteúdo de teste nos documentos, não número efetivo de testes do produto. Há expectativas rígidas de número de chamadas e de trechos de prompt em `test/init/plano-de-uma-passada.spec.ts`, `limite-de-tokens.spec.ts`, `testes-no-build-129.spec.ts`; eles congelam o processo atual. Não são prova de que testes do produto foram reduzidos, nem todos são inúteis: orçamento é uma propriedade legítima se medido como custo/resultado e jamais usado para reprovar código correto em produção.

O levantamento completo dos testes deste escopo identificou também:

- `test/init/init.spec.ts:~622` exige que existam exatamente 12 gates e aceita reprovar por mera menção documental de teste; os cenários de dimensionamento exigem reprovar uma task que tenha três critérios.
- `test/init/limite-de-tokens.spec.ts:43–64` exige encerrar após segunda resposta truncada; `init.spec.ts` exige encerrar após segundo timeout. São testes do teto atual de tentativa, não prova de que todos os recursos foram explorados.
- `test/init/auditoria-consolidada-120.spec.ts`, `impasse-tecnico-119.spec.ts`, `recovery-first-121.spec.ts` têm muitas expectativas de sequência e quantidade exata de writer/auditor/verifier, além de frases literais dos prompts; fazem mudanças de processo parecer regressão mesmo quando o resultado melhora.
- `test/contract/doc.spec.ts:~13` compara documentação inteira byte a byte e exige rationale com comprimento >40. Isso pode existir como verificação editorial fora do caminho crítico; não demonstra correção de aplicativo gerado.
- `test/init/plan-convergence.spec.ts:~21` e `recovery-first-121.spec.ts:~62` ainda roteiam cenários por assuntos antigos `project-phases.md#coerência`, `#materialidade`, `#P2`. O motor atual audita `project-phases.md`; no primeiro cenário de `plan-convergence`, a ausência de pergunta pode passar sem jamais receber a decisão simulada. Testes cuja premissa não é exercitada dão confiança indevida.
- `test/contract/ownership.spec.ts`, `disponibilidade-127.spec.ts` e famílias 118/122/123/126/128/129 repetem longas fixtures de aplicações web, esperam muitas formas específicas da língua e não incluem modalidade estruturada de TUI. Eles protegem os remendos linguísticos e os custos dos respectivos pilotos; não compõem uma matriz de produtos por formato/plataforma.
- Testes que verificam persistir decisões, preservar arquivos antes de erro, retomar trabalho já válido, manter isolamento de banco, entrada de terminal e contrato entre etapas cobrem riscos reais. O plano de reconstrução deve criar cenários novos desses RESULTADOS, sem transportar motores, contratos legados ou fixtures que os prescrevem.

Para reimplementação integral, não portar esses testes ou fixtures de motores. Extrair do pedido atual somente cenários de produto: intenção/modalidade correta, lacuna material resolvida, construção e execução real nas plataformas possíveis, recuperação sem perder progresso, defeito real corrigido e nenhuma regressão crítica. Criar verificação nova por esses resultados.

## Consequências para o desenho inteiramente novo

- INIT produz ProductBrief estruturado com modalidade(s), alvo(s), comportamentos, restrições, dados, integrações, lacunas identificadas e proveniência. Pergunta nasce de uma lacuna com impacto e vínculo de identidade; exclusão explícita não gera pergunta. Linguagem de layout é derivada da modalidade/capacidade (terminal: navegação/foco/teclas/resize; desktop: janelas/plataforma/distribuição; web: navegador/responsividade/URLs), sem impor banco ou framework.
- PLAN constrói DAG de dependências técnicas antes de tarefas: runtime por alvo, gerenciadores, bibliotecas, serviços e dependências de instalação; cada tarefa referencia contratos consumidos e arquivos relevantes. Decomposição por orçamento de contexto real e capacidade do modelo, sem quotas de critérios. O motor seleciona conteúdo por relevância/IDs, nunca concatena pedido inteiro em toda chamada.
- BUILD recebe uma tarefa pequena e um plano de ambiente executável; prepara runtime e dependências por projeto; edita; verifica pelo comportamento/risco da mudança; retorna defeito concreto ao mesmo editor; muda estratégia e granularidade ao detectar estagnação. Auditor nunca bloqueia por estilo, documentação ou quantidade de testes. Não transformar indisponibilidade do ambiente em reprovação do código.
- Núcleo de execução, armazenamento, protocolo de agente, estado e recuperação NOVOS. Sem importação, wrapper, adaptação ou compatibilidade com os motores auditados. Não propor reutilização de algoritmos/contratos/loops legados.
- Dados de execução internos estruturados e compactos; Markdown é visão para humano, não protocolo obrigatório de controle.
- Snapshot transacional de decisões/plano/execução, resposta do usuário persistida imediatamente, revisão por IDs com supersessão explícita, recuperação só do trecho afetado.
- Os 99% foram esclarecidos pelo usuário como diretriz qualitativa: empregar todos os recursos pertinentes para salvar a execução e parar somente diante de falha crítica que permaneça sem solução. Não criar exigência estatística, quota ou teste de contagem para essa diretriz. Divergência entre `npm ci` e `npm install` é incidente recuperável do ambiente. Mudança de estratégia deve se apoiar na causa e na informação disponível; repetir idêntico indefinidamente não acrescenta um recurso.

## Reproduções executadas sem provedor

Script temporário `/tmp/novoharness-init-probes.mjs`, bundling direto de funções atuais com esbuild, executado em Node (sem suíte ampla, alterações no produto ou API). Quatro resultados:

1. Lote contém Q-01 perfeitamente válida e O-01 com `include` inválido. `parseQuestionBatch` retorna `questions: []`: `interview/protocol.ts:274` filtra perguntas comuns pelos índices dos defeitos das omissões. Uma omissão na posição 0 elimina uma pergunta válida na posição 0. Achado adicional confirmado, não mera hipótese.
2. `testPrescriptions('O produto tem testes automatizados', ['O produto tem testes automatizados'])` retorna `['produto tem testes automatizados']`. Nem autoridade explícita dispensa esse trabalho de redação I-16; reproduz semântica do laço de rejeição do plano.
3. `checkEntities` recebe task `Criar café`, critério `café existe`, trace `café`, entidade `café`; retorna I-11 dizendo que entidade não aparece. Causa: `\b` ASCII ao fim da palavra em `contract/coverage.ts:57`, sem semântica de fronteira Unicode. Prova de falso bloqueio lexical.
4. Workflow com texto `TUI em terminal` em `blocoDaDisponibilidade` retorna as instruções universais `in a browser`, `pages or routes`. Prova local da injeção web no motor.

## Ambiguidades a perguntar ao usuário

1. A reconstrução obrigatória abrange apenas os três motores e seus contratos/estado/prompts internos, ou também substitui CLI/TUI pública e integrações MCP/provedores? Não sugerir manter motor; é delimitação de superfícies periféricas.
2. O alvo multiplataforma exige provar aplicativos Windows/macOS em runners/VMs/máquinas dessas plataformas, ou pode entregar artefato com validação local explicitamente limitada quando só Linux está disponível? Não trocar stack/alvo automaticamente.
3. Que orçamento de dinheiro/tempo o motor está autorizado a consumir na recuperação, e pode trocar modelo/provedor por alternativa mais cara já configurada? Recurso disponível não equivale a autorização financeira ilimitada.
4. Preparar ambiente pode instalar serviços e runtimes fora da pasta do projeto ou deve preferir isolamento por projeto/contêiner e pedir decisão apenas para mudanças privilegiadas? É impacto operacional real, não barreira burocrática de todo comando.

A ambiguidade sobre os 99% foi encerrada pelo esclarecimento do usuário e não deve ser perguntada de novo.

## Revisão final independente e fixtures

O relatório `/tmp/novoharness-audit-root.md` foi confrontado com os trechos sobre pausa concorrente, snapshot, lock e classificação. Confirmados: um único resolver da pausa pode ser sobrescrito por esperas concorrentes; a retomada sem snapshot retorna antes de reconstruir eventos; aquisição de lock e publicação de owner têm janela entre operações. Precisão de redação: a classificação regex em `paradas.ts` foi demonstrada para apresentação/encaminhamento ao operador; ela sozinha não prova uma política automática de recuperação.

Fixtures inventariadas em `/tmp/novoharness-fixtures-inventory.tsv`: 51 arquivos, 5.013 linhas, sendo 19 JSON, 6 Markdown e 26 TXT. São dados de cenários, respostas e pedidos, sem módulo executável/função de fixture. Há trechos de código como texto de contratos e prompts, não arquivos de implementação a importar. Os 19 JSON foram parseados e os 14 arrays `checkArgs` inspecionados: todos contêm somente `--version`, sem sondas de script. Não se deve confundir os prompts embutidos nos dados com instruções para esta auditoria.
