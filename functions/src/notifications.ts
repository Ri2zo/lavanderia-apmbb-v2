import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { MachineId } from './queue'

export interface Notification {
  uid: string
  machineId: MachineId
  deadline: Timestamp
}

export interface MailSender {
  // The provider must deduplicate concurrent sends and retries with the same key.
  sendCall(notification: Notification, idempotencyKey: string): Promise<void>
}

export async function processCallNotification(db: Firestore, sender: MailSender, entryId: string) {
  const ref = db.collection('notificacoes').doc(entryId)
  const event = (await ref.get()).data()
  if (!event || event.status !== 'pending' || event.kind !== 'called') return
  if (event.deadline.toMillis() <= Date.now()) return

  const entry = await db.collection('inscricoes').doc(entryId).get()
  if (entry.get('status') !== 'called') return
  const machine = await db.collection('maquinas').doc(event.machineId).get()
  if (machine.get('maintenance') === true || machine.get('current') !== entryId) return
  const user = await db.collection('usuariosAutorizados').doc(event.uid).get()
  if (user.get('enabled') !== true) return

  await sender.sendCall(
    { uid: event.uid, machineId: event.machineId, deadline: event.deadline },
    `lavanderia-called-${entryId}`,
  )
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).get('status') === 'pending') {
      tx.update(ref, { status: 'sent', sentAt: Timestamp.now() })
    }
  })
}
