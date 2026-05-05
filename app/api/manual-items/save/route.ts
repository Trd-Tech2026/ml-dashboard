import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type Body = {
  seller_sku: string
  title: string
  available_quantity: number
  cost?: number | null
  notes?: string | null
  // Si es true, permite sobrescribir un manual_item existente con ese SKU
  // Si es false (default), falla si el SKU ya existe
  is_edit?: boolean
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const seller_sku = (body.seller_sku ?? '').trim()
  const title = (body.title ?? '').trim()
  const available_quantity = Number(body.available_quantity ?? 0)
  const cost = body.cost === undefined || body.cost === null || body.cost === '' as any
    ? null
    : Number(body.cost)
  const notes = body.notes?.trim() || null
  const is_edit = !!body.is_edit

  // Validaciones
  if (!seller_sku) {
    return NextResponse.json({ ok: false, error: 'SKU requerido' }, { status: 400 })
  }
  if (seller_sku.length > 200) {
    return NextResponse.json({ ok: false, error: 'SKU demasiado largo' }, { status: 400 })
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: 'Título requerido' }, { status: 400 })
  }
  if (!Number.isInteger(available_quantity) || available_quantity < 0) {
    return NextResponse.json({ ok: false, error: 'Stock debe ser un entero >= 0' }, { status: 400 })
  }
  if (cost !== null && (isNaN(cost) || cost < 0)) {
    return NextResponse.json({ ok: false, error: 'Costo inválido' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // CHEQUEO 1: ¿Existe ese SKU en items (de ML)?
  const { data: mlItem } = await supabase
    .from('items')
    .select('item_id, title')
    .eq('seller_sku', seller_sku)
    .limit(1)
    .maybeSingle()

  if (mlItem) {
    return NextResponse.json({
      ok: false,
      error: `El SKU "${seller_sku}" ya existe como una publicación de Mercado Libre: "${mlItem.title}". No podés crear un producto manual con un SKU que ya está siendo usado en ML.`,
    }, { status: 409 })
  }

  // CHEQUEO 2: ¿Existe ese SKU como manual?
  const { data: existing } = await supabase
    .from('manual_items')
    .select('seller_sku')
    .eq('seller_sku', seller_sku)
    .maybeSingle()

  if (existing && !is_edit) {
    return NextResponse.json({
      ok: false,
      error: `El SKU "${seller_sku}" ya existe como producto manual. Si querés editarlo, usá el modo edición.`,
    }, { status: 409 })
  }

  // Si existe y es edit → update; si no existe → insert
  if (existing) {
    const { data, error } = await supabase
      .from('manual_items')
      .update({ title, available_quantity, cost, notes })
      .eq('seller_sku', seller_sku)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, item: data, action: 'updated' })
  } else {
    const { data, error } = await supabase
      .from('manual_items')
      .insert({ seller_sku, title, available_quantity, cost, notes })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, item: data, action: 'created' })
  }
}