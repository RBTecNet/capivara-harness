// Pass a built/transpiled module exporting runBuild. No model service is invoked.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { runBuild } = await import(pathToFileURL(resolve(process.argv[2] ?? 'packages/core/dist/index.js')).href);
const workspace = await mkdtemp(join(tmpdir(), 'capivara-wrong-provider-'));
const binding = {capability:'implementation-runtime',kind:'runtime',provider:'Node.js'};
const brief = {schema:'capivara/product/1',status:'ready',id:'node-cli',revision:1,name:'Greeting',summary:'A Node.js CLI.',request:'Create a Node.js CLI that prints hello.',modes:['cli'],targets:['portable'],requirements:[{id:'node-required',statement:'The CLI prints hello using Node.js.',source:{kind:'request',reference:'request',text:'Create a Node.js CLI that prints hello.'},mode:'cli',kind:'stack',binding}],constraints:[],decisions:[],gaps:[]};
const check = {id:'greeting',kind:'cli',command:'/bin/sh',args:['cli.sh'],expected:'contains:hello',level:'behavior',inputs:['cli.sh'],requirementIds:['node-required'],requiredCapabilities:[],conformance:{requirementId:'node-required',...binding,productInputs:['cli.sh']}};
const task = {id:'greeting',title:'Greeting',goal:'Print hello using Node.js.',instructions:'Implement the requested CLI.',requirementIds:['node-required'],dependsOn:[],environmentIds:['node'],contractIds:[],files:['cli.sh'],criteria:['The CLI prints hello and uses Node.js.'],checks:[check],risk:'normal',blockedBy:[]};
const plan = {schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[{id:'node',name:'Node.js',kind:'runtime',identity:binding,dependsOn:[],targets:['portable'],reason:'Mandatory product runtime.',check:{command:process.execPath,args:['--version']},prepare:[],provides:{command:[process.execPath]}}],contracts:[],tasks:[task],acceptance:[check]};
const calls=[];const started=Date.now();
try {
  const result=await runBuild({workspace,brief,plan,signal:AbortSignal.timeout(10000),agent:async request=>{
    calls.push(request.role);
    if(request.role==='editor'||request.role==='repair')await writeFile(join(request.workspace,'cli.sh'),"printf 'hello\\n'\n");
    return{status:'complete',text:request.role==='reviewer'?'{"approved":true,"findings":[]}':'Implemented.',commands:[],changedFiles:[]};
  }});
  process.stdout.write(JSON.stringify({sourceCommit:process.argv[3]??null,status:result.status,elapsedMs:Date.now()-started,agentCalls:calls,paidInferenceCalls:0,correctMandatoryProviderReady:result.state.environment.node?.ready===true,applicationExecutedWith:'/bin/sh',requiredRuntime:process.execPath,incidents:result.incidents.map(({kind,message,evidence})=>({kind,message,evidence}))},null,2)+'\n');
} finally {await rm(workspace,{recursive:true,force:true});}
