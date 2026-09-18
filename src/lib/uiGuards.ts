// Girdi sayfaları için kaynak düzeyinde denetimler.
//
// İki kural, ikisi de kullanıcının bildirdiği somut sorunlardan doğdu:
//
// 1. Hiçbir alan `onBlur`'da sessizce kaydedilmez. Kaydetmek açık bir
//    eylemdir; aksi halde kullanıcı kaydettiğini göremiyor.
// 2. Silme her zaman onay ister. Yanlış tıklama girilen veriyi geri
//    dönüşsüz siliyordu.
//
// Testler bunları JSX kaynağı üzerinde uygular, böylece yeni bir sayfa
// eklendiğinde kural kendiliğinden geçerli olur.

/** `prefix` ile başlayan her JSX prop'unun gövdesi (süslü parantez içi). */
export function handlerBodies(source: string, prop: string): string[] {
  const bodies: string[] = []
  const marker = `${prop}={`
  let index = source.indexOf(marker)
  while (index !== -1) {
    let depth = 1
    let i = index + marker.length
    const start = i
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    bodies.push(source.slice(start, i - 1))
    index = source.indexOf(marker, i)
  }
  return bodies
}

/** Gövdede sunucuya yazan bir çağrı var mı? */
export function callsMutation(body: string): boolean {
  return /\b(await|void)\s+[A-Za-z_$][\w$.]*\s*\(/.test(body)
}

/**
 * Gövde bir silme çağırıyor mu? `clearError` bir bildirimi kapatır,
 * `setEditing`/`setX` yalnızca ekran durumudur — bunlar silme değildir.
 */
export function callsDelete(body: string): boolean {
  const matches = body.match(/\b(?:await|void)\s+([A-Za-z_$][\w$]*)\s*\(/g) ?? []
  return matches.some((m) => {
    const name = m.replace(/\b(?:await|void)\s+/, '').replace(/\s*\($/, '')
    if (/^(clearError|setE|set[A-Z])/.test(name)) return false
    return /^(remove|delete|clear|discard|drop)/i.test(name)
  })
}

export function asksConfirmation(body: string): boolean {
  return body.includes('window.confirm')
}

/**
 * Onay, işleyicinin kendisinde olabileceği gibi çağırdığı yerel fonksiyonda
 * da olabilir (`onClick={() => void deleteLocation(code)}` →
 * `async function deleteLocation() { if (!window.confirm(…)) return … }`).
 * Bir seviye takip etmek bu ayrımı ortadan kaldırır.
 */
export function confirmsSomewhere(source: string, body: string): boolean {
  if (asksConfirmation(body)) return true
  const calls = body.match(/\b(?:await|void)\s+([A-Za-z_$][\w$]*)\s*\(/g) ?? []
  return calls.some((call) => {
    const name = call.replace(/\b(?:await|void)\s+/, '').replace(/\s*\($/, '')
    const declaration = new RegExp(
      `(?:async\\s+)?function\\s+${name}\\s*\\(|const\\s+${name}\\s*=`,
    )
    const match = declaration.exec(source)
    if (!match) return false
    // Bildirimden sonraki gövdeyi kabaca al: bir sonraki üst düzey kapanışa
    // kadar yeterli.
    const from = match.index
    const slice = source.slice(from, from + 1600)
    return asksConfirmation(slice)
  })
}
