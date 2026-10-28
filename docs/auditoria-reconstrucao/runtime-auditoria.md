# Auditoria de runtime, auditoria, prompts, aptidão e MCP

Data: 2026-10-28. Escopo desta frente: leitura integral dos 55 arquivos em src/provider, src/audit, src/aptidao, src/prompts e src/mcp (9.192 linhas) e dos 37 arquivos de testes correspondentes (6.241 linhas). Código de consumo fora desse escopo foi consultado pontualmente para distinguir implementação ativa de comentário histórico. Nenhuma implementação foi modificada; nenhuma chamada a modelo ou serviço externo foi feita; nenhuma suíte ampla foi rodada. As reproduções usam bundle temporário dos fontes atuais e diretório temporário removido ao fim.

## Conclusão da frente

As limitações não decorrem só da escolha de palavras dos prompts. O runtime está organizado ao redor de documentos extensos, protocolos textuais e um executor obrigatoriamente via CLI. O domínio de aplicação não é um tipo explícito na entrevista. O código reduz ou reinterpreta findings através de expressões regulares e de classes, mas não oferece um modelo único de recuperação orientado à causa. A arquitetura manda percorrer todos os fluxos em navegador; o caminho terminal é uma exceção executada ainda em Playwright; o desktop permanece sem execução dos fluxos. Testes de presença de frases preservam essas remendas sem demonstrar que o produto final funciona.

O redesenho proposto abaixo é independente e integralmente novo. Não se propõe portar, adaptar, manter compatibilidade ou reaproveitar qualquer motor existente.

## Achados com evidência

### R01 — Modalidade não existe no contrato de entrevista; aparência web entra até em pedido TUI explícito

Fonte: src/prompts/writer.ts:11-23 (WriterContext sem modality), :43-60 (APPEARANCE), :219 (anexado para qualquer skeleton). A condição não olha o pedido nem um tipo de produto. O bloco obriga identidade visual para qualquer UI e sugere biblioteca de componentes/CSS, hover, temas e tipografia. Consequência: o modelo econômico precisa contrariar uma instrução explícita para formular alternativas adequadas ao terminal.

Reprodução direta com pedido “Crie uma TUI no terminal, sem HTML, navegador ou CSS.”: prompt gerado contém “component library or CSS framework” e “hover”; tamanho 14.380 caracteres. Isso demonstra o insumo inadequado, não promete prever a resposta de todo modelo.

Testes que perpetuam a regra: test/prompts/prompts.spec.ts:225-239 exige que pergunta de aparência seja obrigatória e não exista opção sem estilo; não possui cenário de TUI. A correção estrutural é o novo init definir interfaces e plataformas de forma tipada antes de elaborar a entrevista e limitar assuntos aplicáveis, sem obrigação universal de design web.

### R02 — Suposta fragmentação reinsere contexto integral e pressupõe leitor capaz de entender tudo

Fonte: src/prompts/skeleton.ts:259-270 promete fatia; :400-402 reinsere pedido integral em cada fase. src/prompts/auditor.ts:144-164 recebe pedido integral, todos upstream e plano inteiro. src/prompts/architecture.ts:302-315 e :467-477 entrega pedido+esqueleto+arquitetura integral. src/prompts/builder.ts:150-158 manda abrir skeleton e arquitetura inteiros mesmo quando architectureSlice já vem anexada (:340). Nenhum desses construtores aplica orçamento de tokens ou divide tarefa ao excedê-lo.

O tamanho das constantes também é custo real de entrada: só a entrevista trivial tem ~14 KB sem qualquer material do projeto. A existência de fatias não é garantia de contexto pequeno. Novo desenho: registros de requisitos com IDs e referências de origem; pacote de trabalho com objetivo, trechos literais vinculados, contratos consumidos/providos e arquivos relevantes; compilador de contexto calcula orçamento, reserva saída e divide antes da chamada. Pedir complemento por ID é mais barato que reenviar todo projeto.

### R03 — Retry ativo da auditoria ensina protocolo diferente e pode descartar defeito material

