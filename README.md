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
- Os avisos de convocação, expiração e manutenção aparecem no painel. O Firebase Authentication ainda envia o e-mail de verificação de conta. O sistema de filas não envia notificações externas.

## Cotas do Spark

Cada fila aceita até 25 posições pendentes, incluindo cancelamentos que ainda estejam à frente de posições válidas. A interface usa listeners no lugar de consultas periódicas. Cada conta autorizada escuta os três documentos de máquina e seus próprios ponteiros. A consulta de posição é limitada a 25 tickets e existe apenas enquanto a conta tiver uma inscrição aguardando atrás da primeira posição. Firestore pode cobrar leituras da cota por resultados iniciais, mudanças, reconexões e documentos consultados nas regras. Revise o consumo no console e organize a retenção do histórico antes do uso regular. Cotas esgotadas podem deixar o serviço indisponível até a renovação.

## Revisão e publicação

As filas ficam desativadas em builds sem `VITE_FIREBASE_SPARK_ENABLED=true`. O novo esquema usa uma coleção própria. Registros do protótipo anterior ficam fora das regras e da interface atuais. O workflow atual valida o build e permite a publicação manual do site no GitHub Pages. Ele não aplica regras nem ativa filas.

Para uma futura ativação revisada, registre o app Web no projeto Firebase, configure o provedor E-mail/senha e preencha as seis variáveis `VITE_FIREBASE_*` do app Web listadas em `.env.example`. Essas variáveis são públicas no bundle. Cadastre os UIDs autorizados no console do Firestore e crie, para cada ID de máquina, um documento em `filasSpark` com `head: 1`, `tail: 0`, `phase: "idle"`, `calledAt: null` e `maintenance: false`. Revise as regras no emulador antes de aplicar `firestore.rules` ao projeto real. A publicação futura com filas exige uma alteração deliberada do workflow para fornecer a variável de ativação ao build. Use o plano Spark e mantenha o caminho `/lavanderia-apmbb-v2/` no GitHub Pages.

Substitua o espaço reservado no cabeçalho pelo brasão original quando o arquivo autorizado estiver disponível.
