import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type UpdatePayload = {
  matched_keys: string[]
  cost: number
  iva_rate: number
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const updates: UpdatePayload[] = Array.isArray(body.updates) ? body.updates : []
  if (updates.length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay cambios para aplicar' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let updatedItems = 0
  let updatedManuals = 0
  const errors: Array<{ key: string; error: string }> = []

  // Construir batch: agrupar por (cost, iva_rate) para hacer menos queries
  // pero por simplicidad mantenemos un loop. Si performance es problema, refactor.

  for (const u of updates) {
    const cost = Number(u.cost)
    const iva = Number(u.iva_rate)
    if (!Number.isFinite(cost) || cost < 0) {
      for (const k of u.matched_keys) errors.push({ key: k, error: 'Costo inválido' })
      continue
    }
    if (!Number.isFinite(iva) || iva < 0 || iva > 100) {
      for (const k of u.matched_keys) errors.push({ key: k, error: 'IVA inválido' })
      continue
    }

    // Separar keys por tipo
    const itemIds: string[] = []
    const manualSkus: string[] = []
    for (const key of u.matched_keys) {
      if (key.startsWith('MANUAL:')) manualSkus.push(key.slice('MANUAL:'.length))
      else itemIds.push(key)
    }

    if (itemIds.length > 0) {
      const { error, count } = await supabase
        .from('items')
        .update({ cost, iva_rate: iva }, { count: 'exact' })
        .in('item_id', itemIds)
      if (error) {
        for (const id of itemIds) errors.push({ key: id, error: error.message })
      } else {
        updatedItems += count ?? itemIds.length
      }
    }

    if (manualSkus.length > 0) {
      const { error, count } = await supabase
        .from('manual_items')
        .update({ cost, iva_rate: iva }, { count: 'exact' })
        .in('seller_sku', manualSkus)
      if (error) {
        for (const sku of manualSkus) errors.push({ key: `MANUAL:${sku}`, error: error.message })
      } else {
        updatedManuals += count ?? manualSkus.length
      }
    }
  }

  return NextResponse.json({
    ok: true,
    updated_items: updatedItems,
    updated_manuals: updatedManuals,
    total_updated: updatedItems + updatedManuals,
    errors,
    error_count: errors.length,
  })
}