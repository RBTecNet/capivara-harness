import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const here=dirname(fileURLToPath(import.meta.url));
const project=join(here,'resultados/B-01/produto');
const { comandoDoProjeto }=await import(pathToFileURL(join(project,'.capivara/flows/capivara-comando.ts')));
const home=mkdtempSync(join(tmpdir(),'capivara-prova-helper-'));
Object.assign(process.env,{CAPIVARA_RAIZ:project,NO_COLOR:'1',FORCE_COLOR:'1',TASKS_FILE:join(home,'dados.json')});
try {
  const result=await comandoDoProjeto(process.execPath,['src/cli.js','list']);
  let parsed=null,error=null;
  try {parsed=JSON.parse(result.saida);} catch(e){error=e.message;}
  console.log(JSON.stringify({method:'Ajudante real gerado pelo Core; Node emite aviso no stderr quando NO_COLOR e FORCE_COLOR coexistem. O filho continua com código 0.',
    ...result,parsed,error},null,2));
  if(result.codigo!==0||error===null)process.exitCode=1;
} finally {rmSync(home,{recursive:true,force:true});}
