/**
 * A fronteira INIT → PLAN: requisitos sem arquitetura prematura (§123).
 *
 * No `haiku` (Parallel Lab, 0.6.2, run `init-dc741f0d7b92`) o INIT publicou um
 * esqueleto com decisões de engenharia que o pedido nunca tomou: a variável
 * `APP_DB_PATH` e o caminho `data/parallel-lab.db`; "as tabelas são criadas
 * com CREATE TABLE IF NOT EXISTS antes de o servidor aceitar requisições";
 * `E2E_PORT` numa regra de porta; o cliente da API em `src/nucleo/api.ts`; o
 * tema em `src/nucleo/tema.css`; as rotas em `src/casca/rotas.tsx`; a página
 * de cada módulo em `src/modulos/<modulo>/Pagina<Modulo>.tsx`; uma entrada de
 * stack "Estrutura de pastas"; e "os testes automatizados definem APP_DB_PATH
 * para um arquivo temporário". A regra do harness sobre o comando de migração
 * dizia "criar ou alterar esquema fora desse comando é proibido". O PLAN leu
 * as duas como produto, o arquiteto fez `abrirBanco()` criar o esquema, o
 * auditor cobrou o contrário, e a auditoria da arquitetura gastou seis rodadas,
 * uma mudança de estratégia e dois reparos antes de parar. Os textos reais são
 * as fixtures.
 *
 * O que se prova: o esqueleto não fixa mecanismo de implementação sem
 * autoridade (I-17: caminho, variável de ambiente, comando, código); o que o
 * pedido ou uma decisão nomeia continua valendo; a exigência de testes e o
 * isolamento do banco ficam como comportamento; a regra do harness sobre a
 * migração diz o que os gates precisam e deixa o resto ao plano; o escritor
 * corrige com os termos nomeados, o auditor assume quando ele não corrige, e o
 * resíduo depois da escada não bloqueia o run; o caminho limpo não ganha
 * chamada nenhuma; e o PLAN recebe a fronteira escrita nos prompts.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mechanismPrescriptions, parseSkeleton, testPrescriptions } from "../../src/contract/index.js";
import { runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO, regrasDeBanco } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { architectPrompt, architectureAuditPrompt, gapPrompt, interviewPrompt, skeletonPrompt } from "../../src/prompts/index.js";
import { NO_QUESTIONS, SKELETON, fakeAgent, oneQuestion, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-123-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

/* ---------- o pedido real do Parallel Lab (os trechos que decidem) ---------- */

const PEDIDO = `# CAPIVARA PARALLEL LAB — Teste de execução paralela

Crie uma aplicação web chamada **Parallel Lab**, destinada a testar a geração de aplicações com múltiplos agentes trabalhando simultaneamente.

## Stack

- Node.js
- TypeScript
- React
- Vite
- Backend Node.js com API REST
- SQLite em arquivo
- Testes automatizados

Use soluções simples, estáveis e amplamente adotadas. Evite serviços externos e integrações desnecessárias.

## Arquitetura e independência

A aplicação deve possuir uma fundação compartilhada e três módulos funcionalmente independentes.
Cada módulo deve ter suas próprias rotas, componentes, serviços e testes, respeitando os contratos comuns definidos na fundação.
Os módulos independentes não devem modificar arquivos compartilhados simultaneamente.

## Persistência

Usar SQLite em arquivo.
Todos os cadastros devem persistir entre reinicializações.
Os testes precisam utilizar banco isolado dos dados normais da aplicação.
Não utilizar serviços de banco de dados externos.

## Testes e critérios de aceite

A aplicação completa precisa demonstrar:
- Inicialização por comandos documentados.
- Compilação sem erros.
- Fluxos reais executados no navegador.
- Testes automatizados aprovados.
`;

const request = { text: PEDIDO, origin: "text" as const, path: null, sha12: "paralle1lab0" };
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");

/* ---------- as regras reais do Haiku ---------- */

