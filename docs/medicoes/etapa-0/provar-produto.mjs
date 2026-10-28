import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export function provarProduto(project) {
  const began = performance.now();
  const root = mkdtempSync(join(tmpdir(), 'capivara-oraculo-'));
  const cli = resolve(project, 'src/cli.js');
  const tests = [];
  const check = (name, action) => {
    try { action(); tests.push({name, passed:true}); }
    catch(e) { tests.push({name, passed:false, error:e.message.slice(0,1800)}); }
  };
  const call = (file, args, cwd=project, useDefault=false) => {
    const env={...process.env}; delete env.TASKS_FILE;
    if(!useDefault) env.TASKS_FILE=file;
    return spawnSync(process.execPath,[cli,...args],{cwd,env,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
  };
  const good = (file, args, cwd, useDefault) => {
    const r=call(file,args,cwd,useDefault);
    assert.equal(r.status,0,`${args.join(' ')}: ${r.stderr || r.error || r.stdout}`);
    return JSON.parse(r.stdout.trim());
  };
  const add = (file,title) => good(file,['add',title]);
  const rejected = (file,args) => {
    const before=existsSync(file)?readFileSync(file):null;
    const r=call(file,args);
    assert.notEqual(r.status,0,`${args.join(' ')} foi aceito`);
    assert.ok(r.stderr.trim(),'erro sem explicação no stderr');
    const after=existsSync(file)?readFileSync(file):null;
    assert.deepEqual(after,before,'a recusa alterou os dados');
  };
  try {
    check('listagem vazia sem criar arquivo',()=>{
      const f=join(root,'missing.json'); assert.deepEqual(good(f,['list']),[]); assert.equal(existsSync(f),false);
    });
    check('criação, título aparado e persistência entre processos',()=>{
      const f=join(root,'persist.json');
      assert.deepEqual(add(f,'  primeira tarefa  '),{id:1,title:'primeira tarefa',done:false});
      assert.deepEqual(good(f,['list']),[{id:1,title:'primeira tarefa',done:false}]);
    });
    check('duas tarefas com IDs únicos e ordenação',()=>{
      const f=join(root,'ordered.json'); add(f,'a'); add(f,'b');
      assert.deepEqual(good(f,['list']),[{id:1,title:'a',done:false},{id:2,title:'b',done:false}]);
    });
    check('conclusão persistente e idempotente',()=>{
      const f=join(root,'done.json'); add(f,'a'); add(f,'b');
      assert.deepEqual(good(f,['done','1']),{id:1,title:'a',done:true});
      assert.deepEqual(good(f,['done','1']),{id:1,title:'a',done:true});
      assert.deepEqual(good(f,['list']),[{id:1,title:'a',done:true},{id:2,title:'b',done:false}]);
    });
    check('remoção e IDs nunca reutilizados, inclusive com lista vazia',()=>{
      const f=join(root,'remove.json'); add(f,'a');
      assert.deepEqual(good(f,['remove','1']),{removed:1}); assert.deepEqual(good(f,['list']),[]);
      assert.equal(add(f,'b').id,2); add(f,'c'); good(f,['remove','3']); assert.equal(add(f,'d').id,4);
    });
    check('título vazio recusado sem alterar dados',()=>{
      const f=join(root,'invalid-title.json'); add(f,'a'); rejected(f,['add','   ']);
    });
    check('IDs inválidos e inexistentes recusados sem alterar dados',()=>{
      const f=join(root,'invalid-id.json'); add(f,'a');
      for(const op of ['done','remove']) for(const id of ['abc','0','-1','1.5','999']) rejected(f,[op,id]);
    });
    check('comando desconhecido recusado sem alterar dados',()=>{
      const f=join(root,'unknown.json'); add(f,'a'); rejected(f,['desconhecido']);
    });
    check('arquivos independentes, diretórios pais e espaços no caminho',()=>{
      const a=join(root,'com espaços','nested','a.json'), b=join(root,'other','b.json');
      assert.equal(add(a,'a').id,1); assert.deepEqual(good(b,['list']),[]); assert.equal(existsSync(b),false);
      assert.equal(add(b,'b').id,1); assert.equal(good(a,['list'])[0].title,'a');
    });
    check('caminho padrão relativo ao diretório de trabalho',()=>{
      const cwd=join(root,'default'); mkdirSync(cwd);
      assert.deepEqual(good(null,['list'],cwd,true),[]);
      assert.equal(existsSync(join(cwd,'data')),false);
      assert.equal(good(null,['add','padrão'],cwd,true).id,1);
      assert.ok(existsSync(join(cwd,'data/tasks.json')));
      assert.equal(good(null,['list'],cwd,true)[0].title,'padrão');
    });
    check('manifesto sem dependências e documentação mínima',()=>{
      const p=JSON.parse(readFileSync(join(project,'package.json'),'utf8'));
      assert.equal(p.type,'module'); assert.equal(Object.keys(p.dependencies??{}).length,0);
      assert.equal(Object.keys(p.devDependencies??{}).length,0);
      assert.match(p.scripts?.test??'',/node\s+--test/); assert.match(p.scripts?.start??'',/src\/cli\.js/);
      const readme=readFileSync(join(project,'README.md'),'utf8');
      assert.match(readme,/TASKS_FILE/); for(const op of ['add','list','done','remove']) assert.ok(readme.includes(op));
    });
    check('suíte do próprio produto executa com sucesso',()=>{
      const result=execFileSync('npm',['test'],{cwd:project,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
      assert.match(result,/(?:tests\s+[1-9]|pass\s+[1-9])/,'suíte sem teste observado');
    });
  } finally {rmSync(root,{recursive:true,force:true});}
  return {method:'processos Node reais; mesmas 12 verificações externas; sem feedback aos agentes',tests,passed:tests.filter(t=>t.passed).length,total:tests.length,durationMs:Math.round(performance.now()-began)};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(provarProduto(resolve(process.argv[2])),null,2));
