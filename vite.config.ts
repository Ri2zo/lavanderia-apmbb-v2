import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/lavanderia-apmbb-v2/',
  plugins: [react()],
})
