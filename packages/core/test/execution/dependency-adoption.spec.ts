import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCommand } from '../../src/runtime/command.js';
import { prepareEnvironmentNode, prepareProjectDependencies, projectInstallationEnvironment, relocateOperationalEnvironment } from '../../src/execution/environment.js';
import type { EnvironmentNode, ProductBrief } from '../../src/domain/types.js';
import type { CommandRequest } from '../../src/runtime/types.js';

const folders:string[]=[];
afterEach(async()=>{await Promise.all(folders.splice(0).map(folder=>rm(folder,{recursive:true,force:true})));});

it.skipIf(process.platform==='win32')('adopts intact acquisition without ci deleting repairs while native readiness remains consumer-specific',async()=>{
  const root=await mkdtemp(join(tmpdir(),'capivara-dependency-adoption-'));folders.push(root);
  const installed=join(root,'node_modules','repaired-provider');await mkdir(installed,{recursive:true});
  const marker=join(installed,'native.ready');
  await writeFile(join(root,'package.json'),JSON.stringify({name:'adoption-fixture',version:'1.0.0',dependencies:{'repaired-provider':'1.0.0'}}));
  await writeFile(join(root,'package-lock.json'),JSON.stringify({name:'adoption-fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'adoption-fixture',version:'1.0.0',dependencies:{'repaired-provider':'1.0.0'}},'node_modules/repaired-provider':{version:'1.0.0',hasInstallScript:true}}}));
  await writeFile(join(installed,'package.json'),JSON.stringify({name:'repaired-provider',version:'1.0.0',main:'index.cjs',scripts:{install:'node build.cjs'}}));
  await writeFile(join(installed,'index.cjs'),"module.exports=()=>require('node:fs').readFileSync(require('node:path').join(__dirname,'native.ready'),'utf8');");
  await writeFile(marker,'native-capability-ready');
  const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'Fixture',summary:'Run a CLI.',request:'Run a CLI.',modes:['cli'],targets:[],requirements:[],constraints:[],decisions:[],gaps:[]};
  const node:EnvironmentNode={id:'provider',name:'Prepared provider',kind:'package',identity:{capability:'record-store',kind:'driver',provider:'SelectedStore'},dependsOn:[],targets:[],reason:'Serve actual records.',check:{command:process.execPath,args:['-e',"console.log(require('repaired-provider')())"]},prepare:[],provides:{modules:[{protocol:'node',specifier:'repaired-provider',runtimeCommand:[process.execPath]}],inputs:['node_modules/repaired-provider/native.ready']}};
  const prepared=await prepareEnvironmentNode(root,node,brief,executeCommand);expect(prepared.ready).toBe(true);
  const calls:string[]=[];
  const execute=async(request:CommandRequest)=>{
    const command=typeof request.command==='string'?request.command:request.command.join(' ');calls.push(command);
    if(/\b(?:npm (?:ci|install)|pnpm install)\b/.test(command)){
      await rm(marker,{force:true});
      return{command,cwd:request.cwd,exitCode:1,stdout:'',stderr:'An unnecessary clean install deleted the repaired artifact.',durationMs:0,timedOut:false,cancelled:false,signal:null,fingerprint:'destructive-install'};
    }
    return executeCommand(request);
  };
  const first=await prepareProjectDependencies(root,brief,execute,{inputs:['main.mjs'],operational:prepared.operational});
  expect(first.ready).toBe(true);expect(await readFile(marker,'utf8')).toBe('native-capability-ready');
  expect(calls.some(command=>/\bnpm ls\b/.test(command))).toBe(true);expect(calls.some(command=>/\bnpm ci\b/.test(command))).toBe(false);
  expect(first.operational.bindings['project-dependencies:javascript']!.installationReceipt).toMatchObject({schema:'capivara/project-installation/1',scope:'package-inventory',family:'javascript',pendingLifecycles:[],validation:{exitCode:0}});
  const privateRoot=await mkdtemp(join(tmpdir(),'capivara-dependency-private-'));folders.push(privateRoot);
  for(const name of ['package.json','package-lock.json'])await copyFile(join(root,name),join(privateRoot,name));
  await cp(join(root,'node_modules'),join(privateRoot,'node_modules'),{recursive:true});
  const before=calls.length;
  const second=await prepareProjectDependencies(privateRoot,brief,execute,{operational:relocateOperationalEnvironment(first.operational,root,privateRoot),inputs:['main.mjs']});
  expect(second.ready).toBe(true);expect(calls.length).toBe(before);expect(await readFile(marker,'utf8')).toBe('native-capability-ready');
  expect(second.fingerprint).toBe(first.fingerprint);
  await rm(join(privateRoot,'node_modules'),{recursive:true});await symlink(join(root,'node_modules'),join(privateRoot,'node_modules'),'dir');
  const linked=await prepareProjectDependencies(privateRoot,brief,execute,{operational:relocateOperationalEnvironment(first.operational,root,privateRoot),inputs:['main.mjs']});
  expect(linked.ready).toBe(true);expect(linked.fingerprint).toBe(first.fingerprint);expect(calls.length).toBe(before);
  const scoped=await prepareProjectDependencies(privateRoot,brief,execute,{operational:projectInstallationEnvironment(relocateOperationalEnvironment(first.operational,root,privateRoot)),inputs:['main.mjs']});
  expect(scoped.ready).toBe(true);expect(scoped.fingerprint).toBe(first.fingerprint);expect(calls.length).toBe(before);expect(scoped.operational.bindings['record-store']).toBeUndefined();
  expect(scoped.operational.bindings['project-dependencies:javascript']!.pendingLifecycles).toEqual(['repaired-provider']);
  // Acquisition stays intact while the actual native consumer remains broken.
  await rm(marker);
  const broken=await prepareEnvironmentNode(root,node,brief,executeCommand,{previous:prepared.cache});expect(broken.ready).toBe(false);
  const unavailable=await prepareProjectDependencies(root,brief,execute,{operational:broken.operational,previous:first.cache,inputs:['main.mjs']});
  expect(unavailable.ready).toBe(true);expect(unavailable.incidents).toEqual([]);expect(calls.length).toBe(before);
  expect(unavailable.operational.bindings['record-store']!.ready).toBe(false);
  expect(unavailable.operational.bindings['project-dependencies:javascript']!.installationReceipt?.pendingLifecycles).toEqual(['repaired-provider']);
  const consumer=await executeCommand({cwd:root,command:[process.execPath,'-e',"console.log(require('repaired-provider')())"]});
  expect(consumer.exitCode).not.toBe(0);expect(consumer.stderr).toContain('native.ready');
});
