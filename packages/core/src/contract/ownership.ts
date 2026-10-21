/**
 * I-18 — fases que podem rodar ao mesmo tempo não recebem obrigação de escrita
 * no mesmo arquivo.
 *
 * O build executa em paralelo as fases que não dependem uma da outra (§97), e
 * a arquitetura serializa as que estendem o mesmo COMPONENTE (§119). O que
 * faltava era a metade irmã, no nível das FASES: a task que ordena "registrar
 * o módulo em `src/servidor/modulos.ts`, acrescentando a entrada…" numa fase
 * que a arquitetura declarou só com os componentes do módulo. No `haiku`
 * (Parallel Lab, 0.6.2) a fundação entregava `modulos.ts` com as quatro
 * entradas e `navegacao.ts` com os quatro itens; as fases 3, 4, 5 e 6 — sem
 * ordem entre si — mandavam acrescentar cada entrada de novo. O auditor de
 * coerência viu, três rodadas seguidas; a triagem descartou, três rodadas
 * seguidas, porque "existe uma implementação que evita o conflito"; e o plano
 * foi publicado RALPH READY ordenando ao executor literal um registro
 * duplicado e uma edição concorrente que o pedido proíbe.
 *
 * O que é obrigação de escrita, e o que não é (§124.8): a FRASE DA TASK que
 * ordena criar, acrescentar, registrar, alterar, ajustar, configurar… um
 * arquivo nomeado — o verbo no infinitivo, no imperativo, no gerúndio ou com
 * pronome ("registrá-la"), governando o caminho na mesma oração. Não é
 * escrita: um critério de aceite (afirma estado — "`modulos.ts` contém
 * exatamente um item" verifica, não modifica); o caminho citado como fonte
 * ("importado de", "lido de", "definido em", "a partir de"); o caminho
 * depois de um verbo de consumo ("usando", "chama", "importa … de"); o que
 * está numa oração subordinada que não fechou ("que serve `dist/web`", "se
 * `dist/web/index.html` existir"); o verbo negado ou descritivo ("sem alterar
 * `X`", "não modificar `X`", "ao criar uma tarefa, grava em `X`"); e a
 * terceira pessoa que descreve ("a função cria o diretório", "o router
 * registra GET /", "a classe estende Error"), que fica de fora de propósito —
 * a task ordena no infinitivo. O que está entre crases é código ou caminho,
 * nunca verbo: `import { x } from './x'` não desfaz a escrita em `App.tsx`.
 *
 * Fases com ordem entre si — direta, transitiva, ou pela fundação que o
 * escalonador do build acrescenta a toda fase (`loop/escalonador.ts`,
 * `dependenciasEfetivas`) — podem alterar o mesmo arquivo: o stub que a
 * fundação cria e o módulo substitui é sequência, não conflito. O conflito é
 * só este: duas fases sem dependência entre si, as duas com obrigação de
 * escrita no mesmo arquivo. A correção que o achado pede é documental e
 * local — a fase escreve só nos seus arquivos —, e a ORDEM entre fases é
 * campo da arquitetura (`dependsOn`): esta checagem nunca inventa dependência.
 * É por forma, como I-16 e I-17; nunca "duas fases citam o mesmo arquivo".
 */

import type { InvariantCode } from "./invariants.js";
import { phaseDependencies } from "./phase-part.js";
import type { ContractError, PhaseBlock, PhasesDocument, TaskBlock } from "./phases.js";

/** O código do invariante que esta checagem reporta. */
export const WRITE_OWNERSHIP_INVARIANT: InvariantCode = "I-18";

export type WriteKind = "create" | "modify";

/** Uma obrigação de escrita: a task desta fase ordena criar ou alterar este arquivo. */
export interface WriteIntent {
  phase: number;
  task: TaskBlock;
  /** O caminho como a task o nomeia, sem `./` na frente e com `/` como separador. */
  file: string;
  kind: WriteKind;
  /** O verbo que ordena, como está no texto. */
  verb: string;
  /**
   * Nome solto, sem diretório, que não é arquivo de raiz do projeto
   * (`rotas.ts`, `index.ts`): dois módulos podem ter o seu, e o texto não diz
   * qual é qual. Entra nas obrigações da fase; não entra em conflito.
   */
  ambiguous: boolean;
}

/** Um arquivo com obrigação de escrita em fases que podem rodar juntas. */
export interface WriteConflict {
  file: string;
  intent: WriteIntent;
  /** As outras fases, sem dependência com esta, que também escrevem no arquivo. */
  concurrent: number[];
  /** As fases que CRIAM o arquivo, entre todas as que escrevem nele. */
  creators: number[];
  /** Os criadores de que todas as fases em conflito dependem. Vazio: ninguém. */
  owners: number[];
  /** O componente da arquitetura que lista o arquivo, quando ela foi informada. */
  component?: string;
}

export interface WriteOwnershipOptions {
  /** Os componentes da arquitetura, para dizer ao escritor de quem o arquivo é. */
  components?: readonly { name: string; files: readonly string[] }[];
}

