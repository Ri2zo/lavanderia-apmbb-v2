import { useState, type FormEvent } from 'react'
import { sendEmailVerification, type Auth } from 'firebase/auth'
import { authenticate, authMessage } from '../services/auth'

export function Login({ auth, onVerificationError }: { auth: Auth | null; onVerificationError: () => void }) {
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auth || busy) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const user = await authenticate(auth, String(fields.get('email')).trim(), String(fields.get('password')), register)
      if (register) await sendEmailVerification(user).catch(onVerificationError)
    } catch (failure) {
      setError(authMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell entry">
      <section className="intro">
        <p className="eyebrow">Academia de Polícia Militar do Barro Branco</p>
        <h1>Lavanderia Digital APMBB</h1>
        <p>Portal dos alunos para acompanhar as máquinas e, quando o serviço estiver disponível, participar das filas da lavanderia.</p>
      </section>
      <section className="card" aria-labelledby="auth-title">
        <h2 id="auth-title">{register ? 'Criar conta' : 'Acessar sua conta'}</h2>
        <p>{register ? 'Confirme seu e-mail após o cadastro.' : 'Entre com seu e-mail e senha.'}</p>
        {!auth && <p className="notice" role="status">Autenticação indisponível. Configure o Firebase para habilitar o acesso.</p>}
        <form onSubmit={submit}>
          <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
          <label>Senha<input key={String(register)} name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 6 : undefined} required /></label>
          {error && <p className="notice" role="alert">{error}</p>}
          <button className="primary" disabled={!auth || busy}>{busy ? 'Aguarde…' : register ? 'Cadastrar' : 'Entrar'}</button>
        </form>
        <button className="text-button" disabled={busy} onClick={() => { setError(''); setRegister(!register) }}>
          {register ? 'Já tenho conta' : 'Criar conta de aluno'}
        </button>
      </section>
    </main>
  )
}
