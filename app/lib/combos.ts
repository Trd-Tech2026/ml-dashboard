// app/lib/combos.ts

export type ItemCostInfo = {
  seller_sku: string | null
  cost: number
  iva_rate: number
}

export type ManualComponent = {
  component_sku: string
  quantity: number
}

export type ResolvedComponent = {
  fragment: string
  component_sku: string
  quantity: number
  cost: number
  iva_rate: number
}

export type ComboResolution =
  | { isCombo: false }
  | { isCombo: true; source: 'manual' | 'auto'; components: ResolvedComponent[]; alerts: string[] }
  | { isCombo: true; source: 'partial'; resolved: ResolvedComponent[]; missing: string[]; alerts: string[] }
  | { isCombo: true; source: 'fallback'; reason: string; alerts: string[] }

export function resolverCombo(
  sellerSku: string | null,
  costsBySku: Map<string, ItemCostInfo>,
  individualesByLastSegment: Map<string, ItemCostInfo[]>,
  manualComponentsByParent: Map<string, ManualComponent[]>
): ComboResolution {
  if (!sellerSku) return { isCombo: false }
  const alerts: string[] = []

  // PASO 1: Mapping manual desde product_components
  const manuales = manualComponentsByParent.get(sellerSku)
  if (manuales && manuales.length > 0) {
    const components: ResolvedComponent[] = []
    const missing: string[] = []
    for (const m of manuales) {
      const ci = costsBySku.get(m.component_sku)
      if (!ci || !ci.cost) {
        missing.push(m.component_sku)
        continue
      }
      components.push({
        fragment: m.component_sku,
        component_sku: m.component_sku,
        quantity: m.quantity,
        cost: ci.cost,
        iva_rate: ci.iva_rate,
      })
    }
    if (missing.length > 0) {
      alerts.push(`Componentes sin costo: ${missing.join(', ')}`)
      return { isCombo: true, source: 'partial', resolved: components, missing, alerts }
    }
    return { isCombo: true, source: 'manual', components, alerts }
  }

  // PASO 2: Auto-detectar si empieza con CBO-
  if (!sellerSku.startsWith('CBO-')) {
    return { isCombo: false }
  }

  const fragmentos = sellerSku.replace(/^CBO-/, '').split('-').filter(f => f.length > 0)
  if (fragmentos.length < 2) {
    return { isCombo: true, source: 'fallback', reason: 'SKU CBO con menos de 2 fragmentos', alerts: [] }
  }

  const components: ResolvedComponent[] = []
  const missing: string[] = []

  for (const frag of fragmentos) {
    const candidatos = individualesByLastSegment.get(frag) ?? []
    if (candidatos.length === 0) {
      missing.push(frag)
      continue
    }
    const conCosto = candidatos.filter(c => c.cost > 0)
    const elegido = conCosto[0] ?? candidatos[0]
    if (!elegido.cost) {
      missing.push(frag)
      continue
    }
    components.push({
      fragment: frag,
      component_sku: elegido.seller_sku ?? frag,
      quantity: 1,
      cost: elegido.cost,
      iva_rate: elegido.iva_rate,
    })
    if (conCosto.length > 1) {
      alerts.push(`"${frag}" tiene varios matches, se eligió ${elegido.seller_sku}`)
    }
  }

  if (missing.length > 0) {
    alerts.push(`Fragmentos sin componente: ${missing.join(', ')}`)
    return { isCombo: true, source: 'partial', resolved: components, missing, alerts }
  }

  return { isCombo: true, source: 'auto', components, alerts }
}

export function buildIndividualesByLastSegment(items: ItemCostInfo[]): Map<string, ItemCostInfo[]> {
  const map = new Map<string, ItemCostInfo[]>()
  for (const it of items) {
    const sku = it.seller_sku
    if (!sku || sku.startsWith('CBO-')) continue
    const parts = sku.split('-')
    const lastSegment = parts[parts.length - 1]
    if (!lastSegment) continue
    if (!map.has(lastSegment)) map.set(lastSegment, [])
    map.get(lastSegment)!.push(it)
  }
  return map
}

export type ItemCostResolution = {
  costoSinIva: number
  ivaCredito: number
  source: 'item-cost' | 'combo-auto' | 'combo-manual' | 'combo-partial' | 'combo-fallback' | 'no-data'
  alerts: string[]
  isPartial: boolean
}

export function calcularCostoItem(
  itemSellerSku: string | null,
  itemQuantity: number,
  itemCostInfo: ItemCostInfo | null,
  costsBySku: Map<string, ItemCostInfo>,
  individualesByLastSegment: Map<string, ItemCostInfo[]>,
  manualComponentsByParent: Map<string, ManualComponent[]>
): ItemCostResolution {
  const combo = resolverCombo(itemSellerSku, costsBySku, individualesByLastSegment, manualComponentsByParent)

  if (combo.isCombo) {
    if (combo.source === 'manual' || combo.source === 'auto') {
      let costoSinIva = 0
      let ivaCredito = 0
      for (const c of combo.components) {
        const subCosto = c.cost * c.quantity * itemQuantity
        costoSinIva += subCosto
        ivaCredito += subCosto * (c.iva_rate / 100)
      }
      return {
        costoSinIva, ivaCredito,
        source: combo.source === 'manual' ? 'combo-manual' : 'combo-auto',
        alerts: combo.alerts,
        isPartial: false,
      }
    }
    // partial o fallback: caer al cost manual del item
    if (itemCostInfo && itemCostInfo.cost > 0) {
      const costoSinIva = itemCostInfo.cost * itemQuantity
      const baseAlerts = (combo as any).alerts ?? []
      return {
        costoSinIva,
        ivaCredito: costoSinIva * (itemCostInfo.iva_rate / 100),
        source: 'combo-fallback',
        alerts: [...baseAlerts, 'Usando cost manual del combo'],
        isPartial: false,
      }
    }
    return {
      costoSinIva: 0, ivaCredito: 0,
      source: 'no-data',
      alerts: (combo as any).alerts ?? ['Combo sin costo ni componentes'],
      isPartial: true,
    }
  }

  // Producto individual
  if (itemCostInfo && itemCostInfo.cost > 0) {
    const costoSinIva = itemCostInfo.cost * itemQuantity
    return {
      costoSinIva,
      ivaCredito: costoSinIva * (itemCostInfo.iva_rate / 100),
      source: 'item-cost',
      alerts: [],
      isPartial: false,
    }
  }

  return {
    costoSinIva: 0, ivaCredito: 0,
    source: 'no-data',
    alerts: [],
    isPartial: true,
  }
}