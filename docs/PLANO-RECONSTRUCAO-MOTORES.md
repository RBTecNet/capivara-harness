# Reconstrução completa dos motores init plan e build

Data: 28 de outubro de 2026. Estado: plano técnico resultante da auditoria de código; as decisões operacionais listadas ao final ainda aguardam resposta. Não foi iniciada a reimplementação.

A ferramenta existe para transformar um pedido em aplicação funcional, poupando tempo e dinheiro. Seus motores novos serão construídos do zero para web, desktop Linux/Windows/macOS e terminal, com fragmentos pequenos que modelos de diferentes capacidades consigam executar. A [auditoria consolidada](AUDITORIA-RECONSTRUCAO-MOTORES.md) documenta as causas encontradas na implementação atual e as reproduções realizadas.

A regra principal, esclarecida pelo usuário, é: **sempre lutar para salvar a execução; somente parar quando for impossível continuar**. Os 99% expressam essa diretriz de recuperação, não uma exigência de criar testes de porcentagem, contar testes ou manter artificialmente um processo vivo. Recuperar significa resolver a causa e retomar o desenvolvimento correto.

**Poder reiniciar do ponto salvo não autoriza parar.** Checkpoint é proteção para interrupção externa, falha irrecuperável ou decisão do usuário, nunca muleta para encerrar diante de defeito resolvível. Havendo uma possibilidade aplicável de continuar, é obrigatório prosseguir até resolver a pendência.

## 1 Limites da reconstrução

Serão novos os orquestradores dos três módulos e toda lógica que participa das suas decisões: representação do pedido e das lacunas, planejamento, árvore de dependências, fragmentação, montagem de contexto, execução de ferramentas, seleção de verificações, cooperação editor/auditor, recuperação, integração e estado de retomada.

Não haverá importação, adaptação, encapsulamento ou transplante de motores existentes. Também não haverá leitura dos formatos antigos para executar projetos novos, migração de runs, dupla interpretação de planos, manutenção de gramática Markdown antiga ou modo de compatibilidade. Os testes e fixtures que congelam os motores antigos serão retirados com eles; a verificação da reconstrução nasce dos comportamentos exigidos agora.

Os nomes `init`, `plan` e `build` permanecem porque expressam as três atividades pedidas. Nenhuma API, flag, contrato interno, diretório de estado ou comportamento histórico precisa ser preservado. O código antigo fica apenas no histórico Git como referência da auditoria. O corte não apaga aplicações ou dados dos projetos que o usuário construiu.

CLI/TUI, provedores e MCP precisam ser ligados a interfaces novas. Toda decisão de execução hoje espalhada nessas superfícies sai delas. Redesenhar integralmente sua aparência ou todas as funções auxiliares é uma delimitação de produto pendente; não é condição para conservar um motor antigo. `change`, `survey` e `prompt-engineer` não poderão continuar chamando os motores removidos: devem receber entrada nova coerente ou sair da primeira entrega conforme a decisão de escopo.

## 2 Regras executadas pelo motor

| Regra | Mecanismo obrigatório na implementação nova |
|---|---|
| Continuar diante de falhas recuperáveis | Resultado de operação vira diagnóstico e ação seguinte; exceção local não encerra a rotina |
| Entender o produto pedido | Interfaces, alvos e restrições ficam em dados explícitos e participam da seleção de perguntas, ferramentas e verificações |
| Perguntar somente para resolver lacuna real | Pergunta exige vínculo com informação ausente e consequência concreta; init e plan podem concluir sem entrevista |
| Trabalhar com pouco contexto | O motor monta pacotes por tarefa e mede seu tamanho antes de chamar qualquer papel |
| Planejar dependências no início | O primeiro resultado do plan contém o grafo de runtime, SDK, pacotes, serviços e ordem de preparação |
| Auditor ajudar a corrigir | Achado material contém esperado, observado, localização, evidência e próximo reparo; vira tarefa do editor |
| Testar pelo risco e pelo comportamento | Selecionador agenda verificações pertinentes; contagem de testes ou frase de prompt nunca aprova/reprova código |
| Evitar trabalho repetido | Evidência anterior só é refeita se mudaram suas entradas relevantes ou surgiu motivo concreto |
| Preservar o trabalho | Resposta, patch e conclusão de operação têm persistência durável e retomada por identidade |
| Não fabricar sucesso | Indisponibilidade de uma verificação é falta de evidência a recuperar; não demonstra defeito nem funcionamento do produto |
| O harness não inventar requisitos | Cada ação/verificação declara capacidade e efeito; incompatibilidade com restrição do pedido corrige o instrumento, sem mandar deformar o produto |

Prompts descrevem a pequena tarefa atual e sua interface de saída. Não têm autoridade para determinar as regras acima. A instrução textual “faça menos testes” não substitui um selecionador de verificações. A instrução “não quebre” não substitui o mecanismo de recuperação.