const REGRAS_DO_HAIKU = {
  "banco.arquivo":
    "O banco é um arquivo SQLite cujo caminho vem da variável de ambiente APP_DB_PATH; sem a variável, o caminho é data/parallel-lab.db, relativo à raiz do projeto. O diretório do arquivo é criado se não existir. As tabelas tarefas, categorias e anotacoes são criadas com CREATE TABLE IF NOT EXISTS antes de o servidor aceitar requisições. Nenhum registro é inserido automaticamente: não há dados de exemplo nem semeadura.",
  "banco.persistencia":
    "Todo registro gravado com sucesso permanece no arquivo SQLite após reinício do servidor. A interface nunca guarda registros somente em memória como fonte de verdade.",
  "banco.isolamento-de-testes":
    "Os testes automatizados definem APP_DB_PATH para um arquivo temporário exclusivo de cada execução e nunca usam data/parallel-lab.db. O arquivo temporário é removido ao fim da execução.",
  "servidor.porta":
    "O servidor escuta na porta definida pela variável PORT, com padrão 3000. Quando iniciado pelos testes de navegador, escuta na porta definida pela variável E2E_PORT, que o harness atribui a cada processo de teste; nenhuma porta fixa é usada pelos testes.",
  "api.prefixo-e-rotas":
    "Todas as rotas da API ficam sob /api e respondem em JSON. Tarefas: GET /api/tarefas, POST /api/tarefas, GET /api/tarefas/:id, PUT /api/tarefas/:id, PATCH /api/tarefas/:id/status, DELETE /api/tarefas/:id. Não há rota de resumo.",
  "api.cliente":
    "A interface acessa a API somente pelo cliente compartilhado em src/nucleo/api.ts, que usa o prefixo /api em todas as chamadas, envia e lê JSON e converte respostas de erro em exceção com status, mensagem e campos.",
  "tarefas.titulo":
    "tarefas.titulo: obrigatório; no salvamento, espaços do início e do fim são removidos; se o texto ficar vazio, é rejeitado; máximo de 255 caracteres após a remoção; espaços internos são preservados; não há unicidade.",
  "categorias.nome":
    "categorias.nome: obrigatório; Unicidade: dois nomes são iguais quando coincidem ignorando maiúsculas e minúsculas e todos os espaços. A verificação ocorre na criação e na edição, excluindo o próprio registro.",
  "categorias.cor":
    "categorias.cor: obrigatória, enviada no formato #rrggbb com seis dígitos hexadecimais e gravada em minúsculas. A interface oferece seletor de cor livre (controle nativo de cor); o valor inicial do formulário de cadastro é #3b82f6.",
  "datas.exibicao":
    "A interface exibe criadoEm e atualizadoEm no formato dd/mm/aaaa, convertidos do UTC para a data local do navegador. A API nunca devolve datas já formatadas.",
  "exclusao":
    "Excluir remove o registro(s) definitivamente da tabela; não há lixeira, desfazer nem exclusão lógica. A interface envia DELETE somente depois de o usuário confirmar em caixa de diálogo com os botões Cancelar e Excluir.",
  "modulos.independencia":
    "Os módulos tarefas, categorias e anotacoes não possuem chaves estrangeiras, consultas, rotas, componentes ou serviços que referenciem outro módulo. Cada módulo ocupa somente server/modulos/<modulo>/ e src/modulos/<modulo>/. A página de cada módulo fica em src/modulos/<modulo>/Pagina<Modulo>.tsx: PaginaTarefas, PaginaCategorias e PaginaAnotacoes.",
  "arquivos.compartilhados":
    "Os arquivos da fundação são server/nucleo/ (aplicação Express, conexão e esquema do banco, erros e validação comum), src/nucleo/ (cliente da API, notificações, componentes compartilhados, formatação de data e tema.css), src/casca/ (layout, sidebar e tabela de rotas) e os arquivos de configuração do projeto. Nenhuma fase de módulo altera esses arquivos.",
  "interface.tema":
    "Cores, espaçamentos e tipografia são variáveis CSS definidas em src/nucleo/tema.css e usadas por todos os componentes. Nenhum módulo define paleta própria.",
  "interface.navegacao":
    "A aplicação tem exatamente as rotas /, /tarefas, /categorias e /anotacoes, declaradas em src/casca/rotas.tsx. A sidebar contém links para Início, Tarefas, Categorias e Anotações e destaca a rota atual.",
  "interface.responsividade":
    "Em telas estreitas, a sidebar fica recolhida atrás de um botão, e nenhum formulário, tabela ou lista fica cortado ou exige rolagem horizontal. Em telas largas, a sidebar permanece visível.",
};

