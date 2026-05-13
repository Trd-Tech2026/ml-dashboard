import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  tgNuevaVenta,
  tgCancelacion,
  tgStockCritico,
  type DailyTotals,
} from '../../lib/telegram'

export const maxDuration = 60

const COSTO_FLEX_PROMEDIO = 4040

const TZ = 'America/Argentina/Buenos_Aires'

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

function hoyAR(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function ayerAR(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
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

    // 🔥 FIX v2: La bonificación de envío Flex que ML compensa al vendedor vive en
    // receiver.discounts[].promoted_amount (con type "loyal"). Aunque "receiver"
    // semánticamente es el comprador, este discount representa el monto que ML
    // le acredita al vendedor por hacer Flex (envío gratis al buyer subsidiado por ML).
    // El filtro por logistic_type=self_service se aplica en el caller para no
    // contar bonificaciones falsas en órdenes Colecta.
    const receiverDiscounts = data?.receiver?.discounts ?? []
    const bonificacion = Array.isArray(receiverDiscounts)
      ? receiverDiscounts.reduce((acc: number, d: any) => acc + Number(d.promoted_amount ?? 0), 0)
      : 0

    const envioCobradoCliente = Number(data?.receiver?.cost ?? 0)

    return {
      bonificacionReceiver: bonificacion,
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
    if (res.status !== 200) return { logistic_type: null as string | null, receiver_address: null as string | null }
    const data = await res.json()

    const addr = data?.receiver_address
    let receiver_address: string | null = null
    if (addr) {
      const parts = [
        addr.street_name && addr.street_number ? `${addr.street_name} ${addr.street_number}` : addr.street_name,
        addr.city?.name,
        addr.state?.name,
      ].filter(Boolean)
      receiver_address = parts.join(', ') || null
    }

    return {
      logistic_type: (data?.logistic_type ?? null) as string | null,
      receiver_address,
    }
  } catch {
    return { logistic_type: null as string | null, receiver_address: null as string | null }
  }
}

async function fetchItemThumbnail(itemId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/items/${itemId}?attributes=thumbnail`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return null
    const data = await res.json()
    const thumb: string = data?.thumbnail ?? ''
    return thumb ? thumb.replace('http://', 'https://').replace('-I.jpg', '-O.jpg') : null
  } catch {
    return null
  }
}

async function fetchDailyTotals(supabase: SupabaseClient): Promise<DailyTotals> {
  const hoy = hoyAR()
  const ayer = ayerAR()

  const desdeHoy = new Date(`${hoy}T00:00:00-03:00`).toISOString()
  const hastaHoy = new Date(`${hoy}T23:59:59-03:00`).toISOString()
  const desdeAyer = new Date(`${ayer}T00:00:00-03:00`).toISOString()
  const hastaAyer = new Date(`${ayer}T23:59:59-03:00`).toISOString()

  const [{ data: dataHoy }, { data: dataAyer }] = await Promise.all([
    supabase.from('orders').select('total_amount').eq('status', 'paid')
      .gte('date_created', desdeHoy).lte('date_created', hastaHoy),
    supabase.from('orders').select('total_amount').eq('status', 'paid')
      .gte('date_created', desdeAyer).lte('date_created', hastaAyer),
  ])

  const totalHoy = (dataHoy ?? []).reduce((s: number, o: any) => s + Number(o.total_amount ?? 0), 0)
  const ventasHoy = (dataHoy ?? []).length
  const totalAyer = (dataAyer ?? []).reduce((s: number, o: any) => s + Number(o.total_amount ?? 0), 0)
  const ventasAyer = (dataAyer ?? []).length

  return { totalHoy, ventasHoy, totalAyer, ventasAyer }
}

async function checkStockCritico(supabase: SupabaseClient, sellerSkus: string[]): Promise<void> {
  if (sellerSkus.length === 0) return
  try {
    const { data } = await supabase
      .from('items')
      .select('seller_sku, title, available_quantity')
      .in('seller_sku', sellerSkus)
      .lte('available_quantity', 2)
      .gt('available_quantity', 0)
    for (const item of (data ?? []) as any[]) {
      await tgStockCritico(item.seller_sku, item.title ?? item.seller_sku, item.available_quantity)
    }
  } catch (e) {
    console.error('checkStockCritico error:', e)
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

  const nuevasPagadas: Array<{
    order: any
    net_received: number
    logistic_type: string | null
    receiver_address: string | null
    item_id: string
    item_title: string
    item_qty: number
  }> = []
  const nuevasCanceladas: Array<{ order: any; item_title: string; total: number }> = []
  const skusVendidos: string[] = []

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

    const orderIdsLote = results.map((o: any) => o.id)
    const { data: existentes } = await supabase
      .from('orders')
      .select('order_id, status')
      .in('order_id', orderIdsLote)

    const existentesMap = new Map<string, string>(
      (existentes ?? []).map((e: any) => [String(e.order_id), e.status])
    )

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
      let receiverAddress: string | null = null

      if (order.shipping?.id) {
        const [ship, info] = await Promise.all([
          fetchShippingData(order.shipping.id, token),
          fetchShipmentInfo(order.shipping.id, token),
        ])
        // 🔥 FIX v2: Solo Flex (self_service) recibe bonificación de ML por envío.
        // En Colecta el vendedor paga el envío y receiver.discounts puede tener
        // un valor que NO es bonificación al vendedor (ej: promo al comprador).
        bonificacion = info.logistic_type === 'self_service' ? ship.bonificacionReceiver : 0
        envioCobradoCliente = ship.envioCobradoCliente
        shippingLogisticType = info.logistic_type
        receiverAddress = info.receiver_address
      }

      const fiscal = analizarFiscal(validMp, bonificacion)
      const costoFlexEstimado = shippingLogisticType === 'self_service' ? COSTO_FLEX_PROMEDIO : 0

      const net_received = validMp.length > 0
        ? total + envioCobradoCliente - fiscal.cargos_total - fiscal.imp_total + bonificacion - costoFlexEstimado
        : 0

      const eraStatus = existentesMap.get(String(order.id))
      const esNueva = !eraStatus
      const nuevaCancelacion = order.status === 'cancelled' && eraStatus && eraStatus !== 'cancelled'

      if (order.status === 'paid' && esNueva) {
        const primerItem = order.order_items?.[0]
        const itemId = primerItem?.item?.id ?? ''
        const itemTitle = primerItem?.item?.title ?? 'Producto'
        const itemQty = primerItem?.quantity ?? 1

        nuevasPagadas.push({
          order,
          net_received,
          logistic_type: shippingLogisticType,
          receiver_address: receiverAddress,
          item_id: itemId,
          item_title: itemTitle,
          item_qty: itemQty,
        })

        const sellerSku = primerItem?.item?.seller_sku ?? null
        if (sellerSku) skusVendidos.push(sellerSku)
      }

      if (nuevaCancelacion) {
        const primerItem = order.order_items?.[0]
        nuevasCanceladas.push({
          order,
          item_title: primerItem?.item?.title ?? 'Producto',
          total: Number(order.total_amount ?? 0),
        })
      }

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

    const ordersToInsert = ordersConFinanzas.map(({
      order, marketplace_fee, shipping_cost, discounts,
      bonificacion_envio, envio_cobrado_cliente, costo_flex_estimado,
      net_received, shipping_logistic_type, fiscal
    }) => ({
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

  if (!huboError && nuevasPagadas.length > 0) {
    const daily = await fetchDailyTotals(supabase)

    for (const venta of nuevasPagadas) {
      const thumbnail = venta.item_id
        ? await fetchItemThumbnail(venta.item_id, token)
        : null

      await tgNuevaVenta(
        venta.order,
        venta.net_received,
        venta.logistic_type,
        venta.receiver_address,
        venta.item_title,
        venta.item_qty,
        thumbnail,
        daily,
        null,
      )
    }
  }

  for (const cancelacion of nuevasCanceladas) {
    await tgCancelacion(cancelacion.order, cancelacion.item_title, cancelacion.total)
  }

  if (skusVendidos.length > 0) {
    await checkStockCritico(supabase, [...new Set(skusVendidos)])
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
    refresh_aplicado: yaRefresque,
    notificaciones_enviadas: nuevasPagadas.length + nuevasCanceladas.length,
  })
}