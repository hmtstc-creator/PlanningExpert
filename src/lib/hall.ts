// Hol = vinç kısıtı. Aynı holdeki work center'lar setup için aynı vinci
// kullanır: planlayıcı bir holde aynı anda en çok "concurrentSetupsPerHall"
// kalıp setup'ı açar, setup'lar ve rulo değişimleri arasında ayarlardaki
// boşluğu bırakır, setup ile rulo değişimini aynı anda yapmaz.
//
// Hol isteğe bağlıdır. Holü boş olan work center hiçbir work center'la vinç
// paylaşmaz: planlayıcıya kendi adını taşıyan tek kişilik bir hol olarak
// gider. Boş hollerin hepsi aynı ("") hol sayılsaydı, birbirinden habersiz
// makineler birbirinin setup'ını bekletirdi.

/** Planlayıcının kullandığı hol anahtarı (boşsa work center'ın kendisi). */
export function craneHall(press: { name: string; hall?: string | null }): string {
  const hall = press.hall?.trim()
  return hall ? hall : `${press.name} (no hall)`
}

/** Planlayıcıya giden work center kaydı: hol anahtarı doldurulmuş. */
export function withCraneHall<T extends { name: string; hall?: string | null }>(press: T): T & { hall: string } {
  return { ...press, hall: craneHall(press) }
}
