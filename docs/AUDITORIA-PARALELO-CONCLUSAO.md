# Correções da auditoria do paralelo — relatório de conclusão

Data: 2026-10-15. Escopo: os achados **B1, B2, M1, M2 e M3** de `docs/AUDITORIA-PARALELO.md`. A decisão está
registrada em `docs/PLANO.md` §99.

**Estado do Git:** as correções estão **no working tree, sem commit**, no branch `main`, para revisão. Só este
relatório foi commitado e enviado. Base: `7754eee`.

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
  - `desfazerSemApagar` (`:304`): se o `reset --keep` recusa, o HEAD volta com `--soft` e os arquivos ficam como
    alteração não commitada;
  - os três casos param como falha fatal, dizendo os arquivos e o branch da fase.
- **Evidência:**
  - teste "M1: arquivo não versionado…": antes, "conflito ao integrar" e a fase refeita duas vezes; agora uma
    sessão, erro com `coverage/report.txt`, conteúdo da principal intacto, fase no branch;
  - teste "M1: suíte vermelha com a árvore alterada…": antes, o `phase-3` ficava no histórico; agora o HEAD não o
    tem, o arquivo alterado pela suíte continua com o conteúdo dela, e a fase está no branch.

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

## Arquivos modificados (sem commit)

| Arquivo | O que mudou |
|---|---|
| `packages/core/src/loop/paralelo.ts` | B1, B2, M1 (uso), M2, M3 |
| `packages/core/src/loop/worktree.ts` | `impedimentosDaPrincipal`, `desfazerSemApagar`, `integrar` com `recusada` |
| `packages/core/test/loop/paralelo.spec.ts` | bloco "auditoria (§99)" com 7 testes; o motor falso ganhou `veredito` e `lanca` |
| `docs/PLANO.md` | §99 |

**Análise de impacto:** `integrar` e `desfazerIntegracao` só são usados por `paralelo.ts`; `executarEmParalelo`, só
por `build.ts` no ramo `parallel`. O runner, o serial, os gates e o contrato não foram tocados. O `esquecer` já
existia e já era usado no conflito; agora é chamado em mais desfechos.

## Testes e resultados

- **Antes das correções:** os 7 testes novos falharam, cada um pelo defeito do seu achado (os outros 10 do arquivo
  passaram).
- **Depois:** os 17 passaram.
- **`npm run check` na raiz:** rc=0, 98 arquivos, **1890 testes** (1883 de antes mais os 7).
- **Intermitência medida:** o teste antigo "fases independentes rodam ao mesmo tempo" exige que P02 e P03 se cruzem
  numa janela de 80ms e às vezes não se cruzam. No código original falhou 2 em 50 execuções; com as correções, 3 em
  50. Já existia e não vem destas mudanças; não foi alterado por estar fora do escopo.

## Riscos restantes

- **Parada mais frequente e explícita:** projetos cuja suíte reescreve arquivo versionado (por exemplo `coverage/`
  ou um SQLite commitado) agora param como falha fatal, dizendo o arquivo. Antes falhavam com o diagnóstico errado
  ("conflito"). Ficou correto, mas o build para.
- **Árvore suja depois do `--soft`:** no M1 com reset recusado, a árvore principal fica com o código da fase como
  alteração não commitada. O preflight seguinte sugere `git add -A && git commit`, o que poria esse código vermelho
  no histórico. A mensagem da fatal diz o que aconteceu, mas a sugestão do preflight continua genérica.
- **Custo do B2:** uma fase que falha perde também aprovações de runs anteriores e reverifica essas tasks na
  retomada.
- **Irmão serial do B2, não corrigido:** a instrução "descarta e a fase recomeça do zero" do runner também deixa
  aprovações de um código descartado.
- **Ainda abertos da auditoria:** M4 (stacks sem npm), m1 a m3 e os INFO. O paralelo continua sem teste com
  provider real.

## Próximo passo

Revisar o diff; aprovado, commitar as correções com `npm run check` verde. Depois, um piloto Node com 2 agentes.
