import { createProgram } from './cli-program.js';

process.stdout.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') process.stderr.write(`${error.message}\n`); });
process.stderr.on('error', () => { /* A closed display is not a failure of the constructor. */ });
try { await createProgram().parseAsync(process.argv); }
catch (error) {
  process.stderr.write(`capivara: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
