# Capivara 0.9.0_RC1

Constrói aplicativos web, desktop, TUI, CLI, APIs e bibliotecas por unidades pequenas de trabalho. Os motores de init, plan e build foram reconstruídos integralmente, sem compatibilidade com os motores ou arquivos de controle anteriores.

O pedido governa a execução. Uma convenção do validador não autoriza mudar o produto. Falhas de ferramenta, instalação, transporte ou formato de parecer são tratadas na execução ativa; o trabalho correto é preservado. A referência a recuperação em 99% expressa esse compromisso, não uma taxa estatística já medida.

## Instalação

Requer Node.js 24 ou superior e npm. No Linux, uma TUI pode ser verificada com o utilitário `script`; `node-pty` é uma dependência opcional para PTY nos sistemas suportados. O executor não declara uma TUI validada quando só recebeu pipes comuns.

```sh
npm install
npm run build
npm run install:user
capivara --version
```

A saída de versão é `0.9.0_RC1`. O pacote npm usa `0.9.0-RC1`, equivalente válido em SemVer. Garanta que `~/.local/bin` esteja no PATH.

## Uso

Abra o wizard com `capivara` ou `capivara wizard`. O painel mantém a experiência da `main`: pasta, init/plan/build, origem do pedido, provider/modelo/raciocínio, revisor e comando equivalente antes de executar. Use setas ou números, Enter para confirmar e Esc para voltar. Texto aceita colagem com várias linhas; credenciais ficam ocultas. Também há modo por linha para pipes e `CAPIVARA_LINE_INPUT=1`.

Para usar os comandos diretamente, escolha um transporte já instalado e autenticado, ou configure uma API:

```sh
capivara config --provider codex --model SEU_MODELO
capivara run --project ./meu-aplicativo --file ./pedido.txt
```

Para uma API, a ferramenta executa o ciclo de ferramentas de arquivos, comandos e processos, sem exigir outra CLI:

```sh
export OPENAI_API_KEY=...
capivara config --provider openai --model SEU_MODELO
capivara run --project ./meu-aplicativo 'Descreva aqui o produto'
```

Transportes: Codex, Claude Code e OpenCode por CLI; OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek e MiniMax por API; endpoint compatível com `--base-url` e `--api-key-env`. Credenciais de CLI continuam sob responsabilidade da respectiva CLI. A configuração nova fica em `~/.config/capivara/settings.json`, ou em `CAPIVARA_CONFIG_DIR`. A conexão MCP previamente cadastrada em `~/.capybara/config.json` é reconhecida como configuração da base; os motores e estados antigos não são importados.

Você pode executar etapas separadas:

```sh
capivara init --project ./app --file ./pedido.txt
capivara plan --project ./app
capivara build --project ./app
capivara status --project ./app --json
capivara answer ID_DA_LACUNA 'Resposta' --project ./app
```

`run` percorre as três etapas. `build` também completa init/plan se necessário. A entrevista pode ter zero perguntas. Cada pergunta precisa de fato ausente, motivo, consequência e pertinência ao produto. Respostas são persistidas imediatamente. Sem terminal interativo, tarefas independentes prosseguem enquanto lacunas pendentes podem ser respondidas por outro terminal.

O plan registra primeiro a árvore técnica de preparação: runtimes, SDKs, ferramentas, pacotes e serviços com dependências, sondas de prontidão e receitas. Em seguida define contratos e tarefas com arquivos, requisitos, dependências e verificações pertinentes. O build provisiona dependências locais; `--system-install` autoriza preparação no sistema quando necessária. Um lockfile inconsistente pode ser reconciliado por instalação; preferência entre instaladores não vira defeito do aplicativo.

Editor e revisor recebem o fragmento, contratos relevantes, restrições e evidências locais. O revisor aponta defeitos concretos e orienta o reparo. Parecer malformado é esclarecido sem reabrir o editor. Não há obrigação de criar suíte nem metas sobre quantidade de testes. Evidência válida é reutilizada enquanto seus insumos continuam iguais.

## Dashboard da execução

Em um terminal interativo, `init`, `plan`, `build` e `run` abrem automaticamente o dashboard, sem mascote ou nome da aplicação. Ele reúne resumo, progresso, fases, ambiente, atividade, log e pendências. As barras usam contagens observadas; operações sem total conhecido mostram movimento sem inventar uma porcentagem. Para usar saída por linhas, acrescente `--no-dashboard`.

Para acompanhar um projeto em outro terminal ou consultar uma execução concluída:

```sh
capivara dashboard --project ./app
capivara dashboard --project ./app --json
```

Use Tab/Shift+Tab, ←/→, números de 1 a 7 ou clique para selecionar uma área. ↑/↓, PgUp/PgDn, Home/End e a roda do mouse percorrem o conteúdo. Enter amplia a área selecionada e permite ler todo o conteúdo; Esc volta ao dashboard preservando a posição anterior. Em logs e atividade, End volta a acompanhar as entradas novas. A tecla `a` abre uma pergunta pendente.