## 3 Estrutura mínima do sistema novo

Haverá três serviços de domínio, `init`, `plan` e `build`, sobre uma infraestrutura de execução também nova. Ela oferece operações simples: ler contexto relevante, executar ferramenta, registrar resultado, persistir trabalho, obter decisão e selecionar uma recuperação. Um único agendador executa dependências, com um ou vários agentes; serial e paralelo são o mesmo funcionamento com capacidades diferentes.

O estado tem uma fonte de verdade transacional. Documentos para leitura humana são derivados desse estado; nenhum modelo precisa acertar travessão, título, terceira linha, stamp ou número de checkbox para que o desenvolvimento continue. Não será criada uma segunda hierarquia de documentos para validar a primeira.

Registros mínimos:

| Registro | Informação necessária |
|---|---|
| Pedido | Resultado desejado, modalidades, alvos, requisitos, restrições e suas origens |
| Decisão | Lacuna identificada, pergunta, resposta original, decisão vigente e dependentes afetados |
| Plano | Dependências técnicas, contratos de integração e tarefas com relações explícitas |
| Tarefa | Objetivo pequeno, entradas, resultado esperado, arquivos relevantes, contratos e verificações pertinentes |
| Operação | Intenção de efeito, estado, resultado observado e referência ao trabalho persistido |
| Evidência ou incidente | O que foi conferido/observado, sobre quais entradas, e o que falta corrigir |

Esses registros não constituem novos documentos obrigatórios a serem escritos e auditados por vários agentes. São dados que o motor mantém. IDs estáveis evitam associar resposta, requisito ou defeito por posição em lista ou por semelhança de palavras.

Snapshots são recuperáveis a partir dos registros duráveis necessários. Publicar uma revisão de pedido/plano é uma transação: não pode existir metade do novo plano e metade da versão anterior. A posse de um trabalho tem identidade própria e liberação condicionada a essa posse. UI, logs opcionais e sincronização MCP auxiliar não participam da decisão de concluir uma tarefa. MCP que fornece informação ou ferramenta indispensável é dependência real: sua indisponibilidade exige recuperação ou alternativa equivalente, sem inventar o conteúdo ausente.

## 4 Motor init novo

O `init` recebe o pedido original e, quando houver código existente no escopo aprovado, evidencia o que já existe. Seu produto é uma definição suficiente do que construir; não um plano técnico completo nem um catálogo universal de perguntas.

**Não há entrevista obrigatória nem quantidade mínima de perguntas ou rodadas. Perguntar por perguntar é expressamente proibido.** Quando o pedido é suficiente, o motor publica a definição e segue. Não cria uma sessão dedicada a fabricar perguntas para cumprir um rito. A análise necessária do pedido pode apontar zero lacunas.

Sequência:

1. Extrair fatos e restrições do pedido, com referência aos trechos originais. Distinguir objetivo, interface, plataformas alvo e ambiente disponível. Uma aplicação pode combinar interfaces, por exemplo TUI com API; não forçar escolha única nem assumir web quando houver dúvida.
2. Identificar lacunas que alteram o resultado observável, dados, integração ou viabilidade. Cada lacuna registra sua consequência. Não exigir banco, framework, identidade visual ou servidor quando o pedido não os implica.
3. Eliminar perguntas já respondidas no pedido, decisões vigentes ou evidências do repositório. Persistir imediatamente cada resposta recebida; uma interrupção não faz o usuário repeti-la.
4. Selecionar perguntas pertinentes às capacidades do produto. O modelo pode propor perguntas abertas sobre o domínio; o motor confere sua relação com uma lacuna e impede introduzir uma capacidade excluída.
5. Resolver a resposta diretamente quando inequívoca; usar interpretação do modelo somente para texto que precise dela. Nova resposta substitui decisão anterior por identidade; o contexto não carrega duas autoridades conflitantes.
6. Fechar a definição quando não houver ambiguidade material que impeça o próximo trabalho. Detalhe técnico resolvível pela engenharia não vira entrevista de produto.

| Interface do produto | Lacunas pertinentes quando existirem |
|---|---|
| Web | Navegação, dispositivos, autenticação, acessibilidade e operação no navegador |
| Desktop | Sistemas alvo, janelas, integração nativa, arquivos, operação offline e distribuição |
| TUI | Teclas, foco, navegação, tamanho de terminal, cores/acessibilidade, saída e persistência |
| CLI | Comandos, argumentos, stdout/stderr, códigos de saída e uso em scripts |
| Outras interfaces | Capacidades explícitas de entrada, execução e resultado; escopo da primeira entrega a confirmar |

