import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const id = body.id ? Number(body.id) : null
  const percentage = Number(body.percentage)
  const name = body.name ? String(body.name).trim() : null
  const jurisdiction = body.jurisdiction ? String(body.jurisdiction).trim() : null
  const notes = body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : undefined

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Falta el id' }, { status: 400 })
  }
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return NextResponse.json({ ok: false, error: 'Porcentaje inválido (0-100)' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const updateData: Record<string, any> = {
    percentage,
    updated_at: new Date().toISOString(),
  }
  if (name) updateData.name = name
  if (jurisdiction) updateData.jurisdiction = jurisdiction
  if (notes !== undefined) updateData.notes = notes

  const { data, error } = await supabase
    .from('tax_config')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, config: data })
}