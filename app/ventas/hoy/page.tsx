import { createClient } from '@supabase/supabase-js'
import BotonSync from '../../components/BotonSync'

export const dynamic = 'force-dynamic'

type Order = {
  order_id: number
  status: string
  total_amount: number
  currency: string
  buyer_nickname: string
  date_created: string
}

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

  const { data: ordenesHoy } = await supabase
    .from('orders')
    .select('*')
    .gte('date_created', inicioDiaISO)
    .order('date_created', { ascending: false })

  const ordenes = (ordenesHoy ?? []) as Order[]

  const ventasPagadas = ordenes.filter(o => o.status === 'paid')
  const cancelaciones = ordenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const formatHora = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: TZ,
    })

  const fechaHoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: TZ,
  })

  const colorStatus = (status: string) => {
    if (status === 'paid') return '#4CAF50'
    if (status === 'cancelled') return '#f44336'
    return '#FF9800'
  }

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
          <>
            <div className="tabla-desktop">
              <table>
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Order ID</th>
                    <th>Comprador</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenes.map((o) => (
                    <tr key={o.order_id}>
                      <td>{formatHora(o.date_created)}</td>
                      <td className="order-id">{o.order_id}</td>
                      <td>{o.buyer_nickname ?? '-'}</td>
                      <td>
                        <span className="badge" style={{ backgroundColor: colorStatus(o.status) }}>
                          {o.status}
                        </span>
                      </td>
                      <td className="total">{formatARS(Number(o.total_amount ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cards-mobile">
              {ordenes.map((o) => (
                <div key={o.order_id} className="venta-card">
                  <div className="venta-card-row">
                    <span className="venta-hora">{formatHora(o.date_created)}</span>
                    <span className="badge" style={{ backgroundColor: colorStatus(o.status) }}>
                      {o.status}
                    </span>
                  </div>
                  <div className="venta-comprador">{o.buyer_nickname ?? '-'}</div>
                  <div className="venta-card-row">
                    <span className="venta-orderid">#{o.order_id}</span>
                    <span className="venta-total">{formatARS(Number(o.total_amount ?? 0))}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
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
        .tabla-desktop table {
          width: 100%;
          border-collapse: collapse;
        }
        .tabla-desktop thead tr {
          border-bottom: 2px solid #eee;
          text-align: left;
        }
        .tabla-desktop th {
          padding: 12px 8px;
          color: #666;
          font-size: 13px;
        }
        .tabla-desktop tbody tr {
          border-bottom: 1px solid #f0f0f0;
        }
        .tabla-desktop td {
          padding: 12px 8px;
          font-size: 14px;
        }
        .order-id {
          font-size: 13px;
          color: #666;
        }
        .total {
          text-align: right;
          font-weight: bold;
        }
        .badge {
          color: white;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
          display: inline-block;
        }
        .cards-mobile {
          display: none;
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
          .tabla-desktop {
            display: none;
          }
          .cards-mobile {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .venta-card {
            background-color: #fafafa;
            border-radius: 10px;
            padding: 12px 14px;
            border: 1px solid #eee;
          }
          .venta-card-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .venta-hora {
            font-size: 14px;
            font-weight: bold;
            color: #333;
          }
          .venta-comprador {
            font-size: 14px;
            color: #555;
            margin: 6px 0;
          }
          .venta-orderid {
            font-size: 12px;
            color: #999;
          }
          .venta-total {
            font-size: 15px;
            font-weight: bold;
            color: #333;
          }
        }
      `}</style>
    </div>
  )
}