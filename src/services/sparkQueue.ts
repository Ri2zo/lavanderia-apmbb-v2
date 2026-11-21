import { FirebaseError } from 'firebase/app'
import {
  doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp, type Firestore, type Transaction,
} from 'firebase/firestore'
import type { MachineId } from '../types/laundry'

export type TicketState = 'waiting' | 'cancelled' | 'expired' | 'finished' | 'released'
export type Phase = 'idle' | 'called' | 'running'
export type MachineState = {
  head: number
  tail: number
  phase: Phase
  calledAt: Timestamp | null
  maintenance: boolean
  startedAt?: Timestamp | null
  expectedEndAt?: Timestamp | null
  durationMinutes?: number | null
}
export type Ticket = { number: number; state: TicketState }
export type Action = 'join' | 'cancel' | 'start' | 'finish' | 'advance' | 'expire' | 'maintenance' | 'release'
export const CALL_MS = 600_000
export const MIN_CYCLE_MINUTES = 5
export const MAX_CYCLE_MINUTES = 180

export function validCycleMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= MIN_CYCLE_MINUTES && minutes <= MAX_CYCLE_MINUTES
}

export function queueRefs(db: Firestore, id: MachineId, uid: string) {
  const machine = doc(db, 'filasSpark', id)
  return {
    machine,
    pointer: doc(machine, 'ativas', uid),
    ticket: (number: number) => doc(machine, 'tickets', String(number)),
  }
}

export async function changeQueue(db: Firestore, id: MachineId, uid: string, action: Action, expected?: number, durationMinutes?: number) {
  if (action === 'start' && !validCycleMinutes(durationMinutes ?? NaN)) {
    throw new Error(`Informe uma duração inteira entre ${MIN_CYCLE_MINUTES} e ${MAX_CYCLE_MINUTES} minutos.`)
  }
  const refs = queueRefs(db, id, uid)
  for (let attempt = 0; ; attempt++) {
    let observed: MachineState | undefined
    try {
      return await runTransaction(db, async (tx) => {
        observed = (await tx.get(refs.machine)).data() as MachineState | undefined
        return applyAction(tx, refs, observed, action, expected, durationMinutes)
      })
    } catch (error) {
      if (!(error instanceof FirebaseError) || error.code !== 'permission-denied' || !observed || attempt >= 4) {
        throw error
      }
      // Rules can reject a stale commit before the SDK sees a transaction conflict.
      // Retry only after the server confirms that the machine actually changed.
      const latest = (await getDocFromServer(refs.machine).catch(() => undefined))?.data() as MachineState | undefined
      if (!latest || !machineChanged(observed, latest)) throw error
    }
  }
}

function machineChanged(before: MachineState, after: MachineState) {
  return before.head !== after.head || before.tail !== after.tail || before.phase !== after.phase
    || before.maintenance !== after.maintenance || before.calledAt?.toMillis() !== after.calledAt?.toMillis()
}

async function applyAction(tx: Transaction, refs: ReturnType<typeof queueRefs>,
  machine: MachineState | undefined, action: Action, expected?: number, durationMinutes?: number) {
  if (!machine) throw new Error('Máquina ainda não configurada.')
  const head = machine.head <= machine.tail ? machine.head : null

  function close(number: number, status: TicketState, moveHead: boolean) {
    tx.update(refs.ticket(number), { state: status, closedAt: serverTimestamp() })
    if (moveHead) {
      tx.update(refs.machine, { head: number + 1, phase: 'idle', calledAt: null,
        startedAt: null, expectedEndAt: null, durationMinutes: null })
    }
  }

  if (action === 'maintenance') {
    tx.update(refs.machine, { maintenance: !machine.maintenance })
    return false
  }

  if (action === 'release') {
    if (head === null || head !== expected || machine.phase !== 'running') {
      throw new Error('Este ciclo já foi encerrado.')
    }
    close(head, 'released', true)
    return false
  }

  if (action === 'advance' || action === 'expire') {
    if (head === null || machine.phase === 'running') return false
    if (machine.phase === 'called') {
      if (action !== 'expire') return false
      close(head, 'expired', true)
      return true
    }
    const ticket = (await tx.get(refs.ticket(head))).data() as Ticket | undefined
    if (ticket?.state === 'cancelled') {
      tx.update(refs.machine, { head: head + 1 })
      return true
    }
    if (ticket?.state === 'waiting' && !machine.maintenance) {
      tx.update(refs.machine, { phase: 'called', calledAt: serverTimestamp() })
    }
    return false
  }

  const pointer = (await tx.get(refs.pointer)).data()?.number as number | undefined
  const personalTicket = pointer === undefined ? undefined : await readTicket(tx, refs, pointer)
  if (action === 'join') {
    if (personalTicket?.state === 'waiting') throw new Error('Você já está inscrito nesta máquina.')
    if (machine.maintenance) throw new Error('Máquina em manutenção.')
    if (machine.tail - machine.head >= 24) throw new Error('Fila cheia. Tente novamente mais tarde.')
    const number = machine.tail + 1
    tx.update(refs.machine, { tail: number })
    tx.set(refs.ticket(number), { number, state: 'waiting' })
    tx.set(refs.pointer, { number })
    return false
  }

  if (pointer === undefined || pointer !== expected || personalTicket?.state !== 'waiting') {
    throw new Error('Esta inscrição já foi encerrada.')
  }
  if (action === 'cancel') {
    if (pointer === head && machine.phase === 'running') throw new Error('Seu ciclo já está em andamento.')
    close(pointer, 'cancelled', pointer === head && machine.phase === 'called')
  } else if (action === 'start' && pointer === head && machine.phase === 'called' && !machine.maintenance) {
    if (durationMinutes === undefined) throw new Error('Informe a duração do ciclo.')
    tx.update(refs.machine, {
      phase: 'running',
      startedAt: serverTimestamp(),
      expectedEndAt: Timestamp.fromMillis(Date.now() + durationMinutes * 60_000),
      durationMinutes,
    })
  } else if (action === 'finish' && pointer === head && machine.phase === 'running') {
    close(pointer, 'finished', true)
  } else {
    throw new Error('Operação indisponível no estado atual da fila.')
  }
  return false
}

function readTicket(tx: Transaction, refs: ReturnType<typeof queueRefs>, number: number) {
  return tx.get(refs.ticket(number)).then((snapshot) => snapshot.data() as Ticket | undefined)
}

export async function advanceQueue(db: Firestore, id: MachineId, uid: string, checkExpiry = false) {
  // At most 25 slots can be pending, including cancelled tickets.
  for (let step = 0; step <= 25; step++) {
    if (!(await changeQueue(db, id, uid, checkExpiry && step === 0 ? 'expire' : 'advance'))) return
  }
}

export function queueMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code === 'permission-denied') return 'Operação recusada. Verifique sua autorização, o estado da fila e o prazo da convocação.'
    if (error.code === 'unavailable') return 'Sem conexão com a fila. Tente novamente quando estiver online.'
    return 'Não foi possível consultar ou atualizar a fila.'
  }
  return error instanceof Error ? error.message : 'Não foi possível atualizar a fila.'
}
