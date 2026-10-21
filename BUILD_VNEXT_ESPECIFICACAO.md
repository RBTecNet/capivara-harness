# CAPIVARA HARNESS — BUILD vNext
## Especificação consolidada e plano de implementação

**Estado:** contrato funcional aprovado; detalhamento técnico proposto, sujeito a testes de compatibilidade.  
**Repositório:** `RBTecNet/capivara-harness`  
**Base examinada:** `main`, commit `f51a6dd2e050`, versão `0.6.2`.  
**Finalidade:** servir de referência para uma única empreitada de implementação, organizada internamente em etapas; este documento **não é** um prompt de execução.

## 1. Objetivo e princípios irrevogáveis

O BUILD transforma o produto definido pelo INIT e a arquitetura aprovada pelo PLAN em software funcional, com qualidade proporcional ao escopo, custo controlado e conclusão prioritária. Não deve gastar horas ou pacotes inteiros de tokens para construir uma funcionalidade simples.

1. **Recuperar antes de abandonar:** uma falha é um problema a diagnosticar e reparar, não uma ordem automática de reescrever a fase.
2. **Teste comprova requisito:** verificações supérfluas, testes repetidos sem invalidação de evidência e exigências opcionais não podem bloquear a entrega.
3. **Gates não são uma esteira na recuperação:** revalidar apenas garantias afetadas; voltar ao G0 não implica repetir G1, G2 e G3.
4. **Preservar trabalho e contexto:** commits aprovados, parciais recuperáveis, diagnósticos, handoffs e resultados comprovados não são descartáveis.
5. **O Wizard escolhe modelos:** nunca promover um provider/modelo por suposta categoria premium; respeitar papéis e modelos configurados.
6. **O Core é a autoridade de estado:** agentes entregam código, diagnóstico e parecer; apenas o Core registra, invalida e publica evidências, estado e integração.
7. **Operação sem guardrails contraditórios:** o agente deve poder executar os comandos legítimos necessários para criar, testar, iniciar, reiniciar e validar o produto. Não reintroduzir restrições que impeçam o trabalho.
8. **Transparência:** toda mudança relevante de estratégia, gate, ciclo, escopo, documentação ou integração deve ser explicada na TUI e persistida no relatório.
9. **Menor mudança possível:** reutilizar os mecanismos atuais; não substituir sistemas estáveis apenas por preferência arquitetural.
10. **Uma empreitada:** futura implementação em um único prompt, subdividida internamente em passos com testes e checkpoints; nenhum novo escopo deve ser inventado pelo implementador.

## 2. Contratos de entrada e fronteiras de autoridade

| Etapa | Autoridade | Contrato de referência |
|---|---|---|
| INIT | Produto, histórias, entidades, regras e workflows | `capivara-skeleton/v2` |
| PLAN | Componentes, interfaces, infraestrutura, dependências e fases | `capivara-architecture/v1`, `capivara-phases/v2` |
| BUILD | Implementação, estratégia de testes e integração | Deve consumir os contratos aprovados, sem reinterpretá-los arbitrariamente |

A etapa BUILD deve ler `skeleton.md`, `architecture.md`, `project-phases.md`, `environment.json` e documentos de design citados, validando seus vínculos e versões conforme os contratos existentes. A arquitetura por fase deve ser entregue por fatia, preferencialmente reutilizando `architectureSliceForPhase()`; sua saída contém componentes próprios, contratos que a fase deve oferecer, contratos de dependências que só deve consumir, fluxos e infraestrutura relevante. O builder não pode depender somente do Markdown da fase nem do `sharedContractFromSkeleton()` como se isso contivesse todas as decisões do PLAN.

Planos da geração antiga não devem receber conversão silenciosa. A compatibilidade com os formatos atuais deve ser validada antes de criar sessões de agentes.

## 3. Política de validação

### 3.1 Severidade e resultado são conceitos distintos

| Classe | Natureza | Efeito |
|---|---|---|
| B0 — material bloqueadora | Funcionalidade obrigatória ausente, comportamento comprovadamente errado ou impossibilidade de provar comportamento essencial | Solicita reparo e mantém estado recuperável |
| B1 — material corrigível | Defeito local com correção objetiva | Reparo localizado e revalidação mínima |
| B2 — advertência | Observação sem prejuízo material demonstrado | Registra e continua |
| B3 — informativa | Estilo, organização, preferência ou sugestão opcional | Não bloqueia nem consome reparo |

