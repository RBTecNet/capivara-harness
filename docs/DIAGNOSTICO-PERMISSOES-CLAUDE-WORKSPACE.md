# Diagnóstico: o executor Claude que não pôde rodar `npm`

Projeto experimental `teste_haiku_v2`, run `build-96756ca336b0`. O build é
paralelo, com três agentes `claude` / `haiku` / `high`, todos com
`systemInstall: false` em `.capivara/execucao.json`. O verificador é o codex.

A investigação foi somente leitura:

- o projeto experimental não foi modificado;
- nenhuma permissão global foi alterada;
- não houve build nem chamada de LLM.

Uma sonda local do sandbox do codex não chegou a rodar, porque exige um perfil
de permissão. Ela não alterou nada.

## O sintoma

- A P01 parou no G3 depois de três ciclos, com 13 de 14 tasks DONE. A única
  pendência era `package-lock.json`.
- O Haiku relatou "requires approval" em `npm --version`, em
  `npm config get registry` e em todo `npm` que tentou.
- Ele relatou também que `.capivara/init/skeleton.md`, `CAPIVARA.md` e
  `AGENTS.md` não existiam no worktree.

Como §105 já está ativo, o executor trabalhou no worktree
(`~/.cache/capivara/worktrees/beaf0f189052/build-96756ca336b0/P01`). A árvore
principal ficou limpa, e o parcial foi para o branch
`capivara/build-96756ca336b0/P01`, no commit `6ccd6a8`, com 36 arquivos e
nenhum sob `.capivara`.

## Resumo

| Classe | Problema | Defeito do harness? |
| --- | --- | --- |
| **Permissão** | O nível `workspace` do adapter claude é `--permission-mode acceptEdits`, que só libera edição de arquivos. Em `-p`, o Bash que não é somente leitura fica pendente de aprovação, e aprovação pendente vira negação. | **Sim. É a causa.** |
| **Configuração** | O contrato do nível `workspace` promete o que as CLIs não entregam. O prompt diz "You may install dependencies" em qualquer nível. O claude não roda o comando, e o codex roda sem rede. O preflight descreve a restrição como "sem instalar no sistema". | **Sim** |
| **Contexto** | `.capivara/init/` não vai para o worktree quando não está versionada. `CAPIVARA.md` e `AGENTS.md` simplesmente não existem no projeto. | **Sim**, para `init/`. **Não**, para os outros dois. |
| **Detecção** | O envelope do claude traz `permission_denials` (17, 11 e 8 nos três ciclos), e nada no `src` lê esse campo. Os três ciclos foram cobrados como código incompleto. | **Sim** |
| **Modelo** | Não há evidência de incapacidade do Haiku. As negações são da CLI, ele não forjou o lockfile nem contornou a restrição, e aplicou as correções possíveis por leitura. | **Não** |

## 1. Permissões: por que os comandos foram recusados

O mapeamento está em `src/provider/cli/claude.ts:34`:

```
read-only → --permission-mode default
system    → --permission-mode bypassPermissions
workspace → --permission-mode acceptEdits
```

O `acceptEdits` aprova edições de arquivo. Para o Bash, só passam os comandos
que o Claude Code classifica como somente leitura. O resto pede aprovação, e
numa chamada `-p` não existe quem aprove.

As permissões chegam ao Claude CLI só por essa flag. O adapter não passa
`--allowedTools`, `--settings` nem `--add-dir`. Nenhum arquivo de settings
amplia ou restringe o que ele pode fazer:

- o projeto não tem `.claude/`;
- não existem `~/.claude/settings.local.json` nem
  `/etc/claude-code/managed-settings.json`;
- o `~/.claude/settings.json` do usuário não tem bloco `permissions`.

O que decidiu as negações foi, portanto, só o modo `acceptEdits`.

O nível veio da configuração do operador: `systemInstall: false` nos três
agentes. Com isso, `commands/execucao.ts:103` dá `systemInstall` falso,
`buildInvocation` escolhe o acesso `workspace` e o adapter monta `acceptEdits`.

