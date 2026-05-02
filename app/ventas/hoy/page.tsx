import { createClient } from '@supabase/supabase-js'
import BotonSync from '../../components/BotonSync'
import VentasTabla, { OrderWithItems } from '../../components/VentasTabla'

export const dynamic = 'force-dynamic'

const TZ = 'America/Argentina/Buenos_Aires'

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

export default async function Hoy() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const inicioDiaISO = inicioDiaArgentinaISO()

  // Traer órdenes con sus items + datos financieros
  const { data: ordenesRaw } = await supabase
    .from('orders')
    .select(`
      order_id,
      status,
      total_amount,
      currency,
      buyer_nickname,
      date_created,
      marketplace_fee,
      shipping_cost,
      net_received,
      order_items (
        item_id,
        title,
        quantity,
        unit_price
      )
    `)
    .gte('date_created', inicioDiaISO)
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
    net_received: Number(o.net_received ?? 0),
    items: Array.isArray(o.order_items) ? o.order_items : [],
  }))

  const ventasPagadas = ordenes.filter(o => o.status === 'paid')
  const cancelaciones = ordenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const fechaHoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: TZ,
  })

  const cards = [
    { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), color: '#4CAF50' },
    { titulo: 'Facturación', valor: formatARS(facturacion), color: '#2196F3' },
    { titulo: 'Ticket promedio', valor: formatARS(ticketPromedio), color: '#FF9800' },
    { titulo: 'Cancelaciones', valor: String(cancelaciones.length), color: '#f44336' },
  ]

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
          <div key={card.titulo} className="kpi-card" style={{ borderTop: `4px solid ${card.color}` }}>
            <p className="kpi-titulo">{card.titulo}</p>
            <p className="kpi-valor">{card.valor}</p>
          </div>
        ))}
      </div>

      <div className="tabla-container">
        <h2>Detalle ({ordenes.length} {ordenes.length === 1 ? 'venta' : 'ventas'})</h2>

        {ordenes.length === 0 ? (
          <p className="empty">
            Todavía no hay ventas hoy. Apretá &quot;Actualizar ventas&quot; para sincronizar.
          </p>
        ) : (
          <VentasTabla ordenes={ordenes} mostrarHora={true} timeZone={TZ} />
        )}
      </div>

      <style>{`
        .page {
          padding: 40px;
          min-height: 100vh;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
          gap: 16px;
        }
        .header h1 {
          color: #333;
          margin: 0 0 4px;
        }
        .fecha {
          color: #666;
          margin: 0;
          text-transform: capitalize;
        }
        .kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 32px;
        }
        .kpi-card {
          background-color: white;
          border-radius: 12px;
          padding: 24px;
        }
        .kpi-titulo {
          color: #666;
          font-size: 14px;
          margin: 0 0 8px;
        }
        .kpi-valor {
          font-size: 28px;
          font-weight: bold;
          margin: 0;
        }
        .tabla-container {
          background-color: white;
          border-radius: 12px;
          padding: 24px;
        }
        .tabla-container h2 {
          margin: 0 0 16px;
          color: #333;
        }
        .empty {
          color: #999;
        }

        @media (max-width: 768px) {
          .page {
            padding: 16px;
          }
          .header {
            flex-direction: column;
            align-items: stretch;
            gap: 16px;
          }
          .header h1 {
            font-size: 22px;
          }
          .fecha {
            font-size: 13px;
          }
          .kpis {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-bottom: 20px;
          }
          .kpi-card {
            padding: 14px;
          }
          .kpi-titulo {
            font-size: 12px;
            margin-bottom: 4px;
          }
          .kpi-valor {
            font-size: 20px;
          }
          .tabla-container {
            padding: 16px;
          }
          .tabla-container h2 {
            font-size: 16px;
          }
        }
      `}</style>
    </div>
  )
}