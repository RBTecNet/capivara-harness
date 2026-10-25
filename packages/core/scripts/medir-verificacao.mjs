#!/usr/bin/env node
/**
 * Quanto a Capivara verifica, em número.
 *
 * Roda os cenários fixos de `test/support/cenarios-de-medicao.ts` — a cadeia
 * init → plan → build com os providers falsos do catálogo — e conta o que ficou
 * nos registros que o harness já grava: `prompts/` (uma por chamada de modelo),
 * `logs/`, `events.tsv`, `evidence.jsonl`, `relatorio.json` e o plano publicado.
 * Nenhum registro novo é criado para isto. O que os falsos viram (chamadas
 * disparadas, suítes, passagens de fluxo) é impresso ao lado, para conferir que
 * o registro conta tudo.
 *
 *   node packages/core/scripts/medir-verificacao.mjs
 *   node packages/core/scripts/medir-verificacao.mjs --json medida.json
 *   node packages/core/scripts/medir-verificacao.mjs --comparar antes.json depois.json [--tudo]
 *   --manter   deixa as pastas dos cenários no disco (o caminho é impresso)
 *
 * O módulo de cenários é TypeScript; o esbuild (já dependência do build) o
 * empacota numa pasta temporária antes de rodar.
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

// ------------------------------------------------------------------ comparar

if (args[0] === "--comparar") {
  const [antes, depois] = await Promise.all(args.slice(1, 3).map(async (caminho) => JSON.parse(await readFile(caminho, "utf8"))));
  if (!antes || !depois) {
    console.error("uso: medir-verificacao.mjs --comparar antes.json depois.json");
    process.exit(1);
  }
  const linhas = [];
  const achatar = (objeto, prefixo = "") =>
    Object.entries(objeto).flatMap(([chave, valor]) =>
      valor !== null && typeof valor === "object" && !Array.isArray(valor) ? achatar(valor, `${prefixo}${chave}.`) : [[`${prefixo}${chave}`, valor]],
    );
  const a = new Map(achatar(antes.numeros));
  const b = new Map(achatar(depois.numeros));
  // O tempo muda a cada rodada; sem --tudo, só aparece o que mudou.
  const tudo = args.includes("--tudo");
  for (const chave of [...new Set([...a.keys(), ...b.keys()])]) {
    const va = a.get(chave);
    const vb = b.get(chave);
    const delta = typeof va === "number" && typeof vb === "number" ? (vb - va > 0 ? `+${vb - va}` : String(vb - va)) : va === vb ? "" : "≠";
    if (!tudo && (va === vb || /\.tempo\./.test(chave))) continue;
    linhas.push([chave, String(va ?? "-"), String(vb ?? "-"), delta]);
  }
  console.log(`antes: ${antes.commit}   depois: ${depois.commit}\n`);
  console.log(tabela(["medida", "antes", "depois", "Δ"], linhas));
  process.exit(0);
}

const manter = args.includes("--manter");
const saidaJson = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

// ------------------------------------------------------------- os cenários

const { build } = createRequire(join(CORE, "package.json"))("esbuild");
const versao = JSON.parse(await readFile(join(CORE, "package.json"), "utf8")).version;
const pastaDoPacote = await mkdtemp(join(tmpdir(), "capivara-medir-"));
const pacote = join(pastaDoPacote, "cenarios.mjs");
await build({
  entryPoints: [join(CORE, "test/support/cenarios-de-medicao.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: pacote,
  define: { __CAPIVARA_VERSION__: JSON.stringify(versao) },
  banner: { js: "import { createRequire as __criar } from 'node:module'; const require = __criar(import.meta.url);" },
  logLevel: "warning",
});
const cenarios = await import(pacote);

const commit = (() => {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: CORE, encoding: "utf8" }).trim();
    const sujo = execFileSync("git", ["status", "--porcelain", "--", "."], { cwd: CORE, encoding: "utf8" }).trim() !== "";
    return sujo ? `${sha}+alterações` : sha;
  } catch {
    return "(sem git)";
  }
})();

// ------------------------------------------------------- leitura dos registros

const RUNS = (raiz) => join(raiz, ".capivara/runs");

async function listar(pasta) {
  return await readdir(pasta).catch(() => []);
}

async function lerEventos(caminho) {
  const texto = await readFile(caminho, "utf8").catch(() => "");
  return texto
    .split("\n")
    .filter((linha) => linha !== "" && !linha.startsWith("timestamp\t") && !linha.startsWith("#"))
    .map((linha) => {
      const [timestamp, stage, subject, attempt, status, detail] = linha.split("\t");
      return { timestamp, stage, subject, attempt: Number(attempt), status, detail: detail ?? "" };
    });
}

/**
 * As chamadas de modelo do `init`/`plan`, uma por prompt gravado. O nome do
 * arquivo é `estágio.assunto.papel.tentativa-repetição.uuid.txt`.
 */
