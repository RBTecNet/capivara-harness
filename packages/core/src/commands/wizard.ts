/**
 * O wizard interativo.
 *
 * Ele existe para quem ainda não sabe quais flags passar, e termina imprimindo o
 * comando equivalente justamente para não precisar existir da próxima vez.
 *
 * Duas regras o governam:
 *
 * 1. Toda escolha fechada é NUMÉRICA. O wizard do harness anterior perguntava
 *    "digitar ou arquivo" num campo livre; quem colava o pedido ali tinha a
 *    primeira linha lida como se fosse o modo, e o resto da colagem era
 *    consumido uma linha por pergunta seguinte. Número não aceita colagem por
 *    engano.
 * 2. O comando impresso e o comando executado saem do MESMO lugar — `toArgv` e
 *    `renderCommand` leem a mesma resposta, e o CLI reexecuta o próprio programa
 *    com esse argv. Um wizard que executa por um caminho e ensina outro mente.
 */

import { CLI_PROVIDERS, DIRECT_PROVIDERS, ROLES, ROLE_NAMES } from "../provider/index.js";
import type { RoleName } from "../provider/index.js";
import { readChoice, renderChoices, renderCommand, roleHint, toArgv } from "../tui/index.js";
import type { Choice, WizardAnswers } from "../tui/index.js";
import { createLineIO } from "./line-io.js";
import type { LineIO, LineSource } from "./line-io.js";

/** O wizard lê linha a linha como todo o resto do CLI. */
export type WizardIO = LineIO;
export { createLineIO };
export type { LineSource };

export interface WizardDeps {
  io: WizardIO;
  cwd: string;
  /** Existe e é arquivo. Usado para validar o pedido e detectar documentação pronta. */
  fileExists: (path: string) => Promise<boolean>;
  directoryExists: (path: string) => Promise<boolean>;
  /**
   * Os modelos que um provider oferece, para escolher pelo número.
   *
   * Injetado para o wizard ser exercitável sem CLI instalada. Ausente, ou
   * devolvendo vazio, faz a pergunta voltar a ser o nome digitado.
   */
  listModels?: (providerId: string) => Promise<string[]>;
  /**
   * Se o projeto já registra qual pedido o `init` usou.
   *
   * O `plan` retoma o esqueleto por esse pedido e o encontra sozinho — não há o
   * que perguntar. Só quando o registro falta (um `init` anterior a ele) é que
   * o wizard pergunta o arquivo, em vez de montar um comando que ele já sabe
   * que vai parar em "não encontrei qual pedido o init usou".
   */
  requestRecorded?: (projectRoot: string) => Promise<boolean>;
  /**
   * Os níveis de raciocínio que um modelo aceita, quando a CLI informa.
   *
   * Ausente, ou devolvendo vazio, faz o wizard oferecer a lista genérica — que
   * é o que ele fazia antes, menos o `minimal` que ninguém aceitava.
   */
  listEfforts?: (providerId: string, model: string) => Promise<string[]>;
  /**
   * Os projetos de uma base documental, para escolher pelo número.
   *
   * Injetado para o wizard ser exercitável sem servidor nenhum de pé. Ausente,
   * a opção de ler o pedido da base não é oferecida — melhor não mostrar um
   * caminho que este binário não sabe percorrer.
   */
  listMcpProjects?: (url: string) => Promise<{ slug: string; hasRequest: boolean; documents: number }[]>;
  /**
   * Os prompts guardados na base, pelo nome que alguém deu a eles.
   *
   * É a terceira origem de um pedido, ao lado de digitar e de apontar um
   * arquivo. Existe porque o mesmo pedido volta: "acrescente o CRUD completo
   * deste cadastro" serve a três projetos, e redigitá-lo em cada um é como as
   * três versões dele começam a divergir.
   */
  listMcpPrompts?: (url: string) => Promise<{ name: string; title: string; description: string }[]>;
  readMcpPrompt?: (url: string, name: string) => Promise<string>;
  /** O endereço sugerido, quando o operador já tem um de costume. */
  defaultMcpUrl?: string;
}

export interface WizardResult {
  answers: WizardAnswers;
  argv: string[];
  command: string;
  /** Falso quando o desenvolvedor escolheu não executar agora. */
  execute: boolean;
}

