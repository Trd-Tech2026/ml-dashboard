// app/api/billing/route.ts
//
// Endpoint para sincronizar y consultar percepciones mensuales de ML.
//
// GET /api/billing                    → mes actual (cacheado 24hs)
// GET /api/billing?period=2026-04-01  → mes específico
// GET /api/billing?refresh=1          → forzar refresh contra ML

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  getCachedOrFetch,
  currentPeriodKey,
} from '../../lib/ml-billing'

export const maxDuration = 60

type TokenRow = {
  ml_user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
}

async function refreshToken(supabase: SupabaseClient, tokenRow: TokenRow): Promise<string | null> {
  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token,
    }),
  })
  const data = await res.json()
  if (!data.access_token) return null
  const nuevoExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  await supabase
    .from('ml_tokens')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: nuevoExpiresAt,
    })
    .eq('ml_user_id', tokenRow.ml_user_id)
  return data.access_token
}

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ error: 'No hay token de ML' }, { status: 401 })
  }

  const tokenRow = tokenData as TokenRow
  let token = tokenRow.access_token

  // Refresh proactivo si el token está cerca de vencer
  const expiresAt = new Date(tokenRow.expires_at).getTime()
  if (Date.now() + 5 * 60 * 1000 >= expiresAt) {
    const nuevo = await refreshToken(supabase, tokenRow)
    if (nuevo) token = nuevo
  }

  const periodKey = req.nextUrl.searchParams.get('period') ?? currentPeriodKey()
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'

  try {
    let breakdown = await getCachedOrFetch(supabase, token, periodKey, forceRefresh)
    return NextResponse.json({ ok: true, period: periodKey, breakdown })
  } catch (e: any) {
    // Si el error fue 401, intentar refresh y reintentar UNA vez
    if (String(e?.message ?? '').includes('401')) {
      const nuevo = await refreshToken(supabase, tokenRow)
      if (nuevo) {
        try {
          const breakdown = await getCachedOrFetch(supabase, nuevo, periodKey, true)
          return NextResponse.json({ ok: true, period: periodKey, breakdown })
        } catch (e2: any) {
          return NextResponse.json({ error: e2.message ?? 'Error' }, { status: 500 })
        }
      }
    }
    return NextResponse.json({ error: e.message ?? 'Error' }, { status: 500 })
  }
}