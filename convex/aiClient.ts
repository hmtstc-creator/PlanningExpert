/**
 * Yapay zekâ istemcisi (OEE açık konular ve Agent Insights ortak kullanır).
 *
 * OpenAI uyumlu herhangi bir sohbet API'si (ücretsiz katman, ör. Google Gemini
 * ya da Groq). Ayar kendi sunucumuzdaki (self-hosted) Convex'in ortam
 * değişkenleridir (docs/deployment.md → OEE açık konular) — kodda ve
 * veritabanında değil:
 *
 *   AI_API_KEY   anahtar (yoksa kurallar karar verir)
 *   AI_API_URL   (isteğe bağlı) …/chat/completions; varsayılan Gemini
 *   AI_MODEL     (isteğe bağlı) model adı; varsayılan gemini-flash-latest
 */

const AI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const AI_MODEL = 'gemini-flash-latest'

export const aiConfigured = () => !!process.env.AI_API_KEY

export const aiModel = () => process.env.AI_MODEL || AI_MODEL

/** Cevap metni ya da null; `note` sayfada görünen kısa durum. Hata fırlatmaz. */
export async function askJson(system: string, user: string, timeoutMs: number): Promise<{ answer: string | null; note: string }> {
  const key = process.env.AI_API_KEY
  if (!key) return { answer: null, note: 'AI not set up (AI_API_KEY) — the rules decided' }
  const model = aiModel()
  try {
    const res = await fetch(process.env.AI_API_URL || AI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) return { answer: null, note: `AI answered ${res.status} — the rules decided: ${(await res.text()).slice(0, 120)}` }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json()
    const answer = json?.choices?.[0]?.message?.content
    return typeof answer === 'string' ? { answer, note: `AI (${model})` } : { answer: null, note: 'AI gave no answer — the rules decided' }
  } catch (e) {
    return { answer: null, note: `AI failed — the rules decided: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }
  }
}
