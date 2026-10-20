/**
 * I-18 (§124): fases que podem rodar ao mesmo tempo não recebem obrigação de
 * escrita no mesmo arquivo. As fixtures são as tasks reais do `haiku`
 * (Parallel Lab, 0.6.2, run `init-dc741f0d7b92`), abreviadas: a fundação que
 * entrega `modulos.ts` com as quatro entradas e `navegacao.ts` com os quatro
 * itens, e as fases de módulo que mandavam acrescentar cada entrada de novo.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkWriteOwnership, effectiveDependencies, parsePhases, writeConflicts, writeIntents } from "../../src/contract/index.js";
import type { PhasesDocument } from "../../src/contract/index.js";

/* ---------- as tasks reais do Haiku, abreviadas ---------- */

const FUNDACAO_MODULOS =
  "Criar `src/servidor/modulos.ts` com `criarModulosApi(banco: Database): { caminho: string; router: Router }[]`, que devolve, nesta ordem, as entradas com `caminho` `/tarefas`, `/categorias`, `/anotacoes` e `/painel`, cada uma com o router devolvido por `criarRotas(banco)` do módulo correspondente. Criar os stubs `src/servidor/modulos/tarefas/rotas.ts`, `src/servidor/modulos/categorias/rotas.ts`, `src/servidor/modulos/anotacoes/rotas.ts` e `src/servidor/modulos/painel/rotas.ts`; cada um exporta `criarRotas(banco: Database): Router` e devolve um Router sem nenhuma rota. Criar `src/servidor/interface.ts` com `montarInterface(app: Express): void`: se `dist/web/index.html` existir, a partir da raiz do projeto, serve `dist/web` como arquivos estáticos e responde a GET fora de `/api` que não corresponda a arquivo com `dist/web/index.html`. Se `dist/web/index.html` não existir, a função não registra nada.";
const CASCA_NAVEGACAO =
  "Criar `src/web/navegacao.ts`, `src/web/App.tsx`, `src/web/main.tsx`, `src/web/layout/Sidebar.tsx` e `src/web/layout/Cabecalho.tsx`, com as quatro rotas, a sidebar e o cabeçalho responsivos.";
const TAREFAS_ROTAS =
  "Criar `src/servidor/modulos/tarefas/rotas.ts` com `criarRotas(banco: Database): Router` e registrar o módulo em `src/servidor/modulos.ts`, acrescentando à lista de `criarModulosApi(banco)` a entrada `{ caminho: '/tarefas', router: criarRotas(banco) }`, sem outra alteração nesse arquivo.";
const TAREFAS_PAGINA =
  "Criar `src/web/modulos/tarefas/TarefasPagina.tsx` como exportação padrão e acrescentar em `src/web/navegacao.ts` a entrada `{ caminho: '/tarefas', rotulo: 'Tarefas', componente: TarefasPagina }` em `itensNavegacao`, sem alterar as demais entradas.";
const CATEGORIAS_ROTAS =
  "Registrar o router `criarRotas(banco)` em `src/servidor/modulos.ts` como um item `{ caminho: '/categorias', router: criarRotas(banco) }` da lista devolvida por `criarModulosApi`. Nas rotas com `:id`, um valor que não seja inteiro positivo responde 404 sem consultar o banco.";
const CATEGORIAS_PAGINA =
  "Criar `src/web/modulos/categorias/CategoriasPagina.tsx`, com exportação padrão, e registrar a página em `src/web/navegacao.ts` como item `{ caminho: '/categorias', rotulo: 'Categorias', componente: CategoriasPagina }` de `itensNavegacao`.";
const ANOTACOES_ROTAS =
  "Registrar o módulo em `src/servidor/modulos.ts`. A lista devolvida por `criarModulosApi(banco: Database)` inclui o item `{ caminho: '/anotacoes', router: criarRotas(banco) }`, com `criarRotas` importado de `src/servidor/modulos/anotacoes/rotas.ts`. Se o item já estiver na lista, nenhuma alteração é feita.";
const ANOTACOES_PAGINA =
  "Criar `src/web/modulos/anotacoes/AnotacoesPagina.tsx` como página padrão exportada, e registrá-la em `src/web/navegacao.ts`: a entrada de `caminho` `'/anotacoes'` em `itensNavegacao` tem `rotulo` `'Anotações'` e `componente` igual a `AnotacoesPagina`; se a entrada não existir, é acrescentada.";
const PAINEL_ROTAS =
  "Criar as rotas do painel em `src/servidor/modulos/painel/rotas.ts`, exportando `criarRotas(banco: Database): Router`. O router registra apenas `GET /`, que responde o resultado de `lerPainel(banco)`. Em seguida, registrar o módulo em `src/servidor/modulos.ts`, adicionando `{ caminho: '/painel', router: criarRotas(banco) }` à lista devolvida por `criarModulosApi`, para que a rota final seja `/api/painel`.";
const PAINEL_PAGINA =
  "Tratar a falha da requisição em `src/web/paginas/InicioPagina.tsx` e registrar a página em `src/web/navegacao.ts`. Em `src/web/navegacao.ts`, importar `InicioPagina` de `./paginas/InicioPagina` e acrescentar à lista `itensNavegacao` o item `{ caminho: '/', rotulo: 'Dashboard', componente: InicioPagina }`, sem remover os itens já presentes.";
const INTEGRACAO_NAVEGACAO =
  "Ajustar a navegação lateral e a responsividade da interface em `src/web/navegacao.ts`, `src/web/layout/Sidebar.tsx`, `src/web/layout/Cabecalho.tsx` e `src/web/App.tsx`. A lista `itensNavegacao` é a única fonte dos links da sidebar e das rotas do roteador.";

