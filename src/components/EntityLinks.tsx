import { Link } from '@tanstack/react-router'

import { useCanOpen } from '../lib/plantContext'

/**
 * Kayıtlar arası bağ: bir parça kodu ya da work center adı geçtiği her yerde
 * tanımına götürür (Master Data'da o parça, Work Center Definitions'ta o
 * work center). Sayfayı açamayan kullanıcıya düz metin.
 */
export function MaterialLink({ code, className = '' }: { code: string; className?: string }) {
  const canOpen = useCanOpen()
  if (!code || !canOpen('/referanslar')) return <span className={className}>{code}</span>
  return (
    <Link to="/referanslar" search={{ q: code }} className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${className}`} title={`Open ${code} in Master Data`}>
      {code}
    </Link>
  )
}

export function WorkCenterLink({ name, className = '' }: { name: string; className?: string }) {
  const canOpen = useCanOpen()
  if (!name || !canOpen('/makineler')) return <span className={className}>{name}</span>
  return (
    <Link to="/makineler" search={{ wc: name }} className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${className}`} title={`Open ${name} in Work Center Definitions`}>
      {name}
    </Link>
  )
}
