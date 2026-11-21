import { googleApi } from './google.mjs'

const machines = ['brastemp', 'lg', 'eletrolux']
const minute = 60_000
const day = 24 * 60 * minute
const subjects = { called: 'Sua vez chegou', running: 'Seu ciclo está previsto para terminar' }

function eligibleEvent(fields, now) {
  const number = Number(fields?.head?.integerValue)
  const tail = Number(fields?.tail?.integerValue)
  if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(tail) || number > tail) return
  const phase = fields.phase?.stringValue
  if (phase === 'called' && fields.maintenance?.booleanValue === false) {
    const calledAt = Date.parse(fields.calledAt?.timestampValue)
    const deadline = calledAt + 10 * minute
    if (calledAt <= now && now < deadline) return { phase, number, deadline }
  }
  if (phase === 'running') {
    const deadline = Date.parse(fields.expectedEndAt?.timestampValue)
    const startedAt = Date.parse(fields.startedAt?.timestampValue)
    if (startedAt < deadline && deadline <= now && now < deadline + 15 * minute) {
      return { phase, number, deadline }
    }
  }
}

async function send(env, machine, event, email) {
  const machineName = machine.toUpperCase()
  const time = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(event.deadline)
  const message = event.phase === 'called'
    ? `Sua vez chegou na máquina ${machineName}. Você tem 10 minutos a partir da convocação oficial para iniciar o ciclo, até ${time} (horário de Brasília).`
    : `O horário previsto do seu ciclo na máquina ${machineName} foi atingido. Confira a máquina e confirme em “Terminar ciclo” no site para liberá-la.`
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    redirect: 'error',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: 'Lavanderia Digital APMBB' },
      to: [{ email }],
      subject: subjects[event.phase],
      textContent: `${message}\n\nhttps://ri2zo.github.io/lavanderia-apmbb-v2/`,
    }),
  })
  if (!response.ok) throw new Error('Brevo recusou a solicitação.')
}

async function checkMachine(env, api, machine) {
  const path = `filasSpark/${machine}`
  const event = eligibleEvent(await api.get(path), Date.now())
  if (!event) return

  const id = JSON.stringify([env.FIREBASE_PROJECT_ID, machine, event.number, event.phase, event.deadline])
  const db = env.NOTIFICATIONS
  if (await db.prepare('SELECT 1 FROM notifications WHERE id = ?').bind(id).first()) return
  const uid = await api.owner(machine, event.number)
  if (!uid) return
  const account = await api.get(`usuariosAutorizados/${encodeURIComponent(uid)}`)
  if (account?.enabled?.booleanValue !== true || !['student', 'admin'].includes(account.role?.stringValue)) return
  const ticket = await api.get(`${path}/tickets/${event.number}`)
  if (ticket?.state?.stringValue !== 'waiting') return
  const email = await api.email(uid)
  if (!email) return

  const latest = eligibleEvent(await api.get(path), Date.now())
  if (!latest || latest.number !== event.number || latest.phase !== event.phase || latest.deadline !== event.deadline) return
  const now = Date.now()
  // Uma instrução atômica reserva o evento e aplica o teto de 250 tentativas nas últimas 24 horas.
  const claim = await db.prepare(`
    INSERT OR IGNORE INTO notifications (id, claimed_at)
    SELECT ?, ? WHERE (SELECT COUNT(*) FROM notifications WHERE claimed_at > ?) < 250
  `).bind(id, now, now - day).run()
  if (claim.meta.changes !== 1) return
  if (event.phase === 'called' && Date.now() >= event.deadline) return
  await send(env, machine, event, email)
}

export async function notify(env, connect = googleApi) {
  if (env.NOTIFICATIONS_ENABLED !== 'true') return
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.NOTIFICATIONS) {
    throw new Error('Configuração de notificações incompleta.')
  }
  const api = await connect(env)
  await env.NOTIFICATIONS.prepare('DELETE FROM notifications WHERE claimed_at < ?').bind(Date.now() - 7 * day).run()
  let failed = false
  for (const machine of machines) {
    try {
      await checkMachine(env, api, machine)
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error('Falha ao verificar ou enviar notificações.')
}

export default {
  scheduled(_controller, env) {
    return notify(env).catch(() => { throw new Error('Execução de notificações falhou.') })
  },
}
