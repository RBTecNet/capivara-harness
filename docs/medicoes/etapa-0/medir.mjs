import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { provarProduto } from './provar-produto.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const repo=resolve(option('--repo',join(here,'../../..')));
const arm=option('--arm','A');
if(!['A','B','C'].includes(arm)) throw new Error('--arm A|B|C');
const output=resolve(option('--out',join(tmpdir(),`capivara-etapa0-${arm}-${Date.now()}`)));
const project=join(output,'produto');
if(existsSync(output)) throw new Error('A saída já existe; cada amostra precisa de uma pasta nova.');
mkdirSync(project,{recursive:true});
const core=await import(pathToFileURL(join(repo,'packages/core/dist/index.js')));
const model=option('--model','gpt-6.1-sol'), effort=option('--effort','high');
const command=(bin,argv,cwd=project)=>execFileSync(bin,argv,{cwd,encoding:'utf8',timeout:30000}).trim();
const specification=readFileSync(join(here,'pedido.txt'),'utf8');
const git=(...argv)=>command('git',argv);
git('init','-q','-b','main'); git('config','user.email','benchmark@localhost'); git('config','user.name','Benchmark Capivara');
writeFileSync(join(project,'.gitignore'),'node_modules/\ndata/\n.capivara/runs/\n.capivara/handoffs/\n.capivara/worktrees/\n.capivara/node_modules/\n');
git('add','.gitignore'); git('commit','-qm','ambiente inicial equivalente');
const roles=core.resolveRoles({global:{provider:'codex',model,effort},roles:{}});
const calls=[],stages=[],questions=[];
const startedAt=new Date().toISOString(), began=performance.now();
const provenance={schema:'capivara-etapa0/v1',arm,engineCommit:command('git',['rev-parse','HEAD'],repo),engineVersion:core.VERSION,
  engineDiff:command('git',['diff','--name-only','--','packages/core/src'],repo),model,effort,provider:'codex',cli:command('codex',['--version'],repo),
  node:process.version,platform:process.platform,arch:process.arch,requestSha256:createHash('sha256').update(specification).digest('hex'),
  sample:1,startedAt,project,limits:{...core.DEFAULT_LIMITS},
  counting:'sessões externas de agente; requisições internas ao provider não observáveis',costUsd:null};
