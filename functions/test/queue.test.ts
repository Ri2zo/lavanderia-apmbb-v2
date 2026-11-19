import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { processCallNotification } from '../src/notifications'
import { CALL_WINDOW_MS, Queue } from '../src/queue'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host) throw new Error('Execute os testes com o emulador do Firestore.')
const projectId = 'demo-lavanderia'
const db = getFirestore(initializeApp({ projectId }))
let now: number
const queue = new Queue(db, () => Timestamp.fromMillis(now))
const first = { uid: 'aluno-teste-a', emailVerified: true }
const second = { uid: 'aluno-teste-b', emailVerified: true }
const admin = { uid: 'admin-teste', emailVerified: true }
const machines = ['brastemp', 'lg', 'eletrolux'] as const

beforeEach(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: 'DELETE',
  })
  assert.ok(response.ok)
  now = Date.now()
  await Promise.all([
    ...machines.map((id) => queue.seed(id)),
    ...[first, second, admin].map((actor) => db.collection('usuariosAutorizados').doc(actor.uid)
      .set({ enabled: true, role: actor === admin ? 'admin' : 'student' })),
  ])
})

test('o mesmo aluno entra simultaneamente nas três filas independentes', async () => {
  const entries = await Promise.all(machines.map((id) => queue.join(first, id)))
  assert.equal(new Set(entries.map(({ entryId }) => entryId)).size, 3)
  for (const id of machines) assert.equal((await queue.myQueue(first, id)).entry?.status, 'called')
})

test('duas inscrições simultâneas na mesma máquina geram uma única inscrição', async () => {
  const attempts = await Promise.allSettled([queue.join(first, 'lg'), queue.join(first, 'lg')])
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1)
  const duplicate = attempts.find((result) => result.status === 'rejected')
  assert.equal(duplicate?.reason.code, 'already-exists')
  assert.equal((await db.collection('inscricoes').get()).size, 1)
  assert.equal((await db.collection('notificacoes').get()).size, 1)
})

test('exige sessão, e-mail verificado, cadastro ativo e privilégio administrativo', async () => {
  await assert.rejects(queue.join({ ...first, uid: '' }, 'lg'), { code: 'unauthenticated' })
  await assert.rejects(queue.join({ ...first, emailVerified: false }, 'lg'), { code: 'permission-denied' })
  await assert.rejects(queue.join({ ...first, uid: 'ausente' }, 'lg'), { code: 'permission-denied' })
  await assert.rejects(queue.maintenance(first, 'lg', true), { code: 'permission-denied' })
  const { entryId } = await queue.join(first, 'lg')
  await assert.rejects(queue.transition(second, 'lg', entryId, 'running'), { code: 'failed-precondition' })
  await db.collection('usuariosAutorizados').doc(first.uid).update({ enabled: false })
  await assert.rejects(queue.myQueue(first, 'lg'), { code: 'permission-denied' })
  await assert.rejects(queue.transition(first, 'lg', entryId, 'running'), { code: 'permission-denied' })
})

test('expira no limite e avança em FIFO, com cron repetido sem convocação duplicada', async () => {
  const a = await queue.join(first, 'lg')
  const b = await queue.join(second, 'lg')
  const c = await queue.join(admin, 'lg')
  assert.equal((await queue.myQueue(second, 'lg')).entry?.position, 2)
  assert.equal((await queue.myQueue(admin, 'lg')).entry?.position, 3)
  now += CALL_WINDOW_MS - 1
  await queue.expire('lg')
  assert.equal((await queue.myQueue(first, 'lg')).entry?.status, 'called')
  now++
  await assert.rejects(queue.transition(first, 'lg', a.entryId, 'running'), { code: 'failed-precondition' })
  await Promise.all([queue.expire('lg'), queue.expire('lg')])
  assert.equal((await db.collection('inscricoes').doc(a.entryId).get()).get('status'), 'expired')
  assert.equal((await queue.myQueue(second, 'lg')).entry?.deadlineMs, now + CALL_WINDOW_MS)
  await queue.transition(second, 'lg', b.entryId, 'running')
  await queue.transition(second, 'lg', b.entryId, 'finished')
  assert.equal((await queue.myQueue(admin, 'lg')).entry?.id, c.entryId)
  await queue.join(first, 'lg')
  assert.equal((await queue.myQueue(first, 'lg')).entry?.position, 2)
})

test('a manutenção pausa novas convocações e a retomada preserva a ordem', async () => {
  const { entryId } = await queue.join(first, 'brastemp')
  await queue.join(second, 'brastemp')
  await queue.maintenance(admin, 'brastemp', true)
  await assert.rejects(queue.transition(first, 'brastemp', entryId, 'running'), { code: 'failed-precondition' })
  await queue.transition(first, 'brastemp', entryId, 'cancelled')
  assert.equal((await queue.myQueue(second, 'brastemp')).entry?.status, 'waiting')
  await assert.rejects(queue.join(first, 'brastemp'), { code: 'failed-precondition' })
  await queue.maintenance(admin, 'brastemp', false)
  assert.equal((await queue.myQueue(second, 'brastemp')).entry?.status, 'called')
})

test('a notificação usa uma chave estável em processamento concorrente e repetido', async () => {
  const { entryId } = await queue.join(first, 'eletrolux')
  const keys = new Set<string>()
  let attempts = 0
  const sender = {
    sendCall: async (_: unknown, key: string) => {
      attempts++
      keys.add(key)
    },
  }
  await Promise.all([
    processCallNotification(db, sender, entryId),
    processCallNotification(db, sender, entryId),
  ])
  const previousAttempts = attempts
  await processCallNotification(db, sender, entryId)
  assert.equal(attempts, previousAttempts)
  assert.deepEqual([...keys], [`lavanderia-called-${entryId}`])
  assert.equal((await db.collection('notificacoes').doc(entryId).get()).get('status'), 'sent')
})

test('as regras negam alterações diretas por um aluno autenticado', async () => {
  const { entryId } = await queue.join(first, 'lg')
  const seconds = Math.floor(Date.now() / 1000)
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url')
  // The Firestore emulator accepts synthetic unsigned Firebase ID tokens.
  const token = [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      sub: first.uid, user_id: first.uid, iat: seconds, exp: seconds + 600,
      aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
      email_verified: true, firebase: { sign_in_provider: 'password' },
    }),
    '',
  ].join('.')
  for (const document of ['maquinas/lg', `inscricoes/${entryId}`]) {
    const response: Response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/${document}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { status: { stringValue: 'finished' } } }),
    })
    assert.equal(response.status, 403)
    const body = await response.json() as { error: { message: string } }
    assert.match(body.error.message, /false for 'update'/)
  }
})
