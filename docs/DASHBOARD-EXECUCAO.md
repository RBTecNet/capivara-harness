# Dashboard da execução — 0.9.0-rc2

O dashboard foi implementado sobre os motores novos. O wizard de início continua separado. O dashboard não exibe mascote nem nome da aplicação.

## Conteúdo e navegação

Sete áreas apresentam resumo, progresso, fases, ambiente, atividade, log e pendências. Terminais menores usam prévias compactas. Tab/Shift+Tab, setas horizontais, números de 1 a 7 ou clique selecionam uma área; Enter abre seu conteúdo integral sobre o dashboard. Esc restaura a posição anterior da visão compacta. Todas as áreas aceitam rolagem por setas verticais, PgUp/PgDn e Home/End. A roda do mouse percorre a área sob o ponteiro.

A CLI mantém o dashboard em processo separado, com prioridade reduzida quando disponível. O painel lê revisões e eventos do SQLite; o executor não desenha a interface nem envia o histórico por IPC. O log mostra as operações internas observadas e seu tempo decorrido, inclusive quando não há agente ativo. Histórico é indexado e somente linhas visíveis são desenhadas. Medições e limites: [isolamento e desempenho](DASHBOARD-DESEMPENHO.md).

Na visão com três colunas, Resumo, Ambiente e Incidentes ficam à esquerda; Progresso ocupa toda a coluna central; Agentes e atividade, Fases e unidades e Log completo ficam à direita, nessa ordem. Terminais menores conservam a navegação responsiva.

Progresso mostra somente fases P01, P02… e suas threads T01, T02… As fases agrupam visualmente as camadas de dependências do plano; cada thread corresponde a uma unidade de trabalho, na ordem do plano. Esse agrupamento não altera o scheduler. As bolinhas de G0 (sessão), G1 (escrita), G2 (verificações), G3 (revisão) e G4 (fluxos na aplicação, quando aplicável) ficam em colunas fixas alinhadas à direita. `○` cinza indica vazio/aguardando ou não necessário; `◐` amarelo, execução; `●` verde, concluído; `⊗` vermelho, devolvido com erro. Os símbolos também distinguem esses estados sem cores. Uma sessão sem escrita ou uma unidade sem verificação pertinente não reprova.

A hierarquia mantém a mesma ordem nas visões compacta e ampliada, com rolagem para todas as fases e threads. O indicador da fase resume os gates aplicáveis de suas threads: erro prevalece, seguido de execução; concluído exige que todas as threads aplicáveis tenham concluído aquele gate. Os detalhes das unidades continuam em Fases e unidades. Uma devolução permanece visível até esse mesmo passo voltar a executar ou ser resolvido. Alterações invalidam indicadores de provas anteriores. A aprovação do revisor não pinta de verde uma interação nativa ainda pendente. Os eventos incluem unidade, tentativa e revisão do plano para distinguir passagens diferentes; são registros de apresentação, sem novos gates de controle, testes obrigatórios ou chamadas de modelo.

Logs e atividade acompanham novas entradas até o usuário percorrer o histórico. End retoma esse acompanhamento. A área ampliada continua recebendo atualizações. Perguntas reais podem ser respondidas no próprio painel; `a` reabre uma decisão pendente e Esc permite prosseguir com trabalho independente.

`init`, `plan`, `build` e `run` ativam o dashboard quando entrada e saída são TTY. `--no-dashboard`, `--json` e `CAPIVARA_LINE_INPUT=1` preservam a saída por linhas ou JSON. `capivara dashboard --project PASTA` abre um acompanhamento independente; `--json` exporta o conteúdo dos painéis. Sem TTY, a consulta imprime o conteúdo disponível e termina.

## Progresso e continuidade

INIT informa leitura e fragmentação dos insumos; PLAN informa grupos técnicos e tarefas; BUILD informa ambiente, tarefas, edição, verificações e revisão. A leitura da base documental e a preparação dos arquivos de entrada também emitem progresso. Contagens só aparecem quando medidas. Uma operação sem total conhecido usa uma barra animada sem percentual estimado. Não há chamada adicional de modelo para calcular progresso, nem novas exigências de testes para o produto.

O modelo da interface mantém o conteúdo integral separado das prévias. O diário é percorrido em páginas, sem limitar o histórico aos últimos eventos. O acompanhamento independente lê SQLite sem tomar a posse do construtor; registrar uma resposta explícita é sua única escrita no estado.

`q` oculta a interface da execução, que continua em saída por linhas. Ctrl+C é o cancelamento explícito. No acompanhamento independente, ambos fecham somente o painel. Falhas nos observadores não provocam nova edição, nova chamada de modelo ou encerramento do motor. O terminal restaura cursor, modo de entrada, mouse e tela anterior ao fechar.

## Histórico de validação

Os cenários locais cobrem navegação, redimensionamento, conteúdo integral, barras com total conhecido e desconhecido, perguntas, restauração do terminal e tolerância a observadores que lançam exceções durante um fluxo completo com agente simulado. Não são verificações de frases de prompt nem metas sobre quantidade de testes.

A verificação manual usou PTY real no Linux com 60 fases e 1.401 entradas de log. Foram conferidos seleção das áreas, primeira e última entradas, instruções e critérios completos das fases, rolagem, expansão, atualização enquanto a janela estava ampliada, ausência de marca/mascote e restauração do terminal após sair. Essa execução visual usou dados sintéticos e não fez inferência paga. O resultado e a execução da suíte constam em [validacao-0.9.0_RC1.json](validacao-0.9.0_RC1.json).
