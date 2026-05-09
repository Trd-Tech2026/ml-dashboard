import { createClient } from '@supabase/supabase-js'
import RentabilidadView from './RentabilidadView'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

type Props = {
  searchParams: Promise<{ period?: string }>
}

// =============================================================================
// HELPERS DE FECHA
// =============================================================================

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

// =============================================================================
// TIPOS
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

type ItemCost = { cost: number; iva_rate: number }

export type Calculo = {
  // Totales
  facturacion: number          // CON IVA (lo que cobró ML)
  ingresosNetos: number        // SIN IVA (precioNeto sumado por item)

  // Costos / cargos / impuestos
  costoMerca: number           // SIN IVA (cost de BD ya viene sin IVA)
  cargosML: number             // suma de cargos_total
  retenciones: number          // suma de imp_total
  bonificacionEnvio: number    // suma de bonificacion_envio
  publicidad: number
  gastosVarios: number

  // IVA
  ivaDebito: number            // 21% del precio (o iva_rate por item)
  ivaCredito: number           // iva_rate × costo
  ivaAPagar: number            // debito - credito

  // Resultados
  gananciaOperativa: number    // pre-IVA
  ganancia: number             // POST-IVA (real)
  margen: number               // ganancia / ingresosNetos × 100
  margenOperativo: number      // gananciaOperativa / ingresosNetos × 100

  // Métricas operativas
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
  coberturaCosto: number       // % unidades con costo cargado
  comisionPct: number          // cargos_total / facturacion × 100
  roas: number

  // Compatibilidad con código viejo
  comision: number             // = cargosML
  envios: number               // = 0 (deprecado, ya en cargos)
  flexBonif: number            // = bonificacionEnvio
  iibb: number                 // = retenciones (incluye créd/déb + IIBB)
}

function diaArgentinaFromISO(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

// =============================================================================
// CÁLCULO PRINCIPAL
// =============================================================================

function calcularRentabilidad(
  orders: OrderRow[],
  orderItems: OrderItemRow[],
  costsMap: Map<string, ItemCost>,
  publicidadAmount: number,
  gastosVariosAmount: number,
  desde: Date,
  hasta: Date
): Calculo {
  const paid = orders.filter(o => o.status === 'paid')
  const paidIds = new Set(paid.map(o => String(o.order_id)))

  // ---- Totales por orden ----
  const facturacion = paid.reduce((s, o) => s + Number(o.total_amount ?? 0), 0)
  const cargosML = paid.reduce((s, o) => s + Number(o.cargos_total ?? o.marketplace_fee ?? 0), 0)
  const retenciones = paid.reduce((s, o) => s + Number(o.imp_total ?? 0), 0)
  const bonificacionEnvio = paid.reduce((s, o) => s + Number(o.bonificacion_envio ?? o.discounts ?? 0), 0)

  // ---- Cálculo IVA por item ----
  let ingresosNetos = 0    // precio sin IVA
  let ivaDebito = 0
  let costoMerca = 0       // costo SIN IVA (ya está sin IVA en BD)
  let ivaCredito = 0

  let unidades = 0
  let unidadesConCosto = 0
  let unidadesSinCosto = 0

  for (const oi of orderItems) {
    if (!paidIds.has(String(oi.order_id))) continue
    const qty = oi.quantity ?? 0
    const unitPrice = Number(oi.unit_price ?? 0)
    unidades += qty

    const ci = costsMap.get(oi.item_id)
    const ivaRate = ci?.iva_rate ?? 21
    const ivaFactor = 1 + ivaRate / 100

    // INGRESOS y IVA DÉBITO (siempre se calculan)
    const subtotalConIva = unitPrice * qty
    const subtotalSinIva = subtotalConIva / ivaFactor
    ingresosNetos += subtotalSinIva
    ivaDebito += (subtotalConIva - subtotalSinIva)

    // COSTO y IVA CRÉDITO (solo si hay cost cargado)
    if (ci && ci.cost > 0) {
      unidadesConCosto += qty
      const costoTotalSinIva = ci.cost * qty
      costoMerca += costoTotalSinIva
      ivaCredito += costoTotalSinIva * (ivaRate / 100)
    } else {
      unidadesSinCosto += qty
    }
  }

  const ivaAPagar = ivaDebito - ivaCredito

  // ---- Ganancia ----
  const gananciaOperativa =
    ingresosNetos
    - costoMerca
    - cargosML
    - retenciones
    + bonificacionEnvio
    - publicidadAmount
    - gastosVariosAmount

  const ganancia = gananciaOperativa - ivaAPagar

  const margenOperativo = ingresosNetos > 0 ? (gananciaOperativa / ingresosNetos) * 100 : 0
  const margen = ingresosNetos > 0 ? (ganancia / ingresosNetos) * 100 : 0

  // ---- Métricas operativas ----
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
    // Compat
    comision: cargosML,
    envios: 0,
    flexBonif: bonificacionEnvio,
    iibb: retenciones,
  }
}

// =============================================================================
// FETCHERS
// =============================================================================

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
// PÁGINA
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

  const [actual, previo, publicidadActual, publicidadPrev, gastosActual, gastosPrev] = await Promise.all([
    fetchPeriodData(supabase, desdeActual.toISOString(), hastaActual.toISOString()),
    fetchPeriodData(supabase, desdePrev.toISOString(), hastaPrev.toISOString()),
    fetchAdsTotal(supabase, desdeActual, hastaActual),
    fetchAdsTotal(supabase, desdePrev, hastaPrev),
    fetchQuickExpensesTotal(supabase, desdeActual, hastaActual),
    fetchQuickExpensesTotal(supabase, desdePrev, hastaPrev),
  ])

  const calcActual = calcularRentabilidad(
    actual.orders, actual.orderItems, actual.costsMap, publicidadActual, gastosActual,
    desdeActual, hastaActual
  )
  const calcPrev = calcularRentabilidad(
    previo.orders, previo.orderItems, previo.costsMap, publicidadPrev, gastosPrev,
    desdePrev, hastaPrev
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