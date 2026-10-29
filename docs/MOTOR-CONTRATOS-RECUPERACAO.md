# Contratos e recuperação do motor

Esta análise pertence ao novo banco de `samba_admin`, com **211 eventos**, 17
chamadas concluídas, 14 requisitos, oito tarefas e seis ambientes. A execução
parou em `waiting/plan` às **23:04:08 UTC**, sem owner, agente ativo ou estado
`execution`. Ela não é a execução antiga que concluiu o aplicativo, nem os
backups anteriores de 32, 110 ou 142 eventos. Os horários deste documento são UTC.

## Onde o motor gastou trabalho

| Operação observada | Chamadas | Tempo dos agentes | Entrada | Cache incluído na entrada | Saída |
| --- | ---: | ---: | ---: | ---: | ---: |
| Descoberta | 1 | 10.348 ms | 18.184 | 11.520 | 1.182 |
| Reparo de metadados do INIT | 2 | 9.948 ms | 36.219 | 27.392 | 258 |
| Árvore de ambiente | 2 | 21.673 ms | 109.437 | 83.712 | 1.271 |
| Fatias de tarefas | 2 | 80.464 ms | 148.069 | 128.384 | 9.174 |
| Reparo de invariantes do plano | 10 | 130.315 ms | 237.896 | 180.864 | 14.022 |

São **252.748 ms de chamadas**, 549.805 tokens de entrada e 25.907 de saída.
Os 431.872 tokens em cache fazem parte da entrada, não são uma parcela extra.
As durações usam os eventos `agent.start` e `agent.result`; não representam todo
o intervalo de parede, que também inclui preparação, persistência e trocas de
etapa. O provider não informou valor financeiro. Não houve chamada de editor,
revisor ou execução de verificações do produto neste banco.

## Causas estruturais

O INIT distinguia a tecnologia pedida de forma insuficiente: o usuário exigiu
TypeScript, mas o campo técnico `kind=runtime`, inferido pelo modelo, passou a
ser tratado como escolha literal do usuário. Um compilador SDK já planejado não
correspondia a esse rótulo. O mesmo problema apareceu com descrições de capacidade
como `file-based database` e `file-based database driver`. Rótulos técnicos
produzidos por agentes viraram contratos mais fortes que a fonte do pedido.

A autoridade agora separa o provedor literal das classificações inferidas. Uma
exigência clara de usar uma CLI continua rejeitando um driver, e um provedor
diferente nunca satisfaz a escolha. Um papel inferido pode ser interpretado pelo
contrato operacional efetivamente oferecido; essa interpretação conserva os
metadados originais e não constitui prova de execução. Contexto legado ambíguo
continua conservador. Não há catálogo de nomes de tecnologias. A mesma proteção
distingue uma ferramenta CLI de um produto CLI escrito em uma linguagem: criar
uma CLI em Python ou Node.js não torna a linguagem uma dependência do tipo CLI.

Outro bloqueio estava na localização da receita. `rest-api` já continha
`node-api-runtime-conformance`, com requisito, provedor, papel, caminhos de
produto e predicado tipado. O validador procurava conformidade somente na lista
global `acceptance`. Uma entrada global com o mesmo ID estava sem requisitos e
sem `conformance`, enquanto a definição completa da tarefa era ignorada. Os
quatro últimos reparos de Node repetiram essa obrigação sem resolver a fronteira
entre donos das verificações.

O registro de verificações agora conserva **dono da tarefa e ID da receita**.
Receitas de tarefa podem comprovar a obrigação pertinente; uma entrada global
homônima incompleta não herda sua autoridade. Provas executadas continuam
dependendo de arquivos, ambiente, comando e observações atuais. Nenhuma dessas
definições de plano é tratada como uma execução aprovada.

A inspeção do retorno original revelou também perda de dados pelo normalizador
anterior. A resposta paga `ca067e9feb4e…` declarava, na própria receita global,
`requirementId`, capacidade, tipo, provedor e caminhos do produto como campos
planos. O plano salvo perdera esses campos ao esperar somente o formato aninhado
`conformance`. Repetir a mesma inferência não recuperaria esse dado melhor que ler
a resposta já preservada.

