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

export const PERGUNTA_DO_BANCO: Question = {
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
    "nunca contra o seu.",
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
      statement:
        "toda a conexão do banco — host, porta, usuário, senha e nome da base — é lida de variáveis de " +
        "ambiente, carregadas de um arquivo `.env` na raiz; nenhum arquivo versionado, documento ou log " +
        "contém credencial, e `.env` está no `.gitignore` desde a primeira fase",
    },
    {
      subject: ".env.example",
      statement:
        "o projeto versiona um `.env.example` com TODAS as variáveis que ele lê, cada uma com valor de " +
        "exemplo inofensivo e nunca uma credencial real; quando uma fase passa a ler uma variável nova, ela " +
        "acrescenta a variável ao `.env.example` na mesma fase",
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
