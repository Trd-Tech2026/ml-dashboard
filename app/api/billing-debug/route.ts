import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

async function refreshToken(refreshTokenStr: string) {
  const resp = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      refresh_token: refreshTokenStr,
    }),
  })
  return await resp.json()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const periodKey = searchParams.get('period') || '2026-04-01'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tokenData } = await supabase
    .from('ml_tokens')
    .select('*')
    .neq('access_token', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tokenData) {
    return NextResponse.json({ error: 'no token in DB' }, { status: 400 })
  }

  let token = tokenData.access_token

  // Refresh proactivo
  try {
    const refreshed = await refreshToken(tokenData.refresh_token)
    if (refreshed.access_token) token = refreshed.access_token
  } catch { /* sigue con el actual */ }

  // El endpoint correcto con el parámetro que faltaba
  const url = `https://api.mercadolibre.com/billing/integration/periods/key/${periodKey}/summary/details?group=ML&document_type=BILL`

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const status = resp.status
    const body = await resp.json()
    return NextResponse.json({
      period_key: periodKey,
      url,
      status,
      body,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, url }, { status: 500 })
  }
}