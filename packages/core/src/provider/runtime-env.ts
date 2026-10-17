import { delimiter, dirname } from "node:path";

/** npm, scripts, servidor e gates devem usar o mesmo Node que iniciou o harness. */
export function runtimeEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const directory = dirname(process.execPath);
  const path = (environment.PATH ?? "").split(delimiter).filter((entry) => entry !== directory);
  return { ...environment, PATH: [directory, ...path].join(delimiter), NODE: process.execPath };
}
