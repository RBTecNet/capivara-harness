# Dashboard da execução — 0.9.0_RC1

O dashboard foi implementado sobre os motores novos. O wizard de início continua separado. O dashboard não exibe mascote nem nome da aplicação.

## Conteúdo e navegação

Sete áreas apresentam resumo, progresso, fases, ambiente, atividade, log e pendências. Terminais menores usam prévias compactas. Tab/Shift+Tab, setas horizontais, números de 1 a 7 ou clique selecionam uma área; Enter abre seu conteúdo integral sobre o dashboard. Esc restaura a posição anterior da visão compacta. Todas as áreas aceitam rolagem por setas verticais, PgUp/PgDn e Home/End. A roda do mouse percorre a área sob o ponteiro.

Logs e atividade acompanham novas entradas até o usuário percorrer o histórico. End retoma esse acompanhamento. A área ampliada continua recebendo atualizações. Perguntas reais podem ser respondidas no próprio painel; `a` reabre uma decisão pendente e Esc permite prosseguir com trabalho independente.

`init`, `plan`, `build` e `run` ativam o dashboard quando entrada e saída são TTY. `--no-dashboard`, `--json` e `CAPIVARA_LINE_INPUT=1` preservam a saída por linhas ou JSON. `capivara dashboard --project PASTA` abre um acompanhamento independente; `--json` exporta o conteúdo dos painéis. Sem TTY, a consulta imprime o conteúdo disponível e termina.

## Progresso e continuidade

INIT informa leitura e fragmentação dos insumos; PLAN informa grupos técnicos e tarefas; BUILD informa ambiente, tarefas, edição, verificações e revisão. A leitura da base documental e a preparação dos arquivos de entrada também emitem progresso. Contagens só aparecem quando medidas. Uma operação sem total conhecido usa uma barra animada sem percentual estimado. Não há chamada adicional de modelo para calcular progresso, nem novas exigências de testes para o produto.

O modelo da interface mantém o conteúdo integral separado das prévias. O diário é percorrido em páginas, sem limitar o histórico aos últimos eventos. O acompanhamento independente lê SQLite sem tomar a posse do construtor; registrar uma resposta explícita é sua única escrita no estado.

`q` oculta a interface da execução, que continua em saída por linhas. Ctrl+C é o cancelamento explícito. No acompanhamento independente, ambos fecham somente o painel. Falhas nos observadores não provocam nova edição, nova chamada de modelo ou encerramento do motor. O terminal restaura cursor, modo de entrada, mouse e tela anterior ao fechar.

## Evidência desta alteração

Os cenários locais cobrem navegação, redimensionamento, conteúdo integral, barras com total conhecido e desconhecido, perguntas, restauração do terminal e tolerância a observadores que lançam exceções durante um fluxo completo com agente simulado. Não são verificações de frases de prompt nem metas sobre quantidade de testes.

A verificação manual usou PTY real no Linux com 60 fases e 1.401 entradas de log. Foram conferidos seleção das áreas, primeira e última entradas, instruções e critérios completos das fases, rolagem, expansão, atualização enquanto a janela estava ampliada, ausência de marca/mascote e restauração do terminal após sair. Essa execução visual usou dados sintéticos e não fez inferência paga. O resultado e a execução da suíte constam em [validacao-0.9.0_RC1.json](validacao-0.9.0_RC1.json).
