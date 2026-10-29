import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, ProviderModule, Verification, WorkUnit } from '../../src/domain/types.js';
import { prepareEnvironmentNode } from '../../src/execution/environment.js';
import { validateConformance } from '../../src/execution/conformance.js';
import { runVerification } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runTerminal } from '../../src/runtime/terminal.js';
import { inferProviderModule } from '../../src/runtime/provider-observation.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const pythonAvailable=spawnSync('python3',['-c','import sqlite3'],{stdio:'ignore'}).status===0;
const identity={capability:'file-sql',kind:'library' as const,provider:'SQLite'};
const product:ProductBrief={schema:'capivara/product/1',status:'ready',id:'p',revision:1,name:'Stored rows',summary:'Persist and read a row.',request:'Use SQLite to persist a row and read it after reopening.',modes:['cli'],targets:['portable'],requirements:[{id:'storage',statement:'Persist and read a row using SQLite.',kind:'stack',mode:'cli',source:{kind:'request',reference:'request',text:'Use SQLite to persist a row and read it after reopening.'},binding:identity}],constraints:[],decisions:[],gaps:[]};
async function fixture(protocol:'node'|'python'='node'){
  const root=await mkdtemp(join(tmpdir(),'capivara-module-proof-'));temporary.push(root);
  const module:ProviderModule=protocol==='node'?{protocol,specifier:'node:sqlite',runtimeCommand:[process.execPath]}:{protocol,specifier:'sqlite3',runtimeCommand:['python3']};
  const file=protocol==='node'?'product.mjs':'product.py';
  const source=protocol==='node'?`import {DatabaseSync} from 'node:sqlite';
let db=new DatabaseSync('rows.sqlite');db.exec('CREATE TABLE items(value TEXT)');db.prepare('INSERT INTO items VALUES (?)').run('saved-row');db.close();
db=new DatabaseSync('rows.sqlite');if(db.prepare('SELECT value FROM items').get().value!=='saved-row')throw Error('not persisted');db.close();console.log('PERSISTED_ROW');`:
    `import sqlite3
db=sqlite3.connect('rows.sqlite')
db.execute('CREATE TABLE items(value TEXT)')
db.execute('INSERT INTO items VALUES (?)',('saved-row',))
db.commit()
db.close()
db=sqlite3.connect('rows.sqlite')
assert db.execute('SELECT value FROM items').fetchone()[0]=='saved-row'
db.close()
print('PERSISTED_ROW')
`;
  await writeFile(join(root,file),source);
  const node:EnvironmentNode={id:'sql',name:'SQL provider',kind:'package',identity,reason:'Store rows.',dependsOn:[],targets:['portable'],check:protocol==='node'?{command:process.execPath,args:['-e',"require('node:sqlite')"]}:{command:'python3',args:['-c','import sqlite3']},prepare:[],provides:{modules:[module]}};
  const check:Verification={id:'stored-row',kind:'cli',command:module.runtimeCommand[0]!,args:[file],level:'behavior',assertion:{type:'contains',value:'PERSISTED_ROW'},inputs:[file],requirementIds:['storage'],requiredCapabilities:[],conformance:{requirementId:'storage',...identity,productInputs:[file]}};
  const task:WorkUnit={id:'storage',title:'Stored rows',goal:'Store and read a row.',instructions:'Implement file-backed storage.',requirementIds:['storage'],dependsOn:[],environmentIds:['sql'],contractIds:[],files:[file],criteria:['A persisted row survives closing and reopening the database.'],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:product.id,briefRevision:1,environment:[node],contracts:[],tasks:[task],acceptance:[]};
  const prepared=await prepareEnvironmentNode(root,node,product,executeCommand);
  expect(prepared.ready,JSON.stringify(prepared.incidents)).toBe(true);
  const run=()=>runVerification(root,product,task,plan,check,executeCommand,runTerminal,{operational:prepared.operational});
  return{root,file,module,node,check,task,plan,prepared,run};
}

