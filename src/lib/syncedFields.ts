// Sunucudan gelen değerleri forma yansıtırken kullanıcının yazdığını
// silmemek için.
//
// Sorun: form alanları sunucu verisinden dolduruluyordu ve sorgu her
// tazelendiğinde (WebSocket yeniden bağlandığında ya da HTTPS yedek modunda
// her 20 saniyede bir) tüm alanlar sunucudaki eski değere geri dönüyordu —
// kullanıcı yazarken elinden alınıyordu.
//
// Çözüm: ilk yüklemede hepsini uygula, sonrasında yalnızca SUNUCU TARAFINDA
// gerçekten değişmiş alanları uygula. Böylece başka bir cihaz bir ayarı
// değiştirirse yansır, ama aynı veri tekrar geldiğinde forma dokunulmaz.

/**
 * `prev` ile `next` arasında değişmiş alan adlarını verir.
 * `prev` null ise (ilk yükleme) tüm alanlar değişmiş sayılır.
 */
export function changedFields<T extends Record<string, unknown>>(
  prev: T | null,
  next: T,
): (keyof T)[] {
  const keys = Object.keys(next) as (keyof T)[]
  if (prev === null) return keys
  return keys.filter((key) => !Object.is(prev[key], next[key]))
}
