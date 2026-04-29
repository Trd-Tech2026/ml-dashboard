import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

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

  // Fecha desde la cual traer órdenes (últimos 90 días)
  const desde = new Date()
  desde.setDate(desde.getDate() - 90)
  const desdeISO = desde.toISOString()

  const LIMIT = 50
  const MAX_PAGES = 100 // safety net: máx 5000 órdenes
  let offset = 0
  let sincronizadas = 0
  let totalDisponible = 0
  let pagina = 0
  let huboError = false

  while (pagina < MAX_PAGES) {
    pagina++

    const url = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&order.date_created.from=${desdeISO}&sort=date_desc&limit=${LIMIT}&offset=${offset}`

    const ordersRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const ordersData = await ordersRes.json()

    if (ordersRes.status !== 200) {
      console.log('ML error en página', pagina, ':', JSON.stringify(ordersData))
      huboError = true
      break
    }

    if (pagina === 1) {
      totalDisponible = ordersData.paging?.total ?? 0
      console.log(`Total a sincronizar (últimos 90 días): ${totalDisponible}`)
    }

    const results = ordersData.results ?? []
    if (results.length === 0) break

    for (const order of results) {
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

    console.log(`Página ${pagina} OK — ${sincronizadas}/${totalDisponible}`)

    // Si esta página vino con menos órdenes que el límite, ya no hay más
    if (results.length < LIMIT) break

    offset += LIMIT
  }

  return NextResponse.json({
    ok: !huboError,
    mensaje: `${sincronizadas} órdenes sincronizadas (últimos 90 días)`,
    total_disponible: totalDisponible,
    paginas_procesadas: pagina
  })
}
