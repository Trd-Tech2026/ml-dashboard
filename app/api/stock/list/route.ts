import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type Item = {
  item_id: string
  title: string
  thumbnail: string | null
  permalink: string | null
  available_quantity: number
  sold_quantity: number
  price: number
  currency: string
  status: string
  logistic_type: string | null
  free_shipping: boolean
  shipping_tags: string[]
  is_flex: boolean
  seller_sku: string | null
  last_updated: string | null
  archived: boolean
  date_created?: string | null
  is_manual?: boolean
  cost?: number | null
}

type Group = {
  key: string
  sku: string | null
  title: string
  thumbnail: string | null
  items: Item[]
  totalStock: number
  totalSold: number
  minPrice: number
  maxPrice: number
  currency: string
  is_manual: boolean
  maxLastUpdated: string | null
  maxDateCreated: string | null
}

const SELECT_FIELDS = 'item_id, title, thumbnail, permalink, available_quantity, sold_quantity, price, currency, status, logistic_type, free_shipping, shipping_tags, is_flex, seller_sku, last_updated, archived, date_created'

export async function GET(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { searchParams } = new URL(request.url)

  const search = searchParams.get('search')?.trim() ?? ''
  const status = searchParams.get('status') ?? 'all'
  const logistic = searchParams.get('logistic') ?? 'all'
  const stockFilter = searchParams.get('stock') ?? 'all'
  const sort = searchParams.get('sort') ?? 'stock_desc'
  const archivedView = searchParams.get('archived') ?? 'false'
  const groupBySku = searchParams.get('group') !== 'false'
  const includeManual = searchParams.get('manual') !== 'false'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '50', 10)))

  const applyFilters = (q: any) => {
    if (archivedView === 'true') q = q.eq('archived', true)
    else if (archivedView === 'false') q = q.eq('archived', false)
    if (search) {
      const safe = search.replace(/[,()]/g, ' ')
      q = q.or(`title.ilike.%${safe}%,seller_sku.ilike.%${safe}%`)
    }
    if (status !== 'all') q = q.eq('status', status)
    if (logistic !== 'all') {
      if (logistic === 'flex') q = q.eq('is_flex', true)
      else if (logistic === 'null') q = q.is('logistic_type', null)
      else q = q.eq('logistic_type', logistic)
    }
    if (stockFilter === 'zero') q = q.eq('available_quantity', 0)
    else if (stockFilter === 'critical') q = q.gt('available_quantity', 0).lt('available_quantity', 5)
    else if (stockFilter === 'normal') q = q.gte('available_quantity', 5)
    return q
  }

  const fetchManualItems = async (): Promise<Item[]> => {
    if (!includeManual) return []
    if (archivedView === 'true') return []
    let q = supabase.from('manual_items').select('seller_sku, title, available_quantity, cost, notes, created_at, updated_at')
    if (search) {
      const safe = search.replace(/[,()]/g, ' ')
      q = q.or(`title.ilike.%${safe}%,seller_sku.ilike.%${safe}%`)
    }
    if (stockFilter === 'zero') q = q.eq('available_quantity', 0)
    else if (stockFilter === 'critical') q = q.gt('available_quantity', 0).lt('available_quantity', 5)
    else if (stockFilter === 'normal') q = q.gte('available_quantity', 5)
    if (status !== 'all' && status !== 'active') return []
    if (logistic !== 'all' && logistic !== 'null') return []
    const { data, error } = await q
    if (error || !data) return []
    return data.map(m => ({
      item_id: `MANUAL_${m.seller_sku}`,
      title: m.title,
      thumbnail: null,
      permalink: null,
      available_quantity: m.available_quantity,
      sold_quantity: 0,
      price: 0,
      currency: 'ARS',
      status: 'active',
      logistic_type: null,
      free_shipping: false,
      shipping_tags: [],
      is_flex: false,
      seller_sku: m.seller_sku,
      last_updated: m.updated_at,
      archived: false,
      date_created: m.created_at,
      is_manual: true,
      cost: m.cost,
    }))
  }

  if (!groupBySku) {
    let query = supabase.from('items').select(SELECT_FIELDS, { count: 'exact' })
    query = applyFilters(query)
    switch (sort) {
      case 'stock_asc': query = query.order('available_quantity', { ascending: true }); break
      case 'sold_desc': query = query.order('sold_quantity', { ascending: false }); break
      case 'title_asc': query = query.order('title', { ascending: true }); break
      case 'recent': query = query.order('date_created', { ascending: false, nullsFirst: false }); break
      default: query = query.order('available_quantity', { ascending: false }); break
    }
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)
    const [{ data: mlData, error, count }, manualItems] = await Promise.all([query, fetchManualItems()])
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    let allItems: Item[] = [...(mlData ?? []) as Item[], ...manualItems]
    if (manualItems.length > 0) allItems = sortItems(allItems, sort)
    const kpis = await computeKpis(supabase, includeManual)
    const sync_state = await getSyncState(supabase)
    return NextResponse.json({
      ok: true, mode: 'flat', items: allItems, groups: [],
      page, pageSize, totalFiltered: (count ?? 0) + manualItems.length,
      totalGroups: 0, archivedView, kpis, sync_state,
    })
  }

  let query = supabase.from('items').select(SELECT_FIELDS)
  query = applyFilters(query)
  query = query.range(0, 4999)

  const [{ data, error }, manualItems] = await Promise.all([query, fetchManualItems()])
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const mlItems = ((data ?? []) as Item[])
  const allItems = [...mlItems, ...manualItems]

  const map = new Map<string, Group>()
  for (const item of allItems) {
    const key = item.seller_sku ? `sku:${item.seller_sku}` : `item:${item.item_id}`
    const existing = map.get(key)
    if (existing) {
      existing.items.push(item)
      existing.totalStock = Math.max(existing.totalStock, item.available_quantity ?? 0)
      existing.totalSold += item.sold_quantity
      existing.minPrice = Math.min(existing.minPrice, item.price || 0)
      existing.maxPrice = Math.max(existing.maxPrice, item.price || 0)
      if (item.last_updated && (!existing.maxLastUpdated || item.last_updated > existing.maxLastUpdated)) existing.maxLastUpdated = item.last_updated
      if (item.date_created && (!existing.maxDateCreated || item.date_created > existing.maxDateCreated)) existing.maxDateCreated = item.date_created
      if (item.is_manual) existing.is_manual = true
    } else {
      map.set(key, {
        key, sku: item.seller_sku, title: item.title, thumbnail: item.thumbnail,
        items: [item],
        totalStock: item.available_quantity ?? 0,
        totalSold: item.sold_quantity ?? 0,
        minPrice: item.price || 0, maxPrice: item.price || 0,
        currency: item.currency, is_manual: !!item.is_manual,
        maxLastUpdated: item.last_updated, maxDateCreated: item.date_created ?? null,
      })
    }
  }

  for (const group of Array.from(map.values())) {
    if (group.items.length > 1) {
      group.items.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1
        if (b.status === 'active' && a.status !== 'active') return 1
        return (b.sold_quantity ?? 0) - (a.sold_quantity ?? 0)
      })
    }
  }

  let groups = Array.from(map.values())

  switch (sort) {
    case 'stock_asc': groups.sort((a, b) => a.totalStock - b.totalStock); break
    case 'sold_desc': groups.sort((a, b) => b.totalSold - a.totalSold); break
    case 'title_asc': groups.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })); break
    case 'recent':
      groups.sort((a, b) => { const da = a.maxDateCreated ?? ''; const db = b.maxDateCreated ?? ''; return db.localeCompare(da) })
      break
    default: groups.sort((a, b) => b.totalStock - a.totalStock); break
  }

  const totalGroups = groups.length
  const totalItemsFlat = allItems.length
  const from = (page - 1) * pageSize
  const to = from + pageSize
  const pagedGroups = groups.slice(from, to)

  const kpis = await computeKpis(supabase, includeManual)
  const sync_state = await getSyncState(supabase)

  return NextResponse.json({
    ok: true, mode: 'grouped', items: [], groups: pagedGroups,
    page, pageSize, totalFiltered: totalItemsFlat, totalGroups,
    archivedView, kpis, sync_state,
  })
}