writeFileSync(join(output,'proveniencia.json'),JSON.stringify(provenance,null,2));
writeFileSync(join(output,'pedido.txt'),specification);
let stage='direct', sequence=0;
async function invoke(request,root=project,environment) {
  const id=String(++sequence).padStart(3,'0'), phaseStage=stage;
  const label=[phaseStage,request.role,request.purpose??(request.repair?'repair':request.stage)].join('.');
  const raw=createWriteStream(join(output,`${id}.${label}.jsonl`));
  const errors=createWriteStream(join(output,`${id}.${label}.stderr.log`));
  writeFileSync(join(output,`${id}.prompt.txt`),request.prompt);
  const t=performance.now(), timestamp=new Date().toISOString();
  appendFileSync(join(output,'eventos.jsonl'),JSON.stringify({type:'call.started',id,label,timestamp})+'\n');
  console.log(`${timestamp} INICIO ${id} ${label}`);
  const bridge=core.createAgentBridge({projectRoot:root,runId:`benchmark-${arm}`,language:'pt-BR',roles,limits:core.DEFAULT_LIMITS,systemInstall:false,...environment?{environment}:{}});
  let result;
  try {result=await bridge({...request,onOutput:(chunk,stream)=>(stream==='out'?raw:errors).write(core.redact(chunk))});}
  finally {await Promise.all([new Promise(r=>raw.end(r)),new Promise(r=>errors.end(r))]);}
  const metric={id,label,stage:phaseStage,role:request.role,repair:request.repair===true,purpose:request.purpose??null,durationMs:Math.round(performance.now()-t),
    timestamp,exitCode:result.exitCode,timedOut:result.timedOut,resultRead:result.resultRead,providerFailure:result.providerFailure??null,
    usage:result.usage?{inputTokens:result.usage.inputTokens,cachedInputTokens:result.usage.cachedInputTokens,outputTokens:result.usage.outputTokens,costUsd:result.usage.costUsd??null}:null};
  calls.push(metric);
  appendFileSync(join(output,'eventos.jsonl'),JSON.stringify({type:'call.completed',...metric})+'\n');
  writeFileSync(join(output,`${id}.response.txt`),result.stdout);
  writeFileSync(join(output,'chamadas.json'),JSON.stringify(calls,null,2));
  console.log(`${new Date().toISOString()} FIM ${id} ${label} ${metric.durationMs}ms exit=${result.exitCode}`);
  return result;
}
const announce=message=>appendFileSync(join(output,'core.log'),`${new Date().toISOString()} ${message}\n`);
async function timed(name,fn){stage=name;const t=performance.now();try{return await fn();}finally{stages.push({stage:name,durationMs:Math.round(performance.now()-t)});}}
let outcome=null,error=null;
try {
  if(arm==='A') outcome=await timed('direct',()=>invoke({role:'builder',stage:'direct',prompt:specification}));
  else {
    const request=await core.resolveRequest(project,{prompt:specification});
    const ask=async question=>{
      const record={id:question.id,decision:question.decision,recommended:question.recommended};
      questions.push(record);writeFileSync(join(output,'perguntas.json'),JSON.stringify(questions,null,2));
      if(question.id==='banco-de-dados') return '4';
      throw new Error(`Decisão material não automatizada pelo benchmark: ${question.decision}`);
    };
    const agentCall=c=>invoke({role:c.role,stage:`${c.stage}:${c.subject}`,prompt:c.prompt});
    const common={projectRoot:project,request,language:'pt-BR',call:agentCall,ask,announce,providers:{writer:'codex',auditor:'codex',verifier:'codex'}};
    const init=await timed('init',()=>core.runInit({...common,stage:'init'}));
    if(!init.readiness.ready) throw new Error(`INIT: ${init.rendered}`);
    await core.commitSpecification(project,'PLAN READY');
    const plan=await timed('plan',()=>core.runPlan(common));
    if(!plan.readiness.ready) throw new Error(`PLAN: ${plan.rendered}`);
    await core.commitSpecification(project,'RALPH READY');
    const skeleton=await core.readSkeletonState(project,init.runId);
    const architecture=(await core.readArchitectureState(project,init.runId))?.architecture;
    outcome=await timed('build',()=>core.runBuild({projectRoot:project,language:'pt-BR',engine:'codex',roles,skeleton,architecture,
      systemInstall:false,maxCycles:3,maxVerifierRepairs:1,verifierResume:core.contratoDaRetomada('codex'),announce,
      call:c=>invoke({role:c.role,stage:c.purpose??(c.repair?'repair':'implement'),prompt:c.prompt,
        ...c.purpose?{purpose:c.purpose}:{},...c.repair?{repair:true}:{},...c.resumeSession?{resumeSessionId:c.resumeSession}:{}},c.root??project,c.environment)}));
  }
} catch(e){error={name:e.name,message:e.message};announce(`${e.name}: ${e.message}`);console.log(`PARADA ${e.message}`);}
const durationMs=Math.round(performance.now()-began);
const proof=provarProduto(project);
const known=calls.filter(c=>c.usage), sum=key=>known.reduce((n,c)=>n+(c.usage[key]??0),0);
const summaries={...provenance,finishedAt:new Date().toISOString(),durationMs,stages,agentSessions:calls.length,providerApiRequests:null,
  byRole:Object.fromEntries([...new Set(calls.map(c=>c.role))].map(r=>[r,calls.filter(c=>c.role===r).length])),
  implementationSessionMs:calls.filter(c=>c.role==='builder'||c.repair).reduce((n,c)=>n+c.durationMs,0),
  planningSessionMs:calls.filter(c=>['init','plan'].includes(c.stage)).reduce((n,c)=>n+c.durationMs,0),
  independentReviewSessionMs:calls.filter(c=>c.stage==='build'&&c.role==='verifier'&&!c.repair).reduce((n,c)=>n+c.durationMs,0),
  tokenReportingCalls:known.length,inputTokens:known.length?sum('inputTokens'):null,outputTokens:known.length?sum('outputTokens'):null,
  cachedInputTokens:known.length?sum('cachedInputTokens'):null,costUsd:known.length===calls.length&&known.length&&known.every(c=>c.usage.costUsd!==null)?sum('costUsd'):null,
  repairSessions:calls.filter(c=>c.repair||(/repair/.test(c.label))).length,interruptedCalls:calls.filter(c=>c.timedOut||c.exitCode!==0).length,
  questions,error,outcome,proof};
writeFileSync(join(output,'resultado.json'),JSON.stringify(summaries,null,2));
console.log(JSON.stringify({arm,agentSessions:calls.length,durationMs,error,proofPassed:proof.passed,proofTotal:proof.total,output}));
if(error || proof.passed!==proof.total || (arm==='A'&&outcome?.exitCode!==0) || (arm!=='A'&&outcome?.exitCode!==0)) process.exitCode=2;
