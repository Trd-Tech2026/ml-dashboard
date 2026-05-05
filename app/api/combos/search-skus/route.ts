import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
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

    // Sanitizar el query: solo letras, números, espacios y guiones
    const safe = q.replace(/[^a-zA-Z0-9\s\-_]/g, ' ').trim()
    if (safe.length < 2) {
      return NextResponse.json({ ok: true, results: [] })
    }

    const orFilter = `seller_sku.ilike.%${safe}%,title.ilike.%${safe}%`

    // Buscar en items de ML
    const mlPromise = supabase
      .from('items')
      .select('seller_sku, title, thumbnail, available_quantity')
      .not('seller_sku', 'is', null)
      .or(orFilter)
      .eq('archived', false)
      .limit(50)

    // Buscar en manual_items
    const manualPromise = supabase
      .from('manual_items')
      .select('seller_sku, title, available_quantity')
      .or(orFilter)
      .limit(20)

    const [mlResult, manualResult] = await Promise.all([mlPromise, manualPromise])

    if (mlResult.error) {
      console.error('[search-skus] ML error:', mlResult.error)
      return NextResponse.json({ ok: false, error: `ML query: ${mlResult.error.message}` }, { status: 500 })
    }
    if (manualResult.error) {
      console.error('[search-skus] Manual error:', manualResult.error)
      return NextResponse.json({ ok: false, error: `Manual query: ${manualResult.error.message}` }, { status: 500 })
    }

    // Agrupar items de ML por SKU
    const map = new Map<string, any>()
    for (const item of (mlResult.data ?? [])) {
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
          is_manual: false,
        })
      }
    }

    // Agregar manual_items
    for (const item of (manualResult.data ?? [])) {
      if (!item.seller_sku) continue
      if (item.seller_sku === excludeSku) continue
      if (map.has(item.seller_sku)) continue
      map.set(item.seller_sku, {
        sku: item.seller_sku,
        title: item.title,
        thumbnail: null,
        minStock: item.available_quantity,
        is_manual: true,
      })
    }

    const results = Array.from(map.values()).slice(0, 30)

    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    console.error('[search-skus] Unexpected error:', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'Error desconocido' }, { status: 500 })
  }
}