function sortItems(items: Item[], sort: string): Item[] {
  switch (sort) {
    case 'stock_asc': return [...items].sort((a, b) => a.available_quantity - b.available_quantity)
    case 'sold_desc': return [...items].sort((a, b) => b.sold_quantity - a.sold_quantity)
    case 'title_asc': return [...items].sort((a, b) => a.title.localeCompare(b.title, 'es'))
    case 'recent': return [...items].sort((a, b) => { const da = a.date_created ?? ''; const db = b.date_created ?? ''; return db.localeCompare(da) })
    default: return [...items].sort((a, b) => b.available_quantity - a.available_quantity)
  }
}

async function computeKpis(supabase: any, includeManual: boolean) {
  type StockRow = { item_id: string; seller_sku: string | null; available_quantity: number }
  const itemsForKpis: StockRow[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('item_id, seller_sku, available_quantity')
      .eq('archived', false)
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    itemsForKpis.push(...(data as StockRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  const stockByGroup = new Map<string, number>()
  for (const item of itemsForKpis) {
    const key = item.seller_sku ? `sku:${item.seller_sku}` : `item:${item.item_id}`
    const current = stockByGroup.get(key)
    const itemStock = item.available_quantity ?? 0
    if (current === undefined) stockByGroup.set(key, itemStock)
    else stockByGroup.set(key, Math.max(current, itemStock))
  }

  let uniqueSkus = stockByGroup.size
  let stockTotal = 0
  let sinStockCount = 0
  let criticoCount = 0
  for (const stock of Array.from(stockByGroup.values())) {
    stockTotal += stock
    if (stock === 0) sinStockCount++
    else if (stock < 5) criticoCount++
  }

  let manualCount = 0
  let manualStock = 0
  let manualSinStock = 0
  let manualCritico = 0
  if (includeManual) {
    const { data } = await supabase.from('manual_items').select('available_quantity')
    if (data) {
      manualCount = data.length
      for (const m of data as { available_quantity: number }[]) {
        const q = m.available_quantity ?? 0
        manualStock += q
        if (q === 0) manualSinStock++
        else if (q < 5) manualCritico++
      }
    }
  }

  const { count: archivedCount } = await supabase
    .from('items')
    .select('item_id', { count: 'exact', head: true })
    .eq('archived', true)

  return {
    total: uniqueSkus + manualCount,
    sin_stock: sinStockCount + manualSinStock,
    critico: criticoCount + manualCritico,
    stock_total: stockTotal + manualStock,
    archived_count: archivedCount ?? 0,
    manual_count: manualCount,
  }
}

async function getSyncState(supabase: any) {
  const { data } = await supabase
    .from('sync_state_items')
    .select('last_sync_at, total_items')
    .eq('id', 1)
    .maybeSingle()
  return data ?? null
}