/** As mesmas exigências, como comportamento: é o que o escritor devolve corrigido. */
const REGRAS_CORRIGIDAS = {
  "banco.arquivo":
    "Os dados dos três módulos persistem em um banco SQLite local, em arquivo criado pelo próprio projeto, e permanecem disponíveis após reiniciar a aplicação. As tabelas de tarefas, categorias e anotacoes existem antes de o servidor aceitar requisições. Nenhum registro é inserido automaticamente.",
  "banco.persistencia": REGRAS_DO_HAIKU["banco.persistencia"],
  "servidor.porta": "A porta em que o servidor escuta é configurável; nenhuma porta fixa é exigida pelos fluxos.",
  "api.prefixo-e-rotas": REGRAS_DO_HAIKU["api.prefixo-e-rotas"],
  "api.cliente": "A interface acessa a API somente por um cliente compartilhado, que usa o prefixo /api em todas as chamadas e converte respostas de erro em exceção com status, mensagem e campos.",
  "tarefas.titulo": REGRAS_DO_HAIKU["tarefas.titulo"],
  "categorias.nome": REGRAS_DO_HAIKU["categorias.nome"],
  "categorias.cor": REGRAS_DO_HAIKU["categorias.cor"],
  "datas.exibicao": REGRAS_DO_HAIKU["datas.exibicao"],
  "exclusao": REGRAS_DO_HAIKU["exclusao"],
  "modulos.independencia":
    // "e testes próprios" saiu (§129): vai para as regras "testes.", abaixo.
    "Os módulos tarefas, categorias e anotacoes não possuem chaves estrangeiras, consultas, rotas, componentes ou serviços que referenciem outro módulo, e cada um tem rotas, componentes e serviços próprios.",
  "arquivos.compartilhados": "A fundação compartilhada (servidor, conexão com o banco, cliente da API, layout e navegação) não é alterada por fase de módulo nenhuma.",
  "interface.tema": "Cores, espaçamentos e tipografia são definidos uma vez e usados por todos os componentes. Nenhum módulo define paleta própria.",
  "interface.navegacao": "A aplicação tem exatamente as rotas /, /tarefas, /categorias e /anotacoes. A sidebar contém links para Início, Tarefas, Categorias e Anotações e destaca a rota atual.",
  "interface.responsividade": REGRAS_DO_HAIKU["interface.responsividade"],
};

const regras = (fonte: Record<string, string>) => Object.entries(fonte).map(([subject, statement]) => ({ subject, statement }));

const STACK_DO_HAIKU = [
  { component: "Linguagem", decision: "TypeScript 5.9 em modo estrito, no servidor e na interface" },
  { component: "Backend", decision: "Express 5 servindo API REST em JSON sob o prefixo /api" },
  { component: "Banco de dados", decision: "SQLite em arquivo via better-sqlite3, com SQL escrito à mão e sem ORM" },
  { component: "Interface", decision: "React 19 com React Router 7 em modo biblioteca, com as rotas declaradas em um único arquivo" },
  {
    component: "Estrutura de pastas",
    decision:
      "server/nucleo (fundação do servidor); server/modulos/<modulo> (rotas, serviços e repositório de cada módulo); src/nucleo (cliente da API, notificações, componentes compartilhados, formatação e tema); src/casca (layout, sidebar e tabela de rotas); src/modulos/<modulo> (página e componentes de cada módulo)",
  },
];

/** O esqueleto da fixture da pousada, com a stack e as regras do Haiku no lugar das dela. */
function esqueletoCom(extras: { stack?: unknown[]; rules?: unknown[]; phases?: unknown[]; stories?: unknown[] }): string {
  return JSON.stringify({ ...JSON.parse(SKELETON), ...extras });
}

/**
 * O isolamento do banco dos testes, como o escritor o devolve corrigido. Até a
 * §128 era a regra "banco.isolamento-de-testes"; desde a §129 o pedido de
 * testes vai em regras de assunto "testes.", que o build lê e o plano não.
 */
