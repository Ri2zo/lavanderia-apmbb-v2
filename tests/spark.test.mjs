import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, beforeEach, test } from 'node:test'
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { advanceQueue, changeQueue, queueRefs } from '../src/services/sparkQueue.ts'

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Execute os testes com FIRESTORE_EMULATOR_HOST=127.0.0.1:8080.')
}
const env = await initializeTestEnvironment({
  projectId: 'demo-lavanderia-tests',
  firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
})
const ids = ['brastemp', 'lg', 'eletrolux']
const empty = { head: 1, tail: 0, phase: 'idle', calledAt: null, maintenance: false }
const browser = (uid, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore()
const alice = browser('alice')
const bob = browser('bob')
const admin = browser('admin')
const readMachine = async (db, id = 'lg') => (await getDoc(doc(db, 'filasSpark', id))).data()

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await Promise.all([
      ...ids.map((id) => setDoc(doc(db, 'filasSpark', id), empty)),
      ...['alice', 'bob', 'admin'].map((uid) => setDoc(doc(db, 'usuariosAutorizados', uid), {
        enabled: true, role: uid === 'admin' ? 'admin' : 'student',
      })),
    ])
  })
})
after(() => env.cleanup())

test('inscrições concorrentes preservam ordem e unicidade por máquina', async () => {
  const duplicate = await Promise.allSettled([
    changeQueue(alice, 'lg', 'alice', 'join'), changeQueue(alice, 'lg', 'alice', 'join'),
  ])
  assert.equal(duplicate.filter((result) => result.status === 'fulfilled').length, 1)
  const [a, b] = await Promise.all([
    changeQueue(alice, 'brastemp', 'alice', 'join'),
    changeQueue(bob, 'lg', 'bob', 'join'),
    changeQueue(alice, 'eletrolux', 'alice', 'join'),
  ])
  assert.equal(a, false)
  assert.equal(b, false)
  assert.equal((await readMachine(alice, 'brastemp')).tail, 1)
  assert.equal((await readMachine(alice, 'eletrolux')).tail, 1)
  await advanceQueue(bob, 'lg', 'bob')
  await assert.rejects(changeQueue(bob, 'lg', 'bob', 'start', 2))
  await changeQueue(alice, 'lg', 'alice', 'start', 1)
  await changeQueue(alice, 'lg', 'alice', 'finish', 1)
  await advanceQueue(alice, 'lg', 'alice')
  assert.equal((await readMachine(alice)).head, 2)
  await changeQueue(bob, 'lg', 'bob', 'cancel', 2)
  assert.equal((await readMachine(alice)).head, 3)
})

test('nega autoautorização, escalada, leitura privada e acessos sem verificação', async () => {
  const stranger = browser('stranger')
  await assertFails(setDoc(doc(stranger, 'usuariosAutorizados', 'stranger'), { enabled: true, role: 'student' }))
  await assertFails(updateDoc(doc(alice, 'usuariosAutorizados', 'alice'), { role: 'admin' }))
  await assertFails(getDoc(doc(alice, 'usuariosAutorizados', 'bob')))
  await assertFails(readMachine(stranger))
  await assertFails(readMachine(browser('alice', false)))
  await assertFails(readMachine(env.unauthenticatedContext().firestore()))
  await assertFails(changeQueue(alice, 'lg', 'alice', 'maintenance'))
  await assertFails(getDoc(queueRefs(alice, 'lg', 'bob').pointer))
})

test('rejeita saltos, tickets forjados, chamadas com hora fabricada e ciclos de outro aluno', async () => {
  const refs = queueRefs(alice, 'lg', 'alice')
  await assertFails(updateDoc(refs.machine, { tail: 2 }))
  await assertFails(setDoc(refs.ticket(1), { number: 1, state: 'waiting' }))
  await assertFails(setDoc(refs.pointer, { number: 1 }))
  await changeQueue(alice, 'lg', 'alice', 'join')
  await changeQueue(bob, 'lg', 'bob', 'join')
  await assertFails(updateDoc(refs.machine, { head: 2 }))
  await assertFails(updateDoc(refs.machine, { phase: 'called', calledAt: Timestamp.fromMillis(0) }))
  const inconsistent = writeBatch(alice)
  inconsistent.update(refs.machine, { phase: 'called', calledAt: serverTimestamp() })
  inconsistent.update(refs.ticket(1), { state: 'cancelled', closedAt: serverTimestamp() })
  await assertFails(inconsistent.commit())
  await advanceQueue(bob, 'lg', 'bob')
  await assertFails(updateDoc(doc(bob, 'filasSpark', 'lg'), { phase: 'running' }))
  await assertFails(updateDoc(queueRefs(bob, 'lg', 'bob').ticket(1), { state: 'cancelled', closedAt: serverTimestamp() }))
  await assertFails(updateDoc(refs.machine, { calledAt: serverTimestamp() }))
})

