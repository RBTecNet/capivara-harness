# RC2 — revisão e instrumento de verificação

## Causas confirmadas no código anterior

`execution/build.ts` filtrava achados por palavras associadas a testes. O parser também removia achados classificados como `style`, `info` ou `material:false` antes de conservar o parecer original. Depois desse descarte, uma reprovação podia ficar sem achados e voltar indefinidamente ao esclarecimento. O adapter Codex usava sandbox somente leitura para inspeção, enquanto relatos de comandos que tentavam criar arquivos temporários podiam ser interpretados como defeitos do aplicativo.

Antes da alteração, `npx vitest run test/execution/review.spec.ts`, ainda importando o parser do executor anterior, apresentou **2 falhas em 2 cenários**: um achado de execução contendo EROFS e contraste esperado/observado era apagado por seu rótulo de estilo; uma reprovação vazia não possuía decisão explícita `unresolved` nem o texto original. Essa execução ocorreu sobre a base `77a1178`, antes da substituição do parser.

## Protocolo novo

`execution/review.ts` retorna `approved`, `rejected` ou `unresolved`, conserva o texto original e registra normalizações e classificações. Todas as observações interpretáveis ficam em `findings`. `actionableFindings` distingue as alegações de defeito das sugestões explicitamente consultivas em `advisories`; nenhuma dessas coleções substitui o original. Categoria, observação, expectativa, local, evidência e orientação permanecem disponíveis.

Não existe filtro por palavras como testes, cobertura ou EROFS. Rótulos consultivos não apagam uma observação acompanhada de evidência, contraste comportamental ou classificação explícita de defeito. Uma reprovação sem alegação acionável fica `unresolved`, com motivo registrado. Também não se aceita aprovação acompanhada de defeito. O coordenador limita esclarecimentos e decide o próximo recurso ou a suspensão; o parser não cria repetição nem autoriza edição.

O campo estruturado `observed`/`problem` conserva uma alegação de defeito mesmo quando o modelo a rotula como consultiva. Sugestões de estilo explicitamente identificadas em `message`, sem observação comportamental, continuam disponíveis como sugestões. Uma alegação vaga não autoriza edição depois de repetir o mesmo parecer: o coordenador esclarece uma vez e registra a ausência de resolução.

O parecer distingue `evidenceType: source`, `verification` e `inspection-command`. Este último precisa fornecer uma receita em `verification`/`reproduction`. O coordenador a executa em ambiente gravável com o mesmo provedor operacional. Se a falha não se reproduz, conserva o parecer original, registra a classificação como incidente do instrumento e pede resolução explícita. Se o defeito se reproduz, usa o resultado real para orientar o reparo e preservar sua prova. Não se apaga EROFS por busca textual.

## Inspeção e execução são operações distintas

O revisor inspeciona código em modo somente leitura e recebe as provas do coordenador. A execução das receitas ocorre em área privada gravável. `verificationEnvironment()` fornece temporários e caches locais; `withVerificationWorkspace()` atende chamadas diretas por cópia gravável descartável, copiando os alvos dos links para não escrever na origem por meio deles. O scheduler usa suas próprias áreas persistentes para conservar trabalho interrompido.

Uma restrição de escrita é classificada como falha de instrumento somente quando o adapter/coordenador declarou a política somente leitura ou quando isolamento de filesystem foi efetivamente aplicado. A mesma saída EROFS fora desse contexto continua sendo uma falha a investigar no produto. O resultado original do comando é conservado. Isso é classificação de evidência com contexto operacional, não uma exceção por nome de projeto ou uma aprovação automática.

`AgentRequest.environment` agora chega às CLIs, ferramentas de comando, PTY e processos. O binding operacional prevalece sobre um default antigo de configuração. Variáveis de credencial não são despejadas no log e seus valores são ocultados dos resultados dos processos.

## Controle entregue no executor

O executor anterior foi substituído. Unidades independentes ocupam a capacidade configurada em áreas privadas persistentes. Escopos de leitura/escrita, recursos exclusivos, contratos exclusivos e serviços compartilhados impedem concorrência insegura; operações de rede sem recurso declarado recebem exclusão conservadora. Uma fila FIFO serializa cópias e publicação otimista de alterações. Conflitos anteriores à publicação recebem uma nova base e uma tentativa de reconciliação, conservando a proposta e as alterações já integradas. Uma publicação parcialmente aplicada bloqueia publicações posteriores até sua recuperação durável.

Cada chamada tem identidade de entrada, ambiente, configuração e estratégia, com registro anterior à execução e resultado posterior. Resultados idênticos são reaproveitados. Ausência de progresso passa por reparo dirigido e diagnóstico independente; estados efetivos repetidos são reconhecidos por impressão persistente, sem limite artificial de transições, sleeps ou aumento de contexto. Transporte indisponível preserva a fase; uma intenção explícita de sondar novamente um recurso externo não apaga provas nem permite reeditar código correto.

As receitas de um lote usam uma cópia de verificação separada da área do editor. `dependsOn` preserva a sequência produtor/consumidor; o checkpoint conserva artefatos entre receitas e após interrupção. Somente `outputs` declarados e medidos são promovidos ao conjunto integrável, depois de todas as provas passarem. Temporários não declarados permanecem fora do produto. Um artefato ausente invalida a possibilidade de pular seu produtor. Consumir um arquivo gerado sem declarar sua produção constitui defeito do planejamento, em vez de provocar invalidação infinita.

Revalidação ocorre depois de esgotar o trabalho pronto. Cada prova é comparada com sua entrada atual, receita, interface, nível e identidade operacional; histórico positivo não substitui prova atual. Alterar apenas critérios pede nova revisão e conserva provas executáveis ainda válidas. Um defeito material do aceite final volta à entrega responsável, com a prova negativa concreta; entregas independentes continuam aprovadas. Falhas de receita ou conformidade são encaminhadas à recuperação do instrumento ou à reconciliação do plano, sem aprovação por conveniência.

Depois da integração confirmada e persistida, mapas completos da base e áreas temporárias de tarefas concluídas são liberados. Trabalho incompleto e propostas de conflitos permanecem preservados. As métricas distinguem chamadas por papel, concorrência observada, espera de fila, preparação, isolamento, verificações, revisão, integração, revalidação, aceite e limpeza.

## Validação reproduzível

```sh
cd packages/core
npx vitest run test/execution/review.spec.ts test/runtime/verification.spec.ts test/runtime/runtime.test.ts
```

Os cenários exercitam preservação de defeito material, reprovação vazia, contradição de parecer, sugestões retidas, classificação contextual de sandbox, gravação real de temporários e artefatos em cópia isolada, preservação da origem mesmo com links, limpeza após falha e propagação real de bindings para CLI/comando/PTY/processo. Não há inferência paga nesses testes.

A cópia gravável não é por si uma fronteira de segurança contra um comando arbitrário que usa caminhos absolutos ou serviços externos. Recursos externos exigem o modelo de capacidades e exclusões do coordenador e, quando disponível, isolamento do sistema operacional. A classificação de isolamento informa a política efetivamente usada e não afirma que um host sem sandbox possui a mesma contenção.
