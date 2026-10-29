/** Replay the saved extraction through both engines. No inference or project
 * mutation is allowed; only source hashes and control results are published. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const database=process.argv[2];
if(!database)throw Error('Usage: node scripts/reproduce-init-citation.mjs BEFORE.sqlite [OUTPUT.json]');
const baseline='f0d38fb';
const output=resolve(root,process.argv[3]??'docs/rc2-evidence/init-citation-replay.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const db=new DatabaseSync(resolve(database),{readOnly:true});
let project;
try{project=JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);}finally{db.close();}
const responses=Object.values(project.domainCalls??{}).filter(call=>call.status==='complete'&&call.result).map(({operation,result})=>({operation,result}));
const discovery=responses.find(response=>response.operation==='discover');
const repairs=responses.filter(response=>response.operation==='repair');
assert.ok(discovery&&repairs.length,'Input must contain the saved discovery and metadata repairs.');
const temporary=await mkdtemp(join(tmpdir(),'capivara-init-citation-'));
try{
  const previous=join(temporary,'before');await mkdir(previous);
  const archive=spawnSync('git',['archive',baseline,'packages/core/src'],{cwd:root,maxBuffer:32*1024*1024});
  assert.equal(archive.status,0);
  assert.equal(spawnSync('tar',['-x','-C',previous],{input:archive.stdout}).status,0);
  await symlink(join(root,'node_modules'),join(temporary,'node_modules'));
  const apis={};
  for(const [name,path] of [['before',previous],['after',root]]){
    const api=join(temporary,`${name}.mjs`);
    await build({entryPoints:[join(path,'packages/core/src/domain/init.ts')],outfile:api,bundle:true,platform:'node',format:'esm',packages:'external',target:'node24',logLevel:'silent'});
    apis[name]=await import(pathToFileURL(api));
  }
  async function run(api,recorded){
    let repairCallbacks=0,discoveryCallbacks=0;const events=[];
    try{
      const brief=await api.runInit({request:project.request,...(recorded?{existing:structuredClone(project.brief),completedResponses:()=>responses}:{}),
        agent:async call=>{
          if(call.operation==='discover'){discoveryCallbacks++;return discovery.result;}
          const repair=repairs[repairCallbacks++];
          if(!repair)throw Error('Replay exhausted the already recorded answers; no paid call is permitted.');
          return repair.result;
        },ask:async()=>{throw Error('No user answer is present or invented in this reproduction.');},onEvent:event=>events.push(event.type)});
      return{result:'ready',requirements:brief.requirements.length,discoveryCallbacks,repairCallbacks,
        userDecisions:brief.decisions.length,sourceRecoveryCount:brief.requirements.filter(item=>item.source.citationRecovery).length,
        sourceIntervalsAreLiteral:brief.requirements.every(item=>project.request.includes(item.source.text)),
        recoveredIntervalsIncludeOmissions:brief.requirements.filter(item=>item.source.citationRecovery).every(item=>item.source.citationRecovery.includedGaps.every(gap=>item.source.text.includes(project.request.slice(gap.start,gap.end)))),
        requirementDigest:sha(JSON.stringify(brief.requirements)),events};
    }catch(error){return{result:'rejected',code:error.code??'exception',scope:error.scope,discoveryCallbacks,repairCallbacks,events};}
  }
  const before=await run(apis.before,true),fresh=await run(apis.after,false),resumed=await run(apis.after,true);
  assert.equal(before.result,'rejected');assert.equal(before.code,'no-progress');
  assert.equal(fresh.result,'ready');assert.equal(fresh.repairCallbacks,1);
  assert.equal(resumed.result,'ready');assert.equal(resumed.repairCallbacks,0);
  assert.equal(resumed.requirementDigest,fresh.requirementDigest);
  assert.ok(resumed.sourceRecoveryCount>0&&resumed.sourceIntervalsAreLiteral&&resumed.recoveredIntervalsIncludeOmissions);
  const paths=['domain/init.ts','domain/types.ts','domain/literal-source.ts','domain/requirement-metadata.ts'];
  const sources=await Promise.all(paths.map(async path=>({path:`packages/core/src/${path}`,sha256:sha(await readFile(join(root,'packages/core/src',path)))})));
  const result={schema:'capivara/init-citation-replay/1',generatedAt:new Date().toISOString(),baseline,
    input:{databaseSHA256:sha(await readFile(resolve(database))),savedAgentOutputs:responses.length,userDecisions:project.brief.decisions.length},sources,
    before,fresh,resumed,paidInferenceCalls:0,projectWrites:0,
    limits:['Callbacks return only the captured model outputs; no inference provider is called.','This replay proves citation recovery and reuse of one captured discovery, not universal extraction quality.']};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,before:before.result,fresh:fresh.result,resumed:resumed.result,freshRepairs:fresh.repairCallbacks,resumedRepairs:resumed.repairCallbacks,paidInferenceCalls:0}));
}finally{await rm(temporary,{recursive:true,force:true});}
