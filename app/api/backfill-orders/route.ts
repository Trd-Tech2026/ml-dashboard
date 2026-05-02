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

async function fetchMLOrder(orderId: number | string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return null
    return await res.json()
  } catch {
    return null
  }
}

async function fetchMPPayment(paymentId: number | string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return null
    return await res.json()
  } catch {
    return null
  }
}

function envioGratisParaComprador(detalle: any): boolean {
  const tags: string[] = detalle?.shipping?.tags ?? []
  return tags.includes('mandatory_free_shipping') ||
         tags.includes('free_shipping') ||
         detalle?.shipping?.cost_components?.shipping_method === 'free' ||
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const chunkSize = Math.min(200, Math.max(10, parseInt(searchParams.get('chunk') ?? '50', 10)))
  const debug = searchParams.get('debug') === '1'

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
    return NextResponse.json({ error: 'No hay token' }, { status: 401 })
  }

  const tokenRow = tokenData as TokenRow
  let token = tokenRow.access_token

  // Buscar órdenes pagadas que aún no tengan marketplace_fee cargado
  const { data: ordersToFix, error: queryError } = await supabase
    .from('orders')
    .select('order_id, total_amount, status')
    .eq('marketplace_fee', 0)
    .eq('status', 'paid')
    .order('date_created', { ascending: false })
    .limit(chunkSize)

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  const orders = ordersToFix ?? []

  // Total pendientes (todas las paid sin fee)
  const { count: totalPending } = await supabase
    .from('orders')
    .select('order_id', { count: 'exact', head: true })
    .eq('marketplace_fee', 0)
    .eq('status', 'paid')

  if (orders.length === 0) {
    return NextResponse.json({
      ok: true,
      mensaje: '✅ No hay más órdenes pendientes',
      processed: 0,
      total_pending: 0,
      done: true,
    })
  }

  console.log(`[backfill-mp] Procesando ${orders.length} de ${totalPending ?? '?'} pendientes...`)

  // Refresh preventivo
  const firstCheck = await fetch(`https://api.mercadolibre.com/orders/${orders[0].order_id}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (firstCheck.status === 401) {
    console.log('[backfill-mp] Token vencido, refrescando...')
    const nuevoToken = await refreshToken(supabase, tokenRow)
    if (!nuevoToken) {
      return NextResponse.json({ error: 'No se pudo refrescar el token' }, { status: 401 })
    }
    token = nuevoToken
  }

  const SUB_BATCH = 10
  let processed = 0
  let fetchErrors = 0
  let updateErrors = 0
  const sampleDebug: any[] = []

  for (let i = 0; i < orders.length; i += SUB_BATCH) {
    const slice = orders.slice(i, i + SUB_BATCH)

    const updates = await Promise.all(slice.map(async (o) => {
      const orderDetail = await fetchMLOrder(o.order_id, token)
      if (!orderDetail) {
        fetchErrors++
        return null
      }

      const payments = orderDetail.payments ?? []
      let total_marketplace_fee = 0
      let total_net_received = 0
      let total_payments_amount = 0

      for (const p of payments) {
        if (!p.id) continue
        const mp = await fetchMPPayment(p.id, token)
        if (!mp) continue

        const feesCollector = (mp.fee_details ?? [])
          .filter((f: any) => f.fee_payer === 'collector')
          .reduce((acc: number, f: any) => acc + Number(f.amount ?? 0), 0)

        const taxesCollector = (mp.charges_details ?? [])
          .filter((c: any) =>
            c.metadata?.mov_detail === 'tax_withholding_collector' ||
            (c.type === 'tax' && c.accounts?.from === 'collector')
          )
          .reduce((acc: number, c: any) => acc + Number(c.amounts?.original ?? 0), 0)

        total_marketplace_fee += feesCollector + taxesCollector
        total_net_received += Number(mp.transaction_details?.net_received_amount ?? mp.transaction_amount ?? 0)
        total_payments_amount += Number(mp.transaction_amount ?? 0)
      }

      let shipping_cost = 0
      const shippingId = orderDetail.shipping?.id
      if (shippingId && envioGratisParaComprador(orderDetail)) {
        shipping_cost = await fetchShippingCost(shippingId, token)
      }

      const total = Number(o.total_amount ?? 0)
      const net_received = total_net_received - shipping_cost

      const update = {
        order_id: o.order_id,
        marketplace_fee: total_marketplace_fee,
        shipping_cost,
        net_received,
      }

      if (debug && sampleDebug.length < 3) {
        sampleDebug.push({
          ...update,
          total,
          total_payments_amount,
          payments_count: payments.length,
        })
      }

      return update
    }))

    const validUpdates = updates.filter((u): u is NonNullable<typeof u> => u !== null)

    const updateResults = await Promise.all(
      validUpdates.map(u =>
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
      if (r.error || !r.data || r.data.length === 0) {
        console.log(`[backfill-mp] Update error en ${validUpdates[idx].order_id}:`, r.error?.message)
        updateErrors++
      } else {
        processed++
      }
    })
  }

  const remaining = Math.max(0, (totalPending ?? 0) - processed)

  return NextResponse.json({
    ok: true,
    processed,
    fetch_errors: fetchErrors,
    update_errors: updateErrors,
    total_pending_at_start: totalPending ?? 0,
    remaining,
    done: remaining === 0,
    debug_sample: debug ? sampleDebug : undefined,
    mensaje: remaining === 0
      ? `✅ Backfill completo. Procesadas: ${processed}`
      : `Procesadas ${processed}. Quedan ${remaining}. Volvé a llamar.`
  })
}