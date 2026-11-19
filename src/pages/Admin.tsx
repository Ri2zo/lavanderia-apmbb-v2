import { machines } from '../types/laundry'

export function Admin() {
  return (
    <main className="shell dashboard">
      <h1>Painel administrativo</h1>
      <p>O controle de manutenção será habilitado após a integração com o backend.</p>
      <div className="machine-grid">
        {machines.map((machine) => (
          <article className="card" key={machine.id}>
            <p className="eyebrow">{machine.description}</p>
            <h2>{machine.name}</h2>
            <p>Controle de manutenção indisponível.</p>
          </article>
        ))}
      </div>
    </main>
  )
}
