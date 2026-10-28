# Revisão adversarial dos relatórios e medição histórica

Data: 2026-10-28. Leitura cruzada dos relatórios init/plan e build, seguida de conferência dos caminhos citados no código. Sem alterar os relatórios alheios, implementação, testes ou dados históricos. Sem execução de provedor nem dos scripts de medição.

## Resultado da revisão

Os achados centrais dos dois relatórios são sustentados pelo código: modalidade não é contrato de primeira classe; há pressupostos de navegador dentro do motor; o fatiamento não estabelece um teto real por modelo; requisitos documentais e protocolos podem parar sem defeito demonstrado no produto; preparação e recuperação existem, mas são parciais e distribuídas; a prova de lançamento desktop é promovida indevidamente a prova de fluxos. Não encontrei motivo para retirar esses diagnósticos. As qualificações abaixo evitam exageros e precisam aparecer no plano final.

1. **Não afirmar que não existe preparação nem recuperação de ambiente.** `loop/environment-prepare.ts:15-27` instala dependências declaradas; `:35-64` instala Playwright, baixa Chromium se faltar, verifica lançamento real e tenta bibliotecas de sistema quando autorizado. `loop/build.ts:550-568` também permite que uma sessão termine com código não zero e prossiga se o Core comprovar todos os requisitos. `loop/runner.ts:452-485` e `loop/paralelo.ts:512-525` contêm reparos limitados de instalação. O defeito é a combinação de escolhas indevidas de ferramenta, cobertura estreita e esgotamento prematuro de estratégias; não é ausência completa de preparação.

2. **Qualificar o título BUILD#1.** A dependência de Playwright/Chromium ocorre no caminho padrão com workflows e sem `flowRunner` injetado (`loop/build.ts:746-752`). Pode ser evitada por opção que desativa os fluxos ou por executor injetado. O padrão continua errado para CLI/TUI, mas não é uma exigência universal em qualquer configuração de TUI.

3. **Diferenciar repetição injustificada de nova validação após mudança.** `loop/impacto.ts:44-47` já reaproveita prova quando nenhum arquivo mudou; qualquer mudança de produto, porém, atinge a suíte inteira. `loop/build.ts:1380-1400` roda a suíte durante reparo de aceitação quando houve alteração de código; isso pode ser necessário para impedir regressão. `loop/paralelo.ts:502-525` verifica uma árvore integrada diferente da árvore de um executor, o que também pode ser necessário. Desperdício comprovável: granularidade global indiscriminada, invalidação ampla por possibilidade de mudança de ambiente (`runner.ts:1578-1585`) e ausência de deduplicação compartilhada pelo comando, conteúdo e ambiente. Não classificar toda validação independente como excessiva.

4. **Separar três coisas sobre testes.** Testes de repositório que procuram frases de políticas (`test/prompts/test-policy.spec.ts:21-29`, por exemplo) não contam testes reais nem executam em cada desenvolvimento gerado. Não achei um gate de produção que conte testes e reprove porque sua quantidade não diminuiu. Existe, entretanto, o gate lexical I-16 no próprio motor: `contract/test-prescription.ts` + `init/orchestrator.ts:3317-3327` + `init/readiness.ts:122-129`; ele pode rejeitar documentos pela prescrição/menção de testes sem escolher verificações necessárias por risco. Essa é a ligação concreta com a queixa do usuário, sem converter testes meta em um mecanismo de contagem inexistente.

5. **O caso npm ci tem um caminho de parada concreto.** `loop/worktree.ts:886-894` escolhe exclusivamente `npm ci` para um lock não ignorado. Em `loop/paralelo.ts:467-476`, a falha de sincronização entre manifesto e lock chama `desfazer` imediatamente; os demais erros de instalação param por ambiente. Nesse caminho não há tentativa de reconciliar lock/manifesto por `npm install` em área isolada, validar o resultado e prosseguir. Isso sustenta diretamente o exemplo do usuário. Não afirmar que qualquer exit não zero de qualquer instalação sempre termina o build, pois há os contrapontos do item 1.

6. **Compatibilidade de runtime não se prova com presença.** A substituição de uma sonda falha por `--version` em `init/orchestrator.ts:1719-1741` é real. Ela deixa de demonstrar a compatibilidade que a sonda anterior procurava verificar. Não se pode concluir, apenas desse fato, que toda substituição viola um requisito real: a sonda anterior também pode ter sido inventada de forma restritiva pelo modelo. Além disso, Node >=22 aceita Node 24; dizer simplesmente 'Node 22 em host 24' não prova incompatibilidade. Exemplo válido exige faixa exata/major que exclua 24. Problema de raiz: ausência de proveniência tipada do requisito e acoplamento entre runtime do harness e do produto, sem provisionamento separado. Nunca resolver incompatibilidade verdadeira rebaixando a intenção do usuário.