Fonte: src/prompts/auditor.ts:69-82 pede quatro campos com classe; :116-137 auditRetryPrompt anexa OUTPUT antigo de três campos (:93-113) e :131 instrui explicitamente “give every finding three fields”. Caminho ativo confirmado: src/init/orchestrator.ts:3551 usa esse retry no plano. src/audit/protocol.ts:259-281 aceita finding de três campos sem classe. src/audit/admissibilidade.ts:59-61 diz que finding sem classe não bloqueia; src/init/orchestrator.ts:3576-3581 o rebaixa a observação.

Reprodução local: resposta seguindo as últimas instruções é lida corretamente como REJECTED, mas admitir devolve {bloqueia:false,motivo:'o achado não declara classe'}. Não é hipótese de parser rejeitar; o erro é semântico da conexão entre caminhos válidos.

No novo motor, schema único por operação, resultado estruturado pequeno e evidência com ID. Falta de campo não torna o defeito existente uma aprovação; normalização local ou solicitação incremental do campo faltante.

### R04 — Redução de testes virou um subsistema de interpretação e censura de prosa

Fonte: src/audit/sem-teste.ts:31-44 enumera comandos linguísticos; :61-69 corta orações da correção; :80-123 filtra findings/remarks/decisions e converte REJECTED em APPROVED quando todos saem. O filtro é ativo em src/init/orchestrator.ts:2526-2527 e :3567. src/prompts/planning-scope.ts:23-43 proíbe até critério dizendo que módulo tem teste; o restante da política explica exceções ao próprio texto. Este código não mede testes executados ou custo: decide quais frases podem constar em documentos.

Novo motor deve associar verificações à necessidade concreta (build/start, regra crítica, regressão observada, requisito explícito) e agendar o conjunto afetado por alteração. Não criar bloqueio por contagem de testes, ausência de frases, ocorrência de ferramenta ou proibição genérica de descrever a verificação. Guardar comando, resultado, entradas e hash de código; reutilizar evidência inalterada. Isso é controle de execução e não política textual.

### R05 — Testes de prompt confundem instrução presente com comportamento corrigido

Fonte: test/prompts/test-policy.spec.ts:21-29 conta quantas vezes bloco aparece e proíbe frases antigas. test/prompts/functional-policy.spec.ts:8-20 só verifica presença de “Prefer focused”, “Do not repeat”, etc. test/prompts/cooperacao-133.spec.ts:57-60 exige frase para não criar servidor em desktop; :67-71 exige frase para não bloquear observação visual. test/prompts/conclusao-134.spec.ts:29-36 testa string que descreve terminal sem servidor. src/prompts/test-policy.ts:10-20 só produz texto, não muda seleção de comandos.

São verificações baratas para formatadores, mas insuficientes como regressão de motor; alterações editoriais passam a quebrar testes, enquanto rotinas continuam repetindo comandos. Remover toda essa suíte junto com os motores substituídos. Projetar cenários novos que observem artefato entregue e recuperação real: uma TUI recebe teclado em PTY, muda estado e encerra; indisponibilidade transitória é recuperada; defeito real retorna diagnóstico corrigível e o editor fecha sem invalidar trabalho alheio. Não substituir por teste da diminuição do número de testes.

### R06 — Verificação de fluxos presume navegador; terminal é exceção sobre Playwright e desktop fica inconclusivo

Fonte: src/prompts/architecture.ts:127-142 determina navegador ao fim de cada fase. src/prompts/flows.ts:90-127 abre sempre com “ONE Playwright script”, depois bifurca terminal via comandoDoProjeto. :138-148 ainda instrui “application already running” e restart de servidor; :212-237 exige test.step e expect por passo. src/prompts/acceptance-policy.ts:29 limita exatamente um teste e um test.step por passo, ainda com inspeção lexical posterior de roteiro. O desktop usa CAPIVARA_FORA_DO_NAVEGADOR (:64-83,:111-120), explicitamente não percorrido. src/prompts/verifier.ts:63-69 assume nenhuma sessão pode abrir janela nativa.

Não inferir que código desktop é sempre quebrado; fato: não existe nessa interface de prompts uma execução adequada de fluxo nativo. Uma TUI interativa tampouco é equivalente a comando que retorna saída. Novo plan deve definir capacidades de execução por modalidade e por SO; novo build usa runner web, PTY de terminal e executor nativo por plataforma, além de compilação e testes de domínio. Verificação indisponível é lacuna de evidência explícita, nunca servidor fictício nem defeito inventado do produto. Decidir com o usuário onde haverá runners Windows/macOS.