/* ---------- as mesmas tasks, como o auditor mandou corrigir ---------- */

const TAREFAS_ROTAS_CORRIGIDA =
  "Criar `src/servidor/modulos/tarefas/rotas.ts` com `criarRotas(banco: Database): Router`, implementando o stub que a fundação registrou em `src/servidor/modulos.ts` sob `/tarefas`.";
const TAREFAS_PAGINA_CORRIGIDA =
  "Criar `src/web/modulos/tarefas/TarefasPagina.tsx` como exportação padrão, o componente que a entrada `/tarefas` de `itensNavegacao` já importa.";
const CATEGORIAS_ROTAS_CORRIGIDA =
  "Criar `src/servidor/modulos/categorias/rotas.ts` com `criarRotas(banco: Database): Router`, implementando o stub que a fundação registrou sob `/categorias`. Nas rotas com `:id`, um valor que não seja inteiro positivo responde 404 sem consultar o banco.";
const CATEGORIAS_PAGINA_CORRIGIDA =
  "Criar `src/web/modulos/categorias/CategoriasPagina.tsx`, com exportação padrão, o componente que a entrada `/categorias` de `itensNavegacao` já importa.";

interface FaseFixture {
  number: number;
  title: string;
  dependsOn: string;
  tasks: { title: string; criteria?: string[] }[];
}

function documento(fases: FaseFixture[]): PhasesDocument {
  const texto = [
    "# Parallel Lab — Project Phases",
    "",
    "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa architecture.md@sha256:bbbbbbbbbbbb -->",
    "",
    ...fases.flatMap((fase) => [
      `## Phase ${fase.number}: ${fase.title}`,
      "",
      `**Goal:** entrega a fase ${fase.number} · **Depends on:** ${fase.dependsOn} · **Covers:** US-${fase.number}.1`,
      "",
      ...fase.tasks.flatMap((task) => [
        `- [ ] **Task:** ${task.title}`,
        "  - **Acceptance criteria:**",
        ...(task.criteria ?? ["    - O comportamento descrito na task é observável no código"]).map((criterio) => (criterio.startsWith("    - ") ? criterio : `    - ${criterio}`)),
        `  - **Traces:** US-${fase.number}.1`,
        "",
      ]),
    ]),
  ].join("\n");
  const parsed = parsePhases(texto);
  if (!parsed.ok) throw new Error(parsed.errors.map((erro) => `${erro.code}: ${erro.message}`).join("\n"));
  return parsed.document;
}

/** O plano do Haiku como foi publicado: fundação, casca, quatro módulos sem ordem entre si, integração. */
const HAIKU = (): FaseFixture[] => [
  { number: 1, title: "Fundação", dependsOn: "none", tasks: [{ title: FUNDACAO_MODULOS }] },
  { number: 2, title: "Casca da interface", dependsOn: "Phase 1", tasks: [{ title: CASCA_NAVEGACAO }] },
  { number: 3, title: "Módulo Tarefas", dependsOn: "Phase 1, Phase 2", tasks: [{ title: TAREFAS_ROTAS, criteria: ["`src/servidor/modulos.ts` contém exatamente um item com `caminho: '/tarefas'`"] }, { title: TAREFAS_PAGINA }] },
  { number: 4, title: "Módulo Categorias", dependsOn: "Phase 1, Phase 2", tasks: [{ title: CATEGORIAS_ROTAS, criteria: ["`src/servidor/modulos.ts` contém exatamente um item com `caminho: '/categorias'`"] }, { title: CATEGORIAS_PAGINA }] },
  { number: 5, title: "Módulo Anotações", dependsOn: "Phase 1, Phase 2", tasks: [{ title: ANOTACOES_ROTAS }, { title: ANOTACOES_PAGINA }] },
  { number: 6, title: "Dashboard", dependsOn: "Phase 1, Phase 2", tasks: [{ title: PAINEL_ROTAS }, { title: PAINEL_PAGINA }] },
  { number: 7, title: "Integração", dependsOn: "Phase 3, Phase 4, Phase 5, Phase 6", tasks: [{ title: INTEGRACAO_NAVEGACAO }] },
];

const conflitosDe = (fases: FaseFixture[]) => writeConflicts(documento(fases)).map((conflito) => `P${conflito.intent.phase}.T${conflito.intent.task.index} ${conflito.file} ↔ ${conflito.concurrent.join(",")}`);

