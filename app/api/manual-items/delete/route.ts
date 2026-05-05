import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { seller_sku?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const seller_sku = (body.seller_sku ?? '').trim()
  if (!seller_sku) {
    return NextResponse.json({ ok: false, error: 'SKU requerido' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verificar si está siendo usado como componente en algún combo
  const { data: usedInCombos, error: checkError } = await supabase
    .from('product_components')
    .select('parent_sku')
    .eq('component_sku', seller_sku)

  if (checkError) {
    return NextResponse.json({ ok: false, error: checkError.message }, { status: 500 })
  }

  if (usedInCombos && usedInCombos.length > 0) {
    const parents = usedInCombos.map(c => c.parent_sku).slice(0, 3).join(', ')
    const more = usedInCombos.length > 3 ? ` (+${usedInCombos.length - 3} más)` : ''
    return NextResponse.json({
      ok: false,
      error: `No podés borrar este producto porque está siendo usado en ${usedInCombos.length} combo(s): ${parents}${more}. Quitalo primero de los combos.`,
    }, { status: 409 })
  }

  const { error } = await supabase
    .from('manual_items')
    .delete()
    .eq('seller_sku', seller_sku)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, message: 'Producto manual borrado' })
}