### R07 — API direta não constrói e o modelo precisa de CLI de terceiros para editar

Fonte: src/provider/roles.ts:19-21 e :53-60 builder requiresCli; src/provider/adapters.ts:142-147 recusa API direta para builder e verifier em reparo. src/provider/direct-api.ts:1, :173 recusa chamadas de ferramentas. O catálogo permite APIs para escritores/auditores, mas não entrega execução uniforme. Isso impede assumir que qualquer modelo configurado pode executar tarefa pequena de código.

Novo núcleo de execução oferece leitura, patch e comando como capacidades do próprio harness, expondo-as aos transportes suportados. CLI é um transporte, API com ferramentas é outro; motor não depende da preferência da CLI sobre filesystem, sessão ou parser. Pergunta de produto: “qualquer modelo” inclui modelos sem ferramentas/saída estruturada, ou há um piso técnico explícito? Modelos sem tool calling podem operar um protocolo de patch e comando simples, cuja interpretação e execução são do motor novo.

### R08 — Falha HTTP/token limit é resultado terminal desta camada, sem estratégia de recuperação tipada

Fonte: src/provider/direct-api.ts:145-153 interpreta HTTP; :161-171 retorna erro ao teto de tokens e declara nenhuma repetição automática; :173-179 ferramentas inesperadas, ausência de texto, conexão e timeout retornam erro. Não há campos de categoria para 429/5xx, Retry-After, retentativa com backoff ou continuação da unidade cortada; todos viram engineError e texto. O retorno preserva uso/parcial, mas o motor acima precisa reconstruir o diagnóstico.

Fonte adicional: src/provider/cli/opencode-limits.ts:19 e :39-62 bloqueia toda inferência OpenRouter se consulta model.list não puder conferir limites. A consulta de metadados vira pré-condição dura, inclusive se inferência estaria disponível. Isso deve ser explicitado como condição, sem afirmar qual frequência ocorre.

Novo motor: resultados tipados (transiente, autenticação/cota, saída parcial, pacote grande, dependência ausente, defeito de código, falha do verificador). Recuperar conforme a causa, preservar arquivos e contexto útil, não repetir inferência integral indiscriminadamente. Envelope pequeno elimina necessidade de doc monolítico de 32.768 tokens de saída. A regra de custo/limite para trocar modelo precisa ser estabelecida com o usuário.

### R09 — Cancelamento pré-existente não impede subprocesso

Fonte: src/provider/supervisor.ts:115 inicia processo; :202-203 só adiciona listener AbortSignal e não confere signal.aborted (API direta confere :111). Reprodução: AbortController já abortado antes de runProvider deixa comando rodar e retorna exitCode 0/ran=true. É defeito concreto do runtime, relevante a recuperar/cancelar sem duplicar trabalho. Novo executor verifica cancelamento antes de agendar, antes de iniciar e ao executar; cancelamento do usuário sempre domina recuperação automática.

### R10 — Fallback offline das skills pode quebrar por índice truncado

Fonte: src/mcp/skills.ts:123-125 readFile tem fallback mas JSON.parse não tem; um index.json inválido lança SyntaxError. Testes :206-233 só cobrem índice válido, ausente e pasta ausente. Reprodução com '{broken' confirma exceção. Consequência: metadado auxiliar corrompido pode interromper caminho offline. Novo desenho considera dados do pacote verificáveis e reconstruíveis, ignora entrada inválida isolada e mantém fonte materializada; não repropaga erro de conveniência como falha do build.

### R11 — Memória é apagada antes da confirmação de transporte

Fonte: src/mcp/memoria.ts:149-170 recolhe e remove pasta inteira; :44-69 envio falho conta falha, mas não repõe arquivos. Consumo ativo: src/loop/runner.ts:407-412 recolhe antes de options.onMemorias; CLI chama registrarMemorias em :2211. O comentário :40-42 promete “fica no disco e sobe na próxima”, mas a origem já foi excluída. Reprodução local: uma memória coletada, envio simulado offline, falhas=1 e sourcePreserved=false.

