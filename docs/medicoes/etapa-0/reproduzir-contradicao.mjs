import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(process.argv[2]??`${here}/../../..`);
const { admitir, citacoesConferidas }=await import(pathToFileURL(`${repo}/packages/core/src/audit/admissibilidade.ts`));
const input=JSON.parse(readFileSync(`${here}/historicos/contradicao-fases.json`,'utf8'));
const output={engine:repo,method:'Função admitir do checkout atual, documentos reais após decisão aceita; não é replay integral do PLAN.',
  finding:input.finding,
  citations:citacoesConferidas(input.finding,input.places),
  admission:admitir(input.finding,input.places,[]),
  phase2ContainsImplementation:input.places.find(p=>p.nome==='Phase 2').texto.includes('implementar `redefinirSenha('),
  phase5ContainsImplementation:input.places.find(p=>p.nome==='Phase 5').texto.includes('implementar `redefinirSenha('),
  acceptedDecision:input.acceptedDecision,recordedFinalEvent:input.recordedFinalEvent,sources:input.sources};
console.log(JSON.stringify(output,null,2));
if(!output.admission.bloqueia||output.phase2ContainsImplementation||!output.phase5ContainsImplementation) process.exitCode=1;
