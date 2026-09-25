/**
 * A decisão de banco, perguntada pelo harness e não pelo modelo.
 *
 * Todas as outras perguntas da entrevista são levantadas por quem escreve: ele
 * lê o pedido e descobre o que ficou ambíguo. Esta não. O banco é a única
 * decisão que o executor não consegue tomar e não consegue contornar — sem
 * conexão ele inventa uma, e uma conexão inventada faz o gate passar contra
 * nada. Perguntar isso não pode depender de o modelo lembrar de perguntar.
 *
 * Ela entra na MESMA fila das outras: é respondida, classificada, gravada no
 * handoff e vira decisão do desenvolvedor pelo caminho de sempre. O que o
 * harness faz por conta própria é traduzir a escolha em regras transversais do
 * esqueleto, do mesmo jeito que os não-objetivos entram — depois do parser, onde
 * nada pode reescrevê-las.
 *
 * Nenhuma das regras carrega credencial, e nenhuma manda alguém preparar o
 * ambiente na mão: o `.env` é do desenvolvedor, o `.env.example` é do projeto, e
 * os gates nunca tocam o banco de destino.
 */

import type { Answer, Question } from "./types.js";
import { latestAnswers } from "./rounds.js";
import type { SkeletonRule } from "../contract/index.js";

export const ID_DO_BANCO = "banco-de-dados";

export type DecisaoDeBanco = "embutido" | "informado" | "instalado" | "sem-banco" | "indefinida";

const EMBUTIDO = "Ainda não existe: o projeto cria o dele, embutido em arquivo";
const INFORMADO = "Já existe um servidor: eu informo a conexão no .env";
const INSTALADO = "Instale um servidor nesta máquina durante o build";
const SEM_BANCO = "A aplicação não guarda dados";

const ROTULOS: Record<string, DecisaoDeBanco> = {
  [EMBUTIDO]: "embutido",
  [INFORMADO]: "informado",
  [INSTALADO]: "instalado",
  [SEM_BANCO]: "sem-banco",
};

/**
 * Os servidores que um pedido costuma nomear.
 *
 * A lista é curta e nomeada de propósito: ela não decide nada, só muda a
 * EVIDÊNCIA e a RECOMENDAÇÃO da pergunta. Quem decide continua sendo quem
 * responde.
 */
const SERVIDORES: readonly { padrao: RegExp; nome: string }[] = [
  { padrao: /\bmysql\b|\bmariadb\b/i, nome: "MySQL" },
  { padrao: /\bpostgres(?:ql)?\b/i, nome: "PostgreSQL" },
  { padrao: /\boracle\b/i, nome: "Oracle" },
  { padrao: /\bsql\s*server\b|\bsqlserver\b/i, nome: "SQL Server" },
  { padrao: /\bmongo(?:db)?\b/i, nome: "MongoDB" },
];

/** O servidor que o pedido já nomeou, quando nomeou algum. */
export function bancoNoPedido(request: string): string | null {
  return SERVIDORES.find((servidor) => servidor.padrao.test(request))?.nome ?? null;
}

/**
 * A pergunta, com a evidência e a recomendação lidas do pedido.
 *
 * A primeira versão desta pergunta era fixa, e cometeu o erro que o harness
 * proíbe em toda pergunta de entrevista: perguntar o que já estava respondido.
 * No `assitencia` o pedido dizia, com todas as letras, "vamos usar banco de
 * dados mysql remoto ou seja, não será instalado localmente, para testes o
 * agente deverá usar SQLite" — e a pergunta ofereceu "o projeto cria o dele,
 * embutido em arquivo" COMO RECOMENDADA. O desenvolvedor respondeu "1", que é
 * aceitar a recomendação, e a decisão gravada passou a contradizer o pedido.
 *
 * O esqueleto saiu com as duas coisas: MySQL na stack, porque o pedido manda, e
 * banco embutido nas regras transversais, porque a decisão mandava. Dezoito
 * fases foram escritas sobre essa contradição.
 */
export function perguntaDoBanco(request = ""): Question {
  const servidor = bancoNoPedido(request);

  return {
    ...PERGUNTA_BASE,
    ...(servidor === null
      ? {}
      : {
          evidence:
            `O pedido já nomeia ${servidor}. O que ele não diz é de onde esse servidor vem: se já existe e ` +
            `você informa a conexão, ou se ele deve ser instalado nesta máquina durante o build.`,
          recommended: INFORMADO,
          recommendationBasis:
            `O pedido escolheu ${servidor}, e o pedido é a autoridade acima de tudo: o que falta é a conexão, ` +
            `que é sua. Responder outra coisa aqui contraria o que você mesmo escreveu, e o esqueleto sai com ` +
            `as duas versões brigando.`,
        }),
  };
}