A tabela orienta a pertinência; não vira questionário obrigatório. Layout e aparência podem ser relevantes em TUI, mas precisam usar conceitos de terminal. A proibição é converter o pedido em web por falta de representação de modalidade.

Antes de apresentar uma pergunta, o motor confere quatro condições: existe informação ausente ou contraditória; ela não está resolvida nas fontes/decisões vigentes; a resposta altera comportamento, requisito ou viabilidade concreta; e o assunto é aplicável às capacidades do produto. Falhando uma dessas condições, a pergunta não vai ao usuário. Bibliotecas CSS como Bootstrap não são oferecidas para uma TUI sem interface web. Em um produto misto, a pergunta deve identificar a interface web à qual se refere.

Sem resposta a uma dúvida material, o motor mantém a pergunta pendente e continua o trabalho que não depende dela. Não transforma timeout em autorização. Se toda atividade restante depender dessa decisão, mantém a execução aguardando resposta, com o estado preservado. Pergunta pendente não é falha crítica nem autorização para encerrar.

## 5 Motor plan novo

O `plan` organiza o desenvolvimento. Ele começa pela viabilidade e pelas dependências e só depois estrutura a implementação.

Entrevistas no `plan` também são bem vindas quando o detalhamento revela uma lacuna real. Passam pelas mesmas condições de pertinência do `init`, recebem identidade própria e atualizam apenas as decisões e tarefas afetadas. Descobrir a lacuna não obriga reiniciar a entrevista inicial nem encerrar o planejamento. Decisão técnica que o motor pode resolver respeitando o pedido é trabalho de engenharia; dúvida cuja resposta muda o produto deve ser esclarecida. Nenhum dos dois módulos pergunta apenas porque possui uma rotina de entrevista.

**Primeira saída: árvore de dependências técnicas executável.** Cada item informa tipo, consumidor, alvo/host compatível, versão ou restrição necessária, dependências anteriores, forma de detectar instalação, ação de preparação e critério suficiente de prontidão. A árvore inclui runtime do produto, SDK/compilador, gerenciador de pacotes, bibliotecas, serviços, bancos e ferramentas de validação realmente necessárias. O runtime do harness não determina a versão do runtime do aplicativo.

O grafo registra, por exemplo, `SDK compatível → gerenciador disponível → dependências do produto → aplicação compilável`, com ramos de serviços e ferramentas apenas quando exigidos. Playwright só pode surgir por necessidade de uma capacidade de navegador. Uma TUI não ganha Chromium por possuir um fluxo de uso.

**Segunda saída: etapas de desenvolvimento e tarefas pequenas.** Cada etapa agrupa uma capacidade que faça sentido para o produto; cada tarefa implementa uma unidade executável dessa capacidade. Para cada tarefa, o plano registra:

- Requisitos e trechos originais que ela atende, com resultado observável.
- Contratos que consome e produz: entradas, saídas, formatos e comportamentos que outro fragmento precisa conhecer.
- Tarefas e dependências técnicas anteriores, incluindo serviços e ambiente.
- Arquivos ou áreas relevantes e conflitos de escrita conhecidos.
- A menor verificação suficiente, considerando risco e requisitos explícitos do usuário.
- Contexto necessário para editor e auditor, com referências que possam ser consultadas sob demanda.

O motor verifica IDs, dependências inexistentes e ciclos com algoritmos sobre o grafo. Uma disputa de arquivo ou ordem entre tarefas gera reorganização local, serialização ou tarefa de integração. Não se paga uma reescrita de plano inteiro apenas porque duas tarefas referenciam o mesmo manifesto.

Contratos entre componentes são definidos antes da implementação que os consome. Nenhum fragmento precisa adivinhar o que o vizinho escreverá. Comportamentos que atravessam componentes têm uma tarefa de integração e responsáveis explícitos.

O plano cobre o pedido inteiro, mas nenhum agente recebe o plano inteiro por padrão. Necessidades descobertas posteriormente geram uma revisão localizada do grafo e dos consumidores afetados. A árvore inicial não é licença para omitir dependências conhecidas, nem uma promessa irreal de que nenhuma biblioteca adicional será descoberta.

Não haverá quotas universais de tasks ou critérios. Se uma tarefa exceder a capacidade/contexto disponível, será decomposta por responsabilidade e contrato, com continuidade das dependências. Juntar dez condições em uma frase para passar em uma contagem não reduz o trabalho.

## 6 Montagem de contexto para modelos econômicos

Cada chamada recebe um pacote autossuficiente pequeno: objetivo atual, requisitos pertinentes, restrições aplicáveis, contratos consumidos, trechos de código necessários e resultado esperado. Reparo acrescenta somente o incidente e a evidência necessária. O mesmo princípio vale para planejador e auditor.

O montador de contexto:

1. Seleciona conteúdo por IDs e dependências, preservando trechos originais relevantes e proveniência.
2. Reserva espaço para resposta e ferramentas antes do despacho; usa capacidade conhecida ou estimativa conservadora quando o transporte não mede tokens.
3. Reduz material irrelevante e histórico redundante. Resumo não substitui uma regra de negócio pela interpretação livre de outro agente.
4. Se ainda não couber, divide a unidade e sua revisão. Não aumenta o próprio teto para acomodar o contexto fixo inteiro.
5. Permite pedir um contrato, arquivo ou requisito adicional por referência, sem descarregar todo o repositório.

Resultado aprovado é publicado como contrato/artefato versionado e passa ao consumidor correspondente. Histórico integral de chat, documentação global e todos os defeitos anteriores não viajam com cada fragmento. Contextos de dependentes são invalidados pelo que mudou, não por qualquer alteração de prosa no plano.

Não haverá prova paga de aptidão obrigatória antes de cada execução. Capacidade conhecida ajuda a dimensionar trabalho; dificuldade constatada provoca simplificação da tarefa, recuperação e mudança de estratégia. O motor reduz exigências acidentais, sem prometer capacidade idêntica de raciocínio a todo modelo existente.

## 7 Motor build novo

O `build` consome o grafo e executa trabalho até produzir a aplicação pedida. Seu ciclo é `preparar dependências necessárias → editar fragmento → conferir resultado suficiente → corrigir pendência real → integrar → disponibilizar ao dependente`.

O executor pertence ao harness. Leitura de arquivos, aplicação de patch, comando, processo persistente e terminal interativo são capacidades comuns, com adaptações novas para os transportes. API de modelo não será impedida de construir apenas porque não é uma CLI externa; o harness fornece ferramentas quando o modelo/protocolo as suportar. Transportes com execução própria precisam informar efeitos e resultados de modo observável.

Ambiente:

- Preparar pré-requisitos antes de chamar a tarefa que os consome. Verificar o estado real depois da ação; não concluir por nome ou código de saída isolado.
- Usar receitas por ecossistema/host/alvo e manifesto do produto. Não impor npm a projetos de outras stacks nem ignorar o gerenciador escolhido no plano.
- Criar ambiente isolado/local sempre que viável; a autorização para instalação no sistema é configurada uma vez, conforme decisão pendente. Não criar nova pergunta para cada dependência já autorizada.
- Resolver lockfile ausente/incompatível, cache, runtime e serviço sem pedir ao editor que altere comportamento do produto para satisfazer uma falha do instalador.
- Preparação também funciona em execução sem TTY. Interface de pergunta não decide se a ação autorizada pode existir.

Editor e auditor não são uma comissão. Existem duas responsabilidades: produzir a mudança e conferir se ela funciona. Revisão semântica incide sobre comportamento/risco pertinente, com o mesmo fragmento e suas integrações necessárias. Não existe cadeia fixa de escritor, auditor, árbitro, auditor do árbitro e ensaio de todos os documentos.

Código existente do usuário é protegido. Preparação e agentes trabalham sobre um estado identificado; integração preserva alterações alheias, resolve conflitos locais e só invalida consumidores afetados. Falta de commit ou árvore modificada não é ordem para descartar trabalho nem razão automática para encerrar. A implementação nova deve proporcionar isolamento e checkpoints proporcionais, sem transportar o mecanismo antigo de worktrees e certificados.

## 8 Auditor e validador como parceiros

Um achado útil responde: qual comportamento era esperado, o que foi observado, onde está a causa provável, que evidência sustenta o problema e qual é o menor próximo reparo. O editor recebe esse achado com o contexto do requisito, sem precisar redescobrir a investigação.

Essas informações orientam o diagnóstico, não criam uma gramática rígida de aprovação. Um campo ausente não reprova código nem encerra a tarefa: o motor aproveita a evidência suficiente, busca complemento quando necessário e continua o trabalho possível. Não recriar um gate de quantidade de linhas ou campos de veredito.

O auditor pode sugerir patch ou procedimento, apontar regressão, pedir execução pertinente ou identificar um contrato incompatível. O motor encaminha o reparo ao dono correto: produto ao editor, ambiente ao preparador, plano ao planejador, ferramenta ao executor. Falha na ferramenta do auditor não vira defeito do aplicativo.

### Autoridade do pedido sobre os instrumentos

Há uma ordem única: intenção e restrições explícitas do usuário → decisões vigentes de produto → contratos derivados do plano → convenções das ferramentas. Uma ferramenta, auditor ou comando padrão não pode inverter essa ordem. Uma revisão do plan não altera uma proibição do pedido para fazer uma checagem passar.

O mecanismo opera sobre dados e efeitos, não pela frase “respeite a documentação” em um prompt:

