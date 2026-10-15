# Correções da auditoria do paralelo — relatório de conclusão

Data: 2026-10-15. Escopo: os achados **B1, B2, M1, M2 e M3** de `docs/AUDITORIA-PARALELO.md`. A decisão está
registrada em `docs/PLANO.md` §99.

**Estado do Git:** as correções estão publicadas na branch de revisão `revisao/correcoes-paralelo-99`, **sem merge
na `main`**: `7c9dc79` (B1, B2, M1, M2, M3 e o ajuste do rollback) e `be2e69b` (proteção de segredos e não
versionados na recuperação). Na `main` está só este relatório.

## Correções por achado

### B1 — a suíte da árvore integrada rodava sem preparar o ambiente

- **Correção:** a integração chama `prepararAmbiente(projectRoot, options.instalar)` antes do G2, o mesmo preparo
  que o runner faz no worktree: semeia o `.env` a partir do `.env.example` e aplica a migração do ambiente
  descartável. A saída da migração vai para `<fase>.migrate-integracao.log` (`loop/paralelo.ts:272`).
- **Evidência:** teste "B1: a suíte da árvore integrada roda com o .env preparado". Antes da correção, a P01
  reprovava na integração, era refeita sozinha e falhava ("mesmo rodando sozinha…"); agora o build fecha e a árvore
  principal tem o `.env` com a marca do harness.

### B2 — aprovações sobreviviam ao código que saiu da árvore

- **Correção:** `esquecer` (revogação das aprovações da fase) passou a ser chamado em todo desfecho em que o trabalho
  fica fora do produto: parou num gate (`paralelo.ts:370`), não fechou nem sozinha ou não pôde ser integrada
  (`:354`) e erro inesperado (`:388`). O worktree que nem abriu não revoga, porque nada foi aprovado nem saiu da
  árvore.
- **Evidência:**
  - teste "B2: a fase que para num gate…": antes, `tasks.json` guardava a task 1 da P02 aprovada sobre código que
    só existia no branch; agora fica vazio, e a retomada não manda o verificador carimbar ("Already DONE" ausente
    do prompt);
  - teste "B2: a fase que nem sozinha fecha…": antes, a aprovação da P03 ficava; agora sai, e a da P02 (integrada)
    continua.

### M1 — árvore principal não conferida, falhas chamadas de "conflito", commits reprovados no HEAD

- **Correção, em `loop/worktree.ts`:**
  - `impedimentosDaPrincipal` (`:289`), antes do cherry-pick, recusa integrar quando há arquivo versionado alterado
    ou arquivo não versionado no caminho da fase. Não versionado fora do caminho, como o `.env` semeado, não impede;
  - o `integrar` só chama de conflito o que deixou arquivo em conflito; o resto é `recusada` (`:179`, `:212`);
  - `desfazerSemApagar`: se o `reset --keep` recusa, primeiro guarda e depois limpa (ver "Ajuste do rollback"
    abaixo);
  - os três casos param como falha fatal, dizendo os arquivos e o branch da fase.
- **Evidência:**
  - teste "M1: arquivo não versionado…": antes, "conflito ao integrar" e a fase refeita duas vezes; agora uma
    sessão, erro com `coverage/report.txt`, conteúdo da principal intacto, fase no branch;
  - teste "M1: suíte vermelha com a árvore alterada…": antes, o `phase-3` ficava no histórico; agora o HEAD não o
    tem, a árvore volta a ser a de antes da integração, o que estava nela fica num branch guardado, e a fase está no
    branch dela.

### Ajuste do rollback — o `--soft` promovia código reprovado

A primeira versão do M1 voltava o HEAD com `--soft` e deixava o código da fase reprovada na árvore como alteração
não commitada.

- **Impacto:** na execução seguinte o `isClean` acusava árvore suja, e o preflight (`loop/preflight.ts:95`, o mesmo
  do serial) sugeria `git add -A && git commit`. Seguir a sugestão punha o código reprovado no histórico, e a
  retomada refazia a fase sobre um HEAD que já o tinha.