/**
 * A lista genérica, para quando a CLI não informa o que o modelo aceita.
 *
 * `minimal` saiu daqui: nenhum modelo atual do codex o aceita, e oferecê-lo
 * fazia a chamada morrer com código 1 e uma mensagem de API — depois de o
 * desenvolvedor ter feito apenas o que o wizard ofereceu. Quando a CLI sabe
 * responder, esta lista nem é usada.
 */
const EFFORTS_GENERICOS: Choice[] = [
  { label: "desligado", hint: "nem todo provider aceita raciocínio estendido" },
  { label: "low" },
  { label: "medium" },
  { label: "high" },
];

const PROVIDERS: Choice[] = [
  ...CLI_PROVIDERS.map((id) => ({ label: id, hint: id === "custom" ? "adapter próprio" : "usa a CLI instalada nesta máquina" })),
  ...DIRECT_PROVIDERS.map((id) => ({ label: id, hint: "API direta; exige credencial" })),
];

/**
 * A entrada acabou antes das respostas.
 *
 * Acontece com Ctrl-D e com wizard alimentado por pipe. Não é erro de programa:
 * é o desenvolvedor dizendo que não vai responder o resto. Morrer aqui com stack
 * trace do readline seria o mesmo defeito que o provider ausente tinha.
 */
class InputEnded extends Error {}

async function pergunta(io: WizardIO, prompt: string): Promise<string> {
  try {
    return await io.ask(prompt);
  } catch {
    throw new InputEnded();
  }
}

/** Pergunta até vir um número válido. Vazio aceita o padrão. */
/**
 * `rotuloPadrao` descreve o que o Enter faz quando ele não é uma das opções.
 *
 * Serve ao menu de papel, onde "manter o que foi escolhido" não é um item da
 * lista — se fosse, deslocaria a numeração de todos os providers e faria o
 * mesmo número significar coisas diferentes em duas telas da mesma sessão.
 */
async function choose(
  io: WizardIO,
  title: string,
  choices: readonly Choice[],
  defaultIndex: number,
  rotuloPadrao?: string,
): Promise<number> {
  io.write(`\n${renderChoices(title, choices, defaultIndex)}\n`);
  const dica = rotuloPadrao ?? String(defaultIndex + 1);
  for (;;) {
    const reading = readChoice(await pergunta(io, `Escolha [${dica}]: `), choices.length, defaultIndex);
    if (reading.ok) return reading.index;
    io.write(`${reading.message}\n`);
  }
}

async function text(io: WizardIO, prompt: string, fallback = ""): Promise<string> {
  const answer = (await pergunta(io, prompt)).trim();
  return answer === "" ? fallback : answer;
}

