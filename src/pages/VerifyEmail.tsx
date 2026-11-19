import { useState } from 'react'
import { reload, sendEmailVerification, type User } from 'firebase/auth'
import { authMessage } from '../services/auth'

export function VerifyEmail({ user, onVerified }: { user: User; onVerified: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function run(resend: boolean) {
    setBusy(true)
    setMessage('')
    try {
      if (resend) {
        await sendEmailVerification(user)
        setMessage('E-mail de verificação enviado.')
      } else {
        await reload(user)
        if (user.emailVerified) await onVerified()
        else setMessage('O e-mail ainda não foi confirmado.')
      }
    } catch (error) {
      setMessage(authMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell narrow">
      <section className="card">
        <h1>Confirme seu e-mail</h1>
        <p>Abra o link de verificação na sua caixa de entrada e volte a esta tela para confirmar.</p>
        {message && <p className="notice" role="status">{message}</p>}
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => void run(false)}>Já confirmei</button>
          <button disabled={busy} onClick={() => void run(true)}>Reenviar e-mail</button>
        </div>
      </section>
    </main>
  )
}
