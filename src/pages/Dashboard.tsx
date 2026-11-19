import { machines } from '../types/laundry'

export function Dashboard() {
  return (
    <main className="shell dashboard">
      <h1>Máquinas da lavanderia</h1>
      <p>Cada máquina tem uma fila própria. Quando as filas forem ativadas, você poderá acompanhar sua posição em cada uma delas.</p>
      <div className="machine-grid">
        {machines.map((machine) => (
          <article className="card" key={machine.id}>
            <p className="eyebrow">{machine.description}</p>
            <h2>{machine.name}</h2>
            <p>Fila ainda indisponível.</p>
          </article>
        ))}
      </div>
    </main>
  )
}
