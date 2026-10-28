# Auditoria do motor BUILD — evidências de código

Data: 2026-10-28. Nenhum motor foi alterado, nenhuma chamada paga foi feita.

## Cobertura e método

Leitura integral da lógica das 46 fontes de src/loop (15.004 linhas físicas). Leitura de fontes pelos intervalos sequenciais, com releitura dos trechos truncados pelo terminal. Inventário abaixo. Comentários de paralelo inicialmente omitidos da apresentação foram lidos integralmente em complemento RAW de todas as 927 linhas; não há lacuna de leitura original. Leitura integral também dos 46 testes TypeScript de test/loop, uma fixture de roteiro e 8 arquivos test/integration. Total deste recorte: 101 arquivos e 31.571 linhas físicas. Nenhum arquivo pendente neste recorte. O ledger verificável está em /tmp/novoharness-audit-build-test-progress.json.

## Achados confirmados

1. **TUI recebe Playwright/Chromium no caminho padrão com workflows.** `src/loop/build.ts:746-752` configura browser por existência de workflows e ausência de flowRunner, sem discriminar interface. `environment-prepare.ts:30-64` instala @playwright/test, baixa Chromium e tenta bibliotecas. Reproduzido: esqueleto Rust/TUI, nenhum requisito, um workflow -> tentativa npm instalar Playwright e exitCode 1 com ZERO chamadas de modelo quando instalador falha. Evidência em /tmp/novoharness-repro-build.log. Isso é dependência introduzida pelo motor.

2. **TUI não é um alvo de execução próprio.** `flows.ts:872-876,1077-1100` detecta terminal por regex no texto Stack; usa a mesma DSL de testes Playwright, com fallback web por dúvida. `passagem.ts:233-252` helper usa execFile/stdin pipes, sem PTY, tecla, tamanho de terminal ou estado de tela. Uma TUI interativa não tem prova real de setas/foco/redimensionamento. Isso não é corrigível pedindo outro prompt.

3. **G3 reenvia a fase inteira e exige todas as linhas, apesar do fracionamento.** `runner.ts:1231-1255` envia session.markdown integral e todos defeitos; `gates.ts:311-333` exige exatamente expectedTasks vereditos. `partes.ts:66-83` só divide builder; `runner.ts:946-1038` julga fase completa depois das partes. Modelos baratos recebem carga assimétrica e retomadas precisam repetir formalismo de task já aprovada. Repro gate3 TASK 2 com TASK 1 aprovada -> falha 1 de 2.

4. **Não existe teto real de contexto.** `partes.ts:72` usa limite = Math.max(48_000, fixo+16_000), e task indivisível excedente segue inteira. Repro contexto fixo 100.000 aceita prompt 100.200, limite 116.000, excede=false. Além disso habilidades, sharedContract, architectureSlice e histórico dos defeitos se repetem nas sessões (`runner.ts:849-870,1060-1080`). Precisa particionamento de requisito/contrato pela dependência semântica no PLAN, orçamento de tokens do executor e do auditor e redução de contexto fixo no motor.

5. **Suíte inteira é política implícita para qualquer mudança.** `impacto.ts:46-49` define qualquer arquivo do produto mudado como impacto na suíte inteira; `runner.ts:1076-1109` executa comando global G2; `paralelo.ts:500-530` roda novamente na cópia integrada. Reparo do verificador invalida G2 mesmo sem diff (`runner.ts:1590-1596`) e aceitação pode rodar novamente (`build.ts:1391-1400`). Agentes ainda podem rodar comandos no próprio trabalho: não há deduplicador central de comando+árvore+ambiente entre agentes/gates/aceitação. Sem suíte resolvida G2 é NOT_APPLICABLE (`runner.ts:1121-1128`), logo arquitetura atual alterna entre tudo e nada.

6. **Recuperação é escada estreita, não esgotamento de recursos.** `runner.ts:289-294`: padrão três ciclos, reparo verifier zero na API; `defeitos.ts:167` e `orcamentoEfetivo` introduzem orçamentos ciclo/gate/defeito; `defeitos.ts:217-232` só três estratégias (executor/verificador/conciliação). `runner.ts:1969-2048` para em nenhuma estratégia, ciclo sem progresso, maxCycles; resgate outro modelo só existe se verifierComOutroModelo e maxVerifierRepairs>0 (`runner.ts:1784`). Não há decomposição adaptativa do defeito, reparo sistêmico do ambiente ou retorno automático ao INIT/PLAN como alternativas do motor.

