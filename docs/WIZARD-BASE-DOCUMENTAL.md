# Wizard de início e base documental

Referência de experiência: `origin/main`, commit `23b7241` (0.7.10). Implementação sobre a branch `rewrite/motores-0.9.0-rc1`, com os motores novos da 0.9.0_RC1.

## Fluxo restaurado

`capivara` e `capivara wizard` abrem o mesmo assistente. O painel apresenta o nome, a capivara, as escolhas anteriores e caixas de seleção/resposta, adaptadas ao terminal. Setas, números e Enter navegam; Esc volta. Texto aceita colagem de várias linhas e termina com ponto em linha isolada ou Ctrl-D. Segredos não aparecem no painel, histórico ou comando equivalente. Pipes e CAPIVARA_LINE_INPUT=1 usam leitura em linha com uma única fila.

A sequência é pasta → init/plan/build → origem do pedido, se necessária → provider/modelo/raciocínio → revisor opcional → comando equivalente → Executar agora. Defaults da etapa consultam o estado novo: brief leva ao plan e plano pronto leva ao build. Cancelar ou escolher não executar preserva o terminal e não cria estado de projeto. A execução confirmada reentra no parser com o mesmo argv que foi mostrado. Defaults explícitos de modelo/raciocínio não herdam silenciosamente o valor antigo do projeto ou do editor.

Os comandos aposentados e os limites arbitrários de ciclos/reparos não foram reintroduzidos. APIs continuam com ferramentas do motor novo; não precisam de OpenCode para editar arquivos. O catálogo usa consultas gratuitas e permite digitar o identificador quando não consegue listar. A chave é configurada antes de consultar um catálogo privado.

## Construir a partir do data-center

As origens são escrever agora, arquivo, projeto MCP e prompt guardado. A escolha MCP apresenta os projetos reais que têm pedido, com a quantidade de documentos selecionados. A escolha de prompt usa prompts/list e prompts/get. A conexão já configurada é reconhecida, inclusive o endereço e token de ~/.capybara/config.json como dados de conexão; nenhum módulo antigo é executado.

O cliente é novo: JSON-RPC HTTP/JSON/SSE, sessões, paginação, timeout, cancelamento e retries de leitura. Não oferece operações de publicação/gravação remota. Credenciais seguem somente o endpoint associado e redirecionamentos não recebem tokens. HTTPS conserva a validação TLS. O endereço HTTP explícito já configurado continua utilizável.

O pedido atual e os documentos selecionados têm identidades e origens próprias. Histórico não se transforma em pedido nem em instrução atual. Documentos entram no init em fatias limitadas; somente requisitos extraídos com citação literal pertinente são considerados. Scripts, skills, exemplos e anexos permanecem referências, sem transformar cada linha em obrigação de produto. Pedido e decisões atuais prevalecem sobre material incompatível — por exemplo, Bootstrap não vira requisito de uma TUI sem interface web.

Os arquivos ficam em .project-inputs com estrutura relativa preservada. O cache transacional guarda seleção/metadados; blobs privados preservam os bytes sem repetir base64 em cada gravação de estado. Planner e tarefas recebem índices pequenos relevantes, com URI, caminho e hash; os corpos não são enviados globalmente. Mudança de anexo relevante invalida a prova correspondente. Uma leitura parcial não substitui material completo; se o serviço cair, a mesma seleção pode ser restaurada dos blobs e continuar. Atualização de insumos e construção compartilham a posse exclusiva do projeto.

## Verificação

- Cliente real leu a base configurada, listou 16 projetos e 16 prompts e carregou um pedido com 11 documentos e 7 anexos, sem gravar na base.
- Percurso real do wizard em PTY escolheu o projeto MCP, modelo e comando e terminou sem executar; nenhum estado foi criado no destino.
- Outro percurso PTY confirmou retorno do processo com código zero e restauração integral do terminal, incluindo stdin sem manter o processo preso.
- Modo linha recebeu todas as respostas de um único pipe e preservou o pedido com várias linhas.
- Testes locais cobrem protocolo, cache completo e recuperação, proveniência, contexto por fragmentos, defaults do comando, credenciais vinculadas a endpoint e navegação.

Essas verificações não chamaram modelos pagos. O uso da base foi somente leitura. A validação nativa de outros sistemas e os demais limites de execução da RC permanecem descritos no README.

## Arquivos principais

- src/wizard: fluxo, teclado, painel e leitura por linha.
- src/data-center: conexão e leitura de projetos, prompts e materiais.
- src/app/wizard.ts e catalog.ts: catálogo, credenciais e ligação com o CLI.
- src/app/data-source.ts: seleção, materialização, cópia durável e recuperação dos insumos.
- src/domain: fragmentação, fontes e índices relevantes.
- src/cli-program.ts: flags e execução do comando equivalente.
