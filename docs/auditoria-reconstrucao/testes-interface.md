# Auditoria adicional — testes da interface de terminal

Leitura integral dos 17 arquivos de capivara/packages/core/test/tui (4.282 linhas). Sem executar suítes ou providers. O código da interface é auditado pelo agente principal; esta frente analisa integralmente os testes e suas consequências para a reconstrução. Todos os testes foram lidos completos, inclusive os grandes wizard.spec.ts (965 linhas), tui.spec.ts (760) e harness-progress.spec.ts (505).

## Resultado

A suíte TUI mistura três classes diferentes: comportamento real de entrada/saída; conferência da projeção visual de eventos; congelamento de decisões dos motores e de frases de interface. Não há fundamento para chamar todas as três de testes desnecessários. A separação útil para reconstrução é o risco do produto que o teste demonstra: não perder resposta, não transformar tecla anterior em decisão, não deixar terminal inutilizável, não vazar controle de terminal, não informar conclusão falsa. A execução antiga e seus números de gates, papéis, fases e budgets não são requisitos do novo sistema.

## Pontos para eliminar no plano de reconstrução

1. **Recomendação de modelo caro tratada como requisito da UI.** test/tui/tui.spec.ts:538-543 exige que as dicas de auditor/verifier incluam “não coloque abaixo do executor” e que não mencionem “barato”. O objetivo atual é construir motores que simplificam trabalho para modelos de diferentes capacidades. Fixar comparação de “nível” de modelo em texto não prova competência do validador, não detecta defeito de código e não deve ser levado ao novo motor. Em novo desenho, capacidades/limites conhecidos determinam tamanho do pacote e estratégia; escolha de custo é explícita do usuário.

2. **Declaração de garantia testada como se fosse garantia.** tui.spec.ts:236-240 só exige que renderDashboard diga “não altera a execução” e “segredos nunca entram”. Isso não testa isolamento da UI nem redaction. Contraste com worker-logs.spec.ts:26-62, que realmente fornece sequências OSC 52, cursor, controles e escape cortado e confere sanitização. A reconstrução deve verificar efeitos e vazamentos nos pontos reais, sem criar um teste para presença da promessa.

3. **A superfície de configuração confirma burocracia de orçamentos e motores.** cli.spec.ts:30-37 congela flags max-cycles, repairs-per-cycle, repairs-per-gate, repairs-per-defect e verifier-resume. wizard.spec.ts:118-130 pede teste/ciclos/reparos antes de executar; :134-305 descreve escolha manual de serial/paralelo, número de workers, modelo de cada worker, permissões por worker e persistência. Essas opções refletem detalhes da implementação, não lacunas do produto que init deveria resolver. No novo núcleo, políticas de orçamento e escalonamento podem ser um conjunto pequeno de preferências explícitas e avançadas, e a rotina divide/agende conforme DAG/capacidade sem entrevista sobre mecanismos internos.

4. **Contrato API→OpenCode induz casos repetidos e uma restrição do motor.** catalogo-build-131.spec.ts (136 linhas), catalogo-minimax-real.spec.ts (86), modelos-do-codex.spec.ts (52) e trechos de wizard.spec.ts e provider/minimax-131 repetem listagem, caixa, variante e indisponibilidade. Parte é integração válida: wizard recebe identificador correto. Parte só congela menu e ordinal (“11” é MiniMax, “3” é OpenCode). No novo sistema, API com ferramentas deve executar pelo próprio harness em vez de exigir tradução indireta para o catálogo de outra CLI. Desenhar novos contratos de capacidade com poucas amostras reais por transporte. Não portar os menus/ordinais antigos.

5. **UI amarrada a pipeline documental e gates específicos.** build-phases.spec.ts:90-100, build-progress.spec.ts:37-105, plan-progress.spec.ts:32-34 e harness-progress.spec.ts:62-114 congelam G0/G1/G2/G3, E/A, RALPH READY e associação por posição de pipeline. Tais testes podem passar enquanto os motores deixam de cumprir o pedido, porque os eventos são produzidos manualmente. Para o novo projeto, a UI consome eventos tipados de trabalho, verificação, recuperação, pergunta e resultado; não interpreta frases de log para avançar estado. Testes novos devem ligar um fluxo real mínimo ao resultado mostrado, além de testar renderer separadamente. Não perpetuar estados antigos por compatibilidade.

6. **Explosão de verificações de aparência.** tui.spec.ts:314-351 verifica centralização do mascote em várias larguras, escolha de imagem por estágio, altura mínima para mostrar imagem. :439-492 confere desenho ASCII, cores, dimensões, recuo, fonte em blocos. Isso tem valor se a aparência for requisito, mas é de menor prioridade que completar init→plan→build e não demanda bloqueio de execução. O plano não precisa recriar todas as combinações cosméticas; escolher poucos exemplos visuais e manter engine independente de renderer. Não remover proteção de terminal com justificativa cosmética: são riscos diferentes.

7. **Escopo de testes versus nome desatualizado.** wizard.spec.ts:665-680 tem título “quem desiste da base escreve o pedido como sempre escreveu”, mas espera resultado null. Isso não demonstra fallback de escrita; demonstra saída. É exemplo de intenção descrita diferente da asserção real. Sem executar o teste, não afirmar falha da suíte; registrar que o caso não prova aquilo que seu título afirma.

