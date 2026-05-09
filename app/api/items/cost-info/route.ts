import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids.map(String).filter(Boolean) : []
  const sellerSkus: string[] = Array.isArray(body.seller_skus) ? body.seller_skus.map(String).filter(Boolean) : []

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const result: Record<string, { cost: number | null; iva_rate: number }> = {}

  // Items normales (key: item_id)
  if (itemIds.length > 0) {
    const unique = Array.from(new Set(itemIds))
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500)
      const { data } = await supabase
        .from('items')
        .select('item_id, cost, iva_rate')
        .in('item_id', chunk)
      if (data) {
        for (const it of data as any[]) {
          result[it.item_id] = {
            cost: it.cost != null ? Number(it.cost) : null,
            iva_rate: it.iva_rate != null ? Number(it.iva_rate) : 21,
          }
        }
      }
    }
  }

  // Items manuales (key: MANUAL:seller_sku)
  if (sellerSkus.length > 0) {
    const unique = Array.from(new Set(sellerSkus))
    const { data } = await supabase
      .from('manual_items')
      .select('seller_sku, cost, iva_rate')
      .in('seller_sku', unique)
    if (data) {
      for (const it of data as any[]) {
        result[`MANUAL:${it.seller_sku}`] = {
          cost: it.cost != null ? Number(it.cost) : null,
          iva_rate: it.iva_rate != null ? Number(it.iva_rate) : 21,
        }
      }
    }
  }

  return NextResponse.json({ ok: true, costs: result })
}