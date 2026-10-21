/**
 * A autoridade de um ponto em aberto (§122): quem pode decidi-lo.
 *
 * O desenvolvedor decide o PRODUTO; o plano decide a ENGENHARIA — assinaturas,
 * exportações, registro de rotas, obtenção de dependências, propriedade de
 * arquivos, scripts, organização de módulos; o build decide a VALIDAÇÃO —
 * ferramenta, arquivos e cenários de teste (I-16, §118).
 *
 * No `minimax` (DeepSeek, 0.6.2) o auditor levou ao desenvolvedor, como
 * CAPIVARA_DECISION, "como o `rotas.ts` obtém a instância `Database`" e "o
 * módulo escreve `router.get('/')` ou `router.get('/tarefas')`"; e o
 * levantamento de auditoria pôs na frente dele, como "desacordo de leitura",
 * "o `rotas.ts` de Categorias não declara `export const prefixo` que
 * `registrarRotasApi` exige" e "ninguém declara o script `test` do
 * `package.json`". Ele respondeu "fica como está" a quatro, e duas
 * contradições materiais foram publicadas como decididas. Nenhuma delas era
 * dele: as duas leituras produziam o mesmo produto observável e divergiam só
 * na forma do código — e um conflito entre implementações é o plano que
 * resolve.
 *
 * A classificação é por FORMA, não por lista de assuntos: o ponto é de
 * engenharia quando o que está em disputa tem a forma de código — um caminho
 * de arquivo, uma chamada ou assinatura, uma exportação, um script npm, uma
 * variável de ambiente. São sinais inequívocos: uma decisão de produto fala
 * de telas, campos e comportamentos, e não traz `abrirBanco(caminho)` nas
 * duas alternativas. Uma CAPIVARA_DECISION é de engenharia quando TODAS as
 * leituras têm essa forma; um achado, quando o problema E a correção a têm.
 * Fora disso a categoria é indefinida, e o que é indefinido continua chegando
 * ao desenvolvedor: na dúvida, a pendência é preservada, nunca decidida por
 * inferência. O preço conhecido é a decisão de produto escrita em código nas
 * duas opções — rara, e tratada pelo plano como engenharia.
 */

import { enderecoDaDecisao, type AuditDecision, type Finding } from "./protocol.js";

export type Autoridade = "engenharia" | "indefinida";

/** Caminho de arquivo com extensão de código ou configuração. */
const CAMINHO =
  /(?:^|[\s`"'(\[{,;:])((?:[\w.@-]+\/)*[\w.@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|php|rb|go|rs|java|kt|kts|swift|cs|sql|json|ya?ml|toml|env|example|lock|md|html|css|scss|vue|svelte|prisma|graphql|sh))\b/giu;
/** Chamada ou assinatura entre crases: `abrirBanco(caminho)`, `router.get('/', …)`. */
const CHAMADA = /`[^`\n]*?\b[A-Za-z_$][\w$.]*\([^`\n]*`/gu;
/** Exportação ou importação de módulo. */
const EXPORTACAO = /\b(?:export\s+(?:const|default|function|class|type|interface|let|var)|export\s*\{|import\s*\{|import\s+\w+\s+from|module\.exports|require\()/gu;
/** Script de gerenciador de pacotes, ou o script nomeado do `package.json`. */
const SCRIPT = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:-]+\b|\bscripts?\s+`[\w:-]+`/giu;
/** Variável de ambiente: maiúsculas com sublinhado. */
const VARIAVEL_DE_AMBIENTE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/gu;

/**
 * Os sinais de engenharia num texto: o que nele tem forma de código.
 *
 * Devolve os trechos, para o log dizer POR QUE o ponto não foi ao
 * desenvolvedor; vazio quando o texto não tem nenhum.
 */
export function sinaisDeEngenharia(text: string): string[] {
  const sinais = new Set<string>();
  for (const match of text.matchAll(CAMINHO)) if (match[1]) sinais.add(match[1]);
  for (const match of text.matchAll(CHAMADA)) sinais.add(match[0]);
  for (const match of text.matchAll(EXPORTACAO)) sinais.add(match[0]);
  for (const match of text.matchAll(SCRIPT)) sinais.add(match[0]);
  for (const match of text.matchAll(VARIAVEL_DE_AMBIENTE)) sinais.add(match[0]);
  return [...sinais];
}

/**
 * A autoridade de uma decisão que o auditor levantou.
 *
 * É engenharia quando todas as leituras têm forma de código: o que elas
 * disputam é como o código fica, não o que o produto faz. Uma leitura em
 * prosa — "o select aparece só na edição" — torna a categoria indefinida,
 * e a decisão vai ao desenvolvedor como sempre.
 */
export function autoridadeDaDecisao(decision: AuditDecision): Autoridade {
  if (decision.options.length < 2) return "indefinida";
  return decision.options.every((leitura) => sinaisDeEngenharia(leitura).length > 0) ? "engenharia" : "indefinida";
}

/**
 * A autoridade de um achado que voltou e seria arbitrado.
 *
 * É engenharia quando o problema e a correção têm forma de código: o auditor
 * aponta uma incompatibilidade entre contratos do próprio plano e diz como
 * alinhá-los. Esse ponto o escritor fecha lendo a arquitetura e a fase que
 * fixa o contrato; perguntar ao desenvolvedor qual leitura vale é pedir que
 * ele arbitre uma assinatura.
 */
export function autoridadeDoAchado(finding: Finding): Autoridade {
  if (finding.mechanical === true) return "indefinida";
  const noProblema = sinaisDeEngenharia(`${finding.where}\n${finding.problem}`);
  const naCorrecao = sinaisDeEngenharia(finding.fix);
  return noProblema.length > 0 && naCorrecao.length > 0 ? "engenharia" : "indefinida";
}

/** A nota que acompanha o achado de engenharia até quem escreve. */
export const NOTA_DE_ENGENHARIA =
  "(decisão de engenharia: cabe ao plano, não ao desenvolvedor — a arquitetura e a fase que fixa o contrato são a autoridade; " +
  "alinhe a fase dependente ao contrato declarado, e se o contrato não existe em fase nenhuma, a fase mais cedo que entrega o componente o declara)";

/** O achado de engenharia, com a nota, para o escritor saber que não há decisão a esperar. */
export function comNotaDeEngenharia(finding: Finding): Finding {
  if (finding.fix.includes(NOTA_DE_ENGENHARIA)) return finding;
  return { ...finding, fix: `${finding.fix}\n${NOTA_DE_ENGENHARIA}` };
}

/**
 * A decisão de engenharia que o auditor levantou, devolvida como achado ao
 * escritor: o plano escolhe a leitura compatível com a arquitetura e a aplica
 * em todas as fases envolvidas. As leituras do auditor seguem no achado,
 * porque são o trabalho útil dele — o que muda é quem escolhe.
 */
export function decisaoDeEngenhariaComoFinding(decision: AuditDecision): Finding {
  return {
    where: enderecoDaDecisao(decision),
    problem: `o auditor levantou como decisão do desenvolvedor uma escolha de engenharia: ${decision.decision}`,
    fix:
      "é o plano que decide: escolha a leitura compatível com a arquitetura e com o contrato da fase que o fixa, aplique-a em todas as fases envolvidas e deixe o documento sem contradição. " +
      `Leituras que o auditor viu: ${decision.options.map((leitura, index) => `${index + 1}) ${leitura}`).join(" ")}\n${NOTA_DE_ENGENHARIA}`,
  };
}
