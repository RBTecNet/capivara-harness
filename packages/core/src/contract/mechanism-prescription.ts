/**
 * I-17 — o esqueleto não fixa mecanismo de implementação sem autoridade.
 *
 * A fronteira é esta: o `init` levanta o PRODUTO — o que ele faz, quais dados
 * tem, quais regras valem, como o usuário interage, o que precisa ser
 * observável, que restrições vieram do pedido. O `plan` decide a ENGENHARIA —
 * componentes, contratos, arquivos, infraestrutura, persistência, migração,
 * inicialização, integração. O `haiku` (Parallel Lab, 0.6.2) mostrou o custo
 * de cruzá-la: o esqueleto fixou `APP_DB_PATH`, `data/parallel-lab.db`,
 * "CREATE TABLE IF NOT EXISTS antes de o servidor aceitar requisições",
 * `E2E_PORT`, `src/nucleo/api.ts`, `src/casca/rotas.tsx`, a página de cada
 * módulo em `src/modulos/<modulo>/Pagina<Modulo>.tsx` e uma entrada de stack
 * "Estrutura de pastas". O arquiteto leu tudo como produto, a auditoria da
 * arquitetura cobrou cada mecanismo como requisito, e a contradição entre o
 * CREATE TABLE do esqueleto e a regra de migração do harness consumiu seis
 * rodadas, uma mudança de estratégia e dois reparos — sobre uma decisão que
 * o pedido nunca tomou e que o plano resolveria sozinho.
 *
 * A checagem é determinística e curta de propósito: quatro FORMAS que são
 * mecanismo em qualquer stack, nunca uma lista de termos técnicos. A stack
 * pedida ("Express 5", "SQLite", "React 19") não é tocada: uma tecnologia é
 * decisão de produto quando o pedido a nomeia, e o escritor a registra na
 * stack. O que esta checagem pega é a decisão de ONDE e COMO o código se
 * organiza:
 * - um CAMINHO de arquivo ou diretório de código (`src/nucleo/api.ts`,
 *   `server/modulos/<modulo>/`, `data/app.db`) ou um arquivo de código solto
 *   (`main.tsx`);
 * - uma VARIÁVEL DE AMBIENTE (`APP_DB_PATH`, `E2E_PORT`, "a variável PORT");
 * - um COMANDO ou script de ferramenta (`npm run migrar`, `php artisan migrate`);
 * - CÓDIGO: uma instrução DDL (`CREATE TABLE IF NOT EXISTS`) ou uma chamada
 *   de função (`abrirBanco()`, `router.get('/')`).
 *
 * A autoridade é o escape, e é a mesma do I-16: um termo que aparece no
 * PEDIDO ou numa DECISÃO ACEITA do desenvolvedor não é prescrição do esqueleto
 * — é dele, e passa. "Use a variável DATABASE_URL" continua podendo ser dito.
 *
 * O que fica de fora, e é limitação conhecida: a prosa que descreve um
 * mecanismo sem nenhuma dessas formas ("as tabelas são criadas ao abrir a
 * conexão", "registra os roteadores de cada módulo") passa. O prompt do
 * esqueleto diz ao escritor para não escrevê-la, e o arquiteto recebe a regra
 * de que um mecanismo sem autoridade é escolha dele — as duas metades que o
 * código não cobre.
 */

import type { TestAuthority } from "./test-prescription.js";
import type { InvariantCode } from "./invariants.js";

/** O código do invariante que esta checagem reporta. */
export const MECHANISM_INVARIANT: InvariantCode = "I-17";

/** Extensões de arquivo de código: um nome solto com uma delas é um arquivo que o plano escolhe. */
const EXTENSOES_DE_CODIGO = "tsx?|jsx?|mjs|cjs|py|php|rb|go|rs|java|kt|cs|vue|svelte";
/** Extensões que, com diretório na frente, fazem de um caminho um caminho de projeto. */
const EXTENSOES_DE_CAMINHO = `${EXTENSOES_DE_CODIGO}|css|scss|less|html|sql|json|ya?ml|toml|db|sqlite3?|env|md|txt|xml|ini`;
/** As raízes de árvore de código que fazem de `x/y` um caminho mesmo sem extensão. */
const RAIZES_DE_CODIGO = new Set([
  "src", "server", "app", "lib", "libs", "package", "packages", "backend", "frontend", "api", "web", "client",
  "component", "components", "page", "pages", "route", "routes", "router", "module", "modules", "modulo", "modulos",
  "controller", "controllers", "model", "models", "service", "services", "repository", "repositories", "migration",
  "migrations", "database", "db", "data", "public", "dist", "build", "config", "test", "tests", "resources", "internal",
  "cmd", "domain", "infra", "core", "shared", "util", "utils", "hooks", "store", "view", "views", "template",
  "templates", "style", "styles", "asset", "assets", "scripts", "bin", "prisma", "drizzle", "schema", "schemas",
]);

