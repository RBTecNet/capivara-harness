import { expect, it } from 'vitest';
import { resolveLiteralExcerpt } from '../../src/domain/literal-source.js';

it('returns a real source span across whitespace and structural list markers',()=>{
  const raw='Stack obrigatória:\n- Node.js\n- TypeScript\n3. React\n';
  expect(resolveLiteralExcerpt(raw,'Node.js TypeScript React')).toBe('Node.js\n- TypeScript\n3. React');
  expect(resolveLiteralExcerpt('Cada módulo:\n1. Criar.\n2. Consultar.','Cada módulo: 1. Criar. 2. Consultar.')).toBe('Cada módulo:\n1. Criar.\n2. Consultar.');
});

it('preserves the omitted raw text instead of concatenating quoted fragments',()=>{
  const raw='Antes.\nCRUD de tarefas.\n- Campos e regras reais.\nPermitir consultar e editar.\nDepois.';
  const expected='CRUD de tarefas.\n- Campos e regras reais.\nPermitir consultar e editar.';
  expect(resolveLiteralExcerpt(raw,'CRUD de tarefas. [...] Permitir consultar e editar.')).toBe(expected);
  expect(resolveLiteralExcerpt(raw,'CRUD de tarefas. … Permitir consultar e editar.')).toBe(expected);
  expect(resolveLiteralExcerpt(raw,'CRUD de tarefas. Permitir consultar e editar.')).toBeUndefined();
});

it('requires exact complete tokens and retains meaningful punctuation',()=>{
  expect(resolveLiteralExcerpt('Django e Node.js com C++.','Go')).toBeUndefined();
  expect(resolveLiteralExcerpt('Django e Node.js com C++.','Node')).toBeUndefined();
  expect(resolveLiteralExcerpt('Django e Node.js com C++.','C')).toBeUndefined();
  expect(resolveLiteralExcerpt('Django e Node.js com C++.','Node.js')).toBe('Node.js');
  expect(resolveLiteralExcerpt('React, TypeScript.','React TypeScript')).toBeUndefined();
  expect(resolveLiteralExcerpt('React, TypeScript.','React, TypeScript.')).toBe('React, TypeScript.');
  expect(resolveLiteralExcerpt('React.','react.')).toBeUndefined();
});

it('rejects invented words and nonliteral reformulations without falling back to the request',()=>{
  const raw='Criar tarefas.\nSalvar em arquivo.\nExcluir com confirmação.';
  expect(resolveLiteralExcerpt(raw,'Criar categorias.')).toBeUndefined();
  expect(resolveLiteralExcerpt(raw,'Criar tarefas. [...] Remover com confirmação.')).toBeUndefined();
  expect(resolveLiteralExcerpt(raw,'Criar tarefas. Excluir com confirmação.')).toBeUndefined();
  expect(resolveLiteralExcerpt(raw,'')).toBeUndefined();
});

it('requires unique anchors, including repeated occurrences across explicit omissions',()=>{
  expect(resolveLiteralExcerpt('React.\nReact.','React.')).toBeUndefined();
  expect(resolveLiteralExcerpt('Início. Um. Fim. Início. Dois. Fim.','Início. [...] Fim.')).toBeUndefined();
  expect(resolveLiteralExcerpt('Início. Meio. Meio. Fim.','Início. [...] Meio. [...] Fim.')).toBeUndefined();
  expect(resolveLiteralExcerpt('Início. Um. Fim.','Início. [...] Fim.')).toBe('Início. Um. Fim.');
});

it('does not interpret unanchored omissions or arbitrary dots as permission to skip source',()=>{
  expect(resolveLiteralExcerpt('Texto real final.','[...] final.')).toBeUndefined();
  expect(resolveLiteralExcerpt('Texto real final.','Texto [...]')).toBeUndefined();
  expect(resolveLiteralExcerpt('Texto real final.','[...]')).toBeUndefined();
  expect(resolveLiteralExcerpt('Texto real final.','Texto ... final.')).toBeUndefined();
});

it('resolves an extensive literal quotation without recursive parser depth',()=>{
  const quote=Array.from({length:10000},(_,index)=>`word${index}`).join(' ');
  expect(resolveLiteralExcerpt(quote,quote)).toBe(quote);
});
