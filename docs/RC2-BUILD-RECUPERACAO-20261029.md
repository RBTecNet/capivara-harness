# RC2: recuperação do BUILD, 29/10/2026

O BUILD real de `samba_admin` terminou com código de saída 0, estado `complete`, 14/14 unidades concluídas e `lastFailure: null`. O estado anterior preservado tinha 13/14 unidades concluídas, nenhuma prova de aceite final e bloqueio na reprodução de um achado de execução. O projeto foi retomado pelo CLI, sem editar manualmente seu código, banco de estado ou critérios de aceite.

## Causas corrigidas no motor

- Uma proposta com reprodução executável era rejeitada integralmente quando o modelo anexava metadados opcionais de conformidade incorretos. Agora a declaração é recusada e registrada separadamente; a operação continua candidata, precisa executar e não certifica o provedor por associação.
- O alvo de plataforma `browser` era confundido com uma exigência de interação pelo navegador. Uma prova técnica de processo/API pode apoiar uma aplicação web; uma prova web continua exigindo observação física de navegação e DOM.
- Falhas de programas de verificação inline podiam ser encaminhadas para edição do produto. O diagnóstico independente separa instrumento de produto e preserva a prova negativa original. Reprodução positiva exige nova revisão com a prova atual; não transforma reprovação em aprovação.
- Um achado rotulado como inspeção de código, mas que cobrava uma reprodução de execução, autorizava edições e bloqueava entregas sem essa classificação independente. A recuperação agora materializa o instrumento pertinente antes de voltar ao editor.
- Saídas produzidas por verificações eram incorporadas como fontes da entrega. O motor registra os arquivos gerados observados, separa fontes e saídas e executa novamente a receita com o contrato corrigido. Fontes declaradas, leituras anteriores à escrita observadas, conflitos e alterações nas entradas continuam protegidos.
- O compilador escrevia por descritores (`open`/`write`/`close`), caminho ausente do observador. O protocolo de escritas passou a registrar essas operações síncronas e por callbacks, inclusive o fechamento após mudança de diretório. Observações antigas não ganham escritas retroativas.
- A observação de conformidade usava uma lista de entradas diferente da identidade da prova. Ambas agora usam o conjunto resolvido, incluindo dependências importadas.
- Um consumidor copiado do aceite global para uma unidade podia perder a receita de seu produtor. O grafo local agora importa as receitas explicitamente referenciadas com o escopo de entradas do proprietário; referências ausentes, ambíguas ou cíclicas exigem recuperação do instrumento.
- O reparo de uma verificação recebia o contexto completo da entrega e estourava a capacidade do agente. Um pacote operacional limitado referencia um recibo completo, imutável por conteúdo, com hash e permissões privadas. Reduzir esse pacote não divide nem reimplementa a entrega.
- Uma tentativa adicional de observar um provedor podia criar uma exigência artificial de log; mesmo após diagnosticada como defeituosa, a mesma operação voltava pelo replanejamento. O descarte agora tem identidade executável persistente e autoridade literal. Aplica-se apenas a candidato funcional gerado pelo motor, com alternativa funcional atual; não remove um produtor referenciado nem dispensa conformidade obrigatória. Uma nova instrução literal não herda o descarte antigo.
- A preparação confirmava o driver por `require.resolve(...)`, mas somente `require(...)` e imports declaravam seu módulo operacional. A resolução literal única agora informa o protocolo e o host concretos ao consumidor e ao verificador. Resolução continua sendo disponibilidade, nunca prova de uso pelo produto.
- A seleção de provas obsoletas recalculava imediatamente os hashes que `revisionState()` acabara de obter. Agora reutiliza esse resultado local, sem cache entre execução, aceite ou retomadas. Uma espera final por conformidade também recebe os bloqueadores atuais, em vez de reutilizar um incidente histórico sem relação com a causa atual.

## Validação reproduzível

`npm run build` e `npm run typecheck` passaram. As regressões específicas usam processos reais para compilar, executar, escrever artefatos e reiniciar um produto pequeno; respostas de modelo controladas isolam o protocolo do motor. Elas não representam uma medição da qualidade de modelos reais.

Exemplo de execução focada, sem a suíte inteira:

```sh
npx vitest run --config packages/core/vitest.config.ts \
  packages/core/test/execution/generated-instrument-retirement.spec.ts \
  packages/core/test/execution/verification-graph.spec.ts \
  packages/core/test/execution/verification-repair-context.spec.ts \
  packages/core/test/execution/producer-output-flow.spec.ts
```

Esses quatro cenários passaram juntos em 5,99 s. O cenário de descarte inclui retomada, replanejamento com outro ID e mudança da autoridade literal: a exigência nova falha de verdade e continua impedindo conclusão. A regressão focada da resolução literal do módulo passou separadamente. Também foram verificadas as regressões novas de metadados, reprodução inline, dívida de verificação, escrita por descritores e separação de saídas incidentais durante a correção.

A validação de produto foi feita pelo comando instalado:

```sh
capivara build --project ~/Documentos/Projetos/testes_capivara/samba_admin --no-dashboard
```

O aceite final executou build de produção e o cenário real de interação. Seus recibos observaram os provedores, incluindo `better-sqlite3` carregado pelo produto. A última recuperação da identidade do SQLite não iniciou nenhuma chamada de modelo: revalidou as duas unidades afetadas, preservou seus pareceres independentes e concluiu o aceite.

Uma nova execução pelo CLI instalado terminou novamente com saída 0 em 77,54 s: plano idêntico, zero chamadas de modelos e zero novas provas ou execuções de aceite. As sondagens de prontidão e a conferência dos recibos existentes continuam obrigatórias. O binário instalado tem o mesmo SHA-256 do build local; a versão permanece `0.9.0-rc2`.

Evidências sem prompts, credenciais ou transcrições:

- [Estado antes/depois e chamadas observadas](rc2-evidence/build-control-20261029.json).
- [Execução, chamadas por papel, durações e limites de interpretação](rc2-evidence/build-recovery-20261029.json).
- [Retomada pelo CLI instalado e identidade do binário](rc2-evidence/build-resume-20261029.json).

## Limites

O intervalo de investigação incluiu 74 chamadas reais adicionais: 37 de revisão, 22 de reparo e 15 de planejamento, além de retomadas manuais durante a alteração do motor. Isso não demonstra redução de custo nem execução contínua sem intervenção desde o estado inicial. Os relatórios preservam esses números; não há preço informado pelo provedor.

A conferência de prontidão e os hashes de entradas ainda custam tempo na retomada. A correção elimina recálculos imediatos comprovadamente redundantes; não demonstra que toda a sobrecarga de controle foi removida. Os observadores possuem protocolos concretos de runtime/interface; este caso prova Node/TypeScript/web e as regressões locais citadas, não todas as stacks, sistemas operacionais ou modelos. Uma falha material ou requisito obrigatório sem prova continua impedindo conclusão.
