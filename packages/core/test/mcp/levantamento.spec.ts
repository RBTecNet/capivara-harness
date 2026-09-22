/**
 * O nome do projeto na base sai do nome da aplicação.
 *
 * A regra é a MESMA do doc-center, e isso não é coincidência: é ele que grava.
 * Divergir faria o harness perguntar por um slug e a base criar outro, e a
 * checagem de "já existe" nunca casaria — o levantamento criaria um projeto novo
 * a cada passagem, sem ninguém entender por quê.
 */

import { describe, expect, it } from "vitest";
import { slugDoProjeto } from "../../src/mcp/index.js";

describe("o slug do projeto levantado", () => {
  it("tira acento, espaço e maiúscula", () => {
    expect(slugDoProjeto("Locadora Antiga")).toBe("locadora-antiga");
    expect(slugDoProjeto("Gestão de Frotas")).toBe("gestao-de-frotas");
  });

  it("não deixa hífen sobrando nas pontas", () => {
    expect(slugDoProjeto("  Sistema — 2003  ")).toBe("sistema-2003");
    expect(slugDoProjeto("!!!")).toBe("");
  });

  it("corta em 60, que é o limite da base", () => {
    expect(slugDoProjeto("a".repeat(80))).toHaveLength(60);
  });
});
