import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { defineBoolean } from 'firebase-functions/params'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { machines, parseMachine, Queue, type MachineId } from './queue'

initializeApp()
const queue = new Queue(getFirestore())
const enabled = defineBoolean('LAUNDRY_OPERATIONS_ENABLED', { default: false })
const options = { region: 'southamerica-east1', maxInstances: 5 }

function operation<T>(handler: (actor: { uid: string; emailVerified: boolean }, id: MachineId,
  data: CallableRequest['data']) => Promise<T>) {
  return onCall(options, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Entre na sua conta.')
    if (request.auth.token.email_verified !== true) {
      throw new HttpsError('permission-denied', 'Confirme seu e-mail.')
    }
    if (!enabled.value()) throw new HttpsError('unavailable', 'Operações ainda desabilitadas.')
    const actor = { uid: request.auth.uid, emailVerified: true }
    return handler(actor, parseMachine(request.data?.machineId), request.data)
  })
}

function entryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{20}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'Inscrição inválida.')
  }
  return value
}

export const entrarNaFila = operation((actor, id) => queue.join(actor, id))
export const consultarMinhaFila = operation((actor, id) => queue.myQueue(actor, id))
export const cancelarInscricao = operation(async (actor, id, data) => {
  await queue.transition(actor, id, entryId(data?.entryId), 'cancelled')
  return { ok: true }
})
export const iniciarCiclo = operation(async (actor, id, data) => {
  await queue.transition(actor, id, entryId(data?.entryId), 'running')
  return { ok: true }
})
export const terminarCiclo = operation(async (actor, id, data) => {
  await queue.transition(actor, id, entryId(data?.entryId), 'finished')
  return { ok: true }
})
export const definirManutencao = operation(async (actor, id, data) => {
  if (typeof data?.enabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Informe se a manutenção está ativa.')
  }
  await queue.maintenance(actor, id, data.enabled)
  return { ok: true }
})

export const expirarConvocacoes = onSchedule({
  ...options, schedule: 'every 1 minutes', maxInstances: 1,
}, async () => {
  if (!enabled.value()) return
  await Promise.all((Object.keys(machines) as MachineId[]).map((id) => queue.expire(id)))
})
