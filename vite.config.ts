import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // the mate-detection worker imports the engine as an ES module
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // Vendor chunks: the menu needs React + Supabase; three.js only loads with the
        // (lazy) game screen.
        codeSplitting: {
          groups: [
            // three ships as two files (core + renderers); keep them apart so neither tops 500 kB
            { name: 'three-core', test: /node_modules[\\/]three[\\/]build[\\/]three\.core/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
