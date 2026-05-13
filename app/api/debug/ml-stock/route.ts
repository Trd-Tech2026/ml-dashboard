import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const itemId = searchParams.get('item_id') ?? 'MLA1841683397'

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

  if (!tokenData) return NextResponse.json({ error: 'No token' }, { status: 401 })

  const token = tokenData.access_token
  const sellerId = tokenData.ml_user_id

  // Paso 1: obtener inventory_id del item
  let inventoryId: string | null = null
  try {
    const itemRes = await fetch(
      `https://api.mercadolibre.com/items/${itemId}?attributes=id,inventory_id,available_quantity`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const itemData = await itemRes.json()
    inventoryId = itemData?.inventory_id ?? null
  } catch {}

  const endpoints = [
    // Stock Full (ya sabemos que funciona)
    `https://api.mercadolibre.com/inventories/${inventoryId}/stock/fulfillment`,
    // Candidatos para stock depósito/warehouse
    `https://api.mercadolibre.com/inventories/${inventoryId}/stock/not_meli`,
    `https://api.mercadolibre.com/inventories/${inventoryId}/stock/seller`,
    `https://api.mercadolibre.com/inventories/${inventoryId}/stock/external`,
    `https://api.mercadolibre.com/inventories/${inventoryId}/stock/all`,
    `https://api.mercadolibre.com/inventories/${inventoryId}/stocks`,
    // Items con todos atributos de stock
    `https://api.mercadolibre.com/items/${itemId}?attributes=id,available_quantity,inventory_id,sub_status,health`,
    // Seller inventory
    `https://api.mercadolibre.com/users/${sellerId}/fulfillment/inventory`,
    `https://api.mercadolibre.com/inventory-providers/seller/${sellerId}/inventory`,
  ]

  const results: Record<string, any> = {}

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      results[url] = { status: res.status, data }
    } catch (e: any) {
      results[url] = { error: e.message }
    }
  }

  return NextResponse.json({ item_id: itemId, seller_id: sellerId, inventory_id: inventoryId, results })
}