7. **Banco informado não exige literalmente ausência do servidor remoto.** INIT#4 deve ser formulado com precisão: `interview/banco.ts:234-244,288-294` exige exemplo operacional sem configuração e sem servidor local instalado; `:305-310` fixa o servidor informado e proíbe escolher outro banco para contornar falta. Um banco descartável remoto compatível poderia satisfazer parte disso sem servidor local. Logo, não é contradição lógica universal. É prescrição universal de configuração, isolamento e operação sem o ambiente real, sem checar se existe instância descartável autorizada compatível com o produto solicitado.

8. **Preservar proteção de trabalho não requer parar a execução inteira.** As guardas de refs, arquivos externos e árvore suja previnem perdas reais. A crítica sustentada é a recuperação indiscriminadamente manual ou fatal, não a existência de verificação. O novo motor deve isolar, preservar, reconciliar e continuar o escopo independente quando possível; não deve ignorar alteração alheia nem sobrescrevê-la para conseguir continuar.

9. **Lançamento é evidência limitada e não prova de fluxo.** `acceptance.ts:278-324` considera sucesso se um processo permanece sem erro observado na janela e o encerra. É uma prova útil de inicialização quando essa capacidade é exigida, mas não demonstra cadastro/salvamento/exportação. `build.ts:1297-1304` efetivamente anuncia fluxos desktop como provados por `desktopSubiu`; o achado BUILD#10 é forte. O mesmo princípio vale para TUI: uma tela aparecer sob PTY não prova interação e persistência. Tampouco a simples sobrevivência do harness satisfaz a recuperação: é preciso salvar o trabalho e chegar ao comportamento correto, sem fabricar aceitação.

10. **Distinguir configuração padrão da API, CLI e amostra.** O zero de `maxVerifierRepairs` no runner é padrão da API. A amostra histórica B-01 passa explicitamente `maxVerifierRepairs:1` em `medir.mjs:84-87`. Não atribuir o padrão zero a todas as execuções. Isso não muda a crítica a tetos rígidos antes de estratégias alternativas.

11. **Atualização obrigatória sobre 99%.** O usuário esclareceu que é expressão qualitativa de persistência, não SLA numérico. Remover a necessidade de universo estatístico/denominador como pré-condição para o plano e não abrir uma nova frente de testes para provar a porcentagem. Traduzir em política de recuperação: continuar por alternativas aplicáveis, preservar progresso, não parar por divergência de instalador, estilo ou protocolo; parar somente impedimento crítico real depois do esforço de recuperação. Orçamento financeiro explícito e limite de autorização continuam decisões operacionais diferentes de uma meta estatística.

12. **Cobertura integral precisa ser descrita honestamente.** O cabeçalho do relatório init/plan declara que parte dos testes foi lida após transpilar TypeScript, removendo comentários/tipos; isso cobre lógica executável mas não cada linha original nem contratos estáticos apagados. A diferença foi fechada por releitura RAW integral posterior dos 120 arquivos, incluindo comentários e tipos, registrada no inventário final. A ressalva se refere apenas ao estágio preliminar. Minha cobertura inicial de runtime e TUI foi integral em fonte original: 55 fontes e 54 testes, 19.715 linhas; a cobertura adicional dos scripts originais está abaixo.

## Scripts executáveis de docs/medicoes/etapa-0

Leitura integral em texto original dos seis arquivos, 312 linhas. Não foram executados, pois `medir.mjs` invoca os provedores reais e o objetivo é auditar os resultados existentes.

| Arquivo | LOC | Leitura | Papel |
|---|---:|---|---|
| `capivara/docs/medicoes/etapa-0/consolidar.mjs` | 52 | integral | Agrega amostras, relê logs e corrige contagem de sessões de reparo de aceitação. |
| `capivara/docs/medicoes/etapa-0/medir.mjs` | 104 | integral | Cria projeto limpo, executa braço direto ou init/plan/build, coleta sessões e executa oráculo externo. |
| `capivara/docs/medicoes/etapa-0/provar-produto.mjs` | 99 | integral | Doze verificações de contrato da CLI por processos Node reais e testes próprios do produto. |
| `capivara/docs/medicoes/etapa-0/provar-restricao-terminal.mjs` | 24 | integral | Prova suplementar da ausência de serviço permanente na entrada sem comando com PORT=0. |
| `capivara/docs/medicoes/etapa-0/reproduzir-contradicao.mjs` | 16 | integral | Usa admitir/citacoesConferidas com documentos históricos, deixando explícito não ser replay integral de PLAN. |
| `capivara/docs/medicoes/etapa-0/reproduzir-saida-helper.mjs` | 17 | integral | Confere helper real com stdout/stderr misturados, NO_COLOR+FORCE_COLOR e JSON. |

### Limites das métricas