1. O init registra restrições vinculadas à origem, como `interface=CLI`, `servidorHTTP=proibido` e modo de invocação com argumentos. Não classifica restrição como preferência descartável.
2. O plan deriva as capacidades necessárias e receitas de execução compatíveis. A receita de uma CLI usa um comando e argumentos válidos; não herda a suposição web de processo permanente e porta HTTP.
3. Antes de despachar preparação, validação ou reparo, o motor confere se suas capacidades e efeitos requeridos cabem no contrato. Incompatibilidade abre incidente do instrumento e escolhe outra receita; não encerra a execução nem manda acrescentar função proibida.
4. Um pedido de reparo precisa identificar o requisito vigente violado pelo produto. Se a única violação é do pressuposto particular do validador, corrige-se o validador. Sugestão de agente não recebe autoridade para expandir escopo.
5. Após a mudança, efeitos relevantes são conferidos contra o requisito original: argumentos/saída, arquivos modificados, processos remanescentes e serviços/portas quando pertinentes. Inspeção do diff e execução focada complementam metadados de ferramentas; o motor não presume que rotular uma ação prove todos os seus efeitos.
6. Se a recuperação introduzir efeito proibido, desfaz-se somente a alteração responsável em área protegida, corrige-se o diagnóstico e retoma-se com o requisito intacto. O trabalho correto anterior é preservado.

O cenário CLI sem servidor é uma regressão funcional essencial: erro da receita HTTP deve ser recuperado pela escolha do executor CLI, e a aplicação entregue continua sem serviço HTTP. O cenário não se limita a procurar uma frase no prompt nem constitui nova auditoria obrigatória sobre toda ação trivial. O mesmo mecanismo vale para TUI recebendo dependência de navegador, desktop recebendo obrigação de rota web e runtime exigido pelo usuário sendo trocado pelo que convém ao host.

**Detectar a invenção aciona correção automática e continuidade, nunca uma transferência de diagnóstico ao usuário.** Não lhe pedir para editar documento de controle, escolher entre agentes, trocar instalador, repetir respostas ou reiniciar os três módulos para resolver erro interno. O motor corrige a origem, desfaz somente a mudança indevida e retoma do checkpoint útil. Só pergunta quando faltar decisão real de produto. Registra retrabalho induzido pelo próprio harness para orientar a redução de desperdício, sem transformar essa métrica em novo gate ou prometer que a cobrança externa de um provedor pode ser cancelada pelo motor.

Preferência por biblioteca/comando, estilo pessoal, número de testes e forma de um documento não constituem defeito do produto. Sugestões sem evidência material não reabrem tarefa nem consomem ciclos de correção obrigatórios. Requisito explícito do usuário continua válido, inclusive se ele pediu testes.

Se auditor e editor discordarem, a próxima ação procura resolver a divergência por evidência focada ou esclarecimento do contrato. Não há votação de agentes, competição para reprovar, exigência de o auditor custar mais que o editor ou concessão de aprovação apenas para encerrar discussão. Só uma ambiguidade real da intenção precisa do usuário.

Após reparo, confere-se o comportamento afetado e eventuais regressões pertinentes. Não se exige que o auditor repita uma lista de tudo já aprovado apenas para obedecer à sintaxe de veredito.

## 9 Verificações necessárias e somente elas

O selecionador faz parte do motor. Recebe mudança, requisitos, contratos afetados, risco e evidências existentes; produz operações de verificação concretas. Uma mudança não cria automaticamente uma suíte nova, nem autoriza excluir proteção de um risco real.

| Situação | Verificação proporcional |
|---|---|
| Alteração simples e reversível | Compilação/tipagem, inspeção ou uma execução focada, conforme o que possa falhar |
| Regra de negócio relevante | Caso que demonstra a regra e condições de falha que tenham impacto concreto |
| Defeito encontrado | Reprodução focada; regressão persistente quando seu valor justificar manutenção |
| Integração entre componentes ou persistência | Exercitar o contrato afetado com resultado real |
| Entrega executável | Construir/instalar quando necessário, iniciar adequadamente e percorrer o comportamento essencial na interface correta |
| Pedido explícito de testes | Atender o requisito do usuário sem multiplicar casos por quotas do harness |

Não haverá número mínimo/máximo de testes, par positivo/negativo por todo critério, teste que exige reduzir testes ou censura lexical de requisitos de teste no plano. Metas de economia são observação de custo e resultado, não gates que derrubam a construção.

Uma evidência registra comando/ação, entradas relevantes, toolchain/ambiente, resultado e escopo efetivamente conferido. Execução já comprovada com as mesmas entradas não é repetida por outro papel. Mudança em código, dependência, contrato ou ambiente invalida somente o que depender dela. Quando não for possível determinar impacto com confiança, ampliar a checagem afetada tem motivo técnico; não fingir que “qualquer arquivo mudou” sempre exige tudo.

