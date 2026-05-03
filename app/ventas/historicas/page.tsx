import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import VentasTabla, { OrderWithItems } from '../../components/VentasTabla'

export const dynamic = 'force-dynamic'

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

  const todasOrdenes: { status: string; total_amount: number }[] = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('orders')
      .select('status, total_amount')
      .gte('date_created', desdeISO)
      .range(from, from + PAGE_SIZE - 1)

    if (error || !data || data.length === 0) break
    todasOrdenes.push(...(data as { status: string; total_amount: number }[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  const ventasPagadas = todasOrdenes.filter(o => o.status === 'paid')
  const cancelaciones = todasOrdenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  const { data: recientesRaw } = await supabase
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
      discounts,
      net_received,
      order_items (
        item_id,
        title,
        quantity,
        unit_price
      )
    `)
    .gte('date_created', desdeISO)
    .order('date_created', { ascending: false })
    .limit(100)

  const ordenes: OrderWithItems[] = (recientesRaw ?? []).map((o: any) => ({
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

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

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
          <VentasTabla ordenes={ordenes} mostrarHora={false} />
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
        }
      `}</style>
    </div>
  )
}