Pode restar informação em telemetria de outros módulos, mas este caminho não oferece fila persistente de reenvio. Novo projeto deve gravar registro pendente com identidade, marcar confirmação após resposta e remover apenas após confirmação; falha de MCP não modifica estado de execução da aplicação.

### R12 — Verificação de caminho da skill aceita pasta vizinha com mesmo prefixo

Fonte: src/mcp/skills.ts:78-83 usa destino.startsWith(absoluta), sem garantir limite de diretório ou tratar symlink. Teste existente :89-94 só cobre ../../../alvo.txt. Reprodução path '../s-neighbor/alvo.txt' dentro de skill s grava fora de s. Confirma somente travessia de prefixo no temporário; não foi tentado acesso a arquivos do usuário. Isso mostra que contar um teste para “path traversal” não prova fronteira coberta. Novo gerenciador de artefatos deve conferir caminho relativo canônico, separador e symlinks e executar efeitos no diretório correto.

### R13 — Auditoria mede convergência por semelhança lexical e ainda para por teto

Fonte: src/audit/cycle.ts:109-202 calcula palavras e Jaccard com limiares .6/.25 para identidade de defeito; :332-373 mede progresso por listas de achados, não por comportamento do artefato; :404-444 pede desenvolvedor após teto de falhas mecânicas ou semProgresso, e mesmo progresso tem teto 2x. Uso ativo confirmado para arquitetura: src/init/orchestrator.ts:1851. Não confundir com fluxo do plano integral, que tem seu orçamento próprio.

src/audit/authority.ts:38-48/:74-92 classifica engenharia pela presença de caminhos/chamadas/env vars nas opções ou no problema/correção; dado de produto com nome de arquivo pode ser julgado engenharia. src/audit/envelope.ts:36-87 roteia dono do defeito com regex de palavras “goal/task/critério”. São camadas para compensar ausência de IDs e ownership estruturados.

Novo motor: defeito tem ID estável, requisito original, arquivos/resultado observado, severidade e ação sugerida. Rechecagem acompanha mesmo ID e código alterado. Estratégia muda após ausência de avanço constatável, preserva progresso parcial, divide unidade, corrige ambiente, consulta parceiro ou modelo configurado. Parada só após alternativas aplicáveis esgotadas ou limite explicitamente escolhido; não arbitrar contagem e formato com usuário. O usuário esclareceu 99% como diretriz de persistência: recuperar com todos os recursos aplicáveis e só parar por impossibilidade real; número de retries não demonstra impossibilidade.

### R14 — Comentários e testes arquiteturais congelam decisões antigas

src/aptidao/prova.ts:4-8 descreve prova “antes de qualquer init/plan/build”; consumidor real único é comando explícito aptidao em cli-program.ts:915-953. Portanto NÃO é barreira automática no fluxo normal: manter precisão da auditoria. A prova marca inapto sem nova tentativa e teste test/aptidao/prova.spec.ts:121-159 perpetua isso, mas é comportamento opcional.

src/provider/roles.ts:60 descreve rodar suíte; test/provider/roles.spec.ts:5-18 congela exatamente quatro papéis. Isso não é critério de funcionalidade do produto. src/mcp/client.ts:14-15 justifica cliente manual por “uma só dependência”, enquanto implementa transporte próprio com SSE, JSON-RPC, autenticação e arquivos. Nesse cliente, listResources/listPrompts (:291-305,:324-327) não percorrem paginação e lerEnvelope (:102-117) escolhe último JSON-RPC de SSE sem conferir ID. São limitações observáveis em código; não reproduzidas nesta frente. Não sugerir conservar cliente manual ou congelar quantidade de dependências na reconstrução.

## Testes: o que tem valor real e o que deve morrer com os motores

A auditoria não conclui que todo teste é excesso. Tests/provider/direct-api, supervisor, credentials, opencode-cancel, transcript e mcp/authenticated-transport exercitam comportamento: não vazar segredo, não deixar filho órfão, não reenviar credencial a redirect, distinguir resposta cortada, preservar exit code. São exemplos de RISCOS que o novo sistema precisa cobrir com testes novos, não sugestão de portar código ou suítes.

