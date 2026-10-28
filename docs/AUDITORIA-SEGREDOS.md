> Registro histórico anterior à reconstrução 0.9.0_RC1. Não define comandos nem regras do motor atual. Consulte [README](../README.md) e [reconstrução](RECONSTRUCAO-0.9.0_RC1.md).

# Proteção de segredos nos commits automáticos — relatório

Data: 2026-10-15. Branch: `revisao/correcoes-paralelo-99`. Decisão registrada em `docs/PLANO.md` §100. Origem: o
risco residual do `add -A` em `guardarParcial` e `commitPhase`, apontado em `docs/AUDITORIA-PARALELO-CONCLUSAO.md`.

**Critério de aceite:** nenhum mecanismo automático de commit ou integração da Capivara pode introduzir arquivo
sensível conhecido no histórico Git, e nenhum bloqueio de segurança pode provocar perda de trabalho.

## Pontos de commit e integração

Levantados por busca em todo o `src/` (`git add`, `commit`, `commit-tree`, `cherry-pick`):

| Ponto | Arquivo | Antes | Agora |
|---|---|---|---|
| Commit da fase (serial e worktree) | `loop/git.ts` `commitPhase` | `add -A` | admissão antes do `add`; `add` só dos caminhos admitidos; índice conferido de novo; bloqueado → fase `commit-blocked` |
| Commit inicial do repositório | `loop/git.ts` `iniciarRepositorio` | `add -A` do trabalho existente | admissão; bloqueado → repositório sem o commit, preflight orienta |
| Especificação | `loop/git.ts` `commitSpecification` | só `.capivara/init` | idem, mais a admissão |
| Parcial da fase | `loop/worktree.ts` `guardarParcial` | `add -A` | commit do admitido; sensível copiado com prova para fora do Git; sem prova, o worktree fica no disco |
| Rollback da integração | `loop/worktree.ts` `desfazerSemApagar` | `add -u`, bloqueio só por nome | admissão completa (nome e conteúdo) |
| Integração | `loop/worktree.ts` `integrar`, via `loop/paralelo.ts` | nenhuma conferência | `admitirIntervalo` lê os objetos de `base..branch` antes do cherry-pick |
| Base vazia | `loop/worktree.ts` `garantirBase` | commit vazio | inalterado (não leva arquivo) |

## Análise de impacto

- **O bloqueio não podia ser "commit que falhou".** A regra existente era que commit recusado não derruba fase verde:
  o runner devolvia `complete` sem commit. No serial, a fase seguinte construiria sobre trabalho fora do histórico.
  No paralelo, seria integrar nada e apagar o worktree com o trabalho dentro. Por isso existe o desfecho
  `commit-blocked`, tratado em `build.ts` (para o build, mesmo com `--keep-going`), `paralelo.ts` (vai para o caminho
  do parcial, que preserva) e `parada.ts` (orientação segura). Os gates G0–G4 não mudaram.
- **O `.env` que o próprio harness semeia** (§46, com a marca na primeira linha) bloquearia toda fase de todo projeto
  sem `.env` no `.gitignore`, falso positivo provocado por nós. Ele não entra em commit, não bloqueia e não suja a
  árvore (`isClean`). Sem a marca, é do usuário e volta a ser sensível. Isso foi achado pelo teste antigo "banco em
  servidor", que falhou na primeira versão da política.
- **Preflight:** com árvore suja e arquivo sensível, a mensagem diz qual arquivo é antes de sugerir `git add -A`.
  Sem arquivo sensível, a mensagem é a de antes.
- **Recuperação:** a lógica de cópia com prova foi extraída para `copiarComProva`, usada pelo parcial e pelo rollback.
  `arquivoSensivel` saiu de `worktree.ts` e foi para `admissao.ts`, junto com o leitor de `git status`
  (`lerStatus`), antes duplicado.

## Testes

`packages/core/test/loop/admissao.spec.ts`, com Git de verdade, conferindo o conteúdo dos commits e dos branches
(`git log --all --name-only`, `git log --all -p`, `git ls-tree`):

