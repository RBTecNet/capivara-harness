import { createServer } from "node:net";

/** Uma alocação efêmera para cada processo; nunca uma porta fixa compartilhada. */
export async function portaLivre(preferida = 47533): Promise<number> {
  const tentar = async (porta: number): Promise<number | null> =>
    await new Promise(resolve => {
      const server = createServer();
      server.once("error", () => resolve(null));
      server.listen(porta, "127.0.0.1", () => {
        const address = server.address();
        const selected = typeof address === "object" && address ? address.port : porta;
        server.close(() => resolve(selected));
      });
    });
  const selected = (await tentar(preferida)) ?? (await tentar(0));
  if (selected === null) throw new Error("não foi possível reservar uma porta local para esta execução");
  return selected;
}
