> Registro histórico anterior à reconstrução 0.9.0_RC1. Não define comandos nem regras do motor atual. Consulte [README](../README.md) e [reconstrução](RECONSTRUCAO-0.9.0_RC1.md).

# Diagnóstico — G4 bloqueou P03, P04 e P05 no build paralelo

- Run: `build-96756ca336b0`, projeto `teste_haiku_v2`, três agentes claude/haiku em nível workspace.
- Código: o que rodou no build, `correcao/workspace-claude-106` em `76f5ff0`. As linhas citadas são desse commit. `flows.ts`, `acceptance.ts`, `paralelo.ts` e `build.ts` são idênticos na `main`.
- Investigação feita só em leitura. Não houve correção, não houve mudança no projeto experimental, o build não foi reiniciado e nenhum LLM foi chamado.

## Conclusão

As três fases foram bloqueadas no G4 por um defeito do harness, não do Haiku.

O gate sobe a aplicação passando a porta em `PORT`. O produto lê `PORTA` e, sem ela, escuta na 3001.

O executor nunca soube disso: nenhuma mensagem que chegou a ele menciona `PORT`. A única que menciona saiu no último ciclo, quando já não havia correção possível.

Dois erros agravaram o quadro:

1. **Falta de `start` descoberta tarde.** A ausência de `start` era detectável antes do ciclo 1 e custou um ciclo em cada fase.
2. **`EADDRINUSE` mal atribuído.** O erro da porta da aplicação foi atribuído à porta do gate e classificado como "do ambiente".

## Linha do tempo (`events.tsv`)

| Fase | Ciclo 1 | Ciclo 2 | Ciclo 3 (último) |
|---|---|---|---|
| P03 | G3 reprova (legítimo) | G4: "não declara entrypoint (`start`)" | G4: `Timed out waiting 180000ms from config.webServer`; "a aplicação NÃO SUBIU" |
| P04 | G3 reprova (legítimo) | G4: sem `start` | G4: o mesmo timeout de 180s |
| P05 | G3 reprova (legítimo) | G4: sem `start` | G4: `EADDRINUSE 127.0.0.1:3001`, relatado como "a porta 47535 foi ocupada… do ambiente" |

As três começaram entre 19:44:49.844Z e 19:44:49.885Z.

No ciclo 3, cada fase criou o próprio `start`:
- P03 e P05: `node dist/servidor/iniciar.js`;
- P04: `npm run compilar && npm run iniciar`.

O servidor ignorou `PORT=4753x` e subiu na 3001 (`src/servidor/configuracao.ts:6,73,78` no branch `capivara/build-96756ca336b0/P05`; o contrato está em `docs/verificacao.md:46` do projeto). Os efeitos:

- **P04:** o webServer ficou de pé de ~20:09:40 a 20:12:40, escutando na 3001. O Playwright esperou na 4753x, onde nada escutava, e desistiu depois de 180s.
- **P05:** o G4 começou por volta de 20:11:4x, com a 3001 tomada pelo servidor do G4 da P04. O servidor dela morreu com `EADDRINUSE` (`logs/P05.flow-run-3.log`).
- **P03:** o G4 começou por volta de 20:15, com a 3001 livre, e expirou como a P04.

## As perguntas

### 1. Como o G4 escolhe e transmite a porta

- `paralelo.ts:426` passa `preferredPort: portaBase + slot`, e `build.ts:833` define `portaBase: FLOW_PORT`. Com `FLOW_PORT = 47533` (`flows.ts:81`), as portas são 47533, 47534 e 47535.
- `portaLivre` (`flows.ts:91`) confere a preferida ou pede uma efêmera ao sistema (`flows.ts:725-727`).
- A porta chega à aplicação só como `env: { PORT, HOST }` no `webServer` do Playwright (`flows.ts:361`). O Playwright espera em `http://127.0.0.1:<porta>`.

### 2. Gates de fases diferentes rodam ao mesmo tempo?

- Sim. Cada agente roda o runner inteiro, de G0 a G4. A única serialização é a fila de integração (`paralelo.ts:122,138`).
- As portas do gate são distintas por slot, mas a porta que a aplicação realmente abre não é controlada pelo harness, e por isso as três disputaram a 3001.
- Há um risco residual que não causou nada neste run: a suíte do projeto usa portas fixas. `testes/fundacao/servidor.test.ts:155-202` apaga `PORTA` e espera respostas nas portas 3001 e 5173. Isso pode colidir no G2 entre fases, e entre o G2 de uma fase e o G4 de outra.

