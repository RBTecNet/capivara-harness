> Registro histórico anterior à reconstrução 0.9.0_RC1. Não define comandos nem regras do motor atual. Consulte [README](../README.md) e [reconstrução](RECONSTRUCAO-0.9.0_RC1.md).

# Como acrescentar uma CLI

Cada CLI que a capivara sabe chamar vive num arquivo próprio em
`packages/core/src/provider/cli/`. Acrescentar outra — `agy`, `cursor`, o que
vier — é escrever um arquivo desses e citá-lo numa lista. Não há `if` de provider
espalhado pelo código: quem decide como a CLI é chamada é o adaptador dela.

## Os quatro passos

**1. Descubra o formato de saída chamando a CLI de verdade.**

Não escreva o formato de memória: formato suposto é exatamente onde um adaptador
quebra em silêncio. Os adaptadores `claude` e `opencode` passaram semanas
declarando `--output-format json` sem que ninguém lesse esse JSON, e o documento
publicado teria sido o envelope inteiro da sessão.

```sh
echo "responda apenas: PONG" | agy run --format json
```

Guarde a saída: ela vira a amostra do teste.

**2. Escreva o adaptador.**

```ts
// packages/core/src/provider/cli/agy.ts
import type { CliAdapter } from "./types.js";

export const agyAdapter = {
  id: "agy",
  label: "Antigravity CLI",
  binaryEnv: "CAPIVARA_AGY_BIN",
  defaultBinary: "agy",
  transcript: "agy-jsonl",          // omita se a CLI escreve texto puro
  build: ({ projectRoot, model, effort, access }) => {
    const args = ["run", "--dir", projectRoot];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    if (access === "read-only") args.push("--no-write");
    return { args };
  },
} as const satisfies CliAdapter;
```

`access` chega em três níveis e todos precisam de resposta:

| nível | quem usa | o que a CLI pode fazer |
|---|---|---|
| `read-only` | auditor, verificador | ler e rodar comando que não altera nada |
| `workspace` | executor e sessão explícita de reparo do verificador | escrever dentro do projeto |
| `system` | executor ou reparador, quando a política de instalação permite | instalar pacote de sistema |

A avaliação normal do verificador continua em `read-only`. Somente a chamada
com `verifierRepair: true` recebe escrita; `CAPIVARA_ROLE` permanece `verifier`,
`CAPIVARA_REPAIR` vale `1` e o modelo configurado para esse papel é preservado.
Na avaliação seguinte, as permissões voltam a somente leitura. API direta não
recebe essa elevação, pois não há ferramentas para executar o reparo.

Um adaptador que ignora `read-only` entrega permissão de escrita a quem só
deveria julgar. O teste de arquitetura exige que todo adaptador monte uma chamada
para os três níveis, mas não consegue conferir se a permissão foi respeitada —
essa parte é sua.

**3. Se a saída tiver envelope, escreva o leitor.**

Em `packages/core/src/provider/transcript.ts`, acrescente o tipo ao
`TranscriptKind`, escreva a função e ligue-a no `readTranscript`. O leitor devolve
o texto final, os tokens quando existirem, e — regra que não se quebra — a saída
crua quando não encontrar mensagem nenhuma. Engolir a saída de um erro é trocar
um diagnóstico por um vazio.

**4. Cite o adaptador na lista.**

```ts
// packages/core/src/provider/cli/index.ts
export const CLI_ADAPTERS = [codexAdapter, claudeAdapter, opencodeAdapter, agyAdapter, customAdapter] as const;
```

É só isso. `capivara doctor`, o wizard, `capivara providers list`, a validação de
flags e as mensagens de erro leem todos dessa lista.

## OpenCode 2

O adaptador usa o contrato de `opencode run --help` da versão 2.0.32.
Essa versão removeu `--dir` e `--variant`: enviar qualquer uma delas encerra
a CLI com código 1 e imprime a ajuda antes de chamar o modelo. O diretório
vem do `cwd` já definido pela ponte, e a intensidade é enviada no formato
`--model provider/model#variant`. Intensidade sem modelo explícito recebe
um diagnóstico antes de abrir o processo.

Cada chamada usa `--standalone`, que cria um servidor privado, para receber
o ambiente e as permissões daquela sessão. O prompt continua no stdin e a
saída continua sendo JSONL; uma chamada real com a versão 2.0.32 confirmou
a resposta de texto em `part.text`.

