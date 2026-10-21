# CAPIVARA PARALLEL LAB — Teste de execução paralela

Crie uma aplicação web chamada **Parallel Lab**, destinada a testar a geração de aplicações com múltiplos agentes trabalhando simultaneamente.

## Objetivo

Desenvolver uma aplicação simples, funcional e persistente, composta por módulos independentes.

A aplicação é apenas um instrumento de avaliação. O objetivo principal é permitir observar a capacidade do harness de executar trabalhos independentes em paralelo, integrar resultados e validar funcionalidades.

## Stack

- Node.js
- TypeScript
- React
- Vite
- Backend Node.js com API REST
- SQLite em arquivo
- Testes automatizados

Use soluções simples, estáveis e amplamente adotadas. Evite serviços externos e integrações desnecessárias.

## Funcionalidades

### Módulo 1 — Tarefas

CRUD completo de tarefas.

Campos:
- ID
- Título obrigatório
- Descrição opcional
- Status: pendente, em andamento ou concluída
- Data de criação

Permitir cadastrar, consultar, editar, alterar status e excluir tarefas com confirmação.

### Módulo 2 — Categorias

CRUD completo de categorias.

Campos:
- ID
- Nome obrigatório e único
- Cor de identificação
- Data de criação

Permitir cadastrar, consultar, editar e excluir categorias.

### Módulo 3 — Anotações

CRUD completo de anotações.

Campos:
- ID
- Título obrigatório
- Conteúdo obrigatório
- Data de criação
- Data de atualização

Permitir cadastrar, consultar, editar e excluir anotações.

## Interface

Criar interface web responsiva, em português brasileiro.

- Sidebar de navegação.
- Dashboard inicial.
- Páginas separadas para Tarefas, Categorias e Anotações.
- Formulários com validação.
- Feedback visual de sucesso e erro.
- Estados de carregamento e listas vazias.
- Layout claro, moderno e consistente.

Não utilizar dados fictícios para simular funcionalidades concluídas.

## Arquitetura e independência

A aplicação deve possuir uma fundação compartilhada e três módulos funcionalmente independentes.

Os módulos Tarefas, Categorias e Anotações não devem possuir relações entre suas entidades.

Cada módulo deve ter suas próprias rotas, componentes, serviços e testes, respeitando os contratos comuns definidos na fundação.

Organize o desenvolvimento para permitir, quando tecnicamente seguro:

- Fundação compartilhada primeiro.
- Implementação independente dos módulos depois.
- Integração e verificação consolidada ao final.

Os módulos independentes não devem modificar arquivos compartilhados simultaneamente.

As dependências reais precisam ser respeitadas. Não declare fases artificialmente independentes apenas para produzir concorrência.

A decisão de executar fases simultaneamente pertence exclusivamente ao scheduler da Capivara.

## Persistência

Usar SQLite em arquivo.

Todos os cadastros devem persistir entre reinicializações.

Os testes precisam utilizar banco isolado dos dados normais da aplicação.

Não utilizar serviços de banco de dados externos.

## Testes e critérios de aceite

Cada módulo precisa demonstrar:

1. Criação de registro válido.
2. Rejeição de entradas inválidas.
3. Consulta de registro persistido.
4. Atualização de registro.
5. Exclusão com confirmação na interface.
6. Persistência após reinicialização.

A aplicação completa precisa demonstrar:

- Inicialização por comandos documentados.
- Compilação sem erros.
- Navegação entre os três módulos.
- API e interface integradas.
- Fluxos reais executados no navegador.
- Testes automatizados aprovados.

Todos os critérios devem ser observáveis e verificáveis no próprio repositório.

## Restrições

- Sem autenticação.
- Sem multi-tenancy.
- Sem serviços externos.
- Sem credenciais reais.
- Sem Docker obrigatório.
- Sem funcionalidades adicionais não solicitadas.
- Sem mocks substituindo funcionalidades reais.
- Sem alterações no código-fonte da Capivara.

## Resultado esperado

Uma aplicação funcional com três módulos independentes, banco SQLite, interface web e testes automatizados.

Priorize simplicidade, isolamento, qualidade e verificabilidade.

Não inclua instruções artificiais para manipular o scheduler, os gates ou os resultados do harness.
