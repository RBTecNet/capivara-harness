import { expect, it } from 'vitest';
import { contextForTask, ContextTooLarge, packetText } from '../../src/domain/context.js';
import { reconcileAuthority } from '../../src/domain/init.js';
import { materializeProductInvariants } from '../../src/domain/product-invariants.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

it('transmits exact user prohibitions to backend and storage slices without inferring rules from UX, missing citations or supporting documents, and resumes without duplication',()=>{
  const independence='Os módulos Clientes, Pedidos e Arquivos não devem possuir relações entre suas entidades.';
  const longRestriction=`Do not share mutable records between modules. ${'Each independent boundary retains its own explicitly declared persistence scope. '.repeat(14)}This restriction applies when implementing both storage and transport.`;
  const ux='A interface exibe "Não encontrado" e "Do not disturb" como textos literais.';
  const request=`Crie uma API e persistência local.\n\n${independence}\n\n${longRestriction}\n\n${ux}`;
  const answer='Records must not be removed before their retention period expires.';
  const source=(text:string)=>({kind:'request' as const,reference:'request',text});
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:4,status:'ready',name:'Modules',summary:'Independent modules.',request,modes:['api'],targets:['portable'],constraints:[],gaps:[],decisions:[{id:'retention',questionId:'retention',fact:'Retention',answer,source:{kind:'answer',reference:'retention',text:answer}}],requirements:[
    {id:'api',statement:'Expose the API.',mode:'api',source:source('Crie uma API e persistência local.')},
    {id:'storage',statement:'Persist independent modules.',mode:'shared',source:source(`${independence}\n\n${longRestriction}`)},
    {id:'ux',statement:'Display the literal messages.',mode:'api',source:source(ux)},
    {id:'retention',statement:answer,mode:'shared',source:{kind:'answer',reference:'retention',text:answer}},
    {id:'support',statement:'Supporting convention.',mode:'shared',source:{kind:'repository',reference:'guide.md',text:'Never use independent modules.'}},
    {id:'invented',statement:'Unsupported interpretation.',mode:'shared',source:source('Do not expose any API.')},
  ]};
  const task=(id:string,requirementIds:string[]):WorkUnit=>({id,title:id,goal:`Implement ${id}.`,instructions:`Implement the ${id} slice.`,requirementIds,dependsOn:[],environmentIds:[],contractIds:[],files:[`src/${id}.ts`],criteria:[`The ${id} slice works.`],checks:[],risk:'normal',blockedBy:[]});
  const backend=task('backend',['api']),storage=task('storage',['storage']);
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[backend,storage]};
  for(const unit of [backend,storage]){
    const packet=contextForTask(brief,plan,unit,8000),text=packetText(packet);
    expect(packet.constraints.map(constraint=>constraint.statement)).toEqual(expect.arrayContaining([independence,longRestriction,answer]));
    expect(packet.constraints).toHaveLength(3);expect(text).toContain(longRestriction);
    expect(packet.constraints.every(constraint=>constraint.statement===constraint.source.text)).toBe(true);
    expect(packet.constraints.every(constraint=>constraint.forbiddenCapabilities.length===0&&constraint.requiredCapabilities.length===0)).toBe(true);
    expect(text).not.toContain('Never use independent modules.');expect(text).not.toContain('Do not expose any API.');
  }
  expect(brief.constraints).toEqual([]); // Packet construction is a pure projection.
  expect(()=>contextForTask(brief,plan,backend,1000)).toThrow(ContextTooLarge);
  materializeProductInvariants(brief);const original=JSON.stringify(brief.constraints);
  expect(brief.constraints.find(constraint=>constraint.statement===independence)?.origin).toEqual({schema:'capivara/constraint-origin/1',kind:'explicit-prohibition',requirementIds:['storage']});
  materializeProductInvariants(brief);reconcileAuthority(brief);reconcileAuthority(brief);
  expect(JSON.stringify(brief.constraints)).toBe(original);expect(brief.revision).toBe(4);
  expect(contextForTask(brief,plan,backend,8000).constraints.map(constraint=>constraint.id).sort()).toEqual(contextForTask(brief,plan,storage,8000).constraints.map(constraint=>constraint.id).sort());
});
