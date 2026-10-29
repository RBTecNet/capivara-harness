import { expect, it } from 'vitest';
import { runInit } from '../../src/domain/init.js';
import { resolveLiteralExcerpt } from '../../src/domain/literal-source.js';

const source='Store records locally.\n\nKeep records after restart.\n\nTests must use isolated data.\n\nDo not depend on external services.';
const quotation='Store records locally.\n\nKeep records after restart.\n\nDo not depend on external services.';
const request=`Create a CLI for records.\n\n${source}`;
const behavior={statement:'Persist records across restarts without external services.',quote:quotation,mode:'cli',kind:'behavior'};

it('completes fresh INIT after a malformed discontinuous citation without another model call or losing the intervening obligation',async()=>{
  const calls:string[]=[],events:string[]=[];
  const brief=await runInit({request,agent:async call=>{
    calls.push(call.operation);
    if(call.operation!=='discover')throw Error('An exact source repair must not ask a model to repeat itself.');
    return JSON.stringify({requirements:[behavior],questions:[]});
  },onEvent:event=>events.push(event.type)});
  expect(resolveLiteralExcerpt(request,quotation)).toBeUndefined();
  expect(brief.status).toBe('ready');expect(calls).toEqual(['discover']);
  expect(brief.requirements[0]!.statement).toBe(behavior.statement);
  expect(brief.requirements[0]!.source.text).toBe(source);
  expect(brief.requirements[0]!.source.citationRecovery).toMatchObject({quote:quotation,strategy:'ordered-literal-paragraphs'});
  expect(brief.requirements[0]!.source.text).toContain('Tests must use isolated data.');
  expect(events).toContain('source-recovered');expect(brief.decisions).toEqual([]);
});

it('reuses an already paid classification after native source recovery changes which metadata is missing',async()=>{
  const stack='HostEngine\n- ViewKit\n- Automated checks';
  const text=`${request}\n\nRequired choices:\n- ${stack}`;
  const requirement={statement:'Use HostEngine and ViewKit and provide automated checks.',quote:stack,kind:'stack',binding:{capability:'execution',kind:'runtime',provider:'HostEngine'}};
  const answer={requirements:[{index:0,quote:stack,bindings:[requirement.binding,{capability:'views',kind:'library',provider:'ViewKit'}],outcomes:[{quote:'Automated checks',statement:'Run automated checks.'}]}]};
  let repairs=0;
  const brief=await runInit({request:text,completedResponses:()=>[{operation:'repair',result:JSON.stringify(answer)}],agent:async call=>{
    if(call.operation==='discover')return JSON.stringify({requirements:[requirement,behavior],questions:[]});
    repairs++;throw Error('The classification is already recorded.');
  }});
  expect(brief.status).toBe('ready');expect(repairs).toBe(0);
  expect(brief.requirements.filter(item=>item.binding).map(item=>item.binding!.provider).sort()).toEqual(['HostEngine','ViewKit']);
  expect(brief.requirements.find(item=>item.statement==='Run automated checks.')?.binding).toBeUndefined();
  expect(brief.requirements.find(item=>item.statement===behavior.statement)?.source.text).toBe(source);
});

it('still asks a real unresolved product decision after recovering the citation',async()=>{
  let interviews=0;
  const brief=await runInit({request,agent:async call=>{
    expect(call.operation).toBe('discover');
    return JSON.stringify({requirements:[behavior],questions:[{fact:'record retention period',question:'How long must records be retained?',reason:'Retention duration has not been specified.',impact:'Determines whether stored records may expire.',category:'data',modes:['cli'],options:['30 days','Without expiry'],blocks:[]}]});
  },ask:async question=>{interviews++;expect(question.fact).toBe('record retention period');return'Without expiry';}});
  expect(interviews).toBe(1);expect(brief.status).toBe('ready');
  expect(brief.decisions[0]?.answer).toBe('Without expiry');expect(brief.gaps[0]?.status).toBe('resolved');
});
