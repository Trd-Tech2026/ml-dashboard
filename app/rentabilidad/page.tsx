import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

type Props = {
  searchParams: Promise<{ period?: string }>
}

type Cambio = { pct: number; trend: 'up' | 'down' | 'flat' } | null

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
  // Lunes como inicio de semana
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)
  const [year, month, day] = fechaAR.split('-').map(Number)
  const dateAR = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00-03:00`)
  const dayOfWeek = dateAR.getUTCDay() // 0 = domingo, 1 = lunes, ...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  dateAR.setUTCDate(dateAR.getUTCDate() - daysToMonday)
  dateAR.setUTCDate(dateAR.getUTCDate() + offsetSemanas * 7)
  // Setear a medianoche AR
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

function calcCambio(actual: number, previo: number): Cambio {
  if (previo === 0) {
    if (actual === 0) return { pct: 0, trend: 'flat' }
    return null
  }
  const pct = ((actual - previo) / previo) * 100
  if (Math.abs(pct) < 0.5) return { pct: 0, trend: 'flat' }
  return { pct, trend: pct > 0 ? 'up' : 'down' }
}

// =============================================================================
// CÁLCULOS DE GANANCIA
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

type Calculo = {
  facturacion: number
  comision: number
  envios: number
  flexBonif: number
  iibb: number
  costoMerca: number
  publicidad: number
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
}

function diaArgentinaFromISO(iso: string): string {
  // Devuelve 'YYYY-MM-DD' en zona AR
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
  desde: Date,
  hasta: Date
): Calculo {
  const paid = orders.filter(o => o.status === 'paid')

  const facturacion = paid.reduce((s, o) => s + Number(o.total_amount ?? 0), 0)
  const comision = paid.reduce((s, o) => s + Number(o.marketplace_fee ?? 0), 0)
  const envios = paid.reduce((s, o) => s + Number(o.shipping_cost ?? 0), 0)
  const flexBonif = paid.reduce((s, o) => s + Number(o.discounts ?? 0), 0)
  const iibb = facturacion * (iibbPct / 100)

  // Costo merca: solo de las orders pagadas
  const paidIds = new Set(paid.map(o => String(o.order_id)))
  let costoMerca = 0
  for (const oi of orderItems) {
    if (!paidIds.has(String(oi.order_id))) continue
    const ci = costsMap.get(oi.item_id)
    if (!ci || !ci.cost) continue
    const ivaRate = ci.iva_rate ?? 21
    const costoConIva = ci.cost * (1 + ivaRate / 100)
    costoMerca += costoConIva * (oi.quantity ?? 0)
  }

  const ganancia = facturacion - comision - envios + flexBonif - iibb - costoMerca - publicidadAmount
  const margen = facturacion > 0 ? (ganancia / facturacion) * 100 : 0

  const ventas = paid.length
  // Unidades vendidas
  let unidades = 0
  for (const oi of orderItems) {
    if (paidIds.has(String(oi.order_id))) unidades += (oi.quantity ?? 0)
  }
  const ticketPromedio = ventas > 0 ? facturacion / ventas : 0

  // Envíos count
  const envioCount = paid.filter(o => Number(o.shipping_cost ?? 0) > 0).length
  const flexCount = paid.filter(o => o.shipping_logistic_type === 'self_service').length

  // Días activos
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
    if (monto > mejorDiaMonto) {
      mejorDiaMonto = monto
      mejorDiaFecha = dia
    }
  }

  return {
    facturacion, comision, envios, flexBonif, iibb, costoMerca, publicidad: publicidadAmount,
    ganancia, margen,
    ventas, unidades, ticketPromedio,
    envioCount, flexCount,
    diasActivos, diasTotales,
    mejorDiaMonto, mejorDiaFecha,
  }
}

async function fetchPeriodData(supabase: any, desdeISO: string, hastaISO: string) {
  // Orders
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
  // batch in chunks de 500
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500)
    const { data } = await supabase
      .from('order_items')
      .select('order_id, item_id, quantity, unit_price')
      .in('order_id', chunk)
    if (data) orderItems.push(...(data as OrderItemRow[]))
  }

  // Items con cost
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

// =============================================================================
// COMPONENTE
// =============================================================================

export default async function RentabilidadPage({ searchParams }: Props) {
  const params = await searchParams
  const period = params.period ?? 'hoy'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // === Cálculo de rangos ===
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
    // hoy (default)
    desdeActual = inicioDiaArgentina(0)
    hastaActual = ahora
    const lapsoMs = hastaActual.getTime() - desdeActual.getTime()
    desdePrev = inicioDiaArgentina(-1)
    hastaPrev = new Date(desdePrev.getTime() + lapsoMs)
    labelPeriodo = 'hoy'
    labelComparacion = 'vs ayer'
  }

  // === IIBB activo ===
  const { data: taxRow } = await supabase
    .from('tax_config')
    .select('percentage')
    .eq('type', 'iibb')
    .eq('active', true)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const iibbPct = taxRow?.percentage != null ? Number(taxRow.percentage) : 5.0

  // === Publicidad: por ahora 0 (se llena en Entrega 2) ===
  const publicidadActual = 0
  const publicidadPrev = 0

  // === Datos en paralelo ===
  const [actual, previo] = await Promise.all([
    fetchPeriodData(supabase, desdeActual.toISOString(), hastaActual.toISOString()),
    fetchPeriodData(supabase, desdePrev.toISOString(), hastaPrev.toISOString()),
  ])

  const calcActual = calcularRentabilidad(
    actual.orders, actual.orderItems, actual.costsMap, iibbPct, publicidadActual,
    desdeActual, hastaActual
  )
  const calcPrev = calcularRentabilidad(
    previo.orders, previo.orderItems, previo.costsMap, iibbPct, publicidadPrev,
    desdePrev, hastaPrev
  )

  const formatARS = (n: number) => {
    const abs = Math.abs(n)
    if (abs >= 1_000_000) {
      return `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 2 })}M`
    }
    if (abs >= 10_000) {
      return `$${Math.round(n / 1000).toLocaleString('es-AR')}k`
    }
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
  }

  const formatARSFull = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const formatARSSigned = (n: number) => {
    const formatted = formatARS(Math.abs(n))
    return n < 0 ? `−${formatted}` : formatted
  }

  // Margen label
  const margenLabel = (() => {
    if (calcActual.facturacion === 0) return ''
    if (calcActual.margen >= 30) return 'IMPARABLE'
    if (calcActual.margen >= 20) return 'EXCELENTE'
    if (calcActual.margen >= 10) return 'BUENO'
    if (calcActual.margen >= 0) return 'AJUSTADO'
    return 'NEGATIVO'
  })()

  const cambioGanancia = calcCambio(calcActual.ganancia, calcPrev.ganancia)
  const cambioVentas = calcCambio(calcActual.ventas, calcPrev.ventas)
  const cambioFacturacion = calcCambio(calcActual.facturacion, calcPrev.facturacion)
  const cambioMargen = calcCambio(calcActual.margen, calcPrev.margen)

  const renderCambio = (cambio: Cambio, label: string, invertColor?: boolean) => {
    if (!cambio) return <span className="cambio cambio-flat">— sin datos previos</span>
    const isGood = cambio.trend === 'flat' ? null : (cambio.trend === 'up') !== !!invertColor
    const cls = cambio.trend === 'flat' ? 'cambio-flat' : (isGood ? 'cambio-good' : 'cambio-bad')
    const arrow = cambio.trend === 'up' ? '↑' : cambio.trend === 'down' ? '↓' : '='
    return <span className={`cambio ${cls}`}>{arrow} {Math.abs(cambio.pct).toFixed(0)}% {label}</span>
  }

  const periodos = [
    { value: 'hoy', label: 'Hoy', icon: '📅' },
    { value: 'semana', label: 'Esta semana', icon: '🗓️' },
    { value: 'mes', label: 'Este mes', icon: '📆' },
  ]

  // Mejor día formateado
  const mejorDiaFormatted = calcActual.mejorDiaFecha
    ? new Date(calcActual.mejorDiaFecha + 'T12:00:00-03:00').toLocaleDateString('es-AR', {
        day: 'numeric', month: 'short', timeZone: TZ
      })
    : '—'

  // % comisión efectiva
  const comisionPct = calcActual.facturacion > 0
    ? (calcActual.comision / calcActual.facturacion) * 100
    : 0

  // Cobertura de costos (qué % de items tenían cost cargado)
  const totalItemsVendidos = actual.orderItems
    .filter(oi => actual.orders.find(o => String(o.order_id) === String(oi.order_id))?.status === 'paid')
    .length
  const itemsConCosto = actual.orderItems
    .filter(oi => {
      const orderPaid = actual.orders.find(o => String(o.order_id) === String(oi.order_id))?.status === 'paid'
      return orderPaid && actual.costsMap.has(oi.item_id)
    })
    .length
  const coberturaCosto = totalItemsVendidos > 0 ? (itemsConCosto / totalItemsVendidos) * 100 : 0

  return (
    <div className="page">
      <div className="header">
        <div className="header-title">
          <h1>💰 Rentabilidad</h1>
          <p className="subtitle">Métricas combinadas · datos en tiempo real</p>
        </div>
        <div className="header-actions">
          <button className="btn-action btn-coming" disabled title="Próximamente (Entrega 2)">
            <span>📊</span> Cargar gasto Ads
          </button>
          <button className="btn-action btn-coming" disabled title="Próximamente (Entrega 3)">
            <span>💸</span> Gasto rápido
          </button>
          <button className="btn-action btn-coming" disabled title="Próximamente (Entrega 4)">
            <span>⚙️</span> Config
          </button>
        </div>
      </div>

      <div className="period-tabs">
        {periodos.map(p => {
          const activo = period === p.value
          return (
            <Link
              key={p.value}
              href={`/rentabilidad?period=${p.value}`}
              className={`period-tab ${activo ? 'period-active' : ''}`}
            >
              <span>{p.icon}</span>
              <span>{p.label}</span>
            </Link>
          )
        })}
      </div>

      {/* HERO CARD GANANCIA */}
      <div className={`hero ${calcActual.ganancia >= 0 ? 'hero-positive' : 'hero-negative'}`}>
        <div className="hero-bg">
          <div className="hero-orb orb-1" />
          <div className="hero-orb orb-2" />
          <div className="hero-orb orb-3" />
        </div>
        <div className="hero-content">
          <div className="hero-left">
            <div className="hero-emoji">{calcActual.ganancia >= 0 ? '🚀' : '⚠️'}</div>
            <div>
              <div className="hero-label">GANANCIA · {labelPeriodo.toUpperCase()}{period === 'hoy' && <span className="badge-live">EN VIVO</span>}</div>
              <div className="hero-amount">{formatARSSigned(calcActual.ganancia)}</div>
              <div className="hero-subamount">{formatARSFull(calcActual.ganancia)}</div>
              <div className="hero-cambio">
                {renderCambio(cambioGanancia, labelComparacion)}
              </div>
            </div>
          </div>
          <div className="hero-right">
            <div className="hero-margen-label">MARGEN</div>
            <div className="hero-margen-value">{calcActual.facturacion > 0 ? `${calcActual.margen.toFixed(1)}%` : '—'}</div>
            <div className="hero-margen-tag">{margenLabel}</div>
            <div className="hero-cambio">
              {renderCambio(cambioMargen, labelComparacion)}
            </div>
          </div>
        </div>

        {/* STATS GRID DEBAJO DEL HERO */}
        <div className="stats-grid">
          <div className="stat-cell">
            <div className="stat-label">FACTURACIÓN</div>
            <div className="stat-value stat-positive">{formatARS(calcActual.facturacion)}</div>
            <div className="stat-detail">{calcActual.ventas} {calcActual.ventas === 1 ? 'venta' : 'ventas'}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">− COMISIÓN ML</div>
            <div className="stat-value stat-negative">−{formatARS(calcActual.comision)}</div>
            <div className="stat-detail">{comisionPct.toFixed(1)}% efectivo</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">− ENVÍOS ME</div>
            <div className="stat-value stat-negative">−{formatARS(calcActual.envios)}</div>
            <div className="stat-detail">{calcActual.envioCount} {calcActual.envioCount === 1 ? 'envío' : 'envíos'}</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">+ FLEX (BONIF.)</div>
            <div className="stat-value stat-positive">+{formatARS(calcActual.flexBonif)}</div>
            <div className="stat-detail">{calcActual.flexCount} ventas Flex</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">− PUBLICIDAD</div>
            <div className="stat-value stat-negative stat-disabled">−{formatARS(calcActual.publicidad)}</div>
            <div className="stat-detail stat-detail-warn">🚧 carga en Entrega 2</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">− IIBB ({iibbPct.toFixed(1)}%)</div>
            <div className="stat-value stat-negative">−{formatARS(calcActual.iibb)}</div>
            <div className="stat-detail">conv. multilateral</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">− COSTO MERCA</div>
            <div className="stat-value stat-negative">−{formatARS(calcActual.costoMerca)}</div>
            <div className="stat-detail">cobertura {coberturaCosto.toFixed(0)}%</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">ROAS</div>
            <div className="stat-value stat-disabled">—</div>
            <div className="stat-detail stat-detail-warn">🚧 espera Ads</div>
          </div>
        </div>
      </div>

      {/* MINI CARDS */}
      <div className="mini-cards">
        <div className="mini-card">
          <div className="mini-label">🛒 VENTAS</div>
          <div className="mini-value">{calcActual.ventas}</div>
          <div className="mini-detail">{renderCambio(cambioVentas, labelComparacion)}</div>
        </div>
        <div className="mini-card">
          <div className="mini-label">📦 UNIDADES</div>
          <div className="mini-value">{calcActual.unidades}</div>
          <div className="mini-detail">
            {calcActual.ventas > 0 ? `${(calcActual.unidades / calcActual.ventas).toFixed(1)} u/venta` : '—'}
          </div>
        </div>
        <div className="mini-card">
          <div className="mini-label">🎫 TICKET PROM.</div>
          <div className="mini-value">{formatARS(calcActual.ticketPromedio)}</div>
          <div className="mini-detail">por venta</div>
        </div>
        <div className="mini-card">
          <div className="mini-label">📅 DÍAS ACTIVOS</div>
          <div className="mini-value">{calcActual.diasActivos} <span className="mini-fraction">/ {calcActual.diasTotales}</span></div>
          <div className="mini-detail">
            {calcActual.diasTotales > 0 ? `${((calcActual.diasActivos / calcActual.diasTotales) * 100).toFixed(0)}% del período` : '—'}
          </div>
        </div>
        <div className="mini-card">
          <div className="mini-label">🏆 MEJOR DÍA</div>
          <div className="mini-value">{calcActual.mejorDiaMonto > 0 ? formatARS(calcActual.mejorDiaMonto) : '—'}</div>
          <div className="mini-detail">{mejorDiaFormatted}</div>
        </div>
      </div>

      <style>{`
        .page {
          padding: 24px 40px 48px;
          max-width: 1500px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          gap: 16px;
          flex-wrap: wrap;
        }
        .header-title h1 {
          margin: 0 0 4px;
          font-size: 26px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .subtitle {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
        }
        .header-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .btn-action {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 14px;
          background: var(--bg-card);
          color: var(--text-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s ease;
        }
        .btn-action:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent);
        }
        .btn-coming {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .period-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
          flex-wrap: wrap;
        }
        .period-tab {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          background: var(--bg-card);
          color: var(--text-secondary);
          border: 1px solid var(--border-subtle);
          text-decoration: none;
          transition: all 0.15s ease;
        }
        .period-tab:hover {
          border-color: var(--border-medium);
          color: var(--text-primary);
        }
        .period-tab.period-active {
          background: linear-gradient(135deg, #f59e0b, #fbbf24);
          color: #1a1a1a;
          border-color: #fbbf24;
          box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25);
        }

        /* === HERO CARD === */
        .hero {
          position: relative;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 18px;
          padding: 36px 40px 28px;
          margin-bottom: 24px;
          overflow: hidden;
        }
        .hero-positive {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.06) 0%, rgba(236, 72, 153, 0.04) 100%);
          border-color: rgba(168, 85, 247, 0.35);
          box-shadow: 0 0 60px rgba(168, 85, 247, 0.08);
        }
        .hero-negative {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.06) 0%, rgba(248, 113, 113, 0.04) 100%);
          border-color: rgba(239, 68, 68, 0.35);
          box-shadow: 0 0 60px rgba(239, 68, 68, 0.08);
        }
        .hero-bg { position: absolute; inset: 0; pointer-events: none; }
        .hero-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(40px);
          opacity: 0.5;
        }
        .hero-positive .orb-1 { background: rgba(168, 85, 247, 0.4); width: 200px; height: 200px; top: -50px; left: 30%; }
        .hero-positive .orb-2 { background: rgba(236, 72, 153, 0.3); width: 150px; height: 150px; bottom: -30px; right: 20%; }
        .hero-positive .orb-3 { background: rgba(99, 102, 241, 0.3); width: 120px; height: 120px; top: 40%; right: 10%; }
        .hero-negative .orb-1 { background: rgba(239, 68, 68, 0.4); width: 200px; height: 200px; top: -50px; left: 30%; }
        .hero-negative .orb-2 { background: rgba(248, 113, 113, 0.3); width: 150px; height: 150px; bottom: -30px; right: 20%; }
        .hero-negative .orb-3 { background: rgba(220, 38, 38, 0.3); width: 120px; height: 120px; top: 40%; right: 10%; }

        .hero-content {
          position: relative;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 28px;
          padding-bottom: 24px;
          border-bottom: 1px solid var(--border-subtle);
          flex-wrap: wrap;
        }
        .hero-left { display: flex; gap: 18px; align-items: flex-start; flex: 1; min-width: 280px; }
        .hero-emoji { font-size: 56px; line-height: 1; flex-shrink: 0; filter: drop-shadow(0 0 20px rgba(168, 85, 247, 0.4)); }
        .hero-label {
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 1.5px;
          margin-bottom: 6px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .badge-live {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.35);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .badge-live::before {
          content: '';
          width: 6px;
          height: 6px;
          background: #f87171;
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse { 50% { opacity: 0.4; } }
        .hero-amount {
          font-size: 56px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1;
          font-variant-numeric: tabular-nums;
          background: linear-gradient(135deg, #00d9ff 0%, #0044ff 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 6px;
        }
        .hero-negative .hero-amount {
          background: linear-gradient(135deg, #f87171 0%, #fb923c 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .hero-subamount { color: var(--text-muted); font-size: 13px; }
        .hero-cambio { margin-top: 8px; font-size: 12px; }
        .hero-right { text-align: right; }
        .hero-margen-label { font-size: 11px; color: var(--text-muted); letter-spacing: 1.5px; font-weight: 700; }
        .hero-margen-value { font-size: 44px; font-weight: 800; color: var(--text-primary); line-height: 1; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
        .hero-margen-tag { font-size: 11px; color: var(--accent); letter-spacing: 1px; font-weight: 700; }

        .cambio { font-size: 12px; font-weight: 600; }
        .cambio-good { color: var(--success); }
        .cambio-bad { color: var(--danger); }
        .cambio-flat { color: var(--text-muted); }

        /* === STATS GRID === */
        .stats-grid {
          position: relative;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px 24px;
        }
        .stat-cell { display: flex; flex-direction: column; }
        .stat-label {
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 1px;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .stat-value {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .stat-positive { }
        .stat-negative { color: var(--text-secondary); }
        .stat-disabled { opacity: 0.4; }
        .stat-detail { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .stat-detail-warn { color: var(--warning); font-style: italic; }

        /* === MINI CARDS === */
        .mini-cards {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 12px;
        }
        .mini-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 16px 18px;
        }
        .mini-label {
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .mini-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .mini-fraction { font-size: 14px; color: var(--text-muted); font-weight: 500; }
        .mini-detail { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

        @media (max-width: 1100px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .mini-cards { grid-template-columns: repeat(3, 1fr); }
        }

        @media (max-width: 768px) {
          .page { padding: 16px; }
          .header { flex-direction: column; align-items: stretch; }
          .header-title h1 { font-size: 22px; }
          .header-actions { flex-direction: column; }
          .btn-action { justify-content: center; }
          .period-tabs { display: grid; grid-template-columns: repeat(3, 1fr); }
          .period-tab { justify-content: center; padding: 9px 6px; font-size: 12px; }

          .hero { padding: 24px 20px 20px; }
          .hero-content { flex-direction: column; padding-bottom: 20px; }
          .hero-left { gap: 12px; min-width: 0; }
          .hero-emoji { font-size: 40px; }
          .hero-amount { font-size: 38px; }
          .hero-right { text-align: left; width: 100%; }
          .hero-margen-value { font-size: 32px; }

          .stats-grid { grid-template-columns: 1fr 1fr; gap: 14px 16px; }
          .stat-value { font-size: 18px; }

          .mini-cards { grid-template-columns: repeat(2, 1fr); }
          .mini-value { font-size: 20px; }
        }
      `}</style>
    </div>
  )
}
