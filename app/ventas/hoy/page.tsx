import { createClient } from '@supabase/supabase-js'
import BotonSync from '../../components/BotonSync'
import VentasTabla, { OrderWithItems } from '../../components/VentasTabla'
import CollapsibleSection from '../../components/CollapsibleSection'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

type OrderEnriched = OrderWithItems & { shipping_logistic_type: string | null }

type Cambio = { pct: number; trend: 'up' | 'down' | 'flat' } | null

function inicioDiaArgentinaISO(): string {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)
  return new Date(`${fechaAR}T00:00:00-03:00`).toISOString()
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

export default async function Hoy() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const inicioDiaISO = inicioDiaArgentinaISO()

  // === Rango HOY: desde inicio del día hasta ahora ===
  const { data: ordenesRaw } = await supabase
    .from('orders')
    .select(`
      order_id, status, total_amount, currency, buyer_nickname,
      date_created, marketplace_fee, shipping_cost, discounts, net_received,
      shipping_logistic_type,
      order_items ( item_id, title, quantity, unit_price )
    `)
    .gte('date_created', inicioDiaISO)
    .order('date_created', { ascending: false })

  const ordenes: OrderEnriched[] = (ordenesRaw ?? []).map((o: any) => ({
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

  // === Rango AYER mismo lapso (para comparativa) ===
  const inicioHoyMs = new Date(inicioDiaISO).getTime()
  const ahoraMs = Date.now()
  const duracionMs = ahoraMs - inicioHoyMs

  const inicioAyerMs = inicioHoyMs - 24 * 60 * 60 * 1000
  const finAyerMs = inicioAyerMs + duracionMs

  const inicioAyerISO = new Date(inicioAyerMs).toISOString()
  const finAyerISO = new Date(finAyerMs).toISOString()

  const { data: ayerRaw } = await supabase
    .from('orders')
    .select('status, total_amount')
    .gte('date_created', inicioAyerISO)
    .lt('date_created', finAyerISO)

  const ayerOrdenes = (ayerRaw ?? []) as { status: string; total_amount: number }[]

  // === Cálculos hoy ===
  const ventasPagadas = ordenes.filter(o => o.status === 'paid')
  const cancelaciones = ordenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  // === Cálculos ayer (mismo lapso) ===
  const ayerPagadas = ayerOrdenes.filter(o => o.status === 'paid')
  const ayerCancelaciones = ayerOrdenes.filter(o => o.status === 'cancelled')
  const ayerFacturacion = ayerPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ayerTicket = ayerPagadas.length > 0 ? ayerFacturacion / ayerPagadas.length : 0

  // === Cálculos Full ===
  const ordenesFull = ordenes.filter(o => o.shipping_logistic_type === 'fulfillment')
  const ventasFullPagadas = ordenesFull.filter(o => o.status === 'paid')
  const facturacionFull = ventasFullPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketFull = ventasFullPagadas.length > 0 ? facturacionFull / ventasFullPagadas.length : 0
  const porcentajeFull = ventasPagadas.length > 0
    ? (ventasFullPagadas.length / ventasPagadas.length) * 100
    : 0

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const fechaHoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: TZ,
  })

  const labelComparacion = 'vs ayer'

  const cards = [
    { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), color: 'var(--success)',
      cambio: calcCambio(ventasPagadas.length, ayerPagadas.length) },
    { titulo: 'Facturación', valor: formatARS(facturacion), color: 'var(--info)',
      cambio: calcCambio(facturacion, ayerFacturacion) },
    { titulo: 'Ticket promedio', valor: formatARS(ticketPromedio), color: 'var(--warning)',
      cambio: calcCambio(ticketPromedio, ayerTicket) },
    { titulo: 'Cancelaciones', valor: String(cancelaciones.length), color: 'var(--danger)',
      cambio: calcCambio(cancelaciones.length, ayerCancelaciones.length), invertColor: true },
  ]

  const cardsFull = [
    { titulo: 'Ventas Full pagadas', valor: String(ventasFullPagadas.length), color: 'var(--accent)' },
    { titulo: 'Facturación Full', valor: formatARS(facturacionFull), color: 'var(--info)' },
    { titulo: 'Ticket promedio Full', valor: formatARS(ticketFull), color: 'var(--warning)' },
    { titulo: '% sobre ventas pagadas', valor: ventasPagadas.length === 0 ? '—' : `${porcentajeFull.toFixed(0)}%`, color: 'var(--success)' },
  ]

  const renderCambio = (cambio: Cambio, invertColor?: boolean) => {
    if (!cambio) return <p className="kpi-cambio cambio-flat">— sin datos previos</p>
    const isGood = cambio.trend === 'flat' ? null : (cambio.trend === 'up') !== !!invertColor
    const className =
      cambio.trend === 'flat' ? 'cambio-flat' : (isGood ? 'cambio-good' : 'cambio-bad')
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
        <div>
          <h1>Ventas de hoy</h1>
          <p className="fecha">{fechaHoy}</p>
        </div>
        <BotonSync />
      </div>

      <div className="kpis">
        {cards.map((card) => (
          <div key={card.titulo} className="kpi-card" style={{ '--kpi-accent': card.color } as any}>
            <p className="kpi-titulo">{card.titulo}</p>
            <p className="kpi-valor">{card.valor}</p>
            {renderCambio(card.cambio, card.invertColor)}
          </div>
        ))}
      </div>

      <div className="tabla-container">
        <CollapsibleSection
          title={`Detalle (${ordenes.length} ${ordenes.length === 1 ? 'venta' : 'ventas'})`}
          defaultOpen={false}
        >
          {ordenes.length === 0 ? (
            <p className="empty">
              Todavía no hay ventas hoy. Apretá &quot;Actualizar ventas&quot; para sincronizar.
            </p>
          ) : (
            <VentasTabla ordenes={ordenes} mostrarHora={true} timeZone={TZ} />
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
            <div key={card.titulo} className="kpi-card kpi-full" style={{ '--kpi-accent': card.color } as any}>
              <p className="kpi-titulo">{card.titulo}</p>
              <p className="kpi-valor">{card.valor}</p>
            </div>
          ))}
        </div>

        <div className="tabla-container">
          <CollapsibleSection
            title={`Detalle Full (${ordenesFull.length} ${ordenesFull.length === 1 ? 'venta' : 'ventas'})`}
            defaultOpen={false}
          >
            {ordenesFull.length === 0 ? (
              <p className="empty">No hay ventas Full hoy.</p>
            ) : (
              <VentasTabla ordenes={ordenesFull} mostrarHora={true} timeZone={TZ} />
            )}
          </CollapsibleSection>
        </div>
      </div>

      <style>{`
        .page { padding: 32px 40px 40px; min-height: 100vh; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; gap: 16px; }
        .header h1 { color: var(--text-primary); margin: 0 0 4px; font-size: 26px; font-weight: 700; }
        .fecha { color: var(--text-muted); margin: 0; text-transform: capitalize; font-size: 13px; }
        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
        .kpi-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 20px 22px; position: relative; overflow: hidden; }
        .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--kpi-accent); opacity: 0.7; }
        .kpi-titulo { color: var(--text-muted); font-size: 12px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .kpi-valor { font-size: 26px; font-weight: 700; margin: 0; color: var(--text-primary); }
        .kpi-cambio { font-size: 11px; margin: 8px 0 0; font-weight: 600; letter-spacing: 0.3px; }
        .cambio-good { color: var(--success); }
        .cambio-bad { color: var(--danger); }
        .cambio-flat { color: var(--text-muted); }
        .tabla-container { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 24px; }
        .empty { color: var(--text-muted); }
        .full-section { margin-top: 36px; padding-top: 28px; border-top: 1px solid var(--border-subtle); }
        .full-header { margin-bottom: 20px; }
        .full-header h2 { margin: 0 0 4px; color: var(--text-primary); font-size: 22px; font-weight: 700; }
        .full-header p { margin: 0; color: var(--text-muted); font-size: 13px; }
        .kpi-full { background: linear-gradient(135deg, rgba(62, 229, 224, 0.04) 0%, rgba(28, 160, 196, 0.02) 100%); }
        @media (max-width: 768px) {
          .page { padding: 16px; }
          .header { flex-direction: column; align-items: stretch; gap: 12px; }
          .header h1 { font-size: 20px; }
          .fecha { font-size: 12px; }
          .kpis { grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
          .kpi-card { padding: 14px; }
          .kpi-titulo { font-size: 11px; }
          .kpi-valor { font-size: 18px; }
          .kpi-cambio { font-size: 10px; }
          .tabla-container { padding: 16px; }
          .full-section { margin-top: 24px; padding-top: 20px; }
          .full-header h2 { font-size: 18px; }
        }
      `}</style>
    </div>
  )
}