O workflow oferece ao planejador uma projeção readonly das respostas completas:
somente operação e resultado, sem configuração, prompt ou credenciais. A
reidratação aceita apenas respostas de outline ou reparo e restaura metadados
ausentes do **mesmo dono, ID, invocação, argumentos, diretório, tipo, nível,
predicado efetivo e critério**. O requisito precisa estar ativo, o provedor
literal precisa ser compatível com o papel operacional e seus caminhos já
precisam estar declarados pelo check ou por seu dono. Campos conflitantes não
são sobrescritos; respostas contraditórias geram ambiguidade para reparo local.
O JSON original permanece intacto no ledger.

Na cópia real ocorreram duas restaurações: a conformidade de
`react-vite-foundation/client-build-check` e os requisitos e conformidade de
`$acceptance/node-api-runtime-conformance`. A segunda vem do hash de resposta
`af045a9ee82248d0aa948fc845255bcee80071bb2441361fe2edc543f2663010`.
Nenhum comando, predicado ou critério foi trocado, nenhuma resposta de tarefa
foi copiada para outro dono e nenhum resultado `PASS` foi criado. São definições
de receitas recuperadas; não são observações de execução.

O controle de reparo também aceitava mudanças no plano inteiro como sinal de
progresso do mesmo incidente. Alterar outra tarefa, texto ou receitas sem relação
mantinha a repetição. E reparos classificados como ambiente descartavam toda a
resposta de tarefa, inclusive referências e verificações técnicas pertinentes.
A correção aplica mudanças permitidas ao contrato afetado, conserva os critérios
do produto e mede o progresso pelo incidente e por seus contratos executáveis.
Uma correção de ambiente não autoriza substituir a entrega por documentação ou
afrouxar seu aceite.

## Reprodução sem inferência e sem executar o produto

```sh
node scripts/reproduce-plan-invariants.mjs \
  /tmp/capivara-plan-invariants-before-20261028/project.sqlite 83cb4a0
```

O banco e os transcripts originais permanecem em uma cópia privada externa ao
repositório. O script abre SQLite em modo readonly, arquiva os fontes do baseline
e compila APIs em diretórios temporários. Prompts, respostas completas, banco e
credenciais não são publicados. Qualquer pedido novo ao agente ou entrevista
lança erro; nenhum comando de produto ou instalador é executado.

O [resultado reproduzível](rc2-evidence/plan-invariants.json) confirma:

- O baseline `83cb4a0` reprova a conformidade de Node apesar da receita local
  completa já registrada no plano.
- A fonte corrigida retorna `ready`, com **cinco tarefas e 14 requisitos
  cobertos**, sem novas solicitações ao agente.
- Foram preservados os **34 critérios**, arquivos de saída, entradas declaradas
  e as **29 receitas executáveis** existentes. Elas estão distribuídas em
  **10 verificações de tarefa e 19 receitas globais de aceite**; não são dez
  verificações no total.
- O dono da receita Node passa de `rest-api` para `task-rest-api` após a
  reconciliação de tarefas. A entrada global antes órfã recebe somente os
  metadados exatos de sua própria resposta paga, com hash de origem registrado.
  Removendo a receita local válida e recolocando a versão global órfã, o validador
  volta a reprovar. A versão incompleta não é usada como substituto de nenhuma
  definição qualificada.
- As duas reidratações são registradas separadamente, sem novas solicitações ao
  agente e sem ambiguidade. Os demais contratos de conformidade existentes são
  preservados. Nenhuma receita foi executada ou aprovada por esse procedimento.
- O hash do banco de entrada permanece igual. Não foi aplicado plano na pasta
  real por este reprodutor.

Cinco fluxos gerais também passaram com agentes determinísticos em
[`general-engine-flow.spec.ts`](../packages/core/test/app/general-engine-flow.spec.ts):
Node, Python e SDK TypeScript atravessam INIT, PLAN e BUILD, incluindo retomada;
web e TUI atravessam INIT e PLAN em suas interfaces apropriadas. Esses testes não
usam inferência paga e não equivalem ao aceite de `samba_admin`.

