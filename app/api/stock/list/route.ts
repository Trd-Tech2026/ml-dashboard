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
  // Para sort:
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
  const groupBySku = searchParams.get('group') === 'true'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '50', 10)))

  // ===== Helper: aplicar filtros base a una query =====
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

  // ===== Modo SIN agrupar (modo clásico) =====
  if (!groupBySku) {
    let query = supabase
      .from('items')
      .select(SELECT_FIELDS, { count: 'exact' })

    query = applyFilters(query)

    switch (sort) {
      case 'stock_asc': query = query.order('available_quantity', { ascending: true }); break
      case 'sold_desc': query = query.order('sold_quantity', { ascending: false }); break
      case 'title_asc': query = query.order('title', { ascending: true }); break
      case 'recent': query = query.order('date_created', { ascending: false, nullsFirst: false }); break
      case 'stock_desc':
      default: query = query.order('available_quantity', { ascending: false }); break
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const { data, error, count } = await query

    if (error) {
      console.log('[stock/list] Error:', JSON.stringify(error))
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const kpis = await computeKpis(supabase)
    const sync_state = await getSyncState(supabase)

    return NextResponse.json({
      ok: true,
      mode: 'flat',
      items: data ?? [],
      groups: [],
      page,
      pageSize,
      totalFiltered: count ?? 0,
      totalGroups: 0,
      archivedView,
      kpis,
      sync_state,
    })
  }

  // ===== Modo AGRUPADO =====
  // Traemos TODOS los items que matchean los filtros (sin paginar)
  // y agrupamos por SKU en JS.
  let query = supabase
    .from('items')
    .select(SELECT_FIELDS)

  query = applyFilters(query)

  // Paginar la query base con un ceiling alto para no traer cantidades ridículas
  // Si tenés más de 5000 items que matchean, considerá optimizar con SQL nativo.
  const HARD_LIMIT = 5000
  query = query.range(0, HARD_LIMIT - 1)

  const { data, error } = await query

  if (error) {
    console.log('[stock/list] Error:', JSON.stringify(error))
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const allItems = (data ?? []) as Item[]

  // Agrupar por SKU
  const map = new Map<string, Group>()
  for (const item of allItems) {
    const key = item.seller_sku ? `sku:${item.seller_sku}` : `item:${item.item_id}`
    const existing = map.get(key)
    if (existing) {
      existing.items.push(item)
      existing.totalStock = Math.min(existing.totalStock, item.available_quantity)
      existing.totalSold += item.sold_quantity
      existing.minPrice = Math.min(existing.minPrice, item.price)
      existing.maxPrice = Math.max(existing.maxPrice, item.price)
      // Mantener el más reciente para sort 'recent'
      if (item.last_updated && (!existing.maxLastUpdated || item.last_updated > existing.maxLastUpdated)) {
        existing.maxLastUpdated = item.last_updated
      }
      if (item.date_created && (!existing.maxDateCreated || item.date_created > existing.maxDateCreated)) {
        existing.maxDateCreated = item.date_created
      }
    } else {
      map.set(key, {
        key,
        sku: item.seller_sku,
        title: item.title,
        thumbnail: item.thumbnail,
        items: [item],
        totalStock: item.available_quantity,
        totalSold: item.sold_quantity,
        minPrice: item.price,
        maxPrice: item.price,
        currency: item.currency,
        maxLastUpdated: item.last_updated,
        maxDateCreated: item.date_created ?? null,
      })
    }
  }

  let groups = Array.from(map.values())

  // Aplicar sort sobre los grupos
  switch (sort) {
    case 'stock_asc':
      groups.sort((a, b) => a.totalStock - b.totalStock)
      break
    case 'sold_desc':
      groups.sort((a, b) => b.totalSold - a.totalSold)
      break
    case 'title_asc':
      groups.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))
      break
    case 'recent':
      groups.sort((a, b) => {
        const da = a.maxDateCreated ?? ''
        const db = b.maxDateCreated ?? ''
        return db.localeCompare(da)
      })
      break
    case 'stock_desc':
    default:
      groups.sort((a, b) => b.totalStock - a.totalStock)
      break
  }

  const totalGroups = groups.length
  const totalItemsFlat = allItems.length

  // Paginar grupos
  const from = (page - 1) * pageSize
  const to = from + pageSize
  const pagedGroups = groups.slice(from, to)

  const kpis = await computeKpis(supabase)
  const sync_state = await getSyncState(supabase)

  return NextResponse.json({
    ok: true,
    mode: 'grouped',
    items: [],
    groups: pagedGroups,
    page,
    pageSize,
    totalFiltered: totalItemsFlat,  // total de publicaciones que matchean
    totalGroups,                    // total de productos (grupos)
    archivedView,
    kpis,
    sync_state,
  })
}

// ===== Helpers =====
async function computeKpis(supabase: any) {
  const baseKpi = () => supabase.from('items').select('item_id', { count: 'exact', head: true }).eq('archived', false)
  const baseKpiSum = supabase.from('items').select('available_quantity').eq('archived', false)

  const [totalRes, sinStockRes, criticoRes, stockSumRes, archivedRes] = await Promise.all([
    baseKpi(),
    baseKpi().eq('available_quantity', 0),
    baseKpi().gt('available_quantity', 0).lt('available_quantity', 5),
    baseKpiSum,
    supabase.from('items').select('item_id', { count: 'exact', head: true }).eq('archived', true),
  ])

  const stockTotalSum = (stockSumRes.data ?? []).reduce(
    (acc: number, r: { available_quantity: number }) => acc + (r.available_quantity ?? 0),
    0
  )

  return {
    total: totalRes.count ?? 0,
    sin_stock: sinStockRes.count ?? 0,
    critico: criticoRes.count ?? 0,
    stock_total: stockTotalSum,
    archived_count: archivedRes.count ?? 0,
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
