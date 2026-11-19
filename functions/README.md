# Cloud Functions

Diretório reservado para o backend Firebase do projeto `lavanderia-digital-apmbb-v2`.

As futuras funções deverão exigir uma sessão autenticada com e-mail verificado. A administração de manutenção deverá exigir a claim de token `admin: true`, atribuída pelo backend. A autorização deverá ser validada em cada operação administrativa.

As filas serão independentes. O backend deverá usar transações no Firestore para garantir uma inscrição ativa por aluno e máquina, permitir participação simultânea nas três filas e validar posição, convocação, início e término. O servidor deverá registrar o horário da convocação e controlar o prazo de 10 minutos. Notificações por e-mail poderão ser agendadas a partir de eventos persistidos, com envio idempotente e credenciais mantidas no backend.

A configuração atual do Firebase contém as regras do Firestore. A configuração, o runtime e a publicação das funções ficam para a etapa de implementação do backend.