const REGRAS_DE_TESTE_CORRIGIDAS = [
  { subject: "testes.modulos", statement: "Cada módulo tem os seus próprios testes." },
  { subject: "testes.banco", statement: "Os testes automatizados usam um banco isolado dos dados normais da aplicação, e nunca o banco configurado para uso normal." },
];

const CONTAMINADO = esqueletoCom({ stack: STACK_DO_HAIKU, rules: regras(REGRAS_DO_HAIKU) });
const LIMPO = esqueletoCom({ stack: STACK_DO_HAIKU.slice(0, 4), rules: [...regras(REGRAS_CORRIGIDAS), ...REGRAS_DE_TESTE_CORRIGIDAS] });

const LIMITES = { maxTasksPerPhase: 15 };

describe("I-17 — a checagem determinística de mecanismo sem autoridade", () => {
  it("reconhece variável de ambiente, caminho, arquivo de código, comando, DDL e chamada de função", () => {
    expect(mechanismPrescriptions("o caminho vem da variável de ambiente APP_DB_PATH; os testes definem E2E_PORT")).toEqual(["APP_DB_PATH", "E2E_PORT"]);
    expect(mechanismPrescriptions("escuta na porta definida pela variável PORT, com padrão 3000")).toEqual(["PORT"]);
    expect(mechanismPrescriptions("pelo cliente compartilhado em src/nucleo/api.ts")).toEqual(["src/nucleo/api.ts"]);
    expect(mechanismPrescriptions("ocupa somente server/modulos/<modulo>/ e a página em src/modulos/<modulo>/Pagina<Modulo>.tsx")).toEqual([
      "server/modulos/<modulo>/",
      "src/modulos/<modulo>/Pagina<Modulo>.tsx",
    ]);
    expect(mechanismPrescriptions("sem a variável, o caminho é data/parallel-lab.db, relativo à raiz")).toEqual(["data/parallel-lab.db"]);
    expect(mechanismPrescriptions("entrega o index.html e o main.tsx mínimos")).toEqual(["main.tsx"]);
    expect(mechanismPrescriptions("o esquema é criado por npm run migrar antes de subir; php artisan migrate também")).toEqual(["npm run migrar", "php artisan migrate"]);
    expect(mechanismPrescriptions("são criadas com CREATE TABLE IF NOT EXISTS antes de o servidor aceitar requisições")).toEqual(["CREATE TABLE IF NOT EXISTS"]);
    expect(mechanismPrescriptions("abrirBanco() cria o esquema e registrarRotas(app) monta os módulos; o módulo escreve router.get('/')")).toEqual([
      "abrirBanco()",
      "registrarRotas(app)",
      "router.get('/')",
    ]);
  });

  it("não toca a regra escrita como comportamento, nem as rotas, as datas, os plurais e as cores", () => {
    expect(mechanismPrescriptions("Os dados dos três módulos persistem em um banco SQLite local e permanecem disponíveis após reiniciar a aplicação.")).toEqual([]);
    expect(mechanismPrescriptions(REGRAS_DO_HAIKU["api.prefixo-e-rotas"])).toEqual([]);
    expect(mechanismPrescriptions(REGRAS_DO_HAIKU["datas.exibicao"])).toEqual([]);
    expect(mechanismPrescriptions(REGRAS_DO_HAIKU["exclusao"])).toEqual([]);
    expect(mechanismPrescriptions(REGRAS_DO_HAIKU["categorias.cor"])).toEqual([]);
    expect(mechanismPrescriptions(REGRAS_DO_HAIKU["tarefas.titulo"])).toEqual([]);
    expect(mechanismPrescriptions("Como avaliador, quero iniciar, compilar e testar a aplicação por comandos documentados (US-0.4), com ISO 8601 em UTC e e/ou em 24/7")).toEqual([]);
    // As regras que o próprio harness escreve a partir da decisão de banco passam na mesma checagem.
    for (const decisao of ["embutido", "informado", "instalado"] as const) {
      for (const regra of regrasDeBanco(decisao)) expect(mechanismPrescriptions(`${regra.subject}\n${regra.statement}`), regra.subject).toEqual([]);
    }
  });

  it("o pedido e a entrevista são a autoridade: o que eles nomeiam não é prescrição do esqueleto", () => {
    const pedido = ["o banco é apontado pela variável DATABASE_URL; a interface monta em src/main.tsx; migre com npm run migrate"];
    expect(mechanismPrescriptions("lido de DATABASE_URL, montado em src/main.tsx, esquema por npm run migrate", pedido)).toEqual([]);
    expect(mechanismPrescriptions("lido de DATABASE_URL e de APP_DB_PATH", pedido)).toEqual(["APP_DB_PATH"]);
  });
});

