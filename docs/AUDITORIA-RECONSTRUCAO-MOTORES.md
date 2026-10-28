# Auditoria dos motores init plan e build

Data: 28 de outubro de 2026. Base: `capivara`, commit `31828d1`, versão declarada 0.8.3. A árvore Git estava limpa no início. Este relatório registra a auditoria anterior à reconstrução. As referências de código apontam para a base histórica; a execução posterior está registrada em [RECONSTRUCAO-0.9.0_RC1.md](RECONSTRUCAO-0.9.0_RC1.md).

**O problema é estrutural.** O código não representa a modalidade do produto como autoridade que governa todas as etapas; processos documentais e protocolos textuais comandam a execução; a seleção de verificações é ampla e parcialmente inadequada; e as recuperações existentes terminam antes de esgotar alternativas aplicáveis. Há também caminhos que aprovam sem evidência do comportamento. Mudar a redação de prompts não resolve essas causas.

O [plano de reconstrução integral](PLANO-RECONSTRUCAO-MOTORES.md) substitui os três motores, seus contratos internos e a lógica que decide contexto, preparação, validação, integração e recuperação. Não recomenda reaproveitar nenhum motor atual. Incorpora os esclarecimentos do usuário: perguntas somente para lacunas reais; corrigir invenções do modelo sem derrubar a execução; pedido prevalece sobre instrumentos; checkpoint não justifica parada; somente impossibilidade real e comprovada permite encerrar.

## 1 Cobertura e método

A auditoria percorreu os arquivos originais de produção e testes, identificando produtores, consumidores, condições de ativação, falhas e efeitos. Buscas por símbolos ajudaram a rastrear chamadas; não foram usadas como substituto da leitura. Uma primeira leitura compactada de parte do escopo init/plan foi complementada por releitura dos originais, incluindo comentários e tipos, antes de fechar o inventário.

| Conjunto | Arquivos | Linhas físicas | Tratamento |
|---|---:|---:|---|
| Código de produção em `packages/core/src` | 218 | 50.370 | Leitura integral dos originais e rastreamento entre módulos |
| Código TypeScript de testes e suporte, fora de fixtures | 194 | 45.579 | Leitura integral e avaliação do que cada cenário efetivamente comprova |
| Scripts de build geração e medição do core | 4 | 664 | Leitura integral; sem executar scripts de geração |
| Scripts da medição arquivada | 6 | 312 | Leitura integral; sem executar provedores reais |

Total de código desses conjuntos: 422 arquivos e 96.925 linhas. Manifestos, configuração de build e Vitest também foram lidos. Os 51 arquivos de `test/fixtures` foram inventariados separadamente: são dados de pedidos, planos, respostas e catálogos, sem módulos executáveis. Há ainda uma fixture de transcrito no recorte loop.

`node_modules`, bundles em `dist`, produtos antigos arquivados como evidência e os projetos de referência em `base_harness` não são tratados como código ativo desses motores. Produtos arquivados foram consultados onde demonstram um defeito; não se afirma auditoria integral desses aplicativos. Não há referência a `base_harness` nos fontes/scripts/manifesto de execução examinados. A reconstrução autorizada incide sobre o produto ativo; essa base de referência não foi incorporada ao novo motor.