B0 e B1 não significam `abort`. Encerrar é decisão posterior do mecanismo de recuperação, não um veredito automático do teste. Bloqueios precisam vincular requisito, evidência observada e comportamento esperado. Não ignorar evidência de defeito real apenas para melhorar taxa de aprovação.

### 3.2 Fronteiras dos gates

| Gate | Comprovação e limite |
|---|---|
| **G0** | Resultado utilizável do agente/provider e erros operacionais reais. Não julga qualidade nem bloqueia só por marcador omitido quando há trabalho verificável. |
| **G1** | Integridade e disponibilidade dos artefatos de implementação. Ausência de diff pode ser legítima. Não reprovar por organização interna sem impacto. |
| **G2** | Execução técnica/funcional proporcional: compilação, testes unitários, integração, E2E existente quando relevante. Não refazer suíte sem invalidação. |
| **G3** | Verificador independente confronta critérios de aceite e arquitetura com implementação real. Bloqueia somente lacunas materiais fundamentadas. |
| **G4** | **Condicional**: executar workflows relevantes na aplicação real quando o comportamento exigir ou uma evidência de fluxo for invalidada. Caso contrário, `NOT_APPLICABLE`, sem custo. |

A preparação de ferramentas (Playwright, dependências, runtime, serviços etc.) ocorre na preparação/preflight e é reutilizada enquanto suas condições forem válidas. Testes de suíte inteira ou entrega integrada são acionados nos pontos em que a prova agregada é necessária, não automaticamente em cada fase. Nenhum gate deve exigir teste nominal que o PLAN legitimamente não prescreveu.

### 3.3 Revalidação seletiva

Ao reparar, capturar o estado e o diff, mapear artefatos → componentes/contratos → garantias comprovadas. Acionar **somente** as verificações cuja evidência foi invalidada. Uma modificação após G3 que atinge G0 leva à verificação G0 e retoma o G4, sem replay obrigatório dos gates intermediários; se alterar provas de G2/G3, revalidá-las também. O número do gate não impõe precedência sequencial na recuperação. Gates cuja execução é condição técnica para outro teste ainda podem ser executados quando a dependência real exigir.

O impacto pode ser `NONE`, `AFFECTED` ou `UNKNOWN`. `UNKNOWN` exige primeiro investigação determinística localizada, depois consulta limitada ao agente se necessária, e por último a menor verificação suficiente. **Nunca aprovar silenciosamente uma evidência cuja aplicabilidade não foi demonstrada.** Agrupar verificações iguais: um comando executado pode atualizar várias evidências.

## 4. Contrato de evidências — proposta técnica mínima

**Autoridade exclusiva do Core.** Agentes não criam aprovações autodeclaradas.

Registro imutável (nova evidência substitui a aplicabilidade da anterior, sem apagar histórico):

- `evidenceId`, `runId`, `phaseId`, `gate`, `checkId`, `createdAt`;
- `claim`: garantia observável que foi verificada;
- `outcome`: `PASS | PASS_WITH_WARNING | REPAIR_REQUIRED | NOT_APPLICABLE`;
- `inputs`: hashes/revisões documentais e estado de código relevante;
- `scope`: componentes, contratos, artefatos e fluxos associados;
- `supports`: IDs de evidências necessárias;
- `artifactRefs`: logs e resultados efetivamente produzidos;
- `validity`: `VALID | INVALIDATED | UNKNOWN` e motivo/evento de invalidação.

A granularidade inicial é **componente + contrato + comportamento**, nunca hashes por linha ou criação de um segundo grafo de dependências. Reutilizar o mapeamento arquitetural do PLAN e o ledger/eventos já existentes. Usar dados de execução reais em vez de suposições do modelo. Evitar uma chamada de modelo para cada diff. A nova camada não deve alterar/retroagir o significado histórico dos resultados dos gates existentes.

## 5. Identidade dos defeitos, recuperação e ciclos

### 5.1 Registro de defeitos

Campos mínimos: `defectId` estável, fase/gate de descoberta, critério/contrato, evidências, comportamento observado/esperado, causa confirmada ou hipótese, componentes afetados, status, tentativas, estratégias, custos e evidências invalidadas. O mesmo defeito mantém identidade entre gates; equivalência exata pode ser deduzida deterministicamente, equivalência semântica requer investigação localizada. Defeitos independentes podem ser agrupados numa chamada de reparo sem perder seus IDs e validações individuais.

Estados propostos: `OPEN`, `DIAGNOSING`, `REPAIRING`, `AWAITING_VALIDATION`, `RESOLVED`, `ESCALATED`, e encaminhamento documental excepcional `UPSTREAM_REPAIR_REQUIRED` no plano de controle. O status de **defeito**, o status da **fase**, o status do **run** e o status da **etapa documental** são entidades distintas: não sobrecarregar uma única string.

