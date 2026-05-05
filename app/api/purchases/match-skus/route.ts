import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type IncomingItem = {
  supplier_code: string | null
  description: string | null
  quantity: number | null
  unit_cost: number | null
  subtotal?: number | null
}

type Suggestion = {
  seller_sku: string
  title: string
  thumbnail: string | null
  current_stock: number
  is_manual: boolean
  match_type: 'exact' | 'contains' | 'learned'
  match_score: number // 0-100
}

type MatchedItem = {
  index: number
  supplier_code: string | null
  description: string | null
  quantity: number | null
  unit_cost: number | null
  subtotal: number | null
  suggestions: Suggestion[]
  best_match: Suggestion | null
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const items: IncomingItem[] = body.items ?? []
    const supplierCuit: string | null = body.supplier_cuit ?? null

    if (!Array.isArray(items)) {
      return NextResponse.json({ ok: false, error: 'items debe ser un array' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Buscar el supplier_id si tenemos CUIT
    let supplierId: number | null = null
    if (supplierCuit) {
      const { data: sup } = await supabase
        .from('suppliers')
        .select('id')
        .eq('cuit', supplierCuit.replace(/[^0-9]/g, ''))
        .maybeSingle()
      if (sup) supplierId = sup.id
    }

    // Traer mappings aprendidos del proveedor (si existe)
    const learnedMap = new Map<string, { seller_sku: string; is_manual: boolean }>()
    if (supplierId) {
      const { data: mappings } = await supabase
        .from('supplier_sku_mapping')
        .select('supplier_code, seller_sku, is_manual_item')
        .eq('supplier_id', supplierId)
      for (const m of mappings ?? []) {
        learnedMap.set(m.supplier_code.toUpperCase(), {
          seller_sku: m.seller_sku,
          is_manual: !!m.is_manual_item,
        })
      }
    }

    // Procesar cada item
    const results: MatchedItem[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const code = (item.supplier_code ?? '').trim().toUpperCase()
      const suggestions: Suggestion[] = []

      // 1. Match aprendido (max prioridad)
      if (code && learnedMap.has(code)) {
        const learned = learnedMap.get(code)!
        const sug = await fetchProductInfo(supabase, learned.seller_sku, learned.is_manual)
        if (sug) {
          suggestions.push({ ...sug, match_type: 'learned', match_score: 100 })
        }
      }

      // 2. Match parcial: SKUs que contengan el código del proveedor
      if (code && code.length >= 4) {
        const safeCode = code.replace(/[%_,()]/g, '')
        if (safeCode.length >= 4) {
          // Buscar en items (ML)
          const { data: mlItems } = await supabase
            .from('items')
            .select('item_id, seller_sku, title, thumbnail, available_quantity')
            .ilike('seller_sku', `%${safeCode}%`)
            .eq('archived', false)
            .limit(10)

          // Agrupar por SKU (puede haber varias publicaciones del mismo)
          const seenSkus = new Set<string>()
          for (const ml of mlItems ?? []) {
            if (!ml.seller_sku) continue
            if (seenSkus.has(ml.seller_sku)) continue
            if (suggestions.some(s => s.seller_sku === ml.seller_sku)) continue
            seenSkus.add(ml.seller_sku)

            const score = calculateScore(ml.seller_sku, code)
            const matchType = ml.seller_sku.toUpperCase() === code ? 'exact' : 'contains'

            suggestions.push({
              seller_sku: ml.seller_sku,
              title: ml.title,
              thumbnail: ml.thumbnail,
              current_stock: ml.available_quantity,
              is_manual: false,
              match_type: matchType,
              match_score: score,
            })
          }

          // Buscar en manual_items
          const { data: manualItems } = await supabase
            .from('manual_items')
            .select('seller_sku, title, available_quantity')
            .ilike('seller_sku', `%${safeCode}%`)
            .limit(5)

          for (const mi of manualItems ?? []) {
            if (suggestions.some(s => s.seller_sku === mi.seller_sku)) continue
            const score = calculateScore(mi.seller_sku, code)
            const matchType = mi.seller_sku.toUpperCase() === code ? 'exact' : 'contains'

            suggestions.push({
              seller_sku: mi.seller_sku,
              title: mi.title,
              thumbnail: null,
              current_stock: mi.available_quantity,
              is_manual: true,
              match_type: matchType,
              match_score: score,
            })
          }
        }
      }

      // Ordenar sugerencias por score descendente
      suggestions.sort((a, b) => b.match_score - a.match_score)

      results.push({
        index: i,
        supplier_code: item.supplier_code,
        description: item.description,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        subtotal: item.subtotal ?? null,
        suggestions: suggestions.slice(0, 5), // top 5
        best_match: suggestions[0] ?? null,
      })
    }

    return NextResponse.json({
      ok: true,
      supplier_id: supplierId,
      matched: results,
      total_items: items.length,
      auto_matched: results.filter(r => r.best_match !== null).length,
      unmatched: results.filter(r => r.best_match === null).length,
    })
  } catch (err: any) {
    console.error('[match-skus] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'Error desconocido' }, { status: 500 })
  }
}

async function fetchProductInfo(supabase: any, sku: string, isManual: boolean): Promise<Suggestion | null> {
  if (isManual) {
    const { data } = await supabase
      .from('manual_items')
      .select('seller_sku, title, available_quantity')
      .eq('seller_sku', sku)
      .maybeSingle()
    if (!data) return null
    return {
      seller_sku: data.seller_sku,
      title: data.title,
      thumbnail: null,
      current_stock: data.available_quantity,
      is_manual: true,
      match_type: 'learned',
      match_score: 100,
    }
  } else {
    const { data } = await supabase
      .from('items')
      .select('item_id, seller_sku, title, thumbnail, available_quantity')
      .eq('seller_sku', sku)
      .eq('archived', false)
      .limit(1)
      .maybeSingle()
    if (!data) return null
    return {
      seller_sku: data.seller_sku!,
      title: data.title,
      thumbnail: data.thumbnail,
      current_stock: data.available_quantity,
      is_manual: false,
      match_type: 'learned',
      match_score: 100,
    }
  }
}

// Score de matching: cuanto más exacto, mejor
function calculateScore(sellerSku: string, supplierCode: string): number {
  const sku = sellerSku.toUpperCase()
  const code = supplierCode.toUpperCase()
  if (sku === code) return 100
  if (sku.endsWith(code)) return 95 // termina exactamente en el código (ej: AT-PLA-EPA2400PI termina en EPA2400PI)
  if (sku.startsWith(code)) return 90
  if (sku.includes(code)) {
    // Calcular qué proporción del SKU es el código
    const ratio = code.length / sku.length
    return Math.floor(60 + ratio * 30) // entre 60 y 90
  }
  return 0
}