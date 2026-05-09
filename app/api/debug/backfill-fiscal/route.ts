import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const COSTO_FLEX_PROMEDIO = 4040

async function fetchMPPayment(paymentId: number, token: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return null
    return await res.json()
  } catch { return null }
}

async function fetchShippingData(shippingId: number, token: string) {
  try {
    const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return { bonif: 0, envioCobrado: 0 }
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

    const envioCobrado = Number(data?.receiver?.cost ?? 0)

    return { bonif: bonifLoyal + bonifMandatory, envioCobrado }
  } catch { return { bonif: 0, envioCobrado: 0 } }
}

async function fetchShipmentInfo(shippingId: number, token: string) {
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

function analizarFiscal(payments: any[], bonificacionEnvio: number) {
  const result: any = {
    cargos_comision: 0, cargos_costo_fijo: 0, cargos_financiacion: 0, cargos_otros: 0, cargos_total: 0,
    imp_creditos_debitos: 0, imp_creditos_debitos_envio: 0, imp_iibb_total: 0,
    imp_iibb_jurisdicciones: {} as Record<string, number>, imp_otros: 0, imp_total: 0,
  }
  for (const mp of payments) {
    if (!mp) continue
    for (const c of mp.charges_details ?? []) {
      const fromAccount = c.accounts?.from ?? null
      const feePayer = c.fee_payer ?? null
      const esDelVendedor = fromAccount === 'collector' || feePayer === 'collector'
      if (!esDelVendedor) continue

      const amount = Number(c.amounts?.original ?? 0)
      const refunded = Number(c.amounts?.refunded ?? 0)
      const neto = amount - refunded
      const name = (c.name ?? '').toLowerCase()
      if (c.type === 'fee') {
        if (name.includes('meli_percentage_fee')) result.cargos_comision += neto
        else if (name.includes('flat_fee') || name.includes('fixed_fee')) result.cargos_costo_fijo += neto
        else if (name.includes('financing')) result.cargos_financiacion += neto
        else result.cargos_otros += neto
      } else if (c.type === 'tax') {
        if (name.includes('debitos_creditos')) result.imp_creditos_debitos += neto
        else if (name.includes('iibb') || name.includes('sirtac')) {
          const j = extraerJurisdiccion(c.name)
          result.imp_iibb_total += neto
          result.imp_iibb_jurisdicciones[j] = (result.imp_iibb_jurisdicciones[j] ?? 0) + neto
        } else result.imp_otros += neto
      }
    }
  }
  result.cargos_total = result.cargos_comision + result.cargos_costo_fijo + result.cargos_financiacion + result.cargos_otros
  if (bonificacionEnvio > 0) {
    result.imp_creditos_debitos_envio = Math.round(bonificacionEnvio * 0.006 * 100) / 100
  }
  result.imp_total = result.imp_creditos_debitos + result.imp_creditos_debitos_envio + result.imp_iibb_total + result.imp_otros
  return result
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const desde = searchParams.get('from')
  const dryRun = searchParams.get('dry') === 'true'
  const limit = parseInt(searchParams.get('limit') ?? '500', 10)
  const onlyPending = searchParams.get('only_pending') === 'true'

  if (!desde) {
    return NextResponse.json({
      ok: false,
      error: 'Falta ?from=YYYY-MM-DD. Ej: /api/debug/backfill-fiscal?from=2026-04-01&dry=true'
    }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tokenData } = await supabase
    .from('ml_tokens')
    .select('access_token')
    .neq('access_token', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tokenData) return NextResponse.json({ ok: false, error: 'No hay token de ML' }, { status: 401 })
  const token = tokenData.access_token

  let q = supabase
    .from('orders')
    .select('order_id, total_amount, status, date_created')
    .gte('date_created', desde)
    .order('date_created', { ascending: false })
    .limit(limit)

  if (onlyPending) {
    q = q.or('envio_cobrado_cliente.is.null,envio_cobrado_cliente.eq.0')
  }

  const { data: orders, error } = await q

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: true, message: 'No hay ordenes para procesar', count: 0 })
  }

  let procesadas = 0
  let exitos = 0
  let fallidas = 0
  const errores: any[] = []
  const muestra: any[] = []

  for (const o of orders) {
    procesadas++
    try {
      const orderRes = await fetch(`https://api.mercadolibre.com/orders/${o.order_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (orderRes.status !== 200) {
        fallidas++
        errores.push({ order_id: o.order_id, step: 'orders/{id}', status: orderRes.status })
        continue
      }
      const order = await orderRes.json()
      const total = Number(order.total_amount ?? 0)

      const paymentIds = (order.payments ?? []).map((p: any) => p.id).filter(Boolean)
      const mpPayments = await Promise.all(
        paymentIds.map((id: any) => fetchMPPayment(id, token))
      )
      const validMp = mpPayments.filter(Boolean)

      let bonif = 0
      let envioCobrado = 0
      let logisticType: string | null = null
      if (order.shipping?.id) {
        const [ship, info] = await Promise.all([
          fetchShippingData(order.shipping.id, token),
          fetchShipmentInfo(order.shipping.id, token),
        ])
        bonif = ship.bonif
        envioCobrado = ship.envioCobrado
        logisticType = info.logistic_type
      }

      const fiscal = analizarFiscal(validMp, bonif)
      const costoFlex = logisticType === 'self_service' ? COSTO_FLEX_PROMEDIO : 0

      const net_received = validMp.length > 0
        ? total + envioCobrado - fiscal.cargos_total - fiscal.imp_total + bonif - costoFlex
        : 0

      const updateData = {
        marketplace_fee: fiscal.cargos_total,
        shipping_cost: 0,
        discounts: bonif,
        bonificacion_envio: bonif,
        envio_cobrado_cliente: envioCobrado,
        costo_flex_estimado: costoFlex,
        shipping_logistic_type: logisticType,
        net_received,
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
        fiscal_v2: true,
      }

      if (muestra.length < 5) {
        muestra.push({ 
          order_id: o.order_id, total, net_received, 
          envio_cobrado_cliente: envioCobrado, costo_flex_estimado: costoFlex,
          logistic_type: logisticType, bonif, fiscal 
        })
      }

      if (!dryRun) {
        const { error: updErr } = await supabase
          .from('orders')
          .update(updateData)
          .eq('order_id', o.order_id)
        if (updErr) {
          fallidas++
          errores.push({ order_id: o.order_id, step: 'update', error: updErr.message })
          continue
        }
      }
      exitos++
    } catch (err: any) {
      fallidas++
      errores.push({ order_id: o.order_id, error: err?.message ?? 'desconocido' })
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    only_pending: onlyPending,
    procesadas,
    exitos,
    fallidas,
    desde,
    muestra,
    errores: errores.slice(0, 20),
    total_errores: errores.length,
  })
}