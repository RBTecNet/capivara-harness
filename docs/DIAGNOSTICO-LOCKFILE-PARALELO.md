> Registro histórico anterior à reconstrução 0.9.0_RC1. Não define comandos nem regras do motor atual. Consulte [README](../README.md) e [reconstrução](RECONSTRUCAO-0.9.0_RC1.md).

# Diagnóstico — o lockfile que a integração paralela sujou

Primeiro piloto paralelo real, projeto experimental `teste_paralelismo`
(run `build-159b7675b57b`, 2 agentes codex). Investigação somente leitura: o
projeto experimental não foi modificado, o branch da P02 foi preservado, e
nenhum build ou chamada de LLM foi feito.

## O sintoma

- A P01 foi integrada no commit `17b2225`.
- A P02 passou nos gates do worktree, e a integração dela foi bloqueada:
  "a árvore principal tem alterações que não são do integrador
  (package-lock.json)".
- O diff da principal era uma linha: `"hasInstallScript": true` na entrada do
  `better-sqlite3`.
- Havia também `.capivara/.gitignore` não versionado.

## A origem

**Quem alterou foi o próprio harness, não o desenvolvedor.**

Depois do cherry-pick da P01, a integração (`paralelo.ts`, `integrarNaFila`)
viu que a fase mexeu nas dependências (`mexeuNasDependencias`) e rodou
`npm install --no-audit --no-fund` na árvore principal. O `npm install` não só
instala: ele reescreve o lockfile quando o que encontra no `node_modules`
diverge do que foi gravado. O lockfile que o executor gerou no worktree não
trazia `hasInstallScript` para o `better-sqlite3`; o `npm install` da
integração o acrescentou.

Depois disso, nem `prepararAmbiente` nem a suíte G2 conferiam se a árvore
continuava igual ao HEAD. A P01 foi anunciada como integrada com um versionado
alterado, e só 20 minutos depois a conferência do §99, na integração da P02,
o encontrou — atribuindo-o a alguém de fora.

## As evidências

| Evidência | Valor |
| --- | --- |
| Verde da P01 no worktree (`events.tsv`) | 23:42:05.970Z |
| mtime do `package-lock.json` da principal | 23:42:10.688Z |
| Evento "integrada" da P01 (`events.tsv`) | 23:42:10.845Z |

A escrita aconteceu dentro da janela de integração, quando só o integrador
mexe na árvore principal.

- Reprodução fora do projeto, numa pasta do scratchpad com o `package.json`
  e o `package-lock.json` de `17b2225` (npm 11.12.1, Node 25.9.0):
  `npm install` acrescenta exatamente `"hasInstallScript": true` no
  `better-sqlite3`; `npm ci` deixa o lockfile idêntico, byte a byte.
- O lockfile do branch da P02 (`13ce4e3`) também não tem a linha: o executor
  gera o lockfile assim, de forma consistente.
- Nos logs do agente, os comandos do executor no worktree são `npm install
  --save-exact …` seguidos de `npm ci` — nenhum rodou na árvore principal.

## Harness ou desenvolvedor

| Alteração | Autor | Papel na parada |
| --- | --- | --- |
| `package-lock.json` (`hasInstallScript`) | harness — `npm install` da integração | causou a parada |
| `.capivara/.gitignore` não versionado | harness — `ensureArtifactTree`, no `init` | nenhum: o status da principal exclui `.capivara` |

Nada indica alteração do desenvolvedor.

## A correção (§102 do `PLANO.md`)

Aplicada no branch `correcao/lockfile-integracao-102`.

1. **Com lockfile, `npm ci`** (`comandoDeInstalacao`, em `worktree.ts`): instala
   o que o lockfile diz e nunca escreve nele. Se o lockfile não fechar com o
   `package.json`, falha, e a integração reprova pelo caminho que já existia.
   Sem lockfile, `npm install --no-package-lock`, para não criar um arquivo que
   a fase não trouxe.
2. **Conferência depois da suíte verde** (`alteradosNaPrincipal`, em
   `paralelo.ts`): se um versionado sobrar alterado, a parada é imediata. A
   fase fica integrada, porque os commits passaram na suíte; nada é desfeito
   nem descartado; nenhuma fase nova é lançada; e a mensagem diz que a
   alteração é do harness, com o comando para descartar ou commitar.

As proteções dos §§99–101 não mudam: a conferência antes do cherry-pick, a
política de admissão, o desfazer com guarda comprovada e a guarda do HEAD.

## Os testes

- `test/loop/paralelo.spec.ts`, dois testes "§102", com um npm falso que faz o
  que o npm 11 fez de verdade (`install` reescreve o lockfile, `ci` não).
- Com a correção, os dois passam. Com o `src` anterior, os dois falham, e o
  segundo reproduz literalmente a mensagem do piloto ("a árvore principal tem
  alterações que não são do integrador").
- `npm run check` na raiz: rc=0, 101 arquivos, 1924 testes.

## Para retomar o piloto

O lockfile alterado na principal precisa ser descartado antes de retomar
(`git checkout -- package-lock.json` no projeto experimental). O branch
`capivara/build-159b7675b57b/P02` está intacto.

## O que segue aberto

- m1: na parada, `registrarEstado` pode atribuir a falha à fase pendente
  errada.
- M4, m2, m3 e os órfãos depois do Ctrl-C, da auditoria do paralelo.
