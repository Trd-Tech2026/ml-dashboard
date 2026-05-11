import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import VentasTabla, { OrderWithItems } from '../../components/VentasTabla'
import CollapsibleSection from '../../components/CollapsibleSection'
import {
  buildIndividualesByLastSegment,
  calcularCostoItem,
  type ItemCostInfo,
  type ManualComponent,
} from '../../lib/combos'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

type OrderEnriched = OrderWithItems & { shipping_logistic_type: string | null }
type Cambio = { pct: number; trend: 'up' | 'down' | 'flat' } | null

type Props = {
  searchParams: Promise<{ rango?: string }>
}

function inicioMesArgentinaISO(offsetMeses: number = 0): string {
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
  return new Date(`${year}-${mm}-01T00:00:00-03:00`).toISOString()
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

async function fetchKpisRango(supabase: any, desdeISO: string, hastaISO?: string) {
  const todasOrdenes: { status: string; total_amount: number; shipping_logistic_type: string | null }[] = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    let q = supabase
      .from('orders')
      .select('status, total_amount, shipping_logistic_type')
      .gte('date_created', desdeISO)
    if (hastaISO) q = q.lt('date_created', hastaISO)
    q = q.range(from, from + PAGE_SIZE - 1)

    const { data, error } = await q
    if (error || !data || data.length === 0) break
    todasOrdenes.push(...(data as any[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return todasOrdenes
}

function calcularFiscalOrden(
  o: any,
  items: any[],
  itemIdToSeller: Map<string, string | null>,
  itemsBySku: Map<string, any>,
  costsBySku: Map<string, ItemCostInfo>,
  individualesByLast: Map<string, ItemCostInfo[]>,
  manualComps: Map<string, ManualComponent[]>
) {
  let ingresosNetos = 0, costoMerca = 0, ivaDebito = 0, ivaCredito = 0
  let unidadesConCosto = 0, unidadesSinCosto = 0
  const fuentesCostos = new Set<string>()

  for (const item of items) {
    const qty = Number(item.quantity ?? 0)
    const unitPrice = Number(item.unit_price ?? 0)
    const sellerSku = itemIdToSeller.get(item.item_id) ?? null
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

    const costRes = calcularCostoItem(sellerSku, qty, itemCostInfo, costsBySku, individualesByLast, manualComps)
    fuentesCostos.add(costRes.source)

    if (costRes.source === 'no-data') {
      unidadesSinCosto += qty
    } else {
      unidadesConCosto += qty
      costoMerca += costRes.costoSinIva
      ivaCredito += costRes.ivaCredito
    }
  }

  const cargosML = Number(o.cargos_total ?? o.marketplace_fee ?? 0)
  const cargosComision = Number(o.cargos_comision ?? 0)
  const cargosCostoFijo = Number(o.cargos_costo_fijo ?? 0)
  const cargosFinanciacion = Number(o.cargos_financiacion ?? 0)
  const retenciones = Number(o.imp_total ?? 0)
  const impCreditosDebitos = Number(o.imp_creditos_debitos ?? 0)
  const impCreditosDebitosEnvio = Number(o.imp_creditos_debitos_envio ?? 0)
  const impIIBB = Number(o.imp_iibb_total ?? 0)
  const bonificacionEnvio = Number(o.bonificacion_envio ?? o.discounts ?? 0)

  // 🔥 NUEVOS CAMPOS
  const envioCobradoCliente = Number(o.envio_cobrado_cliente ?? 0)
  const costoFlexEstimado = Number(o.costo_flex_estimado ?? 0)
  const totalBruto = Number(o.total_amount ?? 0)

  // 🔥 Recibido ML: lo que ML te transfiere literalmente
  const recibidoML = totalBruto + envioCobradoCliente - cargosML - retenciones + bonificacionEnvio

  // 🔥 Recibido neto: lo que queda después del costo Flex
  const recibidoNeto = recibidoML - costoFlexEstimado

  const ivaAPagar = ivaDebito - ivaCredito
  const gananciaOperativa = ingresosNetos - costoMerca - cargosML - retenciones + bonificacionEnvio - costoFlexEstimado
  const ganancia = gananciaOperativa - ivaAPagar
  const margen = totalBruto > 0 && unidadesSinCosto === 0 && unidadesConCosto > 0
    ? (ganancia / totalBruto) * 100 : null

  return {
    ingresosNetos, costoMerca,
    ivaDebito, ivaCredito, ivaAPagar,
    cargosML, cargosComision, cargosCostoFijo, cargosFinanciacion,
    retenciones, impCreditosDebitos, impCreditosDebitosEnvio, impIIBB,
    bonificacionEnvio,
    envioCobradoCliente,
    costoFlexEstimado,
    recibidoML,
    recibidoNeto,
    gananciaOperativa, ganancia, margen,
    unidadesConCosto, unidadesSinCosto,
    costoCompleto: unidadesSinCosto === 0 && unidadesConCosto > 0,
    fuentesCostos: Array.from(fuentesCostos),
  }
}

export default async function Historicas({ searchParams }: Props) {
  const params = await searchParams
  const rango = params.rango ?? '90'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let desdeISO: string
  let hastaISOActual: string | undefined = undefined
  let desdePreviaISO: string
  let hastaPreviaISO: string
  let labelComparacion: string

  if (rango === 'mes') {
    desdeISO = inicioMesArgentinaISO(0)
    hastaISOActual = undefined
    const inicioMesActualMs = new Date(desdeISO).getTime()
    const ahoraMs = Date.now()
    const duracionMs = ahoraMs - inicioMesActualMs
    desdePreviaISO = inicioMesArgentinaISO(-1)
    hastaPreviaISO = new Date(new Date(desdePreviaISO).getTime() + duracionMs).toISOString()
    labelComparacion = 'vs mes anterior'
  } else {
    const dias = parseInt(rango, 10) || 90
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    desdeISO = desde.toISOString()
    hastaISOActual = undefined
    const desdePrev = new Date()
    desdePrev.setDate(desdePrev.getDate() - dias * 2)
    const hastaPrev = new Date()
    hastaPrev.setDate(hastaPrev.getDate() - dias)
    desdePreviaISO = desdePrev.toISOString()
    hastaPreviaISO = hastaPrev.toISOString()
    labelComparacion = `vs ${dias} días previos`
  }

  const [todasOrdenes, prevOrdenes, allItemsRes, manualItemsRes, manualCompsRes] = await Promise.all([
    fetchKpisRango(supabase, desdeISO, hastaISOActual),
    fetchKpisRango(supabase, desdePreviaISO, hastaPreviaISO),
    supabase.from('items').select('item_id, seller_sku, cost, iva_rate'),
    supabase.from('manual_items').select('seller_sku, cost, iva_rate'),
    supabase.from('product_components').select('parent_sku, component_sku, quantity'),
  ])

  const allItemsML = (allItemsRes.data ?? []) as any[]
  const itemsManuales = ((manualItemsRes.data ?? []) as any[]).map((m: any) => ({
    item_id: `MANUAL-${m.seller_sku}`,
    seller_sku: m.seller_sku,
    cost: m.cost,
    iva_rate: m.iva_rate,
  }))
  const allItems = [...allItemsML, ...itemsManuales]

  const itemsBySku = new Map<string, any>()
  const itemIdToSeller = new Map<string, string | null>()
  const allItemCosts: ItemCostInfo[] = []

  for (const it of allItems) {
    itemIdToSeller.set(it.item_id, it.seller_sku)
    if (it.seller_sku) {
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
      costsBySku.set(ic.seller_sku, ic)
    }
  }
  const individualesByLast = buildIndividualesByLastSegment(allItemCosts)

  const manualComps = new Map<string, ManualComponent[]>()
  for (const c of (manualCompsRes.data ?? []) as any[]) {
    if (!manualComps.has(c.parent_sku)) manualComps.set(c.parent_sku, [])
    manualComps.get(c.parent_sku)!.push({
      component_sku: c.component_sku,
      quantity: Number(c.quantity ?? 1),
    })
  }

  const ventasPagadas = todasOrdenes.filter(o => o.status === 'paid')
  const cancelaciones = todasOrdenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  const todasFull = todasOrdenes.filter(o => o.shipping_logistic_type === 'fulfillment')
  const ventasFullPagadas = todasFull.filter(o => o.status === 'paid')
  const facturacionFull = ventasFullPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketFull = ventasFullPagadas.length > 0 ? facturacionFull / ventasFullPagadas.length : 0
  const porcentajeFull = ventasPagadas.length > 0
    ? (ventasFullPagadas.length / ventasPagadas.length) * 100 : 0

  const prevPagadas = prevOrdenes.filter(o => o.status === 'paid')
  const prevCancelaciones = prevOrdenes.filter(o => o.status === 'cancelled')
  const prevFacturacion = prevPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const prevTicket = prevPagadas.length > 0 ? prevFacturacion / prevPagadas.length : 0

  let recientesQuery: any = supabase
    .from('orders')
    .select(`
      order_id, status, total_amount, currency, buyer_nickname, date_created,
      marketplace_fee, shipping_cost, discounts, net_received, shipping_logistic_type,
      cargos_total, cargos_comision, cargos_costo_fijo, cargos_financiacion,
      imp_total, imp_iibb_total, imp_creditos_debitos, imp_creditos_debitos_envio,
      bonificacion_envio, envio_cobrado_cliente, costo_flex_estimado, fiscal_v2,
      order_items ( item_id, title, quantity, unit_price )
    `)
    .gte('date_created', desdeISO)
  if (hastaISOActual) recientesQuery = recientesQuery.lt('date_created', hastaISOActual)
  const { data: recientesRaw } = await recientesQuery
    .order('date_created', { ascending: false })
    .limit(100)

  const ordenes: OrderEnriched[] = (recientesRaw ?? []).map((o: any) => {
    const items = Array.isArray(o.order_items) ? o.order_items : []
    const fiscal = calcularFiscalOrden(
      o, items, itemIdToSeller, itemsBySku, costsBySku, individualesByLast, manualComps
    )
    return {
      order_id: o.order_id,
      status: o.status,
      total_amount: Number(o.total_amount ?? 0),
      currency: o.currency,
      buyer_nickname: o.buyer_nickname,
      date_created: o.date_created,
      marketplace_fee: Number(o.marketplace_fee ?? 0),
      shipping_cost: Number(o.shipping_cost ?? 0),
      discounts: Number(o.discounts ?? 0),
      net_received: Number(o.net_received ?? 0),
      shipping_logistic_type: o.shipping_logistic_type ?? null,
      items, fiscal,
    }
  })

  let recientesFullQuery: any = supabase
    .from('orders')
    .select(`
      order_id, status, total_amount, currency, buyer_nickname, date_created,
      marketplace_fee, shipping_cost, discounts, net_received, shipping_logistic_type,
      cargos_total, cargos_comision, cargos_costo_fijo, cargos_financiacion,
      imp_total, imp_iibb_total, imp_creditos_debitos, imp_creditos_debitos_envio,
      bonificacion_envio, envio_cobrado_cliente, costo_flex_estimado, fiscal_v2,
      order_items ( item_id, title, quantity, unit_price )
    `)
    .gte('date_created', desdeISO)
    .eq('shipping_logistic_type', 'fulfillment')
  if (hastaISOActual) recientesFullQuery = recientesFullQuery.lt('date_created', hastaISOActual)
  const { data: recientesFullRaw } = await recientesFullQuery
    .order('date_created', { ascending: false })
    .limit(100)

  const ordenesFullTabla: OrderEnriched[] = (recientesFullRaw ?? []).map((o: any) => {
    const items = Array.isArray(o.order_items) ? o.order_items : []
    const fiscal = calcularFiscalOrden(
      o, items, itemIdToSeller, itemsBySku, costsBySku, individualesByLast, manualComps
    )
    return {
      order_id: o.order_id,
      status: o.status,
      total_amount: Number(o.total_amount ?? 0),
      currency: o.currency,
      buyer_nickname: o.buyer_nickname,
      date_created: o.date_created,
      marketplace_fee: Number(o.marketplace_fee ?? 0),
      shipping_cost: Number(o.shipping_cost ?? 0),
      discounts: Number(o.discounts ?? 0),
      net_received: Number(o.net_received ?? 0),
      shipping_logistic_type: o.shipping_logistic_type ?? null,
      items, fiscal,
    }
  })

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const ahoraAR = new Date()
  const mesActualNombre = ahoraAR.toLocaleDateString('es-AR', { month: 'long', timeZone: TZ })
  const mesCapitalizado = mesActualNombre.charAt(0).toUpperCase() + mesActualNombre.slice(1)

  const rangos = [
    { value: '7', label: 'Últimos 7 días', labelMobile: '7d' },
    { value: 'mes', label: `Mes en curso (${mesCapitalizado})`, labelMobile: 'Mes' },
    { value: '90', label: 'Últimos 90 días', labelMobile: '90d' },
  ]

  const cards = [
    { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), kpiClass: 'kpi-success',
      cambio: calcCambio(ventasPagadas.length, prevPagadas.length) },
    { titulo: 'Facturación', valor: formatARS(facturacion), kpiClass: 'kpi-info',
      cambio: calcCambio(facturacion, prevFacturacion) },
    { titulo: 'Ticket promedio', valor: formatARS(ticketPromedio), kpiClass: 'kpi-warning',
      cambio: calcCambio(ticketPromedio, prevTicket) },
    { titulo: 'Cancelaciones', valor: String(cancelaciones.length), kpiClass: 'kpi-danger',
      cambio: calcCambio(cancelaciones.length, prevCancelaciones.length), invertColor: true },
  ]

  const cardsFull = [
    { titulo: 'Ventas Full pagadas', valor: String(ventasFullPagadas.length), kpiClass: 'kpi-accent' },
    { titulo: 'Facturación Full', valor: formatARS(facturacionFull), kpiClass: 'kpi-info' },
    { titulo: 'Ticket promedio Full', valor: formatARS(ticketFull), kpiClass: 'kpi-warning' },
    { titulo: '% sobre ventas pagadas', valor: ventasPagadas.length === 0 ? '—' : `${porcentajeFull.toFixed(0)}%`, kpiClass: 'kpi-success' },
  ]

  const renderCambio = (cambio: Cambio, invertColor?: boolean) => {
    if (!cambio) return <p className="kpi-cambio cambio-flat">— sin datos previos</p>
    const isGood = cambio.trend === 'flat' ? null : (cambio.trend === 'up') !== !!invertColor
    const className = cambio.trend === 'flat' ? 'cambio-flat' : (isGood ? 'cambio-good' : 'cambio-bad')
    const arrow = cambio.trend === 'up' ? '↑' : cambio.trend === 'down' ? '↓' : '='
    return (
      <p className={`kpi-cambio ${className}`}>
        {arrow} {Math.abs(cambio.pct).toFixed(0)}% {labelComparacion}
      </p>
    )
  }

  return (
    <div className="page">
      <div className="header">
        <h1>Ventas históricas</h1>
        <p className="subtitulo">Análisis de ventas en períodos pasados</p>
      </div>

      <div className="filtros">
        {rangos.map((r) => {
          const activo = rango === r.value
          return (
            <Link
              key={r.value}
              href={`/ventas/historicas?rango=${r.value}`}
              className={`filtro ${activo ? 'activo' : ''}`}
            >
              <span className="label-desktop">{r.label}</span>
              <span className="label-mobile">{r.labelMobile}</span>
            </Link>
          )
        })}
      </div>

      <div className="kpis">
        {cards.map((card) => (
          <div key={card.titulo} className={`kpi-card ${card.kpiClass}`}>
            <p className="kpi-titulo">{card.titulo}</p>
            <p className="kpi-valor">{card.valor}</p>
            {renderCambio(card.cambio, card.invertColor)}
          </div>
        ))}
      </div>

      <div className="tabla-container">
        <CollapsibleSection
          title="Últimas 100 ventas del período"
          subtitle={`Total de órdenes en el período: ${todasOrdenes.length.toLocaleString('es-AR')}`}
          defaultOpen={false}
        >
          {ordenes.length === 0 ? (
            <p className="empty">No hay ventas en este período.</p>
          ) : (
            <VentasTabla ordenes={ordenes} mostrarHora={false} />
          )}
        </CollapsibleSection>
      </div>

      <div className="full-section">
        <div className="full-header">
          <h2>🏬 Ventas Full</h2>
          <p>Ventas correspondientes a productos almacenados en Mercado Envíos Full (al momento de la venta)</p>
        </div>

        <div className="kpis">
          {cardsFull.map((card) => (
            <div key={card.titulo} className={`kpi-card kpi-full ${card.kpiClass}`}>
              <p className="kpi-titulo">{card.titulo}</p>
              <p className="kpi-valor">{card.valor}</p>
            </div>
          ))}
        </div>

        <div className="tabla-container">
          <CollapsibleSection
            title="Últimas 100 ventas Full del período"
            subtitle={`Total Full en el período: ${todasFull.length.toLocaleString('es-AR')}`}
            defaultOpen={false}
          >
            {ordenesFullTabla.length === 0 ? (
              <p className="empty">No hay ventas Full en este período.</p>
            ) : (
              <VentasTabla ordenes={ordenesFullTabla} mostrarHora={false} />
            )}
          </CollapsibleSection>
        </div>
      </div>

      <style>{`
        .page { padding: 32px 40px 48px; max-width: 1400px; margin: 0 auto; }
        .header { margin-bottom: 24px; }
        h1 { color: var(--text-primary); margin: 0 0 4px; font-size: 26px; font-weight: 700; }
        .subtitulo { color: var(--text-muted); margin: 0; font-size: 13px; }
        .filtros { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
        .filtro { padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border-subtle); text-decoration: none; transition: all 0.15s ease; }
        .filtro:hover { border-color: var(--border-medium); color: var(--text-primary); }
        .filtro.activo { background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%); color: var(--bg-base); border-color: var(--accent); font-weight: 600; box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); }
        .label-mobile { display: none; }
        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
        .kpi-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 18px 20px; position: relative; overflow: hidden; }
        .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; opacity: 0.7; }
        .kpi-success::before { background: var(--success); }
        .kpi-info::before { background: var(--info); }
        .kpi-warning::before { background: var(--warning); }
        .kpi-danger::before { background: var(--danger); }
        .kpi-accent::before { background: var(--accent); }
        .kpi-titulo { color: var(--text-muted); font-size: 11px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .kpi-valor { font-size: 24px; font-weight: 700; margin: 0; color: var(--text-primary); font-variant-numeric: tabular-nums; }
        .kpi-cambio { font-size: 11px; margin: 8px 0 0; font-weight: 600; letter-spacing: 0.3px; }
        .cambio-good { color: var(--success); }
        .cambio-bad { color: var(--danger); }
        .cambio-flat { color: var(--text-muted); }
        .tabla-container { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 20px 24px; }
        .empty { color: var(--text-muted); font-size: 13px; }
        .full-section { margin-top: 36px; padding-top: 28px; border-top: 1px solid var(--border-subtle); }
        .full-header { margin-bottom: 20px; }
        .full-header h2 { margin: 0 0 4px; color: var(--text-primary); font-size: 22px; font-weight: 700; }
        .full-header p { margin: 0; color: var(--text-muted); font-size: 13px; }
        .kpi-full { background: linear-gradient(135deg, rgba(62, 229, 224, 0.04) 0%, rgba(28, 160, 196, 0.02) 100%); }
        @media (max-width: 768px) {
          .page { padding: 16px; }
          h1 { font-size: 22px; }
          .subtitulo { font-size: 12px; }
          .filtros { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px; }
          .filtro { text-align: center; padding: 9px 6px; font-size: 12px; }
          .label-desktop { display: none; }
          .label-mobile { display: inline; }
          .kpis { grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 18px; }
          .kpi-card { padding: 14px; }
          .kpi-titulo { font-size: 10px; margin-bottom: 6px; }
          .kpi-valor { font-size: 18px; }
          .kpi-cambio { font-size: 10px; }
          .tabla-container { padding: 14px; }
          .full-section { margin-top: 24px; padding-top: 20px; }
          .full-header h2 { font-size: 18px; }
        }
      `}</style>
    </div>
  )
}