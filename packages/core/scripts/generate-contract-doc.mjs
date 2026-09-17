/**
 * Renderiza docs/capivara-phases-v1.md a partir de src/contract/doc.ts.
 *
 * Transpila em memória com o esbuild que já é dependência de desenvolvimento,
 * evitando depender do dist: o documento pode ser regenerado antes do build.
 */
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/contract/doc.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "warning",
});

const code = bundled.outputFiles[0].text;
const { renderContractDocument } = await import(`data:text/javascript,${encodeURIComponent(code)}`);

const target = new URL("../../../docs/capivara-phases-v1.md", import.meta.url);
await writeFile(target, renderContractDocument(), "utf8");
console.log(`escrito: ${target.pathname}`);