### 5.2 Orçamentos

- Por **defeito**: monitorar tentativas e estratégias para a mesma falha.
- Por **gate**: oportunidades próprias para defeitos independentes. G2 não consome as oportunidades de G3.
- Por **ciclo da fase**: orçamento agregado de chamadas/tempo/custo e estratégias.
- Por **run**: respeitar tetos financeiros explícitos do usuário, sem ultrapassá-los silenciosamente.

Reparo local não consome ciclo completo. Sem progresso comprovado, escalar ou mudar estratégia; com progresso material, continuar enquanto o orçamento permitir. **Ao esgotar o orçamento global do ciclo, abrir automaticamente o próximo ciclo disponível, renovando contadores do ciclo, sem zerar histórico e sem regressão automática ao G0.** Só interromper por esgotamento técnico quando todos os ciclos terminarem ou houver impossibilidade real; bloqueio administrativo externo pode exigir ação do usuário sem ser classificado como falha de código. Valores numéricos e valores padrão ainda precisam ser especificados/testados, com configuração via Wizard e snapshot no run.

### 5.3 Progresso

Progresso é demonstrado por critério atendido, defeito eliminado/reduzido sem regressão material maior, capacidade técnica recuperada, ou diagnóstico novo verificável que habilite estratégia distinta. Não é medido por linhas de código, quantidade de arquivos ou a frase “corrigido”. A mesma estratégia fracassada não deve ser repetida sem informação nova.

## 6. Papéis, contexto do verificador e handoff

O modelo de executor e verificador é definido no Wizard. Fluxo preferido: defeito diagnosticado pelo verificador → handoff imediato → reparo localizado do executor → se não houver progresso, **o verificador que diagnosticou** assume reparo com seu contexto original → outro julgamento independente valida. Reparador não aprova a própria mudança.

**Handoff obrigatório em toda falha material do verificador, independentemente da disponibilidade de resume.** Identidade: `run + fase + gate + ciclo + defeito`. O Core persiste o diagnóstico original de forma imutável e registra evoluções separadamente. O pacote inclui critério, evidências, localização, hipótese/causa, mudanças desde o diagnóstico, tentativas, estratégias que falharam, menor reparo e prova necessária. Montar prioritariamente a partir de resultados existentes, sem chamada extra de sumarização.

Se o adapter suportar `resume` da sessão real e as permissões de reparo forem compatíveis, usá-lo; caso contrário, nova sessão do **mesmo modelo configurado** recebe o handoff. Cada provider deve declarar capacidades reais; nunca simular continuidade inexistente. O handoff não substitui a verificação dos arquivos atuais.

## 7. Integração paralela

Preservar todos os commits/worktrees aprovados e parciais. O Core identifica conflitos reais; se puderem ser conciliados localmente, um reparador resolve **somente** trechos necessários em uma área isolada, sem descartar módulos aprovados. Conflito Git não consome ciclo de implementação automaticamente. A integração só é publicada pelo Core depois de revalidar evidências afetadas; resolver conflito textual não prova correção funcional.

Reaproveitar dependências e mapeamento de componentes do PLAN para evitar conflitos previsíveis. Não criar um scheduler paralelo novo. Se o conflito denunciar erro estrutural no PLAN, seguir protocolo upstream em vez de reescrever arquitetura arbitrariamente.

## 8. Reparos documentais excepcionais (BUILD → PLAN → INIT)

**Somente como último recurso, após esgotar alternativas compatíveis no estágio atual** e reunir diagnóstico comprovado.

### 8.1 Estado e pacote inseparáveis

`UPSTREAM_REPAIR_REQUIRED` só é publicado quando o Core validar um pacote persistido, íntegro e coerente com as versões de origem. Estrutura conceitual:

```
.capivara/repairs/upstream/<repair-id>/
  manifest.json
  diagnosis.md
  evidence.json
```

`manifest`: ID, run/fase/gate/ciclo, etapa fonte e destino, documento/contrato/versão e estado. `diagnosis`: defeito preciso, observado/esperado, contornos tentados, limites de edição. `evidence`: logs/linhas/artefatos/hash e fases/contratos potencialmente impactados. Publicação consistente e verificação também na entrada da etapa destinatária. Sem pacote válido, **nenhum agente é convocado para inventar a solução**.

### 8.2 Autoridade e autorização

