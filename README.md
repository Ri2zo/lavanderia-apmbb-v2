# Lavanderia Digital APMBB V2

Estrutura inicial do portal da Lavanderia Digital da Academia de Polícia Militar do Barro Branco. Inclui cadastro, login, verificação de e-mail e telas iniciais de máquinas e administração. As telas das máquinas exibem BRASTEMP (lavadora), LG (lava e seca) e ELETROLUX (secadora). O backend inicial de filas e manutenção está em `functions/`. O frontend ainda exibe as telas iniciais, sem chamadas operacionais.

## Desenvolvimento local

Use Node.js 24 e npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Abra o endereço informado pelo Vite, com o caminho `/lavanderia-apmbb-v2/`. A tela de acesso também pode ser inspecionada sem configurar o Firebase.

## Configuração do Firebase

1. No projeto `lavanderia-digital-apmbb-v2`, registre um aplicativo Web e preencha as variáveis `VITE_FIREBASE_*` de `.env.local` com a configuração do SDK.
2. Em Authentication, habilite o provedor E-mail/senha. Autorize os domínios usados pelo app conforme a configuração do Firebase, incluindo `localhost` para desenvolvimento e o domínio efetivo do GitHub Pages para publicação. Use contas de teste para validar cadastro e confirmação de e-mail.
3. Para validar a tela administrativa, a conta de teste deve ter e-mail verificado e a custom claim `admin: true` configurada por um administrador via SDK Admin. Renove a sessão após atribuir a claim.
4. `firestore.rules` nega todo acesso dos clientes. `firebase.json` referencia esse arquivo e `.firebaserc` identifica o projeto. Revise as regras antes de qualquer aplicação manual, pois elas bloqueiam as leituras e escritas de clientes do projeto.

A configuração Web do Firebase é incorporada ao bundle. Mantenha credenciais privadas e dados pessoais fora de variáveis `VITE_*` e do repositório. Consulte [a documentação do backend](functions/README.md) para APIs, emuladores, testes, implantação futura e custos.

## Verificações

```sh
npm run typecheck
npm run build
npm run preview
```

## GitHub Pages

O workflow valida pull requests e alterações na branch `main`. Quando for autorizado publicar, selecione **GitHub Actions** como fonte em **Settings → Pages**, configure as seis variáveis de repositório listadas em `.env.example` e execute manualmente o workflow **Build e publicação no GitHub Pages** a partir de `main`. O Vite gera os caminhos de ativos com a base `/lavanderia-apmbb-v2/`.

Substitua o espaço reservado no cabeçalho pelo brasão original quando o arquivo autorizado estiver disponível.
