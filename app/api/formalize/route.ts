/**
 * /api/formalize — server proxy in front of the fphs-formalize Edge Function.
 *
 * WHY THIS EXISTS (T3 §3.1): the EF was public (verify_jwt:false, no auth), so
 * anyone with the URL could POST blocks and burn Anthropic credits. The EF now
 * requires a shared secret (`x-formalize-secret`). The browser Console CANNOT
 * hold that secret (it would ship in the JS bundle), so it POSTs here instead;
 * this route runs server-side, attaches the secret via callFormalizeEF(), and
 * forwards the EF response verbatim.
 *
 * RATE-LIMIT HOOK: this route is the single choke point for UNTRUSTED browser
 * traffic and the intended home of per-IP / per-session rate limiting. It is
 * NOT implemented yet — T3 only leaves the seam. Closing auth stops the
 * stranger; the rate limit is what caps abuse from someone who does have the
 * secret. Add the limiter in the marked block below, before callFormalizeEF().
 * The trusted server loop (reprocessPending) calls callFormalizeEF() directly
 * and intentionally bypasses this route, so it is never rate-limited.
 */
import { NextRequest } from 'next/server'
import { callFormalizeEF } from '@/lib/server/formalizeClient'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  // ── RATE-LIMIT HOOK (T3 §3.1 — not implemented; leave the seam) ────────────
  // const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  // if (await isRateLimited(ip)) {
  //   return new Response(JSON.stringify({ error: 'rate_limited' }), {
  //     status: 429, headers: { 'Content-Type': 'application/json' },
  //   })
  // }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const efRes = await callFormalizeEF(payload)
    // Forward status + body verbatim so the Console's retry logic (which keys on
    // the EF's 503) keeps working through the proxy.
    const bodyText = await efRes.text()
    return new Response(bodyText, {
      status: efRes.status,
      headers: {
        'Content-Type': efRes.headers.get('Content-Type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('[api/formalize] proxy error:', err)
    return new Response(
      JSON.stringify({ error: 'formalize proxy failed', detail: String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