const NOME_DO_PLANO = /^([a-z]+)\.(.+)\.(writer|auditor|verifier)\.(\d+)-(\d+)\.[0-9a-f-]{36}\.txt$/;

/** As segundas chances só de forma: o conteúdo não mudou, o parser recusou a resposta. */
const MARCAS_DE_FORMATO = [
  "## Your previous answer was rejected before it reached the developer",
  "## Repair the previous audit response",
  "## The previous answer left criteria unjudged",
  "## Your previous attempt was rejected",
];

function categoriaDoPlano({ stage, role, attempt, repeticao }, prompt) {
  if (repeticao > 1) return "repetição";
  if (MARCAS_DE_FORMATO.some((marca) => prompt.includes(marca))) return "formato";
  if (role === "writer") return attempt > 1 && stage === "authoring" ? "reparo" : "escrita";
  if (role === "auditor") return stage === "authoring" ? "reparo" : "auditoria";
  // verifier: o ensaio é verificação; no estágio de auditoria ele tria a materialidade ou valida o reparo do auditor.
  return stage === "verify" ? "verificação" : "auditoria";
}

/**
 * As chamadas do `build`, pelo nome do prompt que o runner grava para cada uma.
 * A passagem entra no nome (`verify-1`, `verify-1-after-repair-1`), e o que é
 * gravado sem sobrescrever ganha `.2`, `.3` antes da extensão.
 */
const PASSAGEM = String.raw`[\w-]+`;
const UNICO = String.raw`(?:\.\d+)?`;
const UUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
const NOMES_DO_BUILD = [
  [new RegExp(String.raw`\.cycle-1${UNICO}\.txt$`), "escrita", "builder"],
  [new RegExp(String.raw`\.part-\d+-of-\d+${UNICO}\.txt$`), "escrita", "builder"],
  [new RegExp(String.raw`\.cycle-\d+${UNICO}\.txt$`), "reparo", "builder"],
  [new RegExp(String.raw`\.verify-${PASSAGEM}\.format-\d+${UNICO}\.txt$`), "formato", "verifier"],
  [new RegExp(String.raw`\.verify-${PASSAGEM}(?:\.session-\d+)?${UNICO}\.txt$`), "verificação", "verifier"],
  [new RegExp(String.raw`\.repair-\d+-cycle-\d+${UNICO}\.txt$`), "reparo", "verifier"],
  [new RegExp(String.raw`\.flow-.+-${UUID}\.txt$`), "roteirista", "verifier"],
  [new RegExp(String.raw`\.triagem-${PASSAGEM}-\d+${UNICO}\.txt$`), "triagem", "verifier"],
  [new RegExp(String.raw`\.guidance${UNICO}\.txt$`), "reparo", "verifier"],
];
const LOG_DA_SUITE = new RegExp(String.raw`\.g2-${PASSAGEM}${UNICO}\.log$|^entrega\.suite-.+\.log$`);
const LOG_DO_FLUXO = new RegExp(String.raw`\.flow-run-${PASSAGEM}${UNICO}\.log$`);

const CATEGORIAS = ["escrita", "auditoria", "verificação", "reparo", "roteirista", "triagem", "formato", "repetição", "outra"];

function zerado() {
  return Object.fromEntries(CATEGORIAS.map((categoria) => [categoria, 0]));
}

