# Reconciliação e retomada do planejamento

Esta evidência trata da **nova execução** de `samba_admin`, cujo banco foi
reiniciado, e não da execução anterior que concluiu o build. A primeira cópia
contém 110 eventos e cinco chamadas concluídas: uma descoberta, duas de ambiente
e duas de outline. A segunda contém 142 eventos e sete chamadas, após dois
reparos adicionais. Ambas estão em `waiting/plan`, sem estado `execution`, sem
provas de execução do produto e sem entrega validada. Os horários abaixo são UTC.

## Defeitos corrigidos

- Duas fatias descreviam os mesmos módulos em inglês e português, com os mesmos
  IDs e arquivos. A igualdade literal do objetivo interrompia a reconciliação.
  A identidade agora considera ownership compatível, preservando requisitos,
  critérios, contratos e receitas. Ownership materialmente incompatível continua
  sendo rejeitado.
- A entrada de `runPlan` descartava planos com status `planning`. Agora preserva
  ambiente, contratos e tarefas adotados. Checkpoints registram cada fatia e seu
  prompt pendente antes da chamada; conclusão e adoção são persistidas juntas.
- Três pares de verificações de API tinham o mesmo comando e predicado tipado,
  mas descrições traduzidas geravam duas receitas. Agora cada par forma uma prova,
  mantendo ambas as descrições e o mesmo predicado efetivo. Receitas com
  predicados, dependências ou comportamento diferentes permanecem distintas.
- O índice entregue a novas fatias omitira módulos com requisitos disjuntos.
  Novas chamadas recebem um índice compacto de IDs, arquivos e contratos.
  Prompts legados são mantidos quando há resposta completa no cache; prompts
  pendentes já persistidos conservam a identidade da ação registrada.

Recuperar uma resposta órfã é outra classe de problema: nestes backups todas as
chamadas estão completas. A recuperação do ledger é validada em testes próprios:
cancelamento ou exceção não deixam `running` irrecuperável; a correlação gravada
antes de invocar permite recuperar uma resposta já escrita sem repetir
inferência. Uma falha de recurso registrada continua exigindo mudança de
configuração ou retry explícito. Cache completo anterior é preservado. Essa
correção não explica a colisão de IDs nem é usada para declarar sucesso.
Perguntas continuam condicionadas a uma lacuna real do produto. O brief deste
caso não tinha lacunas pendentes.

## Reprodução sem inferência

O banco de entrada é uma cópia externa somente para leitura; contextos e
respostas completos não são publicados nos artefatos do repositório.

```sh
node scripts/reproduce-plan-reconciliation.mjs \
  /tmp/capivara-plan-efficiency-before-20261028/project.sqlite fc5f1da
```

O script usa exatamente as duas respostas salvas contra o código de `fc5f1da`
e a fonte atual. Ele empacota módulos em uma pasta temporária e consulta o banco
com SQLite readonly. Não executa comandos do produto, instala dependências ou
chama agentes. O hash do banco é conferido ao final.

| Observação | Antes | Depois |
| --- | --- | --- |
| Mesmas duas respostas de outline | Erro de colisão EN/PT | 7 tarefas estáveis |
| Cobertura das tarefas reconciliadas | Reconciliação interrompida | 11 de 11 requisitos |
| Receitas por API equivalente | 2 | 1, com critérios e predicado preservados |
| Retomada do rascunho | Reextração global | Uma resposta já paga reaproveitada |

A retomada em memória consome somente a chave `94ff48a52…`, preserva o ambiente
e para imediatamente após adotar a segunda fatia. O script **não** executa os
reparos seguintes nem declara o plano pronto ou o produto concluído.

O resultado agregado está em
[`rc2-evidence/plan-reconciliation.json`](rc2-evidence/plan-reconciliation.json).
Regressões ficam em `rc2-planning.spec.ts`, `reconcile-identity.spec.ts` e
`domain-invocation-recovery.spec.ts`; o resultado da execução real deve ser
avaliado separadamente pelo estado persistido após a retomada.

## Segundo bloqueio: o reparo criou outro provedor

A retomada real às 22:18:21 reaproveitou a segunda resposta de outline já paga
e adotou sete tarefas, cobrindo os 11 requisitos. Isso resolveu a colisão entre
fatias. Em seguida, o validador identificou uma falha distinta: `nodejs-runtime`
não declarava a identidade exigida pelo binding Node.js do pedido.

| Chamada de reparo | Intervalo | Resultado efetivo |
| --- | --- | --- |
| `c55aef6c…` | 22:18:22–22:18:32 | Devolveu a identidade correta, mas omitiu o ID do provedor |
| `64a9710a…` | 22:18:32–22:18:43 | Repetiu literalmente a mesma definição de `foundation`, sem alterar referências ou ambiente |

