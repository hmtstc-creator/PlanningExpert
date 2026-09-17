import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    nitro(),
    viteReact(),
  ],
})

export default config