for(const protocol of ['node','python'] as const)it.skipIf(protocol==='python'&&!pythonAvailable)(`proves real ${protocol} module usage with persisted SQLite data without inventing a provider executable`,async()=>{
  const item=await fixture(protocol),result=await item.run();
  expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect((await readFile(join(item.root,'rows.sqlite'))).subarray(0,16).toString()).toBe('SQLite format 3\u0000');
  const binding=item.prepared.operational.bindings[identity.capability]!;
  expect(binding.command).toBeUndefined();expect(binding.modules).toEqual([item.module]);
  const provenance=result.evidence.provenance!;
  expect(provenance.moduleProviders?.[0]?.nativeFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(provenance.moduleWitnesses?.some(witness=>witness.inputs[item.file]&&witness.modules.some(module=>module.specifier===item.module.specifier))).toBe(true);
  expect(await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root)).toEqual([]);
  const stale=structuredClone(result.evidence);stale.provenance!.moduleProviders![0]!.nativeFingerprint='changed-host';
  expect((await validateConformance(product,item.plan,item.prepared.operational,[stale],item.root))[0]?.code).toBe('unproven-product-provider-usage');
  const noModule=structuredClone(item.prepared.operational);delete noModule.bindings[identity.capability]!.modules;
  expect((await validateConformance(product,item.plan,noModule,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
  await writeFile(join(item.root,item.file),'// different product');
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.message).toContain('Product inputs changed');
});

for(const mode of ['echo-only','version-only','resolve-only','provider-without-product','separate-process'] as const)it(`does not approve ${mode} as module consumption by the actual product`,async()=>{
  const item=await fixture();
  if(mode==='version-only'){
    item.check.args=['--version'];item.check.assertion={type:'regex',pattern:'v\\d+\\.\\d+'};
  }else if(mode==='provider-without-product')item.check.args=['-e',"require('node:sqlite');console.log('PERSISTED_ROW')"];
  else if(mode==='separate-process'){
    await writeFile(join(item.root,item.file),"console.log('PERSISTED_ROW');");
    await writeFile(join(item.root,'verify.mjs'),`import 'node:sqlite';import {spawnSync} from 'node:child_process';const result=spawnSync(process.execPath,['product.mjs'],{stdio:'inherit'});process.exit(result.status??1);`);
    item.check.args=['verify.mjs'];
  }else await writeFile(join(item.root,item.file),mode==='resolve-only'?"import.meta.resolve('node:sqlite');console.log('PERSISTED_ROW');":"console.log('PERSISTED_ROW');");
  const result=await item.run();expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect(result.evidence.provenance?.moduleWitnesses??[]).toEqual([]);
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

for(const mode of ['echo-only','resolve-only','provider-without-product'] as const)it.skipIf(!pythonAvailable)(`does not approve Python ${mode} as module consumption by the actual product`,async()=>{
  const item=await fixture('python');
  if(mode==='provider-without-product')item.check.args=['-c',"import sqlite3;print('PERSISTED_ROW')"];
  else await writeFile(join(item.root,item.file),mode==='resolve-only'?"import importlib.util\nimportlib.util.find_spec('sqlite3')\nprint('PERSISTED_ROW')\n":"print('PERSISTED_ROW')\n");
  const result=await item.run();expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect(result.evidence.provenance?.moduleWitnesses??[]).toEqual([]);
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('rejects removed or changed provider files after an otherwise successful module proof',async()=>{
  const item=await fixture();await mkdir(join(item.root,'.tools'));const provider=join(item.root,'.tools','provider.mjs');
  await writeFile(provider,"export const read=()=>42;");
  await writeFile(join(item.root,item.file),"import {read} from './.tools/provider.mjs';if(read()!==42)throw Error('wrong');console.log('PERSISTED_ROW');");
  item.module.specifier='./.tools/provider.mjs';item.prepared.operational.bindings[identity.capability]!.modules=[item.module];
  const result=await item.run();expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect(await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root)).toEqual([]);
  await writeFile(provider,"export const read=()=>0;");
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
  await rm(provider);
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it.skipIf(!pythonAvailable)('does not turn an ignored Python instrumentation channel into product evidence',async()=>{
  const item=await fixture('python');item.check.args=['-I',item.file];
  const result=await item.run();expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect(result.evidence.provenance?.moduleWitnesses??[]).toEqual([]);
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

for(const protocol of ['node','python'] as const)it.skipIf(protocol==='python'&&!pythonAvailable)(`does not attribute a ${protocol} verifier import in the same PID to an unrelated product`,async()=>{
  const item=await fixture(protocol);
  await writeFile(join(item.root,item.file),protocol==='node'?"console.log('PERSISTED_ROW');":"print('PERSISTED_ROW')\n");
  const verifier=protocol==='node'?'verify.mjs':'verify.py';
  await writeFile(join(item.root,verifier),protocol==='node'?"import 'node:sqlite';await import('./product.mjs');":"import sqlite3\nimport product\n");
  item.check.args=[verifier];
  const result=await item.run();expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect(result.evidence.provenance?.moduleWitnesses?.some(witness=>witness.inputs[item.file]&&witness.modules.length)).toBe(true);
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('preserves actual product consumption when a verifier imported the Node module before the product',async()=>{
  const item=await fixture();await writeFile(join(item.root,'verify.mjs'),"import 'node:sqlite';await import('./product.mjs');");item.check.args=['verify.mjs'];
  const result=await item.run();expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect(result.evidence.provenance?.moduleWitnesses?.some(witness=>witness.modules.some(module=>module.observation==='cached-import'&&module.importedBy?.['product.mjs']))).toBe(true);
  expect(await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root)).toEqual([]);
});

it('does not turn cached module resolution or example import text into a product import',async()=>{
  const item=await fixture();
  await writeFile(join(item.root,'verify.mjs'),"import 'node:sqlite';await import('./product.mjs');");
  await writeFile(join(item.root,item.file),"// import 'node:sqlite';\nconst example=\"import 'node:sqlite'\";import.meta.resolve('node:sqlite');console.log('PERSISTED_ROW');");
  item.check.args=['verify.mjs'];
  const result=await item.run();expect(result.evidence.passed,result.evidence.output).toBe(true);
  expect((await validateConformance(product,item.plan,item.prepared.operational,[result.evidence],item.root))[0]?.code).toBe('unproven-product-provider-usage');
});

it('recovers one literal readiness import only after confirming the actual host protocol',async()=>{
  const root=await mkdtemp(join(tmpdir(),'capivara-module-declaration-'));temporary.push(root);
  expect(await inferProviderModule(root,[process.execPath,'-e',"require('node:sqlite')"],{})).toEqual({protocol:'node',specifier:'node:sqlite',runtimeCommand:[process.execPath]});
  expect(await inferProviderModule(root,[process.execPath,'-e',"try { console.log(require.resolve('node:sqlite')) } catch { process.exit(1) }"],{})).toEqual({protocol:'node',specifier:'node:sqlite',runtimeCommand:[process.execPath]});
  expect(await inferProviderModule(root,[process.execPath,'-e',"require.resolve('node:fs');require('node:sqlite')"],{})).toBeUndefined();
  expect(await inferProviderModule(root,[process.execPath,'-e',"require.resolve(process.argv[1])"],{})).toBeUndefined();
  expect(await inferProviderModule(root,[process.execPath,'-e',"require('node:fs');require('node:sqlite')"],{})).toBeUndefined();
  expect(await inferProviderModule(root,[process.execPath,'-e',"require(process.argv[1])"],{})).toBeUndefined();
  if(process.platform!=='win32')expect(await inferProviderModule(root,['/bin/sh','-c',"require('node:sqlite')"],{})).toBeUndefined();
  const item=await fixture();delete item.node.provides;
  const prepared=await prepareEnvironmentNode(item.root,item.node,product,executeCommand);
  expect(prepared.ready).toBe(true);expect(prepared.operational.bindings[identity.capability]!.modules).toEqual([item.module]);
  expect(prepared.operational.bindings[identity.capability]!.transformations).toEqual(expect.arrayContaining([expect.objectContaining({kind:'literal-module-readiness-protocol'})]));
});
