import { describe, expect, it } from "vitest";
import { checkDesignRefs, parsePhases } from "../../src/contract/index.js";
import type { ParseResult, PhasesDocument } from "../../src/contract/index.js";
import { VALID_PHASES } from "./fixture.js";

function parsed(source: string): PhasesDocument {
  const result = parsePhases(source);
  if (!result.ok) throw new Error(`esperava documento válido, erros: ${result.errors.map((e) => e.code).join(", ")}`);
  return result.document;
}

function codes(result: ParseResult): string[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe("parsePhases — documento válido", () => {
  it("aceita o documento de referência", () => {
    const document = parsed(VALID_PHASES);
    expect(document.projectName).toBe("Exemplo");
    expect(document.phases).toHaveLength(2);
    expect(document.stamp?.inputs.map((input) => input.name)).toEqual([
      "project-description.md",
      "user-stories.md",
      "database-schema.md",
    ]);
  });

  it("numera as tasks dentro da fase, atravessando sub-fases", () => {
    const [first, second] = parsed(VALID_PHASES).phases;
    expect(first?.tasks.map((task) => task.index)).toEqual([1, 2]);
    expect(second?.tasks.map((task) => task.index)).toEqual([1]);
  });

  it("lê os campos da task", () => {
    const task = parsed(VALID_PHASES).phases[0]?.tasks[0];
    expect(task?.done).toBe(false);
    expect(task?.title).toBe("Criar a migration de users");
    expect(task?.acceptanceCriteria).toHaveLength(1);
    expect(task?.featureTests).toHaveLength(1);
    expect(task?.traces).toEqual(["US-1.1", "users", "workflow 1"]);
    expect(task?.designRef).toBeNull();
  });

  it("reconhece a task concluída", () => {
    expect(parsed(VALID_PHASES).phases[1]?.tasks[0]?.done).toBe(true);
  });

  it("lê os metadados da fase", () => {
    const phase = parsed(VALID_PHASES).phases[1];
    expect(phase?.goal).toBe("Um visitante se cadastra e recebe confirmação");
    expect(phase?.dependsOn).toBe("Phase 1");
    expect(phase?.covers).toBe("workflow 2");
  });

  it("associa a sub-fase à fase correta", () => {
    const phase = parsed(VALID_PHASES).phases[0];
    expect(phase?.subPhases).toEqual([
      { phase: 1, number: 1, title: "Migrations", line: expect.any(Number) },
    ]);
  });

  it("recorta o markdown da fase sem incluir a fase seguinte nem o que encerra a captura", () => {
    const [first, second] = parsed(VALID_PHASES).phases;
    expect(first?.markdown.startsWith("## Phase 1: Fundação de dados")).toBe(true);
    expect(first?.markdown).not.toContain("## Phase 2");
    expect(second?.markdown).not.toContain("## Open Questions");
    expect(second?.markdown).toContain("POST /signup");
  });

  it("aceita indentação livre nos sub-itens da task", () => {
    const source = VALID_PHASES.replace("  - **Traces:** US-1.2, statuses", "      - **Traces:** US-1.2, statuses");
    expect(parsed(source).phases[0]?.tasks[1]?.traces).toEqual(["US-1.2", "statuses"]);
  });

  it("nunca lança, mesmo com entrada absurda", () => {
    for (const source of ["", "\n\n\n", "texto solto", "## Phase", "- [ ] **Task:**"]) {
      expect(() => parsePhases(source)).not.toThrow();
    }
  });
});

describe("parsePhases — invariantes", () => {
  it("I-01 rejeita título fora do formato", () => {
    const source = VALID_PHASES.replace("# Exemplo — Project Phases", "# Exemplo - Project Phases");
    expect(codes(parsePhases(source))).toContain("I-01");
  });

  it("I-02 rejeita stamp ausente", () => {
    const source = VALID_PHASES.replace(/^<!-- inputs:.*-->$/m, "");
    expect(codes(parsePhases(source))).toContain("I-02");
  });

  it("I-02 rejeita stamp com hash de tamanho errado", () => {
    const source = VALID_PHASES.replace("sha256:aaaaaaaaaaaa", "sha256:aaaa");
    expect(codes(parsePhases(source))).toContain("I-02");
  });

  it("I-03 rejeita numeração com buraco", () => {
    const source = VALID_PHASES.replace("## Phase 2: Fluxo", "## Phase 3: Fluxo");
    expect(codes(parsePhases(source))).toContain("I-03");
  });

  it("I-03 rejeita fase sem linha de metadados", () => {
    const source = VALID_PHASES.replace(/^\*\*Goal:\*\* Um visitante.*$/m, "");
    expect(codes(parsePhases(source))).toContain("I-03");
  });

  it("I-03 rejeita documento sem nenhuma fase", () => {
    expect(codes(parsePhases("# Exemplo — Project Phases\n\n<!-- inputs: a.md@sha256:aaaaaaaaaaaa -->\n"))).toContain("I-03");
  });

  it("I-04 rejeita heading de fase fora do formato", () => {
    const source = VALID_PHASES.replace("## Phase 2: Fluxo de cadastro", "## Phase Two: Fluxo de cadastro");
    expect(codes(parsePhases(source))).toContain("I-04");
  });

  it("I-05 rejeita sub-fase promovida a nível 2", () => {
    const source = VALID_PHASES.replace("### Phase 1.1: Migrations", "## Phase 1.1: Migrations");
    expect(codes(parsePhases(source))).toContain("I-04");
  });

  it("I-05 rejeita sub-fase cujo número não é o da fase", () => {
    const source = VALID_PHASES.replace("### Phase 1.1: Migrations", "### Phase 4.1: Migrations");
    expect(codes(parsePhases(source))).toContain("I-05");
  });

  it("I-06 encerra a captura em outro heading de nível 2", () => {
    const document = parsed(VALID_PHASES);
    const everyTask = document.phases.flatMap((phase) => phase.tasks.map((task) => task.title));
    expect(everyTask).not.toContain("Nenhuma.");
    expect(document.phases[1]?.markdown).not.toContain("Open Questions");
  });

  it("I-07 rejeita fase sem task", () => {
    const source = `${VALID_PHASES}\n## Phase 3: Vazia\n\n**Goal:** nada · **Depends on:** none · **Covers:** nada\n`;
    expect(codes(parsePhases(source))).toContain("I-07");
  });

  it("I-08 rejeita task sem critério de aceitação", () => {
    const source = VALID_PHASES
      .replace("  - **Acceptance criteria:**\n    - A tabela statuses contém exatamente as três linhas declaradas\n", "");
    expect(codes(parsePhases(source))).toContain("I-08");
  });

  it("I-09 rejeita task sem Traces", () => {
    const source = VALID_PHASES.replace("  - **Traces:** US-1.2, statuses", "");
    expect(codes(parsePhases(source))).toContain("I-09");
  });

  it("I-13 rejeita marcador de decisão pendente", () => {
    const source = VALID_PHASES.replace("Nenhuma.", "[NEEDS DECISION] qual provedor de email");
    expect(codes(parsePhases(source))).toContain("I-13");
  });
});

describe("checkDesignRefs — I-14", () => {
  const withDesign = VALID_PHASES.replace(
    "  - **Traces:** US-2.1, users, workflow 2",
    "  - **Design ref:** .capivara/init/design/signup.png\n  - **Traces:** US-2.1, users, workflow 2",
  );

  it("aceita referência existente", () => {
    const errors = checkDesignRefs(parsed(withDesign), ".capivara/init/design/", () => true);
    expect(errors).toEqual([]);
  });

  it("rejeita referência morta e diz o que fazer", () => {
    const errors = checkDesignRefs(parsed(withDesign), ".capivara/init/design/", () => false);
    expect(errors.map((error) => error.code)).toEqual(["I-14"]);
    expect(errors[0]?.hint).toContain("remova o **Design ref:**");
  });

  it("ignora tasks sem Design ref", () => {
    expect(checkDesignRefs(parsed(VALID_PHASES), ".capivara/init/design/", () => false)).toEqual([]);
  });
});

describe("erros", () => {
  it("toda mensagem de erro traz uma orientação do que fazer", () => {
    const result = parsePhases("lixo\n\nlixo\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(error.hint.length).toBeGreaterThan(20);
    }
  });

  it("os erros saem ordenados por linha", () => {
    const source = VALID_PHASES
      .replace("# Exemplo — Project Phases", "# Exemplo - Project Phases")
      .replace("  - **Traces:** US-1.2, statuses", "");
    const result = parsePhases(source);
    if (result.ok) throw new Error("esperava erros");
    const linhas = result.errors.map((error) => error.line);
    expect([...linhas].sort((a, b) => a - b)).toEqual(linhas);
  });
});
