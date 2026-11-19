import { FirebaseError } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth'

export async function authenticate(auth: Auth, email: string, password: string, register: boolean) {
  if (!register) return (await signInWithEmailAndPassword(auth, email, password)).user

  return (await createUserWithEmailAndPassword(auth, email, password)).user
}

export function authMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/email-already-in-use':
        return 'Já existe uma conta com este e-mail.'
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Confira o e-mail e a senha.'
      case 'auth/invalid-email':
        return 'Informe um endereço de e-mail válido.'
      case 'auth/weak-password':
      case 'auth/password-does-not-meet-requirements':
        return 'A senha precisa cumprir os requisitos de segurança.'
      case 'auth/too-many-requests':
        return 'Muitas tentativas. Aguarde e tente novamente.'
      case 'auth/network-request-failed':
        return 'Verifique sua conexão e tente novamente.'
    }
  }
  return 'Não foi possível concluir a operação. Tente novamente.'
}
