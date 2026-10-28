import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Verification } from '../../src/domain/types.js';
import { digest } from '../../src/execution/files.js';
import { mergeOperationalEnvironments, relocateOperationalEnvironment, selectOperationalEnvironment, verificationOperationalRevision, type CapabilityBinding, type OperationalEnvironment } from '../../src/execution/environment.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const proof=(kind:Verification['kind'],caps:string[]=[]):Verification=>({id:kind,kind,command:'node',args:['src/scenario.mjs'],inputs:['src/scenario.mjs'],requirementIds:[],requiredCapabilities:caps});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'capivara-fixed-provider-'));roots.push(root);
  const cache=join(root,'.capivara-next','browser-cache'),browser=join(cache,'browser');
  await mkdir(cache,{recursive:true});await writeFile(browser,'verified browser bytes');
  const binding:CapabilityBinding={capability:'browser-resource',kind:'runtime',provider:'prepared-browser',ready:true,dependencyFamily:'browser',relocation:'fixed',command:[browser],paths:[cache],env:{BROWSER_CACHE:cache},fingerprint:digest(await readFile(browser))};
  const value:OperationalEnvironment={root,env:{PATH:[join(root,'.venv','bin'),'/usr/bin'].join(delimiter),BROWSER_CACHE:cache,VIRTUAL_ENV:join(root,'.venv')},bindings:{browser:binding,python:{capability:'python',kind:'runtime',provider:'project-python',ready:true,dependencyFamily:'python',command:[join(root,'.venv','bin','python')],paths:[join(root,'.venv','bin')],env:{VIRTUAL_ENV:join(root,'.venv')}},node:{capability:'node',kind:'runtime',provider:'selected-node',ready:true,command:[process.execPath]}},revision:''};
  return{root,cache,browser,operational:mergeOperationalEnvironments(root,value)};
}

describe('providers compartilhados têm identidade fixa e consumidores próprios',()=>{
  it('preserva cache preparado, env absoluto e revisão ao criar área privada sem inserir cache no PATH',async()=>{
    const {root,cache,operational}=await fixture();
    const privateRoot=join(root,'.capivara-next','workspaces','task','product');
    const relocated=relocateOperationalEnvironment(operational,root,privateRoot);
    expect(relocated.bindings.browser).toEqual(operational.bindings.browser);
    expect(relocated.env.BROWSER_CACHE).toBe(cache);
    expect(relocated.bindings.python?.command).toEqual([join(privateRoot,'.venv','bin','python')]);
    expect(relocated.env.VIRTUAL_ENV).toBe(join(privateRoot,'.venv'));
    expect(relocated.env.PATH?.split(delimiter)).not.toContain(cache);
    expect(relocated.env.PATH?.split(delimiter)).toContain(join(privateRoot,'.venv','bin'));
    expect(relocated.revision).toBe(operational.revision);
  });

  it('invalida provas de navegador após mudança confirmada de bytes sem invalidar provas Node/API',async()=>{
    const {root,browser,operational}=await fixture();
    const web=proof('web'),api=proof('cli');
    const beforeWeb=verificationOperationalRevision(operational,['src/scenario.mjs'],web);
    const beforeApi=verificationOperationalRevision(operational,['src/scenario.mjs'],api);
    await writeFile(browser,'corrupted or replaced browser bytes');
    const changed=structuredClone(operational);
    changed.bindings.browser!.fingerprint=digest(await readFile(browser));
    const current=mergeOperationalEnvironments(root,changed);
    expect(verificationOperationalRevision(current,['src/scenario.mjs'],web)).not.toBe(beforeWeb);
    expect(verificationOperationalRevision(current,['src/scenario.mjs'],api)).toBe(beforeApi);
    const renamed=structuredClone(current);renamed.bindings.browser!.provider='different prepared provider';
    expect(verificationOperationalRevision(mergeOperationalEnvironments(root,renamed),['src/scenario.mjs'],web)).not.toBe(verificationOperationalRevision(current,['src/scenario.mjs'],web));
    expect(verificationOperationalRevision(mergeOperationalEnvironments(root,renamed),['src/scenario.mjs'],api)).toBe(beforeApi);
  });

  it('seleciona browser somente para checks web, capacidade explícita ou instrumento de navegador',async()=>{
    const {operational}=await fixture();
    expect(selectOperationalEnvironment(operational,['src/scenario.mjs'],[proof('cli')]).bindings.browser).toBeUndefined();
    expect(selectOperationalEnvironment(operational,['src/scenario.mjs'],[proof('command',['browser'])]).bindings.browser).toBeDefined();
    expect(selectOperationalEnvironment(operational,['src/scenario.mjs'],[{...proof('command'),command:'npx',args:['playwright','test']}]).bindings.browser).toBeDefined();
    expect(selectOperationalEnvironment(operational,['src/scenario.mjs'],[proof('web')]).bindings.browser).toBeDefined();
    const unrelated=selectOperationalEnvironment(operational,['src/scenario.mjs'],[proof('cli')]);
    expect(unrelated.env.BROWSER_CACHE).toBeUndefined();
  });

  it('normaliza PATH por segmento e retém export explícito fixed apenas no consumidor pertinente',async()=>{
    const {root,cache,operational}=await fixture();
    const fixedBin=join(cache,'bin');
    const supplied=structuredClone(operational);
    supplied.bindings.browser!.env!.PATH=fixedBin;
    supplied.env.PATH=[fixedBin,join(root,'.venv','bin'),'/usr/bin'].join(delimiter);
    const current=mergeOperationalEnvironments(root,supplied);
    const privateRoot=join(root,'.capivara-next','workspaces','another','product');
    const relocated=relocateOperationalEnvironment(current,root,privateRoot);
    expect(relocated.env.PATH?.split(delimiter)).toContain(fixedBin);
    expect(relocated.env.PATH?.split(delimiter)).toContain(join(privateRoot,'.venv','bin'));
    expect(relocated.revision).toBe(current.revision);
    expect(selectOperationalEnvironment(current,['src/scenario.mjs'],[proof('cli')]).env.PATH?.split(delimiter)).not.toContain(fixedBin);
    expect(selectOperationalEnvironment(current,['src/scenario.mjs'],[proof('web')]).env.PATH?.split(delimiter)).toContain(fixedBin);
  });
});
