# Backend da Lavanderia Digital APMBB V2

Cloud Functions v2 em TypeScript, Node.js 22 e região `southamerica-east1`. A configuração aponta para `lavanderia-digital-apmbb-v2`. As funções ficam desativadas por padrão com `LAUNDRY_OPERATIONS_ENABLED=false`.

## Validação local

Use Node.js 22, Java 25 e Firebase CLI. A partir da raiz:

```sh
npm --prefix functions ci
npm --prefix functions run typecheck
npx --yes firebase-tools@15.37.0 emulators:exec --project demo-lavanderia --only firestore "npm --prefix functions test"
```

A suíte limpa o banco emulado de `demo-lavanderia` antes de cada teste. Para explorar as funções localmente, gere o JavaScript com `npm --prefix functions run build`, adicione `LAUNDRY_OPERATIONS_ENABLED=true` ao arquivo ignorado `functions/.env.local` e execute os emuladores com `--project demo-lavanderia --only auth,firestore,functions`. Com os emuladores em execução, use `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node functions/lib/src/seed.js demo-lavanderia` para inicializar as máquinas. Crie contas sintéticas no emulador de Auth, verifique seus e-mails e cadastre seus UIDs na coleção de autorização do Firestore emulado.

## Coleções e acesso

| Caminho | Conteúdo |
| --- | --- |
| `usuariosAutorizados/{uid}` | Cadastro mantido por operador privilegiado, com `enabled: true` e `role: student` ou `role: admin`. O UID vem do Firebase Authentication. |
| `maquinas/{id}` | Metadados e estado da BRASTEMP (`brastemp`), LG (`lg`) e ELETROLUX (`eletrolux`). |
| `maquinas/{id}/ativas/{uid}` | Referência à única inscrição ativa do aluno na máquina. |
| `inscricoes/{id}` | Histórico de inscrições e estado atual, com ordem e datas registradas pelo servidor. |
| `auditoria/{id}` | Eventos de operação gravados na mesma transação, com máquina, horário, inscrição e UID do operador quando aplicável. |
| `notificacoes/{id}` | Caixa de saída para convocações, identificada pelo ID da inscrição. |

As regras bloqueiam leituras e escritas diretas de qualquer cliente. As funções consultam a autorização no Firestore dentro da transação e exigem sessão com e-mail verificado. A função administrativa também exige `role: admin` no cadastro do backend. A claim usada pela interface existente serve apenas à navegação. Após a integração do frontend, mantenha os dois cadastros coerentes enquanto essa interface usar a claim.

## Operações

As funções callable recebem `machineId`. O frontend desta etapa continua sem executar operações de fila.

- `entrarNaFila` devolve `entryId`. Uma sequência por máquina define a ordem FIFO de inscrições confirmadas, mesmo com solicitações concorrentes. A primeira inscrição é convocada automaticamente se a máquina está livre.
- `consultarMinhaFila` devolve o estado de manutenção e a posição do próprio aluno. A posição 1 é a inscrição convocada ou em andamento, ou a primeira da fila quando pausada e sem ciclo corrente.
- `cancelarInscricao`, `iniciarCiclo` e `terminarCiclo` exigem o `entryId` ativo do próprio aluno. Cancelar uma inscrição convocada ou concluir um ciclo libera a máquina e convoca a próxima pessoa.
- `definirManutencao` exige `enabled` booleano. Em manutenção, a máquina bloqueia novos ingressos, convocações e inícios. Um ciclo em andamento ainda pode terminar. Uma convocação já emitida pode ser cancelada ou expirar. A saída de manutenção retoma a ordem da fila.
- `expirarConvocacoes` verifica as três máquinas a cada minuto. O início é recusado a partir do prazo de 10 minutos, mesmo que a próxima execução do agendador ainda não tenha ocorrido. A expiração retira a inscrição ativa e convoca a próxima pessoa em uma única transação.
- Nesta versão, ciclos iniciados dependem do término pelo próprio aluno. Antes de um piloto, defina como a operação tratará abandono ou revogação de autorização durante um ciclo.

O processamento de e-mail ainda fica desacoplado. `processCallNotification` usa uma caixa de saída criada junto com a convocação e uma chave estável por inscrição. Antes de ligar um worker, implemente a resolução do destinatário no Auth e um provedor que deduplique envios concorrentes e retentativas pela chave, inclusive se o processo falhar após o envio e antes de registrar `sent`. Guarde credenciais no Secret Manager. Não há worker, provedor ou envio de e-mail operacional nesta versão.

## Implantação futura e custos

Após revisão, valide as regras e o índice no ambiente de teste, prepare as autorizações por UID e revise as permissões IAM da identidade de execução. O seed é idempotente e preserva o estado já registrado. Para produção, uma execução manual após aprovação requer credenciais ADC com acesso ao Firestore e o comando `node functions/lib/src/seed.js lavanderia-digital-apmbb-v2 --apply-production`.

A sequência de implantação, quando autorizada, é aplicar `firestore:rules,firestore:indexes` no projeto explícito, aguardar o índice ficar disponível, inicializar as máquinas e implantar `functions` mantendo a chave de operação desativada. Em um projeto já em uso, revise o impacto das regras de negação antes de aplicá-las. Só habilite `LAUNDRY_OPERATIONS_ENABLED` em uma etapa posterior, com validação de ponta a ponta.

A implantação de Cloud Functions v2 normalmente exige o plano Blaze. Considere custos de execução e rede do Cloud Run, Cloud Build e Artifact Registry, um job do Cloud Scheduler e leituras, gravações, armazenamento e índices do Firestore. A rotina por minuto e a consulta de posição também consomem leituras quando habilitadas. Um provedor de e-mail e o Secret Manager podem gerar custos adicionais. Configure alertas de orçamento e revise retenção de auditoria e notificações antes do piloto. Alertas de orçamento não limitam gastos.
