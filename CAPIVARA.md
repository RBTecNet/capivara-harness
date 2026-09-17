# Capivara

Ferramenta de terminal que transforma um prompt livre em documentação `RALPH READY`
(`capivara init`) e, num segundo comando, constrói a aplicação a partir dela
(`capivara build`).

## Especificação

**`docs/PLANO.md` é a autoridade deste repositório.** Leia antes de escrever qualquer código.
Ele define o contrato, os quatro documentos, os motores de entrevista e auditoria, os quatro
gates do loop, os prompts literais de cada papel (Apêndice A) e o provider falso (Apêndice B).

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
3. **Nunca traduzir chave de protocolo ou rótulo estrutural** — `CAPIVARA_AUDIT_STATUS`, `TASK <n>: DONE`, `## Phase`, `**Acceptance criteria:**`, `**Traces:**` e companhia são casados literalmente pelo parser.
4. **Todo campo novo no contrato precisa responder:** *"qual decisão do loop quebra sem ele?"*. Se a resposta for "nenhuma", o campo não existe. Superfície de contrato é superfície de falha.
5. **`.capivara/init/` é leitura para o executor; `.capivara/runs/` é plano de controle.** Escrever no segundo invalida a tentativa.

## Estado atual

**Phase 1 concluída.** O contrato `capivara-phases/v1` existe como código executável em
`packages/core/src/contract/`, com os 14 invariantes, as três coberturas, o stamp de
frescor e os testes de arquitetura que protegem a proibição nº 1. `npm run check` passa:
build, typecheck e 58 testes.

`docs/capivara-phases-v1.md` é **gerado** por `npm run docs:contract` a partir do módulo —
não edite à mão; um teste falha se a página divergir do código.

Próxima: **Phase 2** do §17 do plano — estado durável, lock e retomada.
