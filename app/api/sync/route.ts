import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

  const token = tokenData.access_token
  const sellerId = tokenData.ml_user_id

  const ordersRes = await fetch(
    `https://api.mercadolibre.com/orders/search?seller=${sellerId}&limit=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const ordersData = await ordersRes.json()

  console.log('ML status:', ordersRes.status)

  let sincronizadas = 0

  if (ordersData.results) {
    for (const order of ordersData.results) {
      const { error: orderError } = await supabase.from('orders').upsert({
        order_id: order.id,
        status: order.status,
        total_amount: order.total_amount,
        currency: order.currency_id,
        buyer_id: order.buyer.id,
        buyer_nickname: order.buyer.nickname,
        date_created: order.date_created,
        date_closed: order.date_closed,
        cancel_reason: order.cancel_detail?.description ?? null
      }, { onConflict: 'order_id' })

      if (orderError) {
        console.log('Order upsert error:', JSON.stringify(orderError))
        continue
      }

      for (const item of order.order_items) {
        const { error: itemError } = await supabase.from('order_items').upsert({
          order_id: order.id,
          item_id: item.item.id,
          title: item.item.title,
          quantity: item.quantity,
          unit_price: item.unit_price
        }, { onConflict: 'order_id,item_id' })

        if (itemError) {
          console.log('Item upsert error:', JSON.stringify(itemError))
        }
      }

      sincronizadas++
    }
  }

  return NextResponse.json({
    ok: true,
    mensaje: `${sincronizadas} órdenes sincronizadas correctamente`,
    debug_total: ordersData.paging?.total ?? null
  })
}
