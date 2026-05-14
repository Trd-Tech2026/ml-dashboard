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
  const userId = tokenData.user_id

  // Refresh proactivo del token (igual que el sync)
  try {
    const refreshed = await refreshToken(tokenData.refresh_token)
    if (refreshed.access_token) {
      token = refreshed.access_token
      // No vamos a guardar el nuevo refresh_token acá para no romper nada,
      // solo usamos el access_token nuevo en memoria
    }
  } catch (e) {
    // continúa con el token existente
  }

  // Variantes del endpoint para probar
  const variants: Record<string, string> = {
    'A_codigo_actual': `https://api.mercadolibre.com/billing/integration/periods/key/${periodKey}/summary/details?group=ML`,
    'B_group_period_details': `https://api.mercadolibre.com/billing/integration/group/ML/period/key/${periodKey}/details?limit=10`,
    'C_group_period_summary': `https://api.mercadolibre.com/billing/integration/group/ML/period/key/${periodKey}/summary`,
    'D_list_periods': `https://api.mercadolibre.com/billing/integration/group/ML/periods?limit=5`,
    'E_user_period_details': `https://api.mercadolibre.com/users/${userId}/billing_info/periods/${periodKey}/details?group=ML&limit=10`,
    'F_billing_periods_user': `https://api.mercadolibre.com/billing/integration/group/ML/periods?site_id=MLA`,
  }

  const results: any = {}

  for (const [name, url] of Object.entries(variants)) {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const status = resp.status
      let body
      try {
        body = await resp.json()
      } catch {
        body = await resp.text()
      }
      // Truncar respuestas largas para no romper el JSON
      const bodyStr = JSON.stringify(body)
      const truncated = bodyStr.length > 5000
        ? JSON.parse(bodyStr.slice(0, 5000) + '..."}')
        : body
      results[name] = { url, status, body: truncated, body_length: bodyStr.length }
    } catch (e: any) {
      results[name] = { url, error: e.message }
    }
  }

  return NextResponse.json({
    period_key: periodKey,
    token_user_id: userId,
    token_preview: token?.slice(0, 20) + '...',
    variants_tested: results,
  }, { status: 200 })
}