O agente informar “rodei os testes” não basta para o motor deduplicar: é preciso resultado observável ligado ao conteúdo conferido. Para CLIs que escondem execução interna, registrar a limitação e evitar alegar uma garantia inexistente. Suíte verde não demonstra requisito que não foi exercitado; procurar essa evidência não significa desconfiar indiscriminadamente de todo teste.

## 10 Execução adequada a cada formato

| Formato | Mecanismo de execução e comprovação |
|---|---|
| Web | Navegador para interação que realmente depende dele; domínio/API por execução direta quando suficiente |
| Desktop Linux Windows macOS | Toolchain e empacotamento do alvo; execução e interação nativa no sistema compatível; processo vivo sozinho não comprova fluxos |
| TUI | Pseudoterminal com teclas, foco/estado e dimensões; redimensionamento quando requisito; encerramento e restauração de terminal |
| CLI | Argumentos válidos, entrada/saída, stderr, exit code e efeitos persistidos; sem obrigar execução bem sucedida sem argumento |
| Serviço ou API quando incluído | Inicialização, prontidão real e contrato de requisição/resposta relevante |

Host do harness, host de compilação, sistema alvo e ambiente de verificação são campos distintos. Não trocar Windows/macOS por uma stack que só seja mais fácil de validar no Linux. A decisão sobre disponibilidade de máquinas/CI para cada alvo continua pendente.

Falta de executor nativo provoca busca de alternativa autorizada e avanço das tarefas independentes. Uma plataforma ainda não verificada não é anunciada como comprovada. Se não existir qualquer meio de cumprir um requisito obrigatório restante, a execução conserva o trabalho e explica o impedimento concreto.

## 11 Recuperação como lei de execução

Uma operação malsucedida abre um incidente; não encerra o desenvolvimento. O motor identifica a causa e tenta uma ação diferente que possa produzir avanço. Todo o trabalho confirmado permanece disponível. O mecanismo é o mesmo nos três módulos.

O encerramento crítico passa por uma única decisão central de execução. Módulos, ferramentas e agentes devolvem resultados/incidentes; não possuem saídas locais que equivalham a encerrar o processo por conveniência. O motor verifica se há recuperação aplicável, operação em andamento, rota alternativa ou trabalho independente antes de admitir impossibilidade. Um modelo escrever “crítico” ou “não consegui” não é prova suficiente.

| Incidente | Próximas ações possíveis no motor |
|---|---|
| Resposta em formato inadequado | Normalizar estrutura inequívoca, aproveitar campos válidos, pedir apenas a parte ausente |
| Contexto ou saída excedidos | Reduzir lote, dividir tarefa/revisão, continuar trecho incompleto com referência ao estado |
| Rede capacidade rate limit timeout | Preservar efeitos, reconciliar resultado incerto, reagendar com espera adequada, usar rota autorizada alternativa |
| Dependência ou runtime ausente | Preparar ambiente, ajustar sequência do grafo, conferir prontidão e voltar à tarefa |
| Comando de instalação incompatível | Examinar manifesto/lockfile, executar alternativa válida e manter a escolha técnica coerente |
| Defeito de código | Orientar reparo pequeno, conferir efeito, investigar causa quando o primeiro diagnóstico não resolve |
| Fragmento difícil demais | Decompor por responsabilidade, reduzir contexto, explicitar contrato e retomar com progresso preservado |
| Erro no plano | Corrigir nó/contrato na origem, atualizar dependentes afetados e voltar automaticamente ao build |
| Conflito de integração | Reconciliar alterações em ambiente isolado, serializar quem disputa recursos e revalidar integração afetada |
| Ferramenta de verificação falhou | Corrigir ferramenta/ambiente ou usar prova equivalente adequada; não mandar mudar produto para satisfazer ferramenta errada |
| UI log ou sincronização MCP auxiliar falhou | Usar saída textual/registro local; sincronizar depois; desenvolvimento continua |
| MCP indispensável ficou indisponível | Recuperar acesso ou capacidade equivalente, preservar material disponível e reagendar consumidores enquanto avança o trabalho independente |
| Estado auxiliar corrompido | Recuperar último estado durável e reconciliar arquivos/efeitos antes de reexecutar |

**Exemplo obrigatório de funcionamento:** o plano escolhe npm, há `package.json` válido, `npm ci` falha por ausência de lockfile. O motor identifica a precondição ausente; se a criação do lockfile é compatível com o pedido, usa instalação que o gere, registra as dependências resolvidas, confere prontidão e retoma. Se o lockfile existente exige outra correção, resolve a incompatibilidade respeitando as restrições do produto. Preferir `npm install` ou `npm ci` não gera disputa entre agentes nem parada.

