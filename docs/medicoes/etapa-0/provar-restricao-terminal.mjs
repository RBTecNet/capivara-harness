import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const project=resolve(process.argv[2]);
const data=mkdtempSync(join(tmpdir(),'capivara-restricao-terminal-'));
const checks=[];
try {
  const env={...process.env,PORT:'0',HOST:'127.0.0.1',TASKS_FILE:join(data,'tarefas.json')};
  for(const args of [['list'],[]]) {
    const start=performance.now();
    const result=spawnSync(process.execPath,[join(project,'src/cli.js'),...args],{cwd:project,env,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
    const output=result.stdout?.trim()??'';
    // Sem comando, a CLI pode apresentar ajuda, listar ou recusar a entrada.
    // O produto explicitamente não oferece servidor/serviço permanente.
    const passed=!result.error&&(args.length===0||(result.status===0&&output==='[]'));
    checks.push({name:args.length?'list continua sendo comando com PORT definida':'entrada sem comando não cria serviço HTTP',
      args,passed,durationMs:Math.round(performance.now()-start),status:result.status,signal:result.signal,
      stdout:output,stderr:result.stderr?.trim()??'',error:result.error?.message??null});
  }
} finally {rmSync(data,{recursive:true,force:true});}
console.log(JSON.stringify({method:'Prova suplementar da restrição original sem servidor, aplicada igualmente aos braços e ao commit antes do reparo. PORT=0 usa porta efêmera; resposta sem argumento não é prescrita.',
  tests:checks,passed:checks.filter(c=>c.passed).length,total:checks.length},null,2));
if(checks.some(c=>!c.passed))process.exitCode=2;
