import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import VentasTabla, { OrderWithItems } from '../../components/VentasTabla'
import CollapsibleSection from '../../components/CollapsibleSection'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

type OrderEnriched = OrderWithItems & { shipping_logistic_type: string | null }

type Props = {
  searchParams: Promise<{ rango?: string }>
}

// Devuelve el ISO del primer día del mes actual en zona Argentina
function inicioMesArgentinaISO(): string {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)
  const [year, month] = fechaAR.split('-')
  return new Date(`${year}-${month}-01T00:00:00-03:00`).toISOString()
}

export default async function Historicas({ searchParams }: Props) {
  const params = await searchParams
  const rango = params.rango ?? '90'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // === Cálculo del rango ===
  // 'mes' → desde el día 1 del mes actual (zona AR) hasta ahora
  // '7' / '90' → últimos N días corridos
  let desdeISO: string
  if (rango === 'mes') {
    desdeISO = inicioMesArgentinaISO()
  } else {
    const dias = parseInt(rango, 10) || 90
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    desdeISO = desde.toISOString()
  }

  const todasOrdenes: { status: string; total_amount: number; shipping_logistic_type: string | null }[] = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('status, total_amount, shipping_logistic_type')
      .gte('date_created', desdeISO)
      .range(from, from + PAGE_SIZE - 1)

    if (error || !data || data.length === 0) break
    todasOrdenes.push(...(data as { status: string; total_amount: number; shipping_logistic_type: string | null }[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
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
    ? (ventasFullPagadas.length / ventasPagadas.length) * 100
    : 0

  const { data: recientesRaw } = await supabase
    .from('orders')
    .select(`
      order_id, status, total_amount, currency, buyer_nickname, date_created,
      marketplace_fee, shipping_cost, discounts, net_received, shipping_logistic_type,
      order_items ( item_id, title, quantity, unit_price )
    `)
    .gte('date_created', desdeISO)
    .order('date_created', { ascending: false })
    .limit(100)

  const ordenes: OrderEnriched[] = (recientesRaw ?? []).map((o: any) => ({
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
    items: Array.isArray(o.order_items) ? o.order_items : [],
  }))

  const { data: recientesFullRaw } = await supabase
    .from('orders')
    .select(`
      order_id, status, total_amount, currency, buyer_nickname, date_created,
      marketplace_fee, shipping_cost, discounts, net_received, shipping_logistic_type,
      order_items ( item_id, title, quantity, unit_price )
    `)
    .gte('date_created', desdeISO)
    .eq('shipping_logistic_type', 'fulfillment')
    .order('date_created', { ascending: false })
    .limit(100)

  const ordenesFullTabla: OrderEnriched[] = (recientesFullRaw ?? []).map((o: any) => ({
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
    items: Array.isArray(o.order_items) ? o.order_items : [],
  }))

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  // Nombre del mes actual capitalizado para el botón / subtítulo
  const ahoraAR = new Date()
  const mesActualNombre = ahoraAR.toLocaleDateString('es-AR', {
    month: 'long',
    timeZone: TZ,
  })
  const mesCapitalizado = mesActualNombre.charAt(0).toUpperCase() + mesActualNombre.slice(1)

  const rangos = [
    { value: '7', label: 'Últimos 7 días', labelMobile: '7d' },
    { value: 'mes', label: `Mes en curso (${mesCapitalizado})`, labelMobile: 'Mes' },
    { value: '90', label: 'Últimos 90 días', labelMobile: '90d' },
  ]

  const cards = [
    { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), kpiClass: 'kpi-success' },
    { titulo: 'Facturación', valor: formatARS(facturacion), kpiClass: 'kpi-info' },
    { titulo: 'Ticket promedio', valor: formatARS(ticketPromedio), kpiClass: 'kpi-warning' },
    { titulo: 'Cancelaciones', valor: String(cancelaciones.length), kpiClass: 'kpi-danger' },
  ]

  const cardsFull = [
    { titulo: 'Ventas Full pagadas', valor: String(ventasFullPagadas.length), kpiClass: 'kpi-accent' },
    { titulo: 'Facturación Full', valor: formatARS(facturacionFull), kpiClass: 'kpi-info' },
    { titulo: 'Ticket promedio Full', valor: formatARS(ticketFull), kpiClass: 'kpi-warning' },
    { titulo: '% sobre ventas pagadas', valor: ventasPagadas.length === 0 ? '—' : `${porcentajeFull.toFixed(0)}%`, kpiClass: 'kpi-success' },
  ]

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
          .tabla-container { padding: 14px; }
          .full-section { margin-top: 24px; padding-top: 20px; }
          .full-header h2 { font-size: 18px; }
        }
      `}</style>
    </div>
  )
}
