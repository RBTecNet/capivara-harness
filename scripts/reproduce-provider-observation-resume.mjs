import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Offline engine regression. No product directory or inference provider is used.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baselineCommit='bab97eb5836c60924dcec8bdf3fc7ff220caf899';
const destination=resolve(repository,process.argv[2]??'docs/rc2-evidence/provider-observation-resume.json');
const temporary=await mkdtemp(join(tmpdir(),'capivara-observer-upgrade-'));
const sha=value=>createHash('sha256').update(value).digest('hex');
async function sourceFiles(root){
  const files=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
    const path=join(root,entry.name);
    if(entry.isDirectory())files.push(...await sourceFiles(path));
    else if(entry.isFile())files.push(path);
  }
  return files.sort();
}

try{
  const archived=join(temporary,'baseline');await mkdir(archived);
  const archive=spawnSync('git',['archive',baselineCommit,'packages/core/src'],{cwd:repository,maxBuffer:30*1024*1024});
  assert.equal(archive.status,0,'The historical source must be available locally.');
  assert.equal(spawnSync('tar',['-x','-C',archived],{input:archive.stdout}).status,0);
  await symlink(join(repository,'node_modules'),join(temporary,'node_modules'));
  for(const [name,source] of [['baseline',join(archived,'packages/core/src')],['current',join(repository,'packages/core/src')]]){
    await build({stdin:{contents:`export {runBuild} from ${JSON.stringify(join(source,'execution/build.ts'))};`,resolveDir:repository,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:join(temporary,`${name}.mjs`),logLevel:'silent'});
  }
  const baseline=await import(pathToFileURL(join(temporary,'baseline.mjs')).href);
  const current=await import(pathToFileURL(join(temporary,'current.mjs')).href);
  const workspace=join(temporary,'project');await mkdir(workspace);
  const identity={capability:'compiler',kind:'sdk',provider:'Fixture SDK'};
  const requirement={id:'technology',statement:'Use Fixture SDK to compile and run the sum.',mode:'cli',kind:'stack',source:{kind:'request',reference:'request',text:'Use Fixture SDK to compile and run the sum.'},binding:identity};
  const brief={schema:'capivara/product/1',status:'ready',id:'product',revision:1,name:'Sum',summary:'Compile and execute a sum.',request:requirement.source.text,modes:['cli'],targets:['portable'],requirements:[requirement],constraints:[],decisions:[],gaps:[]};
  const compiler="import fs from 'node:fs';if(process.argv.includes('--version'))console.log('fixture-sdk 1');else{const [source,out]=process.argv.slice(2);const [left,right]=fs.readFileSync(source,'utf8').split('+').map(Number);fs.mkdirSync('out',{recursive:true});fs.writeFileSync(out,'console.log('+String(left+right)+');');}";
  await writeFile(join(workspace,'compiler.mjs'),compiler);await writeFile(join(workspace,'sum.expr'),'3+5');
  const produce={id:'produce',kind:'command',command:process.execPath,args:['compiler.mjs','sum.expr','out/run.mjs'],level:'build',inputs:['compiler.mjs','sum.expr'],outputs:['out/run.mjs'],requirementIds:['technology'],requiredCapabilities:[],conformance:{requirementId:'technology',...identity,productInputs:['sum.expr'],artifacts:['out/run.mjs']}};
  const exercise={id:'exercise',kind:'cli',command:process.execPath,args:['out/run.mjs'],level:'behavior',assertion:{type:'contains',value:'8'},inputs:['out/run.mjs'],dependsOn:['produce'],requirementIds:['technology'],requiredCapabilities:[]};
  const task={id:'sum',title:'Compiled sum',goal:'Compile and execute the sum.',instructions:'Implement the compiler and sum.',requirementIds:['technology'],dependsOn:[],environmentIds:['compiler'],contractIds:[],files:['compiler.mjs','sum.expr','out/run.mjs'],criteria:['The compiled program prints 8.'],checks:[produce,exercise],risk:'normal',blockedBy:[]};
  const plan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'product',briefRevision:1,environment:[{id:'compiler',name:'Fixture SDK',kind:'sdk',identity,dependsOn:[],targets:['portable'],reason:'Compile source.',check:{command:process.execPath,args:['compiler.mjs','--version']},prepare:[],provides:{command:[process.execPath,'compiler.mjs']}}],contracts:[],tasks:[task],acceptance:[]};
  let initialCallbacks=0,resumeCallbacks=0;
  const initial=await baseline.runBuild({workspace,brief,plan,agent:async request=>{
    initialCallbacks++;
    return{status:'complete',text:request.role==='reviewer'?'{"approved":true,"findings":[]}':'Existing sources are ready.',commands:[],changedFiles:[]};
  }});
  assert.equal(initial.status,'complete');
  const originalIds=new Set(initial.state.evidence.map(proof=>proof.id));
  const forbidInference=async()=>{resumeCallbacks++;throw Error('A mechanical instrument upgrade must not call an agent.');};
  const upgraded=await current.runBuild({workspace,brief,plan:initial.plan,state:structuredClone(initial.state),agent:forbidInference});
  const newProofs=upgraded.state.evidence.filter(proof=>!originalIds.has(proof.id));
  const upgradedIds=new Set(upgraded.state.evidence.map(proof=>proof.id));
  const resumed=await current.runBuild({workspace,brief,plan:upgraded.plan,state:structuredClone(upgraded.state),agent:forbidInference});
  const result={
    schema:'capivara/provider-observation-resume/1',capturedAt:new Date().toISOString(),baselineCommit,
    sourceDigest:sha(JSON.stringify(await Promise.all((await sourceFiles(join(repository,'packages/core/src'))).map(async path=>[relative(repository,path).replaceAll('\\','/'),sha(await readFile(path))])))),
    environment:{node:process.version,platform:process.platform},paidInferenceCalls:0,productProjectAccess:false,
    baseline:{status:initial.status,injectedAgentCallbacks:initialCallbacks,proofs:initial.state.evidence.length,hasConsumptionOrProcessWitnesses:initial.state.evidence.some(proof=>proof.provenance?.consumptions||proof.provenance?.processes)},
    upgrade:{status:upgraded.status,agentCallbacks:resumeCallbacks,newProofs:newProofs.length,proofsWithRealObservations:newProofs.filter(proof=>proof.provenance?.consumptions?.length||proof.provenance?.processes?.length).length},
    unchangedResume:{status:resumed.status,agentCallbacks:resumeCallbacks,newProofs:resumed.state.evidence.filter(proof=>!upgradedIds.has(proof.id)).length},
    sourcePreserved:await readFile(join(workspace,'compiler.mjs'),'utf8')===compiler&&await readFile(join(workspace,'sum.expr'),'utf8')==='3+5',
  };
  assert.equal(result.baseline.hasConsumptionOrProcessWitnesses,false);
  assert.equal(result.upgrade.status,'complete');assert.equal(result.upgrade.agentCallbacks,0);
  assert.equal(result.upgrade.newProofs,2);assert.equal(result.upgrade.proofsWithRealObservations,2);
  assert.equal(result.unchangedResume.status,'complete');assert.equal(result.unchangedResume.newProofs,0);assert.equal(result.sourcePreserved,true);
  await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await rm(temporary,{recursive:true,force:true});}