describe("obrigação de escrita: a frase da task, não a menção do arquivo", () => {
  it("lê criar, acrescentar, registrar, ajustar e o infinitivo com pronome; ignora consumo, fonte e o presente que descreve", () => {
    const fases = HAIKU();
    const por = (numero: number) => writeIntents(documento(fases).phases[numero - 1]!).map((intent) => `${intent.kind}:${intent.file}`);
    expect(por(1)).toEqual([
      "create:src/servidor/modulos.ts",
      "create:src/servidor/modulos/tarefas/rotas.ts",
      "create:src/servidor/modulos/categorias/rotas.ts",
      "create:src/servidor/modulos/anotacoes/rotas.ts",
      "create:src/servidor/modulos/painel/rotas.ts",
      "create:src/servidor/interface.ts",
    ]);
    // "se `dist/web/index.html` existir" e "a função não registra nada" descrevem; não escrevem.
    expect(por(1)).not.toContain("modify:dist/web/index.html");
    expect(por(3)).toEqual(["create:src/servidor/modulos/tarefas/rotas.ts", "modify:src/servidor/modulos.ts", "create:src/web/modulos/tarefas/TarefasPagina.tsx", "modify:src/web/navegacao.ts"]);
    // "com `criarRotas` importado de `…/anotacoes/rotas.ts`" é fonte; "registrá-la em" é escrita.
    expect(por(5)).toEqual(["modify:src/servidor/modulos.ts", "create:src/web/modulos/anotacoes/AnotacoesPagina.tsx", "modify:src/web/navegacao.ts"]);
    // "O router registra apenas GET /" descreve o router; "registrar o módulo em" ordena.
    expect(por(6)).toEqual(["create:src/servidor/modulos/painel/rotas.ts", "modify:src/servidor/modulos.ts", "modify:src/web/paginas/InicioPagina.tsx", "modify:src/web/navegacao.ts"]);
    expect(por(7)).toEqual(["modify:src/web/navegacao.ts", "modify:src/web/layout/Sidebar.tsx", "modify:src/web/layout/Cabecalho.tsx", "modify:src/web/App.tsx"]);
  });

  it("um arquivo solto ganha o diretório explícito da frase; um diretório sem barra não o move", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [
        { title: "Criar os componentes `Botao.tsx` e `Campo.tsx` em `src/web/componentes/`, com as variantes do botão." },
        { title: "Criar em `src/web/modulos/anotacoes/componentes/` os componentes `FormularioAnotacao.tsx` e `ListaAnotacoes.tsx`, usando `Campo` e `Botao` de `src/web/componentes/`." },
        { title: "Criar também `tsconfig.servidor.json` (inclui `src/servidor` e `scripts`, com `\"strict\": true`), `tsconfig.json` (inclui `src/web`) e `index.html` na raiz que carrega `src/web/main.tsx`, e `src/web/main.tsx`, que monta um componente React vazio." },
      ] },
    ];
    expect(writeIntents(documento(fases).phases[0]!).map((intent) => intent.file)).toEqual([
      "src/web/componentes/Botao.tsx",
      "src/web/componentes/Campo.tsx",
      "src/web/modulos/anotacoes/componentes/FormularioAnotacao.tsx",
      "src/web/modulos/anotacoes/componentes/ListaAnotacoes.tsx",
      "tsconfig.servidor.json",
      "tsconfig.json",
      "index.html",
      "src/web/main.tsx",
    ]);
  });

  it("critérios nunca são escrita: verificar o estado de um arquivo não é modificá-lo", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `src/servidor/modulos.ts` com as quatro entradas." }] },
      { number: 2, title: "Tarefas", dependsOn: "Phase 1", tasks: [{ title: "Criar `src/servidor/modulos/tarefas/rotas.ts` com `criarRotas(banco)`.", criteria: ["`src/servidor/modulos.ts` contém exatamente um item com `caminho: '/tarefas'`, apontando para `criarRotas` de `src/servidor/modulos/tarefas/rotas.ts`"] }] },
      { number: 3, title: "Categorias", dependsOn: "Phase 1", tasks: [{ title: "Criar `src/servidor/modulos/categorias/rotas.ts` com `criarRotas(banco)`.", criteria: ["`src/servidor/modulos.ts` contém exatamente um item com `caminho: '/categorias'`"] }] },
    ];
    expect(writeIntents(documento(fases).phases[1]!).map((intent) => intent.file)).toEqual(["src/servidor/modulos/tarefas/rotas.ts"]);
    expect(conflitosDe(fases)).toEqual([]);
  });
});

