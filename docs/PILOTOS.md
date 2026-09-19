> **Os pilotos 1, 1b, 2 e 3 foram descartados em 19/09/2026.** Eles rodaram a cadeia de
> quatro documentos em prosa, que §26 do plano removeu do produto: os artefatos que eles
> deixaram não são reproduzíveis pela ferramenta atual, e mantê-los convidava a comparações
> com um caminho que não existe mais. A evidência que justificava a remoção está preservada
> em `docs/medicoes/`. Os prompts dos três pilotos continuam abaixo, e continuam válidos —
> é o protocolo que os consome que mudou de três documentos para três estágios.
>
> O piloto 4 (quadro kanban, interface visual) segue em `~/pilotos/piloto-4`: é o único que
> rodou o ciclo atual de ponta a ponta, do pedido à aplicação servida no navegador.

# Protocolo dos três pilotos

A Phase 11 do plano tem duas metades. A primeira — o catálogo de 30 cenários contra
o provider falso — está implementada e roda em CI
(`packages/core/test/integration/catalog.spec.ts`). A segunda são **três pilotos
com modelo real**, e ela não pode ser executada por um agente sem supervisão:
gasta dinheiro de verdade, leva dezenas de minutos e precisa de alguém olhando o
resultado para dizer se a aplicação entregue é a aplicação pedida.

Este documento é o protocolo para você rodá-los.

## O que o falso prova e o que ele não prova

| Prova | Não prova |
|---|---|
| Mecânica: gates, ciclos, retomada, commits, contrato, protocolos | Se a documentação gerada é **boa** |
| Que o init e o build rodam ponta a ponta sem intervenção | Se as fases estão bem dimensionadas para uma sessão real |
| Que cada modo de falha conhecido é tratado | Se o auditor calibra bem: aprova o aceitável e devolve o ruim |
| Que nenhum segredo vaza e nenhum órfão sobrevive | Se a entrevista pergunta o que importa e cala sobre o resto |

Nenhum dos dois substitui o outro.

## Os três pilotos

Foram escolhidos para cobrir os três eixos onde a cadeia documental pode quebrar.

### Piloto 1 — banco + UI

> "um sistema de reservas para uma pousada de 8 quartos, com cadastro de hóspede,
> reserva por período e recusa de datas sobrepostas"

Exercita a cadeia inteira: `database-schema.md` com tabelas reais e lookup de
status, `user-stories.md` com fluxo de erro, e fases de fundação seguidas de
fases de fluxo. É o caso em que a regra "sem enum, sempre lookup" tem de aparecer
no schema gerado.

### Piloto 2 — CLI sem persistência

> "uma ferramenta de linha de comando que lê um CSV de lançamentos e emite um
> resumo mensal por categoria, em texto e em JSON"

Exercita a decisão D-17: `database-schema.md` existe e descreve um modelo de
dados que não é banco. É onde a cobertura I-11 passa vazia de propósito, e onde
se descobre se o escritor entende isso ou tenta inventar tabelas.

### Piloto 3 — serviço HTTP

> "uma API de encurtador de links com limite de 100 criações por hora por IP e
> estatística de acessos por link"

Exercita limites numéricos, que é exatamente onde a entrevista costuma aceitar
vago. Se o critério de aceitação gerado disser "limita adequadamente" em vez de
"a 101ª criação na mesma hora devolve 429", o auditor falhou.

## Como rodar cada piloto

```bash
mkdir -p ~/pilotos/piloto-1 && cd ~/pilotos/piloto-1
git init -b main

capivara init "<o pedido do piloto>" \
  --provider codex --model <modelo> \
  --auditor-provider <provider mais barato> --auditor-model <modelo mais barato>

# Leia os quatro documentos ANTES de gastar com implementação.
capivara build --verifier-provider <provider mais barato> --verifier-model <modelo mais barato>
```

O `init` para em RALPH READY. Ler os quatro documentos antes de rodar o `build`
é parte do protocolo, não uma etapa opcional: é o único momento em que um erro
de documentação custa barato.

## O que registrar, por piloto

Anote numa tabela por piloto:

| Métrica | Como obter |
|---|---|
| Tempo do `init` | relógio, do comando ao RALPH READY |
| Custo do `init` | seção **Custo** do relatório final, por papel |
| Perguntas feitas | contagem na entrevista; quantas você achou desnecessárias |
| Devoluções do auditor | quantas, em quais documentos, e se a orientação era acionável |
| Fases e tasks geradas | seção **Plano** do relatório |
| Tempo do `build` | relógio, do comando à última fase verde |
| Custo do `build` | somatório por papel |
| Ciclos de correção | quantos, em quais fases, e a causa de cada gate vermelho |
| Intervenções manuais | **deve ser zero**; qualquer uma é uma falha do protocolo |
| Suíte final | verde ou não, e o comando usado |

## O critério de aceitação da Phase 11

Os três pilotos chegam a RALPH READY e o `build` entrega aplicação com suíte
verde, **sem intervenção manual entre as fases**.

Qualquer intervenção conta como falha, mesmo que a aplicação final funcione: o
produto promete do prompt à aplicação sem você no meio, e uma intervenção que
"só destravou" é a diferença entre uma ferramenta e um assistente.

## Linha de base para comparação

Do PRD do harness anterior, para o mesmo prompt e o mesmo modelo:

| Ferramenta | Tempo | Custo | Resultado |
|---|---|---|---|
| DeepSeek Harness | ~10 min | ~US$ 0,20 | documentação útil |
| rb-harness | >31 min | ~US$ 1,84 | **cancelado sem publicar** |

Esses números são a linha de base do produto, não uma garantia permanente de
preço de provider. O que eles medem é a ordem de grandeza aceitável: se um
piloto do capivara ficar mais perto do segundo número que do primeiro, o
problema é de desenho, não de modelo.

## Quando um piloto falha

Registre a falha antes de corrigir, e classifique:

- **Mecânica** — gate, contrato, retomada, protocolo. Vira cenário novo no catálogo do Apêndice B, com teste, antes da correção.
- **De prompt** — o modelo entendeu a instrução de outro jeito. A correção é no texto do prompt (Apêndice A) e o teste é o snapshot.
- **De calibração** — o auditor aprovou o ruim ou devolveu o aceitável. A correção é na regra da dúvida ou nos três eixos, e o registro é qual documento e qual finding.
- **De contrato** — o plano válido produziu uma fase inexecutável. É a mais grave: significa que um invariante falta, e ele precisa responder "qual decisão do loop quebra sem ele?" antes de entrar.
