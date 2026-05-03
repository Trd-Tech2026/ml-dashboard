import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orderIdParam = searchParams.get('order')

  if (!orderIdParam) {
    return NextResponse.json({ error: 'Pasame ?order=ORDER_ID' }, { status: 400 })
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

  if (!tokenData?.access_token) {
    return NextResponse.json({ error: 'No hay token' }, { status: 401 })
  }

  const token = tokenData.access_token

  // Traer ML order completa
  const orderRes = await fetch(`https://api.mercadolibre.com/orders/${orderIdParam}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const orderData = await orderRes.json()

  // Traer todos los payments en MP
  const payments = orderData?.payments ?? []
  const paymentsDetails = await Promise.all(
    payments.map(async (p: any) => {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${p.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return r.status === 200 ? await r.json() : { error: r.status }
    })
  )

  // Traer shipping si tiene
  let shippingCost: any = null
  if (orderData?.shipping?.id) {
    const r = await fetch(`https://api.mercadolibre.com/shipments/${orderData.shipping.id}/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    shippingCost = r.status === 200 ? await r.json() : { error: r.status }
  }

  return NextResponse.json({
    order_id: orderIdParam,
    ml_order: {
      id: orderData?.id,
      total_amount: orderData?.total_amount,
      paid_amount: orderData?.paid_amount,
      shipping_id: orderData?.shipping?.id,
      shipping_tags: orderData?.shipping?.tags,
      pack_id: orderData?.pack_id,
      coupon: orderData?.coupon,
      taxes: orderData?.taxes,
    },
    mp_payments: paymentsDetails.map((mp: any) => ({
      id: mp?.id,
      transaction_amount: mp?.transaction_amount,
      taxes_amount: mp?.taxes_amount,
      shipping_amount: mp?.shipping_amount,
      coupon_amount: mp?.coupon_amount,
      transaction_details: mp?.transaction_details,
      fee_details: mp?.fee_details,
      charges_details: mp?.charges_details?.map((c: any) => ({
        type: c.type,
        name: c.name,
        amount: c.amounts?.original,
        accounts: c.accounts,
        metadata_detail: c.metadata?.mov_detail,
      })),
    })),
    shipping_cost: shippingCost,
  })
}