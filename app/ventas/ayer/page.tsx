import { createClient } from '@supabase/supabase-js'
import VentasTabla, { OrderWithItems } from '../../components/VentasTabla'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

function rangoDiaArgentina(diasAtras: number): { desdeISO: string; hastaISO: string } {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)

  // fechaAR es algo como "2026-05-05" (hoy en Argentina)
  const [year, month, day] = fechaAR.split('-').map(Number)

  // Construyo "ayer" en zona AR sumando -1 día
  const hoyAR = new Date(Date.UTC(year, month - 1, day))
  hoyAR.setUTCDate(hoyAR.getUTCDate() - diasAtras)
  const ayerStr = hoyAR.toISOString().slice(0, 10) // YYYY-MM-DD

  const hoyAR2 = new Date(Date.UTC(year, month - 1, day))
  hoyAR2.setUTCDate(hoyAR2.getUTCDate() - diasAtras + 1)
  const finStr = hoyAR2.toISOString().slice(0, 10)

  // 00:00 hasta 24:00 (00:00 del día siguiente) en AR (offset -03:00)
  const desdeISO = new Date(`${ayerStr}T00:00:00-03:00`).toISOString()
  const hastaISO = new Date(`${finStr}T00:00:00-03:00`).toISOString()

  return { desdeISO, hastaISO }
}

export default async function Ayer() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { desdeISO, hastaISO } = rangoDiaArgentina(1)

  const { data: ordenesRaw } = await supabase
    .from('orders')
    .select(`
      order_id, status, total_amount, currency, buyer_nickname,
      date_created, marketplace_fee, shipping_cost, discounts, net_received,
      order_items ( item_id, title, quantity, unit_price )
    `)
    .gte('date_created', desdeISO)
    .lt('date_created', hastaISO)
    .order('date_created', { ascending: false })

  const ordenes: OrderWithItems[] = (ordenesRaw ?? []).map((o: any) => ({
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
    items: Array.isArray(o.order_items) ? o.order_items : [],
  }))

  const ventasPagadas = ordenes.filter(o => o.status === 'paid')
  const cancelaciones = ordenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  // Mostrar la fecha de "ayer"
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  const fechaAyer = ayer.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: TZ,
  })

  const cards = [
    { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), color: 'var(--success)' },
    { titulo: 'Facturación', valor: formatARS(facturacion), color: 'var(--info)' },
    { titulo: 'Ticket promedio', valor: formatARS(ticketPromedio), color: 'var(--warning)' },
    { titulo: 'Cancelaciones', valor: String(cancelaciones.length), color: 'var(--danger)' },
  ]

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Ventas de ayer</h1>
          <p className="fecha">{fechaAyer}</p>
        </div>
      </div>

      <div className="kpis">
        {cards.map((card) => (
          <div key={card.titulo} className="kpi-card" style={{ '--kpi-accent': card.color } as any}>
            <p className="kpi-titulo">{card.titulo}</p>
            <p className="kpi-valor">{card.valor}</p>
          </div>
        ))}
      </div>

      <div className="tabla-container">
        <h2>Detalle ({ordenes.length} {ordenes.length === 1 ? 'venta' : 'ventas'})</h2>

        {ordenes.length === 0 ? (
          <p className="empty">
            No hubo ventas ayer.
          </p>
        ) : (
          <VentasTabla ordenes={ordenes} mostrarHora={true} timeZone={TZ} />
        )}
      </div>

      <style>{`
        .page {
          padding: 32px 40px 40px;
          min-height: 100vh;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 28px;
          gap: 16px;
        }
        .header h1 {
          color: var(--text-primary);
          margin: 0 0 4px;
          font-size: 26px;
          font-weight: 700;
        }
        .fecha {
          color: var(--text-muted);
          margin: 0;
          text-transform: capitalize;
          font-size: 13px;
        }
        .kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 28px;
        }
        .kpi-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 20px 22px;
          position: relative;
          overflow: hidden;
        }
        .kpi-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          background: var(--kpi-accent);
          opacity: 0.7;
        }
        .kpi-titulo {
          color: var(--text-muted);
          font-size: 12px;
          margin: 0 0 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .kpi-valor {
          font-size: 26px;
          font-weight: 700;
          margin: 0;
          color: var(--text-primary);
        }
        .tabla-container {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 24px;
        }
        .tabla-container h2 {
          margin: 0 0 16px;
          color: var(--text-primary);
          font-size: 18px;
          font-weight: 600;
        }
        .empty {
          color: var(--text-muted);
        }

        @media (max-width: 768px) {
          .page {
            padding: 16px;
          }
          .header {
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
          }
          .header h1 {
            font-size: 20px;
          }
          .fecha {
            font-size: 12px;
          }
          .kpis {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-bottom: 16px;
          }
          .kpi-card {
            padding: 14px;
          }
          .kpi-titulo {
            font-size: 11px;
          }
          .kpi-valor {
            font-size: 18px;
          }
          .tabla-container {
            padding: 16px;
          }
          .tabla-container h2 {
            font-size: 15px;
          }
        }
      `}</style>
    </div>
  )
}