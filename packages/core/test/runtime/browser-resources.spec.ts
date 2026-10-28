import { afterEach, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { prepareBrowserResources } from '../../src/runtime/browser-resources.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { checkInputHash } from '../../src/execution/checks.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function root(){const path=await mkdtemp(join(tmpdir(),'capivara-browser-resource-'));roots.push(path);return path;}
async function fixture(){
  const workspace=await root(),pkg=join(workspace,'node_modules','playwright'),core=join(workspace,'node_modules','playwright-core');await mkdir(pkg,{recursive:true});await mkdir(core,{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'playwright',version:'1.0.0',main:'index.cjs',bin:{playwright:'cli.cjs'}}));await writeFile(join(core,'package.json'),JSON.stringify({name:'playwright-core',version:'1.0.0',main:'index.cjs'}));
  await writeFile(join(core,'browsers.json'),JSON.stringify({browsers:[{name:'chromium',revision:'1'},{name:'chromium-headless-shell',revision:'1'},{name:'ffmpeg',revision:'1'}]}));
  await writeFile(join(pkg,'index.cjs'),`const fs=require('node:fs'),path=require('node:path');const revision=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../playwright-core/browsers.json'),'utf8')).browsers[0].revision;const executable=()=>path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,'chromium-'+revision(),'browser');exports.chromium={executablePath:executable,async launch(options){if(options.headless!==true)throw Error('expected real headless request');if(process.env.FIXTURE_BROWSER_BROKEN==='true')throw Error('host libraries unavailable');for(const file of [executable(),path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,'chromium_headless_shell-'+revision(),'browser')])if(fs.readFileSync(file,'utf8')!=='usable')throw Error('broken binary');return{version(){return process.env.FIXTURE_BROWSER_VERSION||"1.0"},async close(){}}}};`);
  await writeFile(join(pkg,'cli.cjs'),`const fs=require('node:fs'),path=require('node:path');if(process.argv[2]!=='install')process.exit(3);const marker=path.join(__dirname,'install-count');fs.writeFileSync(marker,String(Number(fs.existsSync(marker)?fs.readFileSync(marker,'utf8'):0)+1));const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../playwright-core/browsers.json'),'utf8'));for(const item of data.browsers){const folder=path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,item.name.replaceAll('-','_')+'-'+item.revision);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'browser'),'usable');}`);
  await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{e2e:`"${process.execPath}" node_modules/playwright/cli.cjs test`}}));
  const check:Verification={id:'browser',kind:'web',command:'npm',args:['run','e2e'],expected:'contains:passed',requirementIds:[],requiredCapabilities:['browser']};
  return{workspace,pkg,core,check,operational:emptyOperationalEnvironment(workspace),resources:join(workspace,'.capivara-next','providers')};
}
async function cache(path:string,revision='1',content='usable'){for(const name of ['chromium','chromium_headless_shell','ffmpeg']){await mkdir(join(path,`${name}-${revision}`),{recursive:true});await writeFile(join(path,`${name}-${revision}`,'browser'),content);}}
it('adopts an existing editor cache into a fixed resource and reuses it from a different product copy without reinstalling',async()=>{
  const f=await fixture(),editorCache=join(f.workspace,'.capivara-runtime','cache','ms-playwright');await cache(editorCache);
  const first=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources,caches:[editorCache]});expect(first.applicable).toBe(true);expect(first.ready).toBe(true);expect(first.changed).toBe(true);expect(first.executable).toContain(first.environment.PLAYWRIGHT_BROWSERS_PATH);expect(first.details).toContain('no download');
  await expect(readFile(join(f.pkg,'install-count'))).rejects.toMatchObject({code:'ENOENT'});
  const copy=await root();await cp(join(f.workspace,'node_modules'),join(copy,'node_modules'),{recursive:true});await cp(join(f.workspace,'package.json'),join(copy,'package.json'));
  const reused=await prepareBrowserResources(copy,f.check,emptyOperationalEnvironment(copy),{resourceRoot:f.resources});expect(reused.ready).toBe(true);expect(reused.changed).toBe(false);expect(reused.identity).toBe(first.identity);expect(reused.fingerprint).toBe(first.fingerprint);expect(reused.environment).toEqual(first.environment);
});
it('installs with the selected local CLI once under concurrent consumers and preserves older active generations',async()=>{
  const f=await fixture();const results=await Promise.all([1,2,3].map(()=>prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources})));expect(results.every(result=>result.ready)).toBe(true);expect(new Set(results.map(result=>result.environment.PLAYWRIGHT_BROWSERS_PATH)).size).toBe(1);expect(await readFile(join(f.pkg,'install-count'),'utf8')).toBe('1');
  const old=results[0]!;const metadata=JSON.parse(await readFile(join(f.core,'browsers.json'),'utf8'));for(const browser of metadata.browsers)browser.revision='2';await writeFile(join(f.core,'browsers.json'),JSON.stringify(metadata));
  const updated=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources});expect(updated.ready).toBe(true);expect(updated.identity).not.toBe(old.identity);expect(updated.environment.PLAYWRIGHT_BROWSERS_PATH).not.toBe(old.environment.PLAYWRIGHT_BROWSERS_PATH);expect(await readFile(old.executable!,'utf8')).toBe('usable');expect(await readFile(join(f.pkg,'install-count'),'utf8')).toBe('2');
});
it('does not let a corrupt candidate mask another usable cache or trigger a needless download',async()=>{
  const f=await fixture(),bad=join(f.workspace,'bad-cache'),good=join(f.workspace,'good-cache');await cache(bad,'1','broken');await cache(good);
  const result=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources,caches:[bad,good]});expect(result.ready).toBe(true);await expect(readFile(join(f.pkg,'install-count'))).rejects.toMatchObject({code:'ENOENT'});
});
it('requires headless readiness and persistently avoids repeating an ineffective browser install',async()=>{
  const f=await fixture();f.operational.env.FIXTURE_BROWSER_BROKEN='true';
  const first=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources});expect(first.ready).toBe(false);expect(first.details).toContain('environment capability failure');expect(await readFile(join(f.pkg,'install-count'),'utf8')).toBe('1');
  const again=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources});expect(again.ready).toBe(false);expect(again.details).toContain('already failed');expect(await readFile(join(f.pkg,'install-count'),'utf8')).toBe('1');
  delete f.operational.env.FIXTURE_BROWSER_BROKEN;const recovered=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources});expect(recovered.ready).toBe(true);expect(await readFile(join(f.pkg,'install-count'),'utf8')).toBe('1');
});
it('selects the real tool invocation rather than command text or a successful version probe',async()=>{
  const f=await fixture();
  for(const check of [{...f.check,command:'echo',args:['node_modules/playwright/cli.cjs','test']},{...f.check,command:process.execPath,args:['node_modules/playwright/cli.cjs','--version']}]){
    const result=await prepareBrowserResources(f.workspace,check,f.operational,{resourceRoot:f.resources});expect(result.applicable).toBe(false);expect(result.environment).toEqual({});
  }
  await expect(readdir(f.resources)).rejects.toMatchObject({code:'ENOENT'});
});
it('uses the selected Node invocation and invalidates the observed capability when the launched browser version changes',async()=>{
  const f=await fixture();f.operational.bindings.node={capability:'node',kind:'runtime',provider:'selected',ready:true,command:[process.execPath,'--no-warnings'],aliases:['node']};
  const first=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources});expect(first.ready).toBe(true);expect(first.fingerprint).toBeDefined();
  f.operational.env.FIXTURE_BROWSER_VERSION='2.0';
  const upgraded=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources});expect(upgraded.ready).toBe(true);expect(upgraded.identity).toBe(first.identity);expect(upgraded.fingerprint).not.toBe(first.fingerprint);expect(upgraded.environment).toEqual(first.environment);expect(await readFile(join(f.pkg,'install-count'),'utf8')).toBe('1');
});
it('resumes an interrupted installation while retaining conclusive no-progress protection',async()=>{
  const {executeCommand}=await import('../../src/runtime/command.js');
  const f=await fixture();let interrupted=false;
  const first=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources,execute:async request=>{
    if(Array.isArray(request.command)&&request.command.includes('install')&&!interrupted){interrupted=true;return{command:request.command.join(' '),cwd:request.cwd,exitCode:130,stdout:'',stderr:'interrupted by cancellation',durationMs:1,timedOut:false,cancelled:true,signal:'SIGTERM',fingerprint:'cancelled'};}
    return executeCommand(request);
  }});
  expect(first.ready).toBe(false);expect(interrupted).toBe(true);
  const resumed=await prepareBrowserResources(f.workspace,f.check,f.operational,{resourceRoot:f.resources});expect(resumed.ready).toBe(true);expect(await readFile(join(f.pkg,'install-count'),'utf8')).toBe('1');
});
it.skipIf(process.platform==='win32')('unwraps only proven Playwright bootstrap chains and returns their preserved audit plus a consumer-only invocation',async()=>{
  const {symlink}=await import('node:fs/promises');
  const f=await fixture();await mkdir(join(f.workspace,'node_modules/.bin'));await symlink('../playwright/cli.cjs',join(f.workspace,'node_modules/.bin/playwright'));
  const editorCache=join(f.workspace,'.capivara-runtime/cache/ms-playwright');await cache(editorCache);
  for(const wrapper of ['shell','manager'] as const){
    const program='npx playwright install chromium && npx playwright test alpha.mjs --reporter=line';
    if(wrapper==='manager')await writeFile(join(f.workspace,'package.json'),JSON.stringify({scripts:{e2e:program}}));
    const check=wrapper==='shell'?{...f.check,command:'/bin/bash',args:['-lc',program]}:f.check;
    const result=await prepareBrowserResources(f.workspace,check,f.operational,{resourceRoot:f.resources,caches:[editorCache]});
    expect(result.ready).toBe(true);expect(result.applicable).toBe(true);expect(result.invocation?.command).toBe(process.execPath);expect(result.invocation?.args).toEqual(['node_modules/playwright/cli.cjs','test','alpha.mjs','--reporter=line']);expect(result.invocation?.audit.original.command).toBe(check.command);expect(result.invocation?.audit.original.args).toEqual(check.args);expect(result.invocation?.audit.removedPreparations).toHaveLength(1);expect(result.invocation?.audit.removedPreparations[0]?.args).toContain('install');
    await expect(readFile(join(f.pkg,'install-count'))).rejects.toMatchObject({code:'ENOENT'});
  }
  const unsafe={...f.check,command:'/bin/bash',args:['-lc','npm install && npx playwright test alpha.mjs']};expect((await prepareBrowserResources(f.workspace,unsafe,f.operational,{resourceRoot:f.resources})).applicable).toBe(false);
});

