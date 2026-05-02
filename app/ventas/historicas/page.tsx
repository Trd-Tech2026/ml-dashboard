import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

type Order = {
  order_id: number
  status: string
  total_amount: number
  currency: string
  buyer_nickname: string
  date_created: string
}

type Props = {
  searchParams: Promise<{ rango?: string }>
}

export default async function Historicas({ searchParams }: Props) {
  const params = await searchParams
  const rango = params.rango ?? '90'
  const dias = parseInt(rango, 10) || 90

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const desde = new Date()
  desde.setDate(desde.getDate() - dias)
  const desdeISO = desde.toISOString()

  const todasOrdenes: Pick<Order, 'status' | 'total_amount'>[] = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('status, total_amount')
      .gte('date_created', desdeISO)
      .range(from, from + PAGE_SIZE - 1)

    if (error || !data || data.length === 0) break
    todasOrdenes.push(...(data as Pick<Order, 'status' | 'total_amount'>[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  const ventasPagadas = todasOrdenes.filter(o => o.status === 'paid')
  const cancelaciones = todasOrdenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  const { data: recientes } = await supabase
    .from('orders')
    .select('*')
    .gte('date_created', desdeISO)
    .order('date_created', { ascending: false })
    .limit(100)

  const ordenes = (recientes ?? []) as Order[]

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const formatFecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const colorStatus = (status: string) => {
    if (status === 'paid') return '#4CAF50'
    if (status === 'cancelled') return '#f44336'
    return '#FF9800'
  }

  const rangos = [
    { value: '7', label: '7 días', labelMobile: '7d' },
    { value: '30', label: '30 días', labelMobile: '30d' },
    { value: '90', label: '90 días', labelMobile: '90d' },
  ]

  const cards = [
    { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), color: '#4CAF50' },
    { titulo: 'Facturación', valor: formatARS(facturacion), color: '#2196F3' },
    { titulo: 'Ticket promedio', valor: formatARS(ticketPromedio), color: '#FF9800' },
    { titulo: 'Cancelaciones', valor: String(cancelaciones.length), color: '#f44336' },
  ]

  return (
    <div className="page">
      <h1>Ventas históricas</h1>
      <p className="subtitulo">Análisis de ventas en períodos pasados</p>

      <div className="filtros">
        {rangos.map((r) => {
          const activo = rango === r.value
          return (
            <Link
              key={r.value}
              href={`/ventas/historicas?rango=${r.value}`}
              className={`filtro ${activo ? 'activo' : ''}`}
            >
              <span className="label-desktop">Últimos {r.label}</span>
              <span className="label-mobile">{r.labelMobile}</span>
            </Link>
          )
        })}
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
        <h2>Últimas 100 ventas del período</h2>
        <p className="total-info">Total de órdenes en el período: {todasOrdenes.length}</p>

        {ordenes.length === 0 ? (
          <p className="empty">No hay ventas en este período.</p>
        ) : (
          <>
            {/* Tabla desktop */}
            <div className="tabla-desktop">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Order ID</th>
                    <th>Comprador</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenes.map((o) => (
                    <tr key={o.order_id}>
                      <td>{formatFecha(o.date_created)}</td>
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

            {/* Cards mobile */}
            <div className="cards-mobile">
              {ordenes.map((o) => (
                <div key={o.order_id} className="venta-card">
                  <div className="venta-card-row">
                    <span className="venta-fecha">{formatFecha(o.date_created)}</span>
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
        h1 {
          color: #333;
          margin: 0 0 4px;
        }
        .subtitulo {
          color: #666;
          margin: 0 0 24px;
        }
        .filtros {
          display: flex;
          gap: 8px;
          margin-bottom: 32px;
          flex-wrap: wrap;
        }
        .filtro {
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          background-color: white;
          color: #666;
          border: 1px solid #ddd;
          text-decoration: none;
        }
        .filtro.activo {
          background-color: #2196F3;
          color: white;
          border-color: #2196F3;
          font-weight: bold;
        }
        .label-mobile {
          display: none;
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
          margin: 0 0 8px;
          color: #333;
        }
        .total-info {
          color: #999;
          font-size: 13px;
          margin: 0 0 16px;
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
          h1 {
            font-size: 22px;
          }
          .subtitulo {
            font-size: 13px;
            margin-bottom: 16px;
          }
          .filtros {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-bottom: 20px;
          }
          .filtro {
            text-align: center;
            padding: 10px 8px;
            font-size: 13px;
          }
          .label-desktop {
            display: none;
          }
          .label-mobile {
            display: inline;
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
          .total-info {
            font-size: 12px;
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
          .venta-fecha {
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