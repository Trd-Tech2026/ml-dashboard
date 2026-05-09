import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET: lista todos los combos del catalogo (CBO-*) con su mapping si existe
export async function GET() {
  const supabase = getSupabase()

  // 1) Traer todos los items que son combos (seller_sku LIKE 'CBO-%')
  const { data: combosRaw, error: errCombos } = await supabase
    .from('items')
    .select('item_id, seller_sku, title, cost, iva_rate, archived')
    .like('seller_sku', 'CBO-%')
    .order('seller_sku')
  if (errCombos) return NextResponse.json({ ok: false, error: errCombos.message }, { status: 500 })

  // Deduplicar por seller_sku
  const combosMap = new Map<string, any>()
  for (const c of combosRaw ?? []) {
    if (!c.seller_sku) continue
    if (!combosMap.has(c.seller_sku)) {
      combosMap.set(c.seller_sku, {
        seller_sku: c.seller_sku,
        title: c.title,
        cost_manual: c.cost,
        iva_rate: c.iva_rate,
        publicaciones: [c.item_id],
        archived_count: c.archived ? 1 : 0,
      })
    } else {
      const existing = combosMap.get(c.seller_sku)
      existing.publicaciones.push(c.item_id)
      if (c.archived) existing.archived_count++
    }
  }
  const combos = Array.from(combosMap.values())

  // 2) Traer los componentes manuales
  const { data: comps } = await supabase
    .from('product_components')
    .select('parent_sku, child_sku, quantity, source')

  const componentsByParent = new Map<string, any[]>()
  for (const c of comps ?? []) {
    if (!componentsByParent.has(c.parent_sku)) componentsByParent.set(c.parent_sku, [])
    componentsByParent.get(c.parent_sku)!.push(c)
  }

  // 3) Traer items individuales para auto-resolver y dar info de cost
  const { data: individualesRaw } = await supabase
    .from('items')
    .select('seller_sku, title, cost, iva_rate')
    .not('seller_sku', 'like', 'CBO-%')
    .not('seller_sku', 'is', null)

  const individualesBySku = new Map<string, any>()
  const individualesByLast = new Map<string, any[]>()
  for (const it of individualesRaw ?? []) {
    if (!it.seller_sku) continue
    individualesBySku.set(it.seller_sku, it)
    const parts = it.seller_sku.split('-')
    const last = parts[parts.length - 1]
    if (!individualesByLast.has(last)) individualesByLast.set(last, [])
    individualesByLast.get(last)!.push(it)
  }

  // 4) Por cada combo, intentar auto-resolver y devolver el estado
  const result = combos.map((c: any) => {
    const manualComps = componentsByParent.get(c.seller_sku) ?? []
    let estado: 'manual' | 'auto' | 'partial' | 'sin_componentes' = 'sin_componentes'
    let componentes: any[] = []
    let missing: string[] = []

    if (manualComps.length > 0) {
      estado = 'manual'
      componentes = manualComps.map((mc: any) => {
        const it = individualesBySku.get(mc.child_sku)
        return {
          child_sku: mc.child_sku,
          title: it?.title ?? '(no encontrado)',
          quantity: mc.quantity,
          cost: it?.cost ?? null,
          iva_rate: it?.iva_rate ?? null,
        }
      })
    } else {
      // Intentar auto
      const fragmentos = c.seller_sku.replace(/^CBO-/, '').split('-').filter((f: string) => f.length > 0)
      const resolvedAuto: any[] = []
      const missingAuto: string[] = []
      for (const frag of fragmentos) {
        const cands = individualesByLast.get(frag) ?? []
        const conCosto = cands.filter((cc: any) => cc.cost > 0)
        const elegido = conCosto[0] ?? cands[0]
        if (!elegido) {
          missingAuto.push(frag)
        } else {
          resolvedAuto.push({
            child_sku: elegido.seller_sku,
            title: elegido.title,
            quantity: 1,
            cost: elegido.cost,
            iva_rate: elegido.iva_rate,
          })
        }
      }
      if (missingAuto.length === 0 && resolvedAuto.length > 0) {
        estado = 'auto'
        componentes = resolvedAuto
      } else if (resolvedAuto.length > 0) {
        estado = 'partial'
        componentes = resolvedAuto
        missing = missingAuto
      } else {
        estado = 'sin_componentes'
        missing = missingAuto.length > 0 ? missingAuto : fragmentos
      }
    }

    const costoCalculado = componentes.reduce((s: number, c: any) => s + (Number(c.cost ?? 0) * Number(c.quantity ?? 1)), 0)

    return {
      seller_sku: c.seller_sku,
      title: c.title,
      cost_manual: c.cost_manual,
      costo_calculado: costoCalculado,
      iva_rate: c.iva_rate,
      publicaciones: c.publicaciones.length,
      archived_count: c.archived_count,
      estado,
      componentes,
      missing,
    }
  })

  return NextResponse.json({ ok: true, combos: result })
}

// POST: guardar/actualizar componentes manuales para un combo
export async function POST(request: Request) {
  const body = await request.json()
  const { parent_sku, components } = body as {
    parent_sku: string
    components: { child_sku: string; quantity?: number }[]
  }

  if (!parent_sku || !Array.isArray(components)) {
    return NextResponse.json({ ok: false, error: 'parent_sku y components requeridos' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Borrar mapping previo
  await supabase.from('product_components').delete().eq('parent_sku', parent_sku)

  if (components.length === 0) {
    return NextResponse.json({ ok: true, message: 'Mapping eliminado' })
  }

  // Insertar nuevos
  const rows = components.map(c => ({
    parent_sku,
    child_sku: c.child_sku.trim(),
    quantity: c.quantity ?? 1,
    source: 'manual',
  }))

  const { error } = await supabase.from('product_components').insert(rows)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, inserted: rows.length })
}

// DELETE: borrar todos los componentes de un combo
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const parent_sku = searchParams.get('parent_sku')
  if (!parent_sku) return NextResponse.json({ ok: false, error: 'falta parent_sku' }, { status: 400 })

  const supabase = getSupabase()
  const { error } = await supabase.from('product_components').delete().eq('parent_sku', parent_sku)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}