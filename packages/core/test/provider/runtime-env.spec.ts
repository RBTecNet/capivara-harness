import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeEnvironment } from "../../src/provider/runtime-env.js";
import { defaultTestRunner } from "../../src/loop/gates.js";
import { defaultRunner } from "../../src/loop/acceptance.js";

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("runtime do harness", () => {
  it("mantém as variáveis do processo e põe o Node efetivo à frente do PATH", () => {
    const environment = runtimeEnvironment({ PATH: ["/outro/node", dirname(process.execPath)].join(delimiter), PORT: "47533" });
    expect(environment.PATH?.split(delimiter)[0]).toBe(dirname(process.execPath));
    expect(environment.PATH?.split(delimiter).filter((entry) => entry === dirname(process.execPath))).toHaveLength(1);
    expect(environment.NODE).toBe(process.execPath);
    expect(environment.PORT).toBe("47533");
  });

  it.skipIf(process.platform === "win32")("G2 e aceitação usam o Node do harness mesmo com outro executável no PATH", async () => {
    directory = await mkdtemp(join(tmpdir(), "capivara-runtime-"));
    const bin = join(directory, "bin");
    await mkdir(bin);
    const impostor = join(bin, "node");
    await writeFile(impostor, "#!/bin/sh\necho outro-node\n");
    await chmod(impostor, 0o755);
    vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
    const command = 'node -p "process.execPath"';
    const gate = await defaultTestRunner(command, directory);
    expect(gate.exitCode).toBe(0);
    expect(gate.output.trim()).toBe(process.execPath);
    const acceptance = await defaultRunner(command, directory, 5);
    expect(acceptance.exitCode).toBe(0);
    expect(acceptance.output.trim()).toBe(process.execPath);
  });
});
