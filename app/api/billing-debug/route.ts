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
  const periodKey = searchParams.get('period') || '2026-05-01'

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
  try {
    const refreshed = await refreshToken(tokenData.refresh_token)
    if (refreshed.access_token) token = refreshed.access_token
  } catch {}

  // Variantes para encontrar el endpoint que tiene "percepciones aproximadas" del mes en curso
  const variants: Record<string, string> = {
    'A_summary_solo':            `https://api.mercadolibre.com/billing/integration/periods/key/${periodKey}/summary?group=ML`,
    'B_summary_details_sin_doc': `https://api.mercadolibre.com/billing/integration/periods/key/${periodKey}/summary/details?group=ML`,
    'C_summary_details_NC':      `https://api.mercadolibre.com/billing/integration/periods/key/${periodKey}/summary/details?group=ML&document_type=CREDIT_NOTE`,
    'D_period_listado':          `https://api.mercadolibre.com/billing/integration/periods?group=ML&document_type=BILL&limit=3`,
    'E_monthly_periods':         `https://api.mercadolibre.com/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=3`,
  }

  const results: any = {}

  for (const [name, url] of Object.entries(variants)) {
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const status = resp.status
      let body
      try { body = await resp.json() } catch { body = await resp.text() }
      const bodyStr = JSON.stringify(body)
      results[name] = {
        url,
        status,
        body_length: bodyStr.length,
        body: bodyStr.length > 8000 ? JSON.parse(bodyStr.slice(0, 8000) + '..."}') : body,
      }
    } catch (e: any) {
      results[name] = { url, error: e.message }
    }
  }

  return NextResponse.json({
    period_key: periodKey,
    note: 'Buscando endpoint con "percepciones aproximadas" del mes en curso',
    variants_tested: results,
  })
}