const PERGUNTA_BASE: Question = {
  id: ID_DO_BANCO,
  topic: "Banco de dados",
  evidence:
    "Esta é a única decisão que o executor não consegue tomar sozinho: ele não pode adivinhar uma conexão, " +
    "e não pode instalar um servidor sem você saber.",
  decision: "De onde vem o banco desta aplicação?",
  why:
    "Ela muda o que o projeto entrega e contra o que os testes rodam. Em qualquer resposta, a conexão fica " +
    "no seu .env (nunca versionado), o projeto entrega um .env.example sem credencial e um comando de " +
    "migração que cria o esquema do zero — e os testes do harness rodam sempre contra um banco descartável, " +
    "nunca contra o seu. Se o pedido já disser qual banco usar, a resposta precisa ser a que combina com ele.",
  options: [
    {
      label: EMBUTIDO,
      consequence:
        "O projeto carrega o próprio banco em arquivo (SQLite ou equivalente da stack), criado por ele na " +
        "primeira execução. Nada a instalar, nada a configurar, e os testes rodam contra uma cópia descartável.",
    },
    {
      label: INFORMADO,
      consequence:
        "O projeto lê host, porta, usuário, senha e base de variáveis de ambiente, e você preenche o .env " +
        "quando quiser apontá-lo para o seu servidor. Nenhuma credencial entra em código, documento ou log, " +
        "e o comando de migração cria o esquema lá quando você mandar.",
    },
    {
      label: INSTALADO,
      consequence:
        "O executor instala e sobe o servidor nesta máquina durante o build. Se a instalação não for " +
        "permitida aqui, o harness pára dizendo o que falta, em vez de contornar com outro banco.",
    },
    {
      label: SEM_BANCO,
      consequence: "Nenhuma fase cria esquema, migração ou .env: a aplicação não persiste nada entre execuções.",
    },
  ],
  recommended: EMBUTIDO,
  recommendationBasis:
    "Um banco embutido é o único que roda igual na sua máquina, na do colega e no gate — e ele não impede " +
    "trocar por um servidor depois, porque a conexão já vem do .env desde o primeiro dia.",
};

/** A pergunta sem pedido nenhum: o que os testes e a retomada usam. */
export const PERGUNTA_DO_BANCO: Question = PERGUNTA_BASE;

export function decisaoDeBanco(questions: readonly Question[], answers: readonly Answer[]): DecisaoDeBanco {
  const pergunta = questions.find((question) => question.id === ID_DO_BANCO || question.id.endsWith(`:${ID_DO_BANCO}`));
  if (!pergunta) return "indefinida";

  const resposta = latestAnswers(answers).get(pergunta.id);
  if (!resposta || resposta.disposition !== "ACCEPTED") return "indefinida";

  return ROTULOS[resposta.decision] ?? "indefinida";
}

/**
 * As regras transversais que a escolha implica.
 *
 * Quatro delas valem para qualquer banco, e é de propósito: o `.env`, o
 * `.env.example`, a migração do zero e o banco descartável dos testes são o
 * mesmo padrão que o Laravel ensinou a uma geração inteira, e é o que permite
 * ao harness verificar o produto sem nunca abrir o banco de quem o encomendou.
 *
 * `indefinida` não produz regra nenhuma. Uma decisão que o desenvolvedor não
 * tomou não vira regra escrita como se ele tivesse tomado — é o mesmo princípio
 * dos não-objetivos.
 */
