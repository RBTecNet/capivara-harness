# Capivara

Ferramenta de terminal que vai do prompt livre à aplicação em três estágios:
`capivara init` desenha as fases do projeto até `PLAN READY`, `capivara plan` as
detalha até `RALPH READY`, e `capivara build` constrói a aplicação a partir do plano.

## Especificação

**`docs/PLANO.md` é a autoridade deste repositório.** Leia antes de escrever qualquer código.
Ele define o contrato, os motores de entrevista e auditoria, os cinco gates do loop, os
prompts literais de cada papel (Apêndice A) e o provider falso (Apêndice B).

**§26 é o ciclo que roda hoje.** As seções 6 a 9 descrevem a cadeia de quatro documentos em
prosa, que foi medida, reprovada e removida do produto; elas ficam como registro. Antes de
implementar qualquer coisa sobre documentação, leia §26 primeiro.

Uma mudança de comportamento começa no plano, não no código.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run build` | Gera `packages/core/dist/cli.js` e os `.d.ts` |
| `npm run typecheck` | `tsc --noEmit` sobre `src/` e `test/` |
| `npm test` | Suíte com vitest |
| `npm run check` | build + typecheck + test — o portão antes de qualquer commit |
| `npm run install:user` | Instala o binário `capivara` em `~/.local` |

## Runtime

| | Versão |
|---|---|
| Publicado (`engines.node`) | `>=22` — o binário só carrega `commander` |
| **Desenvolvimento** | **Node 26.9.0** (atual nesta máquina, via `nvm alias default 26`) |

O vitest 5 aceita `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` e **exclui as linhas ímpares**. Não
desenvolva este projeto em Node 25 ou qualquer outra ímpar. A alternativa conservadora é a
Latest LTS v24.21.0, que também satisfaz a faixa.

`npm install` emite `npm warn install-scripts` para o postinstall do esbuild. É esperado e
inofensivo: o binário vem de `@esbuild/linux-x64` e o postinstall é só validação. Não aprove
o script nem rebaixe o npm por causa disso.

## Convenções

- TypeScript ESM estrito, `module: NodeNext`. Imports relativos terminam em `.js`.
- `commander` é a **única** dependência de runtime. Todo o resto é `devDependency`.
- esbuild faz o bundle; o `tsc` só faz typecheck e emite `.d.ts`.
- Prosa e mensagens no idioma do usuário; chaves de máquina sempre em inglês.

## Proibições

Estas não são preferências. São o que mantém o produto coerente:

1. **Nenhuma regex de fase fora de `packages/core/src/contract/`.** O loop não tem parser próprio: ele importa o mesmo módulo que o `init` usa para validar. É a tese do projeto e existe um teste de arquitetura que falha se for violada.
2. **Nenhuma segunda dependência de runtime** sem mudar o plano antes.
3. **Nunca traduzir chave de protocolo ou rótulo estrutural** — `CAPIVARA_AUDIT_STATUS`, `TASK <n>: DONE`, `## Phase`, `**Acceptance criteria:**`, `**Traces:**` e companhia são casados literalmente pelo parser. `**Feature tests:**` não é mais rótulo: o plano descreve comportamento, não testes (§116), e o parser recusa o rótulo antigo com I-15. Pelo mesmo motivo o plano não nomeia ferramenta, arquivo nem diretório de teste (I-16, §118): a estratégia de validação é do build, e só o pedido ou uma decisão da entrevista autorizam citar uma ferramenta. Nem aloca trabalho de teste sem citar ferramenta — "entregar a suíte", "cobrir os cenários", "task de testes", tipo e organização de teste (§122): o pedido que exige testes autoriza o requisito como critério, não a task. E o esqueleto não fixa mecanismo de implementação (I-17, §123): caminho de arquivo, variável de ambiente, comando e código ficam para o arquiteto do `plan`, a menos que o pedido ou uma decisão os nomeie; rotas HTTP são contrato de interface e ficam. E fases sem dependência entre si não recebem obrigação de escrita no mesmo arquivo (I-18, §124): a frase da task que ordena criar, acrescentar, registrar ou alterar um caminho é escrita; critério que verifica o estado do arquivo não é; a ordem entre fases é da arquitetura, e o build executa ao mesmo tempo o que não tem ordem.
4. **Todo campo novo no contrato precisa responder:** *"qual decisão do loop quebra sem ele?"*. Se a resposta for "nenhuma", o campo não existe. Superfície de contrato é superfície de falha.
5. **`.capivara/init/` é leitura para o executor; `.capivara/runs/` é plano de controle.** Escrever no segundo invalida a tentativa.
6. **O que é verificável em código é verificado em código.** Instruir o modelo é a última defesa, nunca a única: nove dos quinze defeitos do piloto 1 voltaram porque eu tentei resolvê-los por persuasão.
7. **Nenhum reparo sem análise de impacto.** Lei do projeto, escrita abaixo em seção própria. Um conserto que resolve o sintoma e quebra o que estava ligado nele é pior que o defeito, porque o defeito era conhecido.

## Acesso de sistema

O papel `builder` roda com **acesso de sistema por padrão**: ele pode instalar
pacotes com `sudo` nesta máquina, não só dependências do projeto. É a permissão
mais perigosa do produto e vale para todo projeto, não só para um. O `build`
anuncia isso em toda execução; `--no-system-install` mantém o executor dentro do
workspace. Nenhum papel de leitura recebe essa permissão, e um teste garante.

## Estado atual