describe("conflito: duas fases sem ordem entre si, as duas com obrigação de escrita no mesmo arquivo", () => {
  it("1. a fundação registra os quatro routers; as fases de módulo mandam acrescentar as mesmas entradas em modulos.ts", () => {
    const conflitos = conflitosDe(HAIKU()).filter((linha) => linha.includes("modulos.ts"));
    expect(conflitos).toEqual([
      "P3.T1 src/servidor/modulos.ts ↔ 4,5,6",
      "P4.T1 src/servidor/modulos.ts ↔ 3,5,6",
      "P5.T1 src/servidor/modulos.ts ↔ 3,4,6",
      "P6.T1 src/servidor/modulos.ts ↔ 3,4,5",
    ]);
    const primeiro = writeConflicts(documento(HAIKU()))[0]!;
    // Quem cria o arquivo e de quem todas dependem: a fundação.
    expect(primeiro.owners).toEqual([1]);
  });

  it("2. a casca registra os quatro itens de navegação; os módulos mandam acrescentá-los de novo em navegacao.ts", () => {
    const conflitos = conflitosDe(HAIKU()).filter((linha) => linha.includes("navegacao.ts"));
    expect(conflitos).toEqual([
      "P3.T2 src/web/navegacao.ts ↔ 4,5,6",
      "P4.T2 src/web/navegacao.ts ↔ 3,5,6",
      "P5.T2 src/web/navegacao.ts ↔ 3,4,6",
      "P6.T2 src/web/navegacao.ts ↔ 3,4,5",
    ]);
    const navegacao = writeConflicts(documento(HAIKU())).find((conflito) => conflito.file === "src/web/navegacao.ts")!;
    expect(navegacao.owners).toEqual([2]);
    // A integração (fase 7) também ajusta navegacao.ts, mas depende das quatro: nunca entra no conflito.
    expect(conflitosDe(HAIKU()).some((linha) => linha.startsWith("P7"))).toBe(false);
  });

  it("3. duas fases independentes com obrigação de escrita no mesmo arquivo, mesmo sem fundação que o crie", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `src/servidor/app.ts` com `criarApp()`." }] },
      { number: 2, title: "A", dependsOn: "Phase 1", tasks: [{ title: "Acrescentar em `package.json` a dependência `zod` e criar `src/a.ts`." }] },
      { number: 3, title: "B", dependsOn: "Phase 1", tasks: [{ title: "Adicionar em `package.json` a dependência `dayjs` e criar `src/b.ts`." }] },
    ];
    expect(conflitosDe(fases)).toEqual(["P2.T1 package.json ↔ 3", "P3.T1 package.json ↔ 2"]);
    expect(writeConflicts(documento(fases))[0]!.owners).toEqual([]);
    const [erro] = checkWriteOwnership(documento(fases));
    expect(erro?.code).toBe("I-18");
    expect(erro?.hint).toContain("nenhuma fase de que todas as conflitantes dependam cria `package.json`");
  });

  it("4. duas fases que só leem o mesmo arquivo não conflitam", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `src/web/api/cliente.ts` com `requisitar()`." }] },
      { number: 2, title: "A", dependsOn: "Phase 1", tasks: [{ title: "Criar `src/web/modulos/a/api.ts`, usando `requisitar` de `src/web/api/cliente.ts`." }] },
      { number: 3, title: "B", dependsOn: "Phase 1", tasks: [{ title: "Criar `src/web/modulos/b/api.ts` com as funções do módulo, que chamam `requisitar` definido em `src/web/api/cliente.ts`." }] },
    ];
    expect(conflitosDe(fases)).toEqual([]);
  });

  it("5. uma fase cria um stub e a seguinte o substitui: sequência, não conflito", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `src/web/main.tsx`, que monta um componente React vazio no elemento de id `raiz`." }] },
      { number: 2, title: "Casca", dependsOn: "Phase 1", tasks: [{ title: "Reescrever `src/web/main.tsx` para renderizar em `#root` a árvore `BrowserRouter` > `App`, e criar `index.html` com `<div id=\"root\">`." }] },
    ];
    expect(writeIntents(documento(fases).phases[1]!).map((intent) => intent.file)).toEqual(["src/web/main.tsx", "index.html"]);
    expect(conflitosDe(fases)).toEqual([]);
  });

  it("6. arquivo compartilhado com dono único e módulos que só escrevem nos seus: nada a apontar", () => {
    const fases = HAIKU();
    fases[2]!.tasks = [{ title: TAREFAS_ROTAS_CORRIGIDA, criteria: ["`src/servidor/modulos.ts` contém exatamente um item com `caminho: '/tarefas'`"] }, { title: TAREFAS_PAGINA_CORRIGIDA }];
    fases[3]!.tasks = [{ title: CATEGORIAS_ROTAS_CORRIGIDA }, { title: CATEGORIAS_PAGINA_CORRIGIDA }];
    fases[4]!.tasks = [{ title: "Criar `src/servidor/modulos/anotacoes/rotas.ts` com `criarRotas(banco: Database): Router`." }, { title: "Criar `src/web/modulos/anotacoes/AnotacoesPagina.tsx` como página padrão exportada." }];
    fases[5]!.tasks = [{ title: "Criar `src/servidor/modulos/painel/rotas.ts`, exportando `criarRotas(banco: Database): Router`." }, { title: "Tratar a falha da requisição em `src/web/paginas/InicioPagina.tsx`." }];
    expect(conflitosDe(fases)).toEqual([]);
    expect(checkWriteOwnership(documento(fases))).toEqual([]);
  });

  it("14, 15. a verificação não inventa dependência: o documento sai como entrou, e a propriedade é coerente nas fases paralelizáveis", () => {
    const doc = documento(HAIKU());
    const antes = doc.phases.map((phase) => phase.dependsOn);
    checkWriteOwnership(doc);
    expect(doc.phases.map((phase) => phase.dependsOn)).toEqual(antes);
    // As fases 3 a 6 continuam sem ordem entre si: a correção é de propriedade, não de serialização.
    expect(antes.slice(2, 6)).toEqual(["Phase 1, Phase 2", "Phase 1, Phase 2", "Phase 1, Phase 2", "Phase 1, Phase 2"]);
  });

  it("16. a fase sequencial pode modificar o arquivo entregue antes: a integração ajusta navegacao.ts e a casca a entregou", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Casca", dependsOn: "none", tasks: [{ title: CASCA_NAVEGACAO }] },
      { number: 2, title: "Tarefas", dependsOn: "Phase 1", tasks: [{ title: TAREFAS_PAGINA_CORRIGIDA }] },
      { number: 3, title: "Integração", dependsOn: "Phase 2", tasks: [{ title: INTEGRACAO_NAVEGACAO }] },
    ];
    expect(conflitosDe(fases)).toEqual([]);
    // Transitivo: a fase 3 depende da 1 pela 2.
    const comTres: FaseFixture[] = [...fases.slice(0, 2), { number: 3, title: "Integração", dependsOn: "Phase 2", tasks: [{ title: "Ajustar `src/web/navegacao.ts` e `src/web/App.tsx`." }] }];
    expect(conflitosDe(comTres)).toEqual([]);
  });

  it("o erro nomeia a task, o arquivo, as fases concorrentes, o dono e o componente da arquitetura, e manda escrever só nos próprios arquivos", () => {
    const erros = checkWriteOwnership(documento(HAIKU()), { components: [{ name: "api-base", files: ["src/servidor/app.ts", "src/servidor/modulos.ts"] }, { name: "web-shell", files: ["src/web/navegacao.ts"] }] });
    expect(erros).toHaveLength(8);
    const [primeiro] = erros;
    expect(primeiro?.code).toBe("I-18");
    expect(primeiro?.message).toContain("da fase 3 ordena escrever em `src/servidor/modulos.ts` (registrar)");
    expect(primeiro?.message).toContain("as fases 4, 5 e 6 — sem dependência com ela, que o build pode executar ao mesmo tempo — também ordenam escrever nele");
    expect(primeiro?.message).toContain('o arquivo é do componente "api-base"');
    expect(primeiro?.hint).toContain("a fase 1, de que todas as fases em conflito dependem, cria `src/servidor/modulos.ts`");
    expect(primeiro?.hint).toContain("retire desta task a instrução de criar, acrescentar, registrar ou alterar `src/servidor/modulos.ts`");
    expect(primeiro?.hint).toContain("verificar não é escrever");
    expect(primeiro?.hint).toContain("não invente dependência aqui");
    // Cada erro está na linha da task que escreve: a emenda vai à fase certa.
    const doc = documento(HAIKU());
    expect(erros.map((erro) => erro.line)).toEqual(doc.phases.slice(2, 6).flatMap((phase) => phase.tasks.map((task) => task.line)));
  });
});

