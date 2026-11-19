import { useEffect, useState } from 'react'
import { doc, onSnapshot, type Firestore } from 'firebase/firestore'
import { SparkMachine } from '../components/SparkMachine'
import { queueMessage } from '../services/sparkQueue'
import { machines } from '../types/laundry'

export function Dashboard({ db, uid, enabled }: { db: Firestore; uid: string; enabled: boolean }) {
  const [role, setRole] = useState<'student' | 'admin' | null>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled) return
    return onSnapshot(doc(db, 'usuariosAutorizados', uid), (snapshot) => {
      const account = snapshot.data()
      setRole(account?.enabled === true && ['student', 'admin'].includes(account.role) ? account.role : null)
    }, (failure) => setError(queueMessage(failure)))
  }, [db, enabled, uid])

  return (
    <main className="shell dashboard">
      <h1>Máquinas da lavanderia</h1>
      <p>Cada máquina tem sua própria fila. Você pode participar das três ao mesmo tempo.</p>
      {!enabled ? <p role="status">As operações da lavanderia estão desativadas.</p>
        : error ? <p className="notice" role="alert">{error}</p>
        : role === undefined ? <p role="status">Verificando sua autorização…</p>
        : role === null ? <p className="notice" role="alert">Sua conta ainda não foi autorizada para usar a lavanderia.</p>
        : <div className="machine-grid">
          {machines.map((machine) => <SparkMachine machine={machine} db={db} uid={uid} admin={role === 'admin'} key={machine.id} />)}
        </div>}
    </main>
  )
}
