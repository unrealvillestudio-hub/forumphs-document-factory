/**
 * /api/qa/route.ts
 * Runs the full QA scan on the assembled acta text.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { QAScanResponse } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<NextResponse<QAScanResponse>> {
  try {
    const { text }: { text: string } = await req.json()
    if (!text) return NextResponse.json({ success: false, error: 'No text provided' }, { status: 400 })

    const { runQAScan } = await import('@/lib/processors/qaScanner')
    const report = runQAScan(text)

    return NextResponse.json({ success: true, report })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
