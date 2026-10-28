import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeChecks } from '../../src/domain/plan.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { evaluateVerificationAssertion, normalizeVerificationAssertion, runVerification, verificationAssertionStatus } from '../../src/execution/checks.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const product:ProductBrief={schema:'capivara/product/1',id:'fixture',revision:1,status:'ready',name:'Fixture',summary:'Fixture',request:'Create a CLI.',modes:['cli'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
const task:WorkUnit={id:'fixture',title:'Fixture',goal:'Print a result',instructions:'Print a result',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files:[],inputs:[],criteria:['Print a result'],checks:[],risk:'normal',blockedBy:[]};
const plan:DevelopmentPlan={schema:'capivara/plan/1',briefId:'fixture',briefRevision:1,revision:1,status:'ready',environment:[],contracts:[],tasks:[task]};
const output={stdout:'{"record":{"id":7,"active":false},"items":[{"name":"saved"}]}',stderr:'diagnostic',exitCode:0};
async function run(check:Partial<Verification>={}){
  const root=await mkdtemp(join(tmpdir(),'capivara-assertion-'));roots.push(root);
  const recipe:Verification={id:'proof',kind:'cli',command:process.execPath,args:['-e','console.log("record saved")'],inputs:[],level:'behavior',requirementIds:[],requiredCapabilities:[],...check};
  return runVerification(root,product,task,plan,recipe,executeCommand,runTerminal);
}

describe('predicados de prova explícitos e observações persistidas',()=>{
  it('preserva um build executado com sucesso sem aprovar uma asserção explícita malformada',async()=>{
    const result=await run({level:'build',assertionIssue:'The explicit assertion has an unsupported shape.'});
    expect(result.result?.exitCode).toBe(0);expect(result.evidence.passed).toBe(false);
    expect(result.classification).toBe('instrument');expect(result.evidence.assertionStatus).toBe('invalid');
  });

  it('normaliza seletores tipados sem converter o critério humano em asserção',()=>{
    const [check]=normalizeChecks([{id:'typed',kind:'cli',command:'node',expected:'O registro é persistido.',assertion:{type:'contains',source:'stdout',value:'record saved'}}],product);
    expect(check?.expected).toBe('O registro é persistido.');
    expect(check?.assertion).toEqual({type:'contains',source:'stdout',value:'record saved'});
    expect(verificationAssertionStatus(check!)).toMatchObject({status:'ready'});
    const [invalid]=normalizeChecks([{id:'invalid',command:'node',assertion:{type:'regex',pattern:'['}}],product);
    expect(invalid?.assertionIssue).toBeTruthy();
    expect(verificationAssertionStatus(invalid!)).toMatchObject({status:'invalid'});
    expect(normalizeVerificationAssertion({type:'contains',value:''})).toBeUndefined();
    expect(normalizeVerificationAssertion({type:'all',assertions:[]})).toBeUndefined();
  });

  it('verifica valores JSON concretos, índices e ausência sem aceitar só um rótulo JSON',()=>{
    expect(evaluateVerificationAssertion({assertion:{type:'json',path:['record','id'],equals:7}},output).passed).toBe(true);
    expect(evaluateVerificationAssertion({assertion:{type:'json',path:['record','active'],equals:false}},output).passed).toBe(true);
    expect(evaluateVerificationAssertion({assertion:{type:'json',path:['items',0,'name'],equals:'saved'}},output).passed).toBe(true);
    expect(evaluateVerificationAssertion({assertion:{type:'json',path:['record','id'],equals:8}},output).status).toBe('failed');
    expect(evaluateVerificationAssertion({assertion:{type:'json',path:['missing'],exists:false}},output).passed).toBe(true);
    expect(evaluateVerificationAssertion({assertion:{type:'json',path:['toString'],exists:true}},output).passed).toBe(false);
    expect(normalizeVerificationAssertion({type:'json'})).toBeUndefined();
  });

  it('combina predicados e conserva diferença entre saída, stderr e código',()=>{
    const assertion=normalizeVerificationAssertion({type:'all',assertions:[{type:'exit',value:0},{type:'regex',source:'stderr',pattern:'^diagnostic$'},{type:'any',assertions:[{type:'contains',value:'missing'},{type:'json',path:['record','id'],equals:7}]}]});
    expect(assertion).toBeDefined();
    expect(evaluateVerificationAssertion({assertion:assertion!},output).passed).toBe(true);
    expect(evaluateVerificationAssertion({assertion:{type:'contains',source:'stdout',value:'diagnostic'}},output).passed).toBe(false);
  });

  it('mantém prosa e exit zero pendentes mesmo quando o texto coincide com stdout',async()=>{
    const result=await run({expected:'record saved',expectedExitCode:0});
    expect(result.evidence.passed).toBe(false);
    expect(result.classification).toBe('instrument');
    expect(result.assertionPending).toBe(true);
    expect(result.evidence.assertionStatus).toBe('missing');
    expect(result.evidence.observation).toMatchObject({stdout:'record saved\n',exitCode:0,cancelled:false,timedOut:false,terminal:false});
  });

  it('resolve somente o predicado sobre a observação salva sem reexecutar o produto',async()=>{
    const pending=await run({expected:'O registro é persistido.'});
    const saved=JSON.parse(JSON.stringify(pending.evidence));
    const resolved=evaluateVerificationAssertion({assertion:{type:'contains',source:'stdout',value:'record saved'}},saved.observation);
    expect(resolved.status).toBe('passed');
    expect(pending.evidence.passed).toBe(false);
    expect(pending.evidence.observation?.command).toBe(saved.observation.command);
    const verified=await run({expected:'O registro é persistido.',assertion:{type:'contains',source:'stdout',value:'record saved'}});
    expect(verified.evidence.passed).toBe(true);
    expect(verified.evidence.assertionStatus).toBe('ready');
  });

  it('não apaga uma falha material porque também falta um predicado',async()=>{
    const broken=await run({args:['-e','process.stderr.write("storage is broken"); process.exit(1)'],expected:'O registro é persistido.'});
    expect(broken.evidence.passed).toBe(false);
    expect(broken.classification).toBe('product');
    expect(broken.assertionPending).toBe(false);
    expect(broken.evidence.observation?.stderr).toBe('storage is broken');
    const mismatch=await run({assertion:{type:'contains',value:'correct record'}});
    expect(mismatch.classification).toBe('product');
    expect(mismatch.evidence.assertionStatus).toBe('failed');
  });
});