### 3. `PORT` versus `PORTA`

- O harness envia só `PORT` (`flows.ts:361`).
- O contrato aparece apenas na causa de "NÃO SUBIU" (`flows.ts:996-998`), que só saiu no ciclo 3, o último (`DEFAULT_MAX_CYCLES = 3`, `runner.ts:182`). Essa causa nunca chegou a um executor.
- A causa do ciclo 2 (`flows.ts:738-744`) pede um `start` e não fala em porta. O executor fez exatamente o pedido: `prompts/P04.cycle-3.txt:50`.

### 4. Como o G4 descobre o entrypoint

- `startCommandFor` (`acceptance.ts:260`) reusa `deriveAcceptance`. Em Node, só `scripts.start` vira passo de serviço (`acceptance.ts:104`).
- O projeto declara `iniciar` e `compilar`, então o resultado é `null`.
- O requisito era conhecido antes do ciclo 1: o manifesto não tinha `start` e as fases tinham fluxos. Mesmo assim, nem o preflight nem o prompt do executor o mencionam.
- Cada fase descobriu a falta no G4 do ciclo 2 e resolveu de um jeito diferente.

### 5. Por que o diagnóstico citou a 47535

`flows.ts:978-987` testa `/is already used|EADDRINUSE/` em qualquer parte da saída e monta a causa com `port`, que é a porta do gate. Ele não confere o endereço que aparece no erro. O `EADDRINUSE` era da aplicação, em `127.0.0.1:3001`.

### 6. `EADDRINUSE` classificado como ambiente

- Sim, e por engano. A causa diz "Isto é do ambiente… nada precisa ser corrigido na implementação".
- Na verdade era um contrato de porta, que o executor corrigiria se fosse informado. Num ciclo que não fosse o último, essa causa gastaria um ciclo mandando o executor não fazer nada.
- No caso legítimo, em que a porta ocupada é a do gate, o G4 não tenta de novo com outra porta. Ele reprova (`runner.ts:500-511`) e consome o ciclo.

### 7. Ciclos gastos no que o executor não podia resolver

Nas três fases:
- o ciclo 2 foi gasto numa pré-condição detectável desde o início, a falta de `start`;
- o ciclo 3 bloqueou por um contrato que ninguém comunicou.

Só os ciclos 1 (G3) foram trabalho legítimo.

## Proposta mínima, preservando o paralelismo

1. **Contrato do G4 no prompt do executor, desde o ciclo 1** (`prompts/builder.ts`, quando a fase tem fluxos).
   - O texto: "o gate 4 sobe a aplicação com `npm start` a partir da raiz, com `PORT=<n>` e `HOST=127.0.0.1`, e espera resposta nessa porta".
   - O projeto pode manter `PORTA`, desde que o `start` ou o servidor aceite `PORT`.
   - Isso elimina o ciclo do entrypoint e o descompasso de porta, sem pôr o nome `PORTA` dentro do harness.
2. **`EADDRINUSE` classificado pelo endereço** (`flows.ts:978`). Extrair a porta do erro (`/EADDRINUSE[^\n]*:(\d+)/`).
   - **Se for a porta do gate:** é falha de ambiente. O G4 escolhe outra porta e roda de novo uma vez, sem gastar ciclo, como na reescrita de roteiro.
   - **Se for outra porta:** é falha de produto, com a causa "a aplicação tentou escutar na `<porta>`, mas o gate passou `PORT=<n>`; ela precisa usar a porta de `PORT`".
3. **Opcional:** quando o webServer expira e a saída `[WebServer]` mostra que o servidor escutou em outra porta, dizer isso em vez de só "NÃO SUBIU".

Com a aplicação escutando em `PORT`, os G4 simultâneos deixam de disputar a 3001, e o paralelismo segue como está.

As portas fixas da suíte do projeto (3001 e 5173) continuam sendo risco no G2. Isso é do projeto, e não há proposta de mudança no harness para isso agora.

## Testes de regressão recomendados

- **`flows.spec`, porta da aplicação:** saída com `EADDRINUSE 127.0.0.1:3001` e gate na 47535. A causa não cita 47535, não diz "do ambiente", e cita a 3001 e `PORT`.
- **`flows.spec`, porta do gate:** `EADDRINUSE` na porta do próprio gate. O runner é chamado duas vezes, com portas diferentes, e o resultado sai sem consumir ciclo.
- **`prompts.spec`:** uma fase com fluxos recebe o contrato `npm start` / `PORT` / `HOST`. Uma fase sem fluxos não recebe.
