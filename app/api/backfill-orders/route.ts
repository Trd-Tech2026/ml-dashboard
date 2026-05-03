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

async function fetchShippingData(shippingId: string | number, token: string) {
  try {
    const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return { costoSeller: 0, bonificacion: 0 }
    const data = await res.json()

    const costoSeller = Number(data?.senders?.[0]?.cost ?? data?.senders?.cost ?? 0)
    const discounts = data?.receiver?.discounts ?? []
    const bonificacion = Array.isArray(discounts)
      ? discounts.reduce((acc: number, d: any) => acc + Number(d.promoted_amount ?? 0), 0)
      : 0

    return { costoSeller, bonificacion }
  } catch {
    return { costoSeller: 0, bonificacion: 0 }
  }
}

function calcularComponentesPagos(payments: any[]) {
  let comision = 0
  let impuestos = 0

  for (const mp of payments) {
    if (!mp) continue
    const charges = mp.charges_details ?? []
    for (const c of charges) {
      const amount = Number(c.amounts?.original ?? 0)
      if (c.type === 'fee') comision += amount
      else if (c.type === 'tax') impuestos += amount
    }
    const feeDetails = mp.fee_details ?? []
    for (const f of feeDetails) {
      if (f.fee_payer === 'collector') {
        comision += Number(f.amount ?? 0)
      }
    }
  }

  return { comision, impuestos }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const chunkSize = Math.min(200, Math.max(10, parseInt(searchParams.get('chunk') ?? '50', 10)))

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

  // Buscar órdenes paid donde net_received >= total_amount (no procesadas con la nueva lógica)
  const { data: ordersToFix } = await supabase
    .from('orders')
    .select('order_id, total_amount, status, net_received')
    .eq('status', 'paid')
    .order('date_created', { ascending: false })
    .limit(chunkSize * 3)

  const orders = (ordersToFix ?? [])
    .filter(o => Number(o.net_received ?? 0) >= Number(o.total_amount ?? 0))
    .slice(0, chunkSize)

  if (orders.length === 0) {
    return NextResponse.json({
      ok: true,
      mensaje: '✅ No hay más órdenes pendientes',
      processed: 0,
      done: true,
    })
  }

  console.log(`[backfill] Procesando ${orders.length}...`)

  const firstCheck = await fetch(`https://api.mercadolibre.com/orders/${orders[0].order_id}`, {
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

  const SUB_BATCH = 10
  let processed = 0
  let fetchErrors = 0
  let updateErrors = 0

  for (let i = 0; i < orders.length; i += SUB_BATCH) {
    const slice = orders.slice(i, i + SUB_BATCH)

    const updates = await Promise.all(slice.map(async (o) => {
      const orderDetail = await fetchMLOrder(o.order_id, token)
      if (!orderDetail) {
        fetchErrors++
        return null
      }

      const total = Number(o.total_amount ?? 0)

      const paymentIds = (orderDetail.payments ?? []).map((p: any) => p.id).filter(Boolean)
      const mpPayments = await Promise.all(
        paymentIds.map((id: any) => fetchMPPayment(id, token))
      )
      const validMp = mpPayments.filter(Boolean)

      if (validMp.length === 0) {
        fetchErrors++
        return null
      }

      // Datos de envío
      let costoSeller = 0
      let bonificacion = 0
      if (orderDetail.shipping?.id) {
        const ship = await fetchShippingData(orderDetail.shipping.id, token)
        costoSeller = ship.costoSeller
        bonificacion = ship.bonificacion
      }

      const { comision, impuestos } = calcularComponentesPagos(validMp)

      // Recibís = total - comisión - impuestos - costo_envío + bonificación
      const net_received = total - comision - impuestos - costoSeller + bonificacion

      return {
        order_id: o.order_id,
        marketplace_fee: comision + impuestos,
        shipping_cost: costoSeller,
        discounts: bonificacion,
        net_received,
      }
    }))

    const validUpdates = updates.filter((u): u is NonNullable<typeof u> => u !== null)

    const updateResults = await Promise.all(
      validUpdates.map(u =>
        supabase
          .from('orders')
          .update({
            marketplace_fee: u.marketplace_fee,
            shipping_cost: u.shipping_cost,
            discounts: u.discounts,
            net_received: u.net_received,
          })
          .eq('order_id', u.order_id)
          .select('order_id')
      )
    )

    updateResults.forEach((r, idx) => {
      if (r.error || !r.data || r.data.length === 0) {
        updateErrors++
      } else {
        processed++
      }
    })
  }

  return NextResponse.json({
    ok: true,
    processed,
    fetch_errors: fetchErrors,
    update_errors: updateErrors,
    mensaje: `Procesadas ${processed}. Si quedan más, volvé a llamar.`
  })
}