import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { test } from 'node:test'
import { googleApi } from './google.mjs'

test('assina a autenticação OAuth e consulta apenas o titular verificado', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const env = {
    FIREBASE_PROJECT_ID: 'demo-notifications',
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'service@example.invalid',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.redirect, 'error')
    if (url === 'https://oauth2.googleapis.com/token') {
      const [header, payload, signature] = options.body.get('assertion').split('.')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
      assert.equal(claims.aud, url)
      assert.equal(claims.iss, 'service@example.invalid')
      assert.match(claims.scope, /\/auth\/datastore/)
      assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')))
      return Response.json({ access_token: 'synthetic-token', expires_in: 3600 })
    }
    assert.equal(options.headers.authorization, 'Bearer synthetic-token')
    if (url.endsWith('/filasSpark/lg:runQuery')) {
      const { structuredQuery } = JSON.parse(options.body)
      assert.equal(structuredQuery.from[0].collectionId, 'ativas')
      assert.equal(structuredQuery.where.fieldFilter.value.integerValue, '42')
      return Response.json([{ document: { name: 'path/filasSpark/lg/ativas/alice' } }])
    }
    assert.equal(url, 'https://identitytoolkit.googleapis.com/v1/projects/demo-notifications/accounts:lookup')
    const { localId: [uid] } = JSON.parse(options.body)
    return Response.json({ users: [{ localId: uid, email: 'test@example.invalid', emailVerified: uid === 'alice' }] })
  })
  const api = await googleApi(env)
  assert.equal(await api.owner('lg', 42), 'alice')
  assert.equal(await api.email('alice'), 'test@example.invalid')
  assert.equal(await api.email('bob'), undefined)
})
