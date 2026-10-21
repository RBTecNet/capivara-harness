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
  architectureSliceForPhase,
  architectureViewForPhase,
  checkArchitectureBinding,
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
}

/** O caminho de um fluxo pela arquitetura. */
export interface FluxoNaArquitetura {
  componentes: string[];
  /** Os arquivos fixados para esses componentes. */
  arquivos: string[];
  /** As fases que implementam ou estendem esses componentes. */
  fases: number[];
}

export interface ArquiteturaDoBuild {
  vinculo: ArchitectureBinding;
  /** A fatia da fase, quando o vínculo dela foi comprovado. */
  fatia(phaseNumber: number): FatiaDaArquitetura | null;
  /** O fluxo pela arquitetura, quando ela o mapeia e o vínculo vale. */
  fluxo(workflow: string): FluxoNaArquitetura | null;
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
        sha12: sha12(texto),
        componentes: view.own.map((component) => component.name),
        arquivos: [...new Set(view.own.flatMap((component) => component.files))],
      };
    },
    fluxo(workflow) {
      if (architecture === null || vinculadas.size === 0) return null;
      const flow = architecture.flows.find((entry) => entry.workflow === workflow);
      if (!flow) return null;
      const nomes = new Set(flow.components.map((nome) => nome.toLowerCase()));
      const componentes = architecture.components.filter((component) => nomes.has(component.name.toLowerCase()));
      return {
        componentes: componentes.map((component) => component.name),
        arquivos: [...new Set(componentes.flatMap((component) => component.files))],
        fases: architecture.phases
          .filter((phase) => phase.components.some((nome) => nomes.has(nome.toLowerCase())))
          .map((phase) => phase.number),
      };
    },
  };
}
