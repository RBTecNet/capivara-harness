import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { canonicalizeConformanceDeclaration } from '../../src/domain/conformance-declarations.js';
import { repairWorkPlan } from '../../src/domain/plan.js';
import { reconcilePlan } from '../../src/domain/reconcile.js';
import { resolveInputDependencies, verificationInputSelectors } from '../../src/execution/dependencies.js';
import { verificationIdentity, verificationLevel } from '../../src/execution/checks.js';

it('adopts a unique scoped provider reference from the cached repair shape, preserves behavior and raw candidates, and hashes actual product source without accepting ambiguous or contradictory bindings',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-conformance-declaration-'));
  try{
    await mkdir(join(workspace,'operacoes'));await writeFile(join(workspace,'operacoes/soma.py'),'def soma(a,b):\n return a+b\n');
    const binding={capability:'standard-library-only runtime',kind:'runtime' as const,provider:'Python 3'};
    const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'Calculator',summary:'Sum two arguments using Python 3.',request:'Use Python 3 and only its standard library. Sum two numeric arguments.',modes:['cli'],targets:['portable'],requirements:[{id:'sum',statement:'Sum two numeric arguments.',mode:'cli',kind:'behavior',source:{kind:'request',reference:'request',text:'Sum two numeric arguments.'}},{id:'python',statement:'Use Python 3 and only its standard library.',mode:'shared',kind:'stack',binding,source:{kind:'request',reference:'request',text:'Use Python 3 and only its standard library.'}}],constraints:[],decisions:[],gaps:[]};
    const check:Verification={id:'sum-proof',kind:'command',command:'python3',args:['-c','import operacoes.soma as m; assert m.soma(2,3)==5; print(5)'],inputs:['2','3'],level:'behavior',assertion:{type:'contains',source:'stdout',value:'5'},requirementIds:['sum','python'],requiredCapabilities:[]};
    const task:WorkUnit={id:'sum-unit',title:'Sum',goal:'Provide the sum operation.',instructions:'Implement the independent sum function.',requirementIds:['sum','python'],dependsOn:[],environmentIds:['python-runtime'],contractIds:[],files:['operacoes/soma.py'],criteria:['The sum function returns the numeric result without printing.'],checks:[check],risk:'normal',blockedBy:[]};
    const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[{id:'python-runtime',name:'Python 3',kind:'runtime',identity:binding,dependsOn:[],targets:[],reason:'Run the product.',check:{command:'python3',args:['--version']},prepare:[],provides:{command:['python3']}}],contracts:[],tasks:[task]};
    const raw={...check,conformance:{...binding,requirementId:'sum',productInputs:['2','3']}};
    const before=JSON.stringify(plan);let calls=0;
    const repaired=await repairWorkPlan({brief,plan,taskId:task.id,repairScope:'verification',problem:'Recover the missing provider-consumption metadata.',agent:async()=>{calls++;return JSON.stringify({checks:[raw],environmentIds:['python-runtime'],environment:[],acceptance:[]});}});
    const adopted=repaired.tasks[0]!.checks[0]!;
    expect(calls).toBe(1);expect(JSON.stringify(plan)).toBe(before);expect(repaired.tasks[0]!.criteria).toEqual(task.criteria);expect(adopted.args).toEqual(check.args);
    expect(adopted.conformance).toEqual({...binding,requirementId:'python',productInputs:['2','3','operacoes/soma.py']});expect(adopted.requirementIds).toEqual(['sum','python']);expect(adopted.inputs).toEqual(['2','3']);
    expect(repaired.conformanceCorrections).toEqual([expect.objectContaining({taskId:task.id,checkId:check.id,original:raw.conformance,selected:adopted.conformance,reasons:['unique-scoped-provider-reference','owned-product-input-candidates'],validation:'actual-provider-consumption-required'})]);
    const selectors=await verificationInputSelectors(workspace,repaired,repaired.tasks[0]!,adopted),resolved=await resolveInputDependencies(workspace,selectors);
    expect(resolved).toContain('operacoes/soma.py');expect(resolved).toContain('2');expect(resolved).toContain('3');
    const identity=await verificationIdentity(workspace,repaired,repaired.tasks[0]!,adopted,brief,undefined,resolved);
    await writeFile(join(workspace,'operacoes/soma.py'),'def soma(a,b):\n return a-b\n');
    expect((await verificationIdentity(workspace,repaired,repaired.tasks[0]!,adopted,brief,undefined,resolved)).inputHash).not.toBe(identity.inputHash);
    const resumed=reconcilePlan(brief,reconcilePlan(brief,repaired));expect(resumed.conformanceCorrections).toEqual(repaired.conformanceCorrections);expect(resumed.tasks[0]!.checks).toEqual(repaired.tasks[0]!.checks);
    const ambiguous=structuredClone(brief);ambiguous.requirements.push({...ambiguous.requirements[1]!,id:'other-python'});
    expect(canonicalizeConformanceDeclaration(ambiguous,plan,{...task,requirementIds:[...task.requirementIds,'other-python']},raw)).toEqual({check:raw});
    const outside={...task,environmentIds:[]};expect(canonicalizeConformanceDeclaration(brief,plan,outside,raw)).toEqual({check:raw});
    const missing={...raw,requirementIds:['sum','missing-reference'],conformance:{...raw.conformance,requirementId:'missing-reference'}};
    const recovered=canonicalizeConformanceDeclaration(brief,plan,task,missing);expect(recovered.check.requirementIds).toEqual(['sum','python']);expect(recovered.correction?.original.requirementId).toBe('missing-reference');
    const wrong=structuredClone(brief);wrong.requirements.push({...wrong.requirements[1]!,id:'ruby',binding:{...binding,provider:'Ruby'},source:{kind:'request',reference:'request',text:'Use Ruby.'}});
    const contradictory={...raw,conformance:{...raw.conformance,requirementId:'ruby'}};
    expect(canonicalizeConformanceDeclaration(wrong,plan,{...task,requirementIds:[...task.requirementIds,'ruby']},contradictory)).toEqual({check:contradictory});
    const syntax=canonicalizeConformanceDeclaration(brief,plan,task,{...raw,args:['-m','py_compile','operacoes/soma.py']}).check;expect(verificationLevel(syntax)).toBe('syntax');
  }finally{await rm(workspace,{recursive:true,force:true});}
});