test('usa o prazo do servidor e permite a terceiros avançar somente após expiração', async () => {
  await changeQueue(alice, 'lg', 'alice', 'join')
  await changeQueue(bob, 'lg', 'bob', 'join')
  await advanceQueue(alice, 'lg', 'alice')
  await assertFails(advanceQueue(bob, 'lg', 'bob', true))
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'filasSpark', 'lg'), { calledAt: Timestamp.fromMillis(Date.now() - 601_000) })
  })
  await assertFails(changeQueue(alice, 'lg', 'alice', 'start', 1))
  await assertFails(changeQueue(alice, 'lg', 'alice', 'cancel', 1))
  await advanceQueue(bob, 'lg', 'bob', true)
  assert.equal((await readMachine(bob)).head, 2)
  assert.equal((await readMachine(bob)).phase, 'called')
  assert.equal((await getDoc(queueRefs(alice, 'lg', 'alice').ticket(1))).get('state'), 'expired')
  await changeQueue(alice, 'lg', 'alice', 'join')
  assert.equal((await getDoc(queueRefs(alice, 'lg', 'alice').pointer)).get('number'), 3)
})

test('manutenção pausa novas inscrições e inícios, preservando a ordem e permitindo conclusão', async () => {
  await changeQueue(alice, 'lg', 'alice', 'join')
  await changeQueue(bob, 'lg', 'bob', 'join')
  await advanceQueue(alice, 'lg', 'alice')
  await changeQueue(admin, 'lg', 'admin', 'maintenance')
  await assert.rejects(changeQueue(alice, 'lg', 'alice', 'start', 1))
  await assert.rejects(changeQueue(admin, 'lg', 'admin', 'join'))
  await changeQueue(admin, 'lg', 'admin', 'maintenance')
  await changeQueue(alice, 'lg', 'alice', 'start', 1)
  await changeQueue(admin, 'lg', 'admin', 'maintenance')
  await changeQueue(alice, 'lg', 'alice', 'finish', 1)
  await advanceQueue(bob, 'lg', 'bob')
  assert.equal((await readMachine(bob)).phase, 'idle')
  await changeQueue(admin, 'lg', 'admin', 'maintenance')
  await advanceQueue(admin, 'lg', 'admin')
  assert.equal((await readMachine(bob)).head, 2)
  assert.equal((await readMachine(bob)).phase, 'called')
})

test('convoca a próxima inscrição válida sem permitir salto de fila', async () => {
  for (const [db, uid] of [[alice, 'alice'], [bob, 'bob'], [admin, 'admin']]) {
    await changeQueue(db, 'lg', uid, 'join')
  }
  await changeQueue(bob, 'lg', 'bob', 'cancel', 2)
  await advanceQueue(admin, 'lg', 'admin')
  await changeQueue(alice, 'lg', 'alice', 'cancel', 1)
  await advanceQueue(admin, 'lg', 'admin')
  assert.equal((await readMachine(admin)).head, 3)
  assert.equal((await readMachine(admin)).phase, 'called')
})

test('só a administração pode liberar um ciclo abandonado', async () => {
  await changeQueue(alice, 'lg', 'alice', 'join')
  await changeQueue(bob, 'lg', 'bob', 'join')
  await advanceQueue(alice, 'lg', 'alice')
  await changeQueue(alice, 'lg', 'alice', 'start', 1)
  await assertFails(changeQueue(bob, 'lg', 'bob', 'release', 1))
  await changeQueue(admin, 'lg', 'admin', 'release', 1)
  await advanceQueue(admin, 'lg', 'admin')
  assert.equal((await readMachine(bob)).head, 2)
  assert.equal((await getDoc(queueRefs(alice, 'lg', 'alice').ticket(1))).get('state'), 'released')
})

test('a posição acompanha cancelamentos em tempo real e a consulta é limitada', { timeout: 10_000 }, async (t) => {
  await changeQueue(alice, 'lg', 'alice', 'join')
  await changeQueue(bob, 'lg', 'bob', 'join')
  await changeQueue(admin, 'lg', 'admin', 'join')
  const tickets = collection(admin, 'filasSpark', 'lg', 'tickets')
  await assertFails(getDocs(tickets))
  await assertFails(getDocs(query(tickets, limit(26))))
  const range = query(tickets, where('number', '>=', 1), where('number', '<', 3), limit(25))
  const countAhead = (snapshot) => snapshot.docs.filter((item) => item.get('state') === 'waiting').length
  assert.equal(countAhead(await getDocs(range)), 2)
  let stop
  const afterCancellation = new Promise((resolve, reject) => {
    stop = onSnapshot(range, (snapshot) => {
      if (countAhead(snapshot) === 1) resolve()
    }, reject)
  })
  t.after(() => stop?.())
  await changeQueue(bob, 'lg', 'bob', 'cancel', 2)
  await afterCancellation
})

test('dois alunos concorrentes recebem tickets distintos e a cabeça é convocada uma vez', async () => {
  await Promise.all([changeQueue(alice, 'lg', 'alice', 'join'), changeQueue(bob, 'lg', 'bob', 'join')])
  const [a, b] = await Promise.all([
    getDoc(queueRefs(alice, 'lg', 'alice').pointer), getDoc(queueRefs(bob, 'lg', 'bob').pointer),
  ])
  assert.deepEqual([a.get('number'), b.get('number')].sort(), [1, 2])
  await Promise.all([advanceQueue(alice, 'lg', 'alice'), advanceQueue(bob, 'lg', 'bob')])
  const machine = await readMachine(alice)
  assert.equal(machine.head, 1)
  assert.equal(machine.phase, 'called')
  assert.ok(machine.calledAt instanceof Timestamp)
})