## Comportamentos que merecem verificações novas no novo produto

Isto é uma lista de riscos para testes novos, não proposta de reaproveitar código, testes ou motores.

- **Entrada roteirizada preserva ordem e EOF não trava.** line-io.spec.ts:24-73 exercita chegada antes da pergunta, lote, close e pergunta pendente; wizard.spec.ts:469-505 usa Readable/readline reais. Isso detecta falha funcional que poderia desperdiçar uma chamada já paga.
- **Entrada interativa anterior não decide perguntas futuras.** line-io.spec.ts:84-140 distingue terminal e pipe e comprova que teclas anteriores são descartadas no terminal; importante pois decisões viram autoridade do produto. selecao.spec.ts:81-105 exige Enter para confirmar e recusa paste em lista; :131-168 aceita multiline e EOF.
- **Terminal é restaurado ao encerrar.** modal.spec.ts:194-205 verifica raw-mode e sequências de tela/cursor; apresentacao.spec.ts:44-52 confere resultado escrito após sair da tela alternativa. Ainda falta uma prova end to end em PTY para exceção e sinal; a unidade com objetos falsos não prova todo comportamento do terminal real.
- **Saída de ferramenta não controla terminal.** worker-logs.spec.ts:26-62 usa dados hostis, :65-110 limita buffers e separa stdout/stderr e slots. Novo executor deve tratar streaming e redaction antes de UI/arquivos, e observar nunca pode derrubar produção.
- **Pergunta permanece visível enquanto aguarda.** harness-progress.spec.ts:272-315 usa fake timers e executa suspend durante pulso; esse teste demonstra o conflito resolvido, ao contrário de toContain de instrução ao modelo. Deve haver mecanismo novo de ownership da tela e falha de renderer isolada da rotina.
- **Progresso não é fabricado a partir de atividade.** harness-progress.spec.ts:30-48 verifica que evento de escrita atualiza atividade mas não gates; :116-126 soma custo e marca “não medido”. Esse princípio pertence ao novo produto: estimativa e observação têm campos distintos.
- **Foco e contexto da falha não somem da tela.** build-progress.spec.ts:79-87 mantém causa na conclusão falha; build-phases.spec.ts:73-76 conta falhas ocultas; plan-progress.spec.ts:118-136 segue último evento. Uma falha da janela não pode virar bloqueio do motor.
- **Comando apresentado é executável e representa a escolha.** wizard.spec.ts:460-465 confere escape de $, substituição e crase em texto literal. Conferência de argv tem valor real; snapshots de nome/ordem de toda opção antiga não.

## Implicação para o plano novo

A arquitetura deve separar motor e observação por uma fronteira operacional simples: UI recebe eventos e envia resposta/cancelamento; falha de renderer não aborta desenvolvimento. O próprio código atual documenta esse problema em tui.spec.ts:707-712, mas testes de função pura “não lança” (:714-759) não protegem todos os callbacks de IO. O novo motor deve isolar falhas do observador na fronteira, oferecendo saída textual e registro persistente com pouco contexto; a UI não corrige falhas dos motores por mensagens.

Sobre avaliação de aplicações TUI geradas: estes testes são da TUI da ferramenta. Não comprovam que build suporta gerar uma TUI de verdade. A aceitação do novo build precisa de um produto TUI pequeno controlado por PTY, com tecla, foco/estado, redimensionamento quando exigido e encerramento limpo. Usar Playwright para chamar comandos de um CLI não prova comportamento interativo de TUI.

## Inventário integral de leitura
- `capivara/packages/core/test/tui/apresentacao.spec.ts` — 97 linhas — leitura integral.
- `capivara/packages/core/test/tui/build-phases.spec.ts` — 179 linhas — leitura integral.
- `capivara/packages/core/test/tui/build-progress.spec.ts` — 137 linhas — leitura integral.
- `capivara/packages/core/test/tui/catalogo-build-131.spec.ts` — 136 linhas — leitura integral.
- `capivara/packages/core/test/tui/catalogo-minimax-real.spec.ts` — 86 linhas — leitura integral.
- `capivara/packages/core/test/tui/cli.spec.ts` — 63 linhas — leitura integral.
- `capivara/packages/core/test/tui/doctor.spec.ts` — 96 linhas — leitura integral.
- `capivara/packages/core/test/tui/harness-progress.spec.ts` — 505 linhas — leitura integral.
- `capivara/packages/core/test/tui/line-io.spec.ts` — 142 linhas — leitura integral.
- `capivara/packages/core/test/tui/modal.spec.ts` — 220 linhas — leitura integral.
- `capivara/packages/core/test/tui/modelos-do-codex.spec.ts` — 52 linhas — leitura integral.
- `capivara/packages/core/test/tui/parada.spec.ts` — 120 linhas — leitura integral.
- `capivara/packages/core/test/tui/plan-progress.spec.ts` — 159 linhas — leitura integral.
- `capivara/packages/core/test/tui/selecao.spec.ts` — 287 linhas — leitura integral.
- `capivara/packages/core/test/tui/tui.spec.ts` — 760 linhas — leitura integral.
- `capivara/packages/core/test/tui/wizard.spec.ts` — 965 linhas — leitura integral.
- `capivara/packages/core/test/tui/worker-logs.spec.ts` — 278 linhas — leitura integral.
