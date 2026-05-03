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

function calcularComponentes(mp: any) {
  const charges = mp?.charges_details ?? []
  let comision_ml = 0
  let impuestos = 0
  let envio = 0

  for (const c of charges) {
    const amount = Number(c.amounts?.original ?? 0)
    const tipo = c.type
    if (tipo === 'fee') comision_ml += amount
    else if (tipo === 'tax') impuestos += amount
    else if (tipo === 'shipping') envio += amount
  }

  const feeDetails = mp?.fee_details ?? []
  for (const f of feeDetails) {
    if (f.fee_payer === 'collector') {
      comision_ml += Number(f.amount ?? 0)
    }
  }

  const discounts = Number(mp?.coupon_amount ?? 0)
  const net_received = Number(mp?.transaction_details?.net_received_amount ?? mp?.transaction_amount ?? 0)
  const transaction_amount = Number(mp?.transaction_amount ?? 0)

  return { transaction_amount, comision_ml, impuestos, envio, discounts, net_received }
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

  // Buscar paid pendientes (net_received >= total_amount significa que aún no se procesó bien)
  const { data: ordersToFix } = await supabase
    .from('orders')
    .select('order_id, total_amount, status, net_received')
    .eq('status', 'paid')
    .gte('net_received', 0)
    .order('date_created', { ascending: false })
    .limit(chunkSize * 3)  // traemos más y filtramos en JS

  const orders = (ordersToFix ?? [])
    .filter(o => Number(o.net_received ?? 0) >= Number(o.total_amount ?? 0))
    .slice(0, chunkSize)

  // Total pendientes
  const { count: totalPending } = await supabase
    .from('orders')
    .select('order_id', { count: 'exact', head: true })
    .eq('status', 'paid')

  if (orders.length === 0) {
    return NextResponse.json({
      ok: true,
      mensaje: '✅ No hay más órdenes pendientes',
      processed: 0,
      done: true,
    })
  }

  console.log(`[backfill-mp] Procesando ${orders.length}...`)

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

  for (let i = 0; i < orders.length; i += SUB_BATCH) {
    const slice = orders.slice(i, i + SUB_BATCH)

    const updates = await Promise.all(slice.map(async (o) => {
      const orderDetail = await fetchMLOrder(o.order_id, token)
      if (!orderDetail) {
        fetchErrors++
        return null
      }

      const payments = orderDetail.payments ?? []
      let comision_ml = 0
      let impuestos = 0
      let envio = 0
      let discounts = 0
      let net_received = 0
      let mpOk = false

      for (const p of payments) {
        if (!p.id) continue
        const mp = await fetchMPPayment(p.id, token)
        if (!mp) continue
        mpOk = true
        const comp = calcularComponentes(mp)
        comision_ml += comp.comision_ml
        impuestos += comp.impuestos
        envio += comp.envio
        discounts += comp.discounts
        net_received += comp.net_received
      }

      if (!mpOk) {
        fetchErrors++
        return null
      }

      return {
        order_id: o.order_id,
        marketplace_fee: comision_ml + impuestos,
        shipping_cost: envio,
        discounts,
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