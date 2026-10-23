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
| branch | `fix/cooperacao-build-133` (§133, 0.7.7, push feito, sem merge) sobre a `main`; na `main`, a cadeia §129–§132 entrou por fast-forward em 22/10/2026 (a §122–§128 em 21/10/2026), e as branches de ajuste foram apagadas, local e no `origin` |
| versão | 0.7.7 na branch da §133 (com a §132, que entrou na `main` sem versão própria); 0.7.6 na `main`; planos da 0.6.x e da 0.7.x valem na 0.7.7 (a arquitetura com teste nos componentes é redesenhada, §129.10); os da 0.5.0 e anteriores são incompatíveis, ver §116 e §115.26 |
| suíte | 3234 testes em 170 arquivos na 0.7.7 (§133), `npm run check` verde (rc=0; as duas instabilidades conhecidas, `coerencia-temporal-127` e `integridade-122`, caíram uma vez cada sob load 10–13 e passaram na rodada seguinte); 3203 em 168 na `main` com a §132, `npm run check` verde (rc=0); 3130 em 167 na 0.7.6 sem a §132 (3121 em 166 na 0.7.5), `npm run check` verde (rc=0; um teste de sobreposição temporal do §127 falha também no código base sob carga alta); 3052 em 164 na 0.7.4 (§130); 3020 em 163 na 0.7.3 (§129); 2989 em 161 na 0.7.2 (2866 na §125, 2889 na §126, 2933 na §127); `npm run check` verde |
| estágios | `survey` (opcional) → `init` → `plan` → `build` → `change` (quantas vezes precisar) |
| CLIs integradas | `codex`, `claude`, `opencode`, `agy`, `cursor` |


## 2026-10-23 — Executor e verificador do mesmo lado: o que o harness pedia e ninguém podia entregar (§133)

Dois runs do Codex pararam por exigências do próprio harness, e não por
defeito do produto.

- **Astra** (`gpt-6-astra`, web): o roteirista do G4 recusou sete vezes em oito.
  O prompt dele proibia "rodar comandos", e no Codex ler um arquivo é rodar
  comando. O G3 também reprovou o servidor por honrar o `PORT`/`HOST` que o
  harness exige para o G4.
- **Luna** (`gpt-6-luna`, desktop Avalonia): o G4 exigiu um `start` HTTP. O
  executor criou `package.json` com `dotnet run` e depois um `HttpListener`
  falso no produto, e o G3 pediu cinco vezes para "confirmar visualmente" uma
  janela que nenhuma sessão abre. Foram 19 chamadas e 22 minutos até a parada.

O que mudou:

- roteirista e triagem podem rodar comandos que não mudam nada, como o G3;
- o roteirista pode responder `CAPIVARA_FORA_DO_NAVEGADOR: <linha da Stack>`.
  O trecho é conferido literalmente e só vale para fluxo da fase que nenhuma
  fase percorreu. O fluxo fica NÃO percorrido, como obrigação pendente, e nunca
  vira cumprido, regressão nem PASS. A guarda final o nomeia, e o build termina
  com código 2, também na retomada e depois de revalidação (`fases.json` e o
  livro). Se a Stack mudar, a fase reabre;
- a cobrança do `start` acontece depois da redação e da contestação; sem
  `start`, o roteirista é perguntado de novo uma vez por fase;
- o executor não é mandado criar servidor para produto fora do navegador;
- o G3 não bloqueia por observação impossível, julga critério de procedimento
  pelo comportamento e sabe que PORT/HOST é exigência do harness.

Nenhum gate, estado, limite ou condição por provider novo. 31 testes novos, 25
deles RED contra a 0.7.6; os outros 6 são guardas da saída nova. Duas revisões
adversariais acharam seis furos reproduzíveis na primeira rodada, entre eles um
PASS falso depois de reescrever o histórico; todos foram corrigidos e viraram
teste (§133.9).

A matriz, o custo medido e as limitações estão na §133 do PLANO. Ficam para
decisão:
- o campo de forma de acesso no INIT;
- o "num navegador" injetado no INIT/PLAN;
- G2 para .NET;
- o reparo do verificador que libera o executor sem árvore nova.

A árvore do `teste_c#` ainda tem o `package.json`, o `HttpListener` e roteiros
web do incidente; desfazê-los antes de retomar.

## 2026-10-22 — Ensaio do PLAN: o veredito logo depois do espelho do colchete (§132)

O PLAN do `laravel/mmax` (MiniMax-M3.1-Flash, API direta) parou em NOT READY
com quatro critérios "NÃO ENSAIADOS". O verificador tinha julgado os dezoito
critérios da fase 4, no formato `CRITERION P4.T2.C1 [Phase 4: … · …] OBSERVABLE —
…`. O parser exigia o primeiro dois-pontos da linha colado ao veredito, e
nessa linha não há dois-pontos depois do colchete, e há um dentro dele. A
segunda chance renumerou os endereços, e quatro critérios ficaram sem linha. O
`teste_minimax` parou do mesmo jeito em 19/10.

A correção é uma extensão restrita de `parseRehearsal()`. O espelho com o ` · `
do prompt é seguido do veredito, com ou sem dois-pontos, e precisa haver um
único lugar na linha em que isso acontece. A linha canônica tem precedência, e o
que a chave antiga lia não muda. Em todo log real de ensaio no disco (156 logs,
27 runs, todos os providers), 145 ficam idênticos, nenhum veredito anterior
muda, e entram 161 vereditos novos. Eles batem com a segunda chance que os runs
pagaram, menos um: um UNOBSERVABLE que a segunda chance tinha aprovado. Ficam
para decisão a segunda chance renumerada aceita como escrita e as formas ainda
não lidas (§132.7). Entrou na `main` sem versão própria: o binário continua 0.7.6.

## 2026-10-22 — MiniMax: a preparação que integra, o raciocínio que o modelo aceita, e o effort que o BUILD escolhe (§131)

O `laravel/mmax` (MiniMax-M3.1-Flash: API direta no INIT/PLAN, OpenCode no
BUILD paralelo) parou com a P01 verde, barrada na integração pelos manifestos
que a preparação deixou soltos na principal. Os quatro defeitos:

- **Adoção.** `adoptPreparedDependencies` só via pacotes de sondas `require`.
  Agora segue o link de `node_modules/.bin/X` até o pacote, e só adota o que uma
  sessão de preparação foi vista criando (`criados` no registro da sessão).
- **Engines.** O preflight aprovava o `vitest@5.0.5`, que recusa o Node 25, e o
  `--engine-strict` do build falhava depois. Agora a sonda que passa ainda
  confere o `engines.node` do pacote contra o Node do harness, e a recusa vira
  evidência da segunda sessão de preparação.
- **Raciocínio.** A guarda do raciocínio obrigatório conhecia só o nome da
  prévia (`-Preview`), e o PLAN levou HTTP 400. A regra por modelo agora está no
  catálogo (`registry.ts`), conferida na documentação oficial.
- **Effort no BUILD.** O OpenCode não declara variantes para o M3.1-Flash, que
  rodava sempre no `max` da API. O Core injeta as variantes documentadas
  (`output_config.effort`) na chamada e na listagem, e o wizard oferece os
  mesmos níveis no INIT, no PLAN e no BUILD, sem "desligado" onde a API recusa.

A revisão adversarial (dois agentes) levou a três correções:

- a proveniência passou a ser por conteúdo (sha256), porque os registros de
  outra execução do mesmo plano adotariam um manifesto reescrito pelo
  desenvolvedor;
- o preflight passou a ler os engines da árvore do lockfile;
- a preparação que não se adota agora para o build antes da primeira fase.
  Antes ela seguia, e no serial levava o manifesto (e o `node_modules`) para o
  commit da fase.

Medido no log, 60% do tempo das sessões é inferência, e o raciocínio (141 mil
tokens) é mais que o dobro da saída. São 69 cenários novos, e 51 falham contra o
código anterior. O mmax não foi tocado: retomar exige Node 22.12+/24/26, porque a
P01 fixou o Vitest 5. Detalhe na §131 do PLANO. Versão 0.7.5 na branch
`fix/minimax-integracao-131`, com push; sem merge na `main`.

