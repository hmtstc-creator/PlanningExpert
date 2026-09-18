import { Component, type ReactNode } from 'react'

/**
 * Tek bir bölümün sorgu hatasını yakalar; sayfanın tamamı beyaz ekrana
 * düşmez. Teşhis sayfası için kritik: backend'e henüz deploy edilmemiş bir
 * fonksiyon çağrıldığında hata mesajı görünmeli, sayfa çökmemeli.
 */
export class QueryCatcher extends Component<
  { children: ReactNode; label: string },
  { error: string | null }
> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  render() {
    if (this.state.error !== null) {
      const missingFunction = /could not find public function|does not exist/i.test(
        this.state.error,
      )
      return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">
            {this.props.label} could not be loaded
          </p>
          <p className="mt-1 break-words text-xs text-destructive/90">
            {this.state.error}
          </p>
          {missingFunction && (
            <p className="mt-2 text-xs text-destructive/90">
              This function has not been pushed to the database yet. The site was
              updated to a new version but the Convex functions were not deployed —
              the Vercel build command must run <code>npx convex deploy</code>.
            </p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
