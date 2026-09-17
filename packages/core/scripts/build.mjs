import { chmod, readFile } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  define: { __CAPIVARA_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "warning",
};

await build({ ...shared, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node" } });
await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });
await chmod("dist/cli.js", 0o755);
