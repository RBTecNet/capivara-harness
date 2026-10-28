import type { AssertionJson, Verification, VerificationAssertion } from './types.js';

const record = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value,key);
function json(value: unknown, depth=0): value is AssertionJson {
  if(depth>32)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return true;
  return Array.isArray(value)?value.every(item=>json(item,depth+1)):record(value)&&Object.values(value).every(item=>json(item,depth+1));
}

/** Only declared selectors enter execution. Prose is preserved separately in expected. */
export function normalizeVerificationAssertion(value: unknown, depth=0): VerificationAssertion | undefined {
  if(!record(value)||depth>16)return undefined;
  const source=value.source;
  if(source!==undefined&&!['stdout','stderr','output'].includes(String(source)))return undefined;
  const stream=source===undefined?{}:{source:source as 'stdout'|'stderr'|'output'};
  if(value.type==='contains'&&typeof value.value==='string'&&value.value.length)return{type:'contains',value:value.value,...stream};
  if(value.type==='empty')return{type:'empty',...stream};
  if(value.type==='exit'&&typeof value.value==='number'&&Number.isInteger(value.value)&&value.value>=0&&value.value<=255)return{type:'exit',value:value.value};
  if(value.type==='regex'&&typeof value.pattern==='string'&&value.pattern.length){
    if(value.flags!==undefined&&typeof value.flags!=='string')return undefined;
    const flags=typeof value.flags==='string'?value.flags:'m';
    if(!/^[imsu]*$/.test(flags)||new Set(flags).size!==flags.length)return undefined;
    try{new RegExp(value.pattern,flags);}catch{return undefined;}
    return{type:'regex',pattern:value.pattern,flags,...stream};
  }
  if(value.type==='json'){
    if(source==='output'||value.path!==undefined&&!Array.isArray(value.path))return undefined;
    const path=value.path??[];
    if(!Array.isArray(path)||!path.every(key=>typeof key==='string'||typeof key==='number'&&Number.isInteger(key)&&key>=0))return undefined;
    if(!own(value,'equals')&&!own(value,'exists'))return undefined;
    if(own(value,'equals')&&!json(value.equals)||own(value,'exists')&&typeof value.exists!=='boolean')return undefined;
    return{type:'json',...(source?{source:source as 'stdout'|'stderr'}:{}),path:[...path] as (string|number)[],...(own(value,'equals')?{equals:value.equals as AssertionJson}:{}),...(own(value,'exists')?{exists:value.exists as boolean}:{})};
  }
  if((value.type==='all'||value.type==='any')&&Array.isArray(value.assertions)&&value.assertions.length){
    const assertions=value.assertions.map(item=>normalizeVerificationAssertion(item,depth+1));
    if(assertions.some(item=>!item))return undefined;
    return{type:value.type,assertions:assertions as VerificationAssertion[]};
  }
  return undefined;
}

export interface VerificationAssertionStatus {
  status: 'ready' | 'missing' | 'invalid';
  assertion?: VerificationAssertion;
  issues: string[];
}
export function verificationAssertionStatus(check: Pick<Verification,'assertion'|'assertionIssue'|'expected'>): VerificationAssertionStatus {
  if(check.assertionIssue)return{status:'invalid',issues:[check.assertionIssue]};
  if(check.assertion!==undefined){
    const assertion=normalizeVerificationAssertion(check.assertion);
    return assertion?{status:'ready',assertion,issues:[]}:{status:'invalid',issues:['Invalid assertion: declare type and its typed selector/value; empty predicates, invalid regex and unknown operators are not executable.']};
  }
  // Explicit legacy machine syntax is unambiguous. Human descriptions never
  // become predicates through matching Portuguese or English success phrases.
  const expected=check.expected;
  let candidate:unknown;
  if(expected?.startsWith('contains:'))candidate={type:'contains',source:'output',value:expected.slice(9).trim()};
  else if(expected?.startsWith('regex:'))candidate={type:'regex',source:'output',pattern:expected.slice(6).trim(),flags:'m'};
  else if(expected&&/^exit:\s*\d+$/.test(expected))candidate={type:'exit',value:Number(expected.slice(5).trim())};
  else if(expected==='json')candidate={type:'json',path:[],exists:true};
  if(candidate!==undefined){
    const assertion=normalizeVerificationAssertion(candidate);
    return assertion?{status:'ready',assertion,issues:[]}:{status:'invalid',issues:['The explicit legacy assertion is malformed; recover a typed assertion without changing the product.']};
  }
  return{status:'missing',issues:['Human expected describes the criterion but does not select an observable value. Recover assertion from the recorded command observation; exit code alone is not inferred as behavioral proof.']};
}
