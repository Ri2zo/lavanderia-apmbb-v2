import { Timestamp, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

export const machines = {
  brastemp: { name: 'BRASTEMP', kind: 'Lavadora' },
  lg: { name: 'LG', kind: 'Lava e seca' },
  eletrolux: { name: 'ELETROLUX', kind: 'Secadora' },
} as const
export type MachineId = keyof typeof machines
export type Actor = { uid: string; emailVerified: boolean }
type Status = 'waiting' | 'called' | 'running' | 'cancelled' | 'expired' | 'finished'
type Entry = {
  uid: string
  machineId: MachineId
  sequence: number
  status: Status
  deadline?: Timestamp
}
type Machine = {
  maintenance: boolean
  sequence: number
  current: string | null
}
export const CALL_WINDOW_MS = 10 * 60 * 1000

export function parseMachine(value: unknown): MachineId {
  if (typeof value !== 'string' || !Object.hasOwn(machines, value)) {
    throw new HttpsError('invalid-argument', 'Máquina inválida.')
  }
  return value as MachineId
}

export class Queue {
  constructor(private readonly db: Firestore, private readonly clock = Timestamp.now) {}

  private async authorize(tx: Transaction, actor: Actor, admin = false) {
    if (!actor.uid) throw new HttpsError('unauthenticated', 'Entre na sua conta.')
    if (!actor.emailVerified) throw new HttpsError('permission-denied', 'Confirme seu e-mail.')
    const user = await tx.get(this.db.collection('usuariosAutorizados').doc(actor.uid))
    if (user.get('enabled') !== true || (admin && user.get('role') !== 'admin')) {
      throw new HttpsError('permission-denied', 'Acesso não autorizado.')
    }
  }

  private machine(id: MachineId) {
    return this.db.collection('maquinas').doc(id)
  }

  private entry(id: string) {
    return this.db.collection('inscricoes').doc(id)
  }

  private active(id: MachineId, uid: string) {
    return this.machine(id).collection('ativas').doc(uid)
  }

  private async state(tx: Transaction, ref: DocumentReference) {
    const data = (await tx.get(ref)).data() as Machine | undefined
    if (!data) throw new HttpsError('failed-precondition', 'Máquina ainda não configurada.')
    return data
  }

  private waiting(id: MachineId) {
    return this.db.collection('inscricoes').where('machineId', '==', id)
      .where('status', '==', 'waiting').orderBy('sequence')
  }

  private audit(tx: Transaction, machineId: MachineId, action: string, uid: string | null,
    at: Timestamp, entryId: string | null = null) {
    tx.create(this.db.collection('auditoria').doc(), { machineId, action, uid, entryId, at })
  }

  private call(tx: Transaction, id: MachineId, entry: DocumentReference, uid: string, now: Timestamp) {
    const deadline = Timestamp.fromMillis(now.toMillis() + CALL_WINDOW_MS)
    tx.update(entry, { status: 'called', calledAt: now, deadline })
    this.recordCall(tx, id, entry.id, uid, now, deadline)
  }

  private recordCall(tx: Transaction, id: MachineId, entryId: string, uid: string,
    now: Timestamp, deadline: Timestamp) {
    tx.update(this.machine(id), { current: entryId })
    tx.create(this.db.collection('notificacoes').doc(entryId), {
      kind: 'called', machineId: id, uid, entryId, status: 'pending', createdAt: now, deadline,
    })
    this.audit(tx, id, 'called', null, now, entryId)
  }

  async seed(id: MachineId) {
    const ref = this.machine(id)
    await this.db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) {
        tx.create(ref, { ...machines[id], maintenance: false, sequence: 0, current: null })
      }
    })
  }

  async join(actor: Actor, id: MachineId) {
    const machine = this.machine(id)
    const entry = this.db.collection('inscricoes').doc()
    return this.db.runTransaction(async (tx) => {
      await this.authorize(tx, actor)
      const state = await this.state(tx, machine)
      const active = this.active(id, actor.uid)
      const existing = await tx.get(active)
      if (existing.exists) throw new HttpsError('already-exists', 'Você já está inscrito nesta máquina.')
      if (state.maintenance) throw new HttpsError('failed-precondition', 'Máquina em manutenção.')
      const now = this.clock()
      const sequence = state.sequence + 1
      const deadline = state.current === null ? Timestamp.fromMillis(now.toMillis() + CALL_WINDOW_MS) : null
      tx.update(machine, { sequence })
      tx.create(entry, {
        uid: actor.uid, machineId: id, sequence, createdAt: now,
        status: deadline ? 'called' : 'waiting', ...(deadline && { calledAt: now, deadline }),
      })
      tx.create(active, { entryId: entry.id })
      this.audit(tx, id, 'joined', actor.uid, now, entry.id)
      if (deadline) this.recordCall(tx, id, entry.id, actor.uid, now, deadline)
      return { entryId: entry.id }
    })
  }

  async myQueue(actor: Actor, id: MachineId) {
    return this.db.runTransaction(async (tx) => {
      await this.authorize(tx, actor)
      const machine = await this.state(tx, this.machine(id))
      const active = await tx.get(this.active(id, actor.uid))
      if (!active.exists) return { maintenance: machine.maintenance, entry: null }
      const entry = (await tx.get(this.entry(active.get('entryId')))).data() as Entry
      const ahead = entry.status === 'waiting'
        ? (await tx.get(this.waiting(id).where('sequence', '<', entry.sequence).count())).data().count
        : null
      return {
        maintenance: machine.maintenance,
        entry: {
          id: active.get('entryId') as string,
          status: entry.status,
          position: ahead === null ? 1 : ahead + (machine.current ? 2 : 1),
          deadlineMs: entry.deadline?.toMillis() ?? null,
        },
      }
    }, { readOnly: true })
  }

  async transition(actor: Actor, id: MachineId, expectedId: string, action: 'cancelled' | 'running' | 'finished') {
    await this.db.runTransaction(async (tx) => {
      await this.authorize(tx, actor)
      const machine = await this.state(tx, this.machine(id))
      const active = await tx.get(this.active(id, actor.uid))
      if (active.get('entryId') !== expectedId) {
        throw new HttpsError('failed-precondition', 'A inscrição não está mais ativa.')
      }
      const ref = this.entry(expectedId)
      const entry = (await tx.get(ref)).data() as Entry
      const now = this.clock()
      const current = machine.current === ref.id
      if (action === 'running') {
        if (machine.maintenance || !current || entry.status !== 'called' ||
          !entry.deadline || entry.deadline.toMillis() <= now.toMillis()) {
          throw new HttpsError('failed-precondition', 'A convocação não está disponível para início.')
        }
        tx.update(ref, { status: 'running', startedAt: now })
        this.audit(tx, id, 'started', actor.uid, now, ref.id)
        return
      }
      if (action === 'finished' ? !(current && entry.status === 'running') : !['called', 'waiting'].includes(entry.status)) {
        throw new HttpsError('failed-precondition', 'Estado incompatível com a operação.')
      }
      await this.close(tx, id, machine, ref, entry, action, now, actor.uid)
    })
  }

  private async close(tx: Transaction, id: MachineId, machine: Machine, ref: DocumentReference,
    entry: Entry, status: 'cancelled' | 'finished' | 'expired', now: Timestamp, actor: string | null) {
    const current = machine.current === ref.id
    const next = current && !machine.maintenance ? (await tx.get(this.waiting(id).limit(1))).docs[0] : undefined
    tx.update(ref, { status, endedAt: now })
    tx.delete(this.active(id, entry.uid))
    this.audit(tx, id, status, actor, now, ref.id)
    if (next) this.call(tx, id, next.ref, next.get('uid'), now)
    else if (current) tx.update(this.machine(id), { current: null })
  }

  async expire(id: MachineId) {
    await this.db.runTransaction(async (tx) => {
      const machine = (await tx.get(this.machine(id))).data() as Machine | undefined
      if (!machine?.current) return
      const ref = this.entry(machine.current)
      const entry = (await tx.get(ref)).data() as Entry
      const now = this.clock()
      if (entry.status === 'called' && entry.deadline && entry.deadline.toMillis() <= now.toMillis()) {
        await this.close(tx, id, machine, ref, entry, 'expired', now, null)
      }
    })
  }

  async maintenance(actor: Actor, id: MachineId, enabled: boolean) {
    await this.db.runTransaction(async (tx) => {
      await this.authorize(tx, actor, true)
      const ref = this.machine(id)
      const machine = await this.state(tx, ref)
      if (machine.maintenance === enabled) return
      const next = !enabled && !machine.current ? (await tx.get(this.waiting(id).limit(1))).docs[0] : undefined
      const now = this.clock()
      tx.update(ref, { maintenance: enabled })
      this.audit(tx, id, enabled ? 'maintenance_on' : 'maintenance_off', actor.uid, now)
      if (next) this.call(tx, id, next.ref, next.get('uid'), now)
    })
  }
}