Executor suspeita; verificador diagnostica; Core valida completude, evidências, histórico de recuperação e autoriza encaminhamento. PLAN corrige decisões arquiteturais; INIT corrige definição do produto. O reparo deve ser **estritamente localizado no defeito apresentado**. Se alcançar outras fases, componentes ou contratos, já construídos ou não, PLAN/INIT **devem perguntar explicitamente ao usuário** antes de publicar: `CONTINUAR COM ESCOPO AMPLIADO` ou `ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE` (novo run apenas sob comando explícito). A autorização vale só para o impacto mostrado; extensão adicional exige nova aprovação. Informar consequências e evidências afetadas.

### 8.3 Segurança de compatibilidade documental

O plano e seus stamps, `environment.json`, hashes, identidade do run, ledger e revisões anteriores **não podem ser simplesmente reescritos para parecerem compatíveis**. Documentar transição entre revisões, analisar fases já entregues e preservar as não afetadas. Fases afetadas recebem somente revalidações/reparos necessários. Se não for demonstrável que a troca é segura, **não automatizar a edição upstream**; conservar diagnóstico e solicitar intervenção apropriada. Implantação gradual sugerida: diagnóstico transferível → reparo pontual PLAN → comprovação de impacto e publicação → retomada BUILD; somente depois habilitar PLAN → INIT.

## 9. Transparência operacional

Em toda transição relevante, a TUI mostra `fase/gate/ciclo/defeito`, motivo, agente/estratégia, trabalho preservado, evidências mantidas ou invalidadas, custo e próximo passo. Relatórios guardam o detalhe técnico completo. Não anunciar fases “preservadas” sem verificar validade; não ocultar consumo de orçamento ou ampliações documentais. Gerar mensagens determinísticas sempre que possível, sem chamadas extras ao modelo.

## 10. Entrega final proporcional

Não criar G5 pesado. A aplicação só é declarada concluída se todas as fases obrigatórias estiverem integradas, sem defeitos materiais pendentes, com evidências suficientes dos contratos e com preparação/inicialização funcional quando aplicável (incluindo migrations e demais dependências necessárias). Reutilizar evidências anteriores; somente testar novamente o que não estiver provado. Entregar instruções claras de execução, preparação e limitações conhecidas.

## 11. Compatibilidade com a implementação 0.6.2

| Área atual | Evidência encontrada | Direção |
|---|---|---|
| `contract/phases.ts`, `loop/split.ts` | Parser compartilhado v2 | Preservar |
| `contract/architecture.ts` | `architectureSliceForPhase()` já existe | Integrar à chamada do builder e do verificador |
| `loop/preflight.ts`, `environment-plan.ts` | Stamps e preflight já conferem plano/arquitetura/ambiente | Preservar e vincular às novas evidências |
| `loop/runner.ts` | Ciclo `DEFAULT_MAX_CYCLES = 3`; reparo do verificador e exceções G4 | Generalizar recuperação, sem reescrever tudo |
| `loop/gates.ts`, `loop/flows.ts` | G0–G4 implementados | Adaptar validade/reexecução seletiva e G4 condicional |
| `loop/paralelo.ts`, `worktree.ts` | Paralelismo e integração existentes | Recuperação localizada e preservação aprovada |
| `loop/ledger.ts` | Identidade de fase por hash do Markdown | Acrescentar evidências sem substituir histórico |
| `state/run-store.ts`, `resume.ts`, `events.ts` | Snapshot e replay persistentes | Acrescentar transições e orçamentos de forma compatível |
| `prompts/builder.ts`, `prompts/verifier.ts` | Lê fase/skeleton/contrato compartilhado; não injeta fatia arquitetural explicitamente | Atualizar contexto e diagnóstico |
| `state/paths.ts`, `atomic.ts` | Caminhos e escrita atômica | Reutilizar para handoffs/evidências/pacotes upstream |
| `provider/adapters.ts` e adapters CLI | Execuções por papel/provider | Declarar e testar retomada de sessão por provider |

**Verificação de lacuna concreta:** `runner.ts` prepara `sharedContractFromSkeleton()` e `phaseMarkdown`, mas não foi encontrada nesse caminho a inclusão de `architectureSliceForPhase()` no contexto. Isso precisa entrar na primeira etapa da implementação.

## 12. Plano de execução — uma empreitada, checkpoints internos

