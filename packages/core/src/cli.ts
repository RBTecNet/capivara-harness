import { createProgram } from "./cli-program.js";
import { withVersionAlias } from "./cli-program.js";
import { interruptActiveProviders } from "./provider/supervisor.js";

const interrupt = (signal: "SIGINT" | "SIGTERM"): void => {
  interruptActiveProviders();
  if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  process.exit(signal === "SIGINT" ? 130 : 143);
};
const sigint = (): void => interrupt("SIGINT");
const sigterm = (): void => interrupt("SIGTERM");
process.on("SIGINT", sigint);
process.on("SIGTERM", sigterm);
try {
  await createProgram().parseAsync(withVersionAlias(process.argv));
} finally {
  process.off("SIGINT", sigint);
  process.off("SIGTERM", sigterm);
}
