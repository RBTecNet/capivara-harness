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
}

export interface CliAdapter {
  id: string;
  label: string;
  /** Variável que aponta para um binário fora do PATH. */
  binaryEnv: string;
  defaultBinary: string;
  /** Como ler a saída. Ausente significa texto puro, sem envelope. */
  transcript?: TranscriptKind;
  build: (input: CliInvocationInput) => CliInvocation;
}
