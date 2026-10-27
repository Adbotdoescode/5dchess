import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // the mate-detection worker imports the engine as an ES module
  worker: { format: 'es' },
})
