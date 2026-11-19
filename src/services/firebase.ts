import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const emulated = __LOCAL_DEV_SERVER__ && import.meta.env.DEV
  && import.meta.env.VITE_FIREBASE_USE_EMULATORS === 'true'
export const queuesEnabled = emulated || import.meta.env.VITE_FIREBASE_SPARK_ENABLED === 'true'

export const firebase = (() => {
  if (!emulated && Object.values(config).some((value) => typeof value !== 'string' || !value.trim())) {
    return null
  }
  try {
    const app = initializeApp(__LOCAL_DEV_SERVER__ && emulated
      ? { projectId: 'demo-lavanderia', apiKey: 'demo-lavanderia' }
      : config)
    const auth = getAuth(app)
    const db = getFirestore(app)
    if (emulated) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099')
      connectFirestoreEmulator(db, '127.0.0.1', 8080)
    }
    auth.languageCode = 'pt-BR'
    return { auth, db }
  } catch {
    return null
  }
})()