| Teste | Código anterior | Agora |
|---|---|---|
| `.env` não ignorado no `commitPhase` | commitado | bloqueado; arquivo e código intactos; índice vazio; conteúdo ausente da mensagem |
| `.env` já rastreado e modificado | commitado | bloqueado; continua rastreado (` M .env`); orientação com `git rm --cached` |
| chave privada `.pem` e `.key` | commitadas | bloqueadas, sem o conteúdo na mensagem |
| chave privada em arquivo de nome comum | commitada | bloqueada pelo conteúdo |
| `.pem` sem bloco reconhecível | commitado | bloqueado como suspeito |
| legítimos: `.env.example`, certificado público `.pem` e `.crt`, código | commitados | commitados (passava antes e passa agora) |
| commit inicial com `.env` | commitado | repositório criado sem o commit; arquivo intacto |
| `.env` semeado pelo harness, serial | commitado | três fases commitadas; `.env` fora do histórico; em disco com a marca |
| `.env` não ignorado, serial | commitado | build para; P03 não roda; nada no histórico; arquivo e trabalho em disco |
| retomada no serial | — | preflight aponta o `.env` e o `.gitignore`; seguida a orientação, o build fecha pelos gates e o `.env` nunca entra |
| `.env` semeado pelo harness, paralelo | commitado | fases integradas; `.env` fora do histórico |
| `.env` não ignorado num worktree | commitado e integrado | fora de todo branch e da `main`; parcial no branch da fase; `.env` na recuperação local; P03 integrada |
| `.key` no parcial de fase que falhou | no branch da fase | parcial no branch sem a chave; chave na recuperação local |
| integração de commit do agente com `.env` | cherry-picked na `main` | recusada; nada na `main`; branch mantido com aviso |

- **Antes da correção:** 13 falharam e 1 passou (o de arquivos legítimos, que deve passar nos dois).
- **Depois:** 14 passaram.
- **Rollback (§99):** o teste do `.env` não ignorado continua passando com a política nova; o teste unitário de nome
  sensível foi movido para `admissao.ts`, e o `.pem` passou a ser julgado pelo conteúdo.
- **`npm run check` na raiz:** rc=0, 99 arquivos, **1908 testes** (1894 da branch mais 14).

## Limitações conhecidas

- Segredo arbitrário dentro de arquivo de nome comum (uma senha literal num `config.ts`) não é detectado; só chave
  privada em PEM é achada pelo conteúdo.
- Arquivos acima de 2 MiB não têm o conteúdo lido; o nome ainda vale, e o `.pem` grande é suspeito.
- Commit feito pelo próprio agente no serial vai direto para o histórico da árvore principal: não passa por
  mecanismo da Capivara. No paralelo, a integração confere e recusa.
- A política não reescreve o histórico: o segredo que já estava lá antes continua lá; a orientação manda trocar a
  credencial.

## Riscos residuais

- **`.env` do harness editado sem tirar a marca:** se alguém puser valores reais no `.env` semeado e mantiver a
  marca, ele continua fora do histórico, mas não para o build nem aparece como sujeira.
- **Commit do agente no paralelo:** quando o agente commita um segredo no worktree, o branch da fase mantém esse
  commit (apagá-lo perderia o trabalho). Ele fica só no repositório local, com aviso para não publicá-lo.
- **Worktree preservado:** quando a guarda do parcial não pode ser comprovada, o worktree fica no disco; uma nova
  execução do mesmo plano ainda remove a pasta e o branch da fase (m3 da auditoria, em aberto).
- **Cópias locais:** os sensíveis copiados ficam em `.capivara/runs/`, fora do Git, com a permissão que o `fs.cp`
  der (não é forçado `0600`).

## Revisão da autoridade Git (§101)

A revisão final apontou duas fronteiras abertas: o agente que roda git por conta própria, e a janela entre a
conferência dos arquivos e o que de fato vai para o commit.

### A janela entre admissão e staging

- **Defeito:** o §100 conferia o disco e depois rodava `git add` e `git commit`. A segunda conferência relia o
  disco, não o índice. E o `git commit` rodava os hooks do projeto: um `pre-commit` com `git add` punha no commit o
  que nenhuma conferência viu.
- **Correção:** `commitAdmitido` (`loop/admissao.ts`), usado pelos commits da fase, inicial, da especificação e do
  parcial. O rollback confere os objetos da árvore dele.
  1. índice temporário a partir do HEAD;
  2. `write-tree`, que congela a árvore;
  3. admissão sobre os objetos dessa árvore;
  4. `commit-tree` com ela, sem hooks;
  5. `update-ref` com compare-and-swap;
  6. sincronização só dos caminhos commitados no índice de quem chamou.
- **Consequência:** os commits automáticos não rodam mais os hooks `pre-commit`/`commit-msg` do projeto e não gravam
  `.git/COMMIT_EDITMSG`. Um teste do catálogo lia esse arquivo e passou a ler `git log -1`.

