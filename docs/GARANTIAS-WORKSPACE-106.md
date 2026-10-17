# O nível workspace do executor: o que é garantido (§106)

> **Substituído para o claude pelo §108.** O executor claude não usa mais o
> sandbox descrito aqui. Ele roda com `--dangerously-skip-permissions` e tem
> acesso amplo ao sistema, à rede e aos arquivos do usuário. O que segue vale
> como registro histórico do §106 e para os contratos dos outros providers.
>
> **Substituído para todos os executores pelo §112.** Codex
> (`--dangerously-bypass-approvals-and-sandbox`), cursor
> (`--force --approve-mcps --sandbox disabled`), agy
> (`--dangerously-skip-permissions`, sem `--sandbox`) e opencode
> (`--auto`, `OPENCODE_PERMISSION={"*":"allow"}`) rodam sem sandbox e sem aprovação, em qualquer
> nível. Nenhum é mais recusado no workspace: o preflight diz que o executor tem
> acesso amplo. Os papéis somente-leitura não mudaram.
> Os limites das flags e as evidências estão em [ADAPTADORES.md](ADAPTADORES.md#execução-sem-aprovação-112).

Esta correção resolve os problemas de `docs/DIAGNOSTICO-PERMISSOES-CLAUDE-WORKSPACE.md`
(run `build-96756ca336b0`, `teste_haiku_v2`). O Haiku não podia rodar nem
`npm --version`, a especificação não chegava ao worktree, e três ciclos foram
cobrados como código incompleto.

## A decisão

O nível `workspace` do executor deve:

- rodar os comandos de desenvolvimento;
- alcançar a internet;
- instalar dependências no projeto;
- não alterar nada fora do projeto;
- fazer tudo isso sem acesso irrestrito ao sistema e sem mexer no Git do Core.

Cada provider declara o que consegue **garantir** desse contrato. Quando ele
comprovadamente não entrega o contrato, o build recusa a configuração. Em
nenhum caso a rede é tirada ou o acesso é promovido em silêncio.

## O que mudou

| Frente | Mudança | Onde |
| --- | --- | --- |
| Claude, nível workspace | `--permission-mode acceptEdits` mais `--settings` com o sandbox nativo do Claude Code | `src/provider/cli/claude.ts` |
| Temporário | Cada chamada recebe um `TMPDIR` próprio, em `~/.cache/capivara/tmp/chamada-*`, apagado no fim | `src/commands/agent.ts` |
| Git do Core | O `.git` comum (o da árvore principal, num worktree) fica fora de escrita para os comandos | `claude.ts` e `agent.ts` |
| Especificação no worktree | `.capivara/init/` é copiada quando não está versionada, com os arquivos em 0444 | `src/loop/worktree.ts` |
| Negações de permissão | O envelope `claude-json` expõe `permission_denials` como "ferramenta: programa", sem argumentos | `src/provider/transcript.ts` |
| Parada | Executor com negações e sem COMPLETE para no ciclo, com causa de ambiente | `src/loop/runner.ts` |
| Contrato por provider | `workspace(platform)` em cada adapter; recusa e limitação no preflight serial e paralelo | `src/provider/cli/*.ts` e `src/config/execucao.ts` |
| Prompt do executor | Como rodar o comando que a sessão recusa pela forma (script em `.capivara/tmp/`) | `src/prompts/builder.ts` |
| `.capivara/.gitignore` | `tmp/` | `src/state/artifact-tree.ts` |

Os gates G0–G4 não mudaram. A parada por permissão usa o caminho que já
existia: falha no gate 0, guarda do parcial e retomada.

## A configuração do sandbox (Claude, nível workspace)

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false,
    "network": { "allowedDomains": ["*"], "allowAllUnixSockets": true },
    "filesystem": {
      "allowWrite": ["~/.npm", "~/.cache/ms-playwright"],
      "denyWrite": ["<git common dir>", "<raiz>/.capivara/init", "<raiz>/.capivara/runs"],
      "denyRead": ["/run", "/var/run", "/tmp", "~/.ssh", "~/.gnupg", "~/.codex", "~/.aws", "~/.azure",
                   "~/.config/gcloud", "~/.config/gh", "~/.docker", "~/.kube", "~/.netrc",
                   "~/.git-credentials", "~/.claude/.credentials.json", "~/.claude.json"]
    },
    "credentials": { "envVars": [{ "name": "GITHUB_TOKEN", "mode": "deny" }, "…"] }
  },
  "permissions": { "deny": ["Edit(//<raiz>/.capivara/init/**)", "Edit(//<raiz>/.capivara/runs/**)"] }
}
```

`allowAllUnixSockets` e as máscaras de `/run` e `/tmp` só entram no Linux. Fora
dele, nenhum socket é liberado.

## Evidência com o provider real

Todas as chamadas abaixo usaram Claude Code 2.1.301, `claude-haiku-5-5`, `-p`, e
pastas descartáveis em `$HOME`: nenhum projeto real foi tocado. A máquina era
DESERT 5.5.2, kernel Linux 7.0.0-38, bubblewrap 0.11.1. O custo somado das
sondas ficou abaixo de US$ 0,10.

| Sonda | Configuração | Resultado |
| --- | --- | --- |
| P1 | sandbox com `allowedDomains: ["*"]` | **Todo comando falha:** `apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted …)`. Reproduzido sem modelo: dentro de um userns do bwrap, `unshare --user` não grava `uid_map`. |
| P2 | `allowAllUnixSockets`, sem máscaras | Rede ok (curl 200). `npm` falha com `EROFS` (`~/.npm`). A escrita no `$HOME` é bloqueada. **Fuga:** os sockets do systemd, do D-Bus, do X11 e do ssh-agent conectam, e `systemd-run --user` criou um arquivo fora do sandbox. |
| P3 | + `allowWrite ~/.npm` + máscaras de sockets | `npm view`, `install`, `ci`, `test` e `build` funcionam. A escrita no `$HOME` e na árvore principal é bloqueada. O loopback funciona. Os sockets ficam inalcançáveis e o `systemd-run` falha. |
| P4 | comandos diretos do modelo | `npm --version` passa. `FOO=bar npm test`, o laço `for` e `export … &&` são **recusados mesmo no sandbox** (em `permission_denials`). Com `denyWrite` no `.git` principal, `git commit` e `git branch` falham. `CLAUDE_CODE_TMPDIR` não muda o temporário do sandbox. |
| P5 | `TMPDIR` no lançamento | O temporário do sandbox vira `$TMPDIR/claude-<uid>`, e `/tmp/claude-1000` fica somente leitura. `env FOO=bar` é recusado. |
| P6 | máscaras amplas (`/run`, `/tmp`, `~/.ssh`, `~/.codex`, `~/.gnupg`) | Os sockets do codex (IPC), do acesso remoto (teclado), do ssh-agent e do systemd ficam inalcançáveis. npm, curl e node funcionam. `enableWeakerNestedSandbox` **não** conserta o seccomp. |
| P8 | `denyRead` de arquivo e `credentials.envVars` | O arquivo de credencial vira `/dev/null`; a variável negada não chega ao comando. |
| V1, V2, V3, V5 | **a ponte de produção** (`createAgentBridge`, worktree aberto por `abrirWorktree`) | `.capivara/init` é copiada. `npm --version`, `install`, `ci`, `test` e `build` funcionam. O curl dá 200. O Playwright abre o Chromium contra `127.0.0.1`. A escrita no `$HOME`, na árvore principal e em `/tmp/claude-1000` é bloqueada. `git commit` falha (somente leitura). A especificação é protegida contra Bash ("Permissão negada") e contra Edit ("denied by your permission settings"). O token do `gh` fica ilegível, a credencial do Claude vira dispositivo e o `GH_TOKEN` não chega ao comando. O socket do systemd não existe e o `systemd-run` falha. O `TMPDIR` é `~/.cache/capivara/tmp/chamada-*/claude-1000`. Um script em `.capivara/tmp/` roda a atribuição e o laço. |

E o codex-cli 0.162.1 (`exec --sandbox workspace-write`, `effort low`):

| Sonda | Resultado |
| --- | --- |
| C1, com `network_access=true` | Rede ok. A escrita fora é bloqueada e o `git branch` falha. **O socket do systemd conecta.** |
| C2, com `writable_roots ~/.npm` | npm funciona. **Fuga:** `systemd-run --user` criou um arquivo fora do sandbox. |
| C3, sem rede (como hoje) | O socket dá `EPERM` e o `systemd-run` falha: está confinado, mas sem rede (o `EAI_AGAIN` do piloto-6). |

## O contrato por provider

| Provider | Workspace | Por quê |
| --- | --- | --- |
| claude, Linux | **garantido** (depende de `bwrap` e `socat`) | sondas P3–P8 e V1–V5 |
| claude, macOS | não verificado | o Seatbelt não foi sondado |
| claude, Windows | **insuficiente**: recusado | o sandbox não roda no Windows nativo |
| codex | **insuficiente**: recusado | rede e confinamento são mutuamente exclusivos (C1–C3) |
| opencode | **insuficiente**: recusado | não tem sandbox; bash e diretórios externos ficam liberados |
| cursor, agy, custom | não verificado: segue, com limitação declarada | as CLIs não estão nesta máquina; o custom é do operador |

Com acesso de sistema explícito (`systemInstall: true`, o padrão), o contrato
não se aplica: o operador deu a máquina ao agente.

## Testes determinísticos

`npm run check` na raiz: rc=0, 103 arquivos, 1965 testes. Contra o `src` da
`main`, 30 dos testes novos falham. Os que passam nos dois lados são, de
propósito, invariantes:

- o executor que declara conclusão segue para os gates;
- os níveis read-only e system não mudam;
- a marca de ambiente já existia em `parada.ts`.

| Requisito | Teste |
| --- | --- |
| Bash no sandbox do Claude | `adapters.spec.ts`: "o Bash roda sem aprovação, mas só dentro do sandbox…" |
| Configuração de rede | `adapters.spec.ts`: "a internet é alcançável pelo proxy do sandbox…" |
| Bloqueio fora do sandbox | `adapters.spec.ts`: `allowUnsandboxedCommands`, `failIfUnavailable`, "nunca acesso irrestrito", "a escrita fora do projeto continua negada", sockets, credenciais |
| Skeleton no worktree | `paralelo.spec.ts`: "§106: a especificação não versionada chega ao worktree…" |
| Proteção de `.capivara/init` | o mesmo teste (arquivo 0444, a escrita falha, nenhum commit a leva), mais o `denyWrite` e o `Edit` negado em `adapters.spec.ts` |
| `permission_denials` | `transcript.spec.ts` (resumo, segredo, caminho, `is_error`) e `workspace-claude.spec.ts` (pela ponte) |
| Parar sem gastar ciclos | `runner.spec.ts`: "pára no ciclo em que aconteceu…", sem correção e sem verificador |
| Preservação do parcial | `runner.spec.ts` (serial: a árvore fica) e `paralelo.spec.ts` (o parcial vai para o branch da fase) |
| Serial e paralelo | `execucao.spec.ts`: recusa e limitação no serial e no paralelo; `runner.spec.ts` e `paralelo.spec.ts` |
| Contrato por provider | `adapters.spec.ts`: "o contrato do nível workspace em cada provider" |
| TMPDIR e Git pela ponte | `workspace-claude.spec.ts` |
| Prompt | `prompts.spec.ts` |

Os testes determinísticos fixam a **configuração** que o harness gera e o
**comportamento do harness** diante das negações. O que o **sandbox** faz com
essa configuração (rodar npm, alcançar a rede, barrar escrita e sockets) só é
evidência com a CLI real, e está nas tabelas acima.

## Limitações de segurança

1. **Unix sockets, no Linux, são protegidos por lista, não por filtro.** O
   seccomp do Claude Code não roda neste kernel, e com ele ligado todo comando
   falha. Sem ele, ficam ilegíveis `/run`, `/tmp`, `~/.ssh`, `~/.gnupg` e
   `~/.codex`. Um socket criado fora desses lugares continua alcançável. Os
   sockets abstratos ficam fora de alcance pelo namespace de rede (o do X11
   deu "connection refused"). Numa máquina em que o seccomp funcione, o filtro
   continua desligado e só as máscaras protegem: é mais fraco do que o padrão
   do Claude Code ali.
2. **O código que o agente escreve roda fora de qualquer sandbox nos gates.**
   G2 (a suíte) e G4 (os roteiros) executam o código e os scripts do projeto
   como o usuário. O sandbox contém a **sessão** do executor, não o que o Core
   executa depois.
3. **A leitura continua ampla.** Ficam ilegíveis as credenciais conhecidas
   (lista acima) e as chaves de providers e do GitHub no ambiente. O resto do
   `$HOME` é legível, e a rede é aberta (`"*"`). Um segredo guardado em lugar
   desconhecido pode sair da máquina.
4. **Os caches graváveis** (`~/.npm`, `~/.cache/ms-playwright`) são
   compartilhados com o usuário. Caches de outros ecossistemas (pip, cargo,
   maven, gradle, go) não são graváveis: a instalação nessas stacks falha com
   `EROFS`, e isso **não** aparece como negação de permissão.
5. **Algumas formas de comando são recusadas mesmo no sandbox:** variável na
   frente do comando, `export … &&`, `env VAR=…` e laços com variável. O prompt
   orienta a usar um script em `.capivara/tmp/`. Se o executor não concluir, a
   parada por permissão o identifica.
6. **A detecção de negações vale só para o claude**, o único que as conta no
   envelope. Com `--keep-going`, a parada por permissão é uma falha comum: as
   fases seguintes também rodam, e cada uma para no primeiro ciclo.
7. **O sandbox deixa `.claude/.cc-writes`, uma pasta vazia, na árvore de
   trabalho.** O Git e o gate 1 a ignoram.
8. **macOS não verificado; Windows recusado.** O contrato do cursor, do agy e
   do custom também não foi verificado.
9. **Codex e opencode no nível workspace agora são recusados.** Quem os usava
   assim recebia o codex sem rede, ou o opencode sem confinamento, sem que
   ninguém dissesse. O codex tem um proxy de rede experimental
   (`[permissions.<nome>.network]`), que talvez entregue as duas metades, mas
   ele não foi validado.

## Observação fora do escopo

A especificação só entra no histórico pelo `commitSpecification`, no fim do
`init` e do `plan`, e só se o repositório já existir. Quando é o build que cria
o repositório ("chore: estado inicial", que exclui `.capivara`), o `init` nunca
é versionado. Foi o caso do `teste_haiku_v2`. A cópia para o worktree resolve o
efeito; a lacuna continua.
