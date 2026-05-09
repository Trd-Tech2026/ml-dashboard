import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const item_id = body.item_id ? String(body.item_id) : null
  const seller_sku = body.seller_sku ? String(body.seller_sku) : null
  const is_manual = !!body.is_manual

  // cost: null/undefined/'' = borrar costo; otro = número
  const costRaw = body.cost
  const cost = (costRaw === null || costRaw === undefined || costRaw === '') ? null : Number(costRaw)

  const ivaRaw = body.iva_rate
  const iva_rate = (ivaRaw === null || ivaRaw === undefined) ? 21 : Number(ivaRaw)

  // Validaciones
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    return NextResponse.json({ ok: false, error: 'Costo inválido' }, { status: 400 })
  }
  if (!Number.isFinite(iva_rate) || iva_rate < 0 || iva_rate > 100) {
    return NextResponse.json({ ok: false, error: 'IVA inválido (0-100)' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (is_manual) {
    if (!seller_sku) {
      return NextResponse.json({ ok: false, error: 'Falta seller_sku para item manual' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('manual_items')
      .update({ cost, iva_rate })
      .eq('seller_sku', seller_sku)
      .select()
      .maybeSingle()
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: `No se encontró el manual ${seller_sku}` }, { status: 404 })
    }
    return NextResponse.json({ ok: true, cost, iva_rate, type: 'manual' })
  } else {
    if (!item_id) {
      return NextResponse.json({ ok: false, error: 'Falta item_id' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('items')
      .update({ cost, iva_rate })
      .eq('item_id', item_id)
      .select()
      .maybeSingle()
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: `No se encontró el item ${item_id}` }, { status: 404 })
    }
    return NextResponse.json({ ok: true, cost, iva_rate, type: 'item' })
  }
}