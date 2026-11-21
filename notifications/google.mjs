const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const scopes = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform'
let cached

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function issueToken(secret) {
  const { client_email, private_key } = JSON.parse(secret)
  const keyBytes = Uint8Array.from(atob(private_key.replace(/-----[^-]+-----|\s/g, '')), (char) => char.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)))
  const payload = encode({ iss: client_email, scope: scopes, aud: tokenEndpoint, iat: now, exp: now + 3600 })
  const claims = `${encode({ alg: 'RS256', typ: 'JWT' })}.${payload}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(claims))
  const result = await fetch(tokenEndpoint, {
    method: 'POST',
    redirect: 'error',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${claims}.${base64url(new Uint8Array(signature))}`,
    }),
  })
  if (!result.ok) throw new Error('Falha ao autenticar no Google.')
  const { access_token, expires_in } = await result.json()
  if (!access_token || !Number.isFinite(expires_in)) throw new Error('Token Google inválido.')
  return { token: access_token, expiresAt: Date.now() + expires_in * 1000 }
}

async function googleToken(secret) {
  if (cached?.secret === secret && cached.expiresAt > Date.now() + 60_000) return cached.token
  const result = await issueToken(secret)
  cached = { ...result, secret }
  return result.token
}

export async function googleApi(env) {
  if (!/^[a-z][a-z0-9-]+$/.test(env.FIREBASE_PROJECT_ID ?? '')) throw new Error('Projeto Firebase inválido.')
  const project = env.FIREBASE_PROJECT_ID
  const token = await googleToken(env.GOOGLE_SERVICE_ACCOUNT_JSON)
  const root = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`

  async function request(url, body, allowMissing = false) {
    const result = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
    })
    if (allowMissing && result.status === 404) return undefined
    if (!result.ok) throw new Error('Falha na API do Google.')
    return result.json()
  }

  return {
    async get(path) {
      return (await request(`${root}/${path}`, undefined, true))?.fields
    },

    async owner(machine, number) {
      const result = await request(`${root}/filasSpark/${machine}:runQuery`, {
        structuredQuery: {
          from: [{ collectionId: 'ativas' }],
          where: { fieldFilter: {
            field: { fieldPath: 'number' }, op: 'EQUAL', value: { integerValue: String(number) },
          } },
          limit: 2,
        },
      })
      const owners = result.flatMap((row) => row.document ? [row.document.name.split('/').at(-1)] : [])
      return owners.length === 1 ? owners[0] : undefined
    },

    async email(uid) {
      const result = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, { localId: [uid] })
      const user = result.users?.find((item) => item.localId === uid)
      return user?.emailVerified === true && user.disabled !== true && user.email ? user.email : undefined
    },
  }
}