async function medirCenario(resultado) {
  const raiz = resultado.projectRoot;
  const runs = await listar(RUNS(raiz));
  const runInit = runs.find((nome) => nome.startsWith("init-"));
  const runBuild = runs.find((nome) => nome.startsWith("build-"));
  const chamadas = { init: zerado(), plan: zerado(), build: zerado() };
  const porPapel = {};
  const contar = (estagio, categoria, papel) => {
    chamadas[estagio][categoria] += 1;
    porPapel[`${papel} (${estagio})`] = (porPapel[`${papel} (${estagio})`] ?? 0) + 1;
  };

  // init e plan dividem o run: o que foi gravado até o PLAN READY é do init.
  let planReady = Infinity;
  let devolucoes = 0;
  let reescritas = 0;
  if (runInit) {
    const pasta = join(RUNS(raiz), runInit);
    const eventos = await lerEventos(join(pasta, "events.tsv"));
    const marco = eventos.find((evento) => evento.stage === "ready" && evento.detail === "PLAN READY");
    if (marco) planReady = Date.parse(marco.timestamp);
    for (const nome of await listar(join(pasta, "prompts"))) {
      const partes = NOME_DO_PLANO.exec(nome);
      const gravado = (await stat(join(pasta, "prompts", nome))).mtimeMs;
      const estagio = gravado <= planReady ? "init" : "plan";
      if (!partes) {
        contar(estagio, "outra", "?");
        continue;
      }
      const [, stage, , role, attempt, repeticao] = partes;
      const prompt = await readFile(join(pasta, "prompts", nome), "utf8");
      const categoria = categoriaDoPlano({ stage, role, attempt: Number(attempt), repeticao: Number(repeticao) }, prompt);
      contar(estagio, categoria, role);
      if (categoria === "reparo" && role === "writer") reescritas += 1;
      if (role === "auditor" && stage === "audit") {
        const resposta = await readFile(join(pasta, "logs", nome.replace(/\.txt$/, ".log")), "utf8").catch(() => "");
        if (/CAPIVARA_AUDIT_STATUS:\s*REJECTED/.test(resposta)) devolucoes += 1;
      }
    }
  }

  const execucoes = { suite: 0, g3: 0, g4: 0, aceitacao: 0, reparosDaAceitacao: 0 };
  let relatorio = null;
  if (runBuild) {
    const pasta = join(RUNS(raiz), runBuild);
    for (const nome of await listar(join(pasta, "prompts"))) {
      const regra = NOMES_DO_BUILD.find(([padrao]) => padrao.test(nome));
      contar("build", regra?.[1] ?? "outra", regra?.[2] ?? "?");
      if (regra?.[1] === "verificação") execucoes.g3 += 1;
    }
    // O reparo da aceitação chama o executor sem gravar prompt: o evento é o registro dele.
    const eventos = await lerEventos(join(pasta, "events.tsv"));
    execucoes.reparosDaAceitacao = eventos.filter((evento) => evento.stage === "validate" && evento.subject === "aceitação" && evento.status === "retry").length;
    chamadas.build.reparo += execucoes.reparosDaAceitacao;
    if (execucoes.reparosDaAceitacao > 0) porPapel["builder (build)"] = (porPapel["builder (build)"] ?? 0) + execucoes.reparosDaAceitacao;
    for (const nome of await listar(join(pasta, "logs"))) {
      if (LOG_DA_SUITE.test(nome)) execucoes.suite += 1;
      if (LOG_DO_FLUXO.test(nome)) execucoes.g4 += 1;
    }
    relatorio = JSON.parse(await readFile(join(pasta, "relatorio.json"), "utf8").catch(() => "null"));
  }
  // A aceitação que passa não deixa registro próprio no run: a contagem é a do runner falso.
  execucoes.aceitacao = resultado.observado.aceitacao.filter((comando) => /install/.test(comando)).length;

  const plano = await readFile(join(raiz, ".capivara/init/project-phases.md"), "utf8").catch(() => "");
  const total = (estagio) => Object.values(chamadas[estagio]).reduce((soma, valor) => soma + valor, 0);
  return {
    nome: resultado.nome,
    raiz,
    runBuild,
    chamadas,
    porPapel,
    conferencia: {
      registradasNoPlano: total("init") + total("plan"),
      disparadasNoPlano: resultado.observado.chamadasDoPlano.length,
      registradasNoBuild: total("build"),
      disparadasNoBuild: resultado.observado.chamadasDoBuild.length,
      suitesDisparadas: resultado.observado.suites,
      fluxosDisparados: resultado.observado.fluxos.length,
    },
    execucoes,
    plano: { fases: contarFases(plano), tasks: contarTasks(plano), criterios: contarCriterios(plano), devolucoes, reescritas },
    duracoes: resultado.observado.duracoes,
    relatorio,
    build: resultado.build ? { exitCode: resultado.build.exitCode, fases: resultado.build.phases.map((fase) => [fase.id, fase.outcome.status, fase.outcome.gate ?? ""]) } : null,
    planoPronto: resultado.plan?.readiness.ready === true,
  };
}

