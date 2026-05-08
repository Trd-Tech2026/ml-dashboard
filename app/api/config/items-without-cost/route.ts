import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = Math.min(180, Math.max(7, parseInt(searchParams.get('days') ?? '30', 10)))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fecha desde
  const desde = new Date()
  desde.setDate(desde.getDate() - days)
  const desdeISO = desde.toISOString()

  // Trae las orders pagadas del período
  const { data: paidOrders } = await supabase
    .from('orders')
    .select('order_id')
    .eq('status', 'paid')
    .gte('date_created', desdeISO)
    .limit(5000)

  if (!paidOrders || paidOrders.length === 0) {
    return NextResponse.json({ ok: true, items: [], total: 0 })
  }

  const orderIds = paidOrders.map(o => o.order_id)

  // Order items vendidos
  const orderItems: Array<{ item_id: string; quantity: number }> = []
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500)
    const { data } = await supabase
      .from('order_items')
      .select('item_id, quantity')
      .in('order_id', chunk)
    if (data) orderItems.push(...(data as any[]))
  }

  // Agrupar por item_id (cantidad total vendida)
  const ventasPorItem = new Map<string, number>()
  for (const oi of orderItems) {
    if (!oi.item_id) continue
    ventasPorItem.set(oi.item_id, (ventasPorItem.get(oi.item_id) ?? 0) + Number(oi.quantity ?? 0))
  }

  const itemIds = Array.from(ventasPorItem.keys())

  // Buscar items con/sin costo
  const itemsInfo: Array<{ item_id: string; title: string; cost: number | null; iva_rate: number; thumbnail: string | null }> = []
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500)
    const { data } = await supabase
      .from('items')
      .select('item_id, title, cost, iva_rate, thumbnail')
      .in('item_id', chunk)
    if (data) itemsInfo.push(...(data as any[]))
  }

  // Filtrar los que NO tienen costo
  const sinCosto = itemsInfo
    .filter(it => it.cost == null || Number(it.cost) <= 0)
    .map(it => ({
      item_id: it.item_id,
      title: it.title,
      thumbnail: it.thumbnail,
      iva_rate: Number(it.iva_rate ?? 21),
      vendidos: ventasPorItem.get(it.item_id) ?? 0,
    }))
    .sort((a, b) => b.vendidos - a.vendidos)

  return NextResponse.json({
    ok: true,
    items: sinCosto,
    total: sinCosto.length,
    days,
  })
}