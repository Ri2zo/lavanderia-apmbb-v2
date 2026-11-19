import type { ReactNode } from 'react'

export function Masthead({ children }: { children?: ReactNode }) {
  return (
    <header className="masthead">
      <div className="shell masthead-inner">
        <div className="brand">
          <span className="crest" role="img" aria-label="Espaço reservado para o brasão da APMBB">APMBB</span>
          <div><strong>Lavanderia Digital</strong><small>APMBB V2</small></div>
        </div>
        {children}
      </div>
    </header>
  )
}