/* ------------------------------------------------------------------ texto */

const ACENTOS: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", é: "e", è: "e", ê: "e", ë: "e", í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o", ú: "u", ù: "u", û: "u", ü: "u", ç: "c", ñ: "n",
  Á: "A", À: "A", Â: "A", Ã: "A", Ä: "A", É: "E", È: "E", Ê: "E", Ë: "E", Í: "I", Ì: "I", Î: "I", Ï: "I",
  Ó: "O", Ò: "O", Ô: "O", Õ: "O", Ö: "O", Ú: "U", Ù: "U", Û: "U", Ü: "U", Ç: "C", Ñ: "N",
};
/** Sem acento e com o MESMO comprimento: os deslocamentos valem no texto original. */
const semAcento = (texto: string): string => texto.replace(/[À-ÿ]/gu, (letra) => ACENTOS[letra] ?? letra);
/** O que está entre crases vira espaço: código e caminho não são prosa, e o comprimento fica. */
const mascarar = (texto: string): string => texto.replace(/`[^`\n]*`/gu, (trecho) => " ".repeat(trecho.length));

/** Fim de oração: pontuação seguida de espaço, ou travessão entre espaços. */
const FRONTEIRA = /[.;:!?]\s+|\s[—–-]\s/gu;
/** Um aparte entre parênteses: o verbo de fora não entra nele, e o que está nele não governa fora. */
const PARENTESE = /\(([^()\n]*)\)/gu;

/** Verbos que CRIAM um arquivo: infinitivo, imperativo, gerúndio e o infinitivo com pronome. */
const CRIA =
  /\b(?:cri(?:ar|e|ando|a(?=-l))|ger(?:ar|e|ando|a(?=-l))|escrev(?:er|a|endo|e(?=-l))|constru(?:ir|a|indo|i(?=-l))|desenvolv(?:er|a|endo|e(?=-l))|creat(?:e|ing)|writ(?:e|ing)|generat(?:e|ing)|build(?:ing)?|develop(?:ing)?|scaffold(?:ing)?|set(?:ting)? up)\b/giu;
/** Verbos que ALTERAM um arquivo existente, nas mesmas formas. */
const ALTERA =
  /\b(?:acrescent(?:ar|e|ando|a(?=-l))|adicion(?:ar|e|ando|a(?=-l))|registr(?:ar|e|ando|a(?=-l))|modific(?:ar|ando|a(?=-l))|modifique|alter(?:ar|e|ando|a(?=-l))|edit(?:ar|e|ando|a(?=-l))|atualiz(?:ar|e|ando|a(?=-l))|inclu(?:ir|a|indo|i(?=-l))|inser(?:ir|a|indo|i(?=-l))|ajust(?:ar|ando|a(?=-l))|reescrev(?:er|a|endo|e(?=-l))|substitu(?:ir|a|indo|i(?=-l))|troc(?:ar|ando|a(?=-l))|troque|remov(?:er|a|endo|e(?=-l))|apag(?:ar|ando|a(?=-l))|apague|complet(?:ar|ando|a(?=-l))|renome(?:ar|ie|ando|a(?=-l))|mov(?:er|a|endo|e(?=-l))|configur(?:ar|e|ando|a(?=-l))|implement(?:ar|e|ando|a(?=-l))|defin(?:ir|a|indo|i(?=-l))|preench(?:er|a|endo|e(?=-l))|grav(?:ar|ando|a(?=-l))|trat(?:ar|e|ando|a(?=-l))|corrig(?:ir|a|indo|i(?=-l))|estend(?:er|a|endo|e(?=-l))|document(?:ar|e|ando|a(?=-l))|integr(?:ar|e|ando|a(?=-l))|exp(?:or|onha|ondo)|declar(?:ar|e|ando|a(?=-l))|habilit(?:ar|e|ando|a(?=-l))|ativ(?:ar|e|ando|a(?=-l))|refator(?:ar|e|ando|a(?=-l))|extra(?:ir|ia|indo|i(?=-l))|mont(?:ar|e|ando|a(?=-l))|popul(?:ar|e|ando|a(?=-l))|salv(?:ar|e|ando|a(?=-l))|persist(?:ir|a|indo|i(?=-l))|version(?:ar|e|ando|a(?=-l))|import(?:ar|e|ando|a(?=-l))|add(?:ing)?|append(?:ing)?|register(?:ing)?|modif(?:y|ying)|alter(?:ing)?|edit(?:ing)?|updat(?:e|ing)|includ(?:e|ing)|insert(?:ing)?|adjust(?:ing)?|rewrit(?:e|ing)|replac(?:e|ing)|removing|delet(?:e|ing)|renam(?:e|ing)|configur(?:e|ing)|implement(?:ing)?|defining|fill(?:ing)?|wir(?:e|ing)|fix(?:ing)?|moving|extend(?:ing)?|document(?:ing)?|integrat(?:e|ing)|expos(?:e|ing)|declar(?:e|ing)|enabl(?:e|ing)|refactor(?:ing)?|extract(?:ing)?|mount(?:ing)?|populat(?:e|ing)|persist(?:ing)?|sav(?:e|ing)|stor(?:e|ing)|hook(?:ing)?|attach(?:ing)?|import(?:ing)?)\b/giu;
/**
 * "Remove", "Move", "Define" e "Complete" em inglês são também a terceira
 * pessoa ou o adjetivo em português ("remove os espaços", "o guia completo").
 * Em inglês a task começa pelo imperativo, com maiúscula: só assim contam.
 */
const ALTERA_EM_INGLES = /\b(?:Remove|Move|Define|Complete)\b/gu;
/** A voz passiva que ordena: "deve ser registrado em", "será criado em", "must be added to". */
const PASSIVA =
  /\b(?:deve|devera|devem|deverao|sera|serao|precisa|precisam|must|should|will|is to|are to)\s+(?:ser\s+|be\s+)?((?:registrad|criad|acrescentad|adicionad|alterad|modificad|atualizad|incluid|inserid|gravad|salv|escrit|configurad|ajustad|definid|registered|created|added|appended|modified|updated|inserted|written|configured|adjusted|defined)\w*)\b/giu;
/**
 * O que, logo antes do verbo, o torna descrição e não ordem: negação ("sem
 * alterar", "não modificar", "without modifying") ou preposição com infinitivo
 * ("ao criar uma tarefa, grava…", "para registrar", "em vez de criar").
 */
const BARREIRA =
  /(?:^|[\s,])(?:sem|nao|nunca|jamais|not|without|never|neither|nor|do not|don't|does not|doesn't|ao|para|de|por|antes de|depois de|apos|after|before|when|whenever|while|by|to|em vez de|instead of|rather than|evit\w*|proib\w*|imped\w*|prevent\w*|avoid\w*)\s+(?:\w+\s+)?$/iu;
/** Verbos de CONSUMO: entre o verbo de escrita e o caminho, desfazem a obrigação. */
const CONSOME =
  /\b(?:us(?:ar|a|e|ando)|utiliz(?:ar|a|e|ando)|consum(?:ir|a|e|indo)|reutiliz(?:ar|a|e|ando)|aproveit(?:ar|a|e|ando)|l(?:er|e|endo)|cham(?:ar|a|e|ando)|carreg(?:ar|a|ando)|segu(?:ir|e|indo)|respeit(?:ar|a|e|ando)|conform(?:e|ar)|baseado|com base|apoiad[oa]|us(?:e|es|ing)|consum(?:e|es|ing)|read(?:s|ing)?|load(?:s|ing)?|call(?:s|ing)?|follow(?:s|ing)?|reus(?:e|es|ing))\b/giu;
/** "importar X de `y`" consome `y`; "Importar `criarRotas` em `app.ts`" escreve em `app.ts`. */
const IMPORTA = /\bimport(?:ar|a|e|ando|s|ing)?\b/giu;
const ORIGEM_DA_IMPORTACAO = /\b(?:de|do|da|from)\b/iu;
/** Oração subordinada ou condicional: o que vem depois descreve, não ordena — enquanto não fechar. */
const QUEBRA = /\b(?:se|quando|caso|enquanto|if|when|unless|que|cuj[oa]s?|onde|which|that|where|whose)\b/giu;
/** A subordinada fechou: o trecho termina numa coordenação ou vírgula, e o caminho que vem é outro objeto. */
const FECHA_SUBORDINADA = /(?:,\s*|\s)(?:e|and|ou|or)\s*$|,\s*$/iu;
/** As palavras logo antes do caminho que dizem "vem de lá": o arquivo é fonte, não destino. */
const FONTE_IMEDIATA =
  /(?:\b(?:from|by|via|desde|pel[oa]s?|por)|\b(?:copia|copy|exemplo|example|partir|base|vez|versao|version|conteudo|contents?|trecho|modelo|template|padrao|espelho|clone|igual|identic[oa]s?|semelhante|similar|baseado|baseada|derivad[oa]s?)\s+(?:de|do|da|dos|das|of|on|from)|\b(?:importad|exportad|lid|obtid|vind|descrit|expost|fornecid|publicad|entregu|carregad|copiad|extraid|herdad|recebid)[oa]?s?\s+(?:de|do|da|dos|das|por|pel[oa]s?|from|by)|\b(?:exported|imported|delivered|provided|loaded|copied|extracted|inherited|received|read|taken)\s+(?:from|by))\s*$/iu;
/**
 * O particípio que LOCALIZA — "definido em", "registrado em", "existente em" —
 * diz onde a coisa está. Se a task altera a coisa no lugar ("Alterar o tipo
 * definido em `tipos.ts`", "acrescentar ao array definido em `x.ts`"), o
 * arquivo é destino; se a task pega a coisa e a põe noutro lugar ("Registrar o
 * módulo definido em `a.ts` em `modulos.ts`", "Criar `b.ts` com o tipo
 * definido em `a.ts`"), o arquivo é fonte.
 */
const LOCALIZACAO =
  /\b(?:definid|declarad|criad|gerad|feit|montad|gravad|armazenad|localizad|situad|contid|implementad|registrad|servid|salv|guardad|mantid|escrit)[oa]?s?\s+(?:em|no|na|nos|nas|in|at)\s*$|\b(?:entregues?|existentes?|presentes?|disponive(?:l|is)|defined|declared|created|located|found|available|stored|kept|living|exposed|registered|mounted|served|written)\s+(?:em|no|na|nos|nas|in|at)\s*$|\b(?:esta|estao|fica|ficam|vive|vivem|mora|moram|existe|existem|reside|residem|lives?|sits?|resides?)\s+(?:em|no|na|nos|nas|in|at)\s*$/iu;
/** O objeto introduzido por dativo ou locativo é o lugar da escrita: "acrescentar AO array…", "registrar EM…". */
const OBJETO_DE_DESTINO = /^\s+(?:ao|a|as|aos|as|em|no|na|nos|nas|dentro de|to|into|in|onto)\b/iu;
/** Verbos que alteram a coisa onde ela está: o arquivo que a contém é o destino. */
const ALTERA_NO_LUGAR = /^(?:alter|atualiz|edit|ajust|corrig|estend|renome|remov|apag|substitu|complet|preench|refator|reescrev|modific|troc|habilit|ativ|document|extend|updat|edit|adjust|fix|rewrit|replac|delet|renam|modif|complet|fill|refactor|enabl|extract|Remove|Move|Define|Complete)/iu;
/** A passiva que ordena o lugar: "deve ser registrada em `X`" é escrita em X, não localização. */
const PREPOSICAO_DE_LUGAR = /^\s+(?:em|no|na|nos|nas|in|at|to|into|para|a|ao|onto)\s*$/iu;
/** A oração que começa pelo lugar: "Em `navegacao.ts`, acrescentar…" é escrita no arquivo. */
const LOCATIVO_INICIAL = /^\s*(?:em|no|na|in|at)\s*$/iu;
/** O arquivo solto seguido do seu diretório: "`index.ts` em `src/modulos/tarefas`". */
const DIRETORIO_DEPOIS = /^\s+(?:em|no|na|in|inside|under|within|dentro de)\s*$/iu;

/* --------------------------------------------------------------- caminhos */

const EXTENSOES =
  "tsx?|jsx?|mjs|cjs|json|md|html?|css|scss|less|sql|ya?ml|toml|example|txt|xml|ini|cfg|conf|py|php|rb|go|rs|java|kt|kts|cs|vue|svelte|sh|lock|prisma|graphql|gql|csv|svg|png|jpe?g|ico|properties|gradle|plist|swift|dart|exs|erl|hs|scala|lua|pl|jl";
const ARQUIVO_SEM_EXTENSAO = /^(?:makefile|dockerfile|license|readme|procfile|gemfile|rakefile|vagrantfile|caddyfile|justfile)$/iu;
/**
 * Arquivo de raiz do projeto, reconhecível pelo nome sem diretório. Qualquer
 * outro nome solto (`rotas.ts`, `index.ts`) pode ser o de cada módulo.
 */
const ARQUIVO_DE_RAIZ =
  /^(?:package(?:-lock)?\.json|tsconfig[\w.-]*\.json|jsconfig\.json|[\w.-]+\.config\.[cm]?[jt]s|index\.html|readme\.md|dockerfile|makefile|composer\.(?:json|lock)|cargo\.(?:toml|lock)|pyproject\.toml|requirements\.txt|go\.(?:mod|sum)|gemfile(?:\.lock)?|[\w.-]+\.(?:ya?ml|toml|ini|cfg|conf|properties|gradle))$/iu;

const TOKEN_ENTRE_CRASES = /`([^`\n]+)`/gu;
/** Fora das crases só conta o que tem diretório ou é dotfile: `Node.js` e `p.ex.` são prosa. */
const TOKEN_SOLTO = /(?<![\w`/:.@-])((?:[\w@.-]+\/)+[\w@.-]*|\.[\w][\w.-]*)(?![\w`/]|\.\w)/gu;

interface Caminho {
  texto: string;
  inicio: number;
  fim: number;
  diretorio: boolean;
  /** Diretório escrito com a barra final: "em `src/web/componentes/`". */
  explicito: boolean;
}

/** Caminho de projeto? Rota HTTP, URL, chamada, placeholder, glob e prosa não são. */
function lerCaminho(bruto: string): { texto: string; diretorio: boolean; explicito: boolean } | null {
  const texto = bruto.trim().replace(/\\/gu, "/").replace(/[.,:;)\]]+$/u, "").replace(/^\.\//u, "");
  if (texto === "" || texto === "." || texto === "..") return null;
  if (/[\s(){}<>|"'=,;*?$]/u.test(texto)) return null;
  if (texto.startsWith("/") || texto.includes("://") || texto.startsWith("@") || texto.startsWith("-")) return null;
  const segmentos = texto.split("/").filter((segmento) => segmento !== "");
  if (segmentos.length === 0) return null;
  const ultimo = segmentos[segmentos.length - 1] ?? "";
  const temExtensao = new RegExp(`\\.(?:${EXTENSOES})$`, "iu").test(ultimo) || ARQUIVO_SEM_EXTENSAO.test(ultimo);
  const dotfile = ultimo.startsWith(".") && ultimo.length > 1;
  if (texto.endsWith("/")) return { texto: segmentos.join("/"), diretorio: true, explicito: true };
  if (texto.includes("/")) return { texto: segmentos.join("/"), diretorio: !temExtensao && !dotfile, explicito: false };
  if (temExtensao || dotfile) return { texto, diretorio: false, explicito: false };
  return null;
}

function caminhosDaFrase(frase: string): Caminho[] {
  const caminhos: Caminho[] = [];
  const registrar = (bruto: string, inicio: number, fim: number): void => {
    const lido = lerCaminho(bruto);
    if (lido) caminhos.push({ ...lido, inicio, fim });
  };
  for (const match of frase.matchAll(TOKEN_ENTRE_CRASES)) registrar(match[1] ?? "", match.index ?? 0, (match.index ?? 0) + match[0].length);
  const mascarada = mascarar(frase);
  for (const match of mascarada.matchAll(TOKEN_SOLTO)) registrar(match[1] ?? "", match.index ?? 0, (match.index ?? 0) + match[0].length);
  return caminhos.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Os caminhos de projeto que um texto cita — para escrever, ler ou conferir.
 *
 * É o mesmo leitor das obrigações de escrita, sem a gramática da oração: o
 * build o usa para dizer quais arquivos uma task menciona (§125, escopo das
 * evidências), e duas leituras de caminho divergiriam na primeira correção.
 */
export function projectPaths(text: string): { path: string; directory: boolean }[] {
  const vistos = new Set<string>();
  const saida: { path: string; directory: boolean }[] = [];
  for (const caminho of caminhosDaFrase(text)) {
    if (vistos.has(caminho.texto)) continue;
    vistos.add(caminho.texto);
    saida.push({ path: caminho.texto, directory: caminho.diretorio });
  }
  return saida;
}

/* ---------------------------------------------------------------- orações */

/** As fronteiras de oração do texto mascarado, em posições crescentes. */
function fronteiras(mascarada: string): number[] {
  const posicoes = new Set<number>([0, mascarada.length]);
  for (const match of mascarada.matchAll(FRONTEIRA)) posicoes.add((match.index ?? 0) + 1);
  return [...posicoes].sort((a, b) => a - b);
}

/** A oração que contém a posição: [início, fim). */
function oracaoDe(limites: readonly number[], posicao: number): [number, number] {
  let inicio = 0;
  let fim = limites[limites.length - 1] ?? posicao;
  for (const limite of limites) {
    if (limite <= posicao) inicio = limite;
    else {
      fim = limite;
      break;
    }
  }
  return [inicio, fim];
}

interface Verbo {
  indice: number;
  fim: number;
  texto: string;
  kind: WriteKind;
  passivo: boolean;
}

/** Os verbos de escrita num trecho do texto mascarado, com a posição absoluta. */
function verbosEm(mascarada: string, de: number, ate: number): Verbo[] {
  const trecho = mascarada.slice(de, ate);
  const achados: Verbo[] = [];
  const colher = (regex: RegExp, kind: WriteKind | ((texto: string) => WriteKind), passivo = false): void => {
    for (const match of trecho.matchAll(regex)) {
      const texto = match[0];
      achados.push({ indice: de + (match.index ?? 0), fim: de + (match.index ?? 0) + texto.length, texto, kind: typeof kind === "function" ? kind(match[1] ?? texto) : kind, passivo });
    }
  };
  colher(CRIA, "create");
  colher(ALTERA, "modify");
  colher(ALTERA_EM_INGLES, "modify");
  colher(PASSIVA, (participio) => (/^(?:criad|created)/iu.test(participio) ? "create" : "modify"), true);
  return achados.sort((a, b) => a.indice - b.indice);
}

/** O verbo está negado ou vem depois de preposição: descreve, não ordena. */
const descritivo = (mascarada: string, inicioDaOracao: number, verbo: Verbo): boolean => BARREIRA.test(mascarada.slice(inicioDaOracao, verbo.indice));

/**
 * Entre o verbo e o caminho há consumo, ou uma subordinada que não fechou?
 *
 * O que desfaz a escrita vale até a oração fechar: "`index.html` que carrega
 * `main.tsx`, e `src/web/main.tsx`" — o "carrega" consome o primeiro
 * `main.tsx`; o segundo vem depois da vírgula e do "e", e é objeto de "Criar"
 * de novo.
 */
function trechoDesfazAEscrita(trecho: string): boolean {
  let ultimo = -1;
  for (const match of trecho.matchAll(CONSOME)) ultimo = Math.max(ultimo, match.index ?? -1);
  for (const match of trecho.matchAll(QUEBRA)) ultimo = Math.max(ultimo, match.index ?? -1);
  for (const match of trecho.matchAll(IMPORTA)) {
    if (ORIGEM_DA_IMPORTACAO.test(trecho.slice((match.index ?? 0) + match[0].length))) ultimo = Math.max(ultimo, match.index ?? -1);
  }
  if (ultimo < 0) return false;
  return !FECHA_SUBORDINADA.test(trecho.slice(ultimo));
}

interface Escrita {
  file: string;
  kind: WriteKind;
  verb: string;
  ambiguous: boolean;
}

/** As obrigações de escrita de uma frase da task. */
function escritasDaFrase(original: string): Escrita[] {
  const caminhos = caminhosDaFrase(original);
  if (caminhos.length === 0) return [];
  const mascarada = mascarar(semAcento(original));
  const limites = fronteiras(mascarada);
  const apartes = [...mascarada.matchAll(PARENTESE)].map((match) => ({ inicio: match.index ?? 0, fim: (match.index ?? 0) + match[0].length }));
  // Para quem está fora dos parênteses, o aparte não existe; para quem está dentro, só ele existe.
  const semApartes = apartes.reduce((texto, aparte) => texto.slice(0, aparte.inicio) + " ".repeat(aparte.fim - aparte.inicio) + texto.slice(aparte.fim), mascarada);
  const contexto = (posicao: number): { texto: string; inicio: number; fim: number } => {
    const [inicio, fim] = oracaoDe(limites, posicao);
    const aparte = apartes.find((candidato) => candidato.inicio < posicao && posicao < candidato.fim);
    if (aparte) return { texto: mascarada, inicio: Math.max(inicio, aparte.inicio + 1), fim: Math.min(fim, aparte.fim - 1) };
    return { texto: semApartes, inicio, fim };
  };

  const governo = (caminho: Caminho): { kind: WriteKind; verb: string } | null => {
    const { texto, inicio, fim } = contexto(caminho.inicio);
    const antes = texto.slice(inicio, caminho.inicio);
    if (FONTE_IMEDIATA.test(antes)) return null;
    const verbos = verbosEm(texto, inicio, caminho.inicio);
    const ultimo = verbos[verbos.length - 1];
    if (ultimo) {
      const trecho = texto.slice(ultimo.fim, caminho.inicio);
      // "deve ser registrada em `X`": a passiva que ordena o lugar vence o particípio que localiza.
      if (ultimo.passivo && PREPOSICAO_DE_LUGAR.test(trecho)) return { kind: ultimo.kind, verb: original.slice(ultimo.indice, ultimo.fim) };
      if (descritivo(texto, inicio, ultimo)) return null;
      if (LOCALIZACAO.test(antes) && !(OBJETO_DE_DESTINO.test(trecho) || ALTERA_NO_LUGAR.test(ultimo.texto))) return null;
      if (/^import/iu.test(ultimo.texto) && ORIGEM_DA_IMPORTACAO.test(trecho)) return null;
      if (trechoDesfazAEscrita(trecho)) return null;
      return { kind: ultimo.kind, verb: original.slice(ultimo.indice, ultimo.fim) };
    }
    if (LOCALIZACAO.test(antes)) return null;
    if (LOCATIVO_INICIAL.test(antes) && verbosEm(texto, caminho.fim, fim).some((verbo) => !descritivo(texto, inicio, verbo))) {
      return { kind: "modify", verb: "em" };
    }
    return null;
  };

  const ehFonte = (caminho: Caminho): boolean => {
    const { texto, inicio } = contexto(caminho.inicio);
    const antes = texto.slice(inicio, caminho.inicio);
    return FONTE_IMEDIATA.test(antes) || LOCALIZACAO.test(antes);
  };
  const diretoriosExplicitos = caminhos.filter((caminho) => caminho.diretorio && caminho.explicito && !ehFonte(caminho));
  const qualificar = (caminho: Caminho): { file: string; ambiguous: boolean } => {
    if (caminho.texto.includes("/")) return { file: caminho.texto, ambiguous: false };
    const { inicio, fim } = contexto(caminho.inicio);
    // "`index.ts` em `src/modulos/tarefas`": o diretório logo depois, com ou sem barra.
    const seguinte = caminhos.find((outro) => outro.inicio >= caminho.fim && outro.diretorio && DIRETORIO_DEPOIS.test(mascarada.slice(caminho.fim, outro.inicio)));
    if (seguinte) return { file: `${seguinte.texto}/${caminho.texto}`, ambiguous: false };
    const naOracao = diretoriosExplicitos.filter((diretorio) => diretorio.inicio >= inicio && diretorio.fim <= fim);
    const anterior = [...naOracao].reverse().find((diretorio) => diretorio.fim <= caminho.inicio);
    const posterior = naOracao.find((diretorio) => diretorio.inicio >= caminho.fim);
    const escolhido = anterior ?? posterior;
    if (escolhido) return { file: `${escolhido.texto}/${caminho.texto}`, ambiguous: false };
    return { file: caminho.texto, ambiguous: !ARQUIVO_DE_RAIZ.test(caminho.texto) && !caminho.texto.startsWith(".") };
  };

  const escritas: Escrita[] = [];
  for (const caminho of caminhos) {
    if (caminho.diretorio) continue;
    const quem = governo(caminho);
    if (!quem) continue;
    escritas.push({ ...qualificar(caminho), ...quem });
  }
  return escritas;
}

/**
 * As obrigações de escrita de uma fase: o que as frases das suas tasks ordenam
 * criar ou alterar. Critérios não entram — eles afirmam estado.
 */
export function writeIntents(phase: PhaseBlock): WriteIntent[] {
  const intents: WriteIntent[] = [];
  for (const task of phase.tasks) {
    const vistos = new Set<string>();
    for (const escrita of escritasDaFrase(task.title)) {
      if (vistos.has(escrita.file)) continue;
      vistos.add(escrita.file);
      intents.push({ phase: phase.number, task, ...escrita });
    }
  }
  return intents;
}

/* ------------------------------------------------------------ dependências */

/**
 * As dependências que o escalonador do build de fato respeita
 * (`loop/escalonador.ts`, `dependenciasEfetivas`), reproduzidas aqui para que
 * o contrato julgue a concorrência pela mesma régua: a fase sem `Depends on`
 * legível espera todas as anteriores; a que cita fase inexistente ou
 * posterior, também; e a fundação — a fase de menor número — entra como
 * dependência de todas as outras, mesmo quando o texto não a cita.
 */
export function effectiveDependencies(phases: readonly { number: number; dependsOn: string }[]): Map<number, number[]> {
  const numeros = phases.map((phase) => phase.number);
  const efetivas = new Map<number, number[]>();
  for (const phase of phases) {
    const anteriores = numeros.filter((numero) => numero < phase.number);
    if (anteriores.length === 0) {
      efetivas.set(phase.number, []);
      continue;
    }
    const declaradas = phaseDependencies(phase.dependsOn);
    const existentes = new Set(anteriores);
    if (declaradas.some((numero) => !existentes.has(numero))) {
      efetivas.set(phase.number, anteriores);
      continue;
    }
    const fundacao = Math.min(...anteriores);
    efetivas.set(phase.number, [...new Set([fundacao, ...declaradas])].sort((a, b) => a - b));
  }
  return efetivas;
}

/** `de` alcança `ate` pelas dependências efetivas, direta ou transitivamente? */
function alcance(phases: readonly PhaseBlock[]): (de: number, ate: number) => boolean {
  const dependencias = effectiveDependencies(phases);
  return (de, ate) => {
    const visitadas = new Set<number>();
    const pilha = [...(dependencias.get(de) ?? [])];
    while (pilha.length > 0) {
      const numero = pilha.pop()!;
      if (numero === ate) return true;
      if (visitadas.has(numero)) continue;
      visitadas.add(numero);
      pilha.push(...(dependencias.get(numero) ?? []));
    }
    return false;
  };
}

/* --------------------------------------------------------------- conflitos */

/**
 * Os conflitos de escrita do plano: cada obrigação de escrita num arquivo que
 * outra fase sem ordem com esta também tem obrigação de escrever.
 */
export function writeConflicts(document: PhasesDocument, options: WriteOwnershipOptions = {}): WriteConflict[] {
  const alcanca = alcance(document.phases);
  const porArquivo = new Map<string, WriteIntent[]>();
  for (const phase of document.phases) {
    for (const intent of writeIntents(phase)) {
      if (intent.ambiguous) continue;
      const lista = porArquivo.get(intent.file) ?? [];
      lista.push(intent);
      porArquivo.set(intent.file, lista);
    }
  }
  const componenteDe = (file: string): string | undefined => {
    const alvo = file.toLowerCase();
    return options.components?.find((component) => component.files.some((nome) => nome.trim().replace(/^\.\//u, "").replace(/\\/gu, "/").toLowerCase() === alvo))?.name;
  };
  const conflitos: WriteConflict[] = [];
  for (const [file, intents] of porArquivo) {
    const fases = [...new Set(intents.map((intent) => intent.phase))];
    if (fases.length < 2) continue;
    const creators = [...new Set(intents.filter((candidata) => candidata.kind === "create").map((candidata) => candidata.phase))].sort((a, b) => a - b);
    for (const intent of intents) {
      const concurrent = fases.filter((outra) => outra !== intent.phase && !alcanca(intent.phase, outra) && !alcanca(outra, intent.phase)).sort((a, b) => a - b);
      if (concurrent.length === 0) continue;
      const envolvidas = [intent.phase, ...concurrent];
      const owners = creators.filter((dona) => envolvidas.every((fase) => alcanca(fase, dona)));
      const component = componenteDe(file);
      conflitos.push({ file, intent, concurrent, creators, owners, ...(component ? { component } : {}) });
    }
  }
  return conflitos.sort((a, b) => a.intent.task.line - b.intent.task.line);
}

const lista = (numeros: readonly number[]): string =>
  numeros.length <= 1 ? `a fase ${numeros[0] ?? "?"}` : `as fases ${numeros.slice(0, -1).join(", ")} e ${numeros[numeros.length - 1]}`;

const resumo = (titulo: string): string => (titulo.length > 72 ? `${titulo.slice(0, 72).trimEnd()}…` : titulo);

/**
 * A correção, honesta sobre o que se sabe: quem cria o arquivo e se as fases em
 * conflito dependem dessa criação. A ordem entre fases é da arquitetura.
 */
export function writeOwnershipHint(conflict: WriteConflict): string {
  const arquivo = `\`${conflict.file}\``;
  const ordem = "A ordem entre as fases (dependsOn) é decisão da arquitetura, não desta task: não invente dependência aqui";
  if (conflict.owners.length > 0) {
    return (
      `entre fases que podem rodar ao mesmo tempo, um arquivo tem um dono só. ${lista(conflict.owners)}, de que todas as fases em conflito dependem, cria ${arquivo}. ` +
      `Se ela já entrega o que esta fase precisa encontrar em ${arquivo}, retire desta task a instrução de criar, acrescentar, registrar ou alterar ${arquivo} e deixe um critério verificar o estado — verificar não é escrever. ` +
      `Se ela ainda não entrega, escreva a necessidade como critério ("${arquivo} contém …, entregue pela fase ${conflict.owners[0]}") em vez de escrever no arquivo: a auditoria leva a lacuna à fase dona. ` +
      `Em nenhum caso esta fase escreve em ${arquivo}. ${ordem}`
    );
  }
  const criadoraSozinha = conflict.intent.kind === "create" && conflict.creators.every((criadora) => criadora === conflict.intent.phase);
  if (criadoraSozinha) {
    return (
      `esta fase CRIA ${arquivo}, e ${lista(conflict.concurrent)} escreve${conflict.concurrent.length > 1 ? "m" : ""} nele sem depender desta: mantenha a criação aqui — é a divisão que está errada, não esta task. ` +
      `Ou ${lista(conflict.concurrent)} passa a consumir o que esta fase entrega (dependendo dela, o que é decisão da arquitetura), ou ${arquivo} nasce numa fase de que todas dependem. ` +
      `Descreva nesta task o que ${arquivo} entrega; não apague a criação. ${ordem}`
    );
  }
  const criadoras = conflict.creators.filter((criadora) => criadora !== conflict.intent.phase);
  if (criadoras.length > 0) {
    return (
      `${lista(criadoras)} cria ${arquivo}, mas não vem antes desta fase: retire desta task a instrução de acrescentar, registrar ou alterar ${arquivo} e escreva como critério o que esta fase precisa encontrar nele ("${arquivo} contém …"), para que a auditoria aponte a lacuna à fase que o cria. ` +
      `Verificar não é escrever. ${ordem}`
    );
  }
  return (
    `entre fases que podem rodar ao mesmo tempo, um arquivo tem um dono só, e nenhuma fase de que todas as conflitantes dependam cria ${arquivo}. ` +
    `Retire desta task a instrução de criar, acrescentar, registrar ou alterar ${arquivo} e deixe a fase escrever só nos arquivos que são dela; se esta fase precisa encontrar algo em ${arquivo}, escreva isso como critério ("${arquivo} contém …") e não como escrita, para que a auditoria aponte a lacuna à fase que entrega o arquivo. ` +
    `Verificar não é escrever. ${ordem}`
  );
}

/**
 * I-18 como erro de contrato, um por task em conflito, na linha da task.
 */
export function checkWriteOwnership(document: PhasesDocument, options: WriteOwnershipOptions = {}): ContractError[] {
  return writeConflicts(document, options).map((conflict) => ({
    code: WRITE_OWNERSHIP_INVARIANT,
    line: conflict.intent.task.line,
    message:
      `a task "${resumo(conflict.intent.task.title)}" da fase ${conflict.intent.phase} ordena ${conflict.intent.kind === "create" ? "criar" : "escrever em"} \`${conflict.file}\`` +
      ` (${conflict.intent.verb}), e ${lista(conflict.concurrent)} — sem dependência com ela, que o build pode executar ao mesmo tempo — também ordena${conflict.concurrent.length > 1 ? "m" : ""} escrever nele` +
      (conflict.component ? `; na arquitetura o arquivo é do componente "${conflict.component}"` : ""),
    hint: writeOwnershipHint(conflict),
  }));
}