`q` oculta o dashboard e mantém a construção em andamento; Ctrl+C solicita cancelamento. Na janela de acompanhamento independente, ambos apenas fecham essa janela. Uma falha da interface retorna à saída por linhas sem interromper o motor. Sem TTY, o comando `dashboard` imprime os dados e termina. Veja [detalhes e validação](docs/DASHBOARD-EXECUCAO.md).

## Base documental MCP/data-center

No wizard, a origem do pedido pode ser texto, arquivo, projeto da base documental ou prompt guardado. A lista de projetos vem do servidor configurado, com a quantidade de documentos selecionados. O projeto fornece seu pedido e sua seleção documental; um prompt guardado fornece somente seu texto.

```sh
capivara init --project ./app --mcp https://sua-base.example/mcp --mcp-project meu-projeto --provider codex
capivara init --project ./app --mcp https://sua-base.example/mcp --mcp-prompt meu-prompt --provider codex
```

A conexão existente é reconhecida. Para configurar outra, use `capivara config --mcp URL --mcp-token-env NOME_DA_VARIAVEL`, ou as variáveis `CAPIVARA_MCP_URL`/`CAPIVARA_MCP_TOKEN` e `DOC_CENTER_URL`/`DOC_CENTER_TOKEN`. Tokens salvos acompanham somente seu endpoint; não aparecem no comando equivalente. Endpoints HTTPS usam TLS validado, sem desativação de certificado.

Documentos pertinentes entram no init por fragmentos com sua origem. Skills, scripts, exemplos e anexos são referências em `.project-inputs/`, com índices pequenos por tarefa, sem despejar o acervo nos prompts nem transformar cada linha de código em exigência do aplicativo. Histórico de conversas não se torna pedido atual. Arquivos e materiais selecionados ficam preservados para continuar quando a base estiver temporariamente indisponível; uma leitura parcial não substitui a cópia completa.

A pasta de insumos é ignorada no Git do aplicativo. O editor deve copiar para o produto os recursos que ele efetivamente usa. `build` retoma a seleção já registrada; para trocar para pedido local, forneça novo texto ou `--file`.

## Continuidade e estado

O estado novo fica em `.capivara-next/`: SQLite transacional, respostas, eventos, cópia de recuperação e transcritos das chamadas. Inclua essa pasta no `.gitignore` de seus aplicativos. O estado guarda o pedido e dados do projeto; trate-o como informação privada.

Uma falha transitória mantém a execução ativa. Instalação, instrumentos e produto têm reparos distintos. Uma receita web inadequada para terminal é corrigida no instrumento; um servidor indevido introduzido pelo editor é removido dos arquivos afetados, preservando o restante do trabalho. Checkpoint serve à preservação, não como justificativa para interromper.

Cancelamento explícito por Ctrl+C é respeitado. Falta de credencial, rede, resposta humana ou runner nativo mantém pendência explícita; não é sucesso nem defeito fictício do código. A configuração pode ser atualizada por `capivara config` em outro terminal. Nunca se declara prova nativa de Windows/macOS a partir de uma compilação Linux.

## Limites desta RC

O piloto real desta entrega usa Codex no Linux. APIs têm testes de protocolo e ferramentas locais, sem inferência paga em todos os provedores. A disponibilidade dos outros transportes depende da instalação e autenticação do usuário. Receitas web e desktop usam ferramentas do projeto ou da CLI selecionada; não há um navegador ou controlador gráfico universal embutido. Alvos nativos exigem runner compatível para evidência de comportamento.

A superfície contém `wizard`, `init`, `plan`, `build`, `run`, `dashboard`, `config`, `status`, `answer` e `providers`. O wizard e o acesso à base MCP foram recriados sobre os motores novos; `change`, `survey`, `prompt-engineer` e construtores paralelos antigos continuam fora desta RC. Os documentos antigos em `docs` estão marcados como históricos. Não há camada de compatibilidade com a versão 0.8.x.

## Desenvolvimento e evidências

```sh
npm run check
```

A suíte nova exercita riscos de comportamento: autoridade do pedido, contexto limitado, persistência, recuperação cooperativa, instalação, cancelamento, ferramentas e PTY real. Ela não testa frases de prompts nem exige uma quantidade de testes.

- [Auditoria integral do código anterior](docs/AUDITORIA-RECONSTRUCAO-MOTORES.md)
- [Plano de reconstrução](docs/PLANO-RECONSTRUCAO-MOTORES.md)
- [Implementação e validação da RC](docs/RECONSTRUCAO-0.9.0_RC1.md)
- [Mapa operacional do código novo](CAPIVARA.md)

Detalhes da restauração do wizard e da base: [WIZARD-BASE-DOCUMENTAL.md](docs/WIZARD-BASE-DOCUMENTAL.md). A rota Gemini usa a [compatibilidade OpenAI oficial do Google](https://ai.google.dev/gemini-api/docs/openai).
