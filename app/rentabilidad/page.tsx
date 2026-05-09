import { createClient } from '@supabase/supabase-js'
import RentabilidadView from './RentabilidadView'
import {
  buildIndividualesByLastSegment,
  calcularCostoItem,
  type ItemCostInfo,
  type ManualComponent,
} from '../lib/combos'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

type Props = {
  searchParams: Promise<{ period?: string }>
}

function inicioDiaArgentina(offsetDias: number = 0): Date {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
  const [year, month, day] = fechaAR.split('-').map(Number)
  const d = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00-03:00`)
  d.setUTCDate(d.getUTCDate() + offsetDias)
  return d
}

function inicioSemanaArgentina(offsetSemanas: number = 0): Date {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
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
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
  const [yearStr, monthStr] = fechaAR.split('-')
  let year = parseInt(yearStr, 10)
  let month = parseInt(monthStr, 10) + offsetMeses
  while (month <= 0) { month += 12; year -= 1 }
  while (month > 12) { month -= 12; year += 1 }
  const mm = String(month).padStart(2, '0')
  return new Date(`${year}-${mm}-01T00:00:00-03:00`)
}

type OrderRow = {
  order_id: any
  total_amount: number
  marketplace_fee: number
  shipping_cost: number
  discounts: number
  shipping_logistic_type: string | null
  date_created: string
  status: string
  cargos_total: number | null
  imp_total: number | null
  imp_iibb_total: number | null
  bonificacion_envio: number | null
  fiscal_v2: boolean | null
}

type OrderItemRow = {
  order_id: any
  item_id: string
  quantity: number
  unit_price: number
}

type ItemRow = {
  item_id: string
  seller_sku: string | null
  cost: number | null
  iva_rate: number | null
}

export type Calculo = {
  facturacion: number
  ingresosNetos: number
  costoMerca: number
  cargosML: number
  retenciones: number
  bonificacionEnvio: number
  publicidad: number
  gastosVarios: number
  ivaDebito: number
  ivaCredito: number
  ivaAPagar: number
  gananciaOperativa: number
  ganancia: number
  margen: number
  margenOperativo: number
  ventas: number
  unidades: number
  unidadesConCosto: number
  unidadesSinCosto: number
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
  comision: number
  envios: number
  flexBonif: number
  iibb: number
}

function diaArgentinaFromISO(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function calcularRentabilidad(
  orders: OrderRow[],
  orderItems: OrderItemRow[],
  itemsBySku: Map<string, ItemRow>,
  costsBySku: Map<string, ItemCostInfo>,
  individualesByLast: Map<string, ItemCostInfo[]>,
  manualComps: Map<string, ManualComponent[]>,
  itemIdToSeller: Map<string, string | null>,
  publicidadAmount: number,
  gastosVariosAmount: number,
  desde: Date,
  hasta: Date
): Calculo {
  const paid = orders.filter(o => o.status === 'paid')
  const paidIds = new Set(paid.map(o => String(o.order_id)))

  const facturacion = paid.reduce((s, o) => s + Number(o.total_amount ?? 0), 0)
  const cargosML = paid.reduce((s, o) => s + Number(o.cargos_total ?? o.marketplace_fee ?? 0), 0)
  const retenciones = paid.reduce((s, o) => s + Number(o.imp_total ?? 0), 0)
  const bonificacionEnvio = paid.reduce((s, o) => s + Number(o.bonificacion_envio ?? o.discounts ?? 0), 0)

  let ingresosNetos = 0
  let ivaDebito = 0
  let costoMerca = 0
  let ivaCredito = 0
  let unidades = 0
  let unidadesConCosto = 0
  let unidadesSinCosto = 0

  for (const oi of orderItems) {
    if (!paidIds.has(String(oi.order_id))) continue
    const qty = oi.quantity ?? 0
    const unitPrice = Number(oi.unit_price ?? 0)
    unidades += qty

    const sellerSku = itemIdToSeller.get(oi.item_id) ?? null
    const itemRow = itemsBySku.get(sellerSku ?? '')
    const itemCostInfo: ItemCostInfo | null = itemRow
      ? {
          seller_sku: itemRow.seller_sku,
          cost: itemRow.cost ? Number(itemRow.cost) : 0,
          iva_rate: itemRow.iva_rate ? Number(itemRow.iva_rate) : 21,
        }
      : null

    const ivaRate = itemCostInfo?.iva_rate ?? 21
    const ivaFactor = 1 + ivaRate / 100
    const subtotalConIva = unitPrice * qty
    const subtotalSinIva = subtotalConIva / ivaFactor
    ingresosNetos += subtotalSinIva
    ivaDebito += subtotalConIva - subtotalSinIva

    const costRes = calcularCostoItem(
      sellerSku, qty, itemCostInfo,
      costsBySku, individualesByLast, manualComps
    )

    if (costRes.source === 'no-data') {
      unidadesSinCosto += qty
    } else {
      unidadesConCosto += qty
      costoMerca += costRes.costoSinIva
      ivaCredito += costRes.ivaCredito
    }
  }

  const ivaAPagar = ivaDebito - ivaCredito
  const gananciaOperativa = ingresosNetos - costoMerca - cargosML - retenciones + bonificacionEnvio - publicidadAmount - gastosVariosAmount
  const ganancia = gananciaOperativa - ivaAPagar
  const margenOperativo = ingresosNetos > 0 ? (gananciaOperativa / ingresosNetos) * 100 : 0
  const margen = ingresosNetos > 0 ? (ganancia / ingresosNetos) * 100 : 0

  const ventas = paid.length
  const ticketPromedio = ventas > 0 ? facturacion / ventas : 0
  const envioCount = paid.filter(o =>
    o.shipping_logistic_type !== null && o.shipping_logistic_type !== 'none'
  ).length
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

  const coberturaCosto = unidades > 0 ? (unidadesConCosto / unidades) * 100 : 0
  const comisionPct = facturacion > 0 ? (cargosML / facturacion) * 100 : 0
  const roas = publicidadAmount > 0 ? facturacion / publicidadAmount : 0

  return {
    facturacion, ingresosNetos,
    costoMerca, cargosML, retenciones, bonificacionEnvio,
    publicidad: publicidadAmount, gastosVarios: gastosVariosAmount,
    ivaDebito, ivaCredito, ivaAPagar,
    gananciaOperativa, ganancia, margen, margenOperativo,
    ventas, unidades, unidadesConCosto, unidadesSinCosto, ticketPromedio,
    envioCount, flexCount,
    diasActivos, diasTotales,
    mejorDiaMonto, mejorDiaFecha,
    coberturaCosto, comisionPct, roas,
    comision: cargosML, envios: 0, flexBonif: bonificacionEnvio, iibb: retenciones,
  }
}

async function fetchPeriodData(supabase: any, desdeISO: string, hastaISO: string) {
  const orders: OrderRow[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('order_id, total_amount, marketplace_fee, shipping_cost, discounts, shipping_logistic_type, date_created, status, cargos_total, imp_total, imp_iibb_total, bonificacion_envio, fiscal_v2')
      .gte('date_created', desdeISO)
      .lt('date_created', hastaISO)
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    orders.push(...(data as OrderRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  if (orders.length === 0) return { orders: [], orderItems: [] }

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

  return { orders, orderItems }
}

async function fetchAllItems(supabase: any) {
  const items: ItemRow[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('item_id, seller_sku, cost, iva_rate')
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    items.push(...(data as ItemRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return items
}

async function fetchAllManualComponents(supabase: any): Promise<Map<string, ManualComponent[]>> {
  const map = new Map<string, ManualComponent[]>()
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('product_components')
      .select('parent_sku, component_sku, quantity')
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const c of data as any[]) {
      if (!map.has(c.parent_sku)) map.set(c.parent_sku, [])
      map.get(c.parent_sku)!.push({
        component_sku: c.component_sku,
        quantity: Number(c.quantity ?? 1),
      })
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return map
}

async function fetchAdsTotal(supabase: any, desde: Date, hasta: Date): Promise<number> {
  const desdeStr = diaArgentinaFromISO(desde.toISOString())
  const hastaStr = diaArgentinaFromISO(hasta.toISOString())
  const { data } = await supabase
    .from('ad_expenses').select('amount')
    .gte('date', desdeStr).lte('date', hastaStr)
  if (!data) return 0
  return (data as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

async function fetchQuickExpensesTotal(supabase: any, desde: Date, hasta: Date): Promise<number> {
  const desdeStr = diaArgentinaFromISO(desde.toISOString())
  const hastaStr = diaArgentinaFromISO(hasta.toISOString())
  const { data } = await supabase
    .from('quick_expenses').select('amount')
    .gte('date', desdeStr).lte('date', hastaStr)
  if (!data) return 0
  return (data as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

export default async function RentabilidadPage({ searchParams }: Props) {
  const params = await searchParams
  const period = params.period ?? 'hoy'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let desdeActual: Date, hastaActual: Date, desdePrev: Date, hastaPrev: Date
  let labelPeriodo: string, labelComparacion: string
  const ahora = new Date()

  if (period === 'semana') {
    desdeActual = inicioSemanaArgentina(0); hastaActual = ahora
    const lapsoMs = hastaActual.getTime() - desdeActual.getTime()
    desdePrev = inicioSemanaArgentina(-1); hastaPrev = new Date(desdePrev.getTime() + lapsoMs)
    labelPeriodo = 'esta semana'; labelComparacion = 'vs semana anterior'
  } else if (period === 'mes') {
    desdeActual = inicioMesArgentina(0); hastaActual = ahora
    const lapsoMs = hastaActual.getTime() - desdeActual.getTime()
    desdePrev = inicioMesArgentina(-1); hastaPrev = new Date(desdePrev.getTime() + lapsoMs)
    labelPeriodo = 'este mes'; labelComparacion = 'vs mes anterior'
  } else {
    desdeActual = inicioDiaArgentina(0); hastaActual = ahora
    const lapsoMs = hastaActual.getTime() - desdeActual.getTime()
    desdePrev = inicioDiaArgentina(-1); hastaPrev = new Date(desdePrev.getTime() + lapsoMs)
    labelPeriodo = 'hoy'; labelComparacion = 'vs ayer'
  }

  const [actual, previo, publicidadActual, publicidadPrev, gastosActual, gastosPrev, allItems, manualComps] = await Promise.all([
    fetchPeriodData(supabase, desdeActual.toISOString(), hastaActual.toISOString()),
    fetchPeriodData(supabase, desdePrev.toISOString(), hastaPrev.toISOString()),
    fetchAdsTotal(supabase, desdeActual, hastaActual),
    fetchAdsTotal(supabase, desdePrev, hastaPrev),
    fetchQuickExpensesTotal(supabase, desdeActual, hastaActual),
    fetchQuickExpensesTotal(supabase, desdePrev, hastaPrev),
    fetchAllItems(supabase),
    fetchAllManualComponents(supabase),
  ])

  // Construir mapas de items
  const itemsBySku = new Map<string, ItemRow>()
  const itemIdToSeller = new Map<string, string | null>()
  const allItemCosts: ItemCostInfo[] = []
  for (const it of allItems) {
    itemIdToSeller.set(it.item_id, it.seller_sku)
    if (it.seller_sku) {
      // Si hay duplicados de seller_sku, priorizar el que tenga cost
      const existing = itemsBySku.get(it.seller_sku)
      if (!existing || (it.cost && !existing.cost)) {
        itemsBySku.set(it.seller_sku, it)
      }
    }
    allItemCosts.push({
      seller_sku: it.seller_sku,
      cost: it.cost ? Number(it.cost) : 0,
      iva_rate: it.iva_rate ? Number(it.iva_rate) : 21,
    })
  }

  const costsBySku = new Map<string, ItemCostInfo>()
  for (const ic of allItemCosts) {
    if (ic.seller_sku && ic.cost > 0) {
      const existing = costsBySku.get(ic.seller_sku)
      if (!existing || ic.cost > 0) costsBySku.set(ic.seller_sku, ic)
    }
  }

  const individualesByLast = buildIndividualesByLastSegment(allItemCosts)

  const calcActual = calcularRentabilidad(
    actual.orders, actual.orderItems,
    itemsBySku, costsBySku, individualesByLast, manualComps, itemIdToSeller,
    publicidadActual, gastosActual, desdeActual, hastaActual
  )
  const calcPrev = calcularRentabilidad(
    previo.orders, previo.orderItems,
    itemsBySku, costsBySku, individualesByLast, manualComps, itemIdToSeller,
    publicidadPrev, gastosPrev, desdePrev, hastaPrev
  )

  return (
    <RentabilidadView
      period={period}
      labelPeriodo={labelPeriodo}
      labelComparacion={labelComparacion}
      calcActual={calcActual}
      calcPrev={calcPrev}
    />
  )
}