| Ordem | Trabalho interno | Critério de conclusão |
|---|---|---|
| 1 | Compatibilidade documental e fatia arquitetural por fase | O executor recebe contratos próprios e consumidos; nenhuma regressão em parser/stamps |
| 2 | Registro imutável de evidências e mapa de impacto | Aprovações reutilizadas somente com inputs/garantias válidos |
| 3 | Revalidação seletiva e G4 condicional | Correção de G3 pode validar G0 e voltar a G4 sem rodar os intermediários |
| 4 | Identidade de defeitos, orçamentos e ciclos | G3 independente do orçamento usado pelo G2; esgotamento global abre próximo ciclo |
| 5 | Handoff e contexto do verificador | Handoff sempre persistido; resume/fallback; outro verificador valida reparo |
| 6 | Recuperação de integração paralela | Conflito localizado não descarta fase verde nem reimplementa módulos inteiros |
| 7 | Entrega proporcional e transparência | Produto utilizável, relatório consistente e sem suítes redundantes |
| 8 | Upstream seguro por fases de viabilidade | Somente ativar edição/retomada cross-stage com hashes, estado Git e impacto comprovados |

O implementador poderá ordenar ajustes de dependência entre os blocos, mas não omitir nenhum requisito aprovado. Tudo é realizado sob **um único pedido**, com checkpoints internos, testes e relatório final. Não fazer merge/push/publicação sem autorização expressa do usuário, salvo decisão posterior ao elaborar o prompt.

## 13. Testes de regressão indispensáveis — comportamento, não volume

1. Uma alteração localizada invalida só a evidência associada; hashes iguais permitem reutilização.
2. G2 previamente aprovado não é reexecutado depois de uma mudança somente no roteiro G4.
3. Depois do G3, um impacto somente em G0 leva a revalidar G0 e continuar, sem replay de G1–G3.
4. G4 `NOT_APPLICABLE` não sobe navegador/servidor nem chama roteirista.
5. Defeitos diferentes no G2 e no G3 mantêm orçamentos independentes.
6. O mesmo defeito surgindo em G2 e G4 mantém identidade/histórico.
7. Defeitos compatíveis são reparados em uma chamada e validados individualmente.
8. Esgotar orçamento global abre ciclo seguinte sem apagar código ou evidência.
9. Mesmo reparador não aprova a própria alteração.
10. Handoff do verificador é gerado **antes** de qualquer reparo, mesmo com resume disponível; fallback funciona.
11. Conflito Git preserva ambos os commits e revalida somente efeitos da reconciliação.
12. `UPSTREAM_REPAIR_REQUIRED` sem pacote completo/íntegro é rejeitado determinística e antecipadamente.
13. Reparo upstream extrapolando escopo pede autorização; recusa mantém estado intacto.
14. Revisão documental não faz aprovação anterior parecer atual apenas por atualizar hash.
15. TUI, eventos e relatórios apresentam o mesmo ciclo, gates, reparos e decisões.
16. Entrega integrada detecta preparação inicial necessária sem repetir toda a suíte.

Testes devem incluir casos de falha e retomada e **não** somente asserts sobre texto de prompts. Preservar `npm run check` e suíte existente como regressão do próprio harness; medir também tempo/tokens/chamadas versus baseline em cenários representativos.

## 14. Questões para comprovação técnica, sem inventar solução

- Método real de associar diff e grafo arquitetural a evidências, inclusive alterações indiretas.
- Padrões numéricos de orçamentos/custos e compatibilidade com Wizard e limites financeiros explícitos.
- Semântica de resume e eventual mudança de permissão por cada CLI.
- Prova de impacto documental após mudança no PLAN/INIT sem corromper a identidade do run e o ledger.
- Como persistir/retomar conjuntos parcialmente publicados sob falha de processo.
- Como distinguir automaticamente alterações materiais de reorganizações documentais sem impor LLM a cada caso.

**Política diante dessas questões:** testar viabilidade, registrar limitações, manter fallback funcional e não comprometer contratos existentes. Não prometer automação upstream se os testes não comprovarem integridade.

## 15. Critério de aceite da empreitada

A reforma só será considerada concluída quando: (a) todos os requisitos acima implementáveis tiverem testes de comportamento; (b) documentação e contratos atuais forem consumidos corretamente; (c) gates e recuperação forem seletivos; (d) trabalho e contexto persistirem; (e) os fluxos de compilação, teste e entrega continuarem funcionais; (f) o relatório distinguir explicitamente **implementado e comprovado**, **implementado mas não validado com provider real** e **adiado por inviabilidade demonstrada**. Não criar resultados fictícios para conseguir `PASS`.

---

**Regra de engenharia final:** a Capivara precisa entregar software correto e utilizável com a menor quantidade razoável de testes, chamadas e reconstruções, sem perder o trabalho já comprovado.