O primeiro reparo nomeou o mesmo runtime, com a mesma sonda `node --version`.
Porém, o normalizador gerou o ID `env-1a4350072bf0` pela ausência de `id`. Sua
chave de identidade explícita não coincidiu com a chave do nó antigo sem
identidade. O plano passou a ter dois nós para o runtime: as tarefas consumiam
`nodejs-runtime`, enquanto somente o nó novo declarava o binding obrigatório.
Não se tratava de dependência inserida pelo sistema operacional ou de Node
ausente.

O segundo prompt mostrava os dois nós e as referências da tarefa. O segundo
retorno não mudou nenhum campo de `foundation` em relação ao primeiro; suas
listas de ambiente e aceite vieram vazias. O erro
`unused-mandatory-provider` continuou presente, e o motor suspendeu no evento142,
às 22:18:43. O PID2337346 terminou; não ficou trabalho em andamento. Reescrever
novamente a fundação não seria progresso sobre esse vínculo ausente.

A correção reconcilia esse enriquecimento quando existe uma correspondência
única entre os contratos operacionais completos: tipo, invocação de prontidão,
preparação, dependências, plataformas e exports. Ela conserva o ID consumido e
remapeia referências. Sem essa correspondência, o motor não adivinha o vínculo
por nome ou mensagem. O diagnóstico do invariante também identifica os nós
esperados e os consumidores, para que o próximo reparo trate a causa concreta.

Essas duas chamadas consumiram **20,71 segundos**, **57.979 tokens de entrada**,
dos quais **34.560 em cache**, e **1.937 tokens de saída**. Cache está incluído na
entrada; não deve ser somado a ela. O provider não informou valor financeiro.
O custo ocorreu durante a investigação e não é apresentado como economia
produzida pela correção.

## Reprodução do vínculo sem nova chamada

```sh
node scripts/reproduce-provider-reconciliation.mjs \
  /tmp/capivara-plan-provider-before-20261028/project.sqlite fc5f1da
```

O segundo reprodutor lê a cópia de 142 eventos em uma transação SQLite readonly.
O validador de `fc5f1da` precisa reproduzir `unused-mandatory-provider` no plano
salvo. A fonte corrigida retoma esse mesmo plano somente em memória; seu agente
injetado lança erro se qualquer nova solicitação for feita. Nenhum comando de
produto ou instalador é executado.

As asserções exigem plano pronto, sete IDs de tarefa preservados, cobertura dos
11 requisitos, nenhum vínculo pendente e nenhum pedido ao agente. O runtime
refinado precisa conservar o ID já consumido; contratos de produto, critérios e
aceite obrigatório permanecem preservados. A comparação e os hashes ficam em
[`rc2-evidence/provider-reconciliation.json`](rc2-evidence/provider-reconciliation.json).

A execução do reprodutor às 22:27:48 passou: o validador anterior apontou
`unused-mandatory-provider`; o plano corrigido ficou `ready`, com sete tarefas,
11 requisitos cobertos e três ambientes. `nodejs-runtime` recebeu a identidade
existente no nó duplicado, e o aceite `nodejs-runtime-conformance` foi preservado.
O agente recebeu **zero solicitações**, e o hash da cópia do banco permaneceu
igual. Esse resultado é uma retomada do plano em memória, não uma execução real
de construção.

## Retomada na pasta real

Após `npm run check` passar com **329 testes em 47 arquivos**, a versão
`0.9.0-rc2` foi instalada e a mesma etapa foi retomada com
`capivara plan --project <projeto> --no-dashboard`. Às **22:28:10 UTC** o comando
terminou com código zero. O SQLite passou de `waiting/plan` para
`complete/plan`, com `plan.status=ready`, sete tarefas, 11 de 11 requisitos
cobertos, três ambientes, nenhuma invariante pendente e `lastFailure=null`.

O ledger permaneceu com sete chamadas: **nenhuma chamada nova, nenhum início
de agente e nenhum resultado novo de agente** nessa retomada final. O evento
152 registra a reconciliação entre o ID duplicado e `nodejs-runtime`. O binário
instalado tem o mesmo SHA-256 do artefato compilado. Os dados ficam em
[`rc2-evidence/plan-live-resume.json`](rc2-evidence/plan-live-resume.json).

Também foram corrigidas e testadas as fronteiras de interrupção das chamadas:
uma resposta durável concluída antes da promoção no ledger é recuperada sem
inferência; uma chamada interrompida sem resposta utilizável recebe uma nova
identidade de tentativa. Falha de recurso registrada não vira resposta aprovada.
Esse defeito é distinto do bloqueio observado neste plano.

As reproduções e a retomada real demonstram o planejamento corrigido. **O build
desta nova execução não foi iniciado**, e não há provas de produto aprovadas.
`complete/plan` significa conclusão dessa etapa; não significa entrega do
aplicativo nem demonstra concorrência ou aceite funcional desse novo projeto.
