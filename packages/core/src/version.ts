declare const __CAPIVARA_VERSION__: string | undefined;

/** Injetada pelo build; fora do bundle (testes) cai no marcador de desenvolvimento. */
export const VERSION: string =
  typeof __CAPIVARA_VERSION__ === "string" ? __CAPIVARA_VERSION__ : "0.0.0-dev";
