import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type Body = {
  item_ids: string[]
  archived: boolean
}

export async function POST(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  // Validaciones básicas
  if (!Array.isArray(body.item_ids) || body.item_ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'item_ids debe ser un array no vacío' }, { status: 400 })
  }
  if (typeof body.archived !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'archived debe ser true o false' }, { status: 400 })
  }
  if (body.item_ids.length > 1000) {
    return NextResponse.json({ ok: false, error: 'Máximo 1000 items por request' }, { status: 400 })
  }

  // Sanity: solo strings
  const ids = body.item_ids.filter(id => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay item_ids válidos' }, { status: 400 })
  }

  // Update masivo
  const { data, error, count } = await supabase
    .from('items')
    .update({ archived: body.archived }, { count: 'exact' })
    .in('item_id', ids)
    .select('item_id')

  if (error) {
    console.log('[archive] Error:', JSON.stringify(error))
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  console.log(`[archive] ${body.archived ? 'Archivados' : 'Desarchivados'}: ${count ?? data?.length ?? 0} items`)

  return NextResponse.json({
    ok: true,
    archived: body.archived,
    affected: count ?? data?.length ?? 0,
  })
}