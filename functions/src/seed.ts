import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { machines, Queue, type MachineId } from './queue'

async function main() {
  const projectId = process.argv[2]
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (!projectId?.startsWith('demo-')) throw new Error('Use um projeto demo-* no emulador.')
  } else if (projectId !== 'lavanderia-digital-apmbb-v2' || process.argv[3] !== '--apply-production') {
    throw new Error('A inicialização remota exige o projeto explícito e --apply-production.')
  }

  initializeApp({ projectId })
  const queue = new Queue(getFirestore())
  await Promise.all((Object.keys(machines) as MachineId[]).map((id) => queue.seed(id)))
  console.log('Máquinas inicializadas.')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
