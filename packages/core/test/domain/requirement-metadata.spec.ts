import { expect, it } from 'vitest';
import { resolveLiteralExcerpt } from '../../src/domain/literal-source.js';
import { recordedRequirementMetadata } from '../../src/domain/requirement-metadata.js';

const raw='Mandatory choices:\n- HostEngine\n- ViewKit\n- Automated checks\n\nUnrelated choice: OtherEngine.';
const quote='HostEngine\n- ViewKit\n- Automated checks';
const candidates=[{statement:'Deliver the application using the selected tools and automated checks.',quote,kind:'stack'}];
const bindings=[{provider:'HostEngine',kind:'runtime',capability:'execution'},{provider:'ViewKit',kind:'library',capability:'views'}];
const outcomes=[{quote:'Automated checks',statement:'Demonstrate automated checks.'}];
const response=(updates:unknown)=>({operation:'repair',result:JSON.stringify({requirements:updates})});

it('reuses an original classification by exact source and target index without changing the requirement or trusting its metadata',()=>{
  const input=structuredClone(candidates),answers=[response([{index:0,quote:'HostEngine ViewKit Automated checks',bindings,outcomes,statement:'Do not adopt this altered outcome.',extra:'untrusted'}])];
  const previous=structuredClone(answers);
  const result=recordedRequirementMetadata(raw,input,answers,resolveLiteralExcerpt);
  expect(result.conflicts).toEqual([]);
  expect(result.patches.get(0)).toEqual({index:0,quote,bindings,outcomes});
  expect(input).toEqual(candidates);expect(answers).toEqual(previous);
  // Validation belongs to INIT. A recorded classification is never a proof or
  // a silent reason to discard a malformed declaration.
  const malformed=recordedRequirementMetadata(raw,candidates,[response([{index:0,quote,bindings:['invalid declaration']}])],resolveLiteralExcerpt);
  expect(malformed.patches.get(0)!.bindings).toEqual(['invalid declaration']);
});

it('rejects unrelated calls, local-index collisions, malformed envelopes and origins that cannot be anchored uniquely',()=>{
  const payload={index:0,quote,bindings,outcomes};
  const answers=[
    {...response([payload]),operation:'discover'},
    response([{...payload,index:'0'}]),response([{...payload,index:1}]),response([{...payload,index:-1}]),
    response([{...payload,quote:'OtherEngine'}]),response([{...payload,quote:'HostEngine InventedKit Automated checks'}]),
    {operation:'repair',result:'not a JSON object'},
  ];
  expect(recordedRequirementMetadata(raw,candidates,answers,resolveLiteralExcerpt).patches.size).toBe(0);
  expect(recordedRequirementMetadata(`${raw}\n${quote}`,candidates,[response([payload])],resolveLiteralExcerpt).patches.size).toBe(0);
  expect(recordedRequirementMetadata(raw,candidates,[response([payload])],()=> 'not actual source text').patches.size).toBe(0);
});

it('retains conflicting classifications explicitly instead of selecting the last answer',()=>{
  const first=response([{index:0,quote,bindings,outcomes}]);
  const reordered=response([{index:0,quote,bindings:[...bindings].reverse(),outcomes}]);
  const compatible=recordedRequirementMetadata(raw,candidates,[first,reordered],resolveLiteralExcerpt);
  expect(compatible.patches.size).toBe(1);expect(compatible.conflicts).toEqual([]);
  const other=response([{index:0,quote,bindings:[{...bindings[0],kind:'sdk'},bindings[1]],outcomes}]);
  const conflict=recordedRequirementMetadata(raw,candidates,[first,reordered,other],resolveLiteralExcerpt);
  expect(conflict.patches.size).toBe(0);
  expect(conflict.conflicts).toEqual([{index:0,variants:[{index:0,quote,bindings,outcomes},{index:0,quote,bindings:[{...bindings[0],kind:'sdk'},bindings[1]],outcomes}]}]);
});

it('accepts a source resolver supplied by the coordinator while keeping provenance bound to the original span',()=>{
  const literal='Store records.\nIsolate test data.\nKeep records after restart.';
  const incomplete='Store records.\nKeep records after restart.';
  const candidate=[{statement:'Persist records.',quote:incomplete}];
  const answers=[response([{index:0,quote:literal,outcomes:[{quote:'Keep records after restart.',statement:'Retain records.'}]}])];
  expect(recordedRequirementMetadata(literal,candidate,answers,resolveLiteralExcerpt).patches.size).toBe(0);
  const resolver=(source:string,selection:string)=>selection===incomplete?resolveLiteralExcerpt(source,'Store records. [...] Keep records after restart.'):resolveLiteralExcerpt(source,selection);
  expect(recordedRequirementMetadata(literal,candidate,answers,resolver).patches.get(0)!.quote).toBe(literal);
});