Não existe `maxCycles=3` como prova de impossibilidade. Contadores podem ajudar a perceber repetição, mas provocam mudança de estratégia, tamanho da tarefa ou diagnóstico; não encerram por si. Também não se repete eternamente uma operação idêntica com as mesmas entradas e sem nova evidência. Ao esgotar uma estratégia, amplia-se a investigação ou usa-se outra alternativa aplicável.

Troca de modelo/provedor usa recursos autorizados. A definição financeira pendente determina quais recursos estão disponíveis, sem inventar teto de tentativas como substituto de recuperação. Falta de telemetria de custo não é falha crítica e não interrompe o trabalho. A ferramenta registra custos conhecidos e estimativas separadamente, sem apresentar ausente como zero.

Resultado incerto de comando ou chamada interrompida exige reconciliação antes de repetir: verificar o que foi efetivamente escrito/instalado/commitado evita duplicar ações e gastos.

**Parada somente por impossibilidade concreta e comprovada de continuação correta.** Exemplos: dados indispensáveis foram perdidos definitivamente sem qualquer fonte recuperável; todas as rotas aplicáveis são comprovadamente inviáveis, sem possibilidade de recuperação ou alternativa; ou um requisito obrigatório foi demonstrado impossível com os recursos disponíveis após investigar as alternativas. Cada caso exige evidências do impedimento e das alternativas aplicáveis tentadas ou demonstradas inviáveis. Não se exige tentar ações destrutivas/incompatíveis para “esgotar” recursos. Indisponibilidade temporária, rate limit, pergunta ainda sem resposta ou autorização adicional pendente não demonstram impossibilidade definitiva: mantêm a execução em espera/reagendamento, sem encerrá-la.

Esperar recuperação de serviço ou resposta é estado explícito de espera, com checkpoint; não é resultado de produto defeituoso. Cancelamento ou pausa pedidos pelo usuário são respeitados e preservam progresso. A rotina não reinicia contra a vontade dele.

Uma parada crítica registra em linguagem simples: o que é impossível fazer agora, por quê, o que foi tentado, o que ficou salvo e qual mudança externa permitirá retomar. A retomada volta à pendência, sem refazer init/plan/build inteiro.

O fato de o estado estar salvo não integra a justificativa da parada. A justificativa precisa demonstrar ausência real de possibilidade de continuação; “há checkpoint, rode novamente” é explicitamente insuficiente. Nenhum limite local de protocolo, prazo de chamada ou fim de tentativa consegue contornar essa decisão central.

## 12 Ordem de execução da reconstrução

Cada etapa entrega funcionamento verificável do motor novo. Não haverá uma longa cadeia de documentos e aprovações internas antes de produzir uma aplicação. A ordem abaixo é dependência de implementação, não autorização para manter peças dos motores antigos.

| Etapa | Trabalho novo | Demonstração de saída |
|---|---|---|
| 1 Fundamento de execução | Dados mínimos, estado transacional, executor de ferramentas, incidentes e retomada; UI desacoplada | Executar uma tarefa pequena, interromper, reconciliar e retomar sem perda nem duplicação |
| 2 Init | Definição do pedido, modalidade/alvo, lacunas por impacto, decisões vigentes e persistência imediata | Pedido TUI permanece TUI; pergunta necessária é respondida uma vez; exclusões explícitas não viram decisões inventadas |
| 3 Plan | Árvore de ambiente primeiro, contratos, DAG de tarefas e montagem de contexto | Cada tarefa tem dependências e pacote pequeno suficiente; detectar ciclo e reorganizar localmente |
| 4 Build vertical | Preparação de ambiente, edição, auditor parceiro, autoridade do pedido sobre instrumentos, comprovação, integração e recuperação entre etapas | Construir uma aplicação pequena do pedido à execução real; recuperar dependência, reparar defeito e corrigir premissa do plan com retorno automático ao build |
| 5 Modalidades | PTY TUI, web e execução nativa por alvo sobre a mesma cooperação e recuperação | Mesma rotina funciona nos formatos obrigatórios; não cria navegador/servidor em produto de terminal |
| 6 Integração e concorrência | Mesmo DAG com múltiplos agentes, conflitos de arquivo/recursos e merge por impacto | Conflito recuperado preserva trabalho; serial e paralelo entregam o mesmo comportamento |
| 7 Corte completo | Entradas públicas novas, remoção dos motores/contratos/testes antigos e documentação operacional final | Nenhum caminho novo chama lógica antiga; instalação limpa usa exclusivamente os três motores novos |

O primeiro percurso completo deve surgir na etapa 4; plataformas adicionais e concorrência expandem o mesmo motor. A entrega só termina depois de contemplar todos os formatos obrigatórios e decisões de escopo acordadas. Etapas auxiliares não podem virar motivo para adiar indefinidamente a construção real.

