import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, query, where, type Firestore } from 'firebase/firestore'
import {
  advanceQueue, CALL_MS, changeQueue, queueMessage, queueRefs,
  type Action, type MachineState, type Ticket,
} from '../services/sparkQueue'
import type { Machine } from '../types/laundry'

function EstimatedTime({ calledAt }: { calledAt: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.min(600, Math.max(0, Math.ceil((calledAt + CALL_MS - now) / 1000)))
  return <p>Tempo estimado <strong role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong></p>
}

export function SparkMachine({ db, uid, admin, machine }: {
  db: Firestore
  uid: string
  admin: boolean
  machine: Machine
}) {
  const refs = useMemo(() => queueRefs(db, machine.id, uid), [db, machine.id, uid])
  const [state, setState] = useState<MachineState | undefined>()
  const [loaded, setLoaded] = useState(false)
  const [pointer, setPointer] = useState<number | null | undefined>()
  const [ticket, setTicket] = useState<Ticket>()
  const [position, setPosition] = useState<{ head: number; number: number; count: number }>()
  const [readError, setReadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onError = (error: unknown) => setReadError(queueMessage(error))
    const machineListener = onSnapshot(refs.machine, (snapshot) => {
      setState(snapshot.data() as MachineState | undefined)
      setLoaded(true)
    }, onError)
    const pointerListener = onSnapshot(refs.pointer, (snapshot) => {
      setPointer(snapshot.data()?.number ?? null)
    }, onError)
    return () => { machineListener(); pointerListener() }
  }, [refs])

  useEffect(() => {
    if (pointer == null) return
    return onSnapshot(refs.ticket(pointer), (snapshot) => {
      setTicket(snapshot.data() as Ticket | undefined)
    }, (error) => setReadError(queueMessage(error)))
  }, [pointer, refs])

  const mine = pointer === ticket?.number ? ticket : undefined
  const activeNumber = mine?.state === 'waiting' ? mine.number : undefined
  const head = state?.head
  useEffect(() => {
    if (head === undefined || activeNumber === undefined || activeNumber <= head) return
    const ahead = query(collection(refs.machine, 'tickets'),
      where('number', '>=', head), where('number', '<', activeNumber), limit(25))
    return onSnapshot(ahead, (snapshot) => {
      setPosition({ head, number: activeNumber, count: snapshot.docs.filter((item) => item.get('state') === 'waiting').length + 1 })
    }, (error) => setReadError(queueMessage(error)))
  }, [head, activeNumber, refs])

  const isHead = activeNumber !== undefined && activeNumber === head
  const myPhase = isHead ? state?.phase : undefined
  const hasQueue = state && state.head <= state.tail

  async function run(action: Action) {
    setBusy(true)
    setActionError('')
    try {
      if (action === 'advance' || action === 'expire') {
        await advanceQueue(db, machine.id, uid, action === 'expire')
      } else {
        await changeQueue(db, machine.id, uid, action, action === 'release' ? head : activeNumber)
        if (action !== 'start') {
          try {
            await advanceQueue(db, machine.id, uid)
          } catch {
            setActionError('Operação registrada. Use Atualizar fila para verificar o próximo passo.')
          }
        }
      }
    } catch (error) {
      setActionError(action === 'expire' && error instanceof Error && 'code' in error && error.code === 'permission-denied'
        ? 'O servidor ainda não confirmou a expiração. Confira o prazo e tente novamente.'
        : queueMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card" aria-label={machine.name}>
      <p className="eyebrow">{machine.description}</p>
      <h2>{machine.name}</h2>
      {readError ? <p role="alert" className="notice">{readError}</p>
        : !loaded || pointer === undefined || (pointer !== null && !mine) ? <p role="status">Consultando fila…</p>
        : !state ? <p>Máquina ainda não configurada.</p>
        : <>
          <p><strong>{state.maintenance ? 'Em manutenção' : state.phase === 'running' ? 'Em uso'
            : state.phase === 'called' ? 'Reservada' : hasQueue ? 'Aguardando convocação' : 'Disponível'}</strong></p>
          {activeNumber !== undefined ? (
            <>
              <p>{myPhase === 'called' ? 'Você foi convocado' : myPhase === 'running' ? 'Seu ciclo está em andamento' : 'Você está na fila'}</p>
              <p>{isHead ? 'Posição 1' : position && position.head === head && position.number === activeNumber
                ? `Posição ${position.count}` : 'Calculando posição…'}</p>
              {myPhase === 'called' && state.calledAt && <EstimatedTime calledAt={state.calledAt.toMillis()} />}
              <div className="actions">
                {myPhase !== 'running' && <button disabled={busy} onClick={() => void run('cancel')}>Cancelar inscrição</button>}
                {myPhase === 'called' && !state.maintenance && <button className="primary" disabled={busy} onClick={() => void run('start')}>Iniciar ciclo</button>}
                {myPhase === 'running' && <button className="primary" disabled={busy} onClick={() => void run('finish')}>Terminar ciclo</button>}
              </div>
            </>
          ) : (
            <>
              <p>{mine?.state === 'expired' ? 'Sua última convocação expirou.' : mine?.state === 'released'
                ? 'Seu último ciclo foi encerrado pela administração.' : 'Você está sem inscrição nesta fila.'}</p>
              <button className="primary" disabled={busy || state.maintenance} onClick={() => void run('join')}>Entrar na fila</button>
            </>
          )}
          <div className="actions queue-controls">
            {state.phase === 'idle' && hasQueue && <button disabled={busy} onClick={() => void run('advance')}>Atualizar fila</button>}
            {state.phase === 'called' && <button disabled={busy} onClick={() => void run('expire')}>Verificar expiração</button>}
            {admin && <button disabled={busy} onClick={() => void run('maintenance')}>{state.maintenance ? 'Encerrar manutenção' : 'Ativar manutenção'}</button>}
          </div>
          {admin && state.phase === 'running' && (
            <button className="admin-release" disabled={busy} onClick={() => {
              if (window.confirm('Confirma a liberação administrativa da máquina?')) void run('release')
            }}>Liberar máquina</button>
          )}
          {actionError && <p className="notice" role="alert">{actionError}</p>}
        </>
      }
    </article>
  )
}
