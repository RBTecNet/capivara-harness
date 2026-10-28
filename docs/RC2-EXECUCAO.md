# Controle de execução — 0.9.0-rc2

Este documento registra a primeira entrega RC2. As correções posteriores, a validação atual e o desfecho da execução real estão em [Recuperação estrutural do motor RC2](RC2-RECUPERACAO-RUNTIME.md). Os artefatos originalmente vinculados abaixo permanecem como evidência histórica.

O executor serial anterior foi substituído. Esta entrega trata planejamento, execução, revisão, recuperação, ambientes, provas e retomada como partes do mesmo problema de controle. Nenhuma aprovação é produzida por contagem de tentativas ou por ausência de achados depois de um filtro textual.

## Causas e invariantes

O código da base `77a1178` selecionava `ready[0]`, aguardava a tarefa inteira e voltava a examinar todas as assinaturas. Arquivos compartilhados reabriam tarefas já aprovadas; o coordenador chamava o build de novo depois de um sleep. Pareceres eram filtrados antes da decisão, instrumentos e produtos compartilhavam rotas de reparo, e o ambiente não entregava uma invocação concreta ao consumidor. As regressões anteriores estão em `rc2-evidence/`.

As transições agora distinguem preparação, edição, verificação, revisão, integração, conclusão e espera. Uma ação registra entrada, estratégia, motivo, resultado e duração. O resultado de uma ação idêntica pode ser reaproveitado; ele não autoriza outra chamada paga. Falhas repetidas passam por reparo dirigido e diagnóstico independente, com reconciliação do plano quando existe uma alteração executável de escopo. Sem mudança útil, a suspensão informa a causa, os recursos necessários e a identidade da entrada. Esclarecimento não é uma transição de volta ao editor.

Uma tarefa só é publicada depois de suas provas pertinentes e de um parecer atual. Uma receita de sintaxe não comprova interação; um provider instalado não comprova uso da stack pelo produto. Requisitos obrigatórios e aceite final são conferidos pelo coordenador, além da conclusão do modelo. O parecer original, os achados e suas transformações permanecem registrados.

## Concorrência e integração

`--jobs N` configura a capacidade; o padrão é duas unidades. O scheduler executa unidades prontas e independentes, respeitando dependências, escopos de leitura/escrita, contratos com escritor exclusivo, serviços e recursos declarados. Cada editor trabalha em uma cópia privada persistente. Instalações locais e execução de verificações não compartilham arquivos mutáveis por symlink.

A fila FIFO de publicação coordena preparação compartilhada, snapshots e integração. Cada integração contém imagens anteriores e posteriores dos arquivos, incluindo permissões. Todos os caminhos e precondições são verificados antes da primeira escrita. Uma transação interrompida pode terminar sem chamar o editor outra vez; uma versão canônica divergente permanece preservada junto da versão privada. Publicações pendentes impedem que outro snapshot trate um estado parcial como uma nova base íntegra.

Verificações usam área gravável separada da inspeção do revisor. Temporários, caches e bancos criados para comprovar comportamento não se tornam automaticamente arquivos do produto. Artefatos de build explicitamente declarados têm produtor, consumidores e evidência de conteúdo. A integração desses artefatos segue o mesmo controle dos demais arquivos.

## Provas, ambientes e reinício

As provas se vinculam a inputs específicos, imports estaticamente resolvíveis, manifests pertinentes, receitas, requisitos, contratos e identidade operacional consumida. Diretórios, globs, exclusões, criação/remoção de arquivos, arquivos gerados e permissões fazem parte dessa identidade. Documentação sem relação com uma prova não invalida seu comportamento. Mudança relevante provoca revalidação; ela não autoriza reeditar uma implementação correta.

Uma prova de produto sem origem de inputs definida não recebe aprovação reutilizável: o instrumento deve declarar seu conjunto de leitura. Um conjunto explicitamente vazio é distinto de um conjunto desconhecido. No ciclo das APIs, a identidade estável da ação vem do ledger do coordenador; uma operação já suspensa não se repete, e uma estratégia de recuperação distinta e registrada pode executar sem herdar indevidamente a suspensão da anterior.

