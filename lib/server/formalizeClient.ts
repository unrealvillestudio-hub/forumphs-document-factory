/**
 * formalizeClient.ts — SERVER-ONLY client for the fphs-formalize Edge Function.
 *
 * The single place where the shared secret (FPHS_FORMALIZE_SECRET) is attached
 * to a call to the EF. The EF rejects any request without a matching
 * `x-formalize-secret` header (see supabase/functions/fphs-formalize/index.ts),
 * so every legitimate caller funnels through here:
 *   • the browser Console       → POSTs /api/formalize → callFormalizeEF()
 *   • reprocessPending (server)  → callFormalizeEF() directly (trusted loop)
 *
 * The secret lives in a NON-public env var (never NEXT_PUBLIC_), so it is only
 * ever present server-side and is never shipped in the client bundle. That is
 * the whole point of the proxy: a secret the browser could read would not be a
 * secret. Do NOT import this module from a Client Component.
 */

const EF_URL =
  process.env.FPHS_FORMALIZE_URL ||
  'https://amlvyycfepwhiindxgzw.supabase.co/functions/v1/fphs-formalize'

const SHARED_SECRET = process.env.FPHS_FORMALIZE_SECRET || ''

/**
 * POST a payload to the fphs-formalize EF with the shared-secret header.
 * Returns the raw Response so callers can forward status + body faithfully —
 * the browser Console relies on the EF's 503 to drive its own retry loop.
 */
export async function callFormalizeEF(
  payload: unknown,
  opts: { signal?: AbortSignal } = {},
): Promise<Response> {
  if (!SHARED_SECRET) {
    // Fail loud (never silent): without the secret the EF will 401 once the
    // gate is live. Surface it in server logs instead of hiding the cause.
    console.error(
      '[formalizeClient] FPHS_FORMALIZE_SECRET is not set — calls will be rejected by the EF once the secret gate is deployed.',
    )
  }
  return fetch(EF_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-formalize-secret': SHARED_SECRET,
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  })
}
