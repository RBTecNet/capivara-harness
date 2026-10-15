# Auditoria adversarial do build paralelo (§97, §97.1, §98)

Data: 2026-10-15. Commits auditados: `5060543` (motor), `f823151` (wizard e CLI), `d4d30a3` (log por agente).

Auditoria somente leitura. `npm run check` na raiz: rc=0, 98 arquivos, 1883 testes. Os testes passam porque
`test/loop/paralelo.spec.ts` não exercita `.env`/banco na integração, árvore principal suja, exceção durante uma
fase, nem retomada depois de falha. Três defeitos foram reproduzidos com o próprio `worktree.ts` num repositório
descartável (marcados **reproduzido**).

**Veredito: não está seguro para um piloto paralelo real.** Antes do piloto: B1, B2, M1, M2 e M3, cada um com o
teste de regressão. Primeiro piloto: projeto Node, 2 agentes. M4 pode esperar se o piloto for Node.

## BLOCKER

### B1. A suíte da árvore integrada roda sem preparar o ambiente

- **Onde:** `packages/core/src/loop/paralelo.ts:209-210`. No serial, `loop/runner.ts:529` chama `prepararAmbiente`
  (semeia `.env` a partir do `.env.example` e aplica a migração) antes do G2. Na integração não há essa chamada, e a
  árvore principal nunca passa por ela.
- **Cenário:** projeto com `.env.example` e suíte que lê ambiente ou banco (o perfil do `assistencia`). A fase fica
  verde no worktree e vermelha na árvore integrada; é refeita sozinha, reprova pelo mesmo motivo, e falha. Em toda
  fase, de forma determinística.
- **Correção:** chamar `prepararAmbiente(projectRoot, instalar)` antes do `gate2` da integração, gravando a saída da
  migração como o runner faz.
- **Teste:** projeto com `.env.example` e suíte que falha sem `.env`; a integração tem de ficar verde.

### B2. Tasks aprovadas sobrevivem à falha, mas o código delas sai da árvore

- **Onde:** `paralelo.ts:289-294` — a fase que falha leva o parcial para o branch e não chama `esquecer`.
  `runner.ts:624` grava as tasks DONE mesmo quando a fase não fecha. `prompts/verifier.ts:51` instrui o verificador:
  "Emit `TASK <n>: DONE` for each of them and move on".
- **Cenário:**
  1. P3 falha no ciclo 3 com as tasks 1 a 4 aprovadas.
  2. O código fica só em `capivara/<run>/P03`.
  3. O `capivara build` seguinte abre o worktree a partir do HEAD, que não tem esse código.
  4. O verificador carimba as tasks 1 a 4 como DONE sem olhar.
- **Impacto:** o G3 aprova código que não existe, no caminho mais comum de retomada. O G2 e a busca por testes
  nomeados cobrem só parte. No serial o parcial fica na árvore; aqui é o harness que o tira.
- **Correção:** revogar as aprovações da fase em todo desfecho não integrado — falha, credencial recusada, limite
  esgotado, worktree que não abriu.
- **Teste:** fase com tasks aprovadas falha no paralelo; depois, `tasks.json` não tem nada dela.

## MAJOR

### M1. A árvore principal não é conferida antes de integrar, e toda falha do cherry-pick vira "conflito"

- **Onde:** `loop/worktree.ts:193-200` (o `catch` classifica tudo como conflito), `worktree.ts:236-238`
  (`reset --keep`), `paralelo.ts:197-213`.
- **Reproduzido:**
  - arquivo não versionado escrito pela suíte integrada (ex.: `coverage/`) e commitado pela fase seguinte:
    `{"status":"conflito","arquivos":[]}`; a fase é refeita, conflita de novo, falha;
  - arquivo versionado alterado localmente: o `reset --keep` recusa (`Entry 'coverage/report.txt' not uptodate`) e
    o HEAD **fica com os commits reprovados** — cai no caminho `fatal`.
- **Também:** o `npm install` da integração pode reescrever o lockfile e sujar a árvore.
- **Correção:** exigir `git status --porcelain` limpo (fora `.capivara`) antes do cherry-pick e depois do G2 e do
  install; separar conflito real (arquivos em estado U) de árvore suja e de outros erros.
- **Teste:** os dois cenários acima.

### M2. Depois de um `fatal`, as fases em andamento continuam integrando sobre a árvore quebrada

