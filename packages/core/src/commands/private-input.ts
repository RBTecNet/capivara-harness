/** Entrada de segredos sem eco, inclusive quando chegam colados junto a outras respostas. */
import { createInterface } from "node:readline/promises";
import { Writable, type Readable } from "node:stream";
import { createLineIO } from "./line-io.js";

export class PromptOutput extends Writable {
  echo = false;
  readonly isTTY = true;
  readonly columns: number;
  constructor(private readonly target: Writable) {
    super();
    this.columns = (target as Writable & { columns?: number }).columns ?? 80;
  }
  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.echo) this.target.write(chunk, encoding);
    callback();
  }
}

export function createPrivateLineInput(input: Readable, output: Writable) {
  const filtered = new PromptOutput(output);
  const reader = createInterface({ input, output: filtered, terminal: (input as Readable & { isTTY?: boolean }).isTTY === true, historySize: 0 });
  reader.on("line", () => { filtered.echo = false; });
  const io = createLineIO(reader, (text) => void output.write(text), { interactive: (input as Readable & { isTTY?: boolean }).isTTY === true });
  const ask = async (prompt: string, hidden = false): Promise<string> => {
    reader.setPrompt(prompt);
    filtered.echo = !hidden;
    try { return await io.ask(prompt); }
    finally { filtered.echo = false; if (hidden) output.write("\n"); }
  };
  const cancel = (): void => reader.close();
  reader.on("SIGINT", cancel);
  return { io: { ...io, ask: (prompt: string) => ask(prompt), secret: (prompt: string) => ask(prompt, true) }, close: () => { filtered.echo = false; reader.close(); } };
}
