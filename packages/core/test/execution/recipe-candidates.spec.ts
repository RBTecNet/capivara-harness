import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Verification } from '../../src/domain/types.js';
import { repositoryRecipeCandidate } from '../../src/execution/recipe-candidates.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function repository(scripts:Record<string,string>){
  const root=await mkdtemp(join(tmpdir(),'capivara-recipe-candidate-'));roots.push(root);
  await mkdir(join(root,'checks'));
  for(const file of ['a.ts','b.ts','c.ts'])await writeFile(join(root,'checks',file),'export const scenario = true;\n');
  await writeFile(join(root,'package.json'),JSON.stringify({scripts}));
  return root;
}
const check=():Verification=>({id:'records',kind:'command',command:'npm run test -- --run checks/b.ts',expected:'The required record behaviors hold.',assertion:{type:'contains',value:'pass 4'},expectedExitCode:0,requirementIds:['records'],requiredCapabilities:[],inputs:['checks/b.ts'],level:'behavior',conformance:{requirementId:'records',capability:'runtime',kind:'runtime',provider:'Node.js',productInputs:['checks/b.ts']}});

describe('receita documentada para o mesmo alvo declarado',()=>{
  it('seleciona único script pelo arquivo real e preserva o contrato completo da prova',async()=>{
    const root=await repository({test:'node --import tsx/esm --test checks/*.ts',first:'node --import tsx/esm --test checks/a.ts',second:'node --import tsx/esm --test checks/b.ts',third:'node --import tsx/esm --test checks/c.ts'});
    const original=check();
    const candidate=await repositoryRecipeCandidate(root,original);
    expect(candidate).toMatchObject({command:'npm',args:['run','second'],recipeCandidate:{kind:'package-script',manifest:'package.json',script:'second',target:'checks/b.ts',expandedArgv:['node','--import','tsx/esm','--test','checks/b.ts'],original:{command:original.command}}});
    const {command:_command,args:_args,recipeCandidate:_candidate,...contract}=candidate!;
    const {command:_oldCommand,args:_oldArgs,...expected}=original;
    expect(contract).toEqual(expected);
    expect(candidate?.recipeCandidate?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(original.command).toBe('npm run test -- --run checks/b.ts');
  });

  it('não adapta runner atual sem alternativa nem troca por invocação expandida idêntica',async()=>{
    const legitimate=await repository({test:'node --test',first:'node --test checks/a.ts',third:'node --test checks/c.ts'});
    expect(await repositoryRecipeCandidate(legitimate,{...check(),command:'npm',args:['run','test','--','checks/b.ts']})).toBeUndefined();
    const alias=await repository({test:'node --test',other:'node --test checks/b.ts'});
    expect(await repositoryRecipeCandidate(alias,{...check(),command:'npm',args:['run','test','--','checks/b.ts']})).toBeUndefined();
  });

  it('recusa ambiguidade, shell com múltiplos comandos e alvo fora dos inputs declarados',async()=>{
    const ambiguous=await repository({test:'node --test checks/*.ts',one:'node --test checks/b.ts',two:'node --test checks/b.ts'});
    expect(await repositoryRecipeCandidate(ambiguous,check())).toBeUndefined();
    const chained=await repository({test:'node --test checks/*.ts',unsafe:'node --test checks/b.ts && node checks/c.ts'});
    expect(await repositoryRecipeCandidate(chained,check())).toBeUndefined();
    const unowned=await repository({test:'node --test checks/*.ts',other:'node --test checks/b.ts'});
    expect(await repositoryRecipeCandidate(unowned,{...check(),inputs:['checks/a.ts']})).toBeUndefined();
    expect(await repositoryRecipeCandidate(unowned,{...check(),command:'npm test',inputs:['checks/a.ts','checks/b.ts']})).toBeUndefined();
  });

  it('preserva runner, flags e loaders sem aceitar echo, sintaxe ou outra stack de testes',async()=>{
    for(const command of ['echo checks/b.ts','node --check checks/b.ts','vitest run checks/b.ts','node --test checks/b.ts']){
      const root=await repository({test:'node --import tsx/esm --test checks/*.ts',other:command});
      expect(await repositoryRecipeCandidate(root,check())).toBeUndefined();
    }
    const invalidBase=await repository({test:'node --test checks/*.ts && echo done',other:'node --test checks/b.ts'});
    expect(await repositoryRecipeCandidate(invalidBase,check())).toBeUndefined();
  });

  it('não pula setup/teardown nem hooks de delegações ao selecionar o mesmo alvo',async()=>{
    const missingHook=await repository({pretest:'node setup.mjs',test:'node --test checks/*.ts',other:'node --test checks/b.ts'});
    expect(await repositoryRecipeCandidate(missingHook,check())).toBeUndefined();
    const changedHook=await repository({pretest:'node setup.mjs',test:'node --test checks/*.ts',preother:'node different-setup.mjs',other:'node --test checks/b.ts'});
    expect(await repositoryRecipeCandidate(changedHook,check())).toBeUndefined();
    const nestedHook=await repository({test:'npm run base',prebase:'node setup.mjs',base:'node --test checks/*.ts',other:'node --test checks/b.ts'});
    expect(await repositoryRecipeCandidate(nestedHook,check())).toBeUndefined();
    const equivalentHooks=await repository({pretest:'node setup.mjs',test:'node --test checks/*.ts',posttest:'node cleanup.mjs',preother:'node setup.mjs',other:'node --test checks/b.ts',postother:'node cleanup.mjs'});
    expect((await repositoryRecipeCandidate(equivalentHooks,check()))?.args).toEqual(['run','other']);
  });
});