async function configuredFixture(){
  const f=await fixture();
  await mkdir(join(f.pkg,'lib'),{recursive:true});
  await writeFile(join(f.pkg,'lib/common.js'),`exports.configLoader={async loadConfigFromFile(){return require(require('node:path').join(process.cwd(),'playwright.config.cjs'))}};exports.suiteUtils={createFiltersFromArguments(args){const patterns=args.map(value=>new RegExp(value.replace(/:\\d+(?::\\d+)?$/,'')));return{fileFilter:file=>patterns.some(pattern=>pattern.test(file))}}};`);
  await writeFile(join(f.pkg,'lib/program.js'),`const {Command}=require(${JSON.stringify(createRequire(import.meta.url).resolve('commander'))});const test=new Command('test');test.option('--grep <pattern>').option('--project <name...>').option('-c, --config <file>').option('--no-deps');test.action(()=>{throw Error('discovery must never dispatch the test command action')});exports.program={commands:[test]};`);
  await writeFile(join(f.pkg,'lib/runner.js'),`const fs=require('node:fs'),path=require('node:path');const match=(patterns,file)=>(Array.isArray(patterns)?patterns:[patterns]).some(pattern=>pattern instanceof RegExp?(pattern.lastIndex=0,pattern.test(file)):path.matchesGlob(file,pattern.startsWith('**/')?pattern:'**/'+pattern));exports.projectUtils={filterProjects(projects,names){return names?projects.filter(item=>names.some(name=>path.matchesGlob(item.project.name,name))):projects},buildProjectsClosure(selected){const result=new Map(),visit=item=>{if(result.has(item))return;result.set(item,'selected');for(const dependency of item.deps||[])visit(dependency)};for(const item of selected)visit(item);return result},async collectFilesForProject(item){const project=item.project;return fs.readdirSync(project.testDir,{recursive:true}).map(file=>path.join(project.testDir,file)).filter(file=>fs.statSync(file).isFile()&&match(project.testMatch,file)&&!match(project.testIgnore,file))}};`);
  for(const folder of ['src','e2e','setup','unselected'])await mkdir(join(f.workspace,folder),{recursive:true});
  await writeFile(join(f.workspace,'playwright.config.cjs'),`const path=require('node:path');const setup={project:{name:'setup',testDir:path.join(__dirname,'setup'),testMatch:'**/*.setup.ts',testIgnore:[],use:{}},deps:[]};const browser={project:{name:'browser',testDir:path.join(__dirname,'e2e'),testMatch:[/\\.scenario\\.ts$/,'**/*.spec.ts'],testIgnore:/ignored/,use:{browserName:'chromium'}},respectGitIgnore:true,deps:[setup]};const unselected={project:{name:'unselected',testDir:path.join(__dirname,'unselected'),testMatch:'**/*.spec.ts',testIgnore:[],use:{}},deps:[]};module.exports={config:{configFile:__filename},projects:[browser,unselected,setup]};`);
  await writeFile(join(f.workspace,'src/app.ts'),'export const app = true;');
  await writeFile(join(f.workspace,'e2e/navigation.scenario.ts'),"import {helper} from './helper'; throw Error('discovery must never evaluate this test');");
  await writeFile(join(f.workspace,'e2e/form.spec.ts'),"throw Error('discovery must never evaluate a matching spec');");
  await writeFile(join(f.workspace,'e2e/helper.ts'),'export const helper = 1;');
  await writeFile(join(f.workspace,'e2e/ignored.spec.ts'),'ignored test bytes');
  await writeFile(join(f.workspace,'setup/database.setup.ts'),"throw Error('discovery must not run setup tests');");
  await writeFile(join(f.workspace,'unselected/other.spec.ts'),'unselected project bytes');
  const check:Verification={...f.check,args:['run','e2e','--','--grep','navegação principal','--project','browser'],inputs:['src/app.ts']};
  return{...f,check};
}
it('tracks configured test sources and their imports without loading tests or invalidating unrelated documents',async()=>{
  const f=await configuredFixture(),check=f.check;
  const prepared=await prepareBrowserResources(f.workspace,check,f.operational,{resourceRoot:f.resources});
  expect(prepared.ready,prepared.details).toBe(true);
  expect(prepared.inputs).toEqual(expect.arrayContaining(['playwright.config.cjs','e2e/navigation.scenario.ts','e2e/form.spec.ts','e2e/.gitignore','setup/database.setup.ts']));
  expect(prepared.inputs).not.toContain('e2e/ignored.spec.ts');expect(prepared.inputs).not.toContain('unselected/other.spec.ts');
  const bound:Verification={...check,inputs:[...check.inputs??[],...prepared.inputs??[]]};
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',status:'ready',revision:1,name:'Browser input fixture',summary:'Observe configured web sources.',request:'Create a web app.',modes:['web'],targets:['browser'],requirements:[],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'web',title:'Web',goal:'Observe configured source.',instructions:'Keep the real behavior.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:['src/app.ts'],criteria:['The real source is observed.'],checks:[bound],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const before=await checkInputHash(f.workspace,plan,task,bound,brief);
  await writeFile(join(f.workspace,'README.md'),'Unrelated documentation.');await writeFile(join(f.workspace,'e2e/ignored.spec.ts'),'changed ignored test');await writeFile(join(f.workspace,'unselected/other.spec.ts'),'changed unselected project');
  expect(await checkInputHash(f.workspace,plan,task,bound,brief)).toBe(before);
  await writeFile(join(f.workspace,'e2e/navigation.scenario.ts'),"import {helper} from './helper'; throw Error('a repaired test is still not executed during discovery');");
  const repaired=await checkInputHash(f.workspace,plan,task,bound,brief);expect(repaired).not.toBe(before);
  await writeFile(join(f.workspace,'e2e/helper.ts'),'export const helper = 2;');
  const changedHelper=await checkInputHash(f.workspace,plan,task,bound,brief);expect(changedHelper).not.toBe(repaired);
  await writeFile(join(f.workspace,'e2e/.gitignore'),'# The collector reads this visibility contract.');
  expect(await checkInputHash(f.workspace,plan,task,bound,brief)).not.toBe(changedHelper);
});

