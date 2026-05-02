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

// Suma todos los marketplace_fee de los payments de una orden
function sumarMarketplaceFee(payments: any[] | undefined): number {
  if (!Array.isArray(payments)) return 0
  return payments.reduce((acc, p) => acc + Number(p.marketplace_fee ?? 0), 0)
}

// Determina si el envío es gratis para el comprador (vendedor paga el envío)
function envioGratisParaComprador(order: any): boolean {
  const tags: string[] = order.shipping?.tags ?? []
  return tags.includes('mandatory_free_shipping') ||
         tags.includes('free_shipping') ||
         order.shipping?.cost_components?.shipping_method === 'free' ||
         false
}

// Pide a ML el costo de envío (cost de la lista) de un shipping_id
async function fetchShippingCost(shippingId: string | number, token: string): Promise<number> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 200) return 0
    const data = await res.json()
    // El campo "senders" trae el costo que paga el vendedor
    const senderCost = data?.senders?.[0]?.cost ?? data?.senders?.cost ?? 0
    return Number(senderCost) || 0
  } catch {
    return 0
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

  const LIMIT = 50
  const MAX_PAGES = 100
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

    // Para cada orden, traer el costo de envío en paralelo (si tiene shipping y es free)
    const shippingPromises = results.map(async (order: any) => {
      const shippingId = order.shipping?.id
      const esFree = envioGratisParaComprador(order)
      // Solo pedimos costo si el envío es gratis para el comprador (lo paga el vendedor)
      if (!shippingId || !esFree) return 0
      return fetchShippingCost(shippingId, token)
    })
    const shippingCosts: number[] = await Promise.all(shippingPromises)

    const ordersToInsert = results.map((order: any, idx: number) => {
      const marketplace_fee = sumarMarketplaceFee(order.payments)
      const shipping_cost = shippingCosts[idx] ?? 0
      const total = Number(order.total_amount ?? 0)
      const net_received = total - marketplace_fee - shipping_cost

      return {
        order_id: order.id,
        status: order.status,
        total_amount: total,
        currency: order.currency_id,
        buyer_id: order.buyer.id,
        buyer_nickname: order.buyer.nickname,
        date_created: order.date_created,
        date_closed: order.date_closed,
        cancel_reason: order.cancel_detail?.description ?? null,
        marketplace_fee,
        shipping_cost,
        net_received,
      }
    })

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