/** `a/b/c.ts`, `server/modulos/<modulo>/`, `data/app.db` — nunca precedido de `/` (rota) nem de `:` (URL). */
const CAMINHO = /(?<![\w/:.@-])((?:[\w@.<>-]+\/)+[\w@.<>-]*)/gu;
/** `main.tsx`, `api.ts` — um arquivo de código solto, sem diretório. */
const ARQUIVO_DE_CODIGO = new RegExp(`(?<![\\w/.@-])([\\w-]+\\.(?:${EXTENSOES_DE_CODIGO}))\\b`, "gu");
/** `APP_DB_PATH`, `E2E_PORT`, `DATABASE_URL`: maiúsculas com sublinhado são variável de ambiente ou constante. */
const VARIAVEL_COM_SUBLINHADO = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])\b/gu;
/** "a variável PORT", "variável de ambiente FOO", "environment variable BAR", `process.env.X`. */
const VARIAVEL_NOMEADA = /(?:\bvari[áa]vel(?:\s+de\s+ambiente)?|\benvironment\s+variable|\benv\s+var|\bprocess\.env\.)\s*[`"']?([A-Z][A-Z0-9_]+)\b/gu;
/** `npm run migrar`, `npx vite`, `php artisan migrate`, `composer install`, `cargo run`, `rake db:migrate`. */
const COMANDO = /\b((?:(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?|php\s+artisan\s+|(?:composer|cargo|dotnet|mvn|gradlew?|rake|poetry|pip)\s+|bundle\s+exec\s+)[a-z][\w:.-]*)/giu;
/** `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE`: DDL é esquema escrito, e o esquema é do plano. */
const DDL = /\b((?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|SCHEMA|DATABASE|VIEW)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\b/gu;
/** `abrirBanco()`, `registrarRotas(app)`, `router.get('/')`: uma chamada é assinatura decidida. */
const CHAMADA = /(?<![\w.$])([a-z_$][\w$]*(?:\.[\w$]+)*\((?:[^()\n]{0,80})\))/gu;
/** O plural de prosa que parece chamada: "registro(s)", "usuário(a)", "item(ns)". */
const PLURAL_DE_PROSA = /\((?:s|es|ns|a|as|os|is)\)$/u;

/** Tira a pontuação de prosa que gruda no fim do termo; o `)` de uma chamada é da chamada, e fica. */
function aparado(termo: string): string {
  const semPontuacao = termo.replace(/[.,;:\]}]+$/u, "");
  return semPontuacao.includes("(") ? semPontuacao : semPontuacao.replace(/\)+$/u, "");
}

function ehCaminhoDeCodigo(caminho: string): boolean {
  const segmentos = caminho.split("/");
  const primeiro = (segmentos[0] ?? "").toLowerCase();
  const ultimo = segmentos[segmentos.length - 1] ?? "";
  if (caminho.includes("<")) return true;
  if (RAIZES_DE_CODIGO.has(primeiro)) return true;
  return new RegExp(`\\.(?:${EXTENSOES_DE_CAMINHO})$`, "iu").test(ultimo);
}

/**
 * Os mecanismos de implementação que este texto fixa e nenhuma fonte autoriza.
 * Vazio significa que o texto descreve o produto, não o código.
 */
export function mechanismPrescriptions(text: string, authority: TestAuthority = []): string[] {
  const fontes = authority.join("\n").toLowerCase();
  const achados = new Map<string, string>();
  const registrar = (termo: string): void => {
    const limpo = aparado(termo.trim());
    if (limpo === "" || fontes.includes(limpo.toLowerCase())) return;
    achados.set(limpo.toLowerCase(), limpo);
  };

  for (const match of text.matchAll(CAMINHO)) {
    const caminho = aparado(match[1] ?? "");
    if (caminho.includes("/") && ehCaminhoDeCodigo(caminho)) registrar(caminho);
  }
  for (const match of text.matchAll(ARQUIVO_DE_CODIGO)) registrar(match[1] ?? "");
  for (const match of text.matchAll(VARIAVEL_COM_SUBLINHADO)) registrar(match[1] ?? "");
  for (const match of text.matchAll(VARIAVEL_NOMEADA)) registrar(match[1] ?? "");
  for (const match of text.matchAll(COMANDO)) registrar(match[1] ?? "");
  for (const match of text.matchAll(DDL)) registrar(match[1] ?? "");
  for (const match of text.matchAll(CHAMADA)) {
    const chamada = match[1] ?? "";
    if (!PLURAL_DE_PROSA.test(chamada)) registrar(chamada);
  }
  return [...achados.values()];
}

/** A correção, a mesma em todo lugar do esqueleto: o comportamento fica, o mecanismo sai. */
export function mechanismPrescriptionHint(terms: readonly string[]): string {
  return (
    `remova ${terms.map((termo) => `"${termo}"`).join(", ")} e descreva só o comportamento que precisa valer — o que, para quem, quando, com que resultado observável;` +
    " como ele se implementa — arquivo, diretório, variável de ambiente, comando, função, esquema — é decisão do plano, e o plano decide sozinho." +
    " Não apague a exigência: reescreva-a sem o mecanismo (\"os dados persistem em um banco SQLite local e continuam disponíveis após reiniciar a aplicação\")." +
    " O que o pedido ou uma decisão do desenvolvedor nomeia continua valendo como está"
  );
}
