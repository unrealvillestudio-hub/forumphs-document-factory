import { NextRequest, NextResponse } from 'next/server';

const EF_URL = 'https://amlvyycfepwhiindxgzw.supabase.co/functions/v1/fphs-bi-data';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const building_id = searchParams.get('building_id');
  const period = searchParams.get('period');

  if (!building_id) return NextResponse.json({ error: 'building_id requerido' }, { status: 400 });

  const params = new URLSearchParams({ building_id });
  if (period) params.set('period', period);

  try {
    const r = await fetch(`${EF_URL}?${params.toString()}`);
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
