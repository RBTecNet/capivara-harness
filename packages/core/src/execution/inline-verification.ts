import { realpath, stat } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, resolve } from 'node:path';
import type { CommandRequest, CommandResult } from '../runtime/types.js';
import type { CommandExecutor } from './environment.js';
import { digest } from './files.js';

const probes=new Map<string,Promise<CommandResult>>();
/** Only literal argv are eligible. Shell expansion is not a grammar adapter. */
function literalArguments(command:string|readonly string[]):string[]|undefined{
  if(typeof command!=='string')return[...command];
  const result:string[]=[];let token='',quote='',started=false;
  for(let index=0;index<command.length;index++){
    const char=command[index]!;
    if(quote==="'"){if(char===quote)quote='';else token+=char;continue;}
    if(quote==='"'){
      if(char==='"'){quote='';continue;}
      if(char==='$'||char==='`')return undefined;
      if(char==='\\'&&['$','`','"','\\','\n'].includes(command[index+1]??'')){const next=command[++index]!;if(next!=='\n')token+=next;continue;}
      token+=char;continue;
    }
    if(char==='\\'){const next=command[++index];if(next===undefined)return undefined;if(next!=='\n')token+=next;started=true;continue;}
    if(char==='"'||char==="'"){quote=char;started=true;continue;}
    if(/[;&|<>`$\n\r]/.test(char))return undefined;
    if(/\s/.test(char)){if(started){result.push(token);token='';started=false;}continue;}
    token+=char;started=true;
  }
  if(quote)return undefined;if(started)result.push(token);return result;
}
const grammarValues=new Set(['--input-type','--experimental-default-type']);
const grammarFlags=new Set(['--experimental-strip-types','--no-experimental-strip-types','--experimental-transform-types','--experimental-detect-module','--no-experimental-detect-module','--allow-natives-syntax']);
function grammarOptions(args:readonly string[]):string[]{
  const result:string[]=[];
  for(let index=0;index<args.length;index++){
    const option=args[index]!;
    if(grammarFlags.has(option)||[...grammarValues].some(name=>option.startsWith(name+'=')))result.push(option);
    else if(grammarValues.has(option)&&args[index+1])result.push(option,args[++index]!);
  }
  return result;
}

function inlineNodeProgram(command:string|readonly string[]):{argv:string[];code:string;position:number}|undefined{
  const argv=literalArguments(command);if(!argv?.length||!/^node(?:js)?(?:\.exe)?$/i.test(basename(argv[0]!)))return undefined;
  const valued=new Set(['--import','--require','-r','--loader','--experimental-loader','--conditions','-C','--inspect-port','--icu-data-dir','--openssl-config',...grammarValues]);
  let code:string|undefined,position=-1;
  for(let index=1;index<argv.length;index++){
    const option=argv[index]!;
    if(option==='-e'||option==='--eval'){code=argv[index+1];position=index;break;}
    if(option.startsWith('--eval=')){code=option.slice('--eval='.length);position=index;break;}
    if(option==='--'||option==='-'||!option.startsWith('-')||option==='-p'||option==='--print')return undefined;
    if(valued.has(option)){if(argv[index+1]===undefined)return undefined;index++;}
  }
  if(code===undefined||position<0)return undefined;
  return{argv,code,position};
}
export function inlineNodeSyntaxCandidate(command:string|readonly string[]):boolean{return Boolean(inlineNodeProgram(command));}

/** Parse the verifier's outer program using its actual Node runtime, without
 * evaluating that program or loading its preloads/imported product modules. */
export async function checkInlineNodeSyntax(request:CommandRequest,execute:CommandExecutor,runtimeRevision=''):Promise<{result:CommandResult;identity:string;reused:boolean}|undefined>{
  const program=inlineNodeProgram(request.command);if(!program)return undefined;
  const {argv,code,position}=program;
  const environment={...request.environment,NODE_OPTIONS:'',NODE_V8_COVERAGE:''};
  const options=[...grammarOptions(literalArguments(request.environment?.NODE_OPTIONS??process.env.NODE_OPTIONS??'')??[]),...grammarOptions(argv.slice(1,position))];
  const locations=isAbsolute(argv[0]!)||argv[0]!.includes('/')||argv[0]!.includes('\\')?[resolve(request.cwd,argv[0]!)]:((request.environment?.PATH??process.env.PATH)??'').split(delimiter).map(folder=>resolve(request.cwd,folder||'.',argv[0]!));
  let runtime:unknown={command:argv[0],cwd:request.cwd,path:request.environment?.PATH??process.env.PATH};
  for(const candidate of locations){const actual=await realpath(candidate).catch(()=>undefined),info=actual?await stat(actual).catch(()=>undefined):undefined;if(info?.isFile()){runtime={path:actual,size:info.size,mode:info.mode,mtime:info.mtimeMs,ctime:info.ctimeMs};break;}}
  const identity=digest(JSON.stringify({protocol:'inline-node-syntax/1',runtime,runtimeRevision,code,options}));
  let result=probes.get(identity);const reused=Boolean(result);
  if(!result){
    result=execute({cwd:request.cwd,command:[argv[0]!,'--check',...options,'-'],input:code,environment,inputs:[],timeoutMs:Math.min(request.timeoutMs??10_000,10_000),executionPolicy:{purpose:'verification',writeScope:'isolated-workspace'},...(request.signal?{signal:request.signal}:{})});
    probes.set(identity,result);
  }
  try{const value=await result;if(value.cancelled||value.timedOut||value.issue||![0,1].includes(value.exitCode??-1))probes.delete(identity);return{result:value,identity,reused};}catch(error){probes.delete(identity);throw error;}
}
