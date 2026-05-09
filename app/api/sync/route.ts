import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

// 🔥 Costo Flex promedio ponderado (calculado de SOLDATTI semana 20-25 abril)
// CABA $2900 + 1er $3700 + 2do $4300 + 3er $6600 + Camp/Zara $7300
// Mañana se reemplaza por lógica por zona (tabla flex_shipping_costs)
const COSTO_FLEX_PROMEDIO = 4040

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
    if (res.status !== 200) return { bonificacionReceiver: 0, envioCobradoCliente: 0 }
    const data = await res.json()

    const receiverDiscounts = data?.receiver?.discounts ?? []
    const senderDiscounts = data?.senders?.[0]?.discounts ?? []

    const bonifLoyal = Array.isArray(receiverDiscounts)
      ? receiverDiscounts
          .filter((d: any) => d.type === 'loyal')
          .reduce((acc: number, d: any) => acc + Number(d.promoted_amount ?? 0), 0)
      : 0

    const bonifMandatory = Array.isArray(senderDiscounts)
      ? senderDiscounts
          .filter((d: any) => d.type === 'mandatory')
          .reduce((acc: number, d: any) => acc + Number(d.promoted_amount ?? 0), 0)
      : 0

    // 🔥 Lo que el cliente pagó por envío - ML te transfiere ese dinero
    const envioCobradoCliente = Number(data?.receiver?.cost ?? 0)

    return {
      bonificacionReceiver: bonifLoyal + bonifMandatory,
      envioCobradoCliente,
    }
  } catch {
    return { bonificacionReceiver: 0, envioCobradoCliente: 0 }
  }
}

async function fetchShipmentInfo(shippingId: string | number, token: string) {
  try {
    const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return { logistic_type: null as string | null }
    const data = await res.json()
    return { logistic_type: (data?.logistic_type ?? null) as string | null }
  } catch {
    return { logistic_type: null as string | null }
  }
}

type FiscalBreakdown = {
  cargos_comision: number
  cargos_costo_fijo: number
  cargos_financiacion: number
  cargos_otros: number
  cargos_total: number
  imp_creditos_debitos: number
  imp_creditos_debitos_envio: number
  imp_iibb_total: number
  imp_iibb_jurisdicciones: Record<string, number>
  imp_otros: number
  imp_total: number
}

function analizarFiscal(payments: any[], bonificacionEnvio: number): FiscalBreakdown {
  const result: FiscalBreakdown = {
    cargos_comision: 0,
    cargos_costo_fijo: 0,
    cargos_financiacion: 0,
    cargos_otros: 0,
    cargos_total: 0,
    imp_creditos_debitos: 0,
    imp_creditos_debitos_envio: 0,
    imp_iibb_total: 0,
    imp_iibb_jurisdicciones: {},
    imp_otros: 0,
    imp_total: 0,
  }

  for (const mp of payments) {
    if (!mp) continue
    const charges = mp.charges_details ?? []
    for (const c of charges) {
      const fromAccount = c.accounts?.from ?? null
      const feePayer = c.fee_payer ?? null
      const esDelVendedor = fromAccount === 'collector' || feePayer === 'collector'
      if (!esDelVendedor) continue

      const amount = Number(c.amounts?.original ?? 0)
      const refunded = Number(c.amounts?.refunded ?? 0)
      const neto = amount - refunded
      const name = (c.name ?? '').toLowerCase()
      const type = c.type

      if (type === 'fee') {
        if (name.includes('meli_percentage_fee')) {
          result.cargos_comision += neto
        } else if (name.includes('flat_fee') || name.includes('fixed_fee')) {
          result.cargos_costo_fijo += neto
        } else if (name.includes('financing')) {
          result.cargos_financiacion += neto
        } else {
          result.cargos_otros += neto
        }
      } else if (type === 'tax') {
        if (name.includes('debitos_creditos')) {
          result.imp_creditos_debitos += neto
        } else if (name.includes('iibb') || name.includes('sirtac')) {
          const jurisdiccion = extraerJurisdiccion(c.name)
          result.imp_iibb_total += neto
          result.imp_iibb_jurisdicciones[jurisdiccion] =
            (result.imp_iibb_jurisdicciones[jurisdiccion] ?? 0) + neto
        } else {
          result.imp_otros += neto
        }
      }
    }
  }

  result.cargos_total =
    result.cargos_comision +
    result.cargos_costo_fijo +
    result.cargos_financiacion +
    result.cargos_otros

  if (bonificacionEnvio > 0) {
    result.imp_creditos_debitos_envio = Math.round(bonificacionEnvio * 0.006 * 100) / 100
  }

  result.imp_total =
    result.imp_creditos_debitos +
    result.imp_creditos_debitos_envio +
    result.imp_iibb_total +
    result.imp_otros

  return result
}