export function regrasDeBanco(decisao: DecisaoDeBanco): SkeletonRule[] {
  if (decisao === "sem-banco" || decisao === "indefinida") return [];

  const comuns: SkeletonRule[] = [
    {
      subject: "configuração do banco",
      /*
       * "Arquivo versionado" era impossível de verificar, e cobrou a conta.
       *
       * Esta regra vira critério de aceite em toda fase de dados, e no `assitencia`
       * o verificador do gate 3 devolveu, com toda a razão: *"a árvore não contém
       * metadados de versionamento para confirmar que os arquivos versionados não
       * incluem credenciais reais"*. O projeto não tinha repositório Git, e nenhuma
       * implementação podia provar aquilo — uma task correta reprovada por uma
       * pergunta que nós escrevemos sem resposta possível.
       *
       * O conserto é dizer a mesma coisa em termos de ARQUIVO, que se abre e se lê:
       * o `.env` é o único lugar com credencial, e ele está no `.gitignore`. Isso é
       * verificável com ou sem git, o que importa porque a regra não pode depender
       * de o desenvolvedor ter versionado o projeto. O build passou a criar o
       * repositório em pasta nova (§75), e mesmo assim esta regra não volta a
       * depender disso: o custo de errar é alto e o ganho de citar versionamento era
       * zero.
       */
      statement:
        "toda a conexão do banco — host, porta, usuário, senha e nome da base — é lida de variáveis de " +
        "ambiente, carregadas de um arquivo `.env` na raiz; o `.env` é o ÚNICO arquivo do projeto que pode " +
        "conter credencial e está listado no `.gitignore` desde a primeira fase. Nenhum outro arquivo da " +
        "árvore — código, configuração, documento, exemplo, script, teste ou log — contém senha, token ou " +
        "string de conexão real, e isso se confere abrindo os arquivos",
    },
    {
      subject: ".env.example",
      statement:
        "o projeto versiona um `.env.example` com TODAS as variáveis que ele lê, cada uma com valor de " +
        "exemplo inofensivo e nunca uma credencial real; quando uma fase passa a ler uma variável nova, ela " +
        "acrescenta a variável ao `.env.example` na mesma fase",
    },
    {
      subject: "o exemplo precisa RODAR",
      statement:
        "copiar o `.env.example` para `.env` tem de deixar a aplicação de pé e utilizável sem mais nenhuma " +
        "configuração: ele aponta para o banco descartável, nunca para um servidor de mentira. As variáveis do " +
        "servidor de produção ficam documentadas ali ao lado, comentadas ou claramente opcionais — quem for " +
        "usar o servidor preenche e descomenta. É esse arquivo que sobe a aplicação para os testes de fluxo, e " +
        "um exemplo que não conecta é uma aplicação que não abre",
    },
    {
      subject: "comando de migração",
      statement:
        "o projeto entrega um comando único de migração que cria o esquema inteiro a partir de um banco " +
        "vazio e pode ser repetido sem erro; criar ou alterar esquema fora desse comando é proibido, e é ele " +
        "que o desenvolvedor roda depois de preencher o `.env`",
    },
    {
      subject: "banco dos testes",
      statement:
        "a suíte automatizada e os fluxos rodam contra um banco descartável, criado e destruído pela própria " +
        "execução dos testes; nenhum teste lê, escreve ou migra o banco configurado no `.env` do desenvolvedor",
    },
    {
      subject: "a aplicação escolhe o banco pelo ambiente",
      statement:
        "a origem do banco é uma variável de ambiente, e o banco DESCARTÁVEL é uma das origens que a " +
        "APLICAÇÃO aceita — não só a suíte dela. Subir a aplicação com o `.env.example`, numa máquina sem " +
        "servidor de banco nenhum instalado, tem de funcionar: é assim que os fluxos são percorridos, num " +
        "navegador, contra o produto de pé. Um produto que só conecta no servidor de produção não pode ser " +
        "aberto em máquina que não tenha esse servidor, e a verificação que mais importa deixa de existir",
    },
  ];

  const especifica: Record<Exclude<DecisaoDeBanco, "sem-banco" | "indefinida">, SkeletonRule> = {
    embutido: {
      subject: "origem do banco",
      statement:
        "o banco da aplicação é embutido em arquivo (SQLite ou o equivalente da stack escolhida), criado pelo " +
        "próprio projeto na primeira execução; nada é instalado fora da pasta do projeto",
    },
    informado: {
      subject: "origem do banco",
      statement:
        "o servidor de banco já existe e é o desenvolvedor quem informa a conexão no `.env`; nenhuma fase " +
        "inventa credencial, nenhuma fase escolhe um banco diferente para contornar a ausência dela, e a " +
        "aplicação falha com mensagem clara quando uma variável obrigatória não está definida",
    },
    instalado: {
      subject: "origem do banco",
      statement:
        "o servidor de banco é instalado e iniciado nesta máquina durante o build, com a conexão resultante " +
        "escrita no `.env` local e documentada no `.env.example`; se a instalação não for permitida no " +
        "ambiente, a fase pára dizendo o que falta em vez de trocar por outro banco",
    },
  };

  return [especifica[decisao], ...comuns];
}
