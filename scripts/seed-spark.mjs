const host = '127.0.0.1:8080'
if (process.env.FIRESTORE_EMULATOR_HOST !== host) {
  throw new Error(`O seed é exclusivo do emulador. Use FIRESTORE_EMULATOR_HOST=${host}.`)
}
const root = `http://${host}/v1/projects/demo-lavanderia/databases/(default)/documents`
const [uid, role] = process.argv.slice(2)
if (uid && (!/^[\w-]{1,128}$/.test(uid) || !['student', 'admin'].includes(role))) {
  throw new Error('Informe um UID fictício e student ou admin.')
}
const fields = {
  head: { integerValue: '1' },
  tail: { integerValue: '0' },
  phase: { stringValue: 'idle' },
  calledAt: { nullValue: null },
  maintenance: { booleanValue: false },
}
const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

for (const machine of ['brastemp', 'lg', 'eletrolux']) {
  const response = await fetch(`${root}/filasSpark?documentId=${machine}`, {
    method: 'POST', headers, body: JSON.stringify({ fields }),
  })
  if (!response.ok && response.status !== 409) throw new Error(`Falha ao inicializar ${machine}: ${response.status}`)
}
if (uid) {
  const response = await fetch(`${root}/usuariosAutorizados/${uid}`, {
    method: 'PATCH', headers, body: JSON.stringify({
      fields: { enabled: { booleanValue: true }, role: { stringValue: role } },
    }),
  })
  if (!response.ok) throw new Error(`Falha ao autorizar UID no emulador: ${response.status}`)
}
console.log('Dados de desenvolvimento preparados no emulador demo-lavanderia.')