7. **Timeout/parcial causa parada antes de tentar continuação localizada.** `runner.ts:999-1018`: timeout de parte não final para imediatamente; na última com escrita julga parcial uma vez. `runner.ts:1997-2000` parcial vermelho chama parada; `runner.ts:1823-1833` mesma sessão/modelo não é retomada, só resgate condicional outro modelo. Uma falha transitória de infraestrutura vira fim da execução. O controle de custo precisa impedir loop idêntico sem impor falha antes de estratégias materialmente diferentes.

8. **Protocolo de auditor paralisa código potencialmente correto.** `runner.ts:1276-1306` uma única repetição para revisão ilegível/incompleta; após isso pararInconclusiva -> falha fase -> exit3. `gates.ts:303-337` formalismo de TASK quantidade/índices vira gate do produto. Separar resposta ilegível de defeito de código e usar recuperação de protocolo sem devolver editor à implementação.

9. **Upstream automático não acontece.** `runner.ts:1654-1663` INIT explicitamente desabilitado; PLAN gera pacote e retorna falha. `upstream.ts:228-282` entrada confere/mostra/registra escopo, não edita documento nem retoma build. `runner.ts:1940-1952` pacote válido mantém build parado nas retomadas. A reconstrução precisa mudanças de plano locais e versionadas por impacto, com pergunta só para intenção realmente ambígua.

10. **Aceitação não corresponde a todas modalidades/ecossistemas.** `acceptance.ts:120-139` Rust/Go só build, .NET console e desconhecidos sem passos; `acceptance.ts:403-405` sem passos e sem smoke accepted=true. Desktop .NET aceita processo vivo 10 segundos (`acceptance.ts:225-240`), e `build.ts:1298-1309` converte fluxos de janela não percorridos em provados por essa subida. Não prova comportamento de cadastro/exportação/salvamento. Drivers de modalidade precisam checks proporcionais ao comportamento e evidência honesta de limitações.

11. **Ambiente usa npm e runtime do harness como padrão estrutural.** `worktree.ts:881-894` ignora packageManager/pnpm/yarn e só produz npm ci/install; `acceptance.ts:154-157` novamente npm install; `prerequisites.ts:123-158` compara engines ao process.version do harness e manda escolher versões compatíveis com ele; `runner.ts:2233-2240` manda reiniciar harness com versão compatível em vez de provisionar runtime isolado. `environment-prepare.ts` prepara Node/composer por diretório; outras linguagens recaem em agente. Separar runtime da ferramenta, runtime de build do produto e runtime de teste.

12. **Adoção do próprio preparo cria burocracia estrutural.** `prepared-dependencies.ts:17` campos autorizados de package.json excluem scripts, engines, packageManager, workspaces. `apurar` exige arquivo novo não versionado e hash exatamente registrado. `adoptPreparedDependencies:344-348` uma entrada pendente inelegível impede adotar todo preparo. `build.ts:582-596` para antes das fases se preparação deixou árvore suja. Uma sessão que cria manifesto funcional com scripts pode satisfazer readiness e ainda parar por não ser manifesto mínimo. Necessita transação de preparação em workspace próprio com manifesto real do plano, não proveniência ad hoc depois.

13. **Falha de ferramenta na aceitação não recebe recuperação.** `build.ts:1340-1341` loop de reparo só natureza produto; scriptFailed/toolMissing de G4 viram ferramenta (`build.ts:1311-1314`) e final inconclusivo. `flows.ts:1243-1270` tenta reescrever roteiro uma vez e termina; browser preflight também poucas tentativas classificadas por regex. Isso contraria continuar pelos recursos disponíveis, embora seja correto não mandar alterar produto por falha da ferramenta.

14. **Erros comuns ainda escapam do mecanismo.** `RegistroDeDefeitos.abrir` (`defeitos.ts:398`) JSON.parse rejeitado não tem catch de parse; `relatorio.ts:81` também. `runner.ts:2319` relança todo erro não reconhecido por quatro classes próprias; `paralelo.ts:918-919` preserva e relança erro inesperado. Escritas/log/memória/callback podem derrubar execução sem recovery tipado. Leitura de JSON truncado precisa recuperar último estado íntegro e relatórios não podem comandar parada do motor.