### As evidências

**O modo efetivo.** As três sessões do executor estão em
`~/.claude/projects/-home-bruno--cache-capivara-worktrees-beaf0f189052-build-96756ca336b0-P01/`
(`c20a17d2…`, `dc8fa021…` e `bbe9e5d4…`). Todas registram
`"permissionMode":"acceptEdits"`, com cwd no worktree.

**A comparação com o run anterior.** No `teste_paralelismo`
(`build-f1cd4ae9e525`, sem `execucao.json`, com `systemInstall` padrão
ligado), as sessões do mesmo Haiku registram
`"permissionMode":"bypassPermissions"`. Lá ele rodou `npm install`,
`vitest` e Playwright sem obstáculo. O modelo, o projeto e a fase eram os
mesmos; o que mudou foi só o nível de acesso.

**O que passou e o que foi negado** (resultados das ferramentas nas sessões):

| Passou | Negado ("requires approval" ou equivalente) |
| --- | --- |
| `node --version`, `ls`, `cat`, `grep`, `find .`, `git status`, `rm -rf .testes/verif` | `npm -v`, `npm view …`, `npm config get registry`, `npm install --package-lock-only` |
| | `node src/servidor/migrar.ts`, `node .testes/verif/banco-check.mjs` |
| | `for f in …; do …` ("A variable in this command can't be checked before it runs") |
| | `ls /usr/lib/node_modules`, `find ~/.cache/capivara` ("may only list files in the allowed working directories") |
| | `Write /tmp/capivara-verif/…` ("you haven't granted it yet") |

**A contagem no envelope.** Os envelopes em `logs/agente-1.out.log` trazem
`permission_denials` com 17 itens no ciclo 1, 11 no ciclo 2 e 8 no ciclo 3,
todos `Bash`.

### O mesmo defeito já tinha aparecido no cursor

`src/provider/cli/cursor.ts` documenta o caso do `MCP_teste2`: o executor
escrevia arquivos mas não executava comandos, porque "aprovação pendente vira
negação". A correção foi `--force`. O adapter claude nunca recebeu o
equivalente para o nível `workspace`.

## 2. Configuração: o que o nível `workspace` promete e o que cada CLI entrega

O papel do executor declara o seguinte em `src/provider/roles.ts`:

```
description: "implementa a fase: escreve arquivos, instala dependências e roda a suíte"
network: true
```

O campo `network` não é lido em nenhum lugar do `src`.

