import { NextRequest, NextResponse } from 'next/server';

const EF_URL = 'https://amlvyycfepwhiindxgzw.supabase.co/functions/v1/fphs-bi-status';

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const r = await fetch(EF_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