- **Onde:** `paralelo.ts:166` liga `fatal`; `integrarFase`/`integrarNaFila` não o consultam.
- **Cenário:** o segundo cenário de M1 em P2 com P3 rodando; P3 termina e é aplicada sobre os commits vermelhos de P2.
- **Correção:** com `fatal`, não integrar mais nada; manter o branch e marcar a fase como não integrada.
- **Teste:** `desfazerIntegracao` lança em P2 com P3 concorrente; P3 não entra na árvore.

### M3. Exceção numa fase deixa as outras rodando sem lock

- **Onde:** `paralelo.ts:347` e `:354`. Se `rodar`, `aposIntegrar`, `esquecer` ou `evento` lançam, o `Promise.race`
  rejeita e `executarEmParalelo` sai; o `finally` de `build.ts:900` libera o lock; as outras fases seguem chamando
  modelos e fazendo cherry-pick na principal. O worktree da fase que lançou é removido sem `guardarParcial`, e o
  parcial se perde.
- **Correção:** capturar dentro de `lancar` e tratar como falha `fatal`; ou, em qualquer rejeição, parar de lançar,
  esperar `Promise.allSettled` de todas e só então relançar.
- **Teste:** `rodar` lança em P2 com P3 lenta; a função só retorna depois de P3 terminar, e nada é integrado depois
  do retorno.

### M4. Stacks que não são Node não têm dependências na árvore principal

- **Onde:** `paralelo.ts:197-207` só instala com npm, e só quando há `package.json`.
- **Cenário:** projeto Python — o `.venv` existe só no worktree; o G2 integrado falha (runner ausente ou
  ImportError), a fase é refeita e falha, sempre. Cair para concorrência 1 não resolve: a integração é a mesma.
  Em pnpm/yarn, `npm install` gera um `package-lock.json` solto.
- **Correção:** stack sem instalação suportada vira impedimento do paralelo até haver suporte; em pnpm/yarn, usar o
  gerenciador do lockfile.
- **Teste:** fixture Python com `requirements.txt`, impedida com motivo claro.

## MINOR

- **m1. O estado gravado culpa a fase errada.** `build.ts:539-542` atribui a falha à primeira fase "pending"; no
  paralelo a fase que falhou já está em `phases` (`build.ts:787`), então uma fase que nunca rodou é registrada como
  falha. Correção: pular a heurística no paralelo.
- **m2. `trazerRoteiros` sobrescreve roteiros novos com cópias velhas.** `worktree.ts:248-258`: P2 e P3 abrem com o
  roteiro do fluxo 1 em v1; P2 contesta, reescreve para v2 e integra; P3 integra depois e copia a v1 por cima.
  Correção: guardar o sha de cada roteiro ao abrir e só trazer o que mudou no worktree.
- **m3. Rodar de novo apaga o branch que guardava o parcial.** `worktree.ts:115` (via `limparSobra`, `branch -D`).
  **Reproduzido:** o commit `wip(P03)` sumiu e o branch voltou a apontar para `feat(phase-2)`, depois de a mensagem
  ter mandado olhar esse branch. Correção: renomear para `…-tentativa-N` em vez de apagar.

## INFO

- **Escalonador** (`loop/escalonador.ts`): fundação, dependência ilegível, barreira da exclusiva, bloqueio
  transitivo e desempate determinístico estão corretos; não achei impasse. Risco de projeto: `Depends on` sem uma
  dependência real gera código duplicado, que entra se não houver conflito textual.
- **Gates depois da integração:** só o G2 roda de novo. G3 e G4 valem para o código do worktree; a regressão do G4
  na árvore combinada não roda (limitação já registrada no PLANO).
- **Ctrl-C:** providers são lançados com `detached: true` (`provider/supervisor.ts:79`) e não há tratamento de
  SIGINT no build; com N agentes sobram N processos escrevendo nos worktrees. Já existe no serial; não testado.
- **Concorrência e TUI:** `TasksAprovadas` grava em fila; o replay é por assunto (seguro com eventos intercalados);
  o sanitizador cobre CSI, OSC, C1 e bidi. O status global do run e o "chamando agora" do painel mostram só o
  último evento (cosmético).
- **Providers por agente:** o system-install de um agente só restringe o global, nunca amplia; a validação de
  provider, effort e API direta está correta.
- **Serial:** sem `parallel`, o caminho é o de antes com os helpers extraídos; não achei regressão.