15. **Estado proliferado aumenta autoridade ambígua.** build usa events.tsv + run.json + handoffs/fases.json + handoffs/tasks.json + evidence.jsonl + defects/Pxx.json + handoffs por defeito/ciclo + checkpoints de integração + preparação por sessão. Comparações de hash/documento/runtime/ambiente precisam manter todas camadas em sincronia. Identidade de run é hash do plano inteiro (`build.ts:309`), por isso surgem caches entre runs e regras legadas. Reconstruir um estado transacional pequeno + diário de operações recuperáveis, sem importar formatos atuais.

16. **Conferências de Git podem parar por atividade externa benigna.** fotografiaRefs compara tags/remotes e build preparação trata qualquer ref movida como violação (`build.ts:539-549`). No paralelo HEAD de principal recebido fora integrador é fatal (`paralelo.ts:315-329,901-914`); guardas ajudam não sobrescrever alheio, mas retorno é sempre usuário inspecionar e rerodar. Proteção de dados deve continuar como requisito em implementação nova; não propor reaproveitar esses motores. Evitar atribuir autor sem evidência: runner mensagem admite não saber quem escreveu.

17. **Serial e paralelo têm comportamentos diferentes.** build serial keepGoing continua fases em ordem sem consultar DAG (`build.ts:1170-1214`), enquanto paralelo bloqueia dependentes (`paralelo.ts:855-860`). No scheduler do paralelo, fase 1 é adicionada como dependência de todas (`escalonador.ts:98-103`), ainda que plan diga none. A nova agenda única deve consumir DAG validado do PLAN e aplicar mesmas regras a um ou vários agentes.

18. **Clean room não é cópia do commit.** `acceptance.ts:423-427` cp copia árvore corrente por blacklist EXCLUDED, inclusive arquivo não versionado não listado, ao contrário do comentário que afirma a partir do commit. Além disso defaults de shell bash/which e comandos Unix (`acceptance.ts:248; gates.ts:129; prerequisites.ts:108`) não oferecem execução Windows nativa do harness. Isso não impede gerar um alvo Windows em Linux, mas precisa esclarecer host vs target e matriz da aceitação.

19. **A conferência de roteiro aceita passos e asserções que só existem em comentários.** `flows.ts:143-174` usa includes/matchAll sobre texto sem análise da árvore sintática e sem excluir comentários. Reproduzido com função real: um único test executa somente page.goto('/'); todos os três test.step e três expect ficam dentro de /* ... */; checkFlowScript retorna []. Isso mostra falso positivo na própria condição mecânica de existência dos passos, além da limitação semântica reconhecida no comentário da função. Um navegador real executaria esse script sem fazer cadastro/salvamento/reabertura declarados. A prova da reprodução foi apenas a conferência estrutural, sem instalar/rodar Playwright. Novo motor precisa prova de observação do comportamento pelo driver e auditor, sem um compilador próprio parcial baseado em regex.

## Evidências executadas

/tmp/novoharness-repro-build.ts, bundle .mjs e saída .log. Execução única offline por funções reais; stubs só para provider e comandos externos. Não se adicionou teste ao repositório. Casos TUI/browser, comando de aceitação por ecossistema, gate3 memória e orçamento de contexto. Reprodução pura adicional /tmp/novoharness-repro-flow-policy.ts (.mjs) comprova aceitação de passos e assertivas comentados; nenhum navegador ou provedor acionado.

## Direção para o motor inteiramente novo (nenhum reaproveitamento)