O [inventário consolidado](auditoria-reconstrucao/inventario-codigo.tsv) registra arquivo, linhas, SHA256 e frente de leitura. Os [relatórios detalhados](#6-relatorios-e-evidencias) preservam as evidências por caminho/linha, as reproduções e as qualificações. Foram executadas reproduções locais com código real e substitutos de operações externas; nenhuma API paga e nenhuma suíte ampla foram executadas nesta auditoria. Leitura de teste não é anúncio de que ele passou.

## 2 Casos centrais confirmados

### O instrumento mandou acrescentar um servidor proibido

Não é somente um risco hipotético. Há uma cadeia verificável nos registros da medição arquivada:

1. O [pedido](medicoes/etapa-0/pedido.txt) exige CLI local e exclui interface web, servidor e serviço permanente.
2. Antes dos reparos de aceitação, o produto termina sem servidor e passa as provas arquivadas correspondentes.
3. O [prompt de reparo 016](medicoes/etapa-0/resultados/B-01/016.prompt.txt) manda o entrypoint escutar `PORT` e responder HTTP porque G4 espera servidor, contrariando o pedido.
4. O [código final da CLI](medicoes/etapa-0/resultados/B-01/produto/src/cli.js) importa `node:http`, cria o servidor e permanece ativo na entrada sem comando com `PORT` definida.
5. O motor declara aceitação. A [prova suplementar final](medicoes/etapa-0/resultados/B-01/restricao-terminal.json) registra timeout após aproximadamente cinco segundos e mensagem de servidor disponível. A prova de ausência de servidor piora de 2/2 antes da aceitação para 1/2 depois.

A causa ativa está em [build.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/loop/build.ts#L1262), [acceptance-policy.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/prompts/acceptance-policy.ts#L60) e [flows.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/loop/flows.ts#L872): uma fatia textual de stack omite a restrição terminal, a execução cai na suposição web e uma falha do instrumento é enviada como defeito do produto. O editor recebe ordem de consertar o aplicativo para satisfazer um verificador inadequado.

**Implicação:** corrigir e substituir a receita de validação automaticamente. O motor novo precisa representar modalidade e restrições, conferir a compatibilidade das ações e dos reparos e inspecionar efeitos relevantes. Não basta escrever “não crie servidor” em outro prompt, nem bloquear o projeto depois de detectar a invenção.

### A entrevista recebe orientação web mesmo para TUI

[writer.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/prompts/writer.ts#L43) possui bloco de aparência com biblioteca de componentes/CSS e hover anexado a todo skeleton. Seu contexto não recebe modalidade tipada. [skeleton.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/contract/skeleton.ts#L102) e [architecture.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/contract/architecture.ts#L102) não têm campos para modalidade/alvos que pudessem governar as decisões posteriores.

Além do texto do prompt, [disponibilidade.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/contract/disponibilidade.ts#L365) monta deterministicamente instruções para percorrer workflows “in a browser”, com páginas/rotas. Isso entra na arquitetura e nas fases. Uma pergunta sobre framework web passa pelo parser se cumprir o formato, sem conferência de pertinência ao produto.

Reprodução com pedido TUI explicitamente sem HTML, navegador ou CSS produziu instruções com CSS framework e hover. O insumo inadequado foi comprovado; não se afirma que toda resposta de todo modelo necessariamente seguirá essa orientação.

**Implicação:** init e plan podem formular zero perguntas. Cada pergunta precisa resolver informação ausente com consequência concreta e capacidade aplicável; nenhuma pergunta é obrigatória por existir uma rotina de entrevista.

### Fluxo de TUI aciona preparação de navegador antes do editor

[build.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/loop/build.ts#L746) prepara browser quando existem workflows no caminho padrão, sem conferir modalidade. [environment-prepare.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/loop/environment-prepare.ts#L30) instala Playwright/Chromium. A reprodução usou uma TUI Rust com um workflow e nenhum requisito de browser: o motor tentou instalar Playwright e terminou com zero chamadas ao editor quando essa instalação simulada falhou.

Há caminhos que injetam runner próprio ou desativam fluxos e não acionam isso. O defeito está no caminho padrão; não se afirma que toda configuração possível de TUI exige navegador.

**Implicação:** grafo de dependências do plan governa a preparação. TUI recebe executor com pseudoterminal; CLI recebe comandos/argumentos; web recebe navegador quando necessário; desktop recebe execução nativa compatível.

### Divergência de instalação provoca desfazer em vez de reconciliar

[worktree.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/loop/worktree.ts#L886) escolhe `npm ci` quando há lockfile não ignorado. Em [paralelo.ts](https://github.com/RBTecNet/capivara-harness/blob/31828d1/packages/core/src/loop/paralelo.ts#L467), a falha por manifesto e lock fora de sincronização leva diretamente a `desfazer`; não há nesse caminho tentativa de reconciliar os arquivos em área isolada e continuar.

Preparação e recuperação de dependências existem em outros caminhos. O diagnóstico não é ausência absoluta de suporte: são escolhas estreitas, procedimentos dispersos e encerramento prematuro.

**Implicação:** decidir instalação pelo estado do projeto e restrições, corrigir a precondição, conferir prontidão e continuar. `npm ci` versus `npm install` não constitui falha crítica nem disputa a levar ao usuário.

## 3 Causas adicionais por etapa

| Causa observada | Evidência no código | Consequência |
|---|---|---|
| init e plan compartilham um orquestrador de 3.844 linhas | `init/plan.ts:17`, `init/orchestrator.ts` | Regras de entrevista, documentação, auditoria, publicação e recuperação misturadas |
| Banco é perguntado incondicionalmente | `init/orchestrator.ts:762`, `interview/banco.ts:77` | Reabre decisão até quando pedido exclui banco |
| Host influencia stack alvo | `interview/plataforma.ts:30` | Recomenda trocar tecnologia nativa pela possibilidade de validação local |
| Lacuna e pergunta são associadas por posição | `init/orchestrator.ts:3191` | Lote parcial/reordenado pode fechar marcador errado |
| Respostas só são gravadas ao fim da rodada | `init/orchestrator.ts:915` | Interrupção no meio perde respostas já dadas |
| Timeout de pergunta do plan pode virar ACCEPTED | `init/orchestrator.ts:688` | Recomendação não respondida passa a autoridade aceita |
| Publicação é atômica por arquivo, não por conjunto | `init/orchestrator.ts:1938`, `change/orchestrator.ts:375` | Queda pode deixar skeleton/arquitetura/plano/estado de gerações diferentes |
| Ambiente é lista sem grafo de preparação | `contract/architecture.ts:63`, `contract/environment.ts:11` | Componentes têm dependências, mas SDK/pacotes/serviços não formam receita executável inicial |
| Autor de fatia ainda recebe pedido inteiro e regras globais | `init/orchestrator.ts:1512`, `contract/skeleton.ts:578` | Fatia não garante pacote pequeno |
| Auditor recebe plano inteiro | `init/orchestrator.ts:3525`, `loop/runner.ts:1231` | Modelo econômico recebe trabalho maior que o editor fragmentado |
| Teto de contexto cresce com conteúdo fixo | `loop/partes.ts:72` | Prompt de 100.200 caracteres pode ser declarado dentro de limite ampliado para 116.000 |
| Sem seleção fina de suíte por impacto | `loop/impacto.ts:46` | Qualquer arquivo de produto alterado atinge a suíte inteira |
| Falhas de protocolo viram fim de fase | `loop/runner.ts:1276`, `loop/gates.ts:311` | Texto inválido/incompleto do verificador pode interromper código correto |
| Retorno ao init desabilitado; ao plan publica pacote e para | `loop/runner.ts:1654`, `loop/upstream.ts:228` | Diagnóstico não se transforma em correção automática na origem e volta ao build |
| Retry do auditor pede três campos, plano exige classe em quatro | `prompts/auditor.ts:116`, `audit/protocol.ts:259`, `audit/admissibilidade.ts:59` | Resposta válida no retry perde classe e achado material é rebaixado |
| Modelo por API não recebe execução de ferramentas do harness | `provider/roles.ts:19`, `provider/adapters.ts:142`, `provider/direct-api.ts:173` | Construção depende de CLI intermediária e seu catálogo |

**Validações amplas não são todas inúteis.** Conferir uma árvore recém integrada ou repetir prova depois de alterar código pode ser necessário. A simplificação deve selecionar pelo que realmente mudou e não apenas remover proteção. O defeito é tornar a suíte global o efeito automático de qualquer alteração e não compartilhar evidência suficiente entre agentes, integração e aceitação.

**Nem toda sonda corrigida viola o pedido.** Trocar uma sonda restritiva por `--version` pode corrigir uma exigência inventada ou apagar uma compatibilidade real. O código não representa adequadamente a proveniência dessa exigência. Presença não prova compatibilidade; Node >=22, por exemplo, não exclui Node 24 por si só. O motor novo deve preservar a exigência verdadeira e provisionar o ambiente compatível.

## 4 Recuperação continuidade e comprovação

O sistema já possui retries de transporte, tratamento parcial de timeouts, reparos de dependências e preservação de trabalho. A auditoria não os confunde com solução completa. O problema é que estratégias aplicáveis se esgotam por regras locais antes de o motor demonstrar impossibilidade de continuar, e várias causas retornam ao usuário como tarefa de diagnóstico ou reinício.

Achados concretos:

- **Pausa paralela pode prender uma chamada.** `commands/build-controls.ts:53` guarda somente um resolver. Reprodução com dois waits retomou apenas o segundo.
- **Snapshot ilegível impede recuperação pelo log.** `state/resume.ts:76` retorna antes de ler eventos se não conseguiu ler snapshot. Reprodução com evento completo e JSON inválido retornou null.
- **Lock sem owner tem janela de disputa.** `state/lock.ts:131` considera órfão o estado que também existe entre mkdir e gravação do dono por processo vivo. Reprodução do estado intermediário confirmou segunda aquisição; frequência real da corrida não foi medida.
- **Instalação depende de TTY na ligação da CLI.** `cli-program.ts:2264` só passa `installPrerequisites` junto dos callbacks interativos. Preparação autorizada e capacidade de fazer pergunta estão acopladas.
- **Limpeza do build não está em finally.** `cli-program.ts:2235–2444`: falha inesperada pode evitar liberação de recursos da interface; resultado também aguarda visualizador aberto.
- **Falha auxiliar pode escapar da rotina.** `mcp/skills.ts:123` faz parse de índice sem proteção; reprodução do índice inválido lançou exceção em caminho offline.
- **Memória pode desaparecer antes do envio confirmado.** `mcp/memoria.ts:149` remove fonte ao coletar; reprodução de envio indisponível confirmou fonte apagada.
- **Cancelamento prévio não impede subprocesso.** `provider/supervisor.ts:115,202`: reprodução com signal já abortado ainda executou o comando.

Também há falhas na evidência positiva:

- `loop/build.ts:1298` promove inicialização desktop a fluxos “provados”, apesar de o percurso nativo não ter sido realizado.
- `loop/acceptance.ts:130` só compila Go/Rust e pode não derivar passo para .NET console/desconhecido. Sem operações e sem smoke, há caminho de aceitação.
- `loop/flows.ts:143` verifica o texto do roteiro com regex; reprodução aceitou todos os passos/assertivas escritos apenas em comentários, com código que só abre uma página.
- O helper de CLI usa pipes de subprocesso, sem PTY para TUI interativa.

**Implicação:** continuidade significa corrigir a causa e produzir o comportamento pedido. Nem manter processo aberto, nem salvar checkpoint, nem receber aprovação textual do auditor demonstram conclusão. A decisão de parada deve ser central, baseada na ausência real de qualquer alternativa aplicável; erro de módulo não deve possuir saída local fatal por conveniência.

## 5 Testes e burocracia

Há três mecanismos diferentes, que precisam ser distinguidos:

1. **Testes do próprio repositório que procuram frases.** `test/prompts/test-policy.spec.ts`, `functional-policy.spec.ts` e vários outros verificam que a instrução existe, não que o motor reduziu verificações desnecessárias. `test/architecture.spec.ts` conta construções de UI no fonte e exige exatamente uma dependência de runtime. Isso congela implementação ou texto.
2. **Tetos de chamadas em cenários.** `test/architecture/orcamento-de-prova.spec.ts` compara número de chamadas por papel com valores históricos. Não conta testes do aplicativo, e não executa como gate de cada produto gerado.
3. **Gate de produção sobre prosa de testes.** `contract/test-prescription.ts` emite I-16; `init/orchestrator.ts:3317` reabre escrita; `init/readiness.ts:122` impede prontidão. Esse é um bloqueio real do motor baseado em prescrição/menção textual, sem determinar quais verificações seriam suficientes para o produto.

Não foi encontrado um gate de produção que conte os testes do aplicativo e reprove porque seu número não diminuiu. A queixa tem correspondência concreta em testes meta e, mais gravemente, nos bloqueios lexicais e nas repetições estruturais; não é necessário inventar um contador inexistente para demonstrar o problema.

Há ainda cenários que não exercitam o que o título afirma: B-17 do catálogo não executa uma suíte real naquele arranjo e aceita resultados distintos; um cenário de convergência roteia chamadas para subjects que o orquestrador atual não usa. Uma suíte grande pode passar sem demonstrar as propriedades alegadas.

Outros testes demonstram riscos reais: perda de dados, quebra de contrato, segredo exposto, processo órfão, EOF travado, tecla antiga decidindo nova pergunta e terminal não restaurado. Esses riscos merecem verificações novas na reconstrução; isso não é proposta de portar testes ou preservar motores.

**Implicação:** a reconstrução remove quotas e censura de prosa, seleciona verificações no motor e mede resultado útil. Não cria teste de diminuição de testes. Corrige o produto ou a ferramenta responsável, sem transformar opinião, aparência ou formato de veredito em interrupção.

## 6 Relatórios e evidências

- [Init plan contratos entrevista e contexto](auditoria-reconstrucao/init-plan.md): 25 achados, fluxo real, reproduções e inventário específico.
- [Build ambiente validação integração e recuperação](auditoria-reconstrucao/build.md): 19 achados, leitura dos testes e reproduções.
- [Runtime auditoria prompts provedores e MCP](auditoria-reconstrucao/runtime-auditoria.md): 14 achados, seis reproduções locais e rastreamento de consumidores.
- [Entradas estado e interface](auditoria-reconstrucao/entrada-estado-interface.md): 20 observações, três reproduções e consequências da ligação CLI/motor.
- [Testes da interface de terminal](auditoria-reconstrucao/testes-interface.md): distinção entre efeito real, projeção e congelamento de texto.
- [Revisão cruzada e caso histórico](auditoria-reconstrucao/revisao-cruzada.md): qualificações, causalidade do servidor indevido e limites das medições.
- [Resultados locais de runtime](auditoria-reconstrucao/resultados-runtime.json) e [resultados locais de build](auditoria-reconstrucao/resultados-build.txt).

Os relatórios se sobrepõem em alguns caminhos; os números de achados não devem ser somados como se fossem defeitos independentes. Algumas observações são riscos ou limitações de desenho, identificados como tais; reproduções não medem sua frequência em produção.

A medição histórica arquivada mostrou, naquela única amostra, 129 segundos/uma sessão no braço direto e 972 segundos/18 sessões no core. Não há custo USD reportado nem base para afirmar uma economia financeira percentual futura. É evidência concreta de retrabalho e regressão naquela execução, não taxa geral de desempenho. Esta auditoria não repetiu a medição paga.

## 7 Direção da reconstrução

A conclusão é reconstruir integralmente, conforme solicitado. O plano novo precisa corrigir seis decisões de raiz: modalidade e restrição com autoridade; entrevista por lacuna real; dependências executáveis no início do plan; contexto pequeno em todos os papéis; auditoria cooperativa com verificação proporcional; e recuperação automática que somente encerre diante de impossibilidade comprovada.

Não haverá camada de prompts compensatórios sobre os motores atuais, nem novo certificado documental para permitir continuar. O usuário não deve editar arquivos de controle ou reiniciar a cadeia para resolver uma invenção do modelo. A implementação nova corrige a origem, preserva o trabalho correto e prossegue.
