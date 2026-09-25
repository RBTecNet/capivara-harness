# Handoff — onde o trabalho está

Escrito em 2026-09-20 e atualizado no mesmo dia, depois do incidente `cron5`,
para quem pega o projeto sem o histórico da conversa que o produziu. O último
commit é o que corrigiu o gate 0 (§32 do plano), e a árvore está limpa.

Isto **não** repete o que o `README.md` e o `CAPIVARA.md` já dizem. Leia aqueles
primeiro: eles explicam o que a capivara é. Este arquivo diz em que ponto ela
está, o que não está feito, e as armadilhas que custaram caro para descobrir.

---

## O estado, em números

| | |
|---|---|
| branch | `main` — é onde tudo está |
| versão | 0.3.1 (`capivara --ver`) |
| suíte | 1444 testes em 77 arquivos, `npm run check` verde |
| estágios | `survey` (opcional) → `init` → `plan` → `build` → `change` (quantas vezes precisar) |
| CLIs integradas | `codex`, `claude`, `opencode`, `agy`, `cursor` |

O ciclo de três estágios foi desenvolvido no branch `ciclo-unico` e fundido em
`main` por fast-forward — `main` não tinha commits próprios, então o histórico é
uma linha reta e não há commit de merge. O branch foi apagado depois disso; a tag
`checkpoint-2026-09-20` marca esse ponto, no commit `49d32e6`. Dois commits
vieram depois dela; o que eles trouxeram está na seção seguinte.

## 2026-09-25 — onde paramos, e o que está no meio do caminho

O dia inteiro foi endurecimento do `init`/`plan`/`build` contra um projeto grande
de verdade (`assistencia2`: 13 fases, 21 entidades, 17 stories, pedido de 16.752
caracteres). As famílias de defeito estão em `docs/PLANO.md` §74 a §76, cada uma
com a medição que a justificou. O que vale carregar daqui:

**Fechado e medido em campo hoje:** entrevista sem teto (41 perguntas, 12
omissões — o teto velho cortaria 8 em silêncio), insistência com saídas fechadas,
`CAPIVARA_DECISION` (o auditor pergunta ao desenvolvedor na primeira leitura; 2
decisões vieram por ele), levantamento com conteúdo (7 arbitragens gravadas),
auditoria por fase de volta (13 assuntos em vez de 1), repositório Git como
pré-requisito, memória de task no gate 3.

**A causa que estava embaixo de tudo, e o que falta fazer:**

O `phaseAuditPrompt` recebe o pedido do desenvolvedor verbatim. O
`phaseFromSlicePrompt` **não** — ele vê só a fatia do esqueleto. Num pedido
prescritivo (o do `assistencia2` fala de "rolagem"/"linhas" nove vezes, até o
tamanho dos campos), o esqueleto comprime esse detalhe e ele deixa de existir para
quem escreve a fase. O auditor cobra o que o pedido pede, o escritor não tem como
saber, e o laço não converge — não por amostragem, por **ausência**. Dos 25
achados da tentativa 3, 18 eram gaps reais dessa natureza e 7 eram "recopie o
modelo de dados".

Na fila, nesta ordem:

1. o escritor da fase passa a receber o pedido, com a regra de que escreve só a
   fase dele — o pedido está ali para não perder detalhe que ele exige sobre o que
   ESTA fase cobre, nunca para trazer trabalho de outra;
