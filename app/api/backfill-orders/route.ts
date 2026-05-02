import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

type TokenRow = {
  ml_user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
}

async function refreshToken(supabase: SupabaseClient, tokenRow: TokenRow): Promise<string | null> {
  const refreshRes = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token
    })
  })
  const refreshData = await refreshRes.json()
  if (!refreshData.access_token) return null

  const nuevoExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
  await supabase
    .from('ml_tokens')
    .update({
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
      expires_at: nuevoExpiresAt
    })
    .eq('ml_user_id', tokenRow.ml_user_id)
  return refreshData.access_token
}

function sumarMarketplaceFee(payments: any[] | undefined): number {
  if (!Array.isArray(payments)) return 0
  return payments.reduce((acc, p) => acc + Number(p.marketplace_fee ?? 0), 0)
}

function envioGratisParaComprador(detalle: any): boolean {
  const tags: string[] = detalle.shipping?.tags ?? []
  return tags.includes('mandatory_free_shipping') ||
         tags.includes('free_shipping') ||
         detalle.shipping?.cost_components?.shipping_method === 'free' ||
         false
}

async function fetchShippingCost(shippingId: string | number, token: string): Promise<number> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return 0
    const data = await res.json()
    const senderCost = data?.senders?.[0]?.cost ?? data?.senders?.cost ?? 0
    return Number(senderCost) || 0
  } catch {
    return 0
  }
}

async function fetchOrderDetail(orderId: number | string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) {
      console.log(`[backfill] Orden ${orderId} status ${res.status}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.log(`[backfill] Orden ${orderId} excepción:`, String(e))
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const chunkSize = Math.min(200, Math.max(20, parseInt(searchParams.get('chunk') ?? '100', 10)))
  const debug = searchParams.get('debug') === '1'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Token
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

  // 2. Buscar órdenes con fee=0
  const { data: ordersToFix, error: queryError } = await supabase
    .from('orders')
    .select('order_id, total_amount, status')
    .eq('marketplace_fee', 0)
    .order('date_created', { ascending: false })
    .limit(chunkSize)

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  const pendingTotal = await supabase
    .from('orders')
    .select('order_id', { count: 'exact', head: true })
    .eq('marketplace_fee', 0)

  const totalPending = pendingTotal.count ?? 0

  if (!ordersToFix || ordersToFix.length === 0) {
    return NextResponse.json({
      ok: true,
      mensaje: '✅ No hay más órdenes pendientes',
      processed: 0,
      total_pending: 0,
      done: true,
    })
  }

  console.log(`[backfill] Procesando ${ordersToFix.length} de ${totalPending} pendientes...`)

  const orderIds = ordersToFix.map(o => o.order_id)

  // Refresh preventivo si hay 401
  const firstCheck = await fetch(`https://api.mercadolibre.com/orders/${orderIds[0]}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (firstCheck.status === 401) {
    console.log('[backfill] Token vencido, refrescando...')
    const nuevoToken = await refreshToken(supabase, tokenRow)
    if (!nuevoToken) {
      return NextResponse.json({ error: 'No se pudo refrescar el token' }, { status: 401 })
    }
    token = nuevoToken
  }

  const SUB_BATCH = 20
  let processed = 0
  let errors = 0
  let updateErrors = 0
  const updates: any[] = []
  const sampleDebug: any[] = []  // 🆕 muestras para debug

  for (let i = 0; i < orderIds.length; i += SUB_BATCH) {
    const slice = orderIds.slice(i, i + SUB_BATCH)

    const detailsPromises = slice.map(id => fetchOrderDetail(id, token))
    const detalles = await Promise.all(detailsPromises)

    const shippingPromises = detalles.map((d) => {
      if (!d) return Promise.resolve(0)
      const shippingId = d.shipping?.id
      const esFree = envioGratisParaComprador(d)
      if (!shippingId || !esFree) return Promise.resolve(0)
      return fetchShippingCost(shippingId, token)
    })
    const shippingCosts = await Promise.all(shippingPromises)

    detalles.forEach((d, idx) => {
      if (!d) {
        errors++
        return
      }
      const marketplace_fee = sumarMarketplaceFee(d.payments)
      const shipping_cost = shippingCosts[idx] ?? 0
      const total = Number(d.total_amount ?? 0)
      const net_received = total - marketplace_fee - shipping_cost

      updates.push({
        order_id: d.id,
        marketplace_fee,
        shipping_cost,
        net_received,
      })

      // 🆕 guardamos los primeros 3 para devolverlos como muestra de debug
      if (debug && sampleDebug.length < 3) {
        sampleDebug.push({
          order_id: d.id,
          total,
          marketplace_fee,
          shipping_cost,
          net_received,
          payments_count: Array.isArray(d.payments) ? d.payments.length : 0,
          payments_sample: Array.isArray(d.payments) ? d.payments.map((p: any) => ({
            id: p.id,
            transaction_amount: p.transaction_amount,
            marketplace_fee: p.marketplace_fee,
            shipping_cost: p.shipping_cost,
            taxes_amount: p.taxes_amount,
          })) : null,
        })
      }
      processed++
    })
  }

  // Updates con tracking de errores
  const updateResults = await Promise.all(
    updates.map(u =>
      supabase
        .from('orders')
        .update({
          marketplace_fee: u.marketplace_fee,
          shipping_cost: u.shipping_cost,
          net_received: u.net_received,
        })
        .eq('order_id', u.order_id)
        .select('order_id')
    )
  )

  updateResults.forEach((r, idx) => {
    if (r.error) {
      console.log(`[backfill] Update error en ${updates[idx].order_id}:`, r.error.message)
      updateErrors++
    } else if (!r.data || r.data.length === 0) {
      console.log(`[backfill] Update no afectó filas: ${updates[idx].order_id}`)
      updateErrors++
    }
  })

  const remaining = Math.max(0, totalPending - processed)

  return NextResponse.json({
    ok: true,
    processed,
    fetch_errors: errors,
    update_errors: updateErrors,
    total_pending_at_start: totalPending,
    remaining,
    done: remaining === 0,
    debug_sample: debug ? sampleDebug : undefined,
    mensaje: remaining === 0
      ? `✅ Backfill completo. Procesadas: ${processed}`
      : `Procesadas ${processed}. Quedan ${remaining}. Volvé a llamar.`
  })
}