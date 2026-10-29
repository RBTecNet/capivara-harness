import type { TargetPlatform, Verification } from './types.js';

const fields = [
  'id', 'kind', 'command', 'args', 'cwd', 'expected', 'assertion', 'assertionIssue', 'expectedExitCode',
  'input', 'steps', 'closeInput', 'timeoutMs', 'target', 'platform', 'declarationTransformation', 'inputs', 'outputs', 'level', 'dependsOn',
  'requiredCapabilities', 'requirementIds', 'requirementId', 'constraintIds', 'conformance', 'acceptance',
  'capability', 'provider', 'productInputs', 'providerCommand', 'providerInputs', 'artifacts',
] as const;

/** A transport envelope can move explicit fields, never supply a missing
 * executable, reinterpret a predicate, or turn a declaration into evidence. */
export function verificationDeclaration(value: Record<string, unknown>): Record<string, unknown> {
  const recipe = value.recipe;
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return { ...value };
  const nested = recipe as Record<string, unknown>, result = { ...value };
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field) && Object.prototype.hasOwnProperty.call(nested, field)) result[field] = nested[field];
  return result;
}

const interfaces=new Set(['cli','tui','web','desktop']);
const platforms=new Set(['linux','windows','macos','browser','portable']);
const text=(value:unknown):string=>typeof value==='string'?value.trim().toLowerCase():'';

/** Interface and platform are separate typed facts. A misplaced explicit
 * interface can fill a generic kind; product prose and command names cannot. */
export function verificationInterfaceDeclaration(value:Record<string,unknown>):Pick<Verification,'kind'|'target'|'declarationTransformation'>{
  const originalKind=text(value.kind),target=text(value.target),platform=platforms.has(target)?target:text(value.platform);
  const generic=(value.kind===undefined||value.kind===null||typeof value.kind==='string')&&(!originalKind||originalKind==='command');
  const kind=(generic&&interfaces.has(target)?target:['command',...interfaces].includes(originalKind)?originalKind:'command') as Verification['kind'];
  const selected:Pick<Verification,'kind'|'target'|'declarationTransformation'>={kind,...(platforms.has(platform)?{target:platform as TargetPlatform}:{})};
  if(generic&&interfaces.has(target))selected.declarationTransformation={schema:'capivara/verification-interface/1',original:{...(value.kind===null||typeof value.kind==='string'?{kind:value.kind}:{}),target:value.target as string},selectedKind:kind as 'cli'|'tui'|'web'|'desktop',reason:'explicit-interface-target'};
  else{
    const previous=value.declarationTransformation;
    if(previous&&typeof previous==='object'&&!Array.isArray(previous)){
      const item=previous as Record<string,unknown>,origin=item.original;
      if(origin&&typeof origin==='object'&&!Array.isArray(origin)){
        const original=origin as Record<string,unknown>;
        const genericOrigin=(original.kind===undefined||original.kind===null||typeof original.kind==='string')&&(!text(original.kind)||text(original.kind)==='command');
        if(item.schema==='capivara/verification-interface/1'&&item.reason==='explicit-interface-target'&&genericOrigin&&interfaces.has(text(original.target))&&item.selectedKind===kind&&text(original.target)===kind)selected.declarationTransformation={schema:'capivara/verification-interface/1',original:{...(original.kind===null||typeof original.kind==='string'?{kind:original.kind}:{}),target:original.target as string},selectedKind:kind as 'cli'|'tui'|'web'|'desktop',reason:'explicit-interface-target'};
      }
    }
  }
  return selected;
}