describe("o que não é obrigação de escrita (§124, revisão adversarial)", () => {
  const intentsDe = (titulo: string) => writeIntents(documento([{ number: 1, title: "Base", dependsOn: "none", tasks: [{ title: titulo }] }]).phases[0]!).map((intent) => `${intent.kind}:${intent.file}`);

  it("negação e preposição antes do verbo descrevem, não ordenam: a frase que a dica do I-18 sugere não é recusada", () => {
    expect(intentsDe("Criar `src/servidor/modulos/tarefas/rotas.ts` sem alterar `src/servidor/modulos.ts`, que a fundação já entrega.")).toEqual(["create:src/servidor/modulos/tarefas/rotas.ts"]);
    expect(intentsDe("Criar `src/servidor/modulos/tarefas/rotas.ts`; não modificar `src/web/navegacao.ts`.")).toEqual(["create:src/servidor/modulos/tarefas/rotas.ts"]);
    expect(intentsDe("Implementar `src/modulos/a.ts`, nunca editar `package.json`.")).toEqual(["modify:src/modulos/a.ts"]);
    expect(intentsDe("Create `src/modules/a.ts` without modifying `src/app.ts`.")).toEqual(["create:src/modules/a.ts"]);
    expect(intentsDe("Create `src/modules/a.ts`; do not edit `src/app.ts`.")).toEqual(["create:src/modules/a.ts"]);
    // "ao criar uma tarefa, grava em…" descreve o que o código faz em tempo de execução.
    expect(intentsDe("Implementar `src/modulos/tarefas/servico.ts`, que, ao criar uma tarefa, grava o registro em `dados/banco.json`.")).toEqual(["modify:src/modulos/tarefas/servico.ts"]);
    expect(intentsDe("Criar `src/a.ts` para registrar o módulo em `src/servidor/modulos.ts` quando o servidor subir.")).toEqual(["create:src/a.ts"]);
  });

  it("ponto-e-vírgula, dois-pontos e parênteses fecham a oração: o verbo não governa o que vem depois deles", () => {
    expect(intentsDe("Criar `src/servidor/modulos/tarefas/rotas.ts`; `src/servidor/modulos.ts` não deve ser alterado.")).toEqual(["create:src/servidor/modulos/tarefas/rotas.ts"]);
    expect(intentsDe("Criar `src/servidor/modulos/tarefas/rotas.ts` (a entrada `/tarefas` em `src/servidor/modulos.ts` já existe; não a recriar).")).toEqual(["create:src/servidor/modulos/tarefas/rotas.ts"]);
    expect(intentsDe("Em `src/servidor/modulos.ts` a entrada `/tarefas` já existe: criar apenas `src/servidor/modulos/tarefas/rotas.ts`.")).toEqual(["create:src/servidor/modulos/tarefas/rotas.ts"]);
    // A voz passiva que ordena conta; a que proíbe não.
    expect(intentsDe("A entrada do módulo deve ser registrada em `src/servidor/modulos.ts`.")).toEqual(["modify:src/servidor/modulos.ts"]);
  });

  it("o genitivo e o locativo composto nomeiam o destino: 'à lista de X', 'dentro de X', 'ao final de X' são escrita", () => {
    expect(intentsDe("Acrescentar à lista `itensNavegacao` de `src/web/navegacao.ts` o item `{ caminho: '/tarefas' }`.")).toEqual(["modify:src/web/navegacao.ts"]);
    expect(intentsDe("Registrar o módulo `tarefas` dentro de `src/servidor/modulos.ts`.")).toEqual(["modify:src/servidor/modulos.ts"]);
    expect(intentsDe("Acrescentar a entrada `/tarefas` ao final de `src/servidor/modulos.ts`.")).toEqual(["modify:src/servidor/modulos.ts"]);
    expect(intentsDe("Ajustar os scripts de `package.json` para rodar o servidor.")).toEqual(["modify:package.json"]);
    expect(intentsDe("Alterar o tipo `Tarefa` definido em `src/tipos.ts` para incluir `prioridade`.")).toEqual(["modify:src/tipos.ts"]);
    expect(intentsDe("Update the `scripts` section of `package.json` to add `dev`.")).toEqual(["modify:package.json"]);
    // E a fonte continua fonte.
    expect(intentsDe("Criar `src/web/modulos/a/api.ts` a partir de `src/web/modulos/modelo/api.ts`, usando `requisitar` de `src/web/api/cliente.ts`.")).toEqual(["create:src/web/modulos/a/api.ts"]);
    expect(intentsDe("Criar `src/b.ts` com uma cópia de `src/a.ts`.")).toEqual(["create:src/b.ts"]);
  });

  it("código entre crases não é verbo: `import … from` não desfaz a escrita, `POST /import` não é consumo", () => {
    expect(intentsDe("Acrescentar `import { x } from './x'` em `src/web/App.tsx`.")).toEqual(["modify:src/web/App.tsx"]);
    expect(intentsDe("Registrar a rota `POST /import` em `src/servidor/rotas.ts`.")).toEqual(["modify:src/servidor/rotas.ts"]);
    expect(intentsDe("Acrescentar o campo `read` em `src/tipos.ts`.")).toEqual(["modify:src/tipos.ts"]);
    expect(intentsDe("Criar `src/servidor/import.ts` e `src/servidor/export.ts`.")).toEqual(["create:src/servidor/import.ts", "create:src/servidor/export.ts"]);
    expect(intentsDe("Criar `src/add.ts` e `src/b.ts`.")).toEqual(["create:src/add.ts", "create:src/b.ts"]);
    // "importar X em Y" escreve em Y; "importar X de Y" consome Y.
    expect(intentsDe("Importar `criarRotas` em `src/servidor/app.ts` e montar em `/api`.")).toEqual(["modify:src/servidor/app.ts"]);
    expect(intentsDe("Criar `src/web/a.ts`, importando `requisitar` de `src/web/api/cliente.ts`.")).toEqual(["create:src/web/a.ts"]);
  });

  it("nome com ponto na prosa não é arquivo: Node.js, Next.js, p.ex. e process.env ficam de fora", () => {
    expect(intentsDe("Criar o servidor Node.js em `src/servidor/app.ts` com Express.")).toEqual(["create:src/servidor/app.ts"]);
    expect(intentsDe("Criar `src/web/App.tsx` com Next.js e Tailwind.")).toEqual(["create:src/web/App.tsx"]);
    expect(intentsDe("Acrescentar em `src/modulos/a.ts` um campo opcional, p.ex. `apelido`.")).toEqual(["modify:src/modulos/a.ts"]);
    expect(intentsDe("Configurar process.env.PORTA em `src/config.ts`.")).toEqual(["modify:src/config.ts"]);
    // Caminho solto sem crase conta quando tem diretório, mesmo antes do ponto final; a barra invertida vira barra.
    expect(intentsDe("Registrar o router em src/servidor/modulos.ts.")).toEqual(["modify:src/servidor/modulos.ts"]);
    expect(intentsDe("Criar `src\\web\\a.ts` com o componente.")).toEqual(["create:src/web/a.ts"]);
    expect(intentsDe("Criar `src/modulos/*/rotas.ts` para cada módulo.")).toEqual([]);
  });

  it("a coordenação fecha a subordinada; o homógrafo não é verbo", () => {
    expect(intentsDe("Criar `src/a.ts` que exporta `foo` e `src/b.ts` que exporta `bar`.")).toEqual(["create:src/a.ts", "create:src/b.ts"]);
    expect(intentsDe("Verificar que o ajuste de responsividade em `src/web/App.tsx` mantém a sidebar visível.")).toEqual([]);
    expect(intentsDe("Seguir o guia complementar em `docs/guia.md` para nomear as rotas.")).toEqual([]);
    expect(intentsDe("Create the complete `README.md` with setup steps.")).toEqual(["create:README.md"]);
    expect(intentsDe("Estender `src/db/schema.ts` com a tabela `categorias`.")).toEqual(["modify:src/db/schema.ts"]);
    expect(intentsDe("Documentar em `README.md` como rodar o projeto.")).toEqual(["modify:README.md"]);
    expect(intentsDe("Versionar `.env.example` e `.gitignore` para a configuração do banco.")).toEqual(["modify:.env.example", "modify:.gitignore"]);
  });

  it("nome solto sem diretório é ambíguo: dois `rotas.ts` em módulos diferentes não conflitam; `package.json` solto conflita", () => {
    const modulos: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `src/servidor/app.ts`." }] },
      { number: 2, title: "Tarefas", dependsOn: "Phase 1", tasks: [{ title: "Criar `rotas.ts` com as rotas de tarefas, exportando `criarRotas(banco)`." }] },
      { number: 3, title: "Categorias", dependsOn: "Phase 1", tasks: [{ title: "Criar `rotas.ts` com as rotas de categorias." }] },
    ];
    expect(writeIntents(documento(modulos).phases[1]!).map((intent) => `${intent.file}${intent.ambiguous ? "?" : ""}`)).toEqual(["rotas.ts?"]);
    expect(conflitosDe(modulos)).toEqual([]);
    const comDiretorio: FaseFixture[] = [
      modulos[0]!,
      { number: 2, title: "Tarefas", dependsOn: "Phase 1", tasks: [{ title: "Criar `index.ts` em `src/servidor/modulos/tarefas` com `criarRotas(banco)`." }] },
      { number: 3, title: "Categorias", dependsOn: "Phase 1", tasks: [{ title: "Criar `index.ts` em `src/servidor/modulos/categorias` com `criarRotas(banco)`." }] },
    ];
    expect(writeIntents(documento(comDiretorio).phases[1]!).map((intent) => intent.file)).toEqual(["src/servidor/modulos/tarefas/index.ts"]);
    expect(conflitosDe(comDiretorio)).toEqual([]);
    const raiz: FaseFixture[] = [
      modulos[0]!,
      { number: 2, title: "A", dependsOn: "Phase 1", tasks: [{ title: "Acrescentar em `package.json` a dependência `zod`." }] },
      { number: 3, title: "B", dependsOn: "Phase 1", tasks: [{ title: "Acrescentar em `package.json` a dependência `dayjs`." }] },
    ];
    expect(conflitosDe(raiz)).toEqual(["P2.T1 package.json ↔ 3", "P3.T1 package.json ↔ 2"]);
    // Cada arquivo solto ganha o diretório que o acompanha, mesmo quando o diretório vem depois.
    expect(intentsDe("Criar `A.tsx` em `src/a/` e `B.tsx` em `src/b/`.")).toEqual(["create:src/a/A.tsx", "create:src/b/B.tsx"]);
  });

  it("o mesmo em inglês: register/adding conflita, using/from consome", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Foundation", dependsOn: "none", tasks: [{ title: "Create `src/server/modules.ts` with `createModulesApi(db)` returning the `/tasks` and `/categories` entries." }] },
      { number: 2, title: "Tasks", dependsOn: "Phase 1", tasks: [{ title: "Create `src/server/modules/tasks/routes.ts` and register the module in `src/server/modules.ts`, adding the `/tasks` entry." }] },
      { number: 3, title: "Categories", dependsOn: "Phase 1", tasks: [{ title: "Create `src/server/modules/categories/routes.ts`, using `request` from `src/web/api/client.ts`, and register it in `src/server/modules.ts`." }] },
    ];
    expect(conflitosDe(fases)).toEqual(["P2.T1 src/server/modules.ts ↔ 3", "P3.T1 src/server/modules.ts ↔ 2"]);
    expect(writeIntents(documento(fases).phases[2]!).map((intent) => intent.file)).toEqual(["src/server/modules/categories/routes.ts", "src/server/modules.ts"]);
  });
});