Complemento (131.12, 0.7.6, com push): no BUILD, o wizard lista o catálogo da API
(dez modelos do MiniMax), e não só os dois que o OpenCode traz. Os que o
executor não roda aparecem com o motivo e não são escolhidos da lista: o
OpenCode recusa modelo fora do catálogo, e a interface compatível com Anthropic
do MiniMax só atende parte deles. Digitar o nome continua valendo.

## 2026-10-22 — execução progressiva: a fase grande vai ao executor em partes, e continua uma entrega só (§130)

O BUILD entregava a fase inteira numa sessão (`implementPrompt` com
`session.markdown`): nos planos do disco, até 40 critérios numa sessão só. Agora a
fase acima do orçamento — 15 critérios, ou o prompt acima de 48 mil caracteres
(o contexto fixo mais 16 mil, quando contrato e fatia já são grandes) — é
implementada em partes: grupos contíguos das tasks, na ordem do plano,
preferindo a fronteira de sub-fase, nunca cortando task; uma sessão nova por
parte, com o texto exato das tasks dela (`recorteDaFase`, no contract), a fatia e
o contrato inteiros, os títulos das tasks das partes feitas e os arquivos que as
sessões das partes mudaram (Git). A divisão é feita em código (`loop/partes.ts`),
a mesma para todo modelo — nenhum adapter informa a janela de contexto. Os gates
G2–G4 julgam a fase inteira depois da última parte; as partes não registram
defeito nem consomem orçamento de reparo; a parte que cai ganha uma sessão nova
(§125 C) e depois a fase para nela. O progresso é o campo opcional `partes` do
estado da fase; a retomada segue da primeira parte não feita, e a divisão é
refeita quando documento muda, o parcial é descartado ou o que as partes
escreveram muda por fora. A fase que cabe numa sessão vai com o prompt byte a
byte da 0.7.3.

Medido sem modelo nos planos do disco: 27 de 30 fases divididas em 2 ou 3 partes,
30 → 69 sessões, critérios por sessão 40 → 15, total enviado 1,9–2,2× (o contexto
fixo vai a cada parte). A medição derrubou o piso de 8 mil caracteres da primeira
versão (sete sessões para fases de contexto pesado). Uma revisão adversarial (um
agente) achou onze defeitos — o grave: a parte com G0 vermelho contava como feita
e era anunciada às seguintes —, todos corrigidos com cenário. 32 cenários em
`test/loop/execucao-progressiva-130.spec.ts`; 27 falham com a divisão desligada.
Validado só com provider falso. Detalhe na §130 do PLANO; o contrato e o
fluxograma do BUILD em `docs/CONTRATO.md`. Versão 0.7.4 na branch
`feat/execucao-progressiva-130`, com push; sem merge na `main`.

## 2026-10-21 — o plano não planeja teste, escolhe todas as dependências, e teste não é motivo de devolução (§129)

O Parallel Lab em `laravel/claude` (`init-dc741f0d7b92`, 0.7.2) parou na rodada
4 do PLAN — o auditor da P3 respondeu três vezes com "·" no lugar do "|" e o
`auditCall` bloqueou, fail-closed — mas o que fez as rodadas existirem foi a
rodada 2: nove achados, seis sobre teste (três tasks de teste a tirar com "o
requisito como critério" no lugar, e a P3 reprovada por NÃO ter o critério de
testes), e a triagem manteve os nove. A causa era o harness: a regra do
planejamento (o parágrafo F5 da §128) mandava carregar o requisito de testes do
pedido no componente e num critério, o esqueleto o pôs na stack, em regras e no
goal das fases, o auditor da arquitetura tratava a ausência como defeito, a dica
da I-16 dizia "mova-o", e a I-16 não contava "o módulo tem os seus próprios
testes automatizados". Decisões do Bruno no mesmo dia: o plano não planeja teste
em forma nenhuma; o pedido de testes é instrução ao build, como compilar; TODAS as
dependências do projeto, as de teste incluídas, são escolha do PLAN, e o BUILD
usa só as declaradas; teste não é motivo de devolução. Veio junto uma instrução
de restrição de escopo: inspecionar antes, usar os contratos existentes, corrigir
só o comprovado.

Agora: `testRequirements` conta o requisito de teste dentro do plano (I-16 nas
fases, no esqueleto e na arquitetura), com qualificador de software para não pegar
produto; o pedido de testes fica nas regras "testes…" e na stack, que o build já
lia pelo contrato compartilhado, e o plano não o lê (`skeletonForPlanning`,
também para esqueletos já publicados); `tirarPedidoDeTeste`, na saída de
`auditCall`, tira o achado, a ressalva e a decisão que pedem teste e deixa o que
manda tirar teste do texto; Vitest e Playwright ficam na infraestrutura da
arquitetura, e a I-16 das fases aceita declará-los no manifesto; no build, o
executor, o reparo, o G2 e o G4 instalam só o declarado, e a dependência não
prevista vai ao plano pelo `UPSTREAM:` do verificador. Nenhum campo, formato,
estado ou canal novo: o `skeleton.md` se lê byte a byte como antes. Uma revisão
adversarial (um agente) achou treze defeitos na primeira versão — o detector
contando texto de escola, laboratório, A/B e QA; o filtro aprovando fase por
citar `teste.nota_minima`; a correção que tira só lida no começo da frase; "mova o
requisito" sobrevivendo; o pedido de testes podendo sumir; a decisão de
ferramenta descartada — todos os reproduzidos corrigidos com cenário. Detalhe e
matriz na §129; 30 cenários em `test/contract/testes-no-build-129.spec.ts` e
`test/init/testes-no-build-129.spec.ts`, com os textos do run
(`test/fixtures/parallel-lab-129.*`); os 4 do orquestrador RED contra `e9c4431`
(o cenário da P3 termina em impasse na base). Os cenários anteriores que
codificavam a doutrina antiga foram reescritos; as fixtures do Luna e do
Parallel Lab 128 chegam limpas aos cenários de outros mecanismos por
`test/support/sem-testes.ts`. Validado só com provider falso. Versão 0.7.3 na
branch `fix/testes-so-no-build-129`, com push; sem merge na `main`. O contrato
completo dos três estágios, com o fluxograma, está em `docs/CONTRATO.md`.

O resumo de funcionamento do Bruno foi conferido contra o build: ver "O que o
resumo pede e o build ainda não faz", abaixo.

## 2026-10-21 — convergência do PLAN: a correção que o achado alcança fica, a fase que a reorganização não tocou também (§128)

