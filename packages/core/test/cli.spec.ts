import { describe, expect, it } from "vitest";
import { VERSION, createProgram } from "../src/index.js";

describe("cli", () => {
  it("expõe o nome do binário", () => {
    expect(createProgram().name()).toBe("capivara");
  });

  it("carrega uma versão", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
