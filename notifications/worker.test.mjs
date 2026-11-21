import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import worker, { notify } from './worker.mjs'

const now = Date.UTC(2026, 10, 20, 12, 5)
const minute = 60_000
const stamp = (value) => ({ timestampValue: new Date(value).toISOString() })
const text = (stringValue) => ({ stringValue })
const current = {
  head: { integerValue: '1' }, tail: { integerValue: '2' }, maintenance: { booleanValue: false },
}
const brastemp = { ...current, phase: text('called'), calledAt: stamp(now - minute) }
const lg = { ...current, phase: text('running'), startedAt: stamp(now - 15 * minute), expectedEndAt: stamp(now) }

function setup(t, { states = { brastemp, lg }, role = 'student', verifiedEmail = 'teste@example.invalid', status = 201 } = {}) {
  t.mock.method(Date, 'now', () => now)
  const sent = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email')
    assert.equal(options.headers['api-key'], 'synthetic')
    sent.push(JSON.parse(options.body))
    return new Response(null, { status })
  })
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  t.after(() => sqlite.close())
  const env = {
    NOTIFICATIONS_ENABLED: 'true', FIREBASE_PROJECT_ID: 'synthetic',
    GOOGLE_SERVICE_ACCOUNT_JSON: '{}', BREVO_API_KEY: 'synthetic', BREVO_SENDER_EMAIL: 'sender@example.invalid',
    NOTIFICATIONS: { prepare(sql) {
      return { bind(...args) {
        const statement = sqlite.prepare(sql)
        return {
          run: async () => ({ meta: statement.run(...args) }),
          first: async () => statement.get(...args),
        }
      } }
    } },
  }
  const calls = { auth: 0 }
  const connect = async () => ({
    async get(path) {
      if (path === 'usuariosAutorizados/owner') return { enabled: { booleanValue: true }, role: text(role) }
      if (path.endsWith('/tickets/1')) return { state: text('waiting') }
      const machine = path.split('/').at(-1)
      const state = states[machine]
      return typeof state === 'function' ? state() : state
    },
    async owner(_machine, number) { return number === 1 ? 'owner' : undefined },
    async email(uid) {
      assert.equal(uid, 'owner')
      calls.auth++
      return verifiedEmail
    },
  })
  return { sent, run: () => notify(env, connect), calls, sqlite }
}

test('desativado por padrão e sem rota HTTP', async () => {
  assert.equal(worker.fetch, undefined)
  await notify({ NOTIFICATIONS_ENABLED: 'TRUE' }, () => assert.fail('consultou o Google'))
})

test('envia os dois avisos ao titular uma única vez em execuções concorrentes', async (t) => {
  const { run, sent } = setup(t)
  await Promise.all([run(), run()])
  await run()
  assert.deepEqual(sent.map((item) => item.subject), ['Sua vez chegou', 'Seu ciclo está previsto para terminar'])
  assert.match(sent[0].textContent, /10 minutos/)
  assert.match(sent[1].textContent, /Terminar ciclo/)
  assert.ok(sent.every((item) => item.to[0].email === 'teste@example.invalid'))
})

test('descarta convocação expirada, previsão futura e fase alterada durante a consulta', async (t) => {
  let reads = 0
  const { run, sent } = setup(t, { states: {
    brastemp: { ...brastemp, calledAt: stamp(now - 10 * minute) },
    lg: { ...lg, expectedEndAt: stamp(now + minute) },
    eletrolux: () => reads++ === 0 ? brastemp : { ...current, phase: text('idle') },
  } })
  await run()
  assert.deepEqual(sent, [])
})

test('bloqueia usuário sem papel autorizado antes de consultar o e-mail', async (t) => {
  const { run, sent, calls } = setup(t, { role: 'unknown' })
  await run()
  assert.equal(calls.auth, 0)
  assert.deepEqual(sent, [])
})

test('bloqueia envio sem endereço verificado', async (t) => {
  const { run, sent } = setup(t, { verifiedEmail: '' })
  await run()
  assert.deepEqual(sent, [])
})

test('preserva a reserva após falha do provedor para evitar redespacho', async (t) => {
  const { run, sent } = setup(t, { states: { lg }, status: 503 })
  await assert.rejects(run(), /Falha ao verificar ou enviar/)
  await run()
  assert.equal(sent.length, 1)
})

test('aplica o teto de tentativas em uma janela móvel de 24 horas', async (t) => {
  const { run, sent, sqlite } = setup(t)
  const insert = sqlite.prepare('INSERT INTO notifications VALUES (?, ?)')
  for (let i = 0; i < 249; i++) insert.run(String(i), now - minute)
  insert.run('old', now - 25 * 60 * minute)
  await run()
  assert.equal(sent.length, 1)
})