O Parallel Lab no Luna (`init-dc741f0d7b92`, 0.7.1) saiu RALPH READY e o build
concluiu, mas o PLAN custou 64 chamadas para três CRUDs, uma fundação e um
painel. O que o harness fez a conta crescer, lido nos prompts e logs do run:
a emenda da P1 corrigiu a Task 1 E as Tasks 7 e 8 (a descoberta de páginas em
`src/web/`), e `preserveUnaddressedTasks` desfez as duas porque o endereço do
achado só nomeava `P1.T1.C3` — a coerência devolveu o conflito à arquitetura;
a reorganização mudou o envelope de P1 e P2, e P3–P5 (mesmo envelope, mesmos
componentes, duas já aprovadas) foram reescritas do zero, porque o cache da
escrita é o prompt inteiro; a Task 10 da P3 ("… e concluir a cobertura
automatizada própria do módulo") passou pelo I-16, que só lia o verbo no
começo da frase, e a triagem descartou o achado citando a própria frase — ela
não recebia a regra do planejamento; o auditor da arquitetura só via a última
rodada, e a validação dos formulários, escrita na v3 e perdida na v4, foi
aprovada sem ninguém reconferir. A origem dos caminhos errados foi o goal da
P1, que prometia a descoberta de páginas sem nomear o `web-shell`.
Agora: a emenda guarda as tasks que o achado alcança pelo que cita entre
crases (F1); a fase que a reorganização não tocou mantém o texto e é relida
contra a fatia nova — aprovações chaveadas por texto + fatia, coerência por
`architecture.md` (F2); a triagem recebe `harness` e `architecture` como
fontes, e o ADVISORY cuja citação mostra prescrição de teste é recusado (F3);
o I-16 lê o verbo depois de "e" e os verbos de conclusão (F4); a regra do
planejamento diz onde vive o requisito de testes do desenvolvedor (F5); o
auditor da arquitetura recebe os achados de todas as rodadas anteriores (F6);
o arquiteto sabe que toda fase cobre algo e que o goal só promete o que os
componentes da fase entregam (F7, F8). Uma revisão adversarial (um agente)
reproduziu na primeira versão dois defeitos altos — a fase mantida perdia a
decisão do desenvolvedor tomada na mesma rodada; o alcance casava tasks pela
posição e publicava a fase 1 sem a task das migrações — e quatro médios
(trecho genérico destravando a vizinha inteira, a regra do harness usada como
prova, decisão de dados fora da comparação, vocabulário de produto acusado pelo
I-16 novo); todos corrigidos com cenário: o alcance agora é linha a linha e só
pelo trecho da correção, a fase com achado aberto ou com caminho que saiu da
fatia não é mantida, a regra do harness é contexto, e as formas novas do I-16
exigem teste de software pelo nome. Medido nos cenários, com as respostas do
run: a cadeia A2 cai de 40 para 25 chamadas, a reorganização de 35 para 31, a
fase mantida que ficou velha de 65 para 39, e o caminho limpo fica igual (20).
Na base, o cenário da Task 10 publicava RALPH READY com a prescrição de teste
dentro. Nenhum teto mudou. Detalhe na §128; 56 cenários em
`test/contract/convergencia-128.spec.ts`, `test/init/convergencia-128.spec.ts`,
`test/contract/revisao-128.spec.ts` e `test/init/revisao-128.spec.ts` — 19 dos
29 primeiros RED contra `629ae11`, os 23 da revisão RED contra a primeira
versão. Validado só com provider falso; o efeito das mudanças de prompt (F5–F8)
precisa de run real. Branch `fix/convergencia-plan-128` sobre a
`fix/coerencia-temporal-127`; commits `7b86b47` (correção) e `0b3fdb9` (documentação),
push feito em 21/10/2026. No mesmo dia, a pedido do Bruno, a versão subiu para
0.7.2 e a cadeia inteira entrou na `main` por fast-forward; as outras branches
foram apagadas. Sem release.

## 2026-10-21 — coerência temporal: o fluxo é cobrado quando o plano diz que ele existe, e a oscilação entre gates é diagnóstico (§127)

O build do Luna (`build-8e24c805009f`, 0.7.0 + §126, paralelo) fechou P01–P03 e
parou a P04 — Gestão de categorias — com três ciclos esgotados, pondo e tirando
a integração de categorias quatro vezes: o G4 cobrava o fluxo 3 e o G3 cobrava
"o roteador é exportado sem registro no servidor central". A causa é do
harness: o G4 percorre os workflows que a fase COBRE, e ninguém dizia isso a
quem escreve `covers` — o prompt do arquiteto até oferecia "uma fase de
integração que depende dos módulos". O plano publicou a integração na P06 e o
fluxo na P04. O registro de defeitos agravou: a identidade do defeito do G4
era a prosa da triagem (cinco ids para a mesma falha, cada um resolvendo o
anterior "por não reproduzir"), a ponte de citações juntou a exigência e a
proibição por `/categorias`, e o relatório velho do reparo do verificador ficou
em todos os prompts. No PLAN, a decisão Q-71 do auditor da fase 3 saiu sem fase
e a emenda da fase 1 aprovada perdeu três tasks (~26 chamadas).
Agora: `contract/disponibilidade.ts` responde, para o plano e para o build,
quando cada workflow é cobrado — adiado só com evidência explícita (a fase nomeia
a posterior que o cobre e espera por ela; ou o caminho dele pela arquitetura só
fica de pé lá); o contrato da arquitetura recusa o fluxo cobrado sem caminho e o
adiamento para quem não espera; arquiteto, escritor e auditores recebem o
contrato e a tabela derivada; o G4 cobra só os fluxos da fase e registra os
adiados como obrigação (`adiado-N`), e o build não conclui com fluxo nunca
percorrido; a oscilação entre gates provada pela reversão causal (três ações,
dois gates, os mesmos arquivos, o mesmo defeito de volta) para a fase com
pacote documental ao PLAN; a âncora do G4 é o passo do roteiro; a ponte entre
gates só aceita mensagem; o relatório do reparo vale uma vez; a decisão de fase
leva a fase, somada às do endereço. A oscilação só vale entre a task do G3 e
o fluxo do G4, e só com o Git mostrando o estado rejeitado restaurado byte a
byte; a fase de destino de um adiamento é revalidada quando a de origem roda
de novo. Medido nos cenários: a oscilação da P04 cai de 26 para 8 chamadas, a
decisão de fase de 21 para 18, e o plano correto não ganha nenhuma. Nenhum
teto aumentou. Uma revisão adversarial (um agente) reproduziu sete defeitos na
primeira versão, todos corrigidos com cenário. Detalhe na §127; 44 cenários em
`test/contract/disponibilidade-127.spec.ts`, `test/loop/coerencia-temporal-127.spec.ts`,
`test/loop/oscilacao-127.spec.ts` e `test/init/coerencia-temporal-127.spec.ts`,
27 dos 32 primeiros RED contra a §126; os 12 da revisão cobrem os sete
defeitos que as sondas do revisor reproduziram contra a primeira versão. O run do Luna
não deve ser retomado como está (o plano publicado continua com P03/P05
revisitadas pela P06): `capivara plan` de novo, e depois `capivara build`.
Branch `fix/coerencia-temporal-127` sobre a `fix/impasse-init-plan-126`; sem
merge, push nem release.

## 2026-10-21 — o impasse INIT → PLAN: o procedimento da execução de teste não é requisito, e o envelope de fase se corrige na arquitetura (§126)

O Parallel Lab com Luna (0.7.0, run `init-dc741f0d7b92`) parou o PLAN na
tentativa 11 com "Impasse em project-phases.md após 1 devoluções": o Goal
das fases 2 a 5 dizia que "a execução automatizada dos testes e dos fluxos
cria e destrói o banco descartável … e fornece seu caminho por
DATABASE_PATH"; os auditores de fase mandavam tirar; o desenvolvedor foi
chamado a arbitrar três vezes. A cadeia, lida nos logs: o pedido só exigia
banco isolado e o escritor do esqueleto escreveu só isso; quem pôs "criado e
destruído pela própria execução dos testes" no `skeleton.md` foi o HARNESS
(`regrasDeBanco`, §115.10), e a fronteira da §123 mandava o PLAN manter essas
regras "exactly"; a auditoria da arquitetura cobrou um dono para o ciclo de
vida e o arquiteto o escreveu no goal das fases; e o goal é envelope, que a
emenda e o reparo da fase não alcançam — só um `where` "Architecture" levava
à reorganização, e a segunda nunca foi usada. A "decisão aceita" que os
auditores citavam era a arbitragem da rodada 7, gravada como ACEITA.
Agora: as regras de banco dizem o isolamento e deixam o procedimento ao
build; a fronteira do arquiteto/auditor diz que o procedimento nunca é
responsabilidade de componente nem goal de fase; I-16 ganhou a forma do
procedimento da execução (a execução de testes, "os testes", "a suíte" como
sujeito de criar/destruir/fornecer/definir…, e "atribuir à execução dos
testes a criação"), com o pedido como autoridade — no esqueleto ela é
tolerada como o I-17, na arquitetura volta ao arquiteto, nas correções do
auditor é substituída pela regra, e quem apaga por I-16 só apaga ferramenta;
e o achado sobre o envelope de fase (`audit/envelope.ts`) vai à emenda na
primeira vez e, quando VOLTA ao mesmo lugar (`P2·goal`, em qualquer redação),
à reorganização da arquitetura — nunca à arbitragem; esgotadas as
reorganizações, o run para com o diagnóstico que nomeia `architecture.md`. O
`plan` diz (e põe no relatório) quando o esqueleto em disco tem regras de
banco de outra versão do harness, com a rota (`capivara init`, que reaproveita
respostas e esqueleto em disco). Zero chamadas a mais no caminho limpo; nenhum
teto aumentou; nenhuma proibição de `DATABASE_PATH`. A forma nova exige um
recurso na oração (banco, arquivo, caminho, variável): "os testes definem a
nota mínima" é produto. A arquitetura guardada passa pelo contrato atual antes
de ser reaproveitada. Uma revisão adversarial (um agente) sobre a primeira
versão reproduziu sete defeitos, todos corrigidos com cenário. Detalhe na
§126; 23 cenários em `test/init/impasse-126.spec.ts`, 17 RED contra a 0.7.0. O run do
Luna não pode ser retomado (o `handoffs/` não voltou; e o esqueleto gravado e
as decisões arbitradas carregariam a contradição): `capivara init --fresh` e
`capivara plan`. Branch `fix/impasse-init-plan-126` sobre a
`feat/build-vnext`; sem merge, push nem release.

## 2026-10-21 — BUILD vNext: prova, defeito e recuperação localizada (§125)

Implementação integral do contrato `BUILD_VNEXT_ESPECIFICACAO.md` na branch
`feat/build-vnext` (sobre a `fix/triagem-124`), sem merge, push nem release.
O BUILD deixa de ser uma esteira que refaz G2→G3→G4 a cada correção e passa
a trabalhar com quatro registros do Core: a fatia da arquitetura de cada
fase (vai a executor e verificador, e entra na identidade das aprovações), o
livro de evidências (`runs/<id>/evidence.jsonl`, só acréscimo; o estado do
código é a árvore Git do que o commit levaria), o registro de defeitos
(`runs/<id>/defects/<Pxx>.json`: identidade entre gates, tentativas, escada,
orçamento derivado) e o handoff imutável do verificador (gravado antes de
qualquer reparo). Depois de cada ação, só a prova atingida perde a validade;
o desconhecido vai à consulta limitada, nunca é aprovado em silêncio; o G4
sem fluxo próprio e com a regressão provada fora do território da mudança é
NOT_APPLICABLE sem subir nada. Orçamentos por defeito (3), gate (2) e ciclo
(6), independentes, configuráveis (`--repairs-per-*`, Wizard) e fotografados
no `run.json`; o ciclo esgotado abre o seguinte sem voltar à implementação;
estratégia sem progresso não se repete no mesmo ciclo, e a que não muda
nada para a fase antes do fim (impossibilidade real). O reparo pelo
verificador é por gate e ciclo; a retomada de sessão é declarada por CLI e
opt-in (`--verifier-resume`), só contada pelo id devolvido, com fallback; quem
repara nunca valida. No paralelo, o conflito de cherry-pick é conciliado só
nos arquivos em conflito (marcadores diff3, escopo imposto pelo Core,
revalidação pelo que mudou) e os dois commits ficam; o escalonador evita
rodar juntas fases que a arquitetura põe nos mesmos arquivos. A entrega só
conclui com todas as fases fechadas (o `--keep-going` declarava "todas
verdes"), commita o reparo da aceitação e escreve `entrega.md` (como rodar,
limitações); `relatorio.md/json` sai das mesmas linhas da TUI. O reparo
documental (BUILD → PLAN; o INIT ainda não) só existe com pacote validado em
`.capivara/repairs/upstream/`, conferido de novo na entrada do `plan`, com a
pergunta de escopo quando o impacto passa do defeito; a edição automática do
documento não foi implementada (§8.3: a troca segura não é demonstrável).

Duas revisões adversariais em workflow: 20 defeitos confirmados no C/D/E,
corrigidos com teste RED→GREEN; 16 no F/G/H, idem. Nenhum formato antigo
deixa de ser lido: o que entrou é campo opcional, arquivo novo no plano de
controle, ou a versão 2 do checkpoint de integração (o leitor aceita a 1);
nenhuma migração.

Ainda sem run com modelo real: as provas são o provider falso, o catálogo e
os cenários do §13 da especificação. O primeiro run real deve ser lido em
`runs/<id>/relatorio.md`, `defects/` e `evidence.jsonl` antes de culpar o
modelo.

## 2026-10-20 — integridade da triagem: finding material só está resolvido quando o plano está coerente (§124)

O mesmo `haiku`, agora com a §123: esqueleto limpo em uma chamada,
arquitetura em três rodadas, 63 chamadas, 39 minutos, RALPH READY — e o plano
publicado mandando as fases 3, 4, 5 e 6, sem ordem entre si, "acrescentar"
em `src/servidor/modulos.ts` e `src/web/navegacao.ts` as entradas que a
fundação já entregava completas. O auditor de coerência apontou três rodadas
seguidas, com a correção certa; a triagem de materialidade descartou três
rodadas seguidas ("os conflitos desaparecem se os módulos só substituírem os
próprios stubs… a conclusão depende de remover as edições") — porque o
prompt dizia "if any valid implementation satisfies both, use ADVISORY" e o
código aceitava qualquer citação existente, mesmo da fundação, para apagar
um achado que acusava outras fases; o ADVISORY aprovava a fase e gravava a
coerência como aprovada. Duas correções. (1) I-18
(`contract/ownership.ts`): fases sem dependência entre si não recebem
obrigação de escrita no mesmo arquivo — a obrigação é a frase da task que
ordena criar/acrescentar/registrar/alterar um caminho (infinitivo,
imperativo, "registrá-la"); critério, fonte ("importado de"), consumo
("usando"), subordinada ("se… existir") e a terceira pessoa que descreve não
contam; fases com ordem, direta ou transitiva, podem alterar o mesmo
arquivo. É a metade irmã, por arquivo e por fase, da serialização por
componente da §119. Roda como self-check mecânico do `auditOnce` (emenda só
na task que escreve — o achado mecânico ganhou endereço `P<n>.T<m>`, também
no I-16 —, com quem cria o arquivo e o componente nomeados, sem inventar
`dependsOn`), como item "propriedade" do RALPH READY (13 itens) e no
`change`, que nunca teve self-check nenhum e era a porta aberta para o
build. A concorrência é a do escalonador (`effectiveDependencies` espelha
`dependenciasEfetivas`, com teste de equivalência). Calibrado nas 52 tasks
reais, agora fixture da suíte: só os oito conflitos. (2) Triagem: o prompt ganha as
três situações do pedido (falso positivo / ambiguidade material que exige
correção documental / contradição) e perde a regra da implementação possível;
`applyMaterialityReview` recusa o ADVISORY de um achado que envolve duas ou
mais fases (citadas ou declarada) se a evidência não cita cada uma delas, com
o tokenizador do contrato (`phaseReferences`) — o parecer real da rodada 4 do
`haiku` é recusado, um falso positivo com todas as fases citadas continua
descartável, e o achado por fase recebe os dois lados. Zero chamadas a mais no
caminho limpo; sem alterar o build. Uma revisão adversarial (quatro lentes)
sobre a primeira versão rendeu os casos de negação, aparte, genitivo, crase,
prosa com ponto, nome ambíguo, fundação implícita, endereço de task, achado
por fase e `change`, todos incorporados. Detalhe na §124; 25 + 6 + 5 + 2 + 10
cenários em `test/contract/ownership.spec.ts`,
`test/loop/escalonador-contrato.spec.ts`, `test/audit/materiality.spec.ts`,
`test/change/change.spec.ts` e `test/init/triagem-124.spec.ts`, 23 RED na
primeira versão. Retomar o `haiku` com este binário reescreve as fases: o
prompt da fase mudou e o cache é chaveado por ele.
Branch `fix/triagem-124` sobre a `fix/fronteira-init-plan-123`; sem merge na
`main` sem autorização.

## 2026-10-20 — a fronteira INIT → PLAN: requisitos sem arquitetura prematura (§123)

O `haiku` (Parallel Lab, 0.6.2) fechou o esqueleto em uma chamada e gastou
trinta minutos na arquitetura: seis rodadas, mudança de estratégia, dois
reparos, bloqueio e reinício à mão. Quatro dos seis defeitos cobrados eram
mecanismos que o pedido nunca fixou e o esqueleto inventou — `APP_DB_PATH`,
`data/parallel-lab.db`, "CREATE TABLE IF NOT EXISTS antes de o servidor
aceitar requisições", `E2E_PORT` (vinha do PROMPT do esqueleto),
`src/nucleo/api.ts`, `src/casca/rotas.tsx`, a página de cada módulo em
`src/modulos/<modulo>/Pagina<Modulo>.tsx`, uma stack "Estrutura de pastas" —
e a regra do harness "criar ou alterar esquema fora desse comando é
proibido" foi a outra metade da contradição que o auditor mandou o arquiteto
não resolver. Agora: I-17 (`contract/mechanism-prescription.ts`) devolve ao
escritor, com os termos, caminho de arquivo, variável de ambiente, comando e
código (DDL, chamada) sem autoridade no pedido ou nas decisões; a stack que é
só estrutura de pastas sai contando; rotas HTTP ficam (o build lê o contrato
de interface do `skeleton.md`). Escritor ×2, auditor ×1, e o resíduo é
PUBLICADO com ressalva — nunca bloqueia. O prompt do esqueleto perde "the
ONLY time anyone looks at the whole product" (falso desde a §116) e
`E2E_PORT`, ganha "Product, not implementation" e fases preliminares; a
entrevista não pergunta como implementar; arquiteto e auditor ganham
`MECHANISM_BOUNDARY`: regra que fixa COMO sem autoridade não é produto, o
mecanismo é do arquiteto, e as regras do banco são requisito dos gates. A
regra de migração perde a proibição e ganha o nome que `loop/ambiente.ts`
sempre exigiu (`migrate` no `package.json`) — o `haiku` tinha escolhido
`migrar`, e os gates não migrariam nada. Zero chamadas no caminho limpo.
Detalhe na §123; 20 cenários em `test/init/fronteira-123.spec.ts`, 17 RED.

## 2026-10-20 — integridade do PLAN: autoridade técnica e independência do reparo (§122)

O `minimax` (DeepSeek-Flash, 0.6.2) fechou o PLAN em 151 chamadas e US$ 0,12
— e o relatório trazia decisões "confirmadas" que ninguém deveria ter
perguntado: como o `rotas.ts` obtém o `Database`, `router.get('/')` ou
`router.get('/tarefas')`, quem declara o script `test`. Quatro respondidas
"fica como está", duas contradições materiais publicadas como decididas
(módulo sem o `export const prefixo` que a fundação exige; `npm test` sem
fase que o crie). Agora a autoridade é classificada pela FORMA do ponto
(`src/audit/authority.ts`: caminho, chamada, export, script, variável de
ambiente): decisão do auditor com todas as leituras em código e achado com
problema e correção em código são do plano — vão ao escritor com as
leituras e a nota, nunca ao desenvolvedor; o que não é inequívoco continua
indo a ele. A decisão dele no impasse vale para os pontos decididos e não
promove achado posterior a ressalva; a não-resposta recomeça a correção uma
vez e depois para com diagnóstico, nunca publica; "publicar" leva os achados
ao relatório. Verifier inválido duas vezes depois de um reparo passa ao
ESCRITOR, nunca ao auditor que reparou; sem leitor, diagnóstico. I-16 ganhou
a prescrição sem ferramenta (task "entregar a suíte", "cobrir os cenários",
"task de testes", tipo e organização), também no goal das fases e na
correção do auditor; o requisito do pedido fica como critério. Identidade
dos achados por vocabulário (`mesmoPonto`), com `incertos` no balanço.
Arquitetura recusa arquivo com dois donos. Zero chamadas a mais no caminho
normal. Detalhe na §122; 22 cenários em `test/init/integridade-122.spec.ts`,
19 RED contra a 0.6.2.

## 2026-10-19 — RECOVERY FIRST: o INIT e o PLAN trabalham para concluir (§121)

Dezesseis lançamentos de bloqueio no orquestrador; os recuperáveis viviam em
quatro laços (esqueleto, arquitetura, escrita de fase, ciclo de auditoria do
plano), e todos paravam quando o ESCRITOR esgotava o teto — como se o escritor
fosse a única alternativa. Agora cada laço sobe a mesma escada: correção
determinística; emenda ao escritor com os achados consolidados e o balanço de
progresso (§120); mudança de estratégia (§119); REPARO PELO AUDITOR, com o
mesmo prompt do escritor mais o bloco de reparo (achados, histórico compacto,
limites); e VALIDAÇÃO INDEPENDENTE PELO VERIFIER, em sessão própria — quem
reparou nunca julga. Dois reparos por documento; esgotados, o plano segue para
a arbitragem e o impasse de sempre, e a arquitetura para com o diagnóstico:
o que ficou aberto e as estratégias tentadas, nesta ordem, com o estado em
disco. Saída inválida do auditor duas vezes passa ao verifier; esqueleto,
arquitetura e fase sem estrutura válida passam ao auditor. O caminho sem
defeito não ganhou chamada nenhuma. Detalhe na §121 do PLANO; os onze
cenários em `test/init/recovery-first-121.spec.ts`. No provider falso, o
papel que repara cai no roteiro do escritor e o que valida no do auditor
quando não têm passo próprio: é o que os roteiros antigos modelam.

## 2026-10-19 — auditoria consolidada e convergência por evidência (§120)

No mesmo `teste_openrouter3` (0.6.1) a auditoria da arquitetura devolveu
cinco vezes: a cada rodada fechou o que tinha apontado e trouxe um ponto novo,
sete defeitos em cinco leituras — três deles presentes desde a primeira
arquitetura, como a comparação das versões em cache mostra. O arquiteto
convergia, o auditor lia aos pedaços, e o run parou por contagem. Agora o
ciclo mede cada rodada (`balancoDaRodada`: fechados, persistentes, novos,
regressões, mesmo texto): a rodada que fecha tudo e só traz pontos novos não
gasta o teto; o que persiste, regride ou volta idêntico gasta; e o dobro do
teto é o teto duro contra o auditor que nunca termina de ler. A auditoria da
arquitetura usa o mesmo `nextAuditAction` do plano, leva à reauditoria o que
a leitura anterior apontou, e leva ao arquiteto os achados abertos juntos e o
que já fechou para não voltar. Os prompts do auditor (arquitetura, fase,
plano, coerência) pedem uma leitura completa — todos os eixos, todos os
defeitos materiais numa resposta — e os do arquiteto e da emenda pedem a
correção conjunta. Nenhuma chamada nova; nenhum limite subiu como solução.
Detalhe na §120 do PLANO; os sete achados reais estão em
`test/init/auditoria-consolidada-120.spec.ts`.

## 2026-10-19 — o conflito técnico não vai ao desenvolvedor (§119)

Um `plan` real na 0.6.1 parou num "IMPASSE · precisa da sua decisão" sobre
`architecture.md` "após 1 devoluções": o auditor cobrava que as fases 3, 4 e
5 editariam `server/index.ts` e o roteador da interface sem ponto de extensão,
e o harness perguntou ao desenvolvedor — que não tem o que decidir ali. Duas
causas em código: o orçamento das devoluções da auditoria da arquitetura era o
contador das reorganizações do plano, já gasto; e nada representava "fases sem
ordem que estendem o mesmo componente", então o auditor julgava um mecanismo
em vez de uma propriedade. Agora o parser serializa, por `dependsOn`, as fases
sem ordem entre si que estendem o mesmo componente (campo que o escalonador do
build já lê; nada novo no contrato); ponto de extensão e fase de integração
passam sem mudança; o arquiteto e o auditor recebem as três saídas como
válidas e "paralelismo é otimização"; a auditoria da arquitetura tem orçamento
próprio (`maxAuditReturns`), troca de estratégia uma vez (resolver por ordem,
sem mecanismo novo) antes de desistir, e se nem assim convergir o run para com
o diagnóstico — sem pergunta e sem publicar. O mesmo acontece no plano quando
o arquiteto devolve a mesma arquitetura a uma reorganização. Detalhe na §119
do PLANO; testes em `test/init/impasse-tecnico-119.spec.ts`.

## 2026-10-19 — a autoridade das decisões e a prescrição de teste (§118)

No mesmo run do `teste_openrouter3`, o auditor da fase 5 viu uma task que
exigia "automação com Vitest e Playwright" em `src/quality/…`, viu a regra do
planejamento que proíbe prescrever teste, e perguntou ao desenvolvedor qual
das duas valia — com "manter a automação" recomendada por ter sido escrita
primeiro. Ele confirmou, e a partir daí as auditorias exigiram a prescrição
como "decisão confirmada", até gastar as reorganizações da arquitetura. A
cadeia começava antes: o pedido dizia só "testes automatizados", e o esqueleto
inventou as ferramentas na stack; a arquitetura fez delas um componente com
arquivos de configuração de teste; as fases herdaram. Agora a regra é um
invariante do contrato (I-16), conferido em código nos três documentos com o
pedido e as decisões da entrevista como única autoridade para nomear uma
ferramenta ou um arquivo de teste: lista se separa contando (stack sobre
testes, sonda, item de infraestrutura, arquivo em `files`), prosa volta a
quem escreve como defeito nomeado, e no plano é emenda mecânica na task
certa. Uma CAPIVARA_DECISION que é uma regra do harness vira esse achado em
vez de pergunta; nenhuma leitura do auditor é recomendada; a decisão genuína
de produto continua chegando ao desenvolvedor. Detalhe na §118 do PLANO; os
testes em `test/init/autoridade-118.spec.ts`.

## 2026-10-19 — o travessão no finding (§117)

Um `plan` real (`teste_openrouter3`, run `init-dc741f0d7b92`) parou na sexta
rodada com dois achados certos na mão, porque o auditor de coerência escreveu
`CAPIVARA_FINDING: Architecture — <problema> | <correção>` — travessão no
lugar do primeiro `|` — e o parser recusou a resposta inteira, duas vezes.
Agora `parseAudit` lê esse caso como os três campos que ele contém, só quando
a separação é inequívoca (travessão com espaços, localização curta e
reconhecível, descrição e correção presentes), anuncia o conserto e nada mais
muda: três campos não são tocados, o que é ambíguo continua inválido,
`REJECTED` continua `REJECTED`. O caminho do achado `Architecture` até a
reorganização já existia e é o que o teste de orquestração prova. Detalhe e
limites na §117 do PLANO; as duas respostas reais estão em
`test/audit/finding-travessao.spec.ts`.

## 2026-10-19 — a reformulação do INIT e do PLAN (§116)

Cinco commits numa branch própria, cada um com `npm run check` verde antes de
sair. O que está feito e o que vem a seguir, em ordem de importância:

**Feito.** O `plan` tem uma etapa de arquitetura antes das fases: o arquiteto
decide componentes, contratos, decisões de dados, fluxos, infraestrutura (cada
item com a autoridade da escolha) e a divisão de fases que vale; um auditor
independente a julga; o esqueleto publicado passa a carregar essa divisão e as
sondas dela, e cada fase recebe a fatia da arquitetura. O contrato é
`capivara-phases/v2`, sem `Feature tests` (I-15 recusa o rótulo antigo), e a
geração é `capivara-planning/v3`. A recuperação é orientada à conclusão:
reparo determinístico, emenda localizada por fase, memória em disco de
esqueleto, arquitetura, fases, aprovações por task, coerência e ensaio,
repetição limitada para provider indisponível, erro do motor nunca lido como
resposta, e mudança de estratégia (arbitragem) quando a emenda não muda o
texto. As nove regressões pedidas estão em `test/init/reformulacao-116.spec.ts`.

**Próximo, na etapa do build.** (1) O executor e o roteirista do G4 não leem
`architecture.md`: o prompt do executor cita só `skeleton.md`. É a primeira
coisa a mudar lá, e é por isso que as tasks nomeiam arquivo, rota e função.
(2) O `change` carimba a arquitetura mas não a atualiza nem escreve fases com a
fatia dela. (3) O auditor da arquitetura não passa pela triagem de
materialidade. (4) Nenhum run real com a 0.6.0 ainda: o primeiro deve ser lido
em `prompts/` e `logs/` antes de culpar o modelo — a suspeita é o harness.

**Armadilhas pagas nesta reformulação.** A chave de uma aprovação não pode
incluir o que muda com a própria memória (a lista de tasks aprovadas mudava o
sha e a aprovação de ontem sumia). Erro do motor com texto não se repete às
cegas: o corte por tokens e a recusa de credencial são definitivos (§115.14).
`Promise.all` sai na primeira rejeição com as irmãs ainda escrevendo; esperar
todas antes de propagar é o que faz a retomada custar só a fase que faltou.
Sob carga (load 13 em 4 núcleos), dois cenários do build paralelo e um do
reinício do G4 falham por tempo e passam isolados; não são da reformulação.

Correções de planejamento e pré-requisitos (§§115.38–39): o teste_minimax
expôs uma sonda Playwright inválida, screenshot em /dev/null. O Core agora
redireciona só esse destino conhecido a PNG temporário real e limpa depois,
sem alterar plano/CLI nem ignorar falha do navegador. O instalador havia
substituído o CLI global por adaptador; restaurado o link oficial 1.51.1,
com backup do adaptador na evidência do run. Os cinco requisitos passaram,
com documentos do usuário intactos e sem inferência paga. Sessão com exit 1,
resultado legível e sem recusa/timeout/erro estrutural pode ser recuperada
somente se o Core comprovar os requisitos, reutilizando a prova uma vez.

Decisão explícita: planejamento define entregas e contratos observáveis;
validador escolhe testes. Templates não pedem Feature tests, escritores e
revisores do plan não projetam suítes nem fases de testes por iniciativa
própria. Parser e hashes existentes preservados; prescrições antigas são
advisory salvo requisito explícito do usuário. Removida a varredura de nomes
antes do G3. O verificador escolhe a menor prova suficiente e reaproveita
resultados verdes. O executor implementa verificações concretas pedidas pelo
validador; a revalidação completa após reparo continua ativa. Evidência real:
/tmp/capivara-minimax-environment-proof.log. Testes focados finais: 109 verdes.
O usuário autorizou commit de TODAS as alterações acumuladas na main.
Check final passou build, typecheck e 2535 testes em 132 arquivos (166,68 s).
Bundle instalado 0.5.0 recompilado às 13:52:51; caminho e versão conferidos.

Correção de 19/10/2026 (§115.31): autoria e triagem do G4 recebem finalidade
explícita, preservando os limites gerais configurados (§115.32). Uma
falha técnica dessas sessões conserva o parcial e não abre outra construção.
OpenCode 2 ignorava OPENCODE_PERMISSION; permissões agora também vão para a
configuração efetiva, com leitores negando por padrão e somente ferramentas
de leitura/busca autorizadas. Configuração e limites de modelos são preservados.
Prompt é salvo antes da chamada; painel e calls.jsonl distinguem os papéis G4.
Escopo dos roteiros limitado aos passos/critérios entregues, um teste por fluxo,
sem passos extras. Reescrita recebe o roteiro atual; patch literal único da
triagem pode corrigir um seletor sem uma nova sessão do roteirista. O Core
confere unicidade e estrutura antes de aplicar. Provas locais sem inferência:
config.get real confirmou as permissões novas e ausência das regras quando só
a variável antiga era fornecida; npm run check passou 2468 testes/126 arquivos.
Binário instalado recompilado em 0.5.0. Execução do projeto e seus modelos não
foram reiniciados, e nenhuma chamada paga foi feita para validar a correção.
Por decisão explícita do usuário, retirados os cortes especiais de 5/2 minutos
(§115.32): eficiência vem do escopo, das permissões e do reaproveitamento das
correções, preservando a política geral de supervisão. Nova regressão pela ponte
comprova os limites configurados sem alteração para autoria e triagem. Check
completo novamente verde (2468 testes), bundle instalado recompilado.

P03 de teste_openrouter (§115.33): a terceira triagem tinha patch exato, mas o
limite global de duas correções o descartava. Reparo agora é contado por passo
de workflow, com janela conservadora por fluxo quando o erro não identifica o
passo. Fonte idêntica devolvida pelo autor não roda outro navegador. Mensagem
de ROTEIRO já identificado não pede concordância ao executor. Prompts usam
identidade exata no filho com o nome; não texto agregado que inclui cor/data.
Antes/depois real em cópia do parcial c5031dd: primeiro reproduziu a falha,
depois os três CRUDs passaram em 23,1s, preservando asserções e código do produto.
Roteiro de categorias corrigido publicado somente no cache do projeto, com
hashes/logs em recovery/g4-categorias-e6bf03e20a2d do run build-c9958d3f064e.
HEAD 2bd3b2e, branch parcial e ledger preservados; P03 não foi aprovada por fora.
144 testes direcionados e check completo: 2470 testes/126 arquivos, sem chamadas
pagas. Bundle instalado recompilado em 0.5.0; retomar build sem --fresh.

P05 de teste_openrouter (§115.34): roteiro inválido e falha transitória de revisão
agora usam os próximos ciclos configurados, sem outra construção nem repetição
de G2/G3 aprovados. Rascunho inválido e diagnóstico seguem para a correção;
roteiro publicado é relido para preservar patches aplicados pelo Core. Fonte
idêntica rejeitada não abre outro navegador. Recusa permanente de credencial ou
quota mantém parada específica. Sem novos cortes de tempo. Corrigida também a
contradição entre exigir carregamento/indisponibilidade e proibir controle de
GET: atraso e abort de leitura são permitidos; respostas próprias fabricadas
continuam proibidas. Listas vazias usam dados reais no banco descartável.
Os quatro fluxos reais passaram em 26,8s na cópia do parcial 5246953, sem modelos.
Roteiro de dashboard validado publicado somente no cache, com evidências em
recovery/g4-dashboard-e0f3540645c7 do run build-c9958d3f064e. HEAD, parcial e
ledger preservados; nenhuma aprovação externa de P05. Check completo verde:
2480 testes/126 arquivos, build e typecheck; 209 testes direcionados passaram.
Binário instalado 0.5.0 recompilado. Retomar capivara build sem --fresh.

Plan em teste_openrouter2 (§115.35): a coerência aprovou o índice na passagem
13 e voltou a rejeitar pares intactos na 15, enquanto exemplos de outras fases
na explicação ampliavam os destinos da emenda. Endereço agora define destino;
prosa só localiza fase quando o endereço não resolve. Emendas recebem contratos
atuais das fases relacionadas e preservam tasks não citadas, sem nova chamada
por mudança lateral. Aprovação global serve de base sob as mesmas decisões;
par intacto vira observação, mas referências alteradas, desconhecidas, novas ou
removidas, e decisões novas, conservam a auditoria normal. O auditor precisa
demonstrar incompatibilidade de implementação, sem confundir detalhes de
redação com defeitos. Emendas aceitas atualizam o cache de escrita e sobrevivem
à retomada. Orçamento não foi ampliado e não há publicação por esgotamento.
Reproduções locais sem API: três regressões falharam antes do reparo; 131 testes
direcionados passaram depois. Durante a análise, a pasta teste_openrouter2 foi
limpa externamente; nenhum plano do projeto foi editado para obter aprovação.
Check final: build, typecheck e 2494 testes/128 arquivos passaram. Duas
expectativas antigas foram ajustadas: nova geração agora precisa pedir fresh
quando o reparo já está no cache, e a mensagem de impasse não presume gap de
entrevista. Binário instalado recompilado em 0.5.0 e caminho confirmado para
packages/core/dist/cli.js. Nenhuma geração completa pela API foi executada
nesta validação; o resultado comprovado é a correção das reproduções locais.

Nova execução em teste_openrouter2 (§115.36): o processo começou às 12:01:58
com o bundle das 11:57:33 e seu prompt salvo contém a política nova; a correção
anterior estava incompleta, não havia executável antigo. Sem aprovação global
prévia, o auditor continuou confundindo operações/fixtures/fases diferentes e
interseções válidas (204 versus 200 ou 204), levantando decisões técnicas que
alteravam a autoridade. Agora um lote independente do verifier confere esses
bloqueios antes de devolver ou perguntar. Remoção exige fonte/citação literal
conferida pelo Core; bloqueio real, prova inválida e decisão material permanecem.
JSON/IDs/omissão inválidos conservam todo o veredito; citação inválida conserva
aquele item sem perder outro parecer fundamentado. Sem rodadas próprias ou
aumento do teto; novos logs e progresso identificam #materialidade. Política
do auditor também distingue implementação de negócio e evita exigir novo
teste para cada frase. Corrigida leitura de fases isoladas com sub-fases N.x,
que perdia memória de tasks aprovadas, e a localização de emendas por sub-fase.
Tasks omitidas sem pedido estrutural são preservadas junto da correção válida.
Duas regressões de materialidade e duas de sub-fase falharam antes do reparo;
93 testes direcionados passaram e outra seleção incluindo catálogo passou 101.
Check final: build, typecheck e 2512 testes/129 arquivos passaram. Executável
instalado 0.5.0 recompilado às 12:20:02, caminho e conteúdo verificados.
O run real terminou RALPH READY às 12:10:55, ainda com o código anterior;
não atribuir esse resultado à nova triagem nem pedir que refaça o plan.
Projeto/plano preservados, sem restart/cancelamento ou chamadas pagas nossas.
Diagnóstico guardado em /tmp/capivara-openrouter2-diagnostic-yt5i2dch.


Correção de pré-requisitos no teste_openrouter2 (§115.37): as sessões de
instalação criaram backend/package.json e instalaram better-sqlite3, mas a
sonda continuava na raiz e acusava Node ausente. Agora probes Node que importam
pacotes externos usam todos os manifestos que os declaram; builtins/runtime
ficam na raiz. O build continua comprovando TODOS os requisitos antes das fases.
O instalador pode criar manifesto mínimo no workspace indicado pelo plan/hint;
o Core admite somente manifesto/lock novos dos pacotes sondados e mantém
node_modules fora do histórico via exclusão local, sem levar código/alterações
alheias nem mudanças em manifestos rastreados. Instalação pronta é reaproveitada.
Respostas do provider são respeitadas; sessões, prompts, resposta e atividade
ficam registrados desde a preparação, sem dizer custo zero após usar modelos.
Os registros em runs/<run>/preparation sobrevivem ao arquivo dos logs antigos;
aviso de ausência é retirado quando a prontidão passa. Regressões reproduzidas
antes/depois incluem resolução, cota recusada, custo e retomada dos registros.
Check final passou build, typecheck e 2526 testes/130 arquivos. Bundle instalado
0.5.0 recompilado às 12:57:01 e caminho/conteúdo conferidos. Prova real de leitura
com Node 25.9.0: os três requisitos passaram, SQLite carregado no backend; cópia
isolada confirmou admissão de apenas backend/package.json e package-lock.json,
árvore limpa e prontidão. Evidência: /tmp/capivara-real-environment-proof.log.
Projeto atual tem nove fases, RALPH READY às 12:32:43, plan sha12 f7bb0d2b7dc6
e skeleton sha12 47e986558006. Documentos e refs reais preservados; nenhuma
inferência paga nem execução do desenvolvimento por nós. Basta retomar build.

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

**Roteiros do gate 4 dividindo estado — CONSERTADO no §84.** A evidência veio na
segunda passagem da P02 do `assistencia2`: o fluxo "Instalação inicial" lia um arquivo
que só o instalador cria, e ninguém rodava o instalador. Cada passagem do gate 4 agora
roda num ambiente próprio (diretório pessoal e banco em arquivo descartáveis), os
roteiros rodam em sequência na ordem do plano, e o roteirista tem um ajudante para o
que é terminal. Roteiros gravados antes da v2 são reescritos uma vez.

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

### O que o resumo pede e o build ainda não faz (21/10/2026)

O resumo do Bruno conferido contra o código do build (matriz completa na §129.4).
A fronteira de dependências foi ajustada na §129; o resto foi preservado, de
propósito, por ser contrato ou por não haver evidência de custo em run:

1. **As dependências são validadas a cada `capivara build`, não uma vez por
   projeto** (§115.25: "a aprovação vale para esta execução"); dentro do run, as
   fases recebem o ambiente aprovado (`loop/build.ts:904`). O seed do `.env` e a
   migração rodam antes de todo G2 e de toda passagem do G4, de propósito.
2. **O ajuste das dependências com o agente é estreito**: só os pré-requisitos de
   sistema do `environment.json`, em terminal interativo, em até 2 rodadas
   (`loop/build.ts:431-497`); a preparação do projeto e do Chromium param na
   primeira falha, sem agente (`loop/environment-prepare.ts`).
3. ~~A fase vai inteira numa sessão~~ — resolvido na §130: a fase acima de 15
   critérios vai ao executor em partes, e os gates a julgam inteira. Ficam: as
   sessões de correção ainda recebem a fase inteira como referência, e a
   política de orçamento é a mesma para todo modelo (nenhum adapter informa a
   janela).
4. **O G4 para no primeiro fluxo que falha** (os roteiros são encadeados), e as
   falhas do G4 chegam uma por vez.
5. **A regressão volta ao G2** depois de uma correção do G3/G4 que muda código: é
   a revalidação por impacto (a suíte prova o produto inteiro), exigida pelo
   contrato. Mudar isso é decisão do Bruno.
6. **Reparo upstream**: o PLAN não consome o pacote (por desenho, §125); a
   alegação `UPSTREAM:` pode vir do trecho do último rediagnóstico, que num
   defeito do G2 é a saída da suíte; a recuperação sugerida depois de documento
   mudado é `init --fresh`, que não reaproveita as respostas da entrevista.

### O que já estava pendente

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
5. **O `init` perde o pulso do painel depois da primeira pergunta.** Ele usa
   `live.release()` para ceder a tela, e `release` para o pulso para sempre; o
   painel só volta a se mexer quando chega evento. O build já usa
   `live.suspend()`, que cede e retoma. Trocar no init mexe no desenho da
   pergunta dentro do painel — é mudança de outra natureza, fica para um run
   próprio.
6. **O preflight exige o PROGRAMA `sqlite3` quando a stack usa o PACOTE.** No
   `assistencia2` o SQLite entra pelo pacote npm `sqlite3`, que traz a biblioteca
   embutida; nada chama o binário, e o build parou pedindo para instalá-lo.
   `detectPrerequisites` confunde "a stack usa SQLite" com "precisa do cliente de
   linha de comando".
7. **A migração só é reconhecida pelo nome `migrate`.** O `assistencia2` declara
   `db:migrate`, então o banco novo de cada passagem do gate 4 começa sem tabelas e
   quem migra é o primeiro roteiro, pelo ajudante. Funciona enquanto a ordem da
   passagem é a certa (§84.5); reconhecer a migração por outros nomes tornaria isso
   independente do roteiro. Decidir com evidência.
8. **Gate 4 — parar no ciclo determinístico.** Quando o executor não muda nada e
   o gate 4 falha IGUAL ao ciclo anterior, o próximo ciclo vai falhar de novo. Na
   P05 do `assistencia2` foram quatro ciclos assim (§86). Parar, ou escalar, em vez
   de queimar ciclo.
9. **Gate 4 — a triagem reescreve uma vez por ROTEIRO, não por passagem.** Na P08
   a primeira triagem reescreveu o workflow 15 e a segunda, sobre o workflow 9 —
   outro roteiro, nunca reescrito —, foi ao executor e custou um ciclo (§87). O
   limite existe contra laço no mesmo roteiro; roteiro diferente é seguro.
10. **Gate 4 — o roteirista escreve vendo a página.** Subir a aplicação e entregar
    o retrato de acessibilidade das telas do fluxo antes da redação, em vez de
    deixá-lo adivinhar pelo código. Junto, as regras que faltam no prompt: esperar
    a confirmação visível antes de navegar ou recarregar; não conferir rótulo,
    título ou contêiner que a fase não especifica; não conferir o FORMATO da
    resposta da API (`true` × `1`), só o que o usuário vê.
11. **Esqueleto e plano — especificação que o build não consegue fechar.**
    (a) passos de fluxo com o resultado observável de cada um ("o tipo aparece na
    lista"), porque é isso que o roteiro confere e hoje ele inventa; (b) critério
    "conforme a permissão de cada operação" sem dizer se editar implica consultar
    — na P05 cada ciclo achou uma combinação nova; o auditor deveria cobrar a
    implicação no init; (c) fase de uma task só (a P06 tem uma, o esqueleto previa
    dez). Vale para projeto novo: muda init e plan.
12. **Entrega sem instrução de implantação.** O `assistencia2` chegou à P11 sem
    README: nada diz ao operador como pôr o produto no ar com a stack DECLARADA
    (preencher o `.env` para MySQL, qual comando rodar, onde fica o arquivo de
    credenciais do usuário inicial). A aceitação operacional sobe o produto numa
    cópia limpa, mas não confere se alguém de fora saberia fazer o mesmo. E houve
    um desvio de interpretação que um documento assim teria exposto: o pedido era
    criar o usuário inicial "no momento de instalação", o esqueleto diz que o
    comando de migração "é o que o desenvolvedor roda depois de preencher o
    `.env`", e o produto entregou DOIS comandos (`db:migrate` e
    `install:initial`) — quem segue o esqueleto fica com banco sem usuário.
13. **Banco de produção diferente do banco de teste, e ninguém diz.** O pedido
    declara MySQL remoto e manda testar em SQLite. Migração e instalador só rodaram
    contra SQLite; o knex esconde parte das diferenças, não todas (o MySQL recusa
    índice único em coluna `TEXT` sem tamanho, o SQLite aceita). Sem MySQL o
    harness não prova nada — mas o relatório final deveria dizer, com todas as
    letras, "a migração nunca rodou contra o banco de produção declarado", em vez
    de silêncio. E quando o engine estiver disponível (um contêiner, por exemplo),
    exercitá-lo.
14. **Gate 2 — teste instável sem nome.** Quando o executor diz que a suíte passou
    e o gate 2 a vê falhar no mesmo teste, isso é sinal de instabilidade (P07,
    `cliente_criado_no_modal_disponivel`). A causa poderia dizer isso, em vez de
    deixar o executor descobrir. E a suíte do `assistencia2` já leva cinco minutos
    por passagem.
16. **Init, plan e change não separam motor que falhou de resposta ruim.** Só o
    build (gate 0) e, desde o §91, o survey olham `exitCode`, `resultRead` e
    `engineError`. Nos outros, uma CLI que falha antes de responder vira "o modelo
    devolveu texto inválido" e gasta tentativas pedindo correção de forma. Mesma
    família do §91; ficou de fora para não misturar com o conserto do survey.
17. **O survey não guarda o que o modelo respondeu.** A ponte não grava respostas, e
    a parada do survey aponta `.capivara/runs/survey-…` relativo à pasta atual,
    quando o run mora sob a pasta de saída — e lá também não há nada. No cronus3 o
    diagnóstico teve de ser feito reproduzindo a chamada.
15. **Gate 4 — a resposta da API na causa.** Quando um passo falha por status HTTP
    (o 400 da edição do tenant, na P04), o corpo da resposta — a mensagem de erro
    do produto — não chega a ninguém; o executor reproduz para descobrir.

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
npm run check     # build + typecheck + 2866 testes
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