O ciclo de três estágios — `init` → `plan` → `build` — funciona de ponta a ponta
com modelo real, em cinco CLIs (`codex`, `claude`, `opencode`, `agy`, `cursor`).
Na versão 0.6.2, `npm run check` passa: build, typecheck e **2725 testes**, incluindo o catálogo de
cenários do Apêndice B rodando a cadeia inteira contra o provider falso.

A 0.6.0 é a reformulação do `init` e do `plan` (§116): o `plan` decide a
arquitetura e a infraestrutura antes de escrever fases (`architecture.md`,
`capivara-architecture/v1`), pode reorganizar a divisão do `init` sem perder
cobertura, e o plano deixou de prescrever testes (`capivara-phases/v2`).
Planos, caches e aprovações da geração anterior (`capivara-planning/v2`) não
são lidos nem convertidos. A reformulação ainda não foi exercitada com modelo
real; as provas são o provider falso e o catálogo.

Os pilotos com modelo real foram executados e medidos: `docs/medicoes/referencia.md`.

`docs/capivara-phases-v2.md` é **gerado** por `npm run docs:contract` a partir do
módulo — não edite à mão; um teste falha se a página divergir do código.

O gate 4 — o que abre a aplicação e percorre os fluxos declarados — existe desde
o §33. Era o buraco que fez um build fechar com todas as fases verdes e metade
dos cadastros sem funcionar.

**O que falta está em `docs/HANDOFF.md`**, em ordem de importância.

## A correção que fica pela metade

Uma verificação existe no lugar certo e não existe no lugar irmão. É a forma de
defeito mais comum deste repositório, e a tabela só cresce:

| corrigido em | faltava em | custo de descobrir |
|---|---|---|
| fila de linhas no wizard | `init`, `plan`, `build` | um run morto na pergunta 1 de 6 |
| cobertura no laço da auditoria do plano | laço de escrita do esqueleto | um run terminando em NOT READY |
| commit da especificação no `init` | `plan`, que publica o plano executável | o artefato que o loop consome ficava fora do histórico |
| `Phase N` e `Fase N` nas emendas | o endereço `P2.T2.C1`, no mesmo campo | a emenda do `cron5` foi para a fase 1 com o defeito na 2 |
| o fim de texto sem `\Z` em `prerequisites.ts` | `acceptance.ts`, na leitura do `pyproject` | a aceitação de um projeto Python aprovava sem executar o produto |
| `resolveTest` redetectando depois da sessão | quase aconteceu com o comando de subida do gate 4 | pego pelo cenário do catálogo, antes de sair |

Em todos os casos o comentário que explicava a lição já estava escrito no código —
ao lado da metade que fora corrigida.

**O critério:** quando um defeito for de categoria — "isto é verificável em código
e só era visto tarde demais", "esta entrada pode acabar", "este estágio também
publica" — a pergunta seguinte não é se o conserto funcionou. É **onde mais isto
acontece**, respondida com uma busca, antes de dar o assunto por encerrado.

Vale também para o inverso: ao escrever uma verificação nova, procurar o estágio
irmão que precisa dela.

## A análise de impacto, antes do reparo

**Lei do projeto, decidida em 25/09/2026 depois de dois reparos meus quebrarem o
que estava ligado neles.** Antes de qualquer alteração, analisar o impacto dela no
ecossistema inteiro. Um remendo que parece resolver a situação e quebra o que
estava atrelado é pior que o defeito original, porque o defeito original era
conhecido.

Isto NÃO é a mesma coisa que a seção acima. Ali a pergunta é *"onde mais este
defeito acontece?"* — a propagação de uma lição. Aqui é *"o que mais depende do
que eu estou mudando?"* — o raio de alcance de uma mudança. Os dois casos que
fizeram a lei nascer passariam pela primeira pergunta e falharam na segunda.

**O método, e ele é de busca, não de intuição:**

1. **Quem LÊ o que eu estou mudando?** Não a função — o DADO, a FORMA do dado, o
   invariante. `grep` pelo campo, pelo tipo, pela chave do cache.
2. **O que a forma antiga garantia que a nova não garante?** Um endereço que sempre
   vinha preenchido, uma lista que nunca vinha vazia, um sha que só mudava quando o
   conteúdo mudava.
3. **Qual memória, cache ou chave depende disso?** Este harness tem cinco memórias
   — fases escritas, fases aprovadas, tasks julgadas, tasks verificadas, decisões —
   e todas são chaveadas por sha de algo. Mudar o que entra no sha invalida a
   memória inteira, e invalidar em silêncio é o defeito mais caro daqui.
4. **O teste que falha com a mudança desligada.** Se eu não consigo escrevê-lo, eu
   não entendi a mudança, e ela não vai.

**Os dois casos, para não se repetirem:**

| a mudança | o que eu não olhei | o que quebrou |
|---|---|---|
| ligar a auditoria por fase (§76) | a FORMA do achado: a chamada por fase já sabe a fase, então o auditor para de escrevê-la — e `affectedPhases` decide a emenda lendo a prosa do achado | 24 de 25 defeitos não chegavam a ninguém e voltavam para sempre; a fase aprovada que um achado nomeava era reescrita e perdia a aprovação |
| arbitrar antes do impasse em prosa (§77.4) | o valor de retorno do levantamento: ele devolve os achados INTACTOS quando não há nada a arbitrar | "nada a arbitrar" virou "tudo arbitrado", e o laço reescrevia e reauditava para sempre |

O primeiro custou um run de duas horas do desenvolvedor e uma tela de auditoria
reprovando o que ela mesma havia aprovado. O segundo foi pego pelos testes na
primeira execução, o que é a diferença entre os dois e o que a regra 4 existe para
garantir.
