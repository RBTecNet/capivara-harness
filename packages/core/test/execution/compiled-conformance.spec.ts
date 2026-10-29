import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { emptyOperationalEnvironment, type OperationalEnvironment } from '../../src/execution/environment.js';
import { validateConformance } from '../../src/execution/conformance.js';
import { runVerification } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runTerminal } from '../../src/runtime/terminal.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const require=createRequire(import.meta.url),esbuild=require.resolve('esbuild'),tsc=resolve(dirname(require.resolve('typescript/package.json')),'bin/tsc');
async function fixture(kind:'library'|'sdk'='library'){
  const root=await mkdtemp(join(tmpdir(),'capivara-compiled-usage-'));roots.push(root);
  await mkdir(join(root,'src'));await mkdir(join(root,'vendor'));
  await writeFile(join(root,'vendor','provider.mjs'),'export const twice=value=>value*2;');
  await writeFile(join(root,'src','main.ts'),kind==='library'?"import {twice} from '../vendor/provider.mjs';const value:number=twice(4);console.log('RESULT '+value);":"const value:number=4+4;console.log('RESULT '+value);");
  await writeFile(join(root,'build.mjs'),`import {build} from ${JSON.stringify(esbuild)};import {readFile} from 'node:fs/promises';await build({entryPoints:['src/main.ts'],outfile:'dist/run.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'file-loader',setup(builder){builder.onLoad({filter:/\\.[cm]?[jt]s$/},async args=>({contents:await readFile(args.path,'utf8'),loader:args.path.endsWith('.ts')?'ts':'js'}));}}]});`);
  await writeFile(join(root,'verify.mjs'),`import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';const server=createServer(async(req,res)=>{try{res.end(await readFile('dist/run.mjs'));}catch(error){res.statusCode=500;res.end(String(error));}});await new Promise(done=>server.listen(0,'127.0.0.1',done));try{const response=await fetch('http://127.0.0.1:'+server.address().port);if(response.status!==200)throw Error('HTTP failed');const source=await response.text();await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}finally{await new Promise(done=>server.close(done));}`);
  const identity={capability:'implementation',kind,provider:kind==='library'?'SourceLibrary':'TypeScript'};
  const product:ProductBrief={schema:'capivara/product/1',status:'ready',id:'p',revision:1,name:'Computed output',summary:'Build and exercise the output.',request:'Use '+identity.provider,modes:['cli'],targets:['portable'],requirements:[{id:'stack',statement:'Use '+identity.provider,mode:'cli',kind:'stack',source:{kind:'request',reference:'request',text:'Use '+identity.provider+'.'},binding:identity}],constraints:[],decisions:[],gaps:[]};
  const claim={requirementId:'stack',...identity,productInputs:['src/main.ts'],providerInputs:kind==='library'?['vendor/provider.mjs']:[]};
  const build:Verification={id:'build',kind:'command',command:process.execPath,args:['build.mjs'],inputs:['build.mjs','src/main.ts','vendor/provider.mjs'],outputs:['dist/run.mjs'],level:'build',requirementIds:kind==='library'?['stack','business']:['business'],requiredCapabilities:[],...(kind==='library'?{conformance:claim}:{})};
  const behavior:Verification={id:'http-exercise',kind:'cli',command:process.execPath,args:['verify.mjs'],inputs:['verify.mjs','dist/run.mjs'],level:'behavior',assertion:{type:'contains',value:'RESULT 8'},requirementIds:['business'],requiredCapabilities:[]};
  const check:Verification=kind==='library'?build:{id:'typecheck',kind:'command',command:'npm',args:['run','typecheck'],inputs:['src/main.ts','package.json'],level:'syntax',requirementIds:['stack'],requiredCapabilities:[],conformance:claim};
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{typecheck:`"${process.execPath}" "${tsc}" --noEmit --target esnext --skipLibCheck src/main.ts`}}));
  const task:WorkUnit={id:'delivery',title:'Computed output',goal:'Print the result after building.',instructions:'Build the actual typed source.',requirementIds:['stack','business'],dependsOn:[],environmentIds:['provider'],contractIds:[],files:['src/main.ts','vendor/provider.mjs','build.mjs','verify.mjs','package.json'],criteria:['The result is 8.'],checks:kind==='library'?[check,behavior]:[check,build,behavior],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'p',briefRevision:1,environment:[],contracts:[],tasks:[task],acceptance:[]};
  const operational:OperationalEnvironment={...emptyOperationalEnvironment(root),bindings:{implementation:{...identity,ready:true,inputs:kind==='library'?['vendor/provider.mjs']:[],...(kind==='sdk'?{command:[process.execPath,tsc]}:{})}}};
  const run=(recipe:Verification)=>runVerification(root,product,task,plan,recipe,executeCommand,runTerminal,{operational});
  return{root,product,identity,claim,check,build,behavior,task,plan,operational,run};
}

