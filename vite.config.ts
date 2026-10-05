import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { SECURITY_HEADERS } from './src/lib/securityHeaders'

// NOT: Bu, orijinal Macaly projesinin sadeleştirilmiş halidir.
// Macaly'ye özgü eklentiler (macalyTagger, visulima error overlay,
// macaly.dev allowedHosts) kaldırıldı çünkü bu paketler Macaly dışında
// mevcut değil. Kendi ortamınızda normal şekilde çalışır.
const config = defineConfig({
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: false,
        autoSubfolderIndex: true,
        autoStaticPathsDiscovery: true,
        crawlLinks: false,
        failOnError: true,
      },
    }),
    // Güvenlik başlıkları her cevaba (src/lib/securityHeaders.ts).
    nitro({ routeRules: { '/**': { headers: SECURITY_HEADERS } } }),
    viteReact(),
  ],
})

export default config