it('filters explicit file locations before loading while preserving dependency projects and selected imports',async()=>{
  const f=await configuredFixture();
  const check:Verification={...f.check,args:['run','e2e','--','e2e/navigation.scenario.ts:12','--grep','navegação principal','--project','browser']};
  const result=await prepareBrowserResources(f.workspace,check,f.operational,{resourceRoot:f.resources});
  expect(result.ready,result.details).toBe(true);
  expect(result.inputs).toEqual(expect.arrayContaining(['e2e/navigation.scenario.ts','setup/database.setup.ts','playwright.config.cjs']));
  expect(result.inputs).not.toContain('e2e/form.spec.ts');expect(result.inputs).not.toContain('e2e/ignored.spec.ts');
  const bound={...check,inputs:[...check.inputs??[],...result.inputs??[]]};
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',status:'ready',revision:1,name:'Selected browser source',summary:'Observe the selected source.',request:'Create a web app.',modes:['web'],targets:['browser'],requirements:[],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'web',title:'Web',goal:'Observe the selected source.',instructions:'Preserve behavior.',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:['src/app.ts'],criteria:['Observe the requested behavior.'],checks:[bound],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const before=await checkInputHash(f.workspace,plan,task,bound,brief);
  await writeFile(join(f.workspace,'e2e/form.spec.ts'),'Changed same-project test that is not selected by the actual file filter.');
  expect(await checkInputHash(f.workspace,plan,task,bound,brief)).toBe(before);
  await writeFile(join(f.workspace,'e2e/navigation.scenario.ts'),"import {helper} from './helper'; throw Error('selected source changed without evaluation');");
  const selected=await checkInputHash(f.workspace,plan,task,bound,brief);expect(selected).not.toBe(before);
  await writeFile(join(f.workspace,'e2e/helper.ts'),'export const helper = 3;');
  const helper=await checkInputHash(f.workspace,plan,task,bound,brief);expect(helper).not.toBe(selected);
  await writeFile(join(f.workspace,'setup/database.setup.ts'),'Changed setup project that still loads despite the main-project file filter.');
  expect(await checkInputHash(f.workspace,plan,task,bound,brief)).not.toBe(helper);
});