async function yesNo(io: WizardIO, prompt: string, defaultYes: boolean): Promise<boolean> {
  const answer = (await pergunta(io, `${prompt} [${defaultYes ? "S/n" : "s/N"}]: `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return /^(?:s|sim|y|yes)$/.test(answer);
}

/**
 * Lê um pedido de várias linhas.
 *
 * Uma pergunta comum termina na primeira quebra de linha, e tudo o que vem
 * depois fica no buffer para ser respondido às perguntas seguintes. Um pedido é
 * quase sempre um parágrafo colado, então ele precisa de um fim explícito.
 */
async function multiline(io: WizardIO, title: string): Promise<string> {
  io.write(`\n${title}\n`);
  io.write("Cole ou digite quantas linhas quiser. Termine com uma linha contendo só um ponto, ou Ctrl-D.\n");
  const lines: string[] = [];
  for (;;) {
    let line: string;
    try {
      line = await io.ask("> ");
    } catch {
      break; // Ctrl-D fecha a entrada.
    }
    if (line.trim() === ".") break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

export async function runWizard(deps: WizardDeps): Promise<WizardResult | null> {
  try {
    return await conduct(deps);
  } catch (error) {
    if (error instanceof InputEnded) {
      deps.io.write("\nA entrada terminou antes do fim das perguntas. Nada foi executado.\n");
      return null;
    }
    throw error;
  }
}


/** Quantos modelos ainda cabem numa tela de terminal sem virar ruído. */
const MODELOS_SEM_FILTRO = 20;

/**
 * Os modelos que casam com o trecho digitado, do mais provável ao menos.
 *
 * Substring pura engana: filtrar por "mini" devolvia os 31 `gemini` antes de
 * qualquer `minimax`, porque "mini" está no meio de "gemini". Quem digita um
 * trecho está quase sempre começando a escrever o nome, então quem começa por
 * ele vem primeiro — no nome inteiro ou em qualquer pedaço dele, já que os
 * identificadores vêm partidos por `/`, `-`, `_` e `.`.
 *
 * Nada é descartado: o que casa só no meio continua na lista, no fim.
 */
export function filtrarModelos(modelos: string[], filtro: string): string[] {
  const alvo = filtro.trim().toLowerCase();
  if (alvo === "") return modelos;

  const peso = (modelo: string): number => {
    const nome = modelo.toLowerCase();
    if (!nome.includes(alvo)) return 3;
    if (nome.startsWith(alvo)) return 0;
    if (nome.split(/[/\-_.]/).some((parte) => parte.startsWith(alvo))) return 1;
    return 2;
  };

  return modelos
    .map((modelo, ordem) => ({ modelo, ordem, peso: peso(modelo) }))
    .filter((item) => item.peso < 3)
    .sort((a, b) => a.peso - b.peso || a.ordem - b.ordem)
    .map((item) => item.modelo);
}

/**
 * Escolher o modelo pelo número, quando dá para saber quais existem.
 *
 * Três situações, e nenhuma delas pode travar quem está no meio do wizard:
 *
 * - **A CLI não sabe listar, ou não está instalada** — a lista vem vazia e a
 *   pergunta volta a ser o nome digitado, que é como era antes de existir
 *   listagem. Um provider indisponível continua aparecendo na escolha anterior,
 *   porque saber que ele existe é útil; o que ele não faz é ser consultado.
 * - **Poucos modelos** — lista numerada direto.
 * - **Muitos** — o cursor oferece 223, que numerados não ajudam ninguém: pede-se
 *   um trecho do nome primeiro e numera-se o que casou.
 *
 * `0` volta para a escolha do provider, para quem se enganou não precisar
 * recomeçar o wizard.
 */
async function escolherModelo(
  io: WizardIO,
  providerId: string,
  rotulo: string,
  listar: (providerId: string) => Promise<string[]>,
): Promise<{ modelo: string } | "voltar"> {
  const modelos = await listar(providerId).catch(() => []);

  if (modelos.length === 0) {
    const digitado = await text(io, `\n${rotulo} (vazio usa o padrão do provider): `);
    return { modelo: digitado };
  }

  let candidatos = modelos;
  if (modelos.length > MODELOS_SEM_FILTRO) {
    io.write(`\n${providerId} oferece ${modelos.length} modelos.\n`);
    const filtro = (await pergunta(io, "Digite parte do nome para filtrar (vazio lista todos, 0 volta ao provider): ")).trim();
    if (filtro === "0") return "voltar";
    if (filtro !== "") {
      const casaram = filtrarModelos(modelos, filtro);
      if (casaram.length === 0) io.write(`Nenhum modelo com "${filtro}"; mostrando todos.\n`);
      else candidatos = casaram;
    }
  }

  const opcoes: Choice[] = candidatos.map((modelo) => ({ label: modelo }));
  io.write(`\n${renderChoices(rotulo, opcoes, 0)}\n`);
  for (;;) {
    const resposta = (await pergunta(io, "Escolha [1, 0 volta ao provider, ou digite o nome]: ")).trim();
    if (resposta === "0") return "voltar";
    if (resposta === "") return { modelo: candidatos[0] ?? "" };
    if (/^\d+$/.test(resposta)) {
      const escolhido = candidatos[Number(resposta) - 1];
      if (escolhido) return { modelo: escolhido };
      io.write(`Responda com um número entre 1 e ${candidatos.length}, 0 para voltar, ou o nome do modelo.\n`);
      continue;
    }
    // Nome digitado vale mesmo fora da lista: a CLI pode conhecer o que ela não lista.
    return { modelo: resposta };
  }
}

/**
 * Escolher um prompt guardado na base.
 *
 * A lista mostra o NOME que alguém deu a cada um — é para isso que eles têm
 * nome. O endereço técnico fica embaixo, em cinza, porque serve para o comando
 * equivalente e não para a escolha.
 *
 * Devolve o texto do prompt, ou `null` quando não há o que escolher ou quando
 * quem escolheu desistiu.
 */
async function escolherPrompt(deps: WizardDeps, io: WizardIO): Promise<{ texto: string; url: string; nome: string } | null> {
  const listar = deps.listMcpPrompts!;
  const ler = deps.readMcpPrompt!;
  const sugerida = deps.defaultMcpUrl ?? "http://localhost:7777/mcp";

  for (;;) {
    const url = await text(io, `\nEndereço da base [${sugerida}]: `, sugerida);
    io.write("conectando…\n");

    let prompts: { name: string; title: string; description: string }[];
    try {
      prompts = await listar(url);
    } catch (erro) {
      io.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
      const saida: Choice[] = [{ label: "tentar outro endereço" }, { label: "voltar e escrever o pedido aqui" }];
      if ((await choose(io, "E agora?", saida, 0)) === 1) return null;
      continue;
    }

    if (prompts.length === 0) {
      io.write("Esta base não tem prompt guardado nenhum. Guarde um na interface dela e volte.\n");
      return null;
    }

    const opcoes: Choice[] = prompts.map((prompt) => ({
      label: prompt.title,
      hint: prompt.description !== "" ? `${prompt.description} · ${prompt.name}` : prompt.name,
    }));
    const escolhido = prompts[await choose(io, "Qual prompt?", opcoes, 0)]!;

    try {
      const texto = await ler(url, escolhido.name);
      if (texto.trim() === "") {
        io.write("Esse prompt está vazio na base.\n");
        continue;
      }
      return { texto, url, nome: escolhido.name };
    } catch (erro) {
      io.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
      return null;
    }
  }
}

/**
 * Conectar à base documental e escolher o projeto.
 *
 * Duas coisas separam isto de um campo de texto com o nome do projeto.
 *
 * A primeira é que o wizard **conecta na hora**: digitar uma URL errada aqui
 * custa uma mensagem, e não um run inteiro que morre na primeira chamada. Se a
 * base não responde, a pergunta volta — endereço errado é o caso comum, não o
 * excepcional.
 *
 * A segunda é que ele lista o que existe lá. Um projeto sem pedido escrito
 * aparece marcado e não pode ser escolhido: o `init` não teria o que ler, e
 * descobrir isso depois de montar o comando inteiro é tarde.
 */
async function escolherDaBase(
  deps: WizardDeps,
  projectRoot: string,
): Promise<{ url: string; projeto: string } | null> {
  const { io } = deps;
  const listar = deps.listMcpProjects!;
  const sugerida = deps.defaultMcpUrl ?? "http://localhost:7777/mcp";

  for (;;) {
    const url = await text(io, `\nEndereço da base [${sugerida}]: `, sugerida);
    if (url === "") {
      io.write("O endereço não pode ficar vazio.\n");
      continue;
    }

    io.write("conectando…\n");
    let projetos: { slug: string; hasRequest: boolean; documents: number }[];
    try {
      projetos = await listar(url);
    } catch (erro) {
      io.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
      const saida: Choice[] = [
        { label: "tentar outro endereço" },
        { label: "voltar e escrever o pedido aqui" },
      ];
      if ((await choose(io, "E agora?", saida, 0)) === 1) return null;
      continue;
    }

    if (projetos.length === 0) {
      io.write("Esta base não tem projeto nenhum cadastrado. Crie um na interface dela e volte.\n");
      const saida: Choice[] = [{ label: "tentar outro endereço" }, { label: "desistir" }];
      if ((await choose(io, "E agora?", saida, 1)) === 1) return null;
      continue;
    }

    const utilizaveis = projetos.filter((projeto) => projeto.hasRequest);
    if (utilizaveis.length === 0) {
      io.write(
        `Os ${projetos.length} projeto(s) desta base ainda não têm pedido escrito: ` +
          `${projetos.map((projeto) => projeto.slug).join(", ")}.\n` +
          "Escreva o pedido de um deles na interface da base — é ele que o init lê.\n",
      );
      return null;
    }

    const opcoes: Choice[] = utilizaveis.map((projeto) => ({
      label: projeto.slug,
      hint: `${projeto.documents} documento(s) selecionado(s)`,
    }));
    const escolhido = utilizaveis[await choose(io, "Qual projeto da base?", opcoes, 0)];
    if (!escolhido) continue;

    const semPedido = projetos.length - utilizaveis.length;
    if (semPedido > 0) io.write(`(${semPedido} projeto(s) sem pedido escrito ficaram de fora)\n`);
    io.write(`\nO harness vai ler o pedido e ${escolhido.documents} documento(s) de ${escolhido.slug}, em ${projectRoot}.\n`);
    return { url, projeto: escolhido.slug };
  }
}

export interface PedidoDoWizard {
  request?: string;
  requestFile?: string;
  mcpUrl?: string;
  mcpProject?: string;
}

/** O arquivo do pedido, conferido antes de virar flag. */
async function arquivoDoPedido(deps: WizardDeps, io: WizardIO, projectRoot: string): Promise<string> {
  for (;;) {
    const caminho = await text(io, "Caminho do arquivo: ");
    if (caminho === "") {
      io.write("O caminho não pode ficar vazio.\n");
      continue;
    }
    if (!(await deps.fileExists(caminho.startsWith("/") ? caminho : `${projectRoot}/${caminho}`))) {
      io.write(`Não encontrei ${caminho} dentro de ${projectRoot}.\n`);
      continue;
    }
    return caminho;
  }
}

/**
 * De onde vem o pedido — a pergunta, sozinha.
 *
 * Mesma razão da extração dos papéis: quem digitou `capivara init --fresh` já
 * disse o estágio e a pasta, e esqueceu só o pedido. Mandá-lo ao começo do
 * wizard é fazê-lo repetir o que já disse.
 */
async function perguntarPedido(deps: WizardDeps, projectRoot: string): Promise<PedidoDoWizard | null> {
  const { io } = deps;
  const escolhido_: PedidoDoWizard = {};
    /*
     * As origens são mapeadas por CHAVE, nunca por posição.
     *
     * Duas delas são condicionais — projeto da base e prompt guardado —, então a
     * posição de cada uma muda conforme o que está disponível. Um `fonte === 3`
     * escrito à mão acerta numa configuração e erra na outra, e o erro é mudo:
     * escolhe a origem errada em vez de falhar.
     */
    const origens: { chave: "texto" | "arquivo" | "projeto" | "prompt"; opcao: Choice }[] = [
      { chave: "texto", opcao: { label: "escrever agora", hint: "cole ou digite; várias linhas" } },
      { chave: "arquivo", opcao: { label: "ler de um arquivo", hint: "um .md ou .txt já escrito" } },
      ...(deps.listMcpProjects
        ? ([{ chave: "projeto", opcao: { label: "projeto da base documental (MCP)", hint: "o pedido e as memórias já cadastrados de um projeto" } }] as const)
        : []),
      ...(deps.listMcpPrompts && deps.readMcpPrompt
        ? ([{ chave: "prompt", opcao: { label: "prompt guardado na base", hint: "escolhe pelo nome entre os prompts já salvos" } }] as const)
        : []),
    ];

    const escolha = origens[await choose(io, "De onde vem o pedido?", origens.map((origem) => origem.opcao), 0)]?.chave ?? "texto";

    if (escolha === "prompt") {
      const escolhido = await escolherPrompt(deps, io);
      if (escolhido === null) return null;
      escolhido_.request = escolhido.texto;
      io.write(`\nprompt "${escolhido.nome}" carregado: ${escolhido.texto.split("\n")[0]?.slice(0, 70) ?? ""}…\n`);
    } else if (escolha === "projeto") {
      const escolhido = await escolherDaBase(deps, projectRoot);
      if (escolhido === null) return null;
      escolhido_.mcpUrl = escolhido.url;
      escolhido_.mcpProject = escolhido.projeto;
    } else if (escolha === "arquivo") {
      escolhido_.requestFile = await arquivoDoPedido(deps, io, projectRoot);
    } else {
      const pedido = await multiline(io, "O que você quer construir?");
      if (pedido === "") {
        io.write("Sem pedido não há o que documentar.\n");
        return null;
      }
      escolhido_.request = pedido;
    }
  return escolhido_;
}

export interface EscolhaDePapeis {
  global: { provider?: string; model?: string; effort?: string };
  roles: Partial<Record<RoleName, { provider?: string; model?: string }>>;
}

/**
 * As perguntas de provider, modelo, effort e papéis — e só elas.
 *
 * Extraídas do wizard inteiro porque há duas entradas para elas: quem chama o
 * wizard do zero, e quem digitou um comando completo e esqueceu de dizer o
 * modelo. O segundo caso não pode ser mandado ao começo do wizard — ele já
 * respondeu tudo o mais, e reperguntar "init, plan ou build?" a quem escreveu
 * `capivara init` é fazê-lo repetir o que já disse.
 */
async function perguntarPapeis(deps: WizardDeps, usados: readonly RoleName[]): Promise<EscolhaDePapeis> {
  const { io } = deps;
  const global: EscolhaDePapeis["global"] = {};
  const roles: EscolhaDePapeis["roles"] = {};

  // O laço existe para o `0` da escolha de modelo ter para onde voltar.
  let provider = "codex";
  for (;;) {
    provider = PROVIDERS[await choose(io, "Qual provider usar em todos os papéis?", PROVIDERS, 0)]?.label ?? "codex";
    const escolha = await escolherModelo(io, provider, "Modelo", deps.listModels ?? (async () => []));
    if (escolha === "voltar") continue;
    if (escolha.modelo !== "") global.model = escolha.modelo;
    break;
  }
  global.provider = provider;

  // O que este modelo aceita, quando a CLI sabe dizer; senão, a lista genérica.
  const aceitos = global.model
    ? await (deps.listEfforts ?? (async () => []))(provider, global.model).catch(() => [])
    : [];
  const opcoesEffort: Choice[] =
    aceitos.length > 0
      ? [{ label: "desligado", hint: `${global.model} aceita: ${aceitos.join(", ")}` }, ...aceitos.map((nivel) => ({ label: nivel }))]
      : EFFORTS_GENERICOS;

  const effort = opcoesEffort[await choose(io, "Intensidade de raciocínio?", opcoesEffort, 0)]?.label ?? "desligado";
  if (effort !== "desligado") global.effort = effort;

  if (await yesNo(io, "\nAjustar algum papel separadamente?", false)) {
    const fila: RoleName[] = [...usados];
    /*
     * A numeração dos providers é a MESMA aqui e na pergunta global.
     *
     * "manter o padrão" já ocupou a posição 1 desta lista, e então codex era 1
     * lá em cima e 2 aqui, opencode era 3 lá e 4 aqui. Quem lesse a primeira
     * lista e respondesse pela memória escolhia o vizinho — e o wizard imprimia
     * um comando com o provider errado, sem nada parecer estranho.
     *
     * Manter o padrão passa a ser o Enter, que é onde um "deixa como está"
     * pertence.
     */
    const manterPadrao = -1;
    for (;;) {
      const role = fila.shift();
      if (!role) break;
      const definition = ROLES[role];
      const escolhido = await choose(
        io,
        `${definition.label} — ${roleHint(role, definition.requiresCli)}`,
        PROVIDERS,
        manterPadrao,
        `Enter mantém ${provider}`,
      );
      if (escolhido === manterPadrao) continue;
      const providerDoPapel = PROVIDERS[escolhido]?.label ?? provider;
      const proprio: { provider?: string; model?: string } = { provider: providerDoPapel };
      const escolha = await escolherModelo(io, providerDoPapel, `Modelo do ${role}`, deps.listModels ?? (async () => []));
      // Voltar aqui é voltar à escolha de provider DESTE papel.
      if (escolha === "voltar") {
        fila.unshift(role);
        continue;
      }
      if (escolha.modelo !== "") proprio.model = escolha.modelo;
      roles[role] = proprio;
    }
  }


  return { global, roles };
}

/**
 * O wizard curto: só o que faltou no comando que a pessoa digitou.
 *
 * Quem escreveu `capivara init --fresh` já disse o estágio, a pasta e o pedido.
 * Faltou dizer com que modelo — e recusar o comando inteiro por isso manda a
 * pessoa reescrever tudo. Aqui ela responde só o que falta e o comando segue.
 */
/** O wizard curto do pedido: quem esqueceu só ele. */
export async function runWizardDoPedido(deps: WizardDeps & { comando: string }): Promise<PedidoDoWizard | null> {
  deps.io.write(`\ncapivara ${deps.comando}: falta dizer o que construir.\n`);
  deps.io.write("O resto do comando está mantido; responda só isto.\n");
  try {
    return await perguntarPedido(deps, deps.cwd);
  } catch (error) {
    if (error instanceof InputEnded) return null;
    throw error;
  }
}

export async function runWizardDePapeis(
  deps: WizardDeps & { comando: string; faltando: readonly RoleName[] },
): Promise<EscolhaDePapeis | null> {
  const { io } = deps;
  const quais = deps.faltando.join(", ");
  io.write(`\ncapivara ${deps.comando}: falta dizer com que modelo rodar ${deps.faltando.length > 1 ? "os papéis" : "o papel"} ${quais}.\n`);
  io.write("O resto do comando está mantido; responda só isto.\n");

  try {
    return await perguntarPapeis(deps, deps.faltando);
  } catch (error) {
    // Ctrl-D ou entrada encerrada: quem desistiu de responder recebe a mensagem
    // completa de sempre, e não um stack trace.
    if (error instanceof InputEnded) return null;
    throw error;
  }
}

async function conduct(deps: WizardDeps): Promise<WizardResult | null> {
  const { io } = deps;
  io.write("capivara · monta o comando com você e imprime o equivalente no fim\n");

  const projectRoot = await text(io, `\nPasta do projeto [${deps.cwd}]: `, deps.cwd);
  if (!(await deps.directoryExists(projectRoot))) {
    io.write(`A pasta ${projectRoot} não existe. Crie-a e rode de novo.\n`);
    return null;
  }

  /*
   * O que já existe na pasta é o sinal mais forte de qual estágio vem agora: sem
   * esqueleto é `init`, com esqueleto e sem plano é `plan`, com plano é `build`.
   */
  const temEsqueleto = await deps.fileExists(`${projectRoot}/.capivara/init/skeleton.md`);
  const temPlano = await deps.fileExists(`${projectRoot}/.capivara/init/project-phases.md`);
  const comandos: Choice[] = [
    { label: "init", hint: "entrevista e desenha as fases do projeto até PLAN READY" },
    { label: "plan", hint: "detalha as fases que o init produziu, até RALPH READY" },
    { label: "build", hint: "constrói a aplicação a partir do plano pronto" },
    { label: "change", hint: "acrescenta ou altera funcionalidade numa aplicação que a capivara já construiu" },
    { label: "survey", hint: "lê uma aplicação que já existe e escreve o que ela faz, para reescrever depois" },
  ];
  /*
   * O `survey` fica por último e nunca é sugerido.
   *
   * Ele não faz parte da esteira: é a porta de entrada de quem tem código e não
   * tem documento. Sugerir por ausência de `.capivara/` confundiria com o
   * greenfield, que também não tem — e o wizard sugerindo errado custa mais caro
   * que o wizard não sugerindo.
   */
  const sugerido = temPlano ? 2 : temEsqueleto ? 1 : 0;
  const command = (["init", "plan", "build", "change", "survey"] as const)[await choose(io, "O que você quer fazer?", comandos, sugerido)] ?? "init";

  const answers: WizardAnswers = { command, global: {}, roles: {} };
  if (projectRoot !== deps.cwd) answers.projectRoot = projectRoot;

  /*
   * O `plan` normalmente não pergunta nada: o `init` registrou qual pedido
   * usou, e é por ele que o esqueleto é reencontrado. A pergunta só aparece em
   * projeto cujo `init` rodou antes desse registro existir — sem ela, o wizard
   * montaria um comando que morre antes da primeira chamada.
   */
  if (command === "plan" && !(await (deps.requestRecorded ?? (async () => true))(projectRoot).catch(() => true))) {
    io.write("\nEste projeto não registra qual pedido o init usou — aponte o mesmo arquivo de novo.\n");
    answers.requestFile = await arquivoDoPedido(deps, io, projectRoot);
  }

  if (command === "change") {
    /*
     * A mudança sempre tem pedido: é ela. As duas origens são as mesmas do
     * `init` — digitar ou apontar um arquivo —, e não há base aqui porque o que
     * manda é o que já está no projeto, não um pedido guardado em outro lugar.
     */
    const temPrompts = deps.listMcpPrompts !== undefined && deps.readMcpPrompt !== undefined;
    const fontes: Choice[] = [
      { label: "escrever agora", hint: "o que acrescentar ou alterar; várias linhas" },
      { label: "ler de um arquivo", hint: "um .md ou .txt já escrito" },
      ...(temPrompts ? [{ label: "prompt guardado na base", hint: "escolhe pelo nome entre os prompts já salvos" }] : []),
    ];

    const fonte = await choose(io, "De onde vem o pedido de mudança?", fontes, 0);
    // Só uma opção é condicional aqui, e ela é a última: a posição 2 é dela ou
    // de ninguém. Ainda assim o `temPrompts` é conferido, para o dia em que
    // outra entrar no meio.
    if (fonte === 2 && temPrompts) {
      const escolhido = await escolherPrompt(deps, io);
      if (escolhido === null) return null;
      answers.request = escolhido.texto;
      io.write(`\nprompt "${escolhido.nome}" carregado: ${escolhido.texto.split("\n")[0]?.slice(0, 70) ?? ""}…\n`);
    } else if (fonte === 1) {
      answers.requestFile = await arquivoDoPedido(deps, io, projectRoot);
    } else {
      const pedido = await multiline(io, "O que você quer mudar?");
      if (pedido === "") {
        io.write("Sem pedido não há o que mudar.\n");
        return null;
      }
      answers.request = pedido;
    }
  }

  if (command === "survey") {
    /*
     * A pasta já perguntada é a aplicação levantada — e ela nunca é escrita. O
     * levantamento sai para outro lugar, e o padrão é ao lado de onde o wizard
     * está rodando, nunca dentro do código de outra pessoa.
     */
    const saida = await text(io, `\nOnde gravar o levantamento [./levantamento]: `, "./levantamento");
    if (saida !== "./levantamento") answers.saida = saida;

    /*
     * A base é opcional por desenho: os arquivos locais são o piso, e o que ela
     * acrescenta é o caminho até o `init` da reescrita. Aqui não se escolhe
     * projeto — ele ainda não existe, e o nome dele sai da aplicação levantada.
     */
    if (deps.listMcpProjects) {
      const guardar: Choice[] = [
        { label: "sim", hint: "o levantamento vira um projeto lá, com o pedido de reescrita já rascunhado" },
        { label: "não", hint: "fica só nos arquivos locais" },
      ];
      if ((await choose(io, "Guardar também numa base documental?", guardar, 0)) === 0) {
        const sugerida = deps.defaultMcpUrl ?? "http://localhost:7777/mcp";
        for (;;) {
          const url = await text(io, `\nEndereço da base [${sugerida}]: `, sugerida);
          io.write("conectando…\n");
          try {
            await deps.listMcpProjects(url);
            answers.mcpUrl = url;
            break;
          } catch (erro) {
            io.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
            const saida: Choice[] = [
              { label: "tentar outro endereço" },
              { label: "seguir sem base", hint: "o levantamento fica nos arquivos locais" },
            ];
            if ((await choose(io, "E agora?", saida, 0)) === 1) break;
          }
        }
      }
    }
  }

  if (command === "init") {
    const pedido = await perguntarPedido(deps, projectRoot);
    if (pedido === null) return null;
    Object.assign(answers, pedido);
  }

  // Papéis: só os que ESTE comando chama. Perguntar pelo executor num init é
  // pedir uma decisão que não vai ser usada.
  const usados: RoleName[] =
    command === "build"
      ? ["builder", "verifier"]
      : command === "survey" || command === "change"
        ? ["writer"]
        : ["writer", "auditor", "verifier"];

  const papeis = await perguntarPapeis(deps, usados);
  answers.global = { ...answers.global, ...papeis.global };
  answers.roles = { ...answers.roles, ...papeis.roles };

  if (command === "build") {
    const comandoDeTeste = await text(io, "\nComando de teste do projeto (vazio detecta pelo manifesto): ");
    if (comandoDeTeste !== "") answers.testCommand = comandoDeTeste;

    const ciclos = await text(io, "Ciclos de correção por fase [3]: ", "3");
    if (/^\d+$/.test(ciclos) && Number(ciclos) !== 3) answers.maxCycles = Number(ciclos);
  }

  const rendered = renderCommand(answers);
  io.write(`\nComando equivalente:\n\n  ${rendered}\n\n`);

  return { answers, argv: toArgv(answers), command: rendered, execute: await yesNo(io, "Executar agora?", true) };
}
