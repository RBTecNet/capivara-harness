# PLAN, identidade de ambiente e entrevista — RC2

## Falha reproduzida

A execução interrompida em `2026-10-29T00:25:12Z` chegou ao PLAN com cinco
entregas e 15 requisitos. As dez chamadas concluídas consumiram aproximadamente
182 segundos de tempo de agente; nenhuma chamada de construção havia ocorrido.
Todos os dez pré-requisitos das respostas de ambiente omitiram `identity` e
`provides`. O formato JSON publicado pelo próprio motor também omitia esses
campos, embora uma instrução posterior os exigisse. Repetir receitas de
verificação não corrigia a identidade ausente de TypeScript.

A interpretação inicial também converteu o item “Testes automatizados” em um
provedor CLI obrigatório com esse nome. A obrigação real de testar comportamento
precisa continuar existindo; não há uma ferramenta escolhida por essa expressão.

Na entrevista, o canal estava habilitado. A resposta de descoberta continha
`questions: []`; não havia pergunta pendente nem resposta descartada nessa
execução. Isso demonstra que nenhuma pergunta foi proposta, não que todas as
possíveis lacunas de produto tenham sido descartadas com certeza.

## Correções no motor

O normalizador completa uma identidade ausente quando o nome literal do provedor
é exato, o papel operacional do nó é conhecido e não há ambiguidade. A origem
dessa inferência fica registrada. Não procura tecnologias por substring, não
transforma uma biblioteca em CLI e não confunde disponibilidade com uso pelo
produto. Um reparo de ambiente atua no ambiente existente, preservando suas
receitas e consumidores.

Listas técnicas podem conter provedores e resultados. A classificação conserva
a fonte literal completa, os IDs compatíveis e a interpretação anterior. Um
resultado continua sendo requisito obrigatório sem receber um provedor fictício.
Dois resultados diferentes provenientes da mesma citação conservam identidades
distintas. A retomada não volta a classificar o mesmo grupo já resolvido.

A política de entrevistas distingue a decisão específica: escolher SQLite não
responde por quanto tempo reter registros; declarar uma interface web não
responde como integrar um ERP. Escolhas técnicas e fatos já respondidos não
geram entrevistas artificiais. Fechar a apresentação durante uma pergunta
preserva a decisão e disponibiliza o terminal ou `capivara answer`.

O plano registra obrigações de verificação previstas ou ainda pendentes. A
ausência de metadados de conformidade antes de haver código não impede por si
só a construção. Disponibilidade dos provedores, grafo, referências, cobertura
e interfaces continuam sendo verificadas. O BUILD continua impedido de concluir
sem provas atuais de comportamento e uso da stack exigida.

A partição de uma obrigação já existente conserva sua linhagem: entregas que
cobriam o requisito composto passam a cobrir seus resultados derivados. Essa
operação não copia claims para receitas nem cria evidências. Assim, separar
metadados não volta a gerar a mesma fundação e os mesmos módulos.

O desconto fixo de 50% do contexto foi removido. O PLAN usa a capacidade real
configurada; o BUILD continua contabilizando fatos, detalhes operacionais,
índice de fontes e trechos efetivamente fornecidos dentro desse mesmo teto.
Quando a responsabilidade realmente excede a capacidade, um pacote estruturado
pede decomposição de engenharia. Critérios, receitas, readsets e locks podem ser
referenciados por índice e restaurados exatamente pelo coordenador. Foi removido
o fallback que criava uma tarefa para cada frase, copiando os mesmos arquivos e
serializando artificialmente as entregas.

Uma prova funcional não precisa repetir o identificador de cada ferramenta da
stack quando a cadeia observada já liga os fontes, a compilação e o artefato
realmente executado. Essa associação não dispensa os requisitos funcionais ou
de interface, que conservam sua cobertura própria. Um ID ou um snapshot de
entradas declarado pelo agente, sozinho, não comprova leitura nem execução.

Bibliotecas embutidas possuem uma interface de módulo e um runtime concreto;
não precisam inventar um executável chamado SQLite. Observações Node/Python
registram o host, os módulos carregados e os hashes do código realmente
executado. Uma sonda de disponibilidade, uma versão ou um módulo carregado só
pelo instrumento não são prova de uso pelo produto.

## Reprodução

```sh
npm run check
node scripts/compare-general-engine-flow.mjs bab97eb docs/rc2-evidence/environment-metadata-comparison.json
node scripts/validate-rc2.mjs docs/rc2-evidence/environment-general-pilots.json
node scripts/measure-project-control.mjs BEFORE.sqlite AFTER.sqlite OUTPUT.json
node scripts/reconcile-saved-plan.mjs BEFORE.sqlite PROJECT
node scripts/reproduce-provider-observation-resume.mjs
```

A comparação usa os mesmos agentes determinísticos contra os dois motores,
omitindo `identity/provides` nas respostas de ambiente. Node CLI, Python CLI e
TypeScript SDK percorrem INIT, PLAN, BUILD e retomada com comandos reais. Web e
TUI verificam o planejamento. Os cinco cenários falham no baseline `bab97eb` e
passam com o normalizador corrigido. Não há chamadas pagas nesses testes.

Os testes de módulos executam operações reais de SQLite em arquivo com Node e
Python, incluindo fechar e reabrir a base, além de casos negativos de versões,
resolução sem importação, troca de host, troca de código e uso apenas pelo
verificador. Esses cenários não validam o aplicativo da pasta real e não
estabelecem uma taxa universal de sucesso para qualquer projeto.

