/**
 * A arquitetura que o `plan` aprovou, do jeito que o build a consome.
 *
 * O build lia do plano só o markdown da fase e, do esqueleto, a Stack e as
 * Regras (`sharedContractFromSkeleton`). As decisões que o `plan` toma antes de
 * escrever qualquer fase — quais componentes existem, o que cada um expõe, de
 * quem cada fase depende — não chegavam a quem implementa nem a quem verifica,
 * e cada executor as redescobria lendo o código (§116 deixou isso anotado como
 * a primeira tarefa do build).
 *
 * A forma estruturada é guardada pelo `plan` sob o run do `init`; quem a lê é o
 * CLI, porque o loop não importa o init. Aqui ela é conferida contra o que foi
 * publicado e carimbado, e só então vira fatia por fase.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ArchitectureComponent,
  architectureSliceForPhase,
  architectureViewForPhase,
  checkArchitectureBinding,
  fechoDosComponentes,
  parsePhases,
  sha12,
  type Architecture,
  type ArchitectureBinding,
  type Skeleton,
} from "../contract/index.js";
import { artifactPaths } from "../state/paths.js";
import { readEnvironmentPlanExtras } from "./environment-plan.js";

/** A parte da arquitetura que uma fase recebe. */
export interface FatiaDaArquitetura {
  /** O markdown que vai ao prompt do executor e do verificador. */
  texto: string;
  /** Identidade da fatia: entra nas evidências e nos registros de fase e de task. */
  sha12: string;
  /** Os componentes que a fase implementa ou estende. */
  componentes: string[];
  /** Os arquivos que a arquitetura fixa para esses componentes; vazio é "livre". */
  arquivos: string[];
  /** Só os contratos que a fase entrega (sem o componente na frente): o que um reparo documental dela pode alcançar. */
  contratosProprios: string[];
  /** As outras fases cujos componentes dependem, direta ou indiretamente, de um componente desta: quem um reparo do contrato atinge. */
  consumidoras: number[];
}

export interface ArquiteturaDoBuild {
  vinculo: ArchitectureBinding;
  /** A fatia da fase, quando o vínculo dela foi comprovado. */
  fatia(phaseNumber: number): FatiaDaArquitetura | null;
}

export async function vincularArquitetura(
  projectRoot: string,
  plan: string,
  architecture: Architecture | null,
  skeleton: Skeleton | null,
): Promise<ArquiteturaDoBuild> {
  const init = artifactPaths(projectRoot).init;
  const published = await readFile(join(init, "architecture.md"), "utf8").catch(() => null);
  const extras = await readEnvironmentPlanExtras(projectRoot);
  const lido = parsePhases(plan);
  const phases = lido.ok ? lido.document.phases.map((phase) => ({ number: phase.number, title: phase.title })) : [];
  const vinculo = checkArchitectureBinding({
    architecture,
    published,
    declaredSha12: extras.architectureSha12 ?? null,
    skeleton,
    phases,
  });
  const vinculadas = new Set(vinculo.bound);

  return {
    vinculo,
    fatia(phaseNumber) {
      if (architecture === null || !vinculadas.has(phaseNumber)) return null;
      const view = architectureViewForPhase(architecture, phaseNumber);
      if (!view) return null;
      const texto = architectureSliceForPhase(architecture, phaseNumber);
      return {
        texto,
        sha12: identidadeDaFatia(architecture, view),
        componentes: view.own.map((component) => component.name),
        arquivos: [...new Set(view.own.flatMap((component) => component.files))],
        contratosProprios: view.own.flatMap((component) => component.contracts),
        consumidoras: architecture.phases
          .filter((phase) => phase.number !== phaseNumber)
          .filter((phase) => {
            const fecho = fechoDeDependencias(architecture, phase.components);
            return view.own.some((component) => fecho.has(component.name.toLowerCase()));
          })
          .map((phase) => phase.number)
          .sort((a, b) => a - b),
      };
    },
  };
}

/**
 * Os componentes citados e todos os de que eles dependem, transitivamente.
 *
 * Um fluxo que atravessa a api atravessa também o que a api usa: uma mudança
 * num módulo de dados que só a api importa atinge o fluxo tanto quanto uma na
 * própria rota.
 */
export function fechoDeDependencias(architecture: Architecture, nomes: readonly string[]): Set<string> {
  return fechoDosComponentes(architecture.components, nomes);
}

/**
 * A identidade da fatia, para as memórias de fase e de task.
 *
 * Não é o sha do markdown: ele carrega a visão geral, TODAS as decisões de dados,
 * a infraestrutura inteira e os números das fases que estendem cada componente
 * — e mudar qualquer uma dessas coisas reabriria todas as fases. A identidade é
 * só o que a fase entrega e consome: os componentes próprios (contratos,
 * arquivos, entidades, dependências), o contrato dos consumidos, e as decisões
 * de dados sobre as entidades deles.
 */
export function identidadeDaFatia(architecture: Architecture, view: { own: ArchitectureComponent[]; consumed: ArchitectureComponent[] }): string {
  const entidades = new Set([...view.own, ...view.consumed].flatMap((component) => component.owns.map((entidade) => entidade.toLowerCase())));
  const decisoes = architecture.dataDecisions
    .filter((decisao) => entidades.has((decisao.subject.split(/[.\s]/u)[0] ?? "").toLowerCase()))
    .map((decisao) => [decisao.subject, decisao.statement]);
  return sha12(JSON.stringify({
    own: view.own.map((component) => [component.name, [...component.contracts], [...component.files], [...component.owns], [...component.dependsOn]]),
    consumed: view.consumed.map((component) => [component.name, [...component.contracts]]),
    decisoes,
  }));
}

