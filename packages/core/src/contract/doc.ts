/**
 * O documento do contrato é RENDERIZADO a partir deste módulo, nunca o
 * contrário. Um teste falha quando `docs/capivara-phases-v2.md` diverge desta
 * saída, de modo que a prosa não consegue descrever um contrato que o código
 * não implementa.
 */

import { INVARIANTS, PHASES_CONTRACT } from "./invariants.js";
import { GRAMMAR_BLOCK } from "./templates.js";

/** Campos do contrato anterior removidos de propósito, com o motivo. */
const REMOVED_FIELDS: readonly { field: string; reason: string }[] = [
  { field: "IDs `T###` globais ascendentes", reason: "o loop identifica a task pelo índice dentro da fase; nada atravessa fases" },
  { field: "`**Scope:**` com paths entre crases", reason: "não há cache incremental de validação: a suíte roda inteira. Num greenfield, paths seriam ficção" },
  { field: "`**Depends on:**` por task", reason: "as tasks de uma fase rodam na mesma sessão, em ordem de leitura; dependência entre tasks é sequência, não grafo" },
  { field: "`**Parallel safe:**`", reason: "não há paralelismo: uma fase, uma sessão, sequencial" },
  { field: "`**Validation:**` por task", reason: "o comando de teste é do projeto e é resolvido pelo loop, não declarado task a task" },
  { field: "`**Expected evidence:**`", reason: "a evidência é a árvore de arquivos, a saída da suíte e o veredito do verificador; declará-la seria pedir ao escritor que preveja o futuro" },
  { field: "`AC-TNNN-NN:` prefixado", reason: "o prefixo só existia para casar com a matriz exaustiva de um gerente que aqui não existe" },
  { field: "manifesto com sha256 por artefato", reason: "a descoberta é por caminho fixo e o frescor é o stamp da linha 3" },
  { field: "`status: draft/ready/blocked/invalid`", reason: "ou o documento passa no parser e nas coberturas, ou não passa" },
  { field: "contrato operacional e fase final sintética", reason: "a aceitação operacional em ambiente limpo ficou fora do escopo; o produto é provado pela suíte e pelo verificador" },
  { field: "`**Feature tests:**` por task (v1)", reason: "o plano descreve comportamento; quem decide como prová-lo é o avaliador do build, lendo o código entregue. Um teste nomeado antes de existir código virava obrigação inventada, e o rótulo é recusado (I-15) em vez de lido como sugestão" },
];

export function renderContractDocument(): string {
  const lines: string[] = [];

  lines.push("# Contrato `" + PHASES_CONTRACT + "`");
  lines.push("");
  lines.push("> Documento gerado por `npm run docs:contract` a partir de");
  lines.push("> `packages/core/src/contract/`. Não edite à mão: um teste falha quando esta");
  lines.push("> página diverge do código que a produz.");
  lines.push("");
  lines.push("O contrato é lido por um único módulo. `capivara init` valida o documento com");
  lines.push("`parsePhases`; `capivara build` divide o documento em sessões com o mesmo");
  lines.push("`parsePhases`. Não existe um segundo parser, então o que se valida e o que se");
  lines.push("executa não podem divergir.");
  lines.push("");

  lines.push("## Gramática");
  lines.push("");
  lines.push("```markdown");
  for (const line of GRAMMAR_BLOCK) lines.push(line);
  lines.push("```");
  lines.push("");
  lines.push("O planejamento descreve entregas e critérios de aceite observáveis. Quem decide");
  lines.push("como provar o produto é o avaliador do build, lendo o código entregue: o plano");
  lines.push("não nomeia testes, arquivos de teste nem procedimentos de validação, e o rótulo");
  lines.push("`**Feature tests:**` da geração anterior é recusado (I-15). `**Design ref:**` é");
  lines.push("opcional e só aponta para artefato de design existente. Os rótulos são literais e");
  lines.push("nunca são traduzidos; a indentação dos sub-itens é livre.");
  lines.push("");
  lines.push("O stamp da linha 3 cita os dois documentos que o plano leu: `skeleton.md`, o");
  lines.push("produto definido pelo `init`, e `architecture.md`, a arquitetura e a");
  lines.push("infraestrutura decididas pelo `plan` antes de escrever as fases.");
  lines.push("");
  lines.push("**Documentos de versões anteriores são incompatíveis.** Um plano `capivara-phases/v1`");
  lines.push("não é lido nem convertido: gere de novo com `capivara init --fresh` e `capivara plan --fresh`.");
  lines.push("");

  lines.push("## Invariantes");
  lines.push("");
  lines.push("| Código | Invariante | Verificado por | Manifestação |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of INVARIANTS) {
    lines.push(`| ${item.code} | ${item.title} | \`${item.checkedBy}\` | \`${item.enforcement}\` |`);
  }
  lines.push("");
  lines.push("`rejects` produz um erro com o código do invariante; `behaviour` descreve como o");
  lines.push("parser lê o documento e é provado por teste de comportamento, sem código de erro.");
  lines.push("");
  lines.push("`parser` é puro: recebe texto e devolve árvore ou erros. `stamps`, `coverage` e");
  lines.push("`design-refs` recebem o mundo por parâmetro — bytes dos upstreams e existência de");
  lines.push("caminhos —, de modo que nenhum deles toca o disco por conta própria.");
  lines.push("");

  lines.push("## Por que cada invariante existe");
  lines.push("");
  for (const item of INVARIANTS) {
    lines.push(`- **${item.code}** — ${item.rationale}`);
  }
  lines.push("");

  lines.push("## Campos removidos de propósito");
  lines.push("");
  lines.push("Superfície de contrato é superfície de falha: todo campo obrigatório é um campo");
  lines.push("que o escritor pode errar. Estes existiam no contrato anterior e foram removidos");
  lines.push("porque nenhuma decisão do loop quebra sem eles.");
  lines.push("");
  lines.push("| Campo | Por que o loop não precisa |");
  lines.push("| --- | --- |");
  for (const item of REMOVED_FIELDS) {
    lines.push(`| ${item.field} | ${item.reason} |`);
  }
  lines.push("");
  lines.push("Um campo novo só entra depois de responder: **qual decisão do loop quebra sem");
  lines.push("ele?** Se a resposta for \"nenhuma\", o campo não existe.");
  lines.push("");

  return lines.join("\n");
}