O scheduler drena o trabalho pronto antes de revalidar consumidores afetados por integrações. Uma alteração somente nos critérios exige um novo parecer, preservando código e provas ainda válidas. A mesma regra vale depois do reinício. O estado inclui ações, respostas, provas, originais dos pareceres, checkpoints privados e transações de integração.

O ambiente separa capacidade, tipo, provider e invocação concreta. CLI, biblioteca, driver, runtime, SDK e serviço não são substitutos por associação nominal. Uma recuperação só disponibiliza a capacidade depois de sua sonda; caminhos, variáveis e comandos chegam ao editor e à verificação. Preparações idênticas sem efeito são detectadas. Uma mudança relevante revalida a prontidão.

O coordenador não contém mais um sleep que repete o build sem novo estado. Pendências externas retornam `waiting`, com saída CLI 2. `--retry-suspended` solicita uma nova sondagem explícita de um recurso externo, preservando trabalho e provas. Alterações reais na configuração, nos inputs ou no ambiente também permitem prosseguir. O ciclo de ferramentas das APIs detecta repetição sem progresso e conserva seu diagnóstico.

## Reprodução e medições

```sh
npm run check
node scripts/validate-rc2.mjs
node docs/rc2-evidence/reproduce-environment.mjs
node docs/rc2-evidence/reproduce-review.mjs
node docs/rc2-evidence/reproduce-conformance.mjs packages/core/dist/index.js
```

O primeiro comando compila, confere tipos e executa regressões de comportamento do motor. O segundo constrói e verifica pequenos produtos Node.js, Python e TUI com arquivos, processos e PTY reais. As respostas dos agentes são determinísticas; não há inferência paga nesses pilotos. O intervalo de trabalho controlado permite demonstrar sobreposição temporal, sem confundir essa medição com velocidade de um modelo real. Um controle serial e uma execução com duas unidades usam a mesma entrega; as dependências estritas Python permanecem serializadas.

O estado e os relatórios registram tempo por etapa, chamadas por papel, concorrência observada, invalidações, motivos de repetição e intervalos das chamadas. `rc2-evidence/pilots.json` contém os produtos temporários e as provas observadas. As regressões anteriores comprovam os defeitos da base, em vez de tratar uma configuração serial do motor novo como se fosse toda a versão antiga.

Os números da execução de 74 minutos foram informados no pedido. Sem seu diretório ou diário original, não são uma medição reproduzida desta entrega, e não se estima economia financeira a partir deles. O caminho foi solicitado durante o trabalho; a correção geral não depende desse projeto.

No piloto controlado Node, três implementações e três revisões são suficientes tanto com capacidade um quanto com capacidade dois; a segunda execução demonstra sobreposição entre as duas unidades independentes, enquanto o consumidor aguarda ambas. Os tempos e intervalos exatos variam por máquina e estão no relatório. O caso com runtime obrigatório também comprova uso real do Node na CLI. A regressão contra a RC1 demonstra conclusão falsa com provider correto instalado e aplicação em outro runtime; na RC2 esse mesmo cenário permanece pendente por falta de conformidade, sem rebaixar o critério.

## Limites da evidência

Os cenários foram executados no Linux. Não se declara interação nativa Windows/macOS a partir deles. Inputs dinâmicos, geradores externos e serviços remotos precisam de contratos e inputs declarados; não existe um rastreador universal de dependências e comportamento para todas as ferramentas. O isolamento por cópia protege a coordenação de arquivos do harness; contenção de comandos arbitrários com caminhos absolutos depende também do sandbox do provedor ou do sistema operacional. Falta de um instrumento adequado permanece pendência, sem aprovação fictícia.

Detalhes complementares: [ambientes e provas](RC2-ENV-PROVAS.md) e [revisão e isolamento](RC2-REVISAO.md).

O resumo da validação integrada, incluindo a identidade do código compilado e os resultados comparativos, está em [validacao-0.9.0-rc2.json](validacao-0.9.0-rc2.json).
