import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

type TokenRow = {
  ml_user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
}

function toMLDate(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input
  return d.toISOString().replace('Z', '-00:00')
}

async function refreshToken(supabase: SupabaseClient, tokenRow: TokenRow): Promise<string | null> {
  console.log('Refrescando token...')
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
  if (!refreshData.access_token) {
    console.log('Refresh falló:', JSON.stringify(refreshData))
    return null
  }
  const nuevoExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
  await supabase
    .from('ml_tokens')
    .update({
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
      expires_at: nuevoExpiresAt
    })
    .eq('ml_user_id', tokenRow.ml_user_id)
  console.log('Token refrescado OK')
  return refreshData.access_token
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

// Calcula los componentes financieros de un pago a partir de charges_details
function calcularComponentes(mp: any) {
  const charges = mp?.charges_details ?? []
  let comision_ml = 0
  let impuestos = 0
  let envio = 0

  for (const c of charges) {
    const amount = Number(c.amounts?.original ?? 0)
    const tipo = c.type
    if (tipo === 'fee') {
      comision_ml += amount
    } else if (tipo === 'tax') {
      impuestos += amount
    } else if (tipo === 'shipping') {
      envio += amount
    }
  }

  // Sumar también fee_details con fee_payer = collector (por si acaso)
  const feeDetails = mp?.fee_details ?? []
  for (const f of feeDetails) {
    if (f.fee_payer === 'collector') {
      comision_ml += Number(f.amount ?? 0)
    }
  }

  // Bonificaciones / descuentos a favor del vendedor
  // (cuando hay un coupon_amount aportado por ML, beneficia al vendedor)
  const discounts = Number(mp?.coupon_amount ?? 0)

  // Net received: usamos el dato directo que MP calcula al peso
  const net_received = Number(mp?.transaction_details?.net_received_amount ?? mp?.transaction_amount ?? 0)
  const transaction_amount = Number(mp?.transaction_amount ?? 0)

  return {
    transaction_amount,
    comision_ml,
    impuestos,
    envio,
    discounts,
    net_received,
  }
}

export async function GET() {
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
    return NextResponse.json({ error: 'No hay token de ML. Hacé login primero.' }, { status: 401 })
  }

  const tokenRow = tokenData as TokenRow
  let token = tokenRow.access_token
  const sellerId = tokenRow.ml_user_id

  const { data: syncStateData } = await supabase
    .from('sync_state')
    .select('last_sync_at')
    .eq('id', 1)
    .maybeSingle()

  const lastSyncAt: string | null = syncStateData?.last_sync_at ?? null
  const inicioSync = new Date().toISOString()

  const LIMIT = 50
  const MAX_PAGES = 100

  const buildUrl = (offset: number): { url: string; modo: string } => {
    const params = new URLSearchParams({
      seller: sellerId,
      sort: 'date_desc',
      limit: String(LIMIT),
      offset: String(offset),
    })
    let modo: string
    if (lastSyncAt) {
      params.set('order.date_last_updated.from', toMLDate(lastSyncAt))
      modo = 'incremental'
    } else {
      const desde = new Date()
      desde.setDate(desde.getDate() - 90)
      params.set('order.date_created.from', toMLDate(desde))
      modo = 'inicial-90d'
    }
    return {
      url: `https://api.mercadolibre.com/orders/search?${params.toString()}`,
      modo
    }
  }

  let offset = 0
  let sincronizadas = 0
  let totalDisponible = 0
  let pagina = 0
  let huboError = false
  let yaRefresque = false
  let modoSync = ''

  while (pagina < MAX_PAGES) {
    pagina++

    const { url, modo } = buildUrl(offset)
    modoSync = modo

    let ordersRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    let ordersData = await ordersRes.json()

    if (ordersRes.status === 401 && !yaRefresque) {
      console.log('Token rechazado por ML, intentando refresh...')
      const nuevoToken = await refreshToken(supabase, tokenRow)
      if (!nuevoToken) {
        return NextResponse.json({ error: 'No se pudo refrescar el token. Hacé login de nuevo.' }, { status: 401 })
      }
      token = nuevoToken
      yaRefresque = true
      ordersRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      ordersData = await ordersRes.json()
    }

    if (ordersRes.status !== 200) {
      console.log('ML error en página', pagina, ':', JSON.stringify(ordersData))
      huboError = true
      break
    }

    if (pagina === 1) {
      totalDisponible = ordersData.paging?.total ?? 0
      console.log(`Total a sincronizar (modo: ${modoSync}): ${totalDisponible}`)
    }

    const results = ordersData.results ?? []
    if (results.length === 0) break

    // Para cada orden, consultar todos sus payments en MP en paralelo
    const ordersConFinanzas = await Promise.all(results.map(async (order: any) => {
      const payments = order.payments ?? []
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

      return {
        order,
        marketplace_fee: comision_ml + impuestos,  // todo lo que se queda ML/AFIP
        shipping_cost: envio,
        discounts,
        net_received: mpOk ? net_received : 0,
      }
    }))

    const ordersToInsert = ordersConFinanzas.map(({ order, marketplace_fee, shipping_cost, discounts, net_received }) => ({
      order_id: order.id,
      status: order.status,
      total_amount: Number(order.total_amount ?? 0),
      currency: order.currency_id,
      buyer_id: order.buyer.id,
      buyer_nickname: order.buyer.nickname,
      date_created: order.date_created,
      date_closed: order.date_closed,
      cancel_reason: order.cancel_detail?.description ?? null,
      marketplace_fee,
      shipping_cost,
      discounts,
      net_received,
    }))

    const itemsToInsert = results.flatMap((order: any) =>
      order.order_items.map((item: any) => ({
        order_id: order.id,
        item_id: item.item.id,
        title: item.item.title,
        quantity: item.quantity,
        unit_price: item.unit_price
      }))
    )

    const { error: ordersError } = await supabase
      .from('orders')
      .upsert(ordersToInsert, { onConflict: 'order_id' })

    if (ordersError) {
      console.log('Bulk orders upsert error:', JSON.stringify(ordersError))
      huboError = true
      break
    }

    if (itemsToInsert.length > 0) {
      const { error: itemsError } = await supabase
        .from('order_items')
        .upsert(itemsToInsert, { onConflict: 'order_id,item_id' })

      if (itemsError) {
        console.log('Bulk items upsert error:', JSON.stringify(itemsError))
      }
    }

    sincronizadas += results.length
    console.log(`Página ${pagina} OK — ${sincronizadas}/${totalDisponible}`)

    if (results.length < LIMIT) break
    offset += LIMIT
  }

  if (!huboError) {
    await supabase
      .from('sync_state')
      .update({ last_sync_at: inicioSync, updated_at: new Date().toISOString() })
      .eq('id', 1)
  }

  return NextResponse.json({
    ok: !huboError,
    modo: modoSync,
    desde: lastSyncAt,
    mensaje: `${sincronizadas} órdenes sincronizadas (${modoSync})`,
    total_disponible: totalDisponible,
    paginas_procesadas: pagina,
    refresh_aplicado: yaRefresque
  })
}