- **Correção, só no rollback:** o preflight, o serial e o runner não mudaram. Quando o `reset --keep` recusa,
  `desfazerSemApagar`:
  1. guarda primeiro: o estado inteiro da árvore (a fase integrada mais o que a suíte escreveu, versionado ou não)
     vira um commit no branch `capivara/<run>/<fase>-reprovada-<sha>`, montado com um índice temporário, sem tocar
     no índice nem na árvore da principal;
  2. só depois limpa: `reset --hard` para o commit de antes da integração, e remoção só dos não versionados que a
     integração criou — os que já estavam ficam;
  3. se guardar falhar, nada é limpo.
- **Evidência:** o teste "M1: suíte vermelha com a árvore alterada no caminho…" foi reescrito. Com o `--soft` ele
  falhava (`AM coverage/report.txt`, `A relatorio.txt` no status). Agora passa e confere que:
  - `git status --porcelain` está vazio e os arquivos da integração reprovada não estão em disco;
  - o branch guardado tem o que a suíte reescreveu e o código da fase (o que ela criou sem versionar vai para a
    recuperação local, ver o ajuste seguinte);
  - a retomada começa sem barreira do preflight, refaz a P03 pelos gates, o `phase-3` aparece uma vez só no
    histórico e o branch guardado continua lá.

### Ajuste da recuperação — segredos e não versionados fora do Git

O commit de recuperação usava `git add -A` num índice temporário.

- **Impacto:** qualquer não versionado entrava no branch de recuperação — inclusive um `.env` não ignorado, com
  segredo, e os arquivos do usuário que já estavam na árvore. Num branch, o segredo vira objeto permanente do
  repositório e vai para o remoto num push. `desfazerSemApagar` só é chamado no rollback do M1 (e da fatal do M2);
  o preflight, o serial e o runner não foram tocados.
- **Correção (`be2e69b`):**
  1. o commit de recuperação leva só versionados (`add -u`), menos os de nome de segredo — `arquivoSensivel`:
     `.env` e `.env.*` menos os exemplos, `*.pem`, `*.key`, chaves de SSH;
  2. os não versionados que a integração criou e os versionados sensíveis são copiados para
     `.capivara/runs/<run>/recuperacao/<fase>-<instante>/`, que o Git ignora;
  3. os não versionados que já estavam não são copiados, commitados nem removidos;
  4. a guarda é comprovada (sha256 de cada cópia, blob de cada versionado no branch) antes do `reset --hard`; sem
     prova, nada é limpo e o erro diz onde a árvore ficou.
- **Evidência:** os três testes de cenário falharam no código anterior, cada um pelo motivo do risco, e passam agora:

| Teste | Antes | Agora |
|---|---|---|
| `.env` não ignorado | `.env` com o segredo no branch de recuperação | fora do branch e de todo `git log --all -p`; copiado inteiro para a recuperação local; árvore limpa |
| Arquivo preexistente | `notas-locais.txt` commitado no branch | continua na árvore com o mesmo conteúdo; fora do branch e da recuperação |
| Falha ao gravar a recuperação | a árvore era limpa mesmo assim | erro "não limpei a árvore"; nada apagado nem sobrescrito; nenhum branch de recuperação |
| M1 reescrito | `saida-da-suite.log` ia para o branch | só na recuperação local |
| Regra de nome sensível (unitário) | — | passa; `.env.example` e `id_ed25519.pub` não contam como segredo |

### M2 — integração depois de falha fatal

- **Correção:** a fila de integração consulta `fatal` dentro da vez de cada fase (`paralelo.ts:179`). A fase que
  ainda rodava termina, fica no branch dela e não entra.
- **Evidência:** teste "M2: depois de uma falha fatal…": antes, a P03 era integrada sobre a árvore quebrada; agora
  não entra, é anunciada como "não foi integrada" e o commit dela está no branch.

### M3 — exceção numa fase deixava órfãos sem lock

- **Correção:** `lancar` captura o erro inesperado (`paralelo.ts:379`): o parcial vai para o branch, nada mais sai
  nem entra, e o laço espera os agentes em andamento. O `Promise.race` também não sai mais do laço numa rejeição
  (`:455`). O erro sobe só no fim (`:462`), como no serial.
- **Evidência:** teste "M3: erro inesperado numa fase…": antes, `runBuild` rejeitava com a P03 ainda rodando
  (`ativos` = 1); agora nenhum agente está ativo quando o erro chega, o histórico não muda depois, o parcial da P02
  está em `wip(P02)` e a P03 verde está no branch.