## Execução, ambientes e provas

Os fluxos gerais encontraram dois outros defeitos concretos, corrigidos no
motor. O argumento de saída `--outDir` era tratado como entrada: criar o próprio
artefato alterava a identidade da prova. Além disso, a integração publicava
somente `task.files`, deixando para trás os artefatos declarados pela verificação.
O produto compilava e funcionava na área privada, mas a prova era reaberta porque
seu artefato não chegava à área canônica.

Saídas de build agora têm uma definição comum, abrangendo `outputs` e artefatos
de conformidade. Elas participam da exclusão de entradas, dos locks, dos
checkpoints e da publicação. Configurações lidas por opções como `--project`
continuam sendo entradas relevantes; documentação sem relação não invalida a
prova. Metadados de auditoria da classificação técnica não invalidam observações
ou inspeções quando pedido, código e ambiente consumido permanecem iguais.

Outro caso atravessa disponibilidade e implementação: um compilador existente
recebia uma sonda que exigia `tsconfig.json` antes de haver produto. O motor pode
recuperar a disponibilidade por uma invocação distinta da ferramenta concreta,
preservando programa, wrappers e loaders. A falha original permanece registrada;
o resultado de disponibilidade não é uma prova de produto. Restrições de versão,
evals, bibliotecas, drivers e serviços não usam esse fallback. O cenário SDK
continua exigindo compilação real, artefato produzido e execução funcional desse
artefato.

Uma receita global que repete exatamente uma observação já válida na tarefa
pode apontar para esse receipt, sem executar o comando novamente nem fabricar
um `PASS` global. A seleção exige execução, predicado, ambiente e hashes
compatíveis, limita-se à conformidade da stack e preserva produtores necessários
a outras receitas. Critérios adicionais, comandos diferentes e ambiguidades
mantêm a verificação normal. A otimização não cria uma nova causa de parada.

## Comparação geral e aplicação instalada

```sh
npm run check
node scripts/compare-general-engine-flow.mjs 83cb4a0
node scripts/validate-rc2.mjs docs/rc2-evidence/general-pilots.json
```

A [comparação](rc2-evidence/general-flow-comparison.json) executou o mesmo arquivo
de cenários contra `83cb4a0` e a fonte corrigida: os cinco falharam no motor
anterior e os cinco passaram no atual. Há três fluxos completos, com código e
comandos reais — Node.js CLI, Python CLI e TypeScript SDK com CLI gerada — e dois
fluxos de planejamento, web e TUI. As respostas dos agentes são determinísticas;
isso mede os contratos do motor, não a qualidade estatística de um modelo.

Os [pilotos de execução](rc2-evidence/general-pilots.json) também concluíram:
dois workers Node independentes se sobrepuseram; a cadeia Python estrita manteve
concorrência um; a TUI recebeu teclas em PTY real. O controle Node serial levou
989 ms e a configuração paralela, 632 ms nesta medição. Ambos concluíram; o tempo
de um baseline interrompido não é apresentado como tempo de entrega comparável.

Após **394 testes em 58 arquivos**, a CLI `0.9.0-rc2` instalada retomou o plano
na pasta real e terminou com código zero. O [estado verificado](rc2-evidence/plan-control-live.json)
ficou `complete/plan`, plano `ready`, cinco tarefas, 14 requisitos cobertos e
`lastFailure=null`. O ledger permaneceu com 17 chamadas: **nenhuma chamada nova
ao agente** nessa recuperação. Os dois metadados perdidos foram recuperados das
respostas existentes. O SHA-256 da CLI instalada coincide com o build testado.

O aplicativo `samba_admin` não foi construído nesta rodada. As receitas desse
plano ainda não são aceite funcional dele; os builds, a concorrência e o PTY
acima pertencem aos pilotos gerais separados. Nenhum código do exemplo foi
alterado para acomodar o motor.