**Permissão efetiva na versão 2.** `OPENCODE_PERMISSION` sozinho é ignorado.
O adaptador grava `permission` em `OPENCODE_CONFIG_CONTENT`, preservando as
demais opções (inclusive modelos e seus limites). Mantém a variável antiga
somente para compatibilidade. Leitores negam por padrão e liberam `read`,
`glob`, `grep` e `list`; shell, escrita e MCP arbitrário ficam negados.
Executor e reparo explícito recebem `permission: {"*":"allow"}` na configuração
efetiva. Conferência local por `api --standalone config.get`, sem inferência.
Autoria e triagem do G4 mantêm os limites gerais configurados. Sua finalidade
identifica a sessão no painel e na evidência, sem impor um corte especial.

**O diretório inclui `PWD`.** A 2.0.32 faz `chdir` para `process.env.PWD`
antes de criar a sessão. Apenas configurar o `cwd` do processo não basta:
a ponte também substitui `PWD` pela raiz absoluta recebida. Validado com a CLI
real numa principal e num worktree descartáveis: com PWD herdado a sessão abriu
a principal; com PWD alinhado abriu o worktree. A prova usa um modelo inexistente
para observar a criação da sessão sem inferência nem consumo de tokens.

**Modelos de API com ferramentas.** Para construir com DeepSeek, escolha o
provider `opencode` e um modelo como `deepseek/deepseek-flash`. A descoberta
consulta `opencode api model.list --standalone`: os campos `providerID`, `id` e
`variants[].id` dão os modelos e as variantes reais, incluindo `none` quando
disponível. A chave salva na Capivara acompanha a descoberta pelo ambiente; a
sessão recebe apenas a chave salva do provider do modelo escolhido. Isso não
grava credenciais na configuração do OpenCode nem injeta chaves em outras CLIs.

**Teto por resposta no OpenRouter.** A 2.0.32 pode pedir 256.000 tokens de
saída e receber HTTP 402 pela cota da chave, antes de gerar qualquer código.
A ponte consulta os limites do modelo escolhido e sobrepõe somente
`provider.openrouter.models[id].limit.output` no `OPENCODE_CONFIG_CONTENT` da
chamada: menor entre 16.384 e o limite declarado. Contexto, entrada e demais
opções são preservados. `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`, inteiro positivo
seguro, permite escolher outro teto explicitamente. A variável sozinha foi
ignorada pela CLI instalada; a sobreposição foi comprovada no pedido HTTP real
contra servidor local. Outros providers e o teto da API documental não mudam.
Se os limites não puderem ser conferidos, a ponte impede inferência em vez de
voltar silenciosamente ao teto excessivo. A consulta usa o supervisor, inclusive
para timeout e cancelamento de seu servidor privado.

Variantes pertencem ao modelo: um agente com outro modelo da mesma CLI e
effort vazio usa o padrão do próprio modelo. Não herda `none` de um Kimi, por
exemplo, ao escolher GLM sem essa variante. Uma variante explicitamente
configurada é conservada.

Eventos JSONL `error` prevalecem sobre texto de progresso ou marker anterior.
O parser entrega a mensagem legível, sem copiar o corpo HTTP aninhado; 402 de
`provider.quota` e `provider.no-route` param o build após a chamada, inclusive
no verificador e no reparo, sem iniciar outro construtor. 429 continua sujeito
à política de espera. A recusa não é aprovação nem reprovação da implementação.

## Execução sem aprovação (§112)

O executor e a sessão explícita de reparo recebem o bypass em `workspace` e
`system`, inclusive com `--no-system-install`. Os equivalentes por CLI são:

| CLI | Configuração da chamada |
|---|---|
| Claude | `--dangerously-skip-permissions` em workspace; `--permission-mode bypassPermissions` em system |
| Codex | `--dangerously-bypass-approvals-and-sandbox` |
| Cursor | `--force --approve-mcps --sandbox disabled --trust` |
| AGY | `--mode accept-edits --dangerously-skip-permissions`, sem `--sandbox` |
| OpenCode | `--auto` e `permission: {"*":"allow"}` na configuração inline; não tem sandbox próprio |

