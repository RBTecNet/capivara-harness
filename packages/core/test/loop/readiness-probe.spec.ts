import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { prepareReadinessProbe } from "../../src/loop/readiness-probe.js";

const run = promisify(execFile);
const requirement = { technology: "Playwright", binary: "playwright", systemLevel: false,
  checkArgs: ["screenshot", "--browser=chromium", "data:text/html,pronto", "/dev/null"] };

it("captura usa destino PNG exclusivo e limpa os artefatos mesmo após falha", async () => {
  const first = await prepareReadinessProbe(requirement);
  const second = await prepareReadinessProbe(requirement);
  try {
    expect(first.args.slice(0, -1)).toEqual(requirement.checkArgs.slice(0, -1));
    expect(first.args.at(-1)).toMatch(/\.png$/);
    expect(second.args.at(-1)).not.toBe(first.args.at(-1));
    expect(requirement.checkArgs.at(-1)).toBe("/dev/null");
    await writeFile(first.args.at(-1)!, "captura real");
    await run(process.execPath, ["-e", "process.exit(1)"]).catch(() => undefined);
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
  await expect(access(first.args.at(-1)!)).rejects.toThrow();
});

it.each([
  { ...requirement, checkArgs: ["--version"] },
  { ...requirement, checkArgs: ["screenshot", "data:text/html,pronto", "captura.png"] },
  { ...requirement, binary: "outro-programa" },
])("outros comandos e destinos permanecem intactos", async requirement => {
  const probe = await prepareReadinessProbe(requirement);
  expect(probe.args).toEqual(requirement.checkArgs);
  await probe.cleanup();
});
