import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, isPreview }) => ({
  base: '/lavanderia-apmbb-v2/',
  plugins: [react()],
  define: {
    __LOCAL_DEV_SERVER__: JSON.stringify(command === 'serve' && !isPreview),
  },
}))