const contarFases = (plano) => [...plano.matchAll(/^## Phase \d+:/gm)].length;
const contarTasks = (plano) => [...plano.matchAll(/^- \[[ x]\] \*\*Task:\*\*/gm)].length;

/** Os critérios: as linhas de item sob cada `**Acceptance criteria:**`, até o próximo campo da task. */
function contarCriterios(plano) {
  let dentro = false;
  let total = 0;
  for (const linha of plano.split("\n")) {
    if (/^\s*- \*\*Acceptance criteria:\*\*/.test(linha)) {
      dentro = true;
      continue;
    }
    if (dentro && /^\s{4,}- /.test(linha)) total += 1;
    else if (dentro && linha.trim() !== "") dentro = false;
  }
  return total;
}

// ---------------------------------------------- o que os prompts exigem de teste

/**
 * As obrigações de teste por critério no prompt do executor, com quantos
 * testes cada uma exige. A frase entra aqui quando existe; o script imprime
 * também toda linha do prompt que fala de teste e de critério juntos, para que
 * uma obrigação nova, escrita com outras palavras, não passe calada.
 */
const OBRIGACOES_DE_TESTE = [{ padrao: /positive and negative test cases/i, testes: 2, nome: "par positivo/negativo por critério" }];
const PROVA_DO_MODO_DE_FALHA = /test must assert the behaviou?r and failure mode/i;
const DESCONFIANCA_DA_SUITE = /green suite is not proof/i;

async function exigenciasDeTeste(medida) {
  const pasta = join(RUNS(medida.raiz), medida.runBuild ?? "-", "prompts");
  const nomes = await listar(pasta);
  const doExecutor = nomes.find((nome) => /^P01\.(cycle-1|part-1-of-\d+)\.txt$/.test(nome));
  const doVerificador = nomes.find((nome) => /^P01\.verify-1\.txt$/.test(nome));
  const executor = doExecutor ? await readFile(join(pasta, doExecutor), "utf8") : "";
  const verificador = doVerificador ? await readFile(join(pasta, doVerificador), "utf8") : "";
  const linhas = executor.split("\n");
  const obrigacoes = OBRIGACOES_DE_TESTE.flatMap((obrigacao) => {
    const linha = linhas.find((cada) => obrigacao.padrao.test(cada));
    return linha ? [{ ...obrigacao, linha: linha.trim() }] : [];
  });
  return {
    prompts: { executor: doExecutor ?? "(nenhum)", verificador: doVerificador ?? "(nenhum)" },
    testesPorCriterio: obrigacoes.reduce((soma, obrigacao) => soma + obrigacao.testes, 0),
    obrigacoes,
    modoDeFalha: linhas.find((linha) => PROVA_DO_MODO_DE_FALHA.test(linha))?.trim() ?? null,
    desconfiancaDaSuite: verificador.split("\n").find((linha) => DESCONFIANCA_DA_SUITE.test(linha))?.trim() ?? null,
    mencoes: linhas.filter((linha) => /\btests?\b/i.test(linha) && /criteri/i.test(linha)).map((linha) => linha.trim()),
  };
}

// ------------------------------------------------------- linhas de código

/**
 * Os dois grupos, arquivo por arquivo. A fronteira é julgamento, e por isso a
 * lista é explícita e impressa: "verificação" é o que confere, julga ou revisa
 * o trabalho de outro papel; "construção" é o que entrevista, escreve o plano,
 * implementa ou prepara o ambiente. Os orquestradores fazem os dois e ficam
 * como "misto"; providers, estado, interface e comandos ficam fora.
 */
const VERIFICACAO = [
  "src/audit/authority.ts", "src/audit/coherence.ts", "src/audit/cycle.ts", "src/audit/envelope.ts", "src/audit/index.ts",
  "src/audit/materiality.ts", "src/audit/protocol.ts", "src/audit/sem-teste.ts", "src/audit/tasks.ts",
  "src/prompts/auditor.ts", "src/prompts/rehearsal.ts", "src/prompts/verifier.ts", "src/prompts/flows.ts", "src/prompts/triagem.ts",
  "src/prompts/repair.ts", "src/prompts/acceptance-policy.ts", "src/prompts/test-policy.ts",
  "src/contract/coverage.ts", "src/contract/disponibilidade.ts", "src/contract/drift.ts", "src/contract/invariants.ts",
  "src/contract/mechanism-prescription.ts", "src/contract/ownership.ts", "src/contract/phase-references.ts",
  "src/contract/test-prescription.ts", "src/contract/protocolo.ts", "src/contract/upstream.ts",
  "src/init/readiness.ts", "src/init/plan-readiness.ts", "src/init/plan-cache.ts",
  "src/loop/gates.ts", "src/loop/flows.ts", "src/loop/flow-network.ts", "src/loop/passagem.ts", "src/loop/acceptance.ts",
  "src/loop/evidencias.ts", "src/loop/defeitos.ts", "src/loop/veredictos.ts", "src/loop/impacto.ts", "src/loop/handoff.ts",
  "src/loop/teste-declarado.ts", "src/loop/testcmd.ts", "src/loop/test-databases.ts", "src/loop/upstream.ts",
  "src/loop/relatorio.ts", "src/loop/entrega.ts", "src/loop/parada.ts", "src/loop/narrador.ts", "src/loop/ledger.ts",
  "src/provider/flow-review.ts",
];
const CONSTRUCAO = [
  "src/interview/banco.ts", "src/interview/classify.ts", "src/interview/handoff.ts", "src/interview/index.ts", "src/interview/insistencia.ts",
  "src/interview/levantamento.ts", "src/interview/omissions.ts", "src/interview/protocol.ts", "src/interview/rounds.ts", "src/interview/types.ts",
  "src/authoring/index.ts", "src/authoring/ledger.ts", "src/authoring/parts.ts", "src/authoring/repair.ts", "src/authoring/staging.ts",
  "src/prompts/writer.ts", "src/prompts/skeleton.ts", "src/prompts/architecture.ts", "src/prompts/amend.ts", "src/prompts/builder.ts",
  "src/prompts/language.ts", "src/prompts/planning-scope.ts", "src/prompts/index.ts",
  "src/contract/skeleton.ts", "src/contract/phases.ts", "src/contract/architecture.ts", "src/contract/phase-part.ts", "src/contract/templates.ts",
  "src/contract/doc.ts", "src/contract/stamps.ts", "src/contract/environment.ts", "src/contract/resposta.ts", "src/contract/index.ts",
  "src/init/architecture-state.ts", "src/init/index.ts", "src/init/inventory.ts", "src/init/plan.ts", "src/init/progress.ts", "src/init/report.ts",
  "src/init/request-state.ts", "src/init/request.ts", "src/init/skeleton-state.ts",
  "src/loop/split.ts", "src/loop/partes.ts", "src/loop/arquitetura.ts", "src/loop/worktree.ts", "src/loop/paralelo.ts", "src/loop/escalonador.ts",
  "src/loop/escolha.ts", "src/loop/git.ts", "src/loop/admissao.ts", "src/loop/autoridade.ts", "src/loop/isolamento.ts", "src/loop/ambiente.ts",
  "src/loop/environment-plan.ts", "src/loop/environment-prepare.ts", "src/loop/prerequisites.ts", "src/loop/prerequisite-workspace.ts",
  "src/loop/prepared-dependencies.ts", "src/loop/dependencias.ts", "src/loop/instalacao-node.ts", "src/loop/preflight.ts", "src/loop/ports.ts",
  "src/loop/readiness-probe.ts", "src/loop/ratelimit.ts", "src/loop/progress.ts", "src/loop/index.ts",
];
const MISTO = ["src/init/orchestrator.ts", "src/loop/runner.ts", "src/loop/build.ts"];

async function linhasDeCodigo() {
  const todos = [];
  const andar = async (pasta) => {
    for (const nome of await readdir(join(CORE, pasta), { withFileTypes: true })) {
      const caminho = `${pasta}/${nome.name}`;
      if (nome.isDirectory()) await andar(caminho);
      else if (nome.name.endsWith(".ts")) todos.push(caminho);
    }
  };
  await andar("src");
  const linhas = async (arquivo) => (await readFile(join(CORE, arquivo), "utf8").catch(() => "")).split("\n").length - 1;
  const grupo = async (lista) => {
    const existentes = lista.filter((arquivo) => todos.includes(arquivo));
    const arquivos = await Promise.all(existentes.map(async (arquivo) => [arquivo, await linhas(arquivo)]));
    return { total: arquivos.reduce((soma, [, n]) => soma + n, 0), arquivos };
  };
  const classificados = new Set([...VERIFICACAO, ...CONSTRUCAO, ...MISTO]);
  return {
    verificacao: await grupo(VERIFICACAO),
    construcao: await grupo(CONSTRUCAO),
    misto: await grupo(MISTO),
    fora: await grupo(todos.filter((arquivo) => !classificados.has(arquivo)).sort()),
  };
}

// ------------------------------------------------------------- impressão

function tabela(cabecalho, linhas) {
  const larguras = cabecalho.map((titulo, coluna) => Math.max(titulo.length, ...linhas.map((linha) => String(linha[coluna]).length)));
  const formatar = (linha) => linha.map((celula, coluna) => (coluna === 0 ? String(celula).padEnd(larguras[coluna]) : String(celula).padStart(larguras[coluna]))).join("  ");
  return [formatar(cabecalho), ...linhas.map(formatar)].join("\n");
}

const ESTAGIOS = ["init", "plan", "build"];

function imprimirCenario(medida) {
  const linhas = CATEGORIAS.map((categoria) => [categoria, ...ESTAGIOS.map((estagio) => medida.chamadas[estagio][categoria]), ESTAGIOS.reduce((soma, estagio) => soma + medida.chamadas[estagio][categoria], 0)]);
  const totais = ESTAGIOS.map((estagio) => Object.values(medida.chamadas[estagio]).reduce((soma, valor) => soma + valor, 0));
  linhas.push(["total", ...totais, totais.reduce((soma, valor) => soma + valor, 0)]);
  const c = medida.conferencia;
  const bate = (registrado, disparado) => (registrado === disparado ? "confere" : `DIVERGE (${registrado} no registro, ${disparado} disparadas)`);
  return [
    `### ${medida.nome}`,
    "",
    tabela(["chamadas de modelo", ...ESTAGIOS, "total"], linhas),
    "",
    `por papel: ${Object.entries(medida.porPapel).map(([papel, n]) => `${papel} ${n}`).join(" · ")}`,
    `conferência com os falsos: init+plan ${bate(c.registradasNoPlano, c.disparadasNoPlano)}; build ${bate(c.registradasNoBuild, c.disparadasNoBuild)}`,
    "",
    tabela(
      ["execuções", "registro", "disparadas"],
      [
        ["suíte (G2 e entrega)", medida.execucoes.suite, c.suitesDisparadas],
        ["G3 (sessões do verificador)", medida.execucoes.g3, "-"],
        ["G4 (passagens de fluxo)", medida.execucoes.g4, c.fluxosDisparados],
        ["aceitação operacional", "-", medida.execucoes.aceitacao],
        ["reparos da aceitação", medida.execucoes.reparosDaAceitacao, "-"],
      ],
    ),
    "",
    `plano: ${medida.plano.fases} fase(s), ${medida.plano.tasks} task(s), ${medida.plano.criterios} critério(s); ${medida.plano.devolucoes} devolução(ões) da auditoria; ${medida.plano.reescritas} reescrita(s) do escritor${medida.planoPronto ? "" : " — o plano NÃO ficou pronto"}`,
    `tempo (ms): ${ESTAGIOS.map((estagio) => `${estagio} ${medida.duracoes[estagio] ?? "-"}`).join(" · ")}`,
    medida.build
      ? `build: código ${medida.build.exitCode}; ${medida.build.fases.map(([id, status, gate]) => `${id} ${status}${gate ? ` (${gate})` : ""}`).join(", ")}; relatório: ${medida.relatorio?.status ?? "-"}`
      : "build: não rodou",
    "",
  ].join("\n");
}

/** O nome do registro, dito como o mecanismo que o gravou (sem o uuid, que muda a cada rodada). */
function mecanismo(registroComUuid) {
  const registro = registroComUuid.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "…");
  if (/\.verify-/.test(registro)) return `G3, verificação da fase (${registro})`;
  if (/\.flow-run-/.test(registro)) return `G4, fluxo na aplicação de pé (${registro})`;
  if (/\.triagem-/.test(registro)) return `triagem do G4 (${registro})`;
  if (/^audit\.project-phases\.md-P(\d+)\./.test(registro)) return `auditoria da fase P${/-P(\d+)\./.exec(registro)[1]} (${registro})`;
  if (/^audit\.project-phases\.md-coer/.test(registro)) return `auditoria de coerência (${registro})`;
  if (/^audit\.project-phases\.md\.auditor\./.test(registro)) return `auditoria do plano inteiro (${registro})`;
  if (registro === "") return "(nenhum registro com o achado)";
  return registro;
}

// --------------------------------------------------------------------- rodar

const inicio = performance.now();
const nomes = [
  ["cenarioAppPequeno", "app-pequeno"],
  ["cenarioReparo", "reparo"],
  ["cenarioOrcamentoEsgotado", "orcamento-esgotado"],
];
const medidas = [];
const pastas = [];
for (const [funcao] of nomes) {
  const resultado = await cenarios[funcao]();
  pastas.push(resultado.projectRoot);
  medidas.push(await medirCenario(resultado));
}
const garantias = [];
for (const funcao of ["garantiaG1", "garantiaG2", "garantiaG3", "garantiaG4"]) {
  const garantia = await cenarios[funcao]();
  pastas.push(garantia.cenario.projectRoot);
  garantias.push({ ...garantia, medida: await medirCenario(garantia.cenario) });
}
const exigencias = await exigenciasDeTeste(medidas[0]);
const codigo = await linhasDeCodigo();

const saida = [];
saida.push(`medir-verificacao · capivara ${versao} · commit ${commit} · node ${process.version}`);
saida.push("orçamentos do build: --max-cycles 3, --max-verifier-repairs 1 (os padrões do CLI); aceitação e gate de fluxos ligados");
saida.push("");
saida.push("## Cenários");
saida.push("");
for (const medida of medidas) saida.push(imprimirCenario(medida));

saida.push("## Testes exigidos nos prompts do executor");
saida.push("");
saida.push(`lidos de: ${exigencias.prompts.executor} e ${exigencias.prompts.verificador} (cenário app-pequeno)`);
saida.push(`testes exigidos por critério: ${exigencias.testesPorCriterio}`);
for (const obrigacao of exigencias.obrigacoes) saida.push(`  ${obrigacao.testes} — ${obrigacao.nome}: «${obrigacao.linha}»`);
saida.push(`prova obrigatória do modo de falha: ${exigencias.modoDeFalha ? `sim — «${exigencias.modoDeFalha}»` : "não"}`);
saida.push(`o verificador é instruído a desconfiar da suíte verde: ${exigencias.desconfiancaDaSuite ? `sim — «${exigencias.desconfiancaDaSuite}»` : "não"}`);
saida.push(`linhas do prompt do executor que falam de teste e de critério (${exigencias.mencoes.length}):`);
for (const linha of exigencias.mencoes) saida.push(`  «${linha}»`);
saida.push("");

const esgotado = medidas.find((medida) => medida.nome === "orcamento-esgotado");
const fasesDoPlano = esgotado.plano.fases;
const rodadas = esgotado.build?.fases ?? [];
saida.push("## Quando o orçamento esgota (cenário orcamento-esgotado)");
saida.push("");
saida.push(`build: código ${esgotado.build?.exitCode ?? "-"}; relatório: ${esgotado.relatorio?.status ?? "-"}`);
saida.push(`fases: ${rodadas.map(([id, status, gate]) => `${id} ${status}${gate ? ` (${gate})` : ""}`).join(", ")}; não iniciadas: ${fasesDoPlano - rodadas.length}`);
saida.push(`aceitação operacional: ${esgotado.execucoes.aceitacao > 0 ? "rodou" : "não rodou"}`);
saida.push(`o que acontece: ${esgotado.build && esgotado.build.exitCode !== 0 && rodadas.length < fasesDoPlano ? "o build para na fase que esgotou; as seguintes não rodam" : "o build segue"}`);
saida.push("");

saida.push("## Garantias");
saida.push("");
saida.push(
  tabela(
    ["garantia", "pega", "por", "chamadas", "detalhe"],
    garantias.map((garantia) => {
      const total = ESTAGIOS.reduce((soma, estagio) => soma + Object.values(garantia.medida.chamadas[estagio]).reduce((s, v) => s + v, 0), 0);
      return [garantia.id, garantia.pega ? "sim" : "NÃO", mecanismo(garantia.registro), total, garantia.detalhe];
    }),
  ),
);
saida.push("");

saida.push("## Linhas de código");
saida.push("");
for (const [grupo, rotulo] of [["verificacao", "verificação"], ["construcao", "construção"], ["misto", "misto (orquestradores)"], ["fora", "fora dos dois (providers, estado, interface, comandos)"]]) {
  saida.push(`${rotulo}: ${codigo[grupo].total} linhas em ${codigo[grupo].arquivos.length} arquivos`);
  saida.push(codigo[grupo].arquivos.map(([arquivo, n]) => `  ${String(n).padStart(5)} ${arquivo}`).join("\n"));
}
saida.push("");
saida.push(`(medido em ${Math.round(performance.now() - inicio)} ms)`);
console.log(saida.join("\n"));

if (saidaJson) {
  const numeros = {};
  for (const medida of medidas) {
    numeros[medida.nome] = {
      chamadas: Object.fromEntries(ESTAGIOS.map((estagio) => [estagio, medida.chamadas[estagio]])),
      execucoes: medida.execucoes,
      plano: medida.plano,
      tempo: medida.duracoes,
      build: medida.build ? { exitCode: medida.build.exitCode, fases: medida.build.fases.map(([id, status]) => `${id}:${status}`).join(",") } : null,
    };
  }
  numeros.testes = { porCriterio: exigencias.testesPorCriterio, modoDeFalha: exigencias.modoDeFalha !== null, desconfiancaDaSuite: exigencias.desconfiancaDaSuite !== null };
  numeros.garantias = Object.fromEntries(garantias.map((garantia) => [garantia.id, garantia.pega ? `pega: ${mecanismo(garantia.registro)}` : "NÃO PEGA"]));
  numeros.linhas = Object.fromEntries(Object.entries(codigo).map(([grupo, valor]) => [grupo, valor.total]));
  await writeFile(saidaJson, JSON.stringify({ commit, versao, numeros }, null, 2) + "\n");
}

if (manter) console.log(`\npastas dos cenários:\n${pastas.join("\n")}`);
else await Promise.all(pastas.map((pasta) => rm(pasta, { recursive: true, force: true })));
await rm(pastaDoPacote, { recursive: true, force: true });
if (garantias.some((garantia) => !garantia.pega)) process.exitCode = 1;
