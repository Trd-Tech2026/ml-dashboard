import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = ['packaging', 'envios', 'servicios', 'banco', 'impuestos', 'otro']

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  if (!body) {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const id = body.id ? Number(body.id) : null
  const date = String(body.date ?? '').trim()
  const amount = Number(body.amount)
  const category = String(body.category ?? 'otro').trim().toLowerCase()
  const description = body.description ? String(body.description).trim() : null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: 'Fecha inválida (formato YYYY-MM-DD)' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: 'Monto inválido (debe ser > 0)' }, { status: 400 })
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ ok: false, error: `Categoría inválida. Válidas: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const payload = { date, amount, category, description }

  if (id) {
    const { data, error } = await supabase
      .from('quick_expenses')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, expense: data, action: 'updated' })
  } else {
    const { data, error } = await supabase
      .from('quick_expenses')
      .insert(payload)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, expense: data, action: 'created' })
  }
}
