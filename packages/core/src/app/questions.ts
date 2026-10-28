import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { dirname } from 'node:path';
import type { Question } from '../domain/types.js';
import { ProjectStore } from './store.js';

export function questionChannel(store: ProjectStore, signal: AbortSignal, announce: (message: string) => void, interact?: (question: Question) => Promise<string | null>) {
  return async (question: Question): Promise<string | null> => {
    const recorded = store.getAnswer(question.id);
    if (recorded !== undefined) {
      if (store.read().pendingQuestion?.id === question.id) store.update({ pendingQuestion: null, status: 'working' });
      return recorded;
    }
    store.update({ status: 'waiting', pendingQuestion: question });
    announce(`${question.question}\nMotivo: ${question.reason}\nImpacto: ${question.impact}`);
    if (interact) {
      try {
        const input = (await interact(question))?.trim();
        if (input) {
          const answer = /^\d+$/.test(input) ? question.options[Number(input) - 1] ?? input : input;
          store.answer(question.id, answer);
          store.update({ status: 'working', pendingQuestion: null });
          return answer;
        }
        return null;
      } catch { if (signal.aborted) return null; }
    }
    if (stdin.isTTY) {
      const reader = createInterface({ input: stdin, output: stdout });
      try {
        question.options.forEach((option, index) => stdout.write(`  ${index + 1}) ${option}\n`));
        const input = (await reader.question('Resposta (número ou texto): ', { signal })).trim();
        if (input) {
          const answer = /^\d+$/.test(input) ? question.options[Number(input) - 1] ?? input : input;
          store.answer(question.id, answer);
          store.update({ status: 'working', pendingQuestion: null });
          return answer;
        }
      } catch { if (signal.aborted) return null; }
      finally { reader.close(); }
    }
    announce(`Decisão pendente ${question.id}. Pode responder em outro terminal: capivara answer ${question.id} "resposta" --project "${dirname(store.directory)}"`);
    // The gap stays pending; the scheduler can execute its independent work.
    return null;
  };
}
