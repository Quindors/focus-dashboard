import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// One bundle meant every deploy invalidated everything, including the
// ~600 KB of React, Recharts and supabase-js that never change between
// deploys. Split into their own chunks they keep their hashes across app
// changes, so a returning visitor downloads only the app chunk.
const VENDOR = [
  ['react', /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/],
  ['recharts', /[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/],
  ['supabase', /[\\/]node_modules[\\/]@supabase[\\/]/],
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [name, re] of VENDOR) if (re.test(id)) return name
          return undefined
        },
      },
    },
  },
})
