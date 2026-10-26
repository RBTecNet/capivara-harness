# Respostas reais de modelos

Uma resposta por arquivo, copiada de um log de run (`.capivara/runs/*/logs/`),
nomeada pelo parser e pelo hábito: `audit-…`, `g3-…`, `json-…`. Ao lado de cada
`.txt` fica o `.esperado.json` com a origem, o hábito e o que o parser tem de ler.
O teste `test/contract/corpus-de-respostas-reais.spec.ts` percorre a pasta.

Toda fragilidade nova de leitura vira um arquivo aqui, não uma regra nova.
Sem chave, segredo ou token: o teste confere.