### O agente que roda git

Medido nesta máquina, sem chamada de modelo, com `codex sandbox -P :workspace` (codex-cli 0.162.1):

| Provider (acesso) | `git commit` | push pela rede | escrita fora do projeto |
|---|---|---|---|
| codex, workspace | recusado (`.git` somente leitura, inclusive pelo worktree) | recusado (sem rede) | recusada, exceto `/tmp` |
| qualquer um com acesso de sistema (o padrão do build) | sem restrição | sem restrição | sem restrição |
| claude, opencode, agy, cursor, custom em workspace | sem sandbox de sistema verificado sobre o `.git` | não verificado | não verificado |

Não verifiquei se `codex exec --sandbox workspace-write` aplica exatamente o mesmo perfil `:workspace`, porque isso
exigiria uma chamada de modelo.

**O que o Core impõe em qualquer provider:** detecção e contenção (`loop/autoridade.ts`).
- As refs são fotografadas antes e depois de cada chamada de agente. Ref movida faz a fase sair `commit-blocked`,
  sem nada registrado nem integrado.
- No worktree, a conferência cobre o HEAD do worktree, as tags e o rastreio remoto.
- O integrador confere se a principal está no commit que ele deixou.
- O branch de fase com commits além da base nunca é apagado numa falha. Esta foi uma perda de dados achada pelo
  teste: o agente que commitava tudo deixava o parcial vazio, e o branch era apagado.
- Nada é desfeito.
- Antes da primeira chamada, o build declara por executor o que está impedido e o que é só detectado.

**A menor mudança de arquitetura para impedir de fato** (proposta, não implementada; detalhe no §101):
1. Um modo protegido que só aceite executor em workspace num provider com sandbox comprovado sobre o `.git`, hoje só o
   codex.
2. Para os outros providers, separar o diretório Git da árvore do executor: o Core opera com `--git-dir` e
   `--work-tree` explícitos.

Sem sandbox de sistema operacional, nenhuma das duas é garantia.

### Testes

| Teste | Código anterior (`d5d20a0`) | Agora |
|---|---|---|
| `pre-commit` que prepara `.env.local` depois da conferência | `.env.local` no commit | commit só com `src/app.ts`; segredo fora do histórico |
| `pre-commit` que troca o conteúdo de arquivo já conferido | chave privada no commit | commit com o conteúdo conferido |
| `.env` deixado preparado no índice | bloqueado (§100) | bloqueado; o índice de quem preparou fica como estava |
| commit do executor na principal, serial | fase "já implementada", build seguia | build para; P02 não concluída; P03 não roda; commit do agente mantido |
| `git stash` do executor | não detectado | detectado (`refs/stash`); stash preservado |
| `push -u` do executor para um remoto | não detectado | detectado (`refs/remotes/origin/main`), dito como push provável |
| commit do agente no worktree | cherry-picked na principal | nada na principal; branch mantido; fase independente integrada |
| commit do agente na principal a partir do worktree | as fases continuavam integrando | integrador para; nada mais entra |
| sandbox real do codex (pulado sem codex) | passa (mede o provider) | passa |
| disco limpo depois do `add` de uma chave (`commitAdmitido`) | — (API nova) | bloqueado pelo objeto |
| disco alterado depois do `add` | — | publicado o conteúdo conferido |
| HEAD movido no meio do commit | — | nada publicado por cima; o commit de quem mudou fica |
| índice de quem chamou | — | só os caminhos commitados mudam |
| commit com `.env` feito fora da Capivara, conferido pelos objetos | — | bloqueado mesmo com o arquivo já fora do disco |

- **`autoridade.spec.ts` contra o `src` anterior:** 7 de 9 falharam, cada um pelo defeito do seu cenário.
- **Depois:** 9 de 9.
- **`commit-admitido.spec.ts`:** 5 de 5. Ele testa APIs novas, então não tem versão "antes".
- **`npm run check` na raiz:** rc=0, 101 arquivos, **1922 testes**.

### Riscos que ficam

- O executor com acesso de sistema, que é o padrão, pode commitar e publicar. O Core detecta e para, mas não impede
  nem desfaz.
- Push sem rastreio (`git push <url>`) não é detectável.
- Uma tag criada pelo agente de uma fase pode ser atribuída ao agente de outra fase no paralelo (as tags são
  compartilhadas). A falha é segura: a fase errada para.

## Estado do Git

Commits na branch `revisao/correcoes-paralelo-99`, publicada para a revisão final. Sem merge na `main`.
