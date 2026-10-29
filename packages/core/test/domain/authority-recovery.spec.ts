import { describe, expect, it } from 'vitest';
import { allowedCapabilities, contextForTask, explicitConstraints, explicitModes, packetText, preferredProofOwner, requiredTaskInterfaces, runInit, runPlan, validatePlan } from '../../src/domain/index.js';
import { derivePlanObligations } from '../../src/domain/reconcile.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

const literal = 'Fluxos reais executados no navegador.';
const request = `Crie uma aplicação web. ${literal}\nSem serviços externos.`;
const discovery = JSON.stringify({name:'Aplicação',summary:'Fluxos no navegador',requirements:[{statement:literal,quote:literal,mode:'web',kind:'behavior'}],questions:[]});
const task = (requirementId: string): WorkUnit => ({id:'existing-ui',title:'Fluxos',goal:literal,instructions:'Implementar os fluxos solicitados.',requirementIds:[requirementId],dependsOn:[],environmentIds:[],contractIds:[],files:['src/ui.tsx'],criteria:[literal],checks:[],risk:'normal',blockedBy:[]});
const plan = (brief: ProductBrief): DevelopmentPlan => ({schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[task(brief.requirements[0]!.id)]});

describe('autoridade literal e recuperação de interpretações do harness', () => {
  it('não transforma a preposição portuguesa no em negação inglesa', () => {
    expect(explicitConstraints(`- ${literal}`)).toEqual([]);
    expect(explicitModes(literal)).toContain('web');
    expect(explicitConstraints('No browser.')[0]?.forbiddenCapabilities).toEqual(['browser']);
    expect(explicitModes('No browser.')).not.toContain('web');
    expect(explicitConstraints('Execute no servidor HTTP e consulte no banco de dados.')).toEqual([]);
  });

  it('limita a negação ao seu objeto e conserva proibições reais', () => {
    expect(explicitConstraints('Sem autenticação, executar fluxos no navegador; sem serviços externos.')).toEqual([]);
    expect(explicitModes('Sem autenticação, crie uma aplicação web.')).toContain('web');
    for (const text of ['Sem navegador.', 'Não usar um navegador.', 'Não deve usar um navegador.', 'Do not use a browser.', 'Without a web interface.']) expect(explicitConstraints(text)[0]?.forbiddenCapabilities).toEqual(['browser']);
    for (const text of ['Sem servidor HTTP.', 'Não iniciar um servidor HTTP.', 'Do not start an HTTP server.']) expect(explicitConstraints(text)[0]?.forbiddenCapabilities).toEqual(['http-server']);
    expect(explicitConstraints('Sem servidor HTTP e sem navegador.')[0]?.forbiddenCapabilities).toEqual(['http-server','browser']);
    expect(explicitConstraints('Sem servidor externo nem banco de dados externo. Sem servidor HTTP externo.')).toEqual([]);
  });

  it('corrige estado persistido sem redescobrir requisitos e registra a interpretação original', async () => {
    let calls = 0;
    const agent = async () => { calls += 1; return discovery; };
    const original = await runInit({request,agent});
    const corrupted = structuredClone(original);
    corrupted.constraints.push({id:'stale-browser-inference',statement:literal,source:{kind:'request',reference:'request',text:literal},forbiddenCapabilities:['browser'],requiredCapabilities:[]});
    const recovered = await runInit({request,agent,existing:corrupted});
    expect(calls).toBe(1);
    expect(recovered.requirements).toEqual(original.requirements);
    expect(recovered.constraints).toEqual([]);
    expect(recovered.revision).toBe(original.revision + 1);
    expect(recovered.authorityCorrections).toEqual([expect.objectContaining({constraintId:'stale-browser-inference',source:{kind:'request',reference:'request',text:literal},before:{forbiddenCapabilities:['browser'],requiredCapabilities:[]},after:{forbiddenCapabilities:[],requiredCapabilities:[]}})]);
    expect(allowedCapabilities(recovered,['browser'])).toBe(true);
    const packet = packetText(contextForTask(recovered,plan(recovered),task(recovered.requirements[0]!.id)));
    expect(packet).toContain('forbidden=none');
    const resumed = await runInit({request,agent,existing:recovered});
    expect(resumed.revision).toBe(recovered.revision);
    expect(resumed.authorityCorrections).toEqual(recovered.authorityCorrections);
    expect(calls).toBe(1);
  });

  it('preserva a obrigação de navegador pendente sem comprar receita antes do código existir', async () => {
    const brief = await runInit({request,agent:async()=>discovery});
    const existing = plan(brief);
    const previousTasks = structuredClone(existing.tasks);
    brief.revision += 1;
    const operations: string[] = [];
    const result = await runPlan({brief,existing,agent:async call => {operations.push(call.operation);throw new Error('A future browser recipe is BUILD work.');}});
    expect(operations).toEqual([]);
    expect(result.tasks).toEqual(previousTasks);
    expect(result.briefRevision).toBe(brief.revision);
    expect(validatePlan(brief,result)).toEqual([]);
    expect(existing.acceptance).toBeUndefined();
    expect(result.obligations).toContainEqual(expect.objectContaining({requirementId:brief.requirements[0]!.id,kind:'interface',interface:'web',recipeStatus:'pending',verification:'required-in-build'}));
    expect(requiredTaskInterfaces(brief,result,result.tasks[0]!)).toEqual(['web']);
  });

  it('não aceita build, API ou metadado sem execução como prova de interação no navegador', async () => {
    const brief = await runInit({request,agent:async()=>discovery});
    const proposed = plan(brief);
    const id = brief.requirements[0]!.id;
    for (const check of [
      {id:'build',kind:'command' as const,command:'npm run build',level:'build' as const,requirementIds:[id],requiredCapabilities:[]},
      {id:'api',kind:'cli' as const,command:'npm run test:api',level:'behavior' as const,requirementIds:[id],requiredCapabilities:[]},
      {id:'label',kind:'web' as const,level:'behavior' as const,requirementIds:[id],requiredCapabilities:['browser']},
    ]) {
      proposed.acceptance = [check];
      expect(validatePlan(brief,proposed)).toEqual([]);
      expect(derivePlanObligations(brief,proposed)).toContainEqual(expect.objectContaining({requirementId:id,kind:'interface',interface:'web',recipeStatus:'pending',verification:'required-in-build'}));
    }
  });

  it('atribui interação ao consumidor final e não exige UI pronta na fundação compartilhada', async () => {
    const brief = await runInit({request,agent:async()=>discovery});
    const id = brief.requirements[0]!.id;
    const proposed = plan(brief);
    const foundation = {...task(id),id:'foundation',goal:'Compilar a base compartilhada',files:['package.json'],checks:[{id:'build',kind:'command' as const,command:'npm run build',level:'build' as const,requirementIds:[id],requiredCapabilities:[]}]};
    const left = {...task(id),id:'left',goal:'Executar o fluxo esquerdo',files:['src/left.tsx'],dependsOn:['foundation']};
    const right = {...task(id),id:'right',goal:'Executar o fluxo direito',files:['src/right.tsx'],dependsOn:['foundation']};
    const integrated = {...task(id),id:'integration',goal:'Integrar os dois fluxos no navegador',files:['tests/flows.ts'],dependsOn:['left','right']};
    proposed.tasks = [foundation,left,right,integrated];
    expect(requiredTaskInterfaces(brief,proposed,foundation)).toEqual([]);
    expect(requiredTaskInterfaces(brief,proposed,left)).toEqual([]);
    expect(requiredTaskInterfaces(brief,proposed,right)).toEqual([]);
    expect(requiredTaskInterfaces(brief,proposed,integrated)).toEqual(['web']);
    expect(preferredProofOwner(proposed,id)?.id).toBe('integration');
    const repaired = await runPlan({brief,existing:proposed,agent:async()=>{throw new Error('No missing engineering decision.');}});
    expect(requiredTaskInterfaces(brief,repaired,foundation)).toEqual([]);
    expect(requiredTaskInterfaces(brief,repaired,integrated)).toEqual(['web']);
    expect(repaired.tasks).toEqual(proposed.tasks);
    repaired.acceptance=[{id:'browser-flow',kind:'web',command:'npm run test:browser',level:'behavior',requirementIds:[id],requiredCapabilities:['browser']}];
    expect(requiredTaskInterfaces(brief,repaired,integrated)).toEqual([]);
  });
});
