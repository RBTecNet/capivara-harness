/**
 * Self-check mecânico dos documentos upstream.
 *
 * Roda ANTES do auditor, de propósito: erro de forma não deve custar uma chamada
 * de modelo. O que o parser prova, o auditor não precisa reauditar.
 */

export interface ShapeDefect {
  problem: string;
  hint: string;
}

interface Shape {
  titleSuffix: string;
  required: string[];
}

const SHAPES: Record<string, Shape> = {
  "project-description.md": {
    titleSuffix: "— Project Description",
    required: ["## Overview", "### Key Concepts", "## Tech Stack", "## Core Workflows"],
  },
  "user-stories.md": {
    titleSuffix: "— User Stories",
    required: ["**User Types:**", "## Appendix: User Story Status"],
  },
  "database-schema.md": {
    titleSuffix: "— Database Schema",
    required: ["## Overview", "## Schema", "## Relationships", "## Notes & Conventions"],
  },
};

export function checkDocumentShape(name: string, content: string): ShapeDefect[] {
  const shape = SHAPES[name];
  if (!shape) return [];

  const defects: ShapeDefect[] = [];
  const firstLine = content.split("\n")[0]?.trim() ?? "";

  if (!firstLine.startsWith("# ") || !firstLine.endsWith(shape.titleSuffix)) {
    defects.push({
      problem: `a linha 1 de ${name} não é o título esperado`,
      hint: `escreva \`# <nome do projeto> ${shape.titleSuffix}\`, com travessão`,
    });
  }

  for (const section of shape.required) {
    if (!content.includes(section)) {
      defects.push({ problem: `${name} não traz a seção ${section}`, hint: `acrescente a seção ${section} na ordem da estrutura pedida` });
    }
  }

  if (name === "user-stories.md") {
    const body = [...content.matchAll(/^### (US-\d+\.\d+):/gm)].map((match) => match[1]);
    const appendix = [...content.matchAll(/^\|\s*(US-\d+\.\d+)\s*\|/gm)].map((match) => match[1]);
    const missing = body.filter((id) => !appendix.includes(id));
    if (missing.length > 0) {
      defects.push({
        problem: `stories fora do apêndice: ${missing.join(", ")}`,
        hint: "o apêndice lista TODA story do corpo, com prioridade e status",
      });
    }
  }

  return defects;
}