- Há uma amostra por braço, não estimativa generalizável de custo ou probabilidade de êxito.
- `medir.mjs:51-53,93-100` mede sessões externas de agente. Requisições internas do provedor são desconhecidas (`providerApiRequests:null`); não as chamar de chamadas de API. `costUsd:null` impede afirmar dinheiro gasto por essa amostra.
- Tokens de entrada em cache são parte do relato de entrada; não somar entrada total + cache como se fossem contextos independentes. Em B, só 17/18 sessões têm uso reportado, logo o total medido é parcial.
- `resultado.json` relata zero `repairSessions` porque o reparo de aceitação usa purpose/label que não satisfaz o filtro de `medir.mjs:100`. `consolidar.mjs:13-17,35-36` recupera duas sessões de reparo de código e dois ciclos de aceitação pelo log. Não usar o zero original para afirmar ausência de retrabalho.
- `provar-produto.mjs:91-94` confere que a suíte própria tem algum teste observado. Neste benchmark o pedido explicitamente exige testes com node --test (`pedido.txt:23-24`); isso não é teste para verificar redução de quantidade de testes. Ainda assim, os 12 checks não abrangem sozinhos todas as restrições do pedido.
- `provar-restricao-terminal.mjs:16` permite qualquer status na entrada sem comando, desde que termine sem erro de execução/timeout; isso é adequado porque o pedido não prescreve uma resposta sem argumento. O teste não mede universalmente todos os caminhos de ausência de serviço; no caso histórico a criação de HTTP é confirmada também por código, prompt e stdout.

## Histórico confirmado: o motor induziu servidor proibido e aceitou o produto

Evidência não depende somente de documentos ou do título de teste; a cadeia aparece no código gerado e nos prompts de correção gravados.

1. `pedido.txt:1-3,26,32-34` define CLI local somente por comandos, sem interface web, servidor, serviço permanente ou dependências externas. Essas decisões estavam expressamente fechadas.
2. Após as fases, antes da aceitação, `B-01/antes-aceitacao-prova.json` registra 12/12 e `antes-aceitacao-restricao-terminal.json:17-26` registra entrada sem comando terminando em 52ms, status1, erro de uso, sem timeout nem servidor; suplemento 2/2.
3. `B-01/014.prompt.txt:110-117` trata como defeito operacional o erro de uso de `npm start` sem argumentos, que o contrato não exigia funcionar dessa forma. A resposta 014 torna o padrão equivalente a listagem e saída0.
4. A etapa seguinte ainda exige servidor: **`B-01/016.prompt.txt:112-120` diz que G4 executa npm start com PORT, espera HTTP em 127.0.0.1 e que o entrypoint precisa escutar a porta e servir resposta**. Isso é expansão explícita de requisito pelo mecanismo de aceitação. Não é uma escolha espontânea do editor em desobediência isolada ao pedido.
5. `016.response.txt:1` confirma a correção segundo essa orientação. O código final `B-01/produto/src/cli.js:2,6-56,83-84` importa node:http, cria servidor e mantém-no ativo quando não há comando e existe PORT.
6. `B-01/core.log:31-42` registra duas correções de aceitação e sucesso final. `resultado.json` relata exit0, estado aceito e 12/12 checks externos.
7. `B-01/restricao-terminal.json:17-26` relata entrada sem comando travada até timeout de 5.014ms, stdout 'Servidor disponível em http://127.0.0.1:35655'; suplemento cai de 2/2 para 1/2. Apesar de status0, há erro ETIMEDOUT: considerar somente exitCode esconderia a falha. O processo trata SIGTERM e pode terminar0 depois de o timeout já ter sido constatado.

O braço A direto fez uma sessão, 129,058s, 12/12 checks e 2/2 suplemento terminal. O braço B fez 18 sessões, 972,253s, 12/12 checks e 1/2 suplemento, após o mecanismo induzir comportamento proibido. A diferença de tempo desta amostra é aproximadamente 7,53x; tokens de entrada reportados, aproximadamente 9,97x, com cache e uma sessão sem uso em B. Não extrapolar esses fatores para todos os projetos/modelos e não convertê-los em USD sem preços/uso completos.

### Implicação para a reconstrução do zero

O contrato do produto deve representar modalidade, modo de execução e restrições obrigatórias, e o PLAN deve declarar comandos/receitas por capacidade. O motor novo seleciona o driver compatível com CLI/TUI/desktop/web e interpreta a evidência no escopo correto. Se a ferramenta de validação exige HTTP para uma CLI que proíbe servidor, o objeto do reparo é a ferramenta/receita de validação; o editor não recebe ordem de adicionar servidor. A recuperação não pode converter uma limitação do validador em nova função do produto. Nenhum algoritmo, estado, wrapper ou motor atual é proposto para reaproveitamento.
