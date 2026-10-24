/** Só um plano aprovado nesta geração pode entrar no build. Sem fallback legado. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ENVIRONMENT_CONTRACT, PLANNING_CONTRACT, PLANNING_UPGRADE, SKELETON_CONTRACT, environmentRequirements, renderSkeleton, sha12, type EnvironmentRequirement, type Skeleton } from "../contract/index.js";
import type { Prerequisite } from "./prerequisites.js";
import { VERSION } from "../version.js";

const run = promisify(execFile);

export function plannedRequirements(skeleton: Skeleton): Prerequisite[] {
  if (skeleton.contract !== SKELETON_CONTRACT) throw new Error(PLANNING_UPGRADE);
  return environmentRequirements(skeleton.environment);
}

/**
 * O que o `plan` acrescenta ao metadado desde a geração v3 (§116): a
 * arquitetura que o plano leu e a infraestrutura declarada. O build lê só o que
 * sempre leu — contrato, geração, hashes e sondas —, e o resto viaja para quem
 * vier depois (o `change` o preserva ao republicar).
 */
export interface EnvironmentPlanExtras {
  architectureSha12?: string;
  infrastructure?: unknown;
}

export function renderEnvironmentPlan(skeleton: Skeleton, plan: string, extras: EnvironmentPlanExtras = {}): string {
  return JSON.stringify({ contract: ENVIRONMENT_CONTRACT, planningContract: PLANNING_CONTRACT, harnessVersion: VERSION,
    skeletonSha12: sha12(renderSkeleton(skeleton)), planSha12: sha12(plan),
    ...(extras.architectureSha12 ? { architectureSha12: extras.architectureSha12 } : {}),
    requirements: plannedRequirements(skeleton),
    ...(extras.infrastructure !== undefined ? { infrastructure: extras.infrastructure } : {}) }, null, 2) + "\n";
}

/**
 * As dependências que o PLAN contratou (§135): os nomes de
 * `infrastructure.dependencies`, a autoridade sobre o que a preparação pode
 * declarar num manifesto do npm. As sondas comprovam prontidão; não são a lista
 * do que é permitido. O nome é comparado como o npm o compara, com maiúsculas, e
 * o contrato de um projeto cujos gerenciadores declarados não incluem o npm
 * (NuGet, Composer…) não autoriza nada num `package.json`.
 */
export function dependenciasContratadas(extras: EnvironmentPlanExtras): string[] {
  const infraestrutura = extras.infrastructure as { dependencies?: unknown; packageManagers?: unknown } | undefined;
  const lista = infraestrutura?.dependencies;
  if (!Array.isArray(lista)) return [];
  const gerenciadores = Array.isArray(infraestrutura?.packageManagers) ? infraestrutura.packageManagers as unknown[] : [];
  const nomeDe = (item: unknown): string | null => {
    const nome = (item as { name?: unknown } | null)?.name;
    return typeof nome === "string" && nome.trim() !== "" ? nome.trim() : null;
  };
  if (gerenciadores.length > 0 && !gerenciadores.some(item => /\bnpm\b|node package manager/iu.test(nomeDe(item) ?? ""))) return [];
  return [...new Set(lista.flatMap(item => nomeDe(item) ?? []))];
}

function extrasDe(source: string): EnvironmentPlanExtras {
  try {
    const value = JSON.parse(source) as { architectureSha12?: unknown; infrastructure?: unknown };
    return {
      ...(typeof value.architectureSha12 === "string" ? { architectureSha12: value.architectureSha12 } : {}),
      ...(value.infrastructure !== undefined ? { infrastructure: value.infrastructure } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * O que autoriza uma dependência na adoção da preparação (§135): as sondas e o
 * contrato do `environment.json`, tomados uma vez, antes de qualquer sessão.
 */
export interface AutoridadeDaAdocao {
  /** As sondas cujo `require` ou link de `.bin` autoriza pacote. */
  requisitos: EnvironmentRequirement[];
  /** Os nomes de `infrastructure.dependencies` aceitos. */
  dependencias: string[];
  /** Os nomes do contrato no commit da HEAD; nulo quando o arquivo nunca foi commitado. */
  publicadas: string[] | null;
}

/**
 * A autoridade da adoção, lida antes de qualquer sessão: as sondas da árvore, e
 * do contrato da árvore só o que também está no `environment.json` do commit da
 * HEAD.
 *
 * O `.capivara` fica fora de toda leitura de status do Core, e a sessão de
 * preparação roda antes da adoção: lido só da árvore, o contrato que autoriza a
 * adoção seria um arquivo que a própria sessão pode reescrever, e o nome que ela
 * acrescentasse não está no commit. O `change` reescreve o arquivo sem
 * commitar, mas preserva a infraestrutura, e o contrato continua inteiro. As
 * sondas não passam por essa comparação: o `change` as refaz a partir do
 * esqueleto, e a sonda nova que ele escreveu seria recusada. A especificação
 * nunca versionada (`--no-commit`) não tem com que comparar: vale a árvore.
 */
export async function autoridadePublicada(root: string, requisitos: readonly EnvironmentRequirement[]): Promise<AutoridadeDaAdocao> {
  const daArvore = dependenciasContratadas(await readEnvironmentPlanExtras(root));
  const publicado = await run("git", ["show", "HEAD:./.capivara/init/environment.json"], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    .then(({ stdout }) => stdout, () => null);
  if (publicado === null) return { requisitos: [...requisitos], dependencias: daArvore, publicadas: null };
  const doCommit = dependenciasContratadas(extrasDe(publicado));
  return { requisitos: [...requisitos], dependencias: daArvore.filter(nome => doCommit.includes(nome)), publicadas: doCommit };
}

/** Os campos que o `change` precisa carregar de um metadado para o seguinte. */
export async function readEnvironmentPlanExtras(root: string): Promise<EnvironmentPlanExtras> {
  const source = await readFile(join(root, ".capivara/init/environment.json"), "utf8").catch(() => null);
  return source === null ? {} : extrasDe(source);
}

export async function readEnvironmentPlan(root: string, skeleton: string, plan: string): Promise<Prerequisite[]> {
  const file = join(root, ".capivara/init/environment.json");
  const source = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (source === null) throw new Error(`${PLANNING_UPGRADE}. Falta .capivara/init/environment.json`);
  let value: { contract?: unknown; planningContract?: unknown; planSha12?: unknown; skeletonSha12?: unknown; requirements?: unknown } | null;
  try { value = JSON.parse(source) as typeof value; }
  catch { throw new Error(`${PLANNING_UPGRADE}. environment.json não é JSON válido`); }
  if (value?.contract !== ENVIRONMENT_CONTRACT || value.planningContract !== PLANNING_CONTRACT ||
      value.skeletonSha12 !== sha12(skeleton) || value.planSha12 !== sha12(plan)) {
    throw new Error(`${PLANNING_UPGRADE}. environment.json é antigo ou não corresponde aos documentos atuais`);
  }
  try { return environmentRequirements(value.requirements); }
  catch (error) { throw new Error(`${PLANNING_UPGRADE}. ${error instanceof Error ? error.message : String(error)}`); }
}
