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
  console.log('[sync-items] Refrescando token...')

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
    console.log('[sync-items] Refresh falló:', JSON.stringify(refreshData))
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
    console.log('[sync-items] Error guardando token nuevo:', JSON.stringify(updateError))
    return null
  }

  console.log('[sync-items] Token refrescado OK')
  return refreshData.access_token
}

function extractSellerSku(attributes: Array<{ id: string; value_name?: string }> | undefined): string | null {
  if (!attributes || !Array.isArray(attributes)) return null
  const skuAttr = attributes.find(a => a.id === 'SELLER_SKU')
  return skuAttr?.value_name ?? null
}

// Determina si un item tiene Flex activo (ya sea como logistic_type principal
// o como modalidad adicional vía el tag 'self_service_in').
function isFlexEnabled(logisticType: string | null, tags: string[]): boolean {
  if (logisticType === 'self_service') return true
  if (tags.includes('self_service_in')) return true
  return false
}

async function fetchWithAuth(
  url: string,
  supabase: SupabaseClient,
  tokenRow: TokenRow,
  state: { token: string; refreshed: boolean }
): Promise<{ res: Response; data: any }> {
  let res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } })
  let data = await res.json()

  if (res.status === 401 && !state.refreshed) {
    console.log('[sync-items] Token rechazado, refrescando...')
    const nuevoToken = await refreshToken(supabase, tokenRow)
    if (!nuevoToken) {
      throw new Error('No se pudo refrescar el token. Hacé login de nuevo.')
    }
    state.token = nuevoToken
    state.refreshed = true

    res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } })
    data = await res.json()
  }

  return { res, data }
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const inicioSync = new Date().toISOString()

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
  const sellerId = tokenRow.ml_user_id
  const authState = { token: tokenRow.access_token, refreshed: false }

  // PASO 1: obtener todos los IDs
  const allItemIds: string[] = []
  const SCROLL_LIMIT = 100
  const MAX_SCROLL_PAGES = 50
  let scrollId: string | null = null
  let scrollPage = 0

  while (scrollPage < MAX_SCROLL_PAGES) {
    scrollPage++

    const params = new URLSearchParams({
      search_type: 'scan',
      limit: String(SCROLL_LIMIT),
    })
    if (scrollId) params.set('scroll_id', scrollId)

    const url = `https://api.mercadolibre.com/users/${sellerId}/items/search?${params.toString()}`

    let pageData: any
    try {
      const { res, data } = await fetchWithAuth(url, supabase, tokenRow, authState)
      if (res.status !== 200) {
        console.log('[sync-items] Error obteniendo IDs (página', scrollPage, '):', JSON.stringify(data))
        return NextResponse.json({
          ok: false,
          error: 'Error al obtener publicaciones',
          ml_response: data
        }, { status: 500 })
      }
      pageData = data
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 401 })
    }

    const ids: string[] = pageData.results ?? []
    allItemIds.push(...ids)
    scrollId = pageData.scroll_id ?? null

    console.log(`[sync-items] Scroll página ${scrollPage}: ${ids.length} IDs (total acumulado: ${allItemIds.length})`)

    if (ids.length < SCROLL_LIMIT || !scrollId) break
  }

  console.log(`[sync-items] Total de IDs obtenidos: ${allItemIds.length}`)

  if (allItemIds.length === 0) {
    return NextResponse.json({
      ok: true,
      mensaje: 'No se encontraron publicaciones',
      total: 0
    })
  }

  // PASO 2: traer detalles en bloques de 20
  const BATCH_SIZE = 20
  const itemsToUpsert: any[] = []
  let huboError = false
  let detailsErrors = 0

  for (let i = 0; i < allItemIds.length; i += BATCH_SIZE) {
    const batch = allItemIds.slice(i, i + BATCH_SIZE)
    const idsParam = batch.join(',')
    const attrs = 'id,title,thumbnail,permalink,available_quantity,sold_quantity,price,currency_id,status,listing_type_id,condition,category_id,shipping,date_created,last_updated,attributes'

    const url = `https://api.mercadolibre.com/items?ids=${idsParam}&attributes=${encodeURIComponent(attrs)}`

    try {
      const { res, data } = await fetchWithAuth(url, supabase, tokenRow, authState)

      if (res.status !== 200) {
        console.log(`[sync-items] Error en batch ${i / BATCH_SIZE + 1}:`, JSON.stringify(data))
        detailsErrors++
        continue
      }

      if (!Array.isArray(data)) {
        console.log(`[sync-items] Respuesta inesperada en batch ${i / BATCH_SIZE + 1}`)
        detailsErrors++
        continue
      }

      for (const wrapper of data) {
        if (wrapper.code !== 200 || !wrapper.body) continue
        const item = wrapper.body

        const logisticType = item.shipping?.logistic_type ?? null
        const freeShipping = item.shipping?.free_shipping ?? false
        const shippingTags: string[] = Array.isArray(item.shipping?.tags) ? item.shipping.tags : []
        const isFlex = isFlexEnabled(logisticType, shippingTags)

        itemsToUpsert.push({
          item_id: item.id,
          title: item.title,
          thumbnail: item.thumbnail ?? null,
          permalink: item.permalink ?? null,
          available_quantity: item.available_quantity ?? 0,
          sold_quantity: item.sold_quantity ?? 0,
          price: item.price ?? 0,
          currency: item.currency_id ?? 'ARS',
          status: item.status ?? 'unknown',
          listing_type_id: item.listing_type_id ?? null,
          condition: item.condition ?? null,
          category_id: item.category_id ?? null,
          logistic_type: logisticType,
          free_shipping: freeShipping,
          shipping_tags: shippingTags,
          is_flex: isFlex,
          seller_sku: extractSellerSku(item.attributes),
          date_created: item.date_created ?? null,
          last_updated: item.last_updated ?? null,
          synced_at: inicioSync,
        })
      }
    } catch (err) {
      console.log(`[sync-items] Error en batch ${i / BATCH_SIZE + 1}:`, String(err))
      detailsErrors++
    }
  }

  console.log(`[sync-items] Items a guardar: ${itemsToUpsert.length} (errores en batches: ${detailsErrors})`)

  // PASO 3: bulk upsert
  const UPSERT_BATCH = 500
  let totalUpserted = 0

  for (let i = 0; i < itemsToUpsert.length; i += UPSERT_BATCH) {
    const slice = itemsToUpsert.slice(i, i + UPSERT_BATCH)
    const { error: upsertError } = await supabase
      .from('items')
      .upsert(slice, { onConflict: 'item_id' })

    if (upsertError) {
      console.log('[sync-items] Error upsert items:', JSON.stringify(upsertError))
      huboError = true
      break
    }
    totalUpserted += slice.length
  }

  if (!huboError) {
    await supabase
      .from('sync_state_items')
      .update({
        last_sync_at: inicioSync,
        total_items: totalUpserted,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)
  }

  return NextResponse.json({
    ok: !huboError,
    mensaje: `${totalUpserted} publicaciones sincronizadas`,
    total_ids_encontrados: allItemIds.length,
    total_guardados: totalUpserted,
    errores_detalles: detailsErrors,
    refresh_aplicado: authState.refreshed
  })
}