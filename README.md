# Lavanderia Digital APMBB V2

Portal React e TypeScript para a Lavanderia Digital da Academia de Polícia Militar do Barro Branco. O GitHub Pages hospeda o frontend. A aplicação usa Firebase Authentication por e-mail e senha e Cloud Firestore no projeto `lavanderia-digital-apmbb-v2`. O fluxo foi projetado para o plano Spark, com operações iniciadas pelo navegador e validadas pelas regras do Firestore.

## Desenvolvimento com emuladores

Use Node.js 24, npm e Java 25. A partir da raiz:

```sh
npm ci
npx --yes firebase-tools@15.37.0 emulators:start --project demo-lavanderia --only auth,firestore
```

Em outro terminal, prepare o Firestore emulado e inicie o Vite:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-spark.mjs
VITE_FIREBASE_USE_EMULATORS=true npm run dev
```

Abra a URL do Vite sob `/lavanderia-apmbb-v2/`. Cadastre uma conta fictícia, abra o link de verificação impresso no terminal do emulador de Auth e confirme na interface. Consulte o UID da conta na resposta do emulador ou em `http://127.0.0.1:9099/emulator/v1/projects/demo-lavanderia/accounts` e autorize apenas esse UID no emulador:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-spark.mjs UID_FICTICIO student
```

Use `admin` para uma segunda conta fictícia que precise testar manutenção. O script só acessa o Firestore local e preserva as máquinas existentes. Você pode pôr `VITE_FIREBASE_USE_EMULATORS=true` em `.env.development.local`. Builds e previews sempre ignoram essa opção.

## Testes

```sh
npx --yes firebase-tools@15.37.0 emulators:exec --project demo-lavanderia-tests --only firestore "npm test"
npm run typecheck
npm run build
```

Os testes usam o SDK Web, regras reais e identidades sintéticas do emulador. A suíte limpa somente o projeto emulado `demo-lavanderia-tests`. Cobre concorrência, filas independentes, duplicidade, fraude, escopo de leitura, permissão administrativa, manutenção, expiração e liberação de um ciclo abandonado e atualização de posições em tempo real.

## Filas e autorização

- `usuariosAutorizados/{uid}` contém `enabled: true` e `role: student` ou `role: admin`. O único acesso pelo site é a leitura do próprio documento com e-mail verificado. Um operador autorizado com acesso IAM gerencia esses registros pelo console do Firebase. O papel administrativo no site permite manutenção e liberação de ciclos abandonados.
- `filasSpark/{id}` mantém uma fila independente para `brastemp`, `lg` e `eletrolux`. O cliente usa transações para alterar o estado. As regras exigem incrementos unitários e consistência entre os documentos escritos no mesmo commit. Cancelamentos preservam a ordem de todos os demais tickets.
- `filasSpark/{id}/ativas/{uid}` guarda o número da última inscrição do usuário. As regras só aceitam uma nova inscrição quando o ticket anterior estiver em estado terminal. O ticket é terminal mesmo que o ponteiro permaneça no documento.
- `filasSpark/{id}/tickets/{number}` guarda número, status e horário de encerramento. Os tickets consultáveis por alunos autorizados não contêm UIDs nem endereços de e-mail. O site escuta os tickets anteriores apenas quando precisa calcular a posição do próprio aluno.
- O horário de convocação deve coincidir com `request.time`, e as regras só aceitam início antes de `calledAt + 10 minutos`. O contador no site usa o horário do dispositivo para estimar o tempo restante. A estimativa pode divergir com o relógio desajustado. As regras decidem se o início, o cancelamento de uma convocação e a expiração são permitidos.
- Depois de uma operação, o site tenta convocar o primeiro ticket disponível. Um usuário autorizado também pode escolher **Atualizar fila** ou **Verificar expiração**. O servidor garante o prazo mesmo com todo mundo offline. O registro da expiração e a próxima convocação esperam uma interação online. Se for preciso liberar um ciclo que já começou e foi abandonado, um administrador pode fazê-lo dentro do site.
- Os avisos de convocação, expiração e manutenção aparecem no painel. O Firebase Authentication ainda envia o e-mail de verificação de conta. Os avisos externos têm uma integração opcional e desativada por padrão. Consulte [Notificações por e-mail](notifications/README.md).

## Duração dos ciclos

Ao iniciar um ciclo, informe a duração prevista em minutos inteiros. A faixa inicial é de 5 a 180 minutos. Para alterá-la, atualize os limites em `src/services/sparkQueue.ts`, `firestore.rules` e nos testes e publique as regras e o site de forma coordenada. A atualização das regras exige o novo cliente para iniciar ciclos. Planeje a troca durante uma janela sem uso e recarregue os clientes abertos. Ciclos que já estavam em andamento sem previsão continuam podendo ser encerrados.

A transação grava o início com o horário do servidor, além da duração e da previsão de término. As regras comparam a previsão proposta com o início mais a duração e aceitam uma diferença de até 30 segundos para acomodar a latência e a diferença de relógio. Se o início for recusado com a convocação válida, confira o horário automático do dispositivo e tente novamente. O contador usa a previsão gravada e o relógio do dispositivo. Quando aparece **Tempo previsto encerrado**, o aluno ainda deve clicar em **Terminar ciclo** para liberar a máquina.

## Cotas do Spark

Cada fila aceita até 25 posições pendentes, incluindo cancelamentos que ainda estejam à frente de posições válidas. A interface usa listeners no lugar de consultas periódicas. Cada conta autorizada escuta os três documentos de máquina e seus próprios ponteiros. A consulta de posição é limitada a 25 tickets e existe apenas enquanto a conta tiver uma inscrição aguardando atrás da primeira posição. Firestore pode cobrar leituras da cota por resultados iniciais, mudanças, reconexões e documentos consultados nas regras. Revise o consumo no console e organize a retenção do histórico antes do uso regular. Cotas esgotadas podem deixar o serviço indisponível até a renovação.

## Revisão e publicação

O GitHub Pages publica manualmente a branch `main` pelo workflow **Build e publicação no GitHub Pages**. O build usa a configuração do app Web Firebase fornecida pelas seis variáveis listadas em `.env.example`. Esses valores são públicos no bundle. O site publicado usa o Firebase do projeto, com os emuladores restritos ao servidor de desenvolvimento local.

### Habilitar ou desabilitar as filas

1. No repositório do GitHub, abra **Settings → Secrets and variables → Actions → Variables**. Em **Repository variables**, crie ou edite `VITE_FIREBASE_SPARK_ENABLED`.
2. Para habilitar, salve exatamente `true`, em minúsculas e sem espaços. Para desabilitar, salve `false` ou remova a variável. Um valor ausente, vazio ou diferente de `true` mantém as filas desativadas no build.
3. Após salvar a configuração, abra **Actions → Build e publicação no GitHub Pages → Run workflow**, selecione `main` e clique em **Run workflow**. Aguarde a conclusão da publicação e confira o estado das filas no site. Repita a publicação manual sempre que alterar a variável, pois o valor é incorporado ao bundle durante o build.

A ativação usa o plano Spark, as regras do Firestore já publicadas, os documentos `brastemp`, `lg` e `eletrolux` da coleção `filasSpark` e as contas já autorizadas. Registros do protótipo anterior ficam fora das regras e da interface atuais.

Substitua o espaço reservado no cabeçalho pelo brasão original quando o arquivo autorizado estiver disponível.