Não é responsável atribuir prazo ou economia percentual antes de fechar os alvos, recursos e um primeiro percurso novo. O avanço será acompanhado por aplicações entregues, causas resolvidas e trabalho que deixou de ser refeito, com tempo e uso reportados quando disponíveis.

## 13 Verificação da reconstrução

Criar poucos cenários novos de alto valor, combinando comportamentos que compartilham risco. Não portar a suíte antiga nem fixar quantidade final de testes como objetivo.

- Uma TUI recebe entrada real em pseudoterminal, altera estado e encerra; não instala ferramenta web sem necessidade.
- Uma aplicação web executa um fluxo essencial e persiste o resultado quando exigido.
- Cada alvo desktop obrigatório compila/empacota e tem comportamento essencial executado em ambiente compatível; limitações ficam explícitas quando recurso ainda não existe.
- Dependência ausente e falha recuperável de instalação são resolvidas antes do consumidor, incluindo o caso `npm ci`/lockfile.
- Defeito material chega ao editor com diagnóstico suficiente, é corrigido e sua comprovação é refeita sem revalidar tudo indiscriminadamente.
- Falhas de transporte, saída parcial, estado interrompido, UI e integração são recuperadas sem perder respostas ou código confirmado.
- Pedido maior que um pacote de contexto se conclui por fragmentos, inclusive com configuração econômica, sem entregar contexto global a cada papel.

O objetivo desses cenários é demonstrar aplicação correta e continuidade. Não haverá cenário para “provar que o número de testes diminuiu”. Medir uso e tempo pode orientar a engenharia, sem interromper construção porque a contagem não agradou.

## 14 Decisões ainda necessárias

O esclarecimento dos 99% já foi incorporado e dispensa nova discussão estatística. As perguntas abaixo afetam autorização ou escopo de recursos, não a regra de continuidade:

1. **Escopo da base:** esta auditoria integral cobre a implementação própria de `capivara/`. Incluir também leitura integral dos projetos de referência em `base_harness/`, com quase 20 mil arquivos, altera materialmente o escopo; não foi assumido.
2. **Recursos financeiros:** quais modelos/provedores podem ser usados automaticamente na recuperação e qual autorização de gasto os acompanha? Não se assume permissão para trocar para um recurso mais caro sem regra definida.
3. **Instalação no sistema:** o build pode instalar runtimes/ferramentas/serviços no host quando o isolamento local não bastar? Qual autorização vale para privilégios e instalações externas ao projeto?
4. **Alvos e execução:** existem máquinas/CI Windows/macOS disponíveis? A entrega precisa ser executada em todos os alvos antes da conclusão? O próprio harness também precisa rodar nativamente nesses sistemas, além de gerar aplicativos para eles?
5. **Escopo funcional:** a primeira reconstrução atende criação e evolução de projetos existentes? Além de web, desktop e TUI, quais formatos de “etc.” são obrigatórios? `change`, `survey`, `prompt-engineer`, MCP e aparência da CLI/TUI entram na reconstrução integral de superfície ou somente na conexão com os motores novos?

Nenhuma dessas pendências autoriza reutilizar os motores atuais. O desenho central e sua regra de recuperação permanecem os mesmos nas alternativas.


## 15 Aplicação à release autorizada 0.9.0_RC1

Depois da autorização para executar e instalar durante a noite, as pendências de recursos foram tratadas com os limites disponíveis, sem adiar a implementação para uma nova entrevista:

- A base reconstruída é o produto ativo em capivara; projetos externos de referência não foram incorporados.
- Pilotos usaram o Codex já disponível com o modelo configurado, sem trocar automaticamente para outro recurso mais caro. Configuração atualizada explicitamente pode ser incorporada durante recuperação.
- Preparação local é o padrão. Instalação no sistema exige a opção explícita `--system-install`; instalar a própria ferramenta no prefixo do usuário foi autorizado.
- Não havia runner Windows/macOS identificado nesta execução. A RC conserva alvo e provas pendentes; não substitui o requisito nativo por uma aprovação Linux.
- Foram reconstruídos os três motores, runtime e superfície essencial de comandos. MCP, comandos auxiliares e interface administrativa antiga não foram transplantados. O agendador desta RC é sequencial, com dependências explícitas; a proposta de múltiplos construtores em paralelo não é anunciada como implementada.

A implementação e seus limites reais estão em [RECONSTRUCAO-0.9.0_RC1.md](RECONSTRUCAO-0.9.0_RC1.md). Pilotos CLI/TUI e verificações locais não equivalem a comprovação universal de todos os formatos, provedores ou sistemas operacionais. Este plano registra também a direção completa; a RC não transforma recursos ainda indisponíveis em funcionalidades supostamente verificadas.
