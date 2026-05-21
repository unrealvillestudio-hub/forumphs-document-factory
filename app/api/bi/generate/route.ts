import { NextRequest, NextResponse } from 'next/server';

// fphs-bi-report Edge Function — deployed on UNRLVL Supabase (amlvyycfepwhiindxgzw)
const EF_URL = 'https://amlvyycfepwhiindxgzw.supabase.co/functions/v1/fphs-bi-report';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const r = await fetch(EF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
