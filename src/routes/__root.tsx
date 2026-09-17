import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import '../styles.css'
import siteMetadata from '../metadata.json'
import { Header } from '../components/Header'
import AppConvexProvider from '@/components/convex-client-provider'

const rootMeta = siteMetadata['/']

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: rootMeta.title },
      { name: 'description', content: rootMeta.description },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'manifest', href: '/manifest.json' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <AppConvexProvider>
          <Header />
          {children}
        </AppConvexProvider>
        <Scripts />
      </body>
    </html>
  )
}
