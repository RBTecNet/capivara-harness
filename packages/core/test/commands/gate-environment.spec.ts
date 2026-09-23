import { describe, expect, it } from "vitest";

import { ambienteDosGates, cacheDoPlaywright, comoInstalarCompilador } from "../../src/commands/gate-environment.js";
import { diagnose } from "../../src/commands/doctor.js";

const nada = { which: async () => null, existe: async () => false };
const tudo = { which: async (binario: string) => `/usr/bin/${binario}`, existe: async () => true };

describe("ambiente dos gates", () => {
  it("aprova a máquina que tem tudo", async () => {
    const itens = await ambienteDosGates({ ...tudo, platform: "linux", home: "/home/x", environment: {} });
    expect(itens.every((item) => item.ok)).toBe(true);
  });

  it("ensina o comando daquele sistema, não uma instrução genérica", async () => {
    const mac = await ambienteDosGates({ ...nada, platform: "darwin", home: "/Users/x", environment: {} });
    const linux = await ambienteDosGates({ ...nada, platform: "linux", home: "/home/x", environment: {} });

    expect(mac.find((item) => item.item === "compilador C")?.detail).toContain("xcode-select --install");
    expect(mac.find((item) => item.item === "sqlite3")?.detail).toContain("brew install sqlite");
    expect(linux.find((item) => item.item === "compilador C")?.detail).toContain("build-essential");
  });

  it("procura os navegadores onde aquele sistema os guarda", () => {
    expect(cacheDoPlaywright("darwin", "/Users/x")).toBe("/Users/x/Library/Caches/ms-playwright");
    expect(cacheDoPlaywright("linux", "/home/x")).toBe("/home/x/.cache/ms-playwright");
    expect(cacheDoPlaywright("win32", "C:\\Users\\x")).toContain("ms-playwright");
  });

  it("respeita o caminho declarado pelo ambiente", () => {
    expect(cacheDoPlaywright("linux", "/home/x", { PLAYWRIGHT_BROWSERS_PATH: "/opt/navegadores" })).toBe("/opt/navegadores");
  });

  it("diz o comando que resolve o gate 4, com o caminho que procurou", async () => {
    const itens = await ambienteDosGates({ ...nada, platform: "linux", home: "/home/x", environment: {} });
    const navegadores = itens.find((item) => item.item === "navegadores do Playwright");
    expect(navegadores?.ok).toBe(false);
    expect(navegadores?.detail).toContain("npx playwright install");
    expect(navegadores?.detail).toContain("/home/x/.cache/ms-playwright");
  });

  it("um compilador sem make não conta: módulo nativo precisa dos dois", async () => {
    const itens = await ambienteDosGates({
      which: async (binario) => (binario === "make" ? null : `/usr/bin/${binario}`),
      existe: async () => true,
      platform: "linux",
      home: "/home/x",
      environment: {},
    });
    expect(itens.find((item) => item.item === "compilador C")?.ok).toBe(false);
  });

  it("nada disso bloqueia: é aviso, porque nem todo projeto precisa", async () => {
    expect(comoInstalarCompilador("darwin")).toContain("xcode-select");

    const diagnoses = await diagnose({
      projectRoot: process.cwd(),
      credentialsFile: "/caminho/que/nao/existe.json",
      environment: {},
      gateEnvironment: { ...nada, platform: "linux", home: "/home/x", environment: {} },
    });
    const gates = diagnoses.filter((diagnosis) => diagnosis.area === "ambiente dos gates");
    expect(gates).toHaveLength(3);
    expect(gates.every((diagnosis) => diagnosis.health === "aviso")).toBe(true);
  });
});