2. `fingerprint` sem o endereço: o auditor reescreve o rótulo a cada volta
   ("Tarefa de geração manual de cobranças" → "Tarefa «Gerar manualmente
   cobranças…»"), o hash muda, e o levantamento nunca reconhece a repetição;
3. a fronteira: forma do dado é do esqueleto, comportamento é dos critérios;
4. um teste com **auditor adversário** — que devolve um achado verdadeiro e NOVO a
   cada passada — provando que o laço termina com um número limitado de perguntas
   ao desenvolvedor. Sem ele, cada descoberta dessas custa duas horas de run.

**O que a primeira aplicação da lei de impacto encontrou, e que NÃO foi consertado
de propósito** (uma mudança de comportamento por run):

`driftBetween` em `init/orchestrator.ts` é **código morto** — ninguém o chama —, e
`AmendContext.drift` nunca é preenchido. Ou seja: a proteção que o prompt da emenda
PROMETE ao escritor com todas as letras —

> This is checked mechanically after you answer. A task that changed without a
> finding naming it sends this back to you.

— **não existe**. `checkRewriteDrift` está escrito, testado no contrato, e nunca é
executado. É a mesma família do §76.4 (o comentário que promete o que o código não
faz), e é candidata forte a estar alimentando o moto-contínuo: a emenda pode
reescrever tasks que ninguém pediu, o texto da fase muda, o sha muda, a aprovação
cai, e o auditor acha "defeito novo" em task que estava boa.

Ligar isso começa a RECUSAR emendas, então é mudança de comportamento e vai sozinha
num run. É a próxima da fila, na frente do teto de tasks por fase.

**Uma instância restante da mesma família, anotada e não consertada** (uma mudança
por run): os achados de CONTRATO do self-check — `where: linha N`, quando o plano não
passa no parser por defeito de substância — também saem sem fase e caem no fallback
de "todas as fases". É raro, porque `emendaInutil` recusa emenda que introduza código
de defeito novo, e não mordeu em nenhum run. O conserto é o mesmo de
`faseDoMarcador`: mapear a linha para a fase cujo cabeçalho a precede.

**Candidato observado em campo, NÃO consertado (build em andamento):** os roteiros do
gate 4 são escritos um por fluxo, cada um sozinho, e rodam em sequência contra a
MESMA aplicação e o MESMO banco — o runner migra uma vez e não reinicia o estado entre
roteiros, e o prompt de autoria (`prompts/flows.ts`) não diz uma palavra sobre
independência. No P02 do `assistencia2` isso apareceu assim: o workflow 1 troca a
senha inicial, e o workflow 4, que roda depois, tenta entrar com a senha que já não
existe. O executor diagnosticou certo e contestou o roteiro
(`CAPIVARA_ROTEIRO_ERRADO`), que é a saída desenhada para isto. Se a mesma família
voltar nas fases seguintes — que têm mais fluxos dividindo o mesmo banco —, o conserto
é de autoria (cada roteiro prepara o próprio estado e não depende do efeito de outro)
ou de execução (banco descartável por roteiro). Decidir com a evidência, não antes.

**E a regra de contexto, que vale para os dois lados:** compactar contexto é
perder detalhe, e perder detalhe é exatamente o defeito acima. No harness isso tem
um endereço concreto: o teto de 15 tasks por fase está sendo usado como ALVO pelo
escritor do esqueleto (média de 12,2 no `assistencia2`, seis fases entre 12 e 14),
e fase densa é sessão longa de executor — mais perto do limite de contexto dele,
onde a compactação começa a inventar. O teto precisa voltar a ser teto.

## O que está pronto e medido

O ciclo de três estágios — `init` → `plan` → `build` — funciona de ponta a ponta
com modelo real. As medições estão em `docs/medicoes/referencia.md`; o resumo é
que **o mesmo plano de 61 tasks foi construído por cinco executores diferentes**,
e a conclusão que mudou o projeto foi esta:

> Número de ciclos de correção é sinal de **qualidade**, não só de velocidade.
> 18 devoluções entregaram menos produto que 3, no mesmo tempo de relógio.

O §24 do plano — *quem julga não é onde se economiza* — foi provado
experimentalmente: o mesmo executor fraco que morria na fase 1 com um auditor
caro terminou as sete fases quando o harness parou de esconder informação dele.

## O que veio depois do checkpoint

Quatro frentes, todas nascidas de um run real e todas commitadas.

**§38 — prompt guardado é a terceira origem de um pedido.** `init` e `change`
passam a oferecer, ao lado de digitar e de apontar um arquivo, escolher um prompt
guardado na base pelo NOME. A base ganhou o contêiner `prompt` — no projeto ou na
área geral — e `prompts/list` os serve junto dos pedidos.

**§37 — `change`, mexer no que já roda.** Depois do primeiro build, todo pedido
novo deixa de ser "o que construir" e vira "o que mudar". O comando lê o esqueleto
e o código, planeja de uma a três fases, funde no esqueleto e **preserva letra por
letra o texto das fases já construídas** — é ele que o registro novo de fases
fechadas (`handoffs/fases.json`, por sha do texto) usa para não refazer o que já
está pronto.

**§36 — `survey`, o levantamento de uma aplicação que já existe.** Um comando
novo, antes do `init`: lê uma aplicação legada e escreve o que ela faz, com a
evidência de onde cada regra foi lida, para que a reescrita parta dali. Um mapa
de domínios, uma sessão por domínio, e cada achado marcado como `dominio`,
`implementacao` ou `contrato` — porque a reescrita pode trocar de stack e só a
primeira e a terceira sobrevivem a isso. Somente leitura: não escreve, não roda e
não instala nada na aplicação levantada.

**§35 — a entrevista cobre o que o pedido não menciona.** O `MCP_teste` fechou
cinco fases verdes e não tinha como corrigir o telefone de um cliente: o pedido
dizia "cadastro" e nunca dizia "alterar". A entrevista ganhou um canal próprio de
omissões — até quatro, só na primeira rodada, cada uma respondida com sim ou não
na mesma fila das perguntas. Recusada, a área vira não-objetivo escrito numa
seção `## Fora do escopo` do esqueleto, posta lá pelo harness e não pelo escritor.

**§34 — a base documental.** O harness lê o pedido, as decisões e as skills de
uma base MCP (`doc-center`, em repositório próprio), materializa as skills em
`.capivara/skills/` e escolhe por área quais entram em cada fase. De volta,
registra as decisões da entrevista, o que o executor aprendeu e onde o trabalho
parou — tudo como rascunho, que não é servido a run nenhum até alguém aprovar. A
base é conveniência: fora do ar, o build segue com o que está no disco.

**§33 — o gate 4, que abre a aplicação.** O §28 deixou de ser pendente. Os fluxos
que o esqueleto sempre declarou viram roteiros Playwright, escritos por uma sessão
que não implementou a fase, guardados em `.capivara/flows/` e rodados pelo loop
contra o produto de pé. O roteiro fica no projeto, então o fluxo da fase 2
continua sendo percorrido na fase 7. O que dá para conferir sem abrir navegador —
um passo por `test.step`, um `expect` por passo, nada de `skip`, nada de
interceptar o próprio backend — é conferido antes. Provado contra navegador de
verdade: produto íntegro verde, produto sem o botão vermelho no passo 2.

O gate roda só os fluxos que a fase prometeu, mais os das fases já fechadas —
antes ele varria a pasta e cobrava de uma fase sem interface os roteiros de outra.
E quando o roteiro falha por si mesmo — violação de modo estrito, erro de sintaxe —
o harness o reescreve uma vez e roda de novo, em vez de mandar o executor consertar
um produto que está certo. Foi assim que a P02 do `MCP_teste` reprovou: um
`getByRole("alert")` sem âncora casava também com o anunciador de rota que o Next
injeta em toda página.

**§8.6 do plano — as correções do incidente `cron5`.** A função que decide de
quais fases os findings falam saiu do `init/orchestrator.ts` para
`src/contract/phase-references.ts`: a gramática do plano mora no contrato, e o
`architecture.spec.ts` cobra isso. Ela passou a reconhecer `Phase N`, `Fase N` e o
endereço `P2.T2.C1`, e a ler também a orientação de correção, não só o `where`.
Sem o terceiro formato, a correção do `cron5` foi inteira para a fase 1 enquanto o
defeito estava na 2. Sem fase identificável, o fallback conservador continua:
revisar todas.

No impasse existe agora o comando `reiniciar`, que abre um ciclo novo de correção e
auditoria do documento atual com os mesmos tetos, preservando entrevista, esqueleto
e plano. É controle de execução, nunca decisão de produto — o `cron5` gravou a
palavra como ACCEPTED e com isso liberou a rejeição seguinte como ressalva. Cada
reinício precisa ser pedido outra vez, e os números de tentativa seguem crescendo
para não sobrescrever os logs anteriores.

**§32 — o gate 0 reprovava toda volta bem-sucedida do claude.** É o mais grave
dos três, e foi o que travou o `cron5` com o sonnet.
 O gate procurava
o envelope JSON dentro do stdout; a ponte entrega o texto de dentro do envelope,
que ela mesma acabou de abrir. Com engine `claude`, só as chamadas que falhavam
passavam no primeiro teste do gate — nenhuma fase jamais fechou com esse executor.
Agora quem abre o envelope reporta os dois fatos (`resultRead`, `engineError`) e o
gate pergunta pelos fatos, para qualquer CLI com envelope, não só a do claude. O
teste que faltava é o da costura: CLI falsa, ponte de verdade, gate de verdade.

**O painel.** Cabeçalho compacto, com o mascote proporcional centralizado no painel
e o título à esquerda quando couber. A altura passou a ser medida a cada desenho,
como já era a largura: em tela baixa encolhem primeiro o histórico e a janela de
fases, depois a decoração, e a fase corrente e a atividade sobrevivem. A pergunta
mantém o conteúdo completo e vira saída estática quando não couber. O piso de 60
colunas saiu — ele fazia o terminal estreito quebrar linha e invalidar a contagem
que a região viva usa para redesenhar.

## O que NÃO está feito

Em ordem de importância, não de esforço:

1. **§27 — `skeleton.md` é derivado e ninguém confere.** O `plan` deveria
   recusar quando o markdown publicado divergir de `.skeleton-state.json`.
2. **O gate 4 só serve a produto que sobe como serviço.** Para CLI e biblioteca
   não há driver, e o caminho hoje é `--no-flows`. Os limites estão ditos no fim
   do §33.
3. **Falha de infraestrutura ainda consome ciclo de correção** e é devolvida ao
   executor como se fosse defeito do código dele. Está no fim do §32. O gate 4 já
   trata os três casos que conhece — aplicação que não sobe, pacote ausente,
   roteiro quebrado —, mas isso é caso a caso, não regra geral.
4. **Cosmético:** o painel do `plan` mostra "esqueleto do produto — aguardando"
   mesmo lendo um esqueleto que já existe. O pipeline foi desenhado para o `init`
   e o `plan` o herdou.

## As armadilhas, em uma linha cada

Coisas que custaram um run inteiro para descobrir e que **não são óbvias no
código**. Todas já corrigidas — estão aqui para não serem reintroduzidas.

- **Quando um modelo fraco falha, a primeira suspeita é o harness.** Foi errado
  duas vezes por mim: culpei o haiku e culpei o composer, e nas duas o defeito
  era nosso. O §30 e o §31 do plano são a lista do que estava escondido.
- **`--permission-mode plan` do claude escreve arquivos.** Um papel read-only
  configurado assim devolve a mensagem de erro da CLI como se fosse conteúdo.
- **`\Z` não é âncora em JavaScript.** É a letra Z. Um preflight passou meses
  sem verificar nada por causa disso — e o mesmo `\Z` ainda estava vivo na
  leitura do `pyproject`, onde derrubava o passo que prova que o produto sobe.
  O fim de texto se escreve `$(?![\s\S])`.
- **Nunca apague `.capivara/runs/` sem checar o lock.** Eu apaguei `src/` de um
  build vivo por diagnosticar como morto um processo que estava rodando.
- **Compare argv entrada por entrada, nunca a string juntada.** `-p` casa dentro
  de `--dangerously-skip-permissions`; `--mode` casa dentro de `--model`.
- **O auditor cita fase em três formatos.** `Phase 2`, `Fase 2` e `P2.T2.C1`. Quem
  conhece só dois manda a emenda para a fase errada — e a orientação de correção
  aponta a fase tanto quanto o campo do local.
- **Depois de um resize, a contagem de linhas do desenho anterior é ficção.** O
  terminal refluiu cada linha antiga; subir por aquele número apaga a coisa errada.
- **Quem abre o envelope é quem sabe o que havia dentro.** Depois da ponte, o
  stdout é o texto do agente; procurar ali o envelope da CLI é procurar o que foi
  retirado. Fato de envelope viaja como campo, nunca como regex sobre o texto.
- **Defeito de ambiente nunca vira defeito de produto.** Três vezes o executor
  foi mandado consertar o que não estava quebrado — envelope aberto pela ponte,
  aplicação que não subiu, pacote não instalado. A causa precisa dizer de quem é
  o defeito. Ver §34.8.
- **Roteiro errado vira produto pior.** Na fase 4 do `MCP_teste2` o seletor
  procurava um título dentro do `form`, e o título é irmão dele; o executor moveu
  o título para dentro do formulário, porque era a única saída que o harness
  deixava. Hoje ele pode responder `CAPIVARA_ROTEIRO_ERRADO: <por quê>`.
- **Porta fixa do gate 4 vira reprovação por processo esquecido.** No
  `MCP_teste2`, um `next-server` que o executor deixou vivo ocupou a 47533 e o
  gate relatou "a aplicação NÃO SUBIU" — no último ciclo da fase. A porta é
  escolhida livre a cada passagem agora.
- **O `agy` não trabalha no diretório em que foi lançado.** Sem `--add-dir`, o
  terminal dele roda em `~/.gemini/antigravity-cli/scratch`: o `npm install`
  funciona e instala na pasta errada, e o sintoma no harness é "a sessão não
  escreveu nada". Medido com `pwd`.
- **Permissão concedida pelo harness só vale se a CLI a honrar.** O executor
  pelo `cursor` recebia `-p --trust` e parava na aprovação de cada comando —
  aprovação que, em `-p`, não tem quem responda. Faltava `--force`. Toda CLI
  nova precisa ser conferida com um comando de verdade, não pelo `--help`.
- **Dependência do projeto não instalada vira mudança de produto.** No
  `MCP_teste2`, sem `node_modules`, o `npm test` morria por falta de `tsx`; o
  executor não pôde instalar — "o shell foi bloqueado" — e reescreveu o comando
  de teste do projeto para não precisar do pacote. A causa era a permissão da
  CLI; o preflight avisa, mas quem instala é o executor.
- **Chave de protocolo colada no fim de uma frase mata um run.** O auditor do
  `MCP_teste2` escreveu `…afirma.CAPIVARA_AUDIT_STATUS: APPROVED` e o parser, que
  exigia coluna 1, chamou de saída inválida — duas vezes, e o `plan` morreu com o
  plano pronto. O mesmo aconteceu no ensaio (`CRITERION` colado) e o verificador
  do build tinha a mesma meia tolerância. Os três leem pelo `desgrudarChaves`
  agora. Forma é responsabilidade do parser; conteúdo, de quem responde.
- **Juiz consultado duas vezes sobre a mesma coisa responde diferente.** O
  `plan` do `MCP_teste2` aprovou quatro fases na rodada 1 e reprovou as mesmas
  quatro na rodada 2, sem que uma linha delas mudasse. Onde o objeto não mudou, a
  resposta já é conhecida: reperguntar não acrescenta rigor, acrescenta variância.
- **O verificador acha um buraco por ciclo se ninguém lhe der a lista.** Na
  fase 4 do `MCP_teste` ele aprovou a task 6 no ciclo 1 e a reprovou no ciclo 2,
  sobre o mesmo código, enquanto reprovava a task 8 no ciclo 1. Os dois buracos
  existiam desde o início. O que é mecânico — o nome do teste existe na árvore? —
  não pode depender da atenção de um modelo.
- **`Module not found` do Next não é `Cannot find module '@playwright/test'`.**
  Um padrão que aceita `not found` solto classifica import quebrado do produto
  como ambiente faltando, e manda instalar o que já está instalado. Detecção de
  ferramenta ausente cita o nome da ferramenta.
- **Gate que decide sobre o produto deixa a prova no disco.** O evento do run
  guarda só a primeira linha da causa, e o painel some com o resto: a P03 do
  `MCP_teste` reprovou três vezes sem deixar uma linha do que o Playwright disse.
  Hoje a saída vai para `logs/<fase>.flow-run-<ciclo>.log`.
- **O relógio de primeira saída vira relógio da resposta inteira.** Numa CLI
  que só imprime o resultado no fim — `claude -p --output-format json`, cursor,
  agy — ficar calado é o estado normal de quem trabalha. O limite matou a fase 3
  do `MCP_teste` aos 20 minutos com o modelo escrevendo código. Hoje o adaptador
  declara se transmite, e quem não transmite fica sob o limite de parede.
- **Um seletor que casa duas vezes reprova um produto que funciona.** O Next
  injeta um `role="alert"` escondido em toda página; `getByRole("alert")` sozinho
  acha dois elementos e o Playwright recusa. O roteiro se ancora na região a que
  pertence, e o gate sabe distinguir o roteiro quebrado do produto quebrado.
- **A correção que fica pela metade** é a forma de defeito mais comum aqui: a
  verificação existe num lugar e falta no irmão. Ver a tabela no `CAPIVARA.md`.

## Como verificar que nada quebrou

```bash
npm run check     # build + typecheck + 1142 testes
```

O teste que mais protege a tese está em `test/architecture.spec.ts`: ele falha se
qualquer módulo fora de `src/contract/` recriar a gramática do plano, e se os
estágios de documentação voltarem a ter painéis separados.

Para exercitar sem gastar dinheiro, o catálogo de cenários do Apêndice B roda a
cadeia inteira contra um provider falso.

## Onde olhar quando algo falhar num run real

Desde o commit `4b08b08` os três estágios guardam transcrição:

```
.capivara/runs/<runId>/prompts/<estágio>.<assunto>.<papel>.<n>-<t>.txt
.capivara/runs/<runId>/logs/<mesma coisa>.log
.capivara/runs/<runId>/events.tsv
```

Antes disso, só o `build` guardava — e por isso não há como diagnosticar, hoje,
por que o minimax-m3 não fechou o `plan` do projeto `cron6`. Da próxima vez
haverá.

## O histórico da decisão

`docs/PLANO.md` é o registro de por que cada coisa é como é, em seções numeradas.
As mais recentes são as mais úteis para quem chega agora:

- **§26** — o ciclo de três estágios e a remoção da cadeia em prosa
- **§29** — o estágio que impunha uma convenção em vez de registrar um fato
- **§30** — três defeitos que uma execução de teste expôs
- **§31** — o que o harness sabia e não contava a ninguém
- **§32** — o gate que procurava o envelope que a ponte já tinha aberto (`cron5`)
- **§8.6** — as correções do incidente `cron5`, fora da ordem por ser emenda do §8
- **§34** — a base documental: o que ela guarda e como chega a quem precisa
