import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const rows=[];
for(const name of readdirSync(join(here,'resultados')).sort()) {
  const root=join(here,'resultados',name);
  if(!existsSync(join(root,'resultado.json'))) continue;
  const result=read(join(root,'resultado.json'));
  const calls=read(join(root,'chamadas.json'));
  const log=existsSync(join(root,'core.log'))?readFileSync(join(root,'core.log'),'utf8'):'';
  const acceptanceRepairs=[...log.matchAll(/^(\S+) aceitação reprovou .*ciclo de correção (\d+)/gm)];
  const repairedCalls=new Set(calls.filter(c=>c.repair).map(c=>`${c.id}:${c.label}`));
  for(const match of acceptanceRepairs) {
    const call=calls.filter(c=>c.role==='builder'&&c.stage==='build'&&c.timestamp>=match[1]).sort((a,b)=>a.timestamp.localeCompare(b.timestamp))[0];
    if(call) repairedCalls.add(`${call.id}:${call.label}`);
  }
  const transcripts=readdirSync(root).filter(f=>/^\d+\..+\.jsonl$/.test(f));
  const providerErrors=[];
  const commands=[];
  for(const file of transcripts) {
    for(const line of readFileSync(join(root,file),'utf8').trim().split('\n')) {
      let event;try {event=JSON.parse(line);} catch {continue;}
      if(event.type==='error') providerErrors.push({file,message:event.message});
      if(event.type==='item.completed'&&event.item?.type==='command_execution') commands.push({file,exitCode:event.item.exit_code});
    }
  }
  rows.push({sample:name,arm:result.arm,commit:result.engineCommit,model:result.model,effort:result.effort,requestSha256:result.requestSha256,
    totalSeconds:result.durationMs/1000,stages:result.stages,agentSessions:result.agentSessions,byRole:result.byRole,
    inputTokensReported:result.inputTokens,cachedInputTokensReported:result.cachedInputTokens,outputTokensReported:result.outputTokens,
    sessionsWithUsage:result.tokenReportingCalls,providerApiRequests:null,costUsd:result.costUsd,
    implementationAndRepairSessionSeconds:result.implementationSessionMs/1000,
    planningSessionSeconds:result.planningSessionMs/1000,independentReviewSessionSeconds:result.independentReviewSessionMs/1000,
    sessionsByStage:Object.fromEntries([...new Set(calls.map(c=>c.stage))].map(s=>[s,calls.filter(c=>c.stage===s).length])),
    codeRepairSessions:repairedCalls.size,acceptanceRepairSessions:acceptanceRepairs.length,
    initStructuralRewrites:(log.match(/esqueleto veio com .*pedindo de novo/g)??[]).length,
    unreadReviewRetries:(log.match(/uma revisão a mais, com o protocolo repetido/g)??[]).length,
    interruptedCalls:result.interruptedCalls,providerErrors,questions:result.questions,
    externalChecks:{passed:result.proof.passed,total:result.proof.total,durationMs:result.proof.durationMs},
    terminalRestrictionChecks:existsSync(join(root,'restricao-terminal.json'))?read(join(root,'restricao-terminal.json')):null,
    beforeAcceptanceChecks:existsSync(join(root,'antes-aceitacao-prova.json'))?read(join(root,'antes-aceitacao-prova.json')):null,
    beforeAcceptanceTerminalChecks:existsSync(join(root,'antes-aceitacao-restricao-terminal.json'))?read(join(root,'antes-aceitacao-restricao-terminal.json')):null,
    commandToolCompletions:commands.length,nonzeroCommandToolExits:commands.filter(c=>c.exitCode!==0).length,
    error:result.error,engineExitCode:result.outcome?.exitCode??null,
    engineAccepted:result.arm==='A'?null:result.outcome?.acceptance?.accepted??null,
    engineAcceptanceNotes:result.outcome?.acceptance?.naoVerificado??[],
    caveat:'Tempos por sessão incluem planejamento/testes internos; sessões paralelas somam mais que o tempo de parede. Contagem não revela requisições internas ao provider. codeRepairSessions inclui reparos da aceitação identificados no registro do Core.'});
}
const summary={stage:0,simplifiedArm:'C pendente de aprovação das etapas seguintes',rows};
writeFileSync(join(here,'resumo.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
