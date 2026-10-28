# Reconstrução integral 0.9.0_RC1

Implementação autorizada após a auditoria da base `31828d1`. Branch exclusiva: `rewrite/motores-0.9.0-rc1`. Os motores, contratos, persistência e runtime anteriores foram substituídos; não existe ponte de compatibilidade.

## O que mudou no motor

INIT registra requisitos com fonte literal, modalidade e alvos. Entrevista depende de uma lacuna material e pertinente, com motivo e consequência. Decisões técnicas não viram perguntas obrigatórias. Respostas são salvas antes da próxima pergunta, recebem identidade do produto e podem ser corrigidas sem conservar restrições da resposta anterior. Regras explícitas do repositório ficam separadas do inventário; pedido e respostas atuais têm prioridade.

PLAN publica primeiro as dependências técnicas executáveis. Sondas e preparação são nós de um DAG, reparado na causa quando incompleto ou cíclico. Contratos e fragmentos seguem por grupos pequenos de requisitos. O plano identifica o produto e a revisão, com estados planning/ready distintos; publicação parcial não pode ser usada como plano pronto. Pacotes ocupam metade do contexto disponível para reservar espaço a arquivos, ferramentas e evidências. Um pacote grande é dividido, sem aumentar o limite para fingir que cabe.

BUILD prepara dependências, executa fragmentos e seleciona provas pertinentes. Lockfile inconsistente permite reconciliar instalação, em vez de desfazer o projeto por preferência entre npm ci e install. Falhas repetidas com o mesmo código e a mesma evidência vão a diagnóstico antes de outra edição. Ambiente, instrumento, contrato e produto têm caminhos distintos de recuperação. Corrigir uma receita não redefine o produto. Revisor malformado recebe esclarecimento; não dispara reedição de código correto.

As provas identificam insumos, receita, ambiente, saída e código de retorno. Alteração de manifesto ou dos arquivos relevantes invalida a evidência correspondente. Entradas CLI chegam a stdin. Receitas distintas do mesmo comando preservam suas próprias assertivas. Código de saída intencional diferente de zero é suportado por campo tipado e por critérios humanos reconhecidos. TUI usa PTY real com prontidão, entrada e observação posterior; sonda de prontidão PTY também usa PTY, nunca pipes. Compilar ou manter um processo vivo não comprova interação desktop.

O runtime fornece APIs diretas com ferramentas de arquivo, edição, shell e processos, além dos transportes CLI. Cancelamento prévio não inicia subprocesso; saída parcial e efeitos confirmados sobrevivem a timeout. Ferramentas de arquivo conferem caminhos reais e recusam controle do harness. Isolamento Linux de shell é usado quando disponível. Efeitos HTTP indevidos são reconciliados em todas as chamadas mutáveis, preservando o restante do trabalho; métodos de eventos chamados listen não são confundidos com servidor por seu nome.

A coordenação mantém a execução ativa enquanto recupera recursos ou resolve decisões. SQLite publica estado transacionalmente; o backup inclui respostas ainda não incorporadas ao brief. Banco ocupado não é tratado como corrupção. Posse exclusiva evita dois construtores concorrentes no mesmo projeto, e consultas não liberam posse de outro processo. Falha de observação ou transcrito não derruba a construção.

Não há gate sobre quantidade de testes, frase de prompt, título de parecer ou contagem de chamadas. Não há aprovação tácita de resposta humana. Checkpoint preserva dados; não justifica encerrar a execução por conveniência.

## Verificação da entrega

Build, tipos e 22 cenários comportamentais passaram. Os resultados finais e os pilotos estão registrados em [validacao-0.9.0_RC1.json](validacao-0.9.0_RC1.json). A TUI também concluiu pelo executável instalado, reutilizando a prova vigente, sem nova chamada de modelo; a conferência independente confirmou restauração integral dos atributos do terminal. O comando de verificação é `npm run check`: build, tipos e cenários comportamentais locais. A suíte não chama provedores pagos.

Os pilotos reais usam Codex/gpt-6.1-sol no Linux, conforme recurso já configurado. Um constrói CLI com entrada válida e inválida; outro constrói TUI, recebe tecla em PTY e encerra. Durante o desenvolvimento, os pilotos expuseram falhas do novo verificador e foram interrompidos para aplicar correções do código em execução. Não são apresentados como prova de execução sem intervenção da primeira implementação. Os resultados finais são conferidos com a versão instalada.

As falhas expostas e corrigidas no motor foram: código 2 esperado tratado como falha, critérios de saída em português não interpretados, sonda isTTY executada com pipes e reparo de instrumento enviado prematuramente a replanejamento do produto. A revisão cruzada também corrigiu corrupção falsa por SQLITE_BUSY, colisão de plano entre pedidos, conclusão com decisão pendente, provas invalidadas por edição do revisor e falsos positivos em classificação de comandos/HTTP.

## Instalação e limites

A versão exibida é `0.9.0_RC1`. A versão do pacote é `0.9.0-RC1`, formato SemVer válido. `npm run install:user` instala um tarball empacotado em `~/.local`, sem depender de um link para esta árvore de trabalho.

Esta RC tem pilotos autenticados em Linux com Codex. APIs têm testes de protocolo/ferramentas com respostas controladas; não há piloto pago de cada provedor. Windows/macOS e automação gráfica desktop exigem seus próprios runners; a implementação não declara esses percursos executados neste host. Receitas web/desktop dependem das ferramentas do aplicativo ou da CLI escolhida; não há navegador/controlador gráfico universal embutido. O sandbox nativo de escrita da CLI Codex permite o diretório do projeto, inclusive estado interno; proteção de controle é mais estrita nas ferramentas API e no shell Linux isolado. Isso não equivale a isolamento contra um agente hostil em todos os transportes.

O agendamento desta RC é sequencial por dependências; não se anuncia execução paralela de vários construtores. A superfície nova é init, plan, build, run, config, status, answer e providers. Integrações MCP, comandos auxiliares e a interface administrativa anterior não foram transplantados. README e CAPIVARA.md descrevem o funcionamento atual; documentos antigos estão marcados como históricos.

Recuperação em 99% permanece uma diretriz de continuidade e esforço de reparo. Não há amostra que permita anunciar taxa estatística de 99%, garantia de código sem defeito ou economia percentual. Custo USD só pode ser informado quando fornecido pelo transporte; não foi inventado a partir de tokens.


## Atualização: wizard e data-center

Após a entrega inicial, o wizard de início e o acesso de leitura ao data-center foram recriados a pedido do usuário, consultando a main. Esta atualização substitui a limitação anterior relativa a esses dois componentes; os motores antigos continuam removidos. Detalhes, funcionamento e verificações estão em [WIZARD-BASE-DOCUMENTAL.md](WIZARD-BASE-DOCUMENTAL.md).
