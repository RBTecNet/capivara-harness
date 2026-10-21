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
  disponibilidadeDosFluxos,
  fechoDosComponentes,
  parsePhases,
  sha12,
  type Architecture,
  type ArchitectureBinding,
  type Disponibilidade,
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
  /** Os contratos que a fase entrega e os que consome, uma linha cada, com o componente: o roteirista e a triagem os recebem. */
  contratos: string[];
  /** Só os contratos que a fase entrega (sem o componente na frente): o que um reparo documental dela pode alcançar. */
  contratosProprios: string[];
  /** As outras fases cujos componentes dependem, direta ou indiretamente, de um componente desta: quem um reparo do contrato atinge. */
  consumidoras: number[];
}

/**
 * O território de um fluxo, para dizer se uma mudança o atinge (§125 C).
 *
 * `classificar` responde, para um arquivo mudado: é do fluxo (algum componente
 * do fecho dele o fixa ou o commitou), está demonstradamente fora (todo dono
 * conhecido fica fora do fecho), ou não se sabe — e não saber nunca vira fora.
 */
export interface TerritorioDoFluxo {
  componentes: string[];
  arquivos: string[];
  commitados: string[];
  classificar(arquivo: string): "dentro" | "fora" | "desconhecido";
}

/** O caminho de um fluxo pela arquitetura. */
export interface FluxoNaArquitetura {
  /** Os componentes que ele atravessa e tudo de que eles dependem, direta ou indiretamente. */
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
  /**
   * O território do fluxo para a fase corrente: `donos` são os arquivos que cada
   * fase commitou (`arquivosDasFases`); o arquivo que nenhum commit de fase
   * escreveu é atribuído à fase corrente, que é quem o tem na árvore.
   */
  territorio(workflow: string, donos: ReadonlyMap<number, ReadonlySet<string>>, faseAtual: number): TerritorioDoFluxo | null;
  /**
   * Os componentes de cada fase VINCULADA e o caminho de cada workflow, para a
   * disponibilidade dos fluxos (§127). A fase que não se comprova (a que o
   * `change` acrescentou fora da arquitetura) fica sem componentes — o que
   * depende dela é desconhecido —, e as outras continuam valendo.
   */
  tempo(): { componentes: ReadonlyMap<number, readonly string[]>; caminhos: ReadonlyMap<string, readonly string[]> } | null;
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
        contratos: [
          ...view.own.flatMap((component) => component.contracts.map((contract) => `${component.name} (desta fase): ${contract}`)),
          ...view.consumed.flatMap((component) => component.contracts.map((contract) => `${component.name} (consumido): ${contract}`)),
        ],
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
    fluxo(workflow) {
      if (architecture === null || vinculadas.size === 0) return null;
      const flow = architecture.flows.find((entry) => entry.workflow === workflow);
      if (!flow) return null;
      const nomes = fechoDeDependencias(architecture, flow.components);
      const componentes = architecture.components.filter((component) => nomes.has(component.name.toLowerCase()));
      return {
        componentes: componentes.map((component) => component.name),
        arquivos: [...new Set(componentes.flatMap((component) => component.files))],
        fases: architecture.phases
          .filter((phase) => phase.components.some((nome) => nomes.has(nome.toLowerCase())))
          .map((phase) => phase.number),
      };
    },
    tempo() {
      if (architecture === null || vinculadas.size === 0) return null;
      const caminhos = new Map<string, string[]>();
      for (const flow of architecture.flows) {
        caminhos.set(flow.workflow, [...new Set([...(caminhos.get(flow.workflow) ?? []), ...fechoDeDependencias(architecture, flow.components)])]);
      }
      return { componentes: new Map(architecture.phases.filter((phase) => vinculadas.has(phase.number)).map((phase) => [phase.number, phase.components])), caminhos };
    },
    territorio(workflow, donos, faseAtual) {
      if (architecture === null || vinculadas.size === 0) return null;
      const flow = architecture.flows.find((entry) => entry.workflow === workflow);
      if (!flow) return null;
      const fecho = fechoDeDependencias(architecture, flow.components);
      const componentesDaFase = (numero: number): string[] | null =>
        architecture.phases.find((phase) => phase.number === numero)?.components.map((nome) => nome.toLowerCase()) ?? null;
      const fasesDoFluxo = architecture.phases.filter((phase) => phase.components.some((nome) => fecho.has(nome.toLowerCase()))).map((phase) => phase.number);
      const fixados = new Map<string, string>();
      for (const component of architecture.components) for (const arquivo of component.files) fixados.set(arquivo, component.name.toLowerCase());
      const daFase = (componentes: string[] | null): "dentro" | "fora" | "desconhecido" =>
        componentes === null || componentes.length === 0 ? "desconhecido" : componentes.some((nome) => fecho.has(nome)) ? "dentro" : "fora";
      return {
        componentes: [...fecho],
        arquivos: architecture.components.filter((component) => fecho.has(component.name.toLowerCase())).flatMap((component) => component.files),
        commitados: fasesDoFluxo.flatMap((numero) => [...(donos.get(numero) ?? [])]),
        classificar(arquivo) {
          const fixo = fixados.get(arquivo);
          if (fixo !== undefined) return fecho.has(fixo) ? "dentro" : "fora";
          const autoras = [...donos.entries()].filter(([, arquivos]) => arquivos.has(arquivo)).map(([numero]) => numero);
          if (autoras.length > 0) {
            const vereditos = autoras.map((numero) => daFase(componentesDaFase(numero)));
            return vereditos.includes("dentro") ? "dentro" : vereditos.includes("desconhecido") ? "desconhecido" : "fora";
          }
          return daFase(componentesDaFase(faseAtual));
        },
      };
    },
  };
}

/**
 * Quando cada fluxo é cobrado no build (§127): a mesma derivação do plano,
 * sobre o envelope de cada fase do esqueleto (título e goal) e os componentes
 * das fases que a arquitetura vinculada comprova — a fase fora dela fica
 * desconhecida, e só o que depende dela deixa de ser decidido pelo caminho.
 */
export function disponibilidadeNoBuild(esqueleto: Skeleton, tempo: ReturnType<ArquiteturaDoBuild["tempo"]>): Disponibilidade {
  return disponibilidadeDosFluxos({
    fases: esqueleto.phases.map((phase) => {
      const componentes = tempo?.componentes.get(phase.number);
      return {
        number: phase.number,
        dependsOn: phase.dependsOn,
        covers: phase.covers,
        texto: `${phase.title ?? ""}\n${phase.goal ?? ""}`,
        ...(componentes ? { componentes } : {}),
      };
    }),
    workflows: esqueleto.workflows.map((workflow) => workflow.number),
    ...(tempo ? { caminhos: tempo.caminhos } : {}),
  });
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

