import { createClient } from '@supabase/supabase-js'
import RentabilidadView from './RentabilidadView'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

type Props = {
  searchParams: Promise<{ period?: string }>
}

// =============================================================================
// HELPERS DE FECHA EN ZONA AR
// =============================================================================

function inicioDiaArgentina(offsetDias: number = 0): Date {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)
  const [year, month, day] = fechaAR.split('-').map(Number)
  const d = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00-03:00`)
  d.setUTCDate(d.getUTCDate() + offsetDias)
  return d
}

function inicioSemanaArgentina(offsetSemanas: number = 0): Date {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)
  const [year, month, day] = fechaAR.split('-').map(Number)
  const dateAR = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00-03:00`)
  const dayOfWeek = dateAR.getUTCDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  dateAR.setUTCDate(dateAR.getUTCDate() - daysToMonday)
  dateAR.setUTCDate(dateAR.getUTCDate() + offsetSemanas * 7)
  const yyyy = dateAR.getUTCFullYear()
  const mm = String(dateAR.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dateAR.getUTCDate()).padStart(2, '0')
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`)
}

function inicioMesArgentina(offsetMeses: number = 0): Date {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)
  const [yearStr, monthStr] = fechaAR.split('-')
  let year = parseInt(yearStr, 10)
  let month = parseInt(monthStr, 10) + offsetMeses
  while (month <= 0) { month += 12; year -= 1 }
  while (month > 12) { month -= 12; year += 1 }
  const mm = String(month).padStart(2, '0')
  return new Date(`${year}-${mm}-01T00:00:00-03:00`)
}

// =============================================================================
// CÁLCULOS
// =============================================================================

type OrderRow = {
  order_id: any
  total_amount: number
  marketplace_fee: number
  shipping_cost: number
  discounts: number
  shipping_logistic_type: string | null
  date_created: string
  status: string
}

type OrderItemRow = {
  order_id: any
  item_id: string
  quantity: number
  unit_price: number
}

type ItemCost = { cost: number; iva_rate: number }

export type Calculo = {
  facturacion: number
  comision: number
  envios: number
  flexBonif: number
  iibb: number
  costoMerca: number
  publicidad: number
  gastosVarios: number
  ganancia: number
  margen: number
  ventas: number
  unidades: number
  ticketPromedio: number
  envioCount: number
  flexCount: number
  diasActivos: number
  diasTotales: number
  mejorDiaMonto: number
  mejorDiaFecha: string | null
  coberturaCosto: number
  comisionPct: number
  roas: number
}

function diaArgentinaFromISO(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function calcularRentabilidad(
  orders: OrderRow[],
  orderItems: OrderItemRow[],
  costsMap: Map<string, ItemCost>,
  iibbPct: number,
  publicidadAmount: number,
  gastosVariosAmount: number,
  desde: Date,
  hasta: Date
): Calculo {
  const paid = orders.filter(o => o.status === 'paid')

  const facturacion = paid.reduce((s, o) => s + Number(o.total_amount ?? 0), 0)
  const comision = paid.reduce((s, o) => s + Number(o.marketplace_fee ?? 0), 0)
  const envios = paid.reduce((s, o) => s + Number(o.shipping_cost ?? 0), 0)
  const flexBonif = paid.reduce((s, o) => s + Number(o.discounts ?? 0), 0)
  const iibb = facturacion * (iibbPct / 100)

  const paidIds = new Set(paid.map(o => String(o.order_id)))
  let costoMerca = 0
  let totalItemsVendidos = 0
  let itemsConCosto = 0
  for (const oi of orderItems) {
    if (!paidIds.has(String(oi.order_id))) continue
    totalItemsVendidos++
    const ci = costsMap.get(oi.item_id)
    if (!ci || !ci.cost) continue
    itemsConCosto++
    const ivaRate = ci.iva_rate ?? 21
    const costoConIva = ci.cost * (1 + ivaRate / 100)
    costoMerca += costoConIva * (oi.quantity ?? 0)
  }

  const ganancia = facturacion - comision - envios + flexBonif - iibb - costoMerca - publicidadAmount - gastosVariosAmount
  const margen = facturacion > 0 ? (ganancia / facturacion) * 100 : 0

  const ventas = paid.length
  let unidades = 0
  for (const oi of orderItems) {
    if (paidIds.has(String(oi.order_id))) unidades += (oi.quantity ?? 0)
  }
  const ticketPromedio = ventas > 0 ? facturacion / ventas : 0

  const envioCount = paid.filter(o => Number(o.shipping_cost ?? 0) > 0).length
  const flexCount = paid.filter(o => o.shipping_logistic_type === 'self_service').length

  const diasConVenta = new Set<string>()
  const totalPorDia = new Map<string, number>()
  for (const o of paid) {
    const dia = diaArgentinaFromISO(o.date_created)
    diasConVenta.add(dia)
    totalPorDia.set(dia, (totalPorDia.get(dia) ?? 0) + Number(o.total_amount ?? 0))
  }
  const diasActivos = diasConVenta.size
  const diasTotales = Math.max(1, Math.ceil((hasta.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000)))

  let mejorDiaMonto = 0
  let mejorDiaFecha: string | null = null
  for (const [dia, monto] of Array.from(totalPorDia.entries())) {
    if (monto > mejorDiaMonto) { mejorDiaMonto = monto; mejorDiaFecha = dia }
  }

  const coberturaCosto = totalItemsVendidos > 0 ? (itemsConCosto / totalItemsVendidos) * 100 : 0
  const comisionPct = facturacion > 0 ? (comision / facturacion) * 100 : 0
  const roas = publicidadAmount > 0 ? facturacion / publicidadAmount : 0

  return {
    facturacion, comision, envios, flexBonif, iibb, costoMerca,
    publicidad: publicidadAmount, gastosVarios: gastosVariosAmount,
    ganancia, margen,
    ventas, unidades, ticketPromedio,
    envioCount, flexCount,
    diasActivos, diasTotales,
    mejorDiaMonto, mejorDiaFecha,
    coberturaCosto, comisionPct, roas,
  }
}

async function fetchPeriodData(supabase: any, desdeISO: string, hastaISO: string) {
  const orders: OrderRow[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('order_id, total_amount, marketplace_fee, shipping_cost, discounts, shipping_logistic_type, date_created, status')
      .gte('date_created', desdeISO)
      .lt('date_created', hastaISO)
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    orders.push(...(data as OrderRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  if (orders.length === 0) {
    return { orders: [], orderItems: [], costsMap: new Map<string, ItemCost>() }
  }

  const orderIds = orders.map(o => o.order_id)
  const orderItems: OrderItemRow[] = []
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500)
    const { data } = await supabase
      .from('order_items')
      .select('order_id, item_id, quantity, unit_price')
      .in('order_id', chunk)
    if (data) orderItems.push(...(data as OrderItemRow[]))
  }

  const itemIds = Array.from(new Set(orderItems.map(oi => oi.item_id).filter(Boolean)))
  const costsMap = new Map<string, ItemCost>()
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500)
    const { data } = await supabase
      .from('items')
      .select('item_id, cost, iva_rate')
      .in('item_id', chunk)
    if (data) {
      for (const it of data as any[]) {
        if (it.cost != null) {
          costsMap.set(it.item_id, { cost: Number(it.cost), iva_rate: Number(it.iva_rate ?? 21) })
        }
      }
    }
  }

  return { orders, orderItems, costsMap }
}

async function fetchAdsTotal(supabase: any, desde: Date, hasta: Date): Promise<number> {
  const desdeStr = diaArgentinaFromISO(desde.toISOString())
  const hastaStr = diaArgentinaFromISO(hasta.toISOString())

  const { data } = await supabase
    .from('ad_expenses')
    .select('amount')
    .gte('date', desdeStr)
    .lte('date', hastaStr)

  if (!data) return 0
  return (data as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

async function fetchQuickExpensesTotal(supabase: any, desde: Date, hasta: Date): Promise<number> {
  const desdeStr = diaArgentinaFromISO(desde.toISOString())
  const hastaStr = diaArgentinaFromISO(hasta.toISOString())

  const { data } = await supabase
    .from('quick_expenses')
    .select('amount')
    .gte('date', desdeStr)
    .lte('date', hastaStr)

  if (!data) return 0
  return (data as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

// =============================================================================
// PÁGINA SERVER COMPONENT
// =============================================================================

export default async function RentabilidadPage({ searchParams }: Props) {
  const params = await searchParams
  const period = params.period ?? 'hoy'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let desdeActual: Date
  let hastaActual: Date
  let desdePrev: Date
  let hastaPrev: Date
  let labelPeriodo: string
  let labelComparacion: string

  const ahora = new Date()

  if (period === 'semana') {
    desdeActual = inicioSemanaArgentina(0)
    hastaActual = ahora
    const lapsoMs = hastaActual.getTime() - desdeActual.getTime()
    desdePrev = inicioSemanaArgentina(-1)
    hastaPrev = new Date(desdePrev.getTime() + lapsoMs)
    labelPeriodo = 'esta semana'
    labelComparacion = 'vs semana anterior'
  } else if (period === 'mes') {
    desdeActual = inicioMesArgentina(0)
    hastaActual = ahora
    const lapsoMs = hastaActual.getTime() - desdeActual.getTime()
    desdePrev = inicioMesArgentina(-1)
    hastaPrev = new Date(desdePrev.getTime() + lapsoMs)
    labelPeriodo = 'este mes'
    labelComparacion = 'vs mes anterior'
  } else {
    desdeActual = inicioDiaArgentina(0)
    hastaActual = ahora
    const lapsoMs = hastaActual.getTime() - desdeActual.getTime()
    desdePrev = inicioDiaArgentina(-1)
    hastaPrev = new Date(desdePrev.getTime() + lapsoMs)
    labelPeriodo = 'hoy'
    labelComparacion = 'vs ayer'
  }

  const { data: taxRow } = await supabase
    .from('tax_config')
    .select('percentage')
    .eq('type', 'iibb')
    .eq('active', true)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const iibbPct = taxRow?.percentage != null ? Number(taxRow.percentage) : 5.0

  const [actual, previo, publicidadActual, publicidadPrev, gastosActual, gastosPrev] = await Promise.all([
    fetchPeriodData(supabase, desdeActual.toISOString(), hastaActual.toISOString()),
    fetchPeriodData(supabase, desdePrev.toISOString(), hastaPrev.toISOString()),
    fetchAdsTotal(supabase, desdeActual, hastaActual),
    fetchAdsTotal(supabase, desdePrev, hastaPrev),
    fetchQuickExpensesTotal(supabase, desdeActual, hastaActual),
    fetchQuickExpensesTotal(supabase, desdePrev, hastaPrev),
  ])

  const calcActual = calcularRentabilidad(
    actual.orders, actual.orderItems, actual.costsMap, iibbPct, publicidadActual, gastosActual,
    desdeActual, hastaActual
  )
  const calcPrev = calcularRentabilidad(
    previo.orders, previo.orderItems, previo.costsMap, iibbPct, publicidadPrev, gastosPrev,
    desdePrev, hastaPrev
  )

  return (
    <RentabilidadView
      period={period}
      labelPeriodo={labelPeriodo}
      labelComparacion={labelComparacion}
      calcActual={calcActual}
      calcPrev={calcPrev}
      iibbPct={iibbPct}
    />
  )
}