describe("quem cria e quem depende: a dica diz a verdade sobre o dono", () => {
  it("o criador entre as fases concorrentes mantém a criação; quem altera sem depender dele é quem retira a escrita", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `src/servidor/app.ts`." }] },
      { number: 2, title: "Fundação da API", dependsOn: "Phase 1", tasks: [{ title: "Criar `src/servidor/modulos.ts` com `criarModulosApi(banco)`." }] },
      { number: 3, title: "Tarefas", dependsOn: "Phase 1", tasks: [{ title: "Registrar o módulo em `src/servidor/modulos.ts`." }] },
    ];
    const erros = checkWriteOwnership(documento(fases));
    expect(erros).toHaveLength(2);
    expect(erros[0]?.hint).toContain("esta fase CRIA `src/servidor/modulos.ts`, e a fase 3 escreve nele sem depender desta: mantenha a criação aqui");
    expect(erros[0]?.hint).toContain("não apague a criação");
    expect(erros[1]?.hint).toContain("a fase 2 cria `src/servidor/modulos.ts`, mas não vem antes desta fase: retire desta task");
    const conflitos = writeConflicts(documento(fases));
    expect(conflitos.map((conflito) => conflito.creators)).toEqual([[2], [2]]);
    expect(conflitos.map((conflito) => conflito.owners)).toEqual([[], []]);
  });

  it("o dono que todas alcançam: a dica não afirma que ele entrega a entrada — manda verificar, ou pedir como critério", () => {
    const [erro] = checkWriteOwnership(documento(HAIKU()));
    expect(erro?.hint).toContain("Se ela já entrega o que esta fase precisa encontrar em `src/servidor/modulos.ts`, retire desta task");
    expect(erro?.hint).toContain("Se ela ainda não entrega, escreva a necessidade como critério");
    expect(erro?.hint).toContain("Em nenhum caso esta fase escreve em `src/servidor/modulos.ts`");
  });

  it("a fundação é dependência de toda fase, como no escalonador: 'Depends on: none' numa fase posterior não é concorrência com a fase 1", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `package.json` com os scripts." }] },
      { number: 2, title: "A", dependsOn: "none", tasks: [{ title: "Acrescentar em `package.json` a dependência `express`." }] },
    ];
    expect(conflitosDe(fases)).toEqual([]);
    const tres: FaseFixture[] = [...fases, { number: 3, title: "B", dependsOn: "none", tasks: [{ title: "Acrescentar em `package.json` a dependência `zod`." }] }];
    // As fases 2 e 3, sem ordem entre si, continuam em conflito; a fase 1 não entra nele.
    expect(conflitosDe(tres)).toEqual(["P2.T1 package.json ↔ 3", "P3.T1 package.json ↔ 2"]);
    expect(writeConflicts(documento(tres))[0]?.owners).toEqual([1]);
    const efetivas = effectiveDependencies(documento(tres).phases);
    expect([...efetivas.entries()]).toEqual([[1, []], [2, [1]], [3, [1]]]);
  });

  it("caminho com acento preserva o acento no arquivo e casa com o componente da arquitetura", () => {
    const fases: FaseFixture[] = [
      { number: 1, title: "Base", dependsOn: "none", tasks: [{ title: "Criar `src/servidor/app.ts`." }] },
      { number: 2, title: "A", dependsOn: "Phase 1", tasks: [{ title: "Acrescentar em `src/web/paginas/ConfiguraçõesPagina.tsx` o formulário." }] },
      { number: 3, title: "B", dependsOn: "Phase 1", tasks: [{ title: "Acrescentar em `src/web/paginas/ConfiguraçõesPagina.tsx` o tema." }] },
    ];
    const [erro] = checkWriteOwnership(documento(fases), { components: [{ name: "web-config", files: ["src/web/paginas/ConfiguraçõesPagina.tsx"] }] });
    expect(erro?.message).toContain("`src/web/paginas/ConfiguraçõesPagina.tsx`");
    expect(erro?.message).toContain('o arquivo é do componente "web-config"');
  });
});