O medidor abre SQLite em modo somente leitura e publica somente estado de
controle, contagens, identidades de obrigações e tempos observados. Não publica
pedido, documentos, respostas completas ou credenciais. Tempo de agente não é
apresentado como custo financeiro.

## Recuperação observada

A primeira retomada desta investigação fez **sete chamadas novas ao planner**,
somando **131.397 ms**, e expôs a criação indevida de 36 tarefas. Esses gastos
não foram omitidos nem apresentados como otimização. O estado intermediário e
as respostas foram preservados fora do repositório. A correção de linhagem,
capacidade e decomposição foi aplicada ao motor.

O reconciliador recuperou as **cinco responsabilidades originais**, com seus
critérios, receitas e arquivos preservados, incorporando o entendimento atual
de **17 requisitos** e o ambiente corrigido. Não substitui estado com trabalho
de implementação e recusa produto/pedido divergente ou mudança concorrente.
Essa reconciliação fez **zero chamadas novas** e não escreveu código do produto.

O reparo de uma receita agora pode corrigir sua classificação técnica no mesmo
ID, acrescentar cobertura autorizada e conservar campos omitidos, comando,
critério humano e receitas não alteradas. A classificação proposta é conferida
contra a obrigação literal e o provedor operacional consumido, com antes/depois
no evento persistido. Um SDK ou driver inferido incorretamente não fica congelado
como se fosse uma decisão explícita do usuário.

A CLI executou novamente `plan` na pasta real e terminou com código zero, sem
novas chamadas: `complete/plan`, plano `ready`, cinco tarefas, todos os 17
requisitos cobertos e `lastFailure=null`. O ledger contém 17 chamadas nesta
execução. Há dez obrigações de verificação previstas, quatro ainda com receita
pendente; elas continuam exigidas no BUILD. O [registro de controle](rc2-evidence/plan-environment-live.json)
mostra explicitamente que não há execução de BUILD nem provas do aplicativo.

Os [pilotos gerais](rc2-evidence/environment-general-pilots.json) concluíram:
workers Node independentes se sobrepuseram com concorrência dois; a cadeia Python
estrita manteve concorrência um; a TUI recebeu teclas em PTY real. As respostas
dos agentes são determinísticas e os comandos dos produtos são reais.

O build, a checagem de tipos e os **460 testes em 68 arquivos** passaram.
A [comparação](rc2-evidence/environment-metadata-comparison.json) mantém os cinco
cenários e hashes das fontes usados. A identidade do instrumento registra as
versões dos recibos necessários: uma observação antiga incompleta não pode ser
simplesmente reinterpretada como se contivesse as novas leituras/importações.
Na [reprodução de retomada](rc2-evidence/provider-observation-resume.json), duas
provas antigas são renovadas por execução real sem chamar editor ou revisor; a
retomada seguinte não cria provas novas nem chama agentes. O cenário usa uma
callback local no baseline, com zero inferência paga.

## Limites

Leitura instrumentada e importação são observadas por protocolos Node/Python,
limitadas aos seletores pertinentes. Um compilador nativo fora desses protocolos
pode usar uma invocação direta com artefato e comportamento observados; sem essa
cadeia, precisa de outro instrumento. Providers compilados resolvidos apenas em
cache externo também podem exigir uma observação adicional. Esses casos não
recebem conformidade inventada nem são classificados como defeito do produto.

## Nova execução: falha de origem no INIT

Após reiniciar o projeto, o INIT parou em `2026-10-29T01:47:56Z`, com zero
requisitos adotados e três saídas de agentes gravadas. Não havia pergunta
pendente nem resposta humana. As referências anteriores a “respostas salvas”
neste diagnóstico significam saídas técnicas dos agentes, não entrevistas.

Uma das 16 citações extraídas concatenava três parágrafos literais e omitia a
exigência intermediária de banco isolado nos testes. O parser estrito recusava
a concatenação; os dois reparos repetiam a mesma citação. O motor não tentava
a recuperação estrutural possível antes de suspender.

O INIT agora recupera o intervalo real a partir de uma cadeia única de
parágrafos ou linhas literais completos. O intervalo inclui as cláusulas
omitidas, e a origem conserva a citação recebida, offsets e lacunas preenchidas.
Palavras inventadas, linhas parciais, ordem invertida e cadeias ambíguas não são
aceitas como fonte. O parser estrito continua estrito. A classificação técnica
já gravada só é reutilizada com o mesmo índice e a mesma origem literal única;
variantes conflitantes não usam a última resposta arbitrariamente.

O [reprodutor](../scripts/reproduce-init-citation.mjs) compara o baseline
`f0d38fb` com o motor corrigido usando somente as saídas capturadas:

```sh
node scripts/reproduce-init-citation.mjs BEFORE.sqlite
npm run check
```

O [resultado](rc2-evidence/init-citation-replay.json) confirma: o baseline
interrompe; um INIT novo conclui com um único reparo técnico da stack; a
recuperação reutiliza esse reparo existente e conclui sem nenhum novo reparo.
Não há inferência paga no reprodutor. As duas formas preservam os mesmos 21
requisitos e a cláusula intermediária omitida. Um teste separado confirma que
uma pergunta real de retenção continua chegando ao usuário após a recuperação.

Na pasta real, o INIT terminou `complete`, com `brief=ready`, 21 requisitos,
`lastFailure=null` e o ledger ainda com as três chamadas originais. Não houve
nova chamada paga, resposta humana inventada ou execução de PLAN/BUILD nesta
recuperação. A [CLI instalada](rc2-evidence/init-citation-live.json) repetiu o
INIT com sucesso e coincide byte a byte com o build testado. O check completo
passou com **481 testes em 71 arquivos**, build e tipos.
