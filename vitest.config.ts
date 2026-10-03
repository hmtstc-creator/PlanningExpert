import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'

// Testler uygulamanın sunucu eklentilerini (TanStack Start, Nitro) yüklemez:
// onlar edge-runtime testlerinde React'i CommonJS olarak çekip "module is not
// defined" hatası veriyor ve vitest'in kapanmasını 10 sn bekletiyordu.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.json'] }), viteReact()],
})