describe("I-17 no esqueleto: o que o Haiku escreveu volta nomeado; o que é produto fica", () => {
  it("as regras com mecanismo são defeito, com os termos; as regras de produto não são citadas", () => {
    const lido = parseSkeleton(CONTAMINADO, LIMITES);
    expect(lido.ok).toBe(false);
    if (lido.ok) return;
    const problemas = lido.defects.map((defeito) => defeito.problem).join("\n");
    for (const assunto of ["banco.arquivo", "banco.isolamento-de-testes", "servidor.porta", "api.cliente", "modulos.independencia", "arquivos.compartilhados", "interface.tema", "interface.navegacao"]) {
      expect(problemas, assunto).toContain(`a regra "${assunto}" fixa mecanismo`);
    }
    for (const assunto of ["banco.persistencia", "api.prefixo-e-rotas", "tarefas.titulo", "categorias.nome", "categorias.cor", "datas.exibicao", "exclusao", "interface.responsividade"]) {
      expect(problemas, assunto).not.toContain(`"${assunto}"`);
    }
    const doBanco = lido.defects.find((defeito) => defeito.problem.includes('"banco.arquivo"'));
    expect(doBanco?.problem).toContain("APP_DB_PATH");
    expect(doBanco?.problem).toContain("CREATE TABLE IF NOT EXISTS");
    expect(doBanco?.problem).toContain("data/parallel-lab.db");
    expect(doBanco?.hint).toContain("decisão do plano");
    expect(lido.defects.find((defeito) => defeito.problem.includes('"servidor.porta"'))?.problem).toContain("E2E_PORT");
  });

  it("a entrada de stack que é estrutura de pastas sai contando; a stack pedida fica inteira", () => {
    const soAStack = esqueletoCom({ stack: STACK_DO_HAIKU });
    const lido = parseSkeleton(soAStack, LIMITES);
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
    if (!lido.ok) return;
    expect(lido.skeleton.stack.map((item) => item.component)).toEqual(["Linguagem", "Backend", "Banco de dados", "Interface"]);
    expect(lido.applied.join("\n")).toContain('removeu da stack "Estrutura de pastas');
  });

  it("a fase preliminar não congela arquivo nem mecanismo de integração; a entrega funcional passa", () => {
    const fases = JSON.parse(SKELETON).phases as Record<string, unknown>[];
    const congelada = esqueletoCom({
      phases: [{ ...fases[0], goal: "Servidor de pé que entrega o index.html e o src/main.tsx mínimos e registra os módulos por registrarRotas(app)" }, fases[1]],
    });
    const lido = parseSkeleton(congelada, LIMITES);
    expect(lido.ok).toBe(false);
    if (!lido.ok) {
      const defeito = lido.defects.find((d) => d.problem.includes("a fase 1 fixa mecanismo"));
      expect(defeito?.problem).toContain("src/main.tsx");
      expect(defeito?.problem).toContain("registrarRotas(app)");
    }
    const funcional = esqueletoCom({
      phases: [{ ...fases[0], goal: "Fundação compartilhada: banco local persistente com as três tabelas, servidor que responde sob /api e casca da interface com navegação" }, fases[1]],
    });
    expect(parseSkeleton(funcional, LIMITES).ok).toBe(true);
  });

  it("a reescrita como comportamento passa e conserva SQLite; o pedido de testes vai numa regra \"testes.\", nunca numa story (§129)", () => {
    const pedidoDeTestes = "Como avaliador, quero que cada módulo tenha testes automatizados próprios, aprovados contra um banco isolado dos dados normais.";
    const naStory = esqueletoCom({
      stack: STACK_DO_HAIKU.slice(0, 4),
      rules: regras(REGRAS_CORRIGIDAS),
      stories: [...(JSON.parse(SKELETON).stories as unknown[]), { id: "US-0.4", statement: pedidoDeTestes }],
    });
    const comStory = parseSkeleton(naStory, LIMITES);
    expect(comStory.ok).toBe(false);
    if (!comStory.ok) expect(comStory.defects.map((d) => d.problem).join(" ")).toContain("a story US-0.4 carrega o pedido de testes para o plano");

    const comRegra = [...regras(REGRAS_CORRIGIDAS), ...REGRAS_DE_TESTE_CORRIGIDAS, { subject: "testes.avaliador", statement: pedidoDeTestes }];
    const lido = parseSkeleton(esqueletoCom({ stack: STACK_DO_HAIKU.slice(0, 4), rules: comRegra }), LIMITES);
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
    if (!lido.ok) return;
    expect(lido.tolerated).toEqual([]);
    expect(lido.skeleton.rules.map((regra) => regra.statement).join("\n")).toContain("SQLite");
    expect(lido.skeleton.rules.find((regra) => regra.subject === "testes.avaliador")?.statement).toBe(pedidoDeTestes);
  });

  it("o requisito explicitamente técnico do pedido continua autorizado", () => {
    const autoridade = [`${PEDIDO}\nO banco é apontado pela variável APP_DB_PATH e o esquema é criado por npm run migrate.`];
    // O pedido do Parallel Lab exige testes: o esqueleto os guarda numa regra "testes." (§129).
    const regra = esqueletoCom({ rules: [{ subject: "banco", statement: "o caminho vem de APP_DB_PATH e o esquema é criado por npm run migrate antes de o servidor subir" }, ...REGRAS_DE_TESTE_CORRIGIDAS] });
    expect(parseSkeleton(regra, { ...LIMITES, authority: autoridade }).ok).toBe(true);
    expect(parseSkeleton(regra, LIMITES).ok).toBe(false);
  });

  it("tolerado, o mecanismo não derruba a leitura: volta nomeado em `tolerated`", () => {
    const lido = parseSkeleton(CONTAMINADO, { ...LIMITES, mechanisms: "tolerate" });
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;
    expect(lido.tolerated.join("\n")).toContain("banco.arquivo");
    expect(lido.tolerated.join("\n")).toContain("APP_DB_PATH");
    expect(lido.skeleton.rules.some((regra) => regra.subject === "banco.arquivo")).toBe(true);
  });

  it("I-16 continua: ferramenta e arquivo de teste numa regra ainda são defeito, também na regra de testes", () => {
    const comVitest = esqueletoCom({ rules: [{ subject: "testes", statement: "a suíte roda com Vitest a partir de vitest.config.ts" }] });
    const lido = parseSkeleton(comVitest, LIMITES);
    expect(lido.ok).toBe(false);
    if (!lido.ok) expect(lido.defects.map((d) => d.problem).join(" ")).toContain('a regra "testes" prescreve teste');
    // A condição da suíte, que até a §128 era requisito do plano, desde a §129 é o pedido de testes.
    expect(testPrescriptions("os testes rodam contra um banco isolado")).not.toEqual([]);
  });
});