## Arquivos modificados (na branch de revisão)

| Arquivo | O que mudou |
|---|---|
| `packages/core/src/loop/paralelo.ts` | B1, B2, M1 (uso), M2, M3 |
| `packages/core/src/loop/worktree.ts` | `impedimentosDaPrincipal`, `desfazerSemApagar` (guarda comprovada, só versionados no commit, cópia local do resto), `arquivoSensivel`, `integrar` com `recusada` |
| `packages/core/test/loop/paralelo.spec.ts` | bloco "auditoria (§99)" com 11 testes; o motor falso ganhou `veredito` e `lanca` |
| `docs/PLANO.md` | §99 |

**Análise de impacto:** `integrar` e `desfazerIntegracao` só são usados por `paralelo.ts`; `executarEmParalelo`, só
por `build.ts` no ramo `parallel`. O runner, o serial, os gates e o contrato não foram tocados. O `esquecer` já
existia e já era usado no conflito; agora é chamado em mais desfechos.

## Testes e resultados

- **Antes das correções:** os 7 testes novos falharam, cada um pelo defeito do seu achado (os outros 10 do arquivo
  passaram).
- **Depois:** os 17 passaram.
- **`npm run check` na raiz:** rc=0, 98 arquivos, **1894 testes** (1883 de antes, os 7 dos achados e os 4 da
  proteção de segredos). O bloco da auditoria passou 5 vezes em 5 depois de cada ajuste.
- **Intermitência medida:** o teste antigo "fases independentes rodam ao mesmo tempo" exige que P02 e P03 se cruzem
  numa janela de 80ms e às vezes não se cruzam. No código original falhou 2 em 50 execuções; com as correções, 3 em
  50. Já existia e não vem destas mudanças; não foi alterado por estar fora do escopo.

## Riscos restantes

- **Parada mais frequente e explícita:** projetos cuja suíte reescreve arquivo versionado (por exemplo `coverage/`
  ou um SQLite commitado) agora param como falha fatal, dizendo o arquivo. Antes falhavam com o diagnóstico errado
  ("conflito"). Ficou correto, mas o build para.
- **Arquivos ignorados no rollback:** arquivos ignorados pelo Git (por exemplo `node_modules` depois de um
  `npm install`) não são guardados nem voltam ao estado anterior. Não afeta o histórico nem o preflight.
- **Branch da fase na nova execução (m3):** rodar de novo ainda apaga `capivara/<run>/<fase>`; o branch
  `-reprovada-…`, que também tem o código da fase, sobrevive.
- **Regra de segredo por nome:** um segredo num arquivo de outro nome não é detectado. Não chega ao Git se não for
  versionado, porque nada não versionado entra no commit; se for versionado, já está no histórico desde o commit da
  fase.
- **Guarda sem prova:** quando a recuperação não pode ser comprovada, a árvore fica intacta, mas o HEAD continua com
  os commits da integração reprovada — a mensagem diz isso. É o preço de não fazer `reset --hard` sem prova.
- **Cópias locais:** os sensíveis copiados ficam em disco em `.capivara/runs/`, fora do Git, com a permissão que o
  `fs.cp` der (não é forçado `0600`).
- **`add -A` no parcial e no commit da fase:** `guardarParcial` e `commitPhase` ainda usam `git add -A` no worktree.
  Um `.env` da principal não versionado e não ignorado é copiado para o worktree e entra no branch da fase, e no
  verde, pelo cherry-pick, no histórico da `main`. O `commitPhase` serial faz o mesmo hoje; não foi tocado por estar
  fora do escopo.
- **Custo do B2:** uma fase que falha perde também aprovações de runs anteriores e reverifica essas tasks na
  retomada.
- **Irmão serial do B2, não corrigido:** a instrução "descarta e a fase recomeça do zero" do runner também deixa
  aprovações de um código descartado.
- **Ainda abertos da auditoria:** M4 (stacks sem npm), m1 a m3 e os INFO. O paralelo continua sem teste com
  provider real.

## Próximo passo

Revisar a branch `revisao/correcoes-paralelo-99`
(https://github.com/RBTecNet/capivara-harness/compare/main...revisao/correcoes-paralelo-99); aprovada, merge na
`main` com `npm run check` verde. Depois, um piloto Node com 2 agentes.