describe("calibração reproduzível: o plano real do Haiku, como foi publicado", () => {
  it("exatamente os oito conflitos — modulos.ts e navegacao.ts nas fases 3 a 6 —, nas linhas publicadas, e nenhum outro entre as 100+ obrigações de escrita", async () => {
    const plano = await readFile(new URL("../fixtures/haiku-124.project-phases.md", import.meta.url), "utf8");
    const parsed = parsePhases(plano);
    if (!parsed.ok) throw new Error(parsed.errors.map((erro) => erro.message).join("\n"));
    const conflitos = writeConflicts(parsed.document, { components: [
      { name: "api-base", files: ["src/servidor/app.ts", "src/servidor/index.ts", "src/servidor/interface.ts", "src/servidor/modulos.ts"] },
      { name: "web-shell", files: ["index.html", "vite.config.ts", "src/web/main.tsx", "src/web/App.tsx", "src/web/navegacao.ts"] },
    ] });
    expect(conflitos.map((conflito) => `P${conflito.intent.phase} L${conflito.intent.task.line} ${conflito.file} ↔ ${conflito.concurrent.join(",")} donos=${conflito.owners.join(",")} comp=${conflito.component}`)).toEqual([
      "P3 L163 src/servidor/modulos.ts ↔ 4,5,6 donos=1,2 comp=api-base",
      "P3 L192 src/web/navegacao.ts ↔ 4,5,6 donos=2 comp=web-shell",
      "P4 L231 src/servidor/modulos.ts ↔ 3,5,6 donos=1,2 comp=api-base",
      "P4 L252 src/web/navegacao.ts ↔ 3,5,6 donos=2 comp=web-shell",
      "P5 L295 src/servidor/modulos.ts ↔ 3,4,6 donos=1,2 comp=api-base",
      "P5 L317 src/web/navegacao.ts ↔ 3,4,6 donos=2 comp=web-shell",
      "P6 L336 src/servidor/modulos.ts ↔ 3,4,5 donos=1,2 comp=api-base",
      "P6 L350 src/web/navegacao.ts ↔ 3,4,5 donos=2 comp=web-shell",
    ]);
    // A leitura das obrigações é ampla: as cinquenta e duas tasks rendem dezenas, e as sequenciais não conflitam.
    const total = parsed.document.phases.reduce((soma, phase) => soma + writeIntents(phase).length, 0);
    expect(total).toBeGreaterThan(80);
    // O mesmo plano com as oito tasks corrigidas como o auditor mandou: limpo.
    const corrigido = plano
      .replace("e registrar o módulo em `src/servidor/modulos.ts`, acrescentando à lista de `criarModulosApi(banco)` a entrada `{ caminho: '/tarefas', router: criarRotas(banco) }`, sem outra alteração nesse arquivo", ", o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/tarefas`")
      .replace("Registrar o router `criarRotas(banco)` em `src/servidor/modulos.ts` como um item `{ caminho: '/categorias', router: criarRotas(banco) }` da lista devolvida por `criarModulosApi`.", "Implementar o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/categorias`.")
      .replace("Registrar o módulo em `src/servidor/modulos.ts`. A lista devolvida por `criarModulosApi(banco: Database)` inclui o item `{ caminho: '/anotacoes', router: criarRotas(banco) }`, com `criarRotas` importado de `src/servidor/modulos/anotacoes/rotas.ts`. Se o item já estiver na lista, nenhuma alteração é feita.", "Implementar o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/anotacoes`, com `criarRotas` de `src/servidor/modulos/anotacoes/rotas.ts`.")
      .replace("Em seguida, registrar o módulo em `src/servidor/modulos.ts`, adicionando `{ caminho: '/painel', router: criarRotas(banco) }` à lista devolvida por `criarModulosApi`, para que a rota final seja `/api/painel`.", "O stub registrado em `src/servidor/modulos.ts` pela fundação sob `/painel` passa a responder `/api/painel`.")
      .replace("e acrescentar em `src/web/navegacao.ts` a entrada `{ caminho: '/tarefas', rotulo: 'Tarefas', componente: TarefasPagina }` em `itensNavegacao`, sem alterar as demais entradas", ", o componente que a entrada `/tarefas` de `itensNavegacao` já importa")
      .replace("e registrar a página em `src/web/navegacao.ts` como item `{ caminho: '/categorias', rotulo: 'Categorias', componente: CategoriasPagina }` de `itensNavegacao`.", ", o componente que a entrada `/categorias` de `itensNavegacao` já importa.")
      .replace("e registrá-la em `src/web/navegacao.ts`: a entrada de `caminho` `'/anotacoes'` em `itensNavegacao` tem `rotulo` `'Anotações'` e `componente` igual a `AnotacoesPagina`; se a entrada não existir, é acrescentada.", ": a entrada de `caminho` `'/anotacoes'` em `itensNavegacao`, entregue pela casca, importa `AnotacoesPagina`.")
      .replace("Tratar a falha da requisição em `src/web/paginas/InicioPagina.tsx` e registrar a página em `src/web/navegacao.ts`. Em `src/web/navegacao.ts`, importar `InicioPagina` de `./paginas/InicioPagina` e acrescentar à lista `itensNavegacao` o item `{ caminho: '/', rotulo: 'Dashboard', componente: InicioPagina }`, sem remover os itens já presentes.", "Tratar a falha da requisição em `src/web/paginas/InicioPagina.tsx`, o componente que a entrada `/` de `itensNavegacao` já importa.");
    const limpo = parsePhases(corrigido);
    if (!limpo.ok) throw new Error(limpo.errors.map((erro) => erro.message).join("\n"));
    expect(checkWriteOwnership(limpo.document)).toEqual([]);
  });
});
