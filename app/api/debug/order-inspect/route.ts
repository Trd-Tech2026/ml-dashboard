import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get('id')

  if (!orderId) {
    return NextResponse.json({
      ok: false,
      error: 'Falta ?id=ORDER_ID en la URL. Ej: /api/debug/order-inspect?id=2000016345490229'
    }, { status: 400 })
  }

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
    return NextResponse.json({ ok: false, error: 'No hay token de ML' }, { status: 401 })
  }
  const token = tokenData.access_token

  // 1) GET /orders/{id}
  const orderRes = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (orderRes.status !== 200) {
    const text = await orderRes.text()
    return NextResponse.json({
      ok: false, step: 'orders/{id}', status: orderRes.status, error: text
    }, { status: 500 })
  }
  const order = await orderRes.json()

  // 2) Para cada payment, GET /v1/payments/{id} en MercadoPago
  const paymentIds = (order.payments ?? []).map((p: any) => p.id).filter(Boolean)
  const payments = await Promise.all(
    paymentIds.map(async (pid: number) => {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${pid}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (r.status !== 200) return { id: pid, error: `status ${r.status}` }
      return await r.json()
    })
  )

  // 3) Shipment
  let shipment: any = null
  let shipmentCosts: any = null
  if (order.shipping?.id) {
    const sRes = await fetch(`https://api.mercadolibre.com/shipments/${order.shipping.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    shipment = sRes.status === 200 ? await sRes.json() : { error: `status ${sRes.status}` }

    const sCostRes = await fetch(`https://api.mercadolibre.com/shipments/${order.shipping.id}/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    shipmentCosts = sCostRes.status === 200 ? await sCostRes.json() : { error: `status ${sCostRes.status}` }
  }

  // 4) Interpretación de cada concepto
  const interpretacion: any = {
    precio_producto: Number(order.total_amount ?? 0),
    cargos_ml: {
      total: 0,
      detalle: [] as any[],
    },
    impuestos_retenidos: {
      total: 0,
      detalle: [] as any[],
    },
    bonificacion_envio: 0,
    costo_envio_seller: 0,
    neto_calculado: 0,
  }

  // Recorrer charges_details y fee_details de cada payment
  for (const mp of payments) {
    if (!mp || mp.error) continue

    // charges_details: contiene fee, tax, etc
    const charges = mp.charges_details ?? []
    for (const c of charges) {
      const amount = Number(c.amounts?.original ?? 0)
      const refunded = Number(c.amounts?.refunded ?? 0)
      const neto = amount - refunded

      const item = {
        type: c.type,                   // 'fee', 'tax', etc
        name: c.name ?? null,           // 'fixed_fee', 'mercadopago_fee', 'IIBB_TUCUMAN', etc
        accounts: c.accounts ?? null,
        original: amount,
        refunded: refunded,
        neto: neto,
        last_updated: c.last_updated ?? null,
      }

      if (c.type === 'fee') {
        interpretacion.cargos_ml.total += neto
        interpretacion.cargos_ml.detalle.push(item)
      } else if (c.type === 'tax') {
        interpretacion.impuestos_retenidos.total += neto
        interpretacion.impuestos_retenidos.detalle.push(item)
      } else {
        // Otro tipo: lo guardamos por las dudas
        interpretacion.cargos_ml.detalle.push({ ...item, _otro_tipo: true })
      }
    }

    // fee_details fallback (algunos casos)
    const feeDetails = mp.fee_details ?? []
    for (const f of feeDetails) {
      interpretacion.cargos_ml.detalle.push({
        from: 'fee_details',
        type: f.type,
        fee_payer: f.fee_payer,
        amount: Number(f.amount ?? 0),
      })
    }
  }

  // Bonificación de envío y costo seller
  if (shipmentCosts && !shipmentCosts.error) {
    const costoSeller = Number(shipmentCosts?.senders?.[0]?.cost ?? shipmentCosts?.senders?.cost ?? 0)
    const bonifs = shipmentCosts?.receiver?.discounts ?? []
    const bonifTotal = Array.isArray(bonifs)
      ? bonifs.reduce((acc: number, d: any) => acc + Number(d.promoted_amount ?? 0), 0)
      : 0
    interpretacion.costo_envio_seller = costoSeller
    interpretacion.bonificacion_envio = bonifTotal
  }

  interpretacion.neto_calculado =
    interpretacion.precio_producto -
    interpretacion.cargos_ml.total -
    interpretacion.impuestos_retenidos.total -
    interpretacion.costo_envio_seller +
    interpretacion.bonificacion_envio

  // 5) Comparación con BD actual
  const { data: dbOrder } = await supabase
    .from('orders')
    .select('order_id, total_amount, marketplace_fee, shipping_cost, discounts, net_received, shipping_logistic_type, status, date_created')
    .eq('order_id', orderId)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    order_id: orderId,

    // === Lo más importante: la interpretación ===
    interpretacion,

    // === Comparación con lo que ya está en BD ===
    en_bd: dbOrder,
    diferencia_con_bd: dbOrder ? {
      total_amount: Number(dbOrder.total_amount) - interpretacion.precio_producto,
      marketplace_fee_actual_vs_cargos_solo: Number(dbOrder.marketplace_fee) - interpretacion.cargos_ml.total,
      net_received_actual_vs_calculado: Number(dbOrder.net_received) - interpretacion.neto_calculado,
    } : null,

    // === RAW para inspección ===
    raw: {
      order: {
        id: order.id,
        date_created: order.date_created,
        status: order.status,
        total_amount: order.total_amount,
        taxes: order.taxes,
        order_items_count: order.order_items?.length ?? 0,
        shipping_id: order.shipping?.id,
        payment_ids: paymentIds,
      },
      payments: payments.map(p => ({
        id: p?.id,
        status: p?.status,
        transaction_amount: p?.transaction_amount,
        net_received_amount: p?.transaction_details?.net_received_amount,
        charges_details: p?.charges_details,
        fee_details: p?.fee_details,
      })),
      shipment: shipment ? {
        id: shipment.id,
        logistic_type: shipment.logistic_type,
        status: shipment.status,
        mode: shipment.mode,
      } : null,
      shipment_costs: shipmentCosts,
    },
  })
}