- Contrato do pedido com modalidade e targets tipados; INIT resolve lacunas reais usando drivers por modalidade, sem catálogo web universal.
- PLAN publica primeiro grafo de dependências de runtime/SDK/pacotes/serviços e grafo de fragmentos; cada fragmento contém capacidade pequena, contratos consumidos e produzidos, arquivos relevantes, critérios observáveis e forma suficiente de comprovação.
- BUILD agenda fragmentos, provisiona ambiente isolado por receita e executa editor->checagem suficiente->revisão cooperativa. Auditor devolve defeito demonstrável+local+causa provável+menor reparo+checagem, e motor orienta editor com apenas essa fatia.
- Recuperação tipada compartilha mesmo caminho para init/plan/build: parse/protocolo, transporte, ambiente, implementação, premissa/plano, integração. Retry transitório com backoff; contexto menor/continuação; localizar causa; corrigir ambiente; ajustar fragmento/plano local preservando intenção; trocar provider/modelo autorizado; continuar independentes quando permitido. Parar somente quando houver impossibilidade real e comprovada de continuar; pergunta material pendente provoca espera e avanço independente quando possível, e autorização define quais recursos estão disponíveis. Checkpoint não justifica parada.
- Testes por risco/comportamento, não por contagem. Dedupe comando+conteúdo+ambiente. Compilação/smoke suficiente para trivial; regressão para falhas relevantes; checks focados para contrato afetado; integração quando atravessa componentes/armazenamento/plataforma. Ausência de teste não é falha por si só e qtd mínima/máxima não é gate.
- Driver TUI usa PTY+entrada teclas+dimensões+estado de tela; web navegador quando necessário; desktop build/launch e verificação nativa disponível para alvo, sem dizer que processo vivo prova fluxos não executados.
- Conforme esclarecido pelo usuário, 99% significa usar todo esforço aplicável para salvar a execução, parando somente se impossível continuar; não criar meta estatística ou teste de contagem. Definir recursos autorizados para troca de provider e execução por alvo.

## Perguntas ao usuário que afetam arquitetura

1. O harness precisa rodar nativamente em Windows/macOS ou somente gerar produtos para esses alvos a partir de Linux?
2. Pode trocar automaticamente modelo/provider ou só dentro de catálogo e teto de custo previamente autorizados? Como proceder ao teto de custo enquanto há alternativa técnica?
3. Runtime/SDK/pacotes de sistema podem ser provisionados automaticamente em ambiente isolado; instalação host/sudo é sempre autorizada ou precisa política inicial?
4. Alvo não executável no host: provisionar runner/VM externa, permitir entrega marcada como não validada naquela plataforma, ou aguardar validação na plataforma?

## Inventário de fontes lidas

| arquivo | linhas |
|---|---:|
| capivara/packages/core/src/loop/acceptance.ts | 516 |
| capivara/packages/core/src/loop/admissao.ts | 347 |
| capivara/packages/core/src/loop/ambiente.ts | 163 |
| capivara/packages/core/src/loop/arquitetura.ts | 133 |
| capivara/packages/core/src/loop/autoridade.ts | 125 |
| capivara/packages/core/src/loop/build.ts | 1545 |
| capivara/packages/core/src/loop/defeitos.ts | 716 |
| capivara/packages/core/src/loop/dependencias.ts | 139 |
| capivara/packages/core/src/loop/entrega.ts | 84 |
| capivara/packages/core/src/loop/environment-plan.ts | 124 |
| capivara/packages/core/src/loop/environment-prepare.ts | 68 |
| capivara/packages/core/src/loop/escalonador.ts | 211 |
| capivara/packages/core/src/loop/escolha.ts | 20 |
| capivara/packages/core/src/loop/evidencias.ts | 245 |
| capivara/packages/core/src/loop/flow-network.ts | 83 |
| capivara/packages/core/src/loop/flows.ts | 1371 |
| capivara/packages/core/src/loop/fora-do-projeto.ts | 72 |
| capivara/packages/core/src/loop/gates.ts | 372 |
| capivara/packages/core/src/loop/git.ts | 523 |
| capivara/packages/core/src/loop/handoff.ts | 193 |
| capivara/packages/core/src/loop/impacto.ts | 79 |
| capivara/packages/core/src/loop/index.ts | 55 |
| capivara/packages/core/src/loop/instalacao-node.ts | 126 |
| capivara/packages/core/src/loop/isolamento.ts | 100 |
| capivara/packages/core/src/loop/ledger.ts | 100 |
| capivara/packages/core/src/loop/narrador.ts | 130 |
| capivara/packages/core/src/loop/parada.ts | 372 |
| capivara/packages/core/src/loop/paralelo.ts | 927 |
| capivara/packages/core/src/loop/partes.ts | 117 |
| capivara/packages/core/src/loop/passagem.ts | 363 |
| capivara/packages/core/src/loop/ports.ts | 18 |
| capivara/packages/core/src/loop/preflight.ts | 206 |
| capivara/packages/core/src/loop/prepared-dependencies.ts | 353 |
| capivara/packages/core/src/loop/prerequisite-workspace.ts | 185 |
| capivara/packages/core/src/loop/prerequisites.ts | 313 |
| capivara/packages/core/src/loop/progress.ts | 62 |
| capivara/packages/core/src/loop/ratelimit.ts | 93 |
| capivara/packages/core/src/loop/readiness-probe.ts | 16 |
| capivara/packages/core/src/loop/relatorio.ts | 227 |
| capivara/packages/core/src/loop/runner.ts | 2334 |
| capivara/packages/core/src/loop/split.ts | 72 |
| capivara/packages/core/src/loop/test-databases.ts | 34 |
| capivara/packages/core/src/loop/testcmd.ts | 261 |
| capivara/packages/core/src/loop/upstream.ts | 284 |
| capivara/packages/core/src/loop/veredictos.ts | 227 |
| capivara/packages/core/src/loop/worktree.ts | 900 |

