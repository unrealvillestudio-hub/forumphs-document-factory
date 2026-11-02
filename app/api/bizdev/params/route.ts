/** GET /api/bizdev/params — versión vigente de fphs_fee_params (unrlvl-db), normalizada. */
import { currentParamsRow, errorResponse } from '@/lib/bizdev/db'
import { normalizeParams } from '@/lib/bizdev/feeModel'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return Response.json({ params: normalizeParams(await currentParamsRow()) })
  } catch (e) { return errorResponse(e) }
}
