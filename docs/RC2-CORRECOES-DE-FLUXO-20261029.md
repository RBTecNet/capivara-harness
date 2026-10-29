# Correções do fluxo real — 29/10/2026

O critério desta rodada foi executar a CLI real, corrigir os impedimentos encontrados no motor e preservar o código produzido. Não foi executada a suíte completa. Os casos de regressão selecionados exercitam as causas corrigidas; sua quantidade não demonstra que um projeto possa ser entregue.

## Causas corrigidas no código

- **INIT e PLAN:** proveniência literal continua obrigatória, mas pontuação, referências equivalentes e metadados já recuperados não provocam novas entrevistas ou reparos. Cobertura técnica considera a afirmação original, sem transformar toda palavra de uma citação ampla em obrigação adicional. A interface declarada como CLI/TUI/web é conservada ao normalizar as verificações.
- **Execução e recuperação:** uma tentativa só conta depois que o agente de implementação realmente começa. Reformular títulos, IDs, explicações ou a asserção de uma mesma invocação não cria uma estratégia nova. Contexto excedente é compactado respeitando o orçamento configurado; não se reduz repetidamente esse orçamento. Uma receita real já observada pode orientar outra verificação, mas precisa executar e produzir sua própria prova.
- **Instrumentos:** argumentos estruturados duplicados são decodificados uma vez; declarações conflitantes viram incidentes do instrumento. Erros de criação do processo e sintaxe inválida no programa de verificação recebem classificação própria. Uma área privada modificada por uma verificação é reconstruída antes de recuperar a próxima prova, sem exigir alteração do produto.
- **Provas e revisão:** o cache exige a prova mais recente, entradas atuais, ambiente e artefatos compatíveis. Uma reprovação posterior impede reaproveitar uma aprovação antiga. Revisões de contribuições preservadas podem ser compostas somente com inspeções atuais das mudanças relacionadas. Falhas e interpretações anteriores permanecem registradas.
- **Interface e stack:** declarar uma verificação como web não basta: a instrumentação precisa observar navegação e operações DOM no navegador real. O consumo de provedores pode ser observado em um único build e uma execução funcional, com entradas e artefatos rastreados. Bibliotecas, drivers e CLIs continuam sendo capacidades distintas. O runtime Python também possui observação de execução real.

## Evidências reais

| Execução | Resultado | Retomada sem alterações |
| --- | --- | --- |
| Web Node.js/TypeScript/React/SQLite (`samba_admin`) | 10/10 tarefas concluídas; build e cenário real de navegador; concorrência máxima observada 2 | 69.698 ms; zero chamadas de modelo e zero novos IDs de prova |
| Python CLI, módulos independentes e entrada dependente | 3/3 tarefas concluídas; concorrência máxima observada 2 | 881 ms; zero chamadas de modelo e zero novos IDs de prova |
| Nova execução Python CLI, mesmo pedido | 3/3 tarefas concluídas | 1.154 ms; zero chamadas de modelo e zero novos IDs de prova |

Relatórios: [web final](rc2-evidence/samba-admin-final-20261029.json), [retomada web](rc2-evidence/samba-admin-completed-resume-20261029.json), [Python com paralelismo](rc2-evidence/python-cli-live-recovery-20261029.json), [nova execução Python](rc2-evidence/python-cli-fresh-20261029.json). As retomadas Python também estão registradas nessa pasta.

O histórico web acumula **281 chamadas de modelo**, incluindo execução com versões anteriores e investigação dos defeitos. Esse custo não é uma execução limpa da versão final nem prova de economia. A nova execução Python acumulou 25 chamadas; a execução anterior, 36. Seus planos diferem, portanto esses números não constituem comparação controlada. O provedor não informou custo financeiro. Os relatórios preservam essas limitações.

Para repetir a inspeção e a retomada, com um projeto já concluído:

```sh
node scripts/capture-execution-evidence.mjs CAMINHO_DO_PROJETO /tmp/evidencias.json
node scripts/verify-completed-resume.mjs CAMINHO_DO_PROJETO /tmp/retomada.json
```

A segunda operação invoca a CLI de verdade; não altera o estado para aprovar trabalho. Uma retomada válida preserva plano e conclusão sem chamar agentes ou criar provas novas. Registros de aceite podem voltar a referenciar o mesmo recibo existente.

## Limitações verificadas

- A retomada web ainda custa cerca de 70 segundos em revalidação de ambiente, entradas e conformidade. Não há nova execução de produto nesse intervalo, mas existe trabalho local a otimizar.
- A observação de navegador cobre Playwright em Node.js. Outros instrumentos precisam de adaptador que produza evidência equivalente.
- Ainda não há adaptador de interação com janela nativa de desktop. O motor recusa uma aprovação desktop baseada apenas em stdout ou JSON; não se declara suporte funcional completo a essa interface.
- Estes resultados não demonstram sucesso em qualquer projeto ou modelo, nem uma taxa de recuperação de 99%. A recuperação deve continuar buscando um caminho executável sem transformar ausência de evidência em aceite.
