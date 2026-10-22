/** OpenCode 2 lê limit.output do modelo, mas ignora o antigo teto só no ambiente. */
import { DIRECT_CATALOG, opencodeProviderId, raciocinioDoModelo, type RaciocinioDoModelo } from "../registry.js";
import { runProvider } from "../supervisor.js";

type ModelLimits = { context: number; input?: number; output: number };
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function record(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("OPENCODE_CONFIG_CONTENT contém configuração incompatível; nenhuma inferência foi enviada");
  return value as Record<string, unknown>;
}

export function openRouterOutputEnvironment(model: string, env: NodeJS.ProcessEnv, limits: ModelLimits | null): NodeJS.ProcessEnv {
  if (!model.startsWith("openrouter/")) return env;
  const raw = env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX?.trim() ?? "";
  const cap = raw ? Number(raw) : 16384;
  if ((raw && !/^\d+$/.test(raw)) || !positive(cap)) throw new Error("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX deve ser um inteiro positivo seguro; nenhuma inferência foi enviada");
  if (!limits || !positive(limits.context) || !positive(limits.output)) throw new Error(`OpenCode: não foi possível conferir os limites de ${model}; nenhuma inferência foi enviada`);
  let parsed: unknown;
  try { parsed = env.OPENCODE_CONFIG_CONTENT?.trim() ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : {}; }
  catch { throw new Error("OPENCODE_CONFIG_CONTENT não é JSON válido; nenhuma inferência foi enviada"); }
  const config = record(parsed);
  const providers = record(config.provider);
  const provider = record(providers.openrouter);
  const models = record(provider.models);
  const id = model.slice("openrouter/".length);
  const selected = record(models[id]);
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      provider: { ...providers, openrouter: { ...provider, models: { ...models, [id]: { ...selected, limit: { ...limits, output: Math.min(cap, limits.output) } } } } },
    }),
  };
}

/** A consulta não faz geração. Nunca retorna settings/headers que possam carregar chaves. */
export async function withOpenRouterOutputLimit(model: string, env: NodeJS.ProcessEnv, cwd: string): Promise<NodeJS.ProcessEnv> {
  if (!model.startsWith("openrouter/")) return env;
  let limits: ModelLimits | null = null;
  try {
    const result = await runProvider({
      invocation: {
        command: env.CAPIVARA_OPENCODE_BIN?.trim() || "opencode", args: ["api", "model.list", "--standalone"],
        env: { ...env, PWD: cwd, CAPIVARA_PROVIDER: "opencode" }, cwd, stdinIsPrompt: true, streams: false,
      },
      prompt: "", limits: { firstOutputSeconds: 0, idleSeconds: 0, wallSeconds: 15, maxOutputBytes: 4 * 1024 * 1024 },
    });
    if (result.exitCode !== 0 || result.timedOut || result.truncated) throw new Error("consulta incompleta");
    const body: unknown = JSON.parse(result.stdout);
    const models: unknown = Array.isArray(body) ? body : record(body).data;
    const found = Array.isArray(models) ? models.find((item: unknown) => {
      const candidate = record(item);
      return candidate.providerID === "openrouter" && candidate.id === model.slice("openrouter/".length);
    }) : undefined;
    if (found) {
      const limit = record(record(found).limit);
      if (positive(limit.context) && positive(limit.output)) limits = { context: limit.context, output: limit.output, ...(positive(limit.input) ? { input: limit.input } : {}) };
    }
  } catch { /* diagnóstico sem stderr/configuração/headers da CLI, que podem conter segredos */ }
  return openRouterOutputEnvironment(model, env, limits);
}

const MINIMAX = DIRECT_CATALOG.find((provider) => provider.id === "minimax")!;
/*
 * Os provedores do OpenCode que levam ao MiniMax pela API compatível com
 * Anthropic que a documentação descreve (`https://api.minimax.io/anthropic/v1`):
 * o `minimax` e o `minimax-coding-plan`, mesmo pacote e mesmo endereço no
 * catálogo do OpenCode 2.0.32. Os `-cn` vão a `api.minimax.cn`, cuja
 * documentação não foi conferida, e ficam como a CLI os declara.
 */
const ROTAS_DO_MINIMAX = [opencodeProviderId(MINIMAX.id), "minimax-coding-plan"];

/** O raciocínio documentado de um modelo do OpenCode que leva ao MiniMax, com o provedor e o id como a configuração os nomeia. */
export function raciocinioNoOpenCode(model: string): { provedor: string; id: string; raciocinio: RaciocinioDoModelo } | null {
  const barra = model.indexOf("/");
  const provedor = model.slice(0, barra);
  const id = model.slice(barra + 1);
  if (barra <= 0 || id === "" || !ROTAS_DO_MINIMAX.includes(provedor)) return null;
  const raciocinio = raciocinioDoModelo(MINIMAX, id);
  return raciocinio ? { provedor, id, raciocinio } : null;
}

/**
 * As intensidades do MiniMax que o catálogo do OpenCode não traz (§131).
 *
 * O OpenCode 2.0.32 lista o `MiniMax-M3.1-Flash` sem variante nenhuma: `#low`
 * morre em "Variant unavailable" antes da requisição, e sem variante ele não
 * manda intensidade — a API usa a dela, `max`, em toda sessão do BUILD. A
 * configuração do OpenCode aceita variantes por modelo, e com elas a requisição
 * leva `output_config.effort`, o campo que a API compatível com Anthropic do
 * MiniMax documenta para esse modelo. A mesma injeção vai à listagem e à
 * chamada, então o wizard só oferece o que a CLI de fato aceitou. Variante que
 * a pessoa já configurou vale sobre esta.
 */
export function withDocumentedEffortVariants(model: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const documentado = raciocinioNoOpenCode(model);
  if (!documentado || documentado.raciocinio.niveis.length === 0) return env;
  const { provedor, id, raciocinio } = documentado;
  let parsed: unknown;
  try { parsed = env.OPENCODE_CONFIG_CONTENT?.trim() ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : {}; }
  catch { throw new Error("OPENCODE_CONFIG_CONTENT não é JSON válido; nenhuma inferência foi enviada"); }
  const config = record(parsed);
  const providers = record(config.provider);
  const provider = record(providers[provedor]);
  const models = record(provider.models);
  const selected = record(models[id]);
  const variants = Object.fromEntries(raciocinio.niveis.map((nivel) => [nivel, { output_config: { effort: nivel } }]));
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      provider: { ...providers, [provedor]: { ...provider, models: { ...models, [id]: { ...selected, variants: { ...variants, ...record(selected.variants) } } } } },
    }),
  };
}
