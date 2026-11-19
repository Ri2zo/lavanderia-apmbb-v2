import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { onIdTokenChanged, signOut, type User } from 'firebase/auth'
import { Masthead } from './components/Masthead'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { VerifyEmail } from './pages/VerifyEmail'
import { authMessage } from './services/auth'
import { emulated, firebase, queuesEnabled } from './services/firebase'
import './styles.css'

function App() {
  const auth = firebase?.auth ?? null
  const [session, setSession] = useState<{ user: User; verified: boolean } | null>(null)
  const [loading, setLoading] = useState(Boolean(auth))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!auth) return
    return onIdTokenChanged(auth, (user) => {
      setSession(user ? { user, verified: user.emailVerified } : null)
      setLoading(false)
    })
  }, [auth])

  return (
    <>
      <Masthead>
        {session && (
          <nav className="actions" aria-label="Conta">
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
        : firebase && <Dashboard key={session.user.uid} uid={session.user.uid} db={firebase.db} enabled={queuesEnabled} />}
      <footer className="shell footer">Lavanderia Digital APMBB V2 · {emulated ? 'Emuladores locais' : 'Ambiente em desenvolvimento'}</footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
