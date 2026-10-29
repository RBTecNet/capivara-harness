import { expect, it } from 'vitest';
import { runInit } from '../../src/domain/init.js';

it('recovers the paid literal Python classification despite terminal punctuation and rejects invented-provider alternatives',async()=>{
  const quote='Crie uma CLI em Python 3, usando somente a biblioteca padrão.';
  const request=quote+' A chamada `python3 calc.py somar 2 3` deve escrever `5` seguido de uma quebra de linha e sair com código zero. A chamada `python3 calc.py inverter ola` deve escrever `alo` seguido de uma quebra de linha e sair com código zero. Argumentos inválidos devem terminar com código 2 e mensagem em português no stderr. `python3 calc.py --help` deve explicar os dois comandos em português e terminar com código zero.\nImplemente as operações independentes em `operacoes/soma.py` e `operacoes/texto.py`. O ponto de entrada `calc.py` deve consumir ambos os módulos depois que estiverem implementados. Não há rede, serviço HTTP, interface gráfica, banco de dados ou dependência externa a instalar. Valide executando os comandos reais e um caso de entrada inválida; não crie uma suíte de testes.';
  const binding={capability:'standard-library-only runtime',kind:'runtime',provider:'Python 3'};
  const requirements=[
    {statement:'Implementar soma de dois argumentos numéricos; escrever o resultado seguido de quebra de linha e sair com código zero.',quote:'A chamada `python3 calc.py somar 2 3` deve escrever `5` seguido de uma quebra de linha e sair com código zero.',mode:'cli',kind:'behavior'},
    {statement:'Implementar inversão de texto; escrever o texto invertido seguido de quebra de linha e sair com código zero.',quote:'A chamada `python3 calc.py inverter ola` deve escrever `alo` seguido de uma quebra de linha e sair com código zero.',mode:'cli',kind:'behavior'},
    {statement:'Argumentos inválidos devem encerrar com código 2 e mensagem em português no stderr.',quote:'Argumentos inválidos devem terminar com código 2 e mensagem em português no stderr.',mode:'cli',kind:'behavior'},
    {statement:'A ajuda deve explicar os dois comandos em português e encerrar com código zero.',quote:'`python3 calc.py --help` deve explicar os dois comandos em português e terminar com código zero.',mode:'cli',kind:'behavior'},
    {statement:'Implementar as operações independentes nos módulos indicados e fazer o ponto de entrada consumir ambos.',quote:'Implemente as operações independentes em `operacoes/soma.py` e `operacoes/texto.py`. O ponto de entrada `calc.py` deve consumir ambos os módulos depois que estiverem implementados.',mode:'cli',kind:'interface'},
    {statement:'Usar Python 3 e somente a biblioteca padrão.',quote,mode:'cli',kind:'stack',binding},
  ];
  const outcome={quote:'usando somente a biblioteca padrão',statement:'A CLI uses only Python’s standard library.'};
  const valid={requirements:[{index:5,quote,bindings:[binding],outcomes:[outcome]}]};
  const invalid={requirements:[{index:5,quote,bindings:[{capability:'Python runtime',kind:'runtime',provider:'Python 3'},{capability:'standard library',kind:'library',provider:'Python standard library'}],outcomes:[{quote:'Crie uma CLI',statement:'Provide a command-line interface.'}]}]};
  const responses=[valid,invalid,invalid].map(value=>({operation:'repair',result:JSON.stringify(value)}));
  let calls=0,interviews=0;
  const result=await runInit({request,completedResponses:()=>responses,agent:async call=>{
    calls++;expect(call.operation).toBe('discover');
    return JSON.stringify({name:'CLI de cálculo',summary:'Soma e inversão por CLI.',modes:['cli'],requirements,constraints:[{statement:'Validar os comandos reais sem suíte de testes.',quote:'Valide executando os comandos reais e um caso de entrada inválida; não crie uma suíte de testes.',forbiddenCapabilities:['test suite'],requiredCapabilities:[]}],questions:[]});
  },ask:async()=>{interviews++;throw Error('All product facts are already literal.');}});
  expect(result.status).toBe('ready');expect(calls).toBe(1);expect(interviews).toBe(0);
  for(const original of requirements)expect(result.requirements).toContainEqual(expect.objectContaining({statement:original.statement,source:expect.objectContaining({text:original.quote})}));
  expect(result.requirements.flatMap(item=>item.binding?[item.binding.provider]:[])).toEqual(['Python 3']);
  expect(result.requirements).toContainEqual(expect.objectContaining({statement:outcome.statement,kind:'behavior',source:expect.objectContaining({text:outcome.quote})}));
  expect(result.constraints.some(item=>item.source.text.includes('não crie uma suíte de testes'))).toBe(true);
  const resumed=await runInit({request,existing:result,agent:async()=>{throw Error('Ready literal facts must remain reusable.');}});
  expect(resumed.constraints.some(item=>item.source.text.includes('não crie uma suíte de testes'))).toBe(true);
  expect(responses).toEqual([valid,invalid,invalid].map(value=>({operation:'repair',result:JSON.stringify(value)})));
});