## Avaliação dos testes existentes (leitura integral; não executados em massa)

- Há testes substantivos de proteção de trabalho e segredos com Git real, especialmente admissibilidade, autoridade, rollback, retomada e isolamento. A necessidade desses comportamentos deve orientar critérios novos; isso não autoriza reaproveitar motores nem transferir a suíte inteira por compatibilidade.
- Casos em runner.spec.ts:99-120 e execucao-progressiva-130.spec.ts:286-305 exigem parada imediata com timeout, em vez de esgotar continuação/localização. verifier-repair.spec.ts:153-171 e 274-287 tornam resposta ilegível após uma repetição uma parada de fase mesmo sem defeito de produto. São contratos atuais em desacordo com o objetivo novo; não são invariantes a preservar.
- preparacao-135.spec.ts:228-235 exige que scripts no manifesto criado pela própria preparação bloqueiem adoção; :456-459 lê o arquivo fonte e testa ausência de nomes de providers por regex. O primeiro congela burocracia estrutural e o segundo é inspeção de implementação, sem provar funcionamento independente de providers. Remover esses contratos na reconstrução, sem criar teste para contar sua remoção.
- execucao-progressiva-130.spec.ts:577-599 fixa limite de 48.000 caracteres e testa que contexto fixo de 60.000 eleva limite a 76.000. Isso valida determinismo da política atual, não aderência à janela do modelo. :373-384 exige auditor receber todas as doze tasks de uma vez.
- escalonador-contrato.spec.ts compara duas implementações de dependência efetiva; eliminar duplicidade no desenho novo elimina a necessidade deste teste de paridade.
- Muitos testes de prompts verificam substrings de instruções. Exemplos runner.spec.ts:520-533, 570-592; não provam que o motor prepara entrada correta para uma TUI nem que restrições são executáveis.
- integration/catalog.spec.ts:774-790 (B17) anuncia teste de suíte vermelha mas não cria manifesto de teste; permite saída 0 ou 3 e não comprova execução de suíte nem a causalidade descrita no título. Casos do catálogo que só verificam um pedaço do prompt também não validam comportamento do processo.
- flows.spec.ts:48-58 cria como roteiro bom o mesmo page.goto e page.title para todos os passos, independentemente do objetivo. :122-124 aprova essa prova genérica. A reprodução comentada evidencia lacuna maior que a semântica; não se deve produzir mais uma cascata de regex e testes para congelá-la.
- cooperacao-133.spec.ts contém a expectativa de que fluxo nativo não percorrido fique provado pela subida da janela. Refazer critério de prova por plataforma, sem herdar aceitação sem evidência.
- Não encontrei neste recorte teste literal para contar redução da quantidade de testes. Há testes de limites, textos, paridade e política que reforçam comportamento antigo. A análise não atribui ao código um teste inexistente só porque o exemplo foi dado pelo usuário.

## Inventário de testes e fixture lidos integralmente

