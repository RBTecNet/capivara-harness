import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { assembleTaskContext } from '../../src/execution/task-context.js';
import { digest } from '../../src/execution/files.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'CLI',summary:'Execute the requested behavior',request:'Create a CLI.',modes:['cli'],targets:['portable'],requirements:[],constraints:[],decisions:[],gaps:[]};
const unit=(files:string[]):WorkUnit=>({id:'foundation',title:'Foundation',goal:'Provide the common behavior',instructions:'Implement the common behavior',requirementIds:[],dependsOn:[],environmentIds:[],contractIds:[],files,criteria:['The behavior is available'],checks:[],risk:'normal',blockedBy:[]});
const plan=(task:WorkUnit):DevelopmentPlan=>({schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]});
async function root(){const directory=await mkdtemp(join(tmpdir(),'capivara-task-context-'));roots.push(directory);return directory;}

describe('contexto de fonte completo ou cobertura explicitamente limitada',()=>{
  it('registra uma referência de revisão fora do projeto e continua entregando a fonte válida',async()=>{
    const directory=await root();await writeFile(join(directory,'app.ts'),'export const answer = 42;\n');const task=unit(['app.ts']);
    const context=await assembleTaskContext(brief,plan(task),task,directory,5000,'Resolve the original source claim.',['../outside.ts:12','app.ts']);
    expect(context.text).toContain('UNRESOLVED SOURCE REFERENCES');expect(context.text).toContain('../outside.ts:12');
    expect(context.text).toContain('export const answer = 42;');expect(context.coverage).toEqual([expect.objectContaining({path:'app.ts',complete:true})]);
  });

  it('entrega arquivos inteiros acima de 2400 caracteres quando cabem no orçamento global',async()=>{
    const directory=await root();
    const application=`${'const entry = true;\n'.repeat(250)}export const finalRoute = '/categories';\n`;
    const database='export const database = true;\n';
    await writeFile(join(directory,'app.ts'),application);await writeFile(join(directory,'db.ts'),database);
    const task=unit(['app.ts','db.ts']);
    const context=await assembleTaskContext(brief,plan(task),task,directory,12000);
    expect(application.length).toBeGreaterThan(2400);
    expect(context.text).toContain(application);
    expect(context.text).toContain(database);
    expect(context.text.length).toBeLessThanOrEqual(12000);
    expect(context.coverage).toEqual(expect.arrayContaining([expect.objectContaining({path:'app.ts',hash:digest(application),bytes:Buffer.byteLength(application),characters:application.length,complete:true,status:'complete'})]));
    expect(context.coverage.every(source=>source.complete)).toBe(true);
  });

  it('identifica arquivo enorme omitido sem enviar um prefixo disfarçado de fonte completa',async()=>{
    const directory=await root();
    const source=Array.from({length:1000},(_,index)=>`export const route${index} = '${'payload'.repeat(5)}';`).join('\n');
    await writeFile(join(directory,'huge.ts'),source);
    const task=unit(['huge.ts']);
    const context=await assembleTaskContext(brief,plan(task),task,directory,4000,'Verify the product behavior.');
    expect(context.text.length).toBeLessThanOrEqual(4000);
    expect(context.text).not.toContain('export const route0');
    expect(context.text).toContain('not evidence that code is absent or defective');
    expect(context.coverage[0]).toMatchObject({path:'huge.ts',hash:digest(source),complete:false,status:'omitted',ranges:[],lines:1000});
  });

  it('prioriza a fonte de um achado e rotula a faixa exata para esclarecimento sem reedição',async()=>{
    const directory=await root();
    const source=Array.from({length:1000},(_,index)=>`export const route${index+1} = 'actual-product-value';`).join('\n');
    await writeFile(join(directory,'huge.ts'),source);
    const task=unit(['huge.ts']);
    const context=await assembleTaskContext(brief,plan(task),task,directory,4000,'Inspect the actual code near the cited route.',['huge.ts:500-502']);
    const coverage=context.coverage[0]!;
    expect(context.text.length).toBeLessThanOrEqual(4000);
    expect(context.text).toContain("500: export const route500 = 'actual-product-value';");
    expect(context.text).toContain("502: export const route502 = 'actual-product-value';");
    expect(coverage).toMatchObject({path:'huge.ts',hash:digest(source),complete:false,status:'excerpt'});
    expect(coverage.startLine).toBeLessThanOrEqual(500);
    expect(coverage.endLine).toBeGreaterThanOrEqual(502);
    expect(context.text).toContain(`Only lines ${coverage.startLine}-${coverage.endLine} of 1000`);
    expect(coverage.ranges).toEqual([{startLine:coverage.startLine,endLine:coverage.endLine}]);
  });
});