function extraerJurisdiccion(name: string | null | undefined): string {
  if (!name) return 'desconocida'
  const lower = name.toLowerCase()
  if (lower.includes('iibb_tucuman')) return 'tucuman'
  if (lower.includes('sirtac-')) {
    const parts = lower.split('sirtac-')
    return parts[1] ?? 'sirtac_otra'
  }
  if (lower.includes('iibb_')) {
    const parts = lower.split('iibb_')
    return parts[1] ?? 'iibb_otra'
  }
  return 'desconocida'
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

    let ordersRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    let ordersData = await ordersRes.json()

    if (ordersRes.status === 401 && !yaRefresque) {
      const nuevoToken = await refreshToken(supabase, tokenRow)
      if (!nuevoToken) {
        return NextResponse.json({ error: 'No se pudo refrescar el token' }, { status: 401 })
      }
      token = nuevoToken
      yaRefresque = true
      ordersRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      ordersData = await ordersRes.json()
    }

    if (ordersRes.status !== 200) {
      console.log('ML error pagina', pagina, ':', JSON.stringify(ordersData))
      huboError = true
      break
    }

    if (pagina === 1) {
      totalDisponible = ordersData.paging?.total ?? 0
      console.log(`Total a sincronizar (modo: ${modoSync}): ${totalDisponible}`)
    }

    const results = ordersData.results ?? []
    if (results.length === 0) break

    const ordersConFinanzas = await Promise.all(results.map(async (order: any) => {
      const total = Number(order.total_amount ?? 0)

      const paymentIds = (order.payments ?? []).map((p: any) => p.id).filter(Boolean)
      const mpPayments = await Promise.all(
        paymentIds.map((id: any) => fetchMPPayment(id, token))
      )
      const validMp = mpPayments.filter(Boolean)

      let bonificacion = 0
      let envioCobradoCliente = 0
      let shippingLogisticType: string | null = null
      if (order.shipping?.id) {
        const [ship, info] = await Promise.all([
          fetchShippingData(order.shipping.id, token),
          fetchShipmentInfo(order.shipping.id, token),
        ])
        bonificacion = ship.bonificacionReceiver
        envioCobradoCliente = ship.envioCobradoCliente
        shippingLogisticType = info.logistic_type
      }

      const fiscal = analizarFiscal(validMp, bonificacion)

      // 🔥 Costo Flex estimado: solo si es self_service
      const costoFlexEstimado = shippingLogisticType === 'self_service' ? COSTO_FLEX_PROMEDIO : 0

      // 🔥 Net received corregido: incluye envío cobrado, resta costo Flex
      const net_received = validMp.length > 0
        ? total + envioCobradoCliente - fiscal.cargos_total - fiscal.imp_total + bonificacion - costoFlexEstimado
        : 0

      return {
        order,
        marketplace_fee: fiscal.cargos_total,
        shipping_cost: 0,
        discounts: bonificacion,
        bonificacion_envio: bonificacion,
        envio_cobrado_cliente: envioCobradoCliente,
        costo_flex_estimado: costoFlexEstimado,
        net_received,
        shipping_logistic_type: shippingLogisticType,
        fiscal,
      }
    }))

    const ordersToInsert = ordersConFinanzas.map(({ order, marketplace_fee, shipping_cost, discounts, bonificacion_envio, envio_cobrado_cliente, costo_flex_estimado, net_received, shipping_logistic_type, fiscal }) => ({
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
      shipping_logistic_type,
      cargos_comision: fiscal.cargos_comision,
      cargos_costo_fijo: fiscal.cargos_costo_fijo,
      cargos_financiacion: fiscal.cargos_financiacion,
      cargos_otros: fiscal.cargos_otros,
      cargos_total: fiscal.cargos_total,
      imp_creditos_debitos: fiscal.imp_creditos_debitos,
      imp_creditos_debitos_envio: fiscal.imp_creditos_debitos_envio,
      imp_iibb_total: fiscal.imp_iibb_total,
      imp_iibb_jurisdicciones: fiscal.imp_iibb_jurisdicciones,
      imp_otros: fiscal.imp_otros,
      imp_total: fiscal.imp_total,
      bonificacion_envio,
      envio_cobrado_cliente,
      costo_flex_estimado,
      fiscal_v2: true,
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
      await supabase
        .from('order_items')
        .upsert(itemsToInsert, { onConflict: 'order_id,item_id' })
    }

    sincronizadas += results.length
    console.log(`Pagina ${pagina} OK - ${sincronizadas}/${totalDisponible}`)

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
    mensaje: `${sincronizadas} ordenes sincronizadas (${modoSync})`,
    total_disponible: totalDisponible,
    paginas_procesadas: pagina,
    refresh_aplicado: yaRefresque
  })
}