describe("a regra do harness sobre a migração diz o que os gates precisam, e deixa o resto ao plano", () => {
  it("não proíbe aplicar o esquema fora do comando; nomeia o script que o build roda", () => {
    for (const decisao of ["embutido", "informado", "instalado"] as const) {
      const migracao = regrasDeBanco(decisao).find((regra) => regra.subject === "comando de migração");
      expect(migracao, decisao).toBeDefined();
      expect(migracao?.statement).not.toContain("proibido");
      expect(migracao?.statement).toContain("comando único de migração");
      expect(migracao?.statement).toContain("banco vazio");
      expect(migracao?.statement).toContain("repetido sem erro");
      expect(migracao?.statement).toContain("`migrate`");
      expect(migracao?.statement).toContain("decisão do plano");
    }
  });
});

describe("os prompts escrevem a fronteira", () => {
  const contexto = { language: "português do Brasil", request: PEDIDO, decisions: [], assumptions: [], inventory: "vazio", maxTasksPerPhase: 15, maxCriteriaPerTask: 5 };

  it("o esqueleto descreve o produto e deixa a implementação ao arquiteto; E2E_PORT não entra nele", () => {
    const prompt = skeletonPrompt(contexto);
    expect(prompt).not.toContain("E2E_PORT");
    expect(prompt).not.toContain("ONLY time anyone looks at the whole product at once");
    expect(prompt).toContain("## Product, not implementation");
    expect(prompt).toContain("architect");
    expect(prompt).toContain("preliminary");
    // O contrato de interface que o build lê continua vindo daqui (§116 ainda não moveu o build para architecture.md).
    expect(prompt).toContain("complete API endpoints");
  });

  it("a entrevista do esqueleto não pergunta como implementar; a de lacunas não muda", () => {
    const writer = { language: "português do Brasil", request: PEDIDO, decisions: [], assumptions: [], upstream: [] };
    expect(interviewPrompt("skeleton", writer, "vazio", [])).toContain("Never ask how the product will be implemented");
    expect(interviewPrompt("project-phases.md", writer, "vazio", [])).not.toContain("Never ask how the product will be implemented");
    expect(gapPrompt("skeleton", writer, ["x"])).not.toContain("Never ask how the product will be implemented");
  });

  it("o arquiteto e o auditor da arquitetura leem o mecanismo sem autoridade como escolha deles, e as regras do banco como requisito", () => {
    const arquiteto = architectPrompt({ ...contexto, skeleton: "# esqueleto" });
    const auditor = architectureAuditPrompt({ language: "português do Brasil", request: PEDIDO, decisions: [], skeleton: "# esqueleto", architecture: "# arq", maxTasksPerPhase: 15 });
    for (const prompt of [arquiteto, auditor]) {
      expect(prompt).toContain("A skeleton rule that fixes HOW");
      expect(prompt).toContain("never a contradiction to escalate");
      expect(prompt).toContain("`.env.example`");
      expect(prompt).toContain("migration command");
    }
  });
});