No OpenCode, enumerar apenas `edit`, `bash`, `task` e `external_directory`
deixava permissões como `read`, `webfetch`, ferramentas MCP e `doom_loop`
dependentes dos defaults ou da configuração herdada. O wildcard libera todas
as permissões globais; `--auto` também aprova pedidos restantes automaticamente.
A flag foi conferida no `opencode run --help` da versão 1.18.31.
O `debug agent build` dessa versão também confirmou a configuração efetiva:
`bash`, leitura de `.env`, diretório externo, `doom_loop`, `webfetch` e uma
permissão MCP ficaram em `allow` mesmo com regras globais restritivas no projeto,
para executor e reparador, com e sem `systemInstall`. Isso verifica a resolução
das permissões, sem executar uma sessão de modelo. Cursor e AGY não estavam
instalados nesta máquina para uma nova validação real.

No Cursor, `--force` é sinônimo de `--yolo`, mas ainda respeita regras `deny`
explícitas da CLI; `--approve-mcps` elimina a confirmação dos servidores MCP.
Essas flags não prometem remover políticas impostas pelo próprio fornecedor.
Referências: [parâmetros do Cursor](https://cursor.com/docs/cli/reference/parameters),
[permissões do OpenCode](https://opencode.ai/docs/permissions/) e
[variáveis do OpenCode](https://opencode.ai/docs/cli/#environment-variables).

Os testes dos adaptadores cobrem executor e reparador, com `systemInstall`
ausente, falso e verdadeiro, em Linux, macOS e Windows. As avaliações normais
continuam somente leitura; o preflight aceita os três providers em execução
serial e paralela e informa o acesso amplo.

## O teste que acompanha

Use as amostras capturadas no passo 1, nunca inventadas:

```ts
it("entrega a resposta, não o envelope", () => {
  expect(parseAgyJsonl(AMOSTRA).text).toBe("# Documento\n\ncorpo");
});
```

## Enquanto o adaptador não existe

`--provider custom --adapter /caminho/do/executavel` chama qualquer executável que
receba o prompt pelo stdin e escreva a resposta no stdout. Serve de escape — e de
prova de que o contrato é pequeno o bastante para caber num script.


---

## O que a integração do `agy` ensinou

Feita seguindo os quatro passos acima, e cada armadilha estava num lugar que o
nome da flag não revelava.

**O prompt não vai por `-p`.** Nesta CLI, `-p` espera o texto como valor do
próprio flag (`-p='...'`); passá-lo vazio faz ela tomar o argumento seguinte como
prompt, e a chamada morre com *"took --output-format as its prompt"*. O caminho é
stdin, que é como o harness já manda todo prompt.

**`--mode plan` não é somente-leitura**, aqui nem em lugar nenhum. É o modo que
planeja antes de agir e grava o plano num arquivo. O adaptador do Claude usou
`plan` para os papéis de leitura e uma fase inteira do piloto 6 veio com a
explicação da CLI de que não conseguiu reabrir o próprio plano, no lugar das
tasks. No AGY, quem garante somente leitura é `--sandbox`; ele é combinado com
`--dangerously-skip-permissions` para que ferramentas de leitura não dependam
de aprovação em modo headless e a resposta não volte vazia.

**Quem executa precisa da permissão dita por extenso.** O adaptador do opencode
não declarava nada para o executor e herdava o default da CLI, que nega diretório
externo — e npm, Vite e tsc usam `/tmp` e `~/.npm` o tempo todo. A sessão morria
na primeira linha e o gate relatava "a sessão não escreveu nada".

### A regra que sai das três

Nenhum nome de flag é evidência. `plan` não é leitura, ausência de configuração
não é permissão padrão, `-p` não é um booleano. **Chame a CLI de verdade nos três
níveis de acesso e leia a saída** — é o passo 1 deste documento, e as três vezes
em que ele foi pulado custaram um run inteiro cada.

### Um teste que não envelhece

Os testes que contavam providers (`são 10 providers: 4 de CLI...`) quebraram ao
acrescentar o `agy`, sem que nada estivesse errado. Foram reescritos para contar
a partir do catálogo: acrescentar uma CLI é escrever o adaptador e citá-lo na
lista, e esse trabalho não deve incluir caçar o teste que guardava o total
antigo.
