# Motor novo: mapa operacional

Versão pública `0.9.0_RC1`; pacote `0.9.0-RC1`. Node.js >=24. Os motores anteriores foram removidos, com histórico preservado no Git. Não importar rotinas antigas nem seus arquivos de estado.

## Código

- `packages/core/src/domain`: fatos com origem, modalidade, restrições, lacunas pertinentes, DAG técnico e unidades de trabalho; divisão e reparo de contexto.
- `packages/core/src/execution`: preparação do ambiente, agendamento, editor, prova pertinente, revisor cooperativo e recuperação da causa na execução ativa.
- `packages/core/src/runtime`: chamadas CLI/API, ferramentas reais, processos, isolamento disponível, comandos e pseudoterminal.
- `packages/core/src/wizard`: painel de início, navegação, leitura por linha e comando equivalente.
- `packages/core/src/data-center`: cliente MCP de leitura, projetos, prompts e materiais selecionados.
- `packages/core/src/app`: coordenação das etapas, perguntas, configuração e SQLite transacional.
- `packages/core/src/cli-program.ts`: comandos públicos; `src/version.ts`: versão exibida.

Os contratos TypeScript em `domain/types.ts`, `runtime/types.ts` e `execution/types.ts` são a referência executável dos formatos. Não existe um documento gerado obrigatório para liberar o trabalho.

## Regras de implementação

O pedido e as respostas explícitas do usuário são autoridade. Modalidade do aplicativo e sistemas alvo são dados diferentes do host atual. Uma limitação do verificador não altera o produto solicitado.

Pergunta só existe quando resolve uma lacuna material. Decisão técnica que o motor pode tomar não exige entrevista. Nenhum estágio possui quota de perguntas.

Dependências técnicas são definidas no início do plan. Os agentes recebem pacotes pequenos de contexto. Quando a tarefa não cabe, o plano deve ser dividido e reparado, sem aumentar artificialmente o teto.

O editor constrói e corrige; o revisor ajuda a identificar defeitos materiais. Erro de formato do parecer não causa reedição do código. Teste e validação existem para demonstrar comportamento relevante ou proteger risco real, nunca para satisfazer contagem ou frase.

Falha recuperável é dado para a próxima ação. Corrigir ambiente, transporte, instrumento ou produto na origem; preservar trabalho e provas não afetados. Esperar recurso externo não significa encerrar a execução. Não usar retomada por checkpoint como substituto de recuperação ativa. Cancelamento explícito do usuário continua sendo respeitado.

## Verificação de alterações

Use `npm run check` para build, tipos e cenários locais relevantes. Não invocar provedores pagos automaticamente na suíte. Pilotos reais devem registrar pedido, transporte, resultado e limites da evidência, sem divulgar credenciais nem inventar custo quando o provedor não informa.

A documentação histórica não impõe gates nem regras ao motor novo. A [auditoria](docs/AUDITORIA-RECONSTRUCAO-MOTORES.md) registra defeitos anteriores, e a [entrega](docs/RECONSTRUCAO-0.9.0_RC1.md) registra o que foi implementado e conferido.


## Wizard e origem documental

`capivara` e `capivara wizard` usam o mesmo fluxo inicial, recriado a partir da main sem importar seus motores. O comando impresso volta ao parser público para executar. Defaults explícitos de modelo/raciocínio não herdam silenciosamente valores antigos.

A conexão da base pode reconhecer dados de `~/.capybara/config.json`; isso não é compatibilidade de motores. O projeto guarda seleção e cópia completa dos insumos sem credenciais MCP. Histórico e acervo não selecionado não entram como autoridade. Documentos são fatiados; arquivos de referência são apresentados pelo índice relevante em vez de repetir seus corpos por agente. Uma falha de leitura preserva o material completo anterior.
