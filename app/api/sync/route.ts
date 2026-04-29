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

  const { error: updateError } = await supabase
    .from('ml_tokens')
    .update({
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
      expires_at: nuevoExpiresAt
    })
    .eq('ml_user_id', tokenRow.ml_user_id)

  if (updateError) {
    console.log('Error guardando token nuevo:', JSON.stringify(updateError))
    return null
  }

  console.log('Token refrescado OK')
  return refreshData.access_token
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

  // Leer el último sync
  const { data: syncStateData } = await supabase
    .from('sync_state')
    .select('last_sync_at')
    .eq('id', 1)
    .maybeSingle()

  const lastSyncAt: string | null = syncStateData?.last_sync_at ?? null

  // Marcar el inicio del sync ANTES de empezar a pedir datos
  // (así si llegan órdenes mientras sincronizamos, las agarramos en el próximo run)
  const inicioSync = new Date().toISOString()

  // Definir filtro de ML según si es sync incremental o primer sync
  let filtroML: string
  let modoSync: string
  if (lastSyncAt) {
    // Sync incremental: pedir órdenes actualizadas desde el último sync
    filtroML = `order.date_last_updated.from=${lastSyncAt}`
    modoSync = 'incremental'
  } else {
    // Primer sync: últimos 90 días
    const desde = new Date()
    desde.setDate(desde.getDate() - 90)
    filtroML = `order.date_created.from=${desde.toISOString()}`
    modoSync = 'inicial-90d'
  }

  const LIMIT = 50
  const MAX_PAGES = 100
  let offset = 0
  let sincronizadas = 0
  let totalDisponible = 0
  let pagina = 0
  let huboError = false
  let yaRefresque = false

  while (pagina < MAX_PAGES) {
    pagina++

    const url = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&${filtroML}&sort=date_desc&limit=${LIMIT}&offset=${offset}`

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

      ordersRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
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

    const ordersToInsert = results.map((order: any) => ({
      order_id: order.id,
      status: order.status,
      total_amount: order.total_amount,
      currency: order.currency_id,
      buyer_id: order.buyer.id,
      buyer_nickname: order.buyer.nickname,
      date_created: order.date_created,
      date_closed: order.date_closed,
      cancel_reason: order.cancel_detail?.description ?? null
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

  // Solo actualizar last_sync_at si no hubo error
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