# RC2: ambiente operacional e identidade das provas

A linha anterior ignorava globs em `sourceFiles`, descartava arquivos gerados mesmo quando declarados e tratava um conjunto vazio de inputs como todo o projeto. A lista de inputs somava todos os manifests de todas as stacks e todos os arquivos de tarefas predecessoras. Isso permitia simultaneamente provas obsoletas e invalidações causadas por documentação ou arquivos sem relação com a prova. Um exit code zero também aprovava afirmações funcionais que ninguém havia observado.

O ambiente anterior registrava somente `ready`, sem entregar uma invocação ao consumidor. Uma ferramenta instalada localmente podia continuar invisível à mesma sonda. A identidade operacional agora separa capability, tipo, provider, comando concreto, aliases, PATH, variáveis e inputs da preparação. CLI, biblioteca, driver, runtime, SDK e serviço têm identidades distintas. Uma capacidade de banco sem essa distinção é ambígua e recusada; não se decide instalar outra stack pelo nome da dependência.

## APIs para o executor

- `prepareEnvironmentNode` retorna `operational`, `fingerprint` e `cache`, além do resultado e da evidência. A sonda executável é o critério de prontidão. `capabilitySatisfied` exige capability, tipo e prontidão compatíveis.
- `applyOperationalEnvironment` entrega ao comando os caminhos, variáveis e a invocação concreta. `relocateOperationalEnvironment` transporta os caminhos para uma cópia privada sem mudar a revisão portátil da capacidade.
- `environmentFingerprint` considera receita, identidade, inputs declarados, conteúdo e permissões do executável. `previous` evita repetir preparação idêntica sem efeito. `revalidate: true` permite nova sonda depois de uma falha concreta do consumidor; mesmo assim não repete uma instalação ineficaz sem mudança relevante. Serviços, bibliotecas e drivers revalidam a sonda por dependerem de estado dinâmico.
- `prepareProjectDependencies` e `projectDependenciesFingerprint` reaproveitam a preparação enquanto manifests e evidências locais da instalação permanecem iguais. Uma configuração Python contendo somente ferramentas não se torna um pacote instalável. A virtualenv e os executáveis locais são entregues ao consumidor.
- `taskInputs` usa as leituras declaradas da unidade, ou seus arquivos quando faltam leituras explícitas. `checkInputHash` usa o conjunto específico da prova, imports locais, manifests pertinentes, requisitos, contratos, restrições e identidades operacionais consumidas. As instalações têm cache e observações por família de manifests, e `verificationOperationalRevision` inclui somente os providers, paths, variáveis e inventários pertinentes ao consumidor. Cargo não força a reinstalação ou invalidação de uma prova JavaScript. `projectDependencyScope` e `selectOperationalEnvironment` permitem ao coordenador persistir registros separados de preparação e evitar que uma família sobrescreva outra.
- `sourceFiles(undefined)` continua descobrindo fontes para snapshots; `sourceFiles([])` e `inputHash([])` significam nenhum input. Diretórios, globs e criações/remoções são representados. Inputs gerados explícitos são incluídos. Os diretórios internos de estado e instrumentação do harness ficam excluídos; um provider explicitamente declarado em outro diretório continua sendo uma dependência válida.
- `runVerification` registra nível (`syntax`, `build` ou `behavior`), inputs e revisão do ambiente. Uma asserção funcional não observada não passa pelo exit code. Um resultado observado contrário a uma asserção concreta permanece defeito de produto. Níveis de sintaxe usam operações reais conhecidas e argv, sem adivinhar pela palavra “build” dentro do código ou por um flag `--check` de uma aplicação arbitrária. Outputs de um produtor são excluídos de seus inputs implícitos; consumidores que declaram o artefato continuam sendo invalidados quando ele muda. Compilação e sintaxe continuam sendo provas diferentes. O classificador de revisão é compartilhado: EROFS isolado em um log do produto não basta para culpar o instrumento; a restrição precisa vir do contexto ou da política realmente aplicada pelo runtime.

## Evidência reproduzível

Execute, após instalar as dependências do repositório:

```sh
node docs/rc2-evidence/reproduce-environment.mjs
```

O comando extrai somente o código do commit `77a1178` em uma pasta temporária, executa sete regressões contra essa base e executa os cenários atuais. Não altera o checkout de trabalho, não usa rede e não invoca modelos pagos. Os sete cenários falham na base. Os quatorze cenários atuais passam, cobrindo também retomada de uma preparação ineficaz, recuperação local reconhecida pelo consumidor, identidade CLI/driver, revisão portátil, remoção de provider e imports relevantes. Os resultados estão em `docs/rc2-evidence/environment-before.json` e `environment-after.json`; a fixture da base é preservada junto dos resultados.

## Limites explícitos

Imports estaticamente resolvíveis ajudam quando não existe um conjunto de leitura completo. Imports dinâmicos, geradores externos e ferramentas arbitrárias precisam declarar seus inputs; não existe rastreamento universal de syscalls em todas as plataformas. Diretórios externos ou cíclicos por symlink são recusados. A descoberta de executáveis locais tem busca limitada e a configuração `provides.command` permite uma localização explícita fora dessa busca. Os cenários foram executados no Linux; suporte de nomes executáveis Windows considera PATHEXT, sem afirmar uma validação nativa de Windows ou macOS.

## Guarda do ciclo de ferramentas de APIs

`runtime/api-progress.ts` observa mudanças reais nos arquivos (incluindo permissões), efeitos preservados e fatos de ferramentas ainda não observados. Alternar leituras já conhecidas, reenviar o mesmo conteúdo, variar IDs ou compactar transcritos não reinicia a contagem de ausência de progresso. Três ações consecutivas sem fatos ou efeitos novos encerram essa chamada com resultado parcial e causa explícita de instrumento; isso nunca aprova a unidade. O checkpoint da guarda impede nova inferência para a mesma operação e o mesmo estado depois dessa suspensão. Uma mudança real libera a operação. O coordenador continua responsável por escolher uma estratégia executável diferente.

Uma capacidade complementar configurável `AgentConfig.maxToolRounds` tem default de 64 rodadas; não substitui a detecção de ações idênticas. O resultado preserva arquivos, comandos, uso reportado e diagnósticos de rodadas, ações, observações, mutações e motivo da suspensão. Leituras relevantes de arquivos distintos e mudanças reais continuam autorizadas. Checkpoints e diagnósticos armazenam hashes em vez de argumentos e resultados contendo credenciais. Falha ao persistir é declarada nos diagnósticos, sem apagar o trabalho.

O mesmo reprodutor executa dois casos que falham na API anterior e quatro que passam na atual: alternância de leituras com IDs novos e contexto compactado, escrita idêntica preservando seu efeito, retomada da suspensão sem nova inferência, novas leituras legítimas e limite configurado. Não há inferência paga: o protocolo HTTP é simulado, e as ferramentas de arquivos são reais.

Uma virtualenv Python é uma derivação do runtime selecionado. A invocação da virtualenv é preservada sem trocar a identidade do provider; a derivação é validada pelo binário base. Uma virtualenv de outro runtime produz erro explícito de ambiente em vez de aprovação. O cenário Linux executa Python real, cria uma virtualenv sem pip/rede e verifica `sys.prefix`, além de reuso e ordem de merge.