| arquivo | linhas | cobertura |
|---|---:|---|
| capivara/packages/core/test/integration/catalog.spec.ts | 1318 | integral |
| capivara/packages/core/test/integration/cwd-do-executor.spec.ts | 58 | integral |
| capivara/packages/core/test/integration/direct-api-cli.spec.ts | 74 | integral |
| capivara/packages/core/test/integration/engine-envelope.spec.ts | 124 | integral |
| capivara/packages/core/test/integration/opencode-v2.spec.ts | 196 | integral |
| capivara/packages/core/test/integration/reinicio-g4.spec.ts | 329 | integral |
| capivara/packages/core/test/integration/verifier-repair-cli.spec.ts | 193 | integral |
| capivara/packages/core/test/integration/workspace-claude.spec.ts | 103 | integral |
| capivara/packages/core/test/loop/acceptance.spec.ts | 385 | integral |
| capivara/packages/core/test/loop/admissao.spec.ts | 423 | integral |
| capivara/packages/core/test/loop/ambiente.spec.ts | 213 | integral |
| capivara/packages/core/test/loop/autoridade.spec.ts | 463 | integral |
| capivara/packages/core/test/loop/build-state.spec.ts | 69 | integral |
| capivara/packages/core/test/loop/commit-admitido.spec.ts | 154 | integral |
| capivara/packages/core/test/loop/contradicao-plan-build.spec.ts | 191 | integral |
| capivara/packages/core/test/loop/cooperacao-133.spec.ts | 476 | integral |
| capivara/packages/core/test/loop/defeitos.spec.ts | 269 | integral |
| capivara/packages/core/test/loop/dependencias-versionadas.spec.ts | 126 | integral |
| capivara/packages/core/test/loop/dependencias.spec.ts | 123 | integral |
| capivara/packages/core/test/loop/desktop-na-aceitacao.spec.ts | 162 | integral |
| capivara/packages/core/test/loop/environment-preflight.spec.ts | 347 | integral |
| capivara/packages/core/test/loop/escalonador-contrato.spec.ts | 33 | integral |
| capivara/packages/core/test/loop/escalonador.spec.ts | 129 | integral |
| capivara/packages/core/test/loop/escolha.spec.ts | 22 | integral |
| capivara/packages/core/test/loop/execucao-progressiva-130.spec.ts | 759 | integral |
| capivara/packages/core/test/loop/fixtures-roteiro-sufo.txt | 121 | integral |
| capivara/packages/core/test/loop/flows.spec.ts | 1228 | integral |
| capivara/packages/core/test/loop/gates.spec.ts | 361 | integral |
| capivara/packages/core/test/loop/instalacao-node.spec.ts | 88 | integral |
| capivara/packages/core/test/loop/integracao-ambiente.spec.ts | 267 | integral |
| capivara/packages/core/test/loop/integration-recovery.spec.ts | 280 | integral |
| capivara/packages/core/test/loop/interrupted-worktree.spec.ts | 63 | integral |
| capivara/packages/core/test/loop/parada.spec.ts | 243 | integral |
| capivara/packages/core/test/loop/paralelo.spec.ts | 1348 | integral |
| capivara/packages/core/test/loop/planning-version.spec.ts | 107 | integral |
| capivara/packages/core/test/loop/preflight.spec.ts | 218 | integral |
| capivara/packages/core/test/loop/preparacao-131.spec.ts | 436 | integral |
| capivara/packages/core/test/loop/preparacao-135.spec.ts | 741 | integral |
| capivara/packages/core/test/loop/preparacao-fora-do-projeto.spec.ts | 120 | integral |
| capivara/packages/core/test/loop/prepared-dependencies.spec.ts | 72 | integral |
| capivara/packages/core/test/loop/prerequisites.spec.ts | 432 | integral |
| capivara/packages/core/test/loop/prompts.spec.ts | 261 | integral |
| capivara/packages/core/test/loop/readiness-probe.spec.ts | 36 | integral |
| capivara/packages/core/test/loop/runner.spec.ts | 671 | integral |
| capivara/packages/core/test/loop/sessao-nova-antes-da-falha.spec.ts | 147 | integral |
| capivara/packages/core/test/loop/test-processes.spec.ts | 73 | integral |
| capivara/packages/core/test/loop/veredictos.spec.ts | 190 | integral |
| capivara/packages/core/test/loop/verifier-repair.spec.ts | 499 | integral |
| capivara/packages/core/test/loop/vnext-arquitetura.spec.ts | 307 | integral |
| capivara/packages/core/test/loop/vnext-entrega.spec.ts | 269 | integral |
| capivara/packages/core/test/loop/vnext-evidencias.spec.ts | 171 | integral |
| capivara/packages/core/test/loop/vnext-recuperacao.spec.ts | 350 | integral |
| capivara/packages/core/test/loop/vnext-relatorio.spec.ts | 122 | integral |
| capivara/packages/core/test/loop/vnext-revisao.spec.ts | 281 | integral |
| capivara/packages/core/test/loop/vnext-upstream.spec.ts | 326 | integral |
