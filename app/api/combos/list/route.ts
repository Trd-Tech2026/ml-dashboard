import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const COMBO_PREFIX = 'CBO-'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Buscar todas las publicaciones cuyo SKU empieza con CBO-
  const { data: comboItems, error: itemsError } = await supabase
    .from('items')
    .select('item_id, title, thumbnail, permalink, available_quantity, sold_quantity, price, currency, status, seller_sku, archived')
    .ilike('seller_sku', `${COMBO_PREFIX}%`)
    .eq('archived', false)
    .order('title', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 })
  }

  const items = comboItems ?? []

  // 2. Agrupar por SKU (un combo puede tener varias publicaciones: catálogo + tradicional + cuotas)
  const groupsMap = new Map<string, any>()
  for (const item of items) {
    const sku = item.seller_sku
    if (!sku) continue
    const g = groupsMap.get(sku)
    if (g) {
      g.publications.push(item)
      g.totalStock = Math.min(g.totalStock, item.available_quantity)
      g.totalSold += item.sold_quantity
    } else {
      groupsMap.set(sku, {
        sku,
        title: item.title,
        thumbnail: item.thumbnail,
        publications: [item],
        totalStock: item.available_quantity,
        totalSold: item.sold_quantity,
        currency: item.currency,
      })
    }
  }

  const combos = Array.from(groupsMap.values())

  // 3. Traer la configuración de componentes para todos los combos en un solo query
  const skus = combos.map(c => c.sku)
  let componentsBySku = new Map<string, any[]>()

  if (skus.length > 0) {
    const { data: comps, error: compsError } = await supabase
      .from('product_components')
      .select('parent_sku, component_sku, quantity, notes')
      .in('parent_sku', skus)

    if (compsError) {
      return NextResponse.json({ ok: false, error: compsError.message }, { status: 500 })
    }

    for (const c of (comps ?? [])) {
      const list = componentsBySku.get(c.parent_sku) ?? []
      list.push({
        component_sku: c.component_sku,
        quantity: c.quantity,
        notes: c.notes,
      })
      componentsBySku.set(c.parent_sku, list)
    }
  }

  // 4. Para cada componente, obtener su stock real (mínimo entre publicaciones del componente)
  const allComponentSkus = new Set<string>()
  for (const list of componentsBySku.values()) {
    for (const c of list) {
      allComponentSkus.add(c.component_sku)
    }
  }

  let componentItemsBySku = new Map<string, any[]>()
  if (allComponentSkus.size > 0) {
    const { data: compItems } = await supabase
      .from('items')
      .select('item_id, title, available_quantity, seller_sku, status, archived')
      .in('seller_sku', Array.from(allComponentSkus))
      .eq('archived', false)

    for (const it of (compItems ?? [])) {
      if (!it.seller_sku) continue
      const list = componentItemsBySku.get(it.seller_sku) ?? []
      list.push(it)
      componentItemsBySku.set(it.seller_sku, list)
    }
  }

  // 5. Calcular stock real de cada combo
  const result = combos.map(combo => {
    const components = componentsBySku.get(combo.sku) ?? []
    const isConfigured = components.length > 0

    // Enriquecer cada componente con su stock real
    const enrichedComponents = components.map(c => {
      const items = componentItemsBySku.get(c.component_sku) ?? []
      const minStock = items.length > 0
        ? Math.min(...items.map(i => i.available_quantity))
        : 0
      const title = items[0]?.title ?? '(no encontrado)'
      // Cuántos combos podemos armar con este componente
      const possibleCombos = c.quantity > 0 ? Math.floor(minStock / c.quantity) : 0
      return {
        component_sku: c.component_sku,
        component_title: title,
        quantity: c.quantity,
        notes: c.notes,
        component_stock: minStock,
        possible_combos: possibleCombos,
        found: items.length > 0,
      }
    })

    // Stock real del combo = mínimo entre los possible_combos de cada componente
    let realStock: number | null = null
    if (isConfigured) {
      const validCombos = enrichedComponents.filter(c => c.found)
      if (validCombos.length > 0) {
        realStock = Math.min(...validCombos.map(c => c.possible_combos))
      } else {
        realStock = 0
      }
    }

    return {
      sku: combo.sku,
      title: combo.title,
      thumbnail: combo.thumbnail,
      ml_stock: combo.totalStock,  // lo que dice ML (mínimo entre publicaciones)
      real_stock: realStock,        // calculado por componentes (null si no configurado)
      total_sold: combo.totalSold,
      publications_count: combo.publications.length,
      currency: combo.currency,
      is_configured: isConfigured,
      components: enrichedComponents,
      publications: combo.publications.map((p: any) => ({
        item_id: p.item_id,
        permalink: p.permalink,
        available_quantity: p.available_quantity,
        price: p.price,
        status: p.status,
      })),
    }
  })

  return NextResponse.json({
    ok: true,
    combos: result,
    total: result.length,
    configured: result.filter(c => c.is_configured).length,
    unconfigured: result.filter(c => !c.is_configured).length,
  })
}