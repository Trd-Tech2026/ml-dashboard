import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type Component = {
  component_sku: string
  quantity: number
  notes?: string | null
}

type Body = {
  parent_sku: string
  components: Component[]
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const parent_sku = (body.parent_sku ?? '').trim()
  const components = Array.isArray(body.components) ? body.components : []

  if (!parent_sku) {
    return NextResponse.json({ ok: false, error: 'parent_sku requerido' }, { status: 400 })
  }

  // Validaciones
  for (const c of components) {
    if (!c.component_sku || typeof c.component_sku !== 'string') {
      return NextResponse.json({ ok: false, error: 'component_sku faltante' }, { status: 400 })
    }
    if (c.component_sku.trim() === parent_sku) {
      return NextResponse.json({ ok: false, error: 'Un combo no puede contenerse a sí mismo' }, { status: 400 })
    }
    if (!Number.isInteger(c.quantity) || c.quantity <= 0) {
      return NextResponse.json({ ok: false, error: 'quantity debe ser un entero positivo' }, { status: 400 })
    }
  }

  // Detectar SKUs duplicados en el body
  const seen = new Set<string>()
  for (const c of components) {
    const key = c.component_sku.trim()
    if (seen.has(key)) {
      return NextResponse.json({ ok: false, error: `SKU duplicado: ${key}` }, { status: 400 })
    }
    seen.add(key)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Estrategia: borrar todos los componentes actuales del combo y reinsertar.
  // Es atómico desde el punto de vista del usuario (transacción implícita por cada llamada).
  const { error: deleteError } = await supabase
    .from('product_components')
    .delete()
    .eq('parent_sku', parent_sku)

  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 })
  }

  if (components.length === 0) {
    // El usuario quiso vaciar el combo
    return NextResponse.json({ ok: true, message: 'Combo vacío guardado' })
  }

  const rows = components.map(c => ({
    parent_sku,
    component_sku: c.component_sku.trim(),
    quantity: c.quantity,
    notes: c.notes?.trim() || null,
  }))

  const { error: insertError, data } = await supabase
    .from('product_components')
    .insert(rows)
    .select()

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    message: `${data?.length ?? 0} componente(s) guardado(s)`,
    components: data,
  })
}