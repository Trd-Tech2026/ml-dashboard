import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

export async function GET(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Sacamos el access token
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

  // Tomamos un order_id pagado para probar
  const { searchParams } = new URL(request.url)
  let orderId = searchParams.get('order')

  if (!orderId) {
    const { data: order } = await supabase
      .from('orders')
      .select('order_id')
      .eq('status', 'paid')
      .limit(1)
      .maybeSingle()
    orderId = order?.order_id?.toString() ?? null
  }

  if (!orderId) {
    return NextResponse.json({ error: 'No hay orden de prueba' }, { status: 404 })
  }

  // 1. Pedimos la orden a ML para sacar el payment_id
  const orderRes = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const orderData = await orderRes.json()

  const paymentId = orderData?.payments?.[0]?.id

  if (!paymentId) {
    return NextResponse.json({
      ok: false,
      step: 'ml_order',
      message: 'No se encontró payment_id en la orden',
      order_response: orderData,
    })
  }

  // 2. Probamos llamar a Mercado Pago con el MISMO token
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })

  const mpData = await mpRes.json().catch(() => null)

  return NextResponse.json({
    order_id: orderId,
    payment_id: paymentId,
    ml_order_payment: orderData?.payments?.[0],
    mp_status: mpRes.status,
    mp_data: mpData,
    // Si llegó OK, mostramos los campos relevantes
    fee_real: mpData?.fee_details ?? null,
    net_amount_real: mpData?.transaction_details?.net_received_amount ?? null,
  })
}