Asserções de frase/padrão de prompt, número exato de papéis, total de blocos de política, campos documentais históricos e “não diz mais X” não verificam entrega. Devem desaparecer junto com os motores antigos. O esforço de validação novo é escolhido pelo impacto da mudança; não precisa de todos os cruzamentos provider x papel x flag x OS quando a evidência não muda. A matriz de flags em adapters.spec.ts:125-173 exemplifica multiplicação de casos que só monta argv e não prova efeito da CLI real. Substituir inferência sobre flags por poucos contratos reais por transporte e evidência conhecida de capacidades.

## Direção para o desenho novo (sem reaproveitar motores)

1. Init novo: normaliza pedido em conjunto pequeno de fatos/requisitos, interfaces tipadas (web, desktop nativo, TUI, CLI, biblioteca, serviço), plataformas, entradas/saídas e decisões abertas. Perguntas têm motivo concreto de impacto, rastreiam IDs, aceitam texto livre e não reabrem decisão já fechada. Lacuna tardia volta à pergunta mínima correspondente.
2. Plan novo: DAG de unidades pequenas; árvore de dependências de desenvolvimento no início, com plataforma/versão/local de instalação/comando de verificação e consumidor; contratos com IDs e ownership; orçamento de contexto por unidade e plano de execução por modalidade. Sem plano gigante por agente nem contagem arbitrária de critérios como substituto de complexidade.
3. Build novo: executor do próprio harness, efeitos observáveis, preparação de ambiente antes do consumidor, edição em unidade pequena, verificação proporcional dirigida a produto, estado persistente e retomada. Auditor é função de diagnóstico com evidência e proposta de reparo; pode fornecer patch, e quem edita recebe mesmo contexto/requisito pertinente. Evitar chamadas duplicadas só para disputar status.
4. Recuperação nova: categorias explícitas, backoff para transiente, reparar dependência, reparar saída parcialmente válida, dividir unidade se contexto/tokens insuficientes, trocar estratégia com memória do que já tentou; preservar evidência aprovada só quando seus inputs permanecem idênticos. Não fingir êxito sem capacidade de executar verificação.
5. Metas observadas: custo/tokens por entrega, chamadas por unidade, tempo de verificação útil, defeitos materiais encontrados, recuperação sem intervenção e execução real por plataforma. Não usar número de testes como gate; não criar teste para provar que testes diminuíram.

## Perguntas que exigem decisão de produto

- Onde executar e comprovar Windows/macOS a partir de host Linux: runners remotos/CI disponíveis, máquinas conectadas ou obrigação de gerar artefatos com comprovação pendente até plataforma disponível?
- Qual teto de gasto/tempo e quais modelos/provedores estão autorizados para escalonamento automático quando estratégia com modelo econômico falha? Esgotar “todos recursos” sem limite não é um critério finito.
- Recuperação pode instalar requisitos de sistema automaticamente, incluindo uso de privilégios já disponíveis, ou apenas ambiente isolado/local? Dependências locais/descobertas podem ser acrescentadas automaticamente ao DAG com registro de justificativa, sem pedir aprovação técnica ao usuário?
- Quais modalidades além das explicitadas (web, desktop Linux/Windows/macOS, TUI) precisam ser obrigatórias na primeira entrega? CLI, APIs, serviços e bibliotecas são exemplos citados implicitamente por “etc.”, não escopo confirmado.

## Reproduções e material

/tmp/novoharness-runtime-probes-entry.ts exporta fontes atuais para bundle temporário.
/tmp/novoharness-runtime-probes.mjs é bundle obtido com esbuild, sem edição do produto.
/tmp/novoharness-run-runtime-probes.mjs executa seis reproduções locais com dados temporários.
/tmp/novoharness-runtime-probes-results.json registra os seis resultados observados.

Sem execução ampla de testes e sem chamadas pagas. A leitura de código comprova caminhos e limitações, não porcentagem de recuperação no mundo real.

