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
| `workspace` | executor | escrever dentro do projeto |
| `system` | executor, só com `--system-install` | instalar pacote de sistema |

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
