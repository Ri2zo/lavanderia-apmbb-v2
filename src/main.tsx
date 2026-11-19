import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getIdTokenResult, onIdTokenChanged, signOut, type User } from 'firebase/auth'
import { Masthead } from './components/Masthead'
import { Admin } from './pages/Admin'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { VerifyEmail } from './pages/VerifyEmail'
import { authMessage } from './services/auth'
import { firebase } from './services/firebase'
import './styles.css'

function App() {
  const auth = firebase?.auth ?? null
  const [session, setSession] = useState<{ user: User; verified: boolean; admin: boolean } | null>(null)
  const [loading, setLoading] = useState(Boolean(auth))
  const [adminOpen, setAdminOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!auth) return
    let revision = 0
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      const current = ++revision
      const token = user?.emailVerified ? await getIdTokenResult(user).catch(() => null) : null
      if (current !== revision) return
      setSession(user ? { user, verified: user.emailVerified, admin: token?.claims.admin === true } : null)
      if (!user) setAdminOpen(false)
      setLoading(false)
    })
    return () => {
      revision++
      unsubscribe()
    }
  }, [auth])

  return (
    <>
      <Masthead>
        {session && (
          <nav className="actions" aria-label="Conta">
            {session.verified && session.admin && <button onClick={() => setAdminOpen(!adminOpen)}>{adminOpen ? 'Máquinas' : 'Administração'}</button>}
            <button onClick={() => {
              setError('')
              if (auth) void signOut(auth).catch((failure) => setError(authMessage(failure)))
            }}>Sair</button>
          </nav>
        )}
      </Masthead>
      {error && <p className="shell notice" role="alert">{error}</p>}
      {loading ? <main className="shell narrow" role="status">Carregando sessão…</main>
        : !session ? <Login auth={auth} onVerificationError={() => setError('O envio do e-mail de verificação falhou. Use a opção de reenvio.')} />
        : !session.verified ? <VerifyEmail user={session.user} onVerified={async () => { await session.user.getIdToken(true) }} />
        : adminOpen && session.admin ? <Admin />
        : <Dashboard />}
      <footer className="shell footer">Lavanderia Digital APMBB V2 · Ambiente em desenvolvimento</footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
