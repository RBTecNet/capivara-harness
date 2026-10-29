# RC2: recuperação do `waiting` da execução TUI

Execução analisada: Python/TUI Linux, 34 requisitos e 47 unidades. O estado anterior tinha seis unidades concluídas e três bloqueios internos. Na captura de 29/10/2026 às 23:01 UTC, o CLI estava ativo com `status: working`, dez unidades concluídas e os três antigos bloqueadores integrados. A aplicação continua em construção e ainda não possui aceite final.

## Correções no motor

1. **Contexto excedido pelo inventário.** O pacote chegou a 248.710 caracteres para uma capacidade de 24.000. Centenas de arquivos de ambientes virtuais apareciam entre as alterações da entrega. A descoberta de fontes agora reconhece ambientes Python pelo protocolo `pyvenv.cfg`, inclusive em diretórios com nomes arbitrários; leituras explícitas de dependências continuam disponíveis. Inventários grandes têm recibo completo, privado e identificado por hash, com somente as fontes pertinentes apresentadas inline. Obrigações extensas também têm referências recuperáveis. O contexto real da unidade problemática foi remontado em 23.975 caracteres, com 843 fontes indexadas e cobertura explicitamente parcial.
2. **Acesso efetivo aos fragmentos.** Os recibos são legíveis pelas ferramentas dos agentes de API, com verificação de hash e seleção por JSON Pointer ou faixa de linhas. Isso evita que o caminho fornecido pelo coordenador seja recusado como estado de controle. Configuração e snapshots do harness continuam fora desse acesso; a leitura não concede escrita nos recibos.
3. **Timeout com código preservado.** Uma chamada de dez minutos havia gravado seis arquivos e retornado resultado parcial. O executor a tratava como transporte sem progresso e suspendia a unidade. Agora alterações medidas no disco após falha de transporte recuperável seguem para checagem e revisão independente. A falha original permanece registrada; arquivos escritos não constituem aprovação automática.
4. **Dependência ausente no DAG.** O catálogo mencionava o provedor nas instruções, mas não o tinha como pré-requisito. A execução chegou ao revisor sem essa entrega disponível. A reconciliação de dependências agora tem escopo próprio: adiciona relações e interfaces existentes, rejeita referências inexistentes e ciclos e preserva critérios, receitas, requisitos e propriedade de arquivos. O processo real acrescentou a dependência e as entradas de leitura pertinentes.
5. **Proposta privada desatualizada.** Uma mudança do contrato podia descartar a área com o trabalho parcial, ou conservar uma área anterior à publicação do novo pré-requisito. Agora o checkpoint é preservado e entradas publicadas são atualizadas contra sua base. Alterações privadas concorrentes geram reconciliação; não são sobrescritas. Entradas removidas também são refletidas na área isolada.
6. **Parecer com evidências estruturadas.** Uma reprovação apontava a área afetada como diretório e trazia arquivos e coordenadas numa lista de evidências. O motor perdia essa lista ao normalizar o parecer e tentava ler o diretório como fonte. As citações agora são preservadas e confrontadas com recibos atuais. A reprovação material segue para correção; referências antigas ou inválidas continuam sem autorizar edição.
7. **Reconciliação sem prioridade.** O scheduler podia lançar uma nova tarefa após cada conclusão e adiar indefinidamente a integração ou reconciliação pendente. Agora trabalhos já ativos são drenados antes de selecionar outra rodada quando há coordenação pendente. Uma proposta inconclusiva também retorna à seleção de trabalho executável, em vez de encerrar o processo no coordenador.
8. **TUI exigida de um catálogo interno.** Um requisito de pesquisa estava associado ao catálogo, e a navegação consumia seu contrato sem repetir esse identificador. O cálculo considerava somente os IDs diretos e exigia interação TUI antes da construção da própria navegação. Os contratos e o DAG agora identificam a contribuição parcial. A obrigação de interação permanece no aceite integrado; o motor não inventa um proprietário final nem transforma uma prova de API em prova TUI. A identidade da unidade inclui suas obrigações atuais de interface.
9. **Diagnóstico operacional antigo sobrepondo a recuperação.** Uma reconciliação de instrumento salva podia impedir a checagem de arquivos já utilizáveis após a correção do contrato. O executor dá uma tentativa registrada às verificações locais atuais antes de repetir o planejamento. A chave persiste com causa, entrada e protocolo; não é um retry ilimitado da mesma operação. As provas e o parecer continuam obrigatórios para concluir a unidade.

## Validação

Build e typecheck passaram. Os cenários focados abaixo passaram juntos: 29 testes em 3,00 segundos, incluindo processos reais, importação do provedor publicado, preservação do código parcial, conflito sem sobrescrita, remoção de entrada, leitura de recibo pela ferramenta de API e manutenção da dívida de prova TUI.

```sh
npx vitest run --config packages/core/vitest.config.ts \
  packages/core/test/execution/progress-timeout-recovery.spec.ts \
  packages/core/test/execution/task-context.spec.ts \
  packages/core/test/execution/source-review.spec.ts \
  packages/core/test/domain/interface-obligations.spec.ts
```

As regressões de inventário, timeout com arquivos, acesso ao recibo, prioridade do coordenador, seleção após proposta inconclusiva, recuperação operacional e atribuição de interface foram observadas falhando antes das respectivas correções. As respostas de agente controladas nesses testes isolam as transições do motor; não medem a qualidade de um modelo real.

A validação no projeto foi feita pelo CLI instalado:

```sh
capivara build --project ~/Documentos/Projetos/testes_capivara/samba_admin --no-dashboard
```

Os antigos bloqueadores `task-slice-runtime-packaging`, `task-directory-provider` e `task-directory-group-catalog` chegaram a `complete`. O provedor teve um defeito material de confirmação de grupo corrigido pelo editor, e o catálogo de grupos teve sua funcionalidade implementada após a disponibilização do provedor. Os arquivos do produto foram alterados pelas chamadas normais do harness; o banco de estado não foi editado manualmente.

Houve uma troca controlada do processo usado na validação para carregar a correção de interface e a nova prioridade. Ela ocorreu num checkpoint, com nove unidades integradas e zero chamadas de agente ativas. A unidade de instalação permaneceu em `checking` com sua edição preservada. O registro contém essa troca; não representa uma execução ininterrupta desde o estado inicial.

## Evidências e limites

- [Estado antes/depois e chamadas observadas](rc2-evidence/tui-waiting-control-20261029.json).
- [Captura da execução, papéis, tempos, invocações e ressalvas](rc2-evidence/tui-waiting-recovery-20261029.json).

Na captura havia 24 invocações adicionais de agentes: 12 de revisão, oito de reparo, três de implementação inicial e uma de planejamento. O intervalo inclui investigação, as primeiras tentativas com a regra antiga de interface e construção de funcionalidades. Uma invocação CLI pode conter várias interações internas com o provedor. Não há preço informado nem demonstração de redução financeira neste intervalo.

O build continua ativo após a captura, portanto seus contadores podem avançar. Faltam unidades de implementação e validação do produto; este relatório não certifica a aplicação inteira, o AD real, todas as stacks ou uma taxa geral de recuperação de 99%. A prioridade da coordenação foi corrigida; tarefas com escopo de escrita aberto continuam sujeitas à política conservadora de conflitos.

A versão instalada permanece `0.9.0-rc2`. O SHA-256 do CLI instalado é igual ao build local: `0a39d9f036e94ac702b3988bf81efc4be9a81dd4d8425d2e0c7069e3ca13c658`.
