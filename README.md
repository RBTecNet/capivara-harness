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

Escolha um transporte já instalado e autenticado, ou configure uma API:

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

Transportes: Codex, Claude Code e OpenCode por CLI; OpenAI, Anthropic, OpenRouter, DeepSeek e MiniMax por API; endpoint compatível com `--base-url` e `--api-key-env`. Credenciais de CLI continuam sob responsabilidade da respectiva CLI. A configuração nova fica em `~/.config/capivara/settings.json`, ou em `CAPIVARA_CONFIG_DIR`. Não importa silenciosamente configurações do motor antigo.

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

## Continuidade e estado

O estado novo fica em `.capivara-next/`: SQLite transacional, respostas, eventos, cópia de recuperação e transcritos das chamadas. Inclua essa pasta no `.gitignore` de seus aplicativos. O estado guarda o pedido e dados do projeto; trate-o como informação privada.

Uma falha transitória mantém a execução ativa. Instalação, instrumentos e produto têm reparos distintos. Uma receita web inadequada para terminal é corrigida no instrumento; um servidor indevido introduzido pelo editor é removido dos arquivos afetados, preservando o restante do trabalho. Checkpoint serve à preservação, não como justificativa para interromper.

Cancelamento explícito por Ctrl+C é respeitado. Falta de credencial, rede, resposta humana ou runner nativo mantém pendência explícita; não é sucesso nem defeito fictício do código. A configuração pode ser atualizada por `capivara config` em outro terminal. Nunca se declara prova nativa de Windows/macOS a partir de uma compilação Linux.

## Limites desta RC

O piloto real desta entrega usa Codex no Linux. APIs têm testes de protocolo e ferramentas locais, sem inferência paga em todos os provedores. A disponibilidade dos outros transportes depende da instalação e autenticação do usuário. Receitas web e desktop usam ferramentas do projeto ou da CLI selecionada; não há um navegador ou controlador gráfico universal embutido. Alvos nativos exigem runner compatível para evidência de comportamento.

A superfície nova contém `init`, `plan`, `build`, `run`, `config`, `status`, `answer` e `providers`. Comandos, TUI administrativa e integrações MCP do motor anterior não foram portados. Os documentos antigos em `docs` estão marcados como históricos. Não há camada de compatibilidade com a versão 0.8.x.

## Desenvolvimento e evidências

```sh
npm run check
```

A suíte nova exercita riscos de comportamento: autoridade do pedido, contexto limitado, persistência, recuperação cooperativa, instalação, cancelamento, ferramentas e PTY real. Ela não testa frases de prompts nem exige uma quantidade de testes.

- [Auditoria integral do código anterior](docs/AUDITORIA-RECONSTRUCAO-MOTORES.md)
- [Plano de reconstrução](docs/PLANO-RECONSTRUCAO-MOTORES.md)
- [Implementação e validação da RC](docs/RECONSTRUCAO-0.9.0_RC1.md)
- [Mapa operacional do código novo](CAPIVARA.md)
