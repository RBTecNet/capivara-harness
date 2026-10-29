import { expect, it } from 'vitest';
import { runInit } from '../../src/domain/init.js';

it('accepts the fresh original Python declaration without turning contextual provenance into another provider, while rejecting invalid cached metadata and incomplete explicit lists',async()=>{
  const quote='Crie uma CLI em Python 3, usando somente a biblioteca padrão.';
  const sum='A chamada `python3 calc.py somar 2 3` deve escrever `5` seguido de uma quebra de linha e sair com código zero.';
  const reverse='A chamada `python3 calc.py inverter ola` deve escrever `alo` seguido de uma quebra de linha e sair com código zero.';
  const invalid='Argumentos inválidos devem terminar com código 2 e mensagem em português no stderr.';
  const help='`python3 calc.py --help` deve explicar os dois comandos em português e terminar com código zero.';
  const modules='Implemente as operações independentes em `operacoes/soma.py` e `operacoes/texto.py`. O ponto de entrada `calc.py` deve consumir ambos os módulos depois que estiverem implementados.';
  const validation='Valide executando os comandos reais e um caso de entrada inválida; não crie uma suíte de testes.';
  const request=`${quote} ${sum} ${reverse} ${invalid} ${help}+\n${modules} Não há rede, serviço HTTP, interface gráfica, banco de dados ou dependência externa a instalar. ${validation}`;
  const binding={capability:'Python 3 runtime and standard library',kind:'runtime',provider:'Python 3'};
  const requirements=[
    {statement:'A soma de 2 e 3 deve imprimir 5, seguida de quebra de linha, e sair com código zero.',quote:sum,mode:'cli',kind:'behavior'},
    {statement:'Inverter `ola` deve imprimir `alo`, seguida de quebra de linha, e sair com código zero.',quote:reverse,mode:'cli',kind:'behavior'},
    {statement:'Argumentos inválidos devem resultar em código de saída 2 e mensagem em português no stderr.',quote:invalid,mode:'cli',kind:'behavior'},
    {statement:'A opção `--help` deve explicar os dois comandos em português e sair com código zero.',quote:help,mode:'cli',kind:'behavior'},
    {statement:'As operações devem estar separadas em `operacoes/soma.py` e `operacoes/texto.py`; `calc.py` deve usar ambos os módulos.',quote:modules,mode:'cli',kind:'interface'},
    {statement:'Implementar em Python 3 usando somente a biblioteca padrão.',quote,mode:'cli',kind:'stack',binding},
    {statement:'Validar executando os comandos reais e um caso inválido, sem criar uma suíte de testes.',quote:validation,mode:'cli',kind:'constraint'},
  ];
  const bad={operation:'repair',result:JSON.stringify({requirements:[{index:5,quote,bindings:[{capability:'Python 3 runtime',kind:'runtime',provider:'Python 3'},{capability:'standard library',kind:'library',provider:'Python standard library'}],outcomes:[]}]})};
  for(const history of [[],[bad,bad]]){
    const events:string[]=[];let calls=0,questions=0;
    const result=await runInit({request,completedResponses:()=>history,onEvent:event=>events.push(event.type),ask:async()=>{questions++;throw Error('No user fact is missing.');},agent:async call=>{calls++;expect(call.operation).toBe('discover');return JSON.stringify({name:'CLI de cálculo',summary:'Soma e inversão com ajuda em português.',modes:['cli'],targets:['unspecified'],requirements,constraints:[],questions:[]});}});
    expect(result.status).toBe('ready');expect(calls).toBe(1);expect(questions).toBe(0);expect(result.requirements).toHaveLength(requirements.length);
    expect(result.requirements.flatMap(requirement=>requirement.binding?[requirement.binding.provider]:[])).toEqual(['Python 3']);
    for(const original of requirements)expect(result.requirements).toContainEqual(expect.objectContaining({statement:original.statement,source:expect.objectContaining({text:original.quote})}));
    expect(result.requirements.find(requirement=>requirement.kind==='stack')).toMatchObject({binding,source:{text:quote}});
    if(history.length){expect(events).toContain('metadata-rejected');expect(events).not.toContain('metadata-restored');}
    const resumed=await runInit({request,existing:result,agent:async()=>{throw Error('The complete original declaration must not replay.');}});expect(resumed).toEqual(result);
  }
  const complete='Node.js\n- TypeScript\n- React\n- Vite\n- SQLite em arquivo';
  let repairs=0;
  const named=[['runtime','runtime','Node.js'],['compiler','sdk','TypeScript'],['ui','library','React'],['builder','cli','Vite'],['database','driver','SQLite']].map(([capability,kind,provider])=>({capability,kind,provider}));
  const all=await runInit({request:`Crie uma aplicação web. Stack:\n- ${complete}`,agent:async call=>{
    if(call.operation==='discover')return JSON.stringify({requirements:[{statement:'Usar Node.js, TypeScript, React, Vite e SQLite em arquivo.',quote:complete,kind:'stack'}],questions:[]});
    repairs++;return JSON.stringify({requirements:[{index:0,quote:repairs===1?'Node.js':complete,bindings:repairs===1?named.slice(0,1):named}]});
  }});
  expect(repairs).toBe(2);expect(all.requirements.flatMap(requirement=>requirement.binding?[requirement.binding.provider]:[])).toHaveLength(5);
});