it('proves a compiled library from real filesystem imports, production output and HTTP artifact consumption without argv or dependency-ID requirements',async()=>{
  const item=await fixture(),build=await item.run(item.build),behavior=await item.run(item.behavior);
  expect(build.evidence.passed,build.evidence.output).toBe(true);expect(behavior.evidence.passed,behavior.evidence.output).toBe(true);
  expect(build.evidence.provenance?.consumptions?.some(read=>read.path==='vendor/provider.mjs'&&read.method==='file-read')).toBe(true);
  expect(behavior.evidence.provenance?.consumptions?.some(read=>read.path==='dist/run.mjs'&&read.method==='file-read')).toBe(true);
  expect(item.behavior.dependsOn).toBeUndefined();expect(item.behavior.args).toEqual(['verify.mjs']);
  expect(await validateConformance(item.product,item.plan,item.operational,[build.evidence,behavior.evidence],item.root)).toEqual([]);
  await writeFile(join(item.root,'dist/run.mjs'),"console.log('stale output');");
  expect((await validateConformance(item.product,item.plan,item.operational,[build.evidence,behavior.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('keeps a snapshot-only artifact reference inconclusive when the functional command merely prints a marker',async()=>{
  const item=await fixture(),build=await item.run(item.build);
  await writeFile(join(item.root,'verify.mjs'),"console.log('RESULT 8');");
  const behavior=await item.run(item.behavior);expect(behavior.evidence.passed).toBe(true);
  expect(behavior.evidence.provenance?.inputs['dist/run.mjs']).toBeDefined();
  expect(behavior.evidence.provenance?.consumptions?.some(read=>read.path==='dist/run.mjs')).toBe(false);
  expect((await validateConformance(item.product,item.plan,item.operational,[build.evidence,behavior.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('composes an npm-dispatched real non-emitting SDK check with a different production builder and actual artifact behavior',async()=>{
  const item=await fixture('sdk'),checked=await item.run(item.check),build=await item.run(item.build),behavior=await item.run(item.behavior);
  expect(checked.evidence.passed,checked.evidence.output).toBe(true);expect(build.evidence.passed,build.evidence.output).toBe(true);expect(behavior.evidence.passed,behavior.evidence.output).toBe(true);
  expect(checked.evidence.provenance?.processes?.some(process=>process.entryPoint.path===tsc&&process.argv.includes('--noEmit'))).toBe(true);
  expect(await validateConformance(item.product,item.plan,item.operational,[checked.evidence,build.evidence,behavior.evidence],item.root)).toEqual([]);
  expect((await validateConformance(item.product,item.plan,item.operational,[checked.evidence],item.root))[0]?.message).toContain('non-emitting');
  const wrong=structuredClone(checked.evidence);wrong.provenance!.processes![0]!.entryPoint.hash='changed-program';
  // Change every matching SDK process, preserving unrelated npm observations.
  for(const process of wrong.provenance!.processes??[])if(process.entryPoint.path===tsc)process.entryPoint.hash='changed-program';
  expect((await validateConformance(item.product,item.plan,item.operational,[wrong,build.evidence,behavior.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('does not treat compiler bootstrap reads or import text in comments as compiled product use',async()=>{
  const item=await fixture();
  await writeFile(join(item.root,'src/main.ts'),"// import {twice} from '../vendor/provider.mjs';\nconsole.log('RESULT 8');");
  const compiler=await readFile(join(item.root,'build.mjs'),'utf8');await writeFile(join(item.root,'build.mjs'),compiler+"\nawait readFile('vendor/provider.mjs');");
  const build=await item.run(item.build),behavior=await item.run(item.behavior);
  expect(build.evidence.passed).toBe(true);expect(behavior.evidence.passed).toBe(true);
  expect(build.evidence.provenance?.consumptions?.some(read=>read.path==='vendor/provider.mjs')).toBe(true);
  expect((await validateConformance(item.product,item.plan,item.operational,[build.evidence,behavior.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('does not promote a consumed package manifest into compiled library usage',async()=>{
  const item=await fixture();await writeFile(join(item.root,'vendor','package.json'),JSON.stringify({name:'source-library',version:'1.0.0'}));
  await writeFile(join(item.root,'src/main.ts'),"import metadata from '../vendor/package.json';console.log('RESULT '+metadata.version);");
  item.operational.bindings.implementation!.inputs=['vendor'];item.build.inputs!.push('vendor/package.json');
  const compiler=await readFile(join(item.root,'build.mjs'),'utf8');await writeFile(join(item.root,'build.mjs'),compiler+"\nawait readFile('vendor/package.json');");
  item.behavior.assertion={type:'contains',value:'RESULT 1.0.0'};
  const build=await item.run(item.build),behavior=await item.run(item.behavior);expect(build.evidence.passed,build.evidence.output).toBe(true);expect(behavior.evidence.passed,behavior.evidence.output).toBe(true);
  expect((await validateConformance(item.product,item.plan,item.operational,[build.evidence,behavior.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('supports a client SDK as an actually imported module without requiring it to emit a binary',async()=>{
  const item=await fixture('sdk');
  await writeFile(join(item.root,'client.mjs'),"import {twice} from './vendor/provider.mjs';if(twice(4)!==8)throw Error('wrong');console.log('CLIENT_OK');");
  item.operational.bindings.implementation!.modules=[{protocol:'node',specifier:'./vendor/provider.mjs',runtimeCommand:[process.execPath]}];
  const check:Verification={id:'client',kind:'cli',command:process.execPath,args:['client.mjs'],inputs:['client.mjs'],level:'behavior',assertion:{type:'contains',value:'CLIENT_OK'},requirementIds:['stack'],requiredCapabilities:[],conformance:{...item.claim,productInputs:['client.mjs']}};
  item.task.checks=[check];const result=await item.run(check);expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect(await validateConformance(item.product,item.plan,item.operational,[result.evidence],item.root)).toEqual([]);
});

it('proves compiled use through a declared package entrypoint and real logical read receipt when node_modules is an external symlink',async()=>{
  const item=await fixture(),cache=await mkdtemp(join(tmpdir(),'capivara-provider-cache-'));roots.push(cache);
  const packageRoot=join(cache,'node_modules','external-ui');await mkdir(packageRoot,{recursive:true});
  await writeFile(join(packageRoot,'package.json'),JSON.stringify({name:'external-ui',type:'module',exports:'./entry.mjs'}));
  await writeFile(join(packageRoot,'entry.mjs'),'export const twice=value=>value*2;');
  await symlink(join(cache,'node_modules'),join(item.root,'node_modules'),'dir');
  await writeFile(join(item.root,'src/main.ts'),"import {twice} from 'external-ui';const value:number=twice(4);console.log('RESULT '+value);");
  item.operational.bindings.implementation!.modules=[{protocol:'node',specifier:'external-ui',runtimeCommand:[process.execPath]}];
  item.operational.bindings.implementation!.inputs=[];item.build.conformance!.providerInputs=[];
  const build=await item.run(item.build),behavior=await item.run(item.behavior);
  expect(build.evidence.passed,build.evidence.output).toBe(true);expect(behavior.evidence.passed,behavior.evidence.output).toBe(true);
  const reads=build.evidence.provenance!.consumptions??[];
  expect(reads.some(read=>read.path==='node_modules/external-ui/entry.mjs'&&read.method==='file-read')).toBe(true);
  expect(await validateConformance(item.product,item.plan,item.operational,[build.evidence,behavior.evidence],item.root)).toEqual([]);
  const snapshotOnly=structuredClone(build.evidence);snapshotOnly.provenance!.consumptions=reads.filter(read=>read.path!=='node_modules/external-ui/entry.mjs');
  expect((await validateConformance(item.product,item.plan,item.operational,[snapshotOnly,behavior.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
  await rm(join(packageRoot,'entry.mjs'));
  expect((await validateConformance(item.product,item.plan,item.operational,[build.evidence,behavior.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});