## Inventário de leitura integral
- `capivara/packages/core/src/provider/adapters.ts` — 209 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/agy.ts` — 78 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/claude.ts` — 79 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/codex.ts` — 65 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/cursor.ts` — 84 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/custom.ts` — 28 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/index.ts` — 45 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/opencode-limits.ts` — 129 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/opencode.ts` — 72 linhas — leitura integral.
- `capivara/packages/core/src/provider/cli/types.ts` — 130 linhas — leitura integral.
- `capivara/packages/core/src/provider/credentials.ts` — 122 linhas — leitura integral.
- `capivara/packages/core/src/provider/direct-api.ts` — 184 linhas — leitura integral.
- `capivara/packages/core/src/provider/flow-review.ts` — 6 linhas — leitura integral.
- `capivara/packages/core/src/provider/index.ts` — 52 linhas — leitura integral.
- `capivara/packages/core/src/provider/models.ts` — 300 linhas — leitura integral.
- `capivara/packages/core/src/provider/openrouter-key.ts` — 31 linhas — leitura integral.
- `capivara/packages/core/src/provider/redact.ts` — 30 linhas — leitura integral.
- `capivara/packages/core/src/provider/registry.ts` — 169 linhas — leitura integral.
- `capivara/packages/core/src/provider/roles.ts` — 113 linhas — leitura integral.
- `capivara/packages/core/src/provider/runtime-env.ts` — 8 linhas — leitura integral.
- `capivara/packages/core/src/provider/supervisor.ts` — 229 linhas — leitura integral.
- `capivara/packages/core/src/provider/transcript.ts` — 529 linhas — leitura integral.
- `capivara/packages/core/src/audit/admissibilidade.ts` — 82 linhas — leitura integral.
- `capivara/packages/core/src/audit/authority.ts` — 120 linhas — leitura integral.
- `capivara/packages/core/src/audit/cycle.ts` — 469 linhas — leitura integral.
- `capivara/packages/core/src/audit/envelope.ts` — 148 linhas — leitura integral.
- `capivara/packages/core/src/audit/index.ts` — 8 linhas — leitura integral.
- `capivara/packages/core/src/audit/protocol.ts` — 369 linhas — leitura integral.
- `capivara/packages/core/src/audit/sem-teste.ts` — 128 linhas — leitura integral.
- `capivara/packages/core/src/audit/tasks.ts` — 58 linhas — leitura integral.
- `capivara/packages/core/src/aptidao/index.ts` — 13 linhas — leitura integral.
- `capivara/packages/core/src/aptidao/prova.ts` — 374 linhas — leitura integral.
- `capivara/packages/core/src/prompts/acceptance-policy.ts` — 104 linhas — leitura integral.
- `capivara/packages/core/src/prompts/amend.ts` — 155 linhas — leitura integral.
- `capivara/packages/core/src/prompts/architecture.ts` — 479 linhas — leitura integral.
- `capivara/packages/core/src/prompts/auditor.ts` — 165 linhas — leitura integral.
- `capivara/packages/core/src/prompts/builder.ts` — 603 linhas — leitura integral.
- `capivara/packages/core/src/prompts/change.ts` — 130 linhas — leitura integral.
- `capivara/packages/core/src/prompts/flows.ts` — 283 linhas — leitura integral.
- `capivara/packages/core/src/prompts/index.ts` — 24 linhas — leitura integral.
- `capivara/packages/core/src/prompts/language.ts` — 37 linhas — leitura integral.
- `capivara/packages/core/src/prompts/planning-scope.ts` — 51 linhas — leitura integral.
- `capivara/packages/core/src/prompts/repair.ts` — 51 linhas — leitura integral.
- `capivara/packages/core/src/prompts/skeleton.ts` — 428 linhas — leitura integral.
- `capivara/packages/core/src/prompts/survey.ts` — 215 linhas — leitura integral.
- `capivara/packages/core/src/prompts/test-policy.ts` — 21 linhas — leitura integral.
- `capivara/packages/core/src/prompts/verifier.ts` — 414 linhas — leitura integral.
- `capivara/packages/core/src/prompts/writer.ts` — 336 linhas — leitura integral.
- `capivara/packages/core/src/mcp/client.ts` — 373 linhas — leitura integral.
- `capivara/packages/core/src/mcp/endpoint.ts` — 67 linhas — leitura integral.
- `capivara/packages/core/src/mcp/index.ts` — 30 linhas — leitura integral.
- `capivara/packages/core/src/mcp/levantamento.ts` — 75 linhas — leitura integral.
- `capivara/packages/core/src/mcp/library.ts` — 256 linhas — leitura integral.
- `capivara/packages/core/src/mcp/memoria.ts` — 177 linhas — leitura integral.
- `capivara/packages/core/src/mcp/skills.ts` — 257 linhas — leitura integral.
- `capivara/packages/core/test/provider/activity.spec.ts` — 40 linhas — leitura integral.
- `capivara/packages/core/test/provider/adapters.spec.ts` — 537 linhas — leitura integral.
- `capivara/packages/core/test/provider/credentials.spec.ts` — 160 linhas — leitura integral.
- `capivara/packages/core/test/provider/direct-api.spec.ts` — 211 linhas — leitura integral.
- `capivara/packages/core/test/provider/minimax-131.spec.ts` — 312 linhas — leitura integral.
- `capivara/packages/core/test/provider/models.spec.ts` — 265 linhas — leitura integral.
- `capivara/packages/core/test/provider/opencode-cancel.spec.ts` — 77 linhas — leitura integral.
- `capivara/packages/core/test/provider/opencode-limits.spec.ts` — 40 linhas — leitura integral.
- `capivara/packages/core/test/provider/openrouter-key.spec.ts` — 52 linhas — leitura integral.
- `capivara/packages/core/test/provider/registry.spec.ts` — 76 linhas — leitura integral.
- `capivara/packages/core/test/provider/retomada.spec.ts` — 130 linhas — leitura integral.
- `capivara/packages/core/test/provider/roles.spec.ts` — 43 linhas — leitura integral.
- `capivara/packages/core/test/provider/runtime-env.spec.ts` — 40 linhas — leitura integral.
- `capivara/packages/core/test/provider/supervisor.spec.ts` — 258 linhas — leitura integral.
- `capivara/packages/core/test/provider/transcript.spec.ts` — 473 linhas — leitura integral.
- `capivara/packages/core/test/audit/audit.spec.ts` — 453 linhas — leitura integral.
- `capivara/packages/core/test/audit/auditoria-que-aprova.spec.ts` — 47 linhas — leitura integral.
- `capivara/packages/core/test/audit/finding-travessao.spec.ts` — 130 linhas — leitura integral.
- `capivara/packages/core/test/audit/tasks.spec.ts` — 42 linhas — leitura integral.
- `capivara/packages/core/test/aptidao/prova.spec.ts` — 251 linhas — leitura integral.
- `capivara/packages/core/test/prompts/architecture.spec.ts` — 91 linhas — leitura integral.
- `capivara/packages/core/test/prompts/conclusao-134.spec.ts` — 45 linhas — leitura integral.
- `capivara/packages/core/test/prompts/cooperacao-133.spec.ts` — 97 linhas — leitura integral.
- `capivara/packages/core/test/prompts/flows.spec.ts` — 94 linhas — leitura integral.
- `capivara/packages/core/test/prompts/functional-policy.spec.ts` — 39 linhas — leitura integral.
- `capivara/packages/core/test/prompts/planning-responsibility.spec.ts` — 36 linhas — leitura integral.
- `capivara/packages/core/test/prompts/prompts.spec.ts` — 545 linhas — leitura integral.
- `capivara/packages/core/test/prompts/test-policy.spec.ts` — 31 linhas — leitura integral.
- `capivara/packages/core/test/mcp/authenticated-transport.spec.ts` — 357 linhas — leitura integral.
- `capivara/packages/core/test/mcp/cli-auth.spec.ts` — 206 linhas — leitura integral.
- `capivara/packages/core/test/mcp/client.spec.ts` — 239 linhas — leitura integral.
- `capivara/packages/core/test/mcp/endpoint.spec.ts` — 114 linhas — leitura integral.
- `capivara/packages/core/test/mcp/global-config.spec.ts` — 213 linhas — leitura integral.
- `capivara/packages/core/test/mcp/init-por-mcp.spec.ts` — 176 linhas — leitura integral.
- `capivara/packages/core/test/mcp/levantamento.spec.ts` — 27 linhas — leitura integral.
- `capivara/packages/core/test/mcp/library-history.spec.ts` — 48 linhas — leitura integral.
- `capivara/packages/core/test/mcp/skills.spec.ts` — 246 linhas — leitura integral.
