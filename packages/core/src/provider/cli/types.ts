/**
 * O contrato de um adaptador de CLI.
 *
 * Cada CLI vive no próprio arquivo e responde às mesmas perguntas: como se
 * chama, qual binário procurar, como montar os argumentos para o nível de
 * acesso pedido, e como ler o que ela escreveu.
 *
 * Acrescentar uma CLI nova — agy, cursor, o que vier — é escrever um arquivo
 * destes e citá-lo na lista de `index.ts`. Nada mais: o `doctor`, o wizard, a
 * listagem de providers e a validação de flags leem todos da mesma lista.
 */

import type { TranscriptKind } from "../transcript.js";

/**
 * O que a chamada precisa fazer no disco.
 *
 * `read-only` é papel que só lê; `workspace` escreve dentro do projeto;
 * `system` é o executor com permissão de instalar, e só quando o operador liga.
 */
export type AccessLevel = "read-only" | "workspace" | "system";

export interface CliInvocationInput {
  projectRoot: string;
  /** Onde a CLI roda: o isolamento de cada uma depende do sistema operacional. */
  platform: NodeJS.Platform;
  /**
   * O diretório comum do Git (`git rev-parse --git-common-dir`), absoluto, ou
   * null fora de um repositório. Num worktree é o `.git` da árvore principal:
   * quem isola o executor o protege, porque só o Core registra no Git (§101).
   */
  gitDir: string | null;
  /** Já validado contra caracteres perigosos; vazio significa "o padrão da CLI". */
  model: string;
  effort: string;
  access: AccessLevel;
  /** Binário resolvido: o do ambiente, se houver, senão o padrão do adaptador. */
  binary: string;
  env: NodeJS.ProcessEnv;
  /** Caminho configurado pelo operador. Só o adaptador custom usa. */
  command: string;
}

export interface CliInvocation {
  /** Sobrescreve o binário quando o adaptador resolve o executável sozinho. */
  command?: string;
  args: string[];
  /** Só quando o adaptador precisa mexer no ambiente herdado. */
  env?: NodeJS.ProcessEnv;
  /**
   * A chamada precisa de um `TMPDIR` só dela, fora de `/tmp` (§106).
   *
   * O sandbox do Claude Code torna gravável o temporário "por usuário" que ele
   * deriva do `TMPDIR` — `/tmp/claude-<uid>` por padrão, o MESMO para toda
   * sessão do usuário. Sem isto, um executor escreveria no temporário de outro
   * agente, ou no de outra ferramenta.
   */
  tmpPrivado?: boolean;
}

/**
 * O que o nível `workspace` do executor entrega nesta CLI (§106).
 *
 * O contrato é um só para todas: rodar os comandos de desenvolvimento, alcançar
 * a internet, instalar dependências no projeto, e não alterar nada fora dele —
 * sem acesso irrestrito ao sistema e sem mexer no Git do Core. Cada CLI declara
 * o que consegue GARANTIR disso, com a evidência; o que ela não garante não é
 * anunciado.
 *
 * - `garantido`: comprovado com a CLI real, nesta plataforma;
 * - `insuficiente`: comprovadamente falta uma capacidade obrigatória — o build
 *   recusa a configuração, em vez de reduzir a rede ou promover o acesso em
 *   silêncio;
 * - `nao-verificado`: a CLI não pôde ser verificada; o build segue, e diz isso.
 */
export interface ContratoDoWorkspace {
  estado: "garantido" | "insuficiente" | "nao-verificado";
  motivo: string;
  /** Binários de que o isolamento depende nesta plataforma. */
  dependencias?: readonly string[];
}

export interface CliAdapter {
  id: string;
  label: string;
  /** Variável que aponta para um binário fora do PATH. */
  binaryEnv: string;
  defaultBinary: string;
  /** Como ler a saída. Ausente significa texto puro, sem envelope. */
  transcript?: TranscriptKind;
  /**
   * A CLI escreve enquanto trabalha, ou só no fim?
   *
   * Isto não é detalhe de formatação: é o que decide se o limite de PRIMEIRA
   * SAÍDA mede o que promete. Numa CLI que transmite, ficar calado é sinal de
   * que ela nunca começou. Numa que só imprime o resultado — `claude -p
   * --output-format json` e as outras de objeto único —, ficar calado é o
   * comportamento normal, e o limite vira um relógio sobre a resposta inteira:
   * a fase 3 do MCP_teste foi morta aos 20 minutos com o modelo trabalhando.
   */
  streams: boolean;
  build: (input: CliInvocationInput) => CliInvocation;
  /** O que o nível `workspace` do executor garante nesta plataforma (§106). */
  workspace: (platform: NodeJS.Platform) => ContratoDoWorkspace;
}