O prompt do executor (`prompts/P01.cycle-1.txt`, seção "Dependencies and
network") diz "You may install dependencies and download scaffolding" seja
qual for o nível. O preflight resume a restrição como "sem instalar no
sistema", como se só a instalação de pacotes de sistema ficasse de fora.

Para o nível `workspace`, cada CLI entrega o seguinte:

| CLI | Mapeamento em `workspace` | Roda comandos? | Tem rede? | Evidência |
| --- | --- | --- | --- | --- |
| claude | `acceptEdits` | **Não**, só os de leitura | não chega a tentar | este run |
| codex | `--sandbox workspace-write` | Sim | **Não** | sessão `~/.codex/sessions/2026/09/19/rollout-…-01a0ba44…` (piloto-6, executor da capivara): `"sandbox_policy":{"type":"workspace-write","network_access":false}` e `npm install` com `EAI_AGAIN` contra registry.npmjs.org |
| cursor | `--force` | Sim (corrigido no `MCP_teste2`) | não verificado | comentário do adapter |
| opencode | `OPENCODE_PERMISSION` com `bash: allow` | Sim | sem sandbox próprio | `adapters.spec.ts` |
| agy | `--dangerously-skip-permissions --sandbox` | Sim | não verificado | comentário do adapter |

Então o problema não é só do Claude. No codex, o mesmo nível também não
instala dependências. A diferença é o sintoma: no Claude o comando é negado,
no codex a rede falha.

## 3. Contexto: o que o agente recebeu

O prompt manda ler, nesta ordem, "CAPIVARA.md or AGENTS.md", depois
`.capivara/init/skeleton.md`, e cada um só "if it exists".

- **`CAPIVARA.md` e `AGENTS.md` não existem no projeto**, nem na principal nem
  no HEAD. Não é defeito: o prompt já diz "the ones that exist".
- **`.capivara/init/skeleton.md` existe na principal, mas não está
  versionado.** O `git status` mostra `?? .capivara/init/skeleton.md` e
  `?? .capivara/init/project-phases.md`, e o commit inicial `db3b871` só tem
  `docs/`. O worktree nasce do HEAD, e `abrirWorktree` (`loop/worktree.ts`)
  copia só `.capivara/skills`, `.capivara/flows`, `.capivara/.gitignore`,
  `.env` e `node_modules`. A especificação do projeto fica de fora, e isso vale
  para o executor e também para o verificador. No serial isso não acontece,
  porque a árvore é a principal.
- **Copiar `init/` para o worktree é seguro para o histórico.** O commit da
  fase usa `lerStatus` com `":(exclude).capivara"` (`loop/admissao.ts:151`).
  A prova é o wip `6ccd6a8`: o `.capivara/.gitignore` copiado não entrou nele.

O Haiku compensou com `docs/prd.md`, `docs/contratos-api.md` e
`docs/verificacao.md`, que estão versionados. Por isso o impacto da falta de
contexto neste run foi pequeno. Mas o defeito existe, e numa fase que dependa
do esqueleto ele pesaria mais.

## 4. Detecção: três ciclos cobrados pela permissão

- O envelope traz `permission_denials` e nada no `src` o lê. Uma busca por
  `permission_denials` e `permissionDenials` não encontra nada.
- O executor declarou, nos três ciclos, que não podia rodar `npm`, e não
  emitiu `CAPIVARA_BUILDER_STATUS: COMPLETE`.
- O runner tratou cada ciclo como trabalho incompleto e mandou corrigir de
  novo.
- O custo do executor foi de US$ 0,78, 0,11 e 0,04, e 17 minutos de parede, num
  problema que nenhum ciclo de correção poderia resolver.

## 5. Por que não é capacidade do Haiku

- Os mesmos comandos, com o mesmo modelo, passaram no run anterior, com
  `bypassPermissions`.
- As mensagens de negação são da CLI ("This command requires approval"), não do
  modelo.
- O Haiku recusou-se a forjar um lockfile ("os hashes de integridade não podem
  ser inventados"), não contornou a restrição e pediu o passo exato que
  faltava (`npm install --package-lock-only`).
- O verificador confirmou 13 das 14 tasks por leitura, e a única pendência é
  justamente o lockfile.

Ainda não se sabe se o código do Haiku passa na suíte. Isso só aparece quando
ele puder rodá-la.

## A menor correção segura (proposta, não implementada)

Em ordem de segurança. As duas primeiras são verificáveis em código e
independem de qualquer decisão de política.

### 1. Contexto: `abrirWorktree` copia `.capivara/init/` quando não está versionada

A regra é a mesma do `.gitignore` e do `.env`: a pasta só é copiada se existir
e não estiver rastreada. Como especificação somente leitura, ela já está
excluída do commit da fase.

### 2. Detecção: negações do executor param a fase como problema de configuração

- O leitor `claude-json` passa a expor `permission_denials`: a quantidade e os
  comandos, nunca o conteúdo dos arquivos.
- Se o executor teve negações e não declarou COMPLETE, a fase para no
  primeiro ciclo com uma causa própria, como já acontece com
  `credential-rejected`. A mensagem diz que o executor teve N comandos negados
  (por exemplo `npm --version` e `npm view`) e que o nível de acesso do agente
  não permite executar comandos.
- Nada é descartado. O parcial segue o caminho atual e vai para o branch.

### 3. Permissão: o nível `workspace` do claude ganha o sandbox nativo do Claude Code

A proposta mantém `--permission-mode acceptEdits` e acrescenta
`--settings` com:

```json
{ "sandbox": { "enabled": true, "autoAllowBashIfSandboxed": true, "allowUnsandboxedCommands": false } }
```

Assim o Bash passa a rodar sem aprovação, só que dentro do sandbox do sistema
operacional (bubblewrap), com escrita limitada ao diretório de trabalho. É o
equivalente do `workspace-write` do codex. Não é acesso irrestrito: nem
`bypassPermissions`, nem `--allowedTools Bash`.

- As chaves existem no binário 2.1.301 instalado. `bwrap` e `socat` estão em
  `/usr/bin`.
- **Falta validar:** o comportamento real só se comprova com uma chamada de
  modelo, que esta investigação não fez. A proposta precisa de um piloto
  curto.
- O `doctor` deve acusar a falta de `bwrap` quando um agente claude estiver em
  `workspace`.

As alternativas foram descartadas pelos seguintes motivos:

- **`--allowedTools Bash`:** é shell irrestrito sem sandbox, equivalente a
  `system`.
- **`Bash(npm:*)`:** `npm run` executa qualquer script, e a lista amarraria o
  harness a uma stack.

### 4. Configuração: decisão de política, que cabe ao Bruno

O que o nível `workspace` deve permitir em rede?

- **Sem rede**, em paridade com o codex. Nesse caso o prompt deixa de
  prometer instalação quando o acesso não é `system`. O preflight diz, por
  provider, o que o agente pode fazer ("roda comandos no worktree, sem rede").
  E uma fase que precise gerar lockfile ou baixar dependências deve ser
  recusada antes de gastar ciclos.
- **Com rede limitada a registries**, via `sandbox.network.allowedDomains` no
  claude e `sandbox_workspace_write.network_access` no codex. A lista de
  domínios depende da stack, e isso precisa ser declarado no projeto, não
  embutido no harness.

## Testes de regressão recomendados (antes da correção)

1. **`test/loop/worktree.spec.ts`**
   - `.capivara/init/skeleton.md` não versionado na principal aparece no
     worktree.
   - Quando `init/` está versionada, nada é copiado nem sobrescrito.
   - O commit da fase (`guardarParcial` e `commitPhase`) não inclui
     `.capivara/init`.
2. **`test/provider/transcript.spec.ts`:** o envelope `claude-json` com
   `permission_denials` de dois `Bash` expõe a quantidade e os comandos. Com a
   lista vazia, não expõe nada.
3. **`test/loop/runner.spec.ts`** (ou o catálogo)
   - Um executor que volta com negações e sem COMPLETE para a fase no ciclo 1,
     com a causa de permissão, sem ciclo de correção, e o parcial vai para o
     branch.
   - Com negações mas com COMPLETE, o caminho atual se mantém e os gates
     decidem.
4. **`test/provider/adapters.spec.ts`**
   - O claude em `workspace` recebe `--settings` com `sandbox.enabled` e
     `autoAllowBashIfSandboxed`.
   - Em nenhum nível que não seja `system` ele recebe `bypassPermissions` ou
     `--allowedTools Bash`.
   - `system` e `read-only` não mudam.
5. **Prompt:** a seção "Dependencies and network" do executor depende do
   acesso, e sem rede não promete instalar dependências. Este teste só entra
   depois da decisão do item 4.

## Estado do projeto experimental (nada foi alterado)

- A principal `teste_haiku_v2` está em `db3b871`. Os não versionados são só
  `.capivara/.gitignore`, `.capivara/execucao.json` e `.capivara/init/*`.
- O branch `capivara/build-96756ca336b0/P01` (`6ccd6a8`) guarda o parcial da
  P01.
- O worktree da P01 foi removido; a pasta do run no cache ficou vazia.
