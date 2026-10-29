import { expect, it } from 'vitest';
import { applicableQuestion, resolveQuestions } from '../../src/domain/init.js';
import type { ProductBrief } from '../../src/domain/types.js';

function product(request='Crie uma aplicação web com persistência SQLite.'):ProductBrief{return{schema:'capivara/product/1',id:'product',status:'ready',revision:1,name:'Application',summary:'Manage records.',request,modes:['web'],targets:['browser'],requirements:[],constraints:[],decisions:[],gaps:[]};}
function question(fact:string,text:string,category='data'){return{fact,question:text,reason:'O pedido não define essa decisão do produto.',impact:'A resposta determina o comportamento que deve ser implementado.',category,modes:[],options:[],blocks:[]};}

it('asks real retention and ERP integration gaps despite a declared database and application interface',async()=>{
  const brief=product(),candidates=[question('prazo de armazenamento','Por quanto tempo os registros devem ser mantidos?'),question('interface de integração ERP','O ERP recebe eventos por webhook ou por arquivo CSV?','integration')];
  const asked:string[]=[];
  await resolveQuestions(brief,candidates,{ask:async gap=>{asked.push(gap.fact);return gap.category==='integration'?'Arquivo CSV':'Manter durante doze meses';}});
  expect(asked).toEqual(['prazo de armazenamento','interface de integração ERP']);expect(brief.decisions.map(decision=>decision.fact)).toEqual(asked);
  await resolveQuestions(brief,candidates,{ask:async()=>{throw new Error('Answered facts must not be interviewed again.');}});
});

it('suppresses the specific storage provider or application mode already declared by the user',()=>{
  for(const provider of ['JSON','SQLite']){
    const brief=product(`Crie uma aplicação web com persistência ${provider}.`);
    expect(applicableQuestion(question('persistência dos dados','Os dados ficam em JSON ou SQLite?'),brief)).toBeNull();
    expect(applicableQuestion(question('interface da aplicação','A aplicação será web ou TUI?','platform'),brief)).toBeNull();
  }
  expect(applicableQuestion(question('persistência dos dados','Os dados ficam em JSON ou SQLite?'),product('Crie uma TUI sem persistência.'))).toBeNull();
});

it('does not treat JSON output or a forbidden database as an answered storage decision',()=>{
  const storage=question('persistência dos dados','Os dados ficam em JSON ou SQLite?');
  expect(applicableQuestion(storage,product('Crie uma CLI para exportar relatórios JSON.'))).not.toBeNull();
  expect(applicableQuestion(storage,product('Crie uma aplicação web. Não usar SQLite.'))).not.toBeNull();
  expect(applicableQuestion(question('interface','Qual protocolo a interface do ERP exige?','integration'),product())).not.toBeNull();
  expect(applicableQuestion(question('interface','Qual protocolo a interface do ERP exige?','behavior'),product())).not.toBeNull();
});

it('rejects unsupported questions and engineering preferences while retaining business questions that mention tools',()=>{
  const brief=product();
  expect(applicableQuestion({...question('retenção','Qual prazo de retenção?'),reason:''},brief)).toBeNull();
  expect(applicableQuestion({...question('retenção','Qual prazo de retenção?'),impact:''},brief)).toBeNull();
  expect(applicableQuestion(question('biblioteca','Qual ORM devemos usar?'),brief)).toBeNull();
  expect(applicableQuestion(question('instalação','Usar npm ci ou npm install?'),brief)).toBeNull();
  expect(applicableQuestion(question('aparência','Você prefere Bootstrap ou Tailwind?','appearance'),brief)).toBeNull();
  const terminal=product('Crie uma TUI no terminal com persistência JSON.');terminal.modes=['tui'];terminal.targets=['portable'];
  expect(applicableQuestion({...question('aparência','Você prefere Bootstrap ou Tailwind?','appearance'),modes:['web']},terminal)).toBeNull();
  expect(applicableQuestion(question('prazo de armazenamento','Qual prazo de retenção a política do framework legado exige?'),brief)).not.toBeNull();
});
