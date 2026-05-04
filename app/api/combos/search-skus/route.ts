import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()
  const excludeSku = searchParams.get('exclude') ?? ''

  if (q.length < 2) {
    return NextResponse.json({ ok: true, results: [] })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const safe = q.replace(/[,()]/g, ' ')

  // Buscar items por SKU o título, agrupando por SKU único
  let query = supabase
    .from('items')
    .select('seller_sku, title, thumbnail, available_quantity')
    .not('seller_sku', 'is', null)
    .or(`seller_sku.ilike.%${safe}%,title.ilike.%${safe}%`)
    .eq('archived', false)
    .limit(50)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Agrupar por SKU (puede haber varias publicaciones del mismo SKU)
  const map = new Map<string, any>()
  for (const item of (data ?? [])) {
    if (!item.seller_sku) continue
    if (item.seller_sku === excludeSku) continue
    const existing = map.get(item.seller_sku)
    if (existing) {
      existing.minStock = Math.min(existing.minStock, item.available_quantity)
    } else {
      map.set(item.seller_sku, {
        sku: item.seller_sku,
        title: item.title,
        thumbnail: item.thumbnail,
        minStock: item.available_quantity,
      })
    }
  }

  const results = Array.from(map.values()).slice(0, 20)

  return NextResponse.json({ ok: true, results })
}