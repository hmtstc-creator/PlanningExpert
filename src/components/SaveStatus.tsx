/**
 * Bir satırın kayıt durumu.
 *
 * Kaydedilip kaydedilmediğini görememek, kullanıcının bu programda
 * bildirdiği somut bir sorundu: alanlar sessizce kaydediliyor, hiçbir şey
 * olmuyormuş gibi görünüyordu. Her düzenlenebilir satır bunu göstermeli.
 */
export function SaveStatus({
  dirty,
  saving,
  justSaved,
}: {
  dirty: boolean
  saving: boolean
  justSaved: boolean
}) {
  if (saving) return <span className="text-xs text-muted-foreground">Saving…</span>
  if (dirty) return <span className="text-xs font-medium text-amber-700">● Unsaved</span>
  if (justSaved) return <span className="text-xs font-medium text-emerald-700">✓ Saved</span>
  return <span className="text-xs text-muted-foreground">Saved</span>
}
