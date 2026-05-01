import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { searchParams } = new URL(request.url)

  // Parámetros con defaults
  const search = searchParams.get('search')?.trim() ?? ''
  const status = searchParams.get('status') ?? 'all'
  const logistic = searchParams.get('logistic') ?? 'all'
  const stockFilter = searchParams.get('stock') ?? 'all'
  const sort = searchParams.get('sort') ?? 'stock_desc'
  const archivedView = searchParams.get('archived') ?? 'false'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? '50', 10)))

  // ---- Query principal ----
  let query = supabase
    .from('items')
    .select('item_id, title, thumbnail, permalink, available_quantity, sold_quantity, price, currency, status, logistic_type, free_shipping, shipping_tags, is_flex, seller_sku, last_updated, archived', { count: 'exact' })

  // Filtro de archivado
  if (archivedView === 'true') {
    query = query.eq('archived', true)
  } else if (archivedView === 'false') {
    query = query.eq('archived', false)
  }

  // Búsqueda
  if (search) {
    const safe = search.replace(/[,()]/g, ' ')
    query = query.or(`title.ilike.%${safe}%,seller_sku.ilike.%${safe}%`)
  }

  // Estado
  if (status !== 'all') {
    query = query.eq('status', status)
  }

  // Logística — Flex es especial: matchea por flag is_flex (incluye coexistencia)
  if (logistic !== 'all') {
    if (logistic === 'flex') {
      query = query.eq('is_flex', true)
    } else if (logistic === 'null') {
      query = query.is('logistic_type', null)
    } else {
      query = query.eq('logistic_type', logistic)
    }
  }

  // Stock
  if (stockFilter === 'zero') {
    query = query.eq('available_quantity', 0)
  } else if (stockFilter === 'critical') {
    query = query.gt('available_quantity', 0).lt('available_quantity', 5)
  } else if (stockFilter === 'normal') {
    query = query.gte('available_quantity', 5)
  }

  // Orden
  switch (sort) {
    case 'stock_asc':
      query = query.order('available_quantity', { ascending: true })
      break
    case 'sold_desc':
      query = query.order('sold_quantity', { ascending: false })
      break
    case 'title_asc':
      query = query.order('title', { ascending: true })
      break
    case 'recent':
      query = query.order('date_created', { ascending: false, nullsFirst: false })
      break
    case 'stock_desc':
    default:
      query = query.order('available_quantity', { ascending: false })
      break
  }

  // Paginación
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  query = query.range(from, to)

  const { data, error, count } = await query

  if (error) {
    console.log('[stock/list] Error:', JSON.stringify(error))
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // ---- KPIs (sobre items no archivados) ----
  const baseKpi = () => supabase.from('items').select('item_id', { count: 'exact', head: true }).eq('archived', false)
  const baseKpiSum = supabase.from('items').select('available_quantity').eq('archived', false)

  const [totalRes, sinStockRes, criticoRes, stockSumRes, archivedRes, syncStateRes] = await Promise.all([
    baseKpi(),
    baseKpi().eq('available_quantity', 0),
    baseKpi().gt('available_quantity', 0).lt('available_quantity', 5),
    baseKpiSum,
    supabase.from('items').select('item_id', { count: 'exact', head: true }).eq('archived', true),
    supabase.from('sync_state_items').select('last_sync_at, total_items').eq('id', 1).maybeSingle(),
  ])

  const stockTotalSum = (stockSumRes.data ?? []).reduce(
    (acc: number, r: { available_quantity: number }) => acc + (r.available_quantity ?? 0),
    0
  )

  return NextResponse.json({
    ok: true,
    items: data ?? [],
    page,
    pageSize,
    totalFiltered: count ?? 0,
    archivedView,
    kpis: {
      total: totalRes.count ?? 0,
      sin_stock: sinStockRes.count ?? 0,
      critico: criticoRes.count ?? 0,
      stock_total: stockTotalSum,
      archived_count: archivedRes.count ?? 0,
    },
    sync_state: syncStateRes.data ?? null,
  })
}