/* ---------- o laço do esqueleto, com o provider falso ---------- */

const skeletonCalls = (agent: { calls: AgentCall[] }) => agent.calls.filter((call) => call.stage === "authoring" && call.subject === "skeleton");

async function init(steps: ScriptStep[], extras: { ask?: (question: Question) => Promise<string> } = {}) {
  const dito: string[] = [];
  const agent = fakeAgent(steps);
  const outcome = await runInit({
    projectRoot,
    request,
    language: "português do Brasil",
    stage: "init",
    call: agent.call,
    ask: extras.ask ?? responde,
    announce: (linha) => void dito.push(linha),
  });
  const esqueleto = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8").catch(() => "");
  return { outcome, agent, esqueleto, anunciado: dito.join("\n") };
}

const entrevistaVazia: ScriptStep = { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true };
const escritor = (attempt: number, stdout: string): ScriptStep => ({ match: { role: "writer", stage: "authoring", subject: "skeleton", attempt }, respond: { stdout } });
const reparador = (attempt: number, stdout: string): ScriptStep => ({ match: { role: "auditor", stage: "authoring", subject: "skeleton", attempt }, respond: { stdout } });

describe("o laço do esqueleto: corrigir sem interromper", () => {
  it("o escritor corrige com os termos nomeados: dois escritos, nenhum auditor, e o publicado não tem mecanismo", async () => {
    const { agent, esqueleto, anunciado } = await init([entrevistaVazia, escritor(1, CONTAMINADO), escritor(2, LIMPO)]);
    expect(skeletonCalls(agent).map((call) => call.role)).toEqual(["writer", "writer"]);
    expect(skeletonCalls(agent)[1]?.prompt).toContain("Your previous attempt was rejected");
    expect(skeletonCalls(agent)[1]?.prompt).toContain("CREATE TABLE IF NOT EXISTS");
    expect(esqueleto).not.toContain("CREATE TABLE");
    expect(esqueleto).not.toContain("E2E_PORT");
    expect(esqueleto).not.toContain("src/nucleo");
    expect(esqueleto).not.toContain("Estrutura de pastas");
    expect(esqueleto).toContain("SQLite");
    expect(esqueleto).toContain("banco isolado dos dados normais");
    expect(esqueleto).toContain("comando único de migração");
    expect(esqueleto).not.toContain("proibido");
    expect(esqueleto).toContain("banco descartável");
    expect(anunciado).toContain("mecanismo");
  });

  it("o auditor assume quando o escritor não corrige duas vezes, e o publicado é o dele", async () => {
    const { agent, esqueleto } = await init([entrevistaVazia, escritor(1, CONTAMINADO), escritor(2, CONTAMINADO), reparador(3, LIMPO)]);
    expect(skeletonCalls(agent).map((call) => `${call.role}:${call.attempt}`)).toEqual(["writer:1", "writer:2", "auditor:3"]);
    expect(esqueleto).not.toContain("CREATE TABLE");
    expect(esqueleto).toContain("SQLite");
  });

  it("o resíduo depois da escada não bloqueia: publica com a ressalva no relatório, e o PLAN decide", async () => {
    const { outcome, esqueleto, anunciado } = await init([entrevistaVazia, escritor(1, CONTAMINADO), escritor(2, CONTAMINADO), reparador(3, CONTAMINADO)]);
    expect(outcome.readiness.ready).toBe(true);
    expect(esqueleto).toContain("banco.arquivo");
    expect(outcome.report.remarks.some((entry) => entry.document === "skeleton.md" && entry.remark.observation.includes("APP_DB_PATH"))).toBe(true);
    expect(anunciado).toContain("ressalva");
  });

  it("o caminho limpo não ganha chamada nenhuma", async () => {
    // O pedido do Parallel Lab exige testes; o esqueleto limpo os guarda numa regra "testes." (§129).
    const comRegraDeTeste = esqueletoCom({ rules: [...(JSON.parse(SKELETON).rules as unknown[]), ...REGRAS_DE_TESTE_CORRIGIDAS] });
    const { agent, esqueleto } = await init([
      ...skeletonPath().filter((passo) => passo.match.subject !== "skeleton"),
      { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: comRegraDeTeste }, repeat: true },
    ]);
    expect(skeletonCalls(agent)).toHaveLength(1);
    expect(agent.calls.filter((call) => call.role !== "writer")).toHaveLength(0);
    expect(esqueleto).toContain("Pousada");
  });

  it("a decisão de produto continua sendo perguntada ao desenvolvedor", async () => {
    const perguntadas: Question[] = [];
    const { esqueleto } = await init(
      [
        { match: { role: "writer", stage: "interview", attempt: 1 }, respond: { stdout: oneQuestion("Q-01") } },
        { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
        { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: LIMPO }, repeat: true },
      ],
      { ask: async (question) => { perguntadas.push(question); return "1"; } },
    );
    expect(perguntadas.some((question) => question.id === "Q-01")).toBe(true);
    expect(perguntadas.some((question) => question.id === ID_DO_BANCO)).toBe(true);
    expect(esqueleto).toContain("SQLite");
  });

  it("o PLAN recebe o esqueleto limpo com a fronteira no prompt do arquiteto e chega a RALPH READY", async () => {
    await init([entrevistaVazia, escritor(1, CONTAMINADO), escritor(2, LIMPO)]);
    const agent = fakeAgent(skeletonPath());
    const outcome = await runPlan({
      projectRoot,
      request,
      language: "português do Brasil",
      call: agent.call,
      ask: async () => "1",
      announce: () => undefined,
      sleep: async () => undefined,
    });
    expect(outcome.readiness.ready).toBe(true);
    const arquiteto = agent.calls.find((call) => call.stage === "authoring" && call.subject === "architecture");
    expect(arquiteto?.prompt).toContain("A skeleton rule that fixes HOW");
    expect(arquiteto?.prompt).not.toContain("CREATE TABLE");
    expect(arquiteto?.prompt).toContain("comando único de migração");
    expect(skeletonCalls(agent)).toHaveLength(0);
  });
});
