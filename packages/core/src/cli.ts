import { createProgram } from "./cli-program.js";
import { withVersionAlias } from "./cli-program.js";

createProgram().parse(withVersionAlias(process.argv));
