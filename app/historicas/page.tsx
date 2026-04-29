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

  // Calcular fecha desde hace X días
  const desde = new Date()
  desde.setDate(desde.getDate() - dias)
  const desdeISO = desde.toISOString()

  // KPIs: traer TODAS las órdenes del rango paginando
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

  // Tabla: las 100 más recientes del rango
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
    { value: '7', label: 'Últimos 7 días' },
    { value: '30', label: 'Últimos 30 días' },
    { value: '90', label: 'Últimos 90 días' },
  ]

  return (
    <div style={{ padding: '40px', minHeight: '100vh' }}>
      <h1 style={{ color: '#333', margin: '0 0 4px' }}>Ventas históricas</h1>
      <p style={{ color: '#666', margin: '0 0 24px' }}>
        Análisis de ventas en períodos pasados
      </p>

      {/* Filtros de rango */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '32px',
        flexWrap: 'wrap',
      }}>
        {rangos.map((r) => {
          const activo = rango === r.value
          return (
            <Link
              key={r.value}
              href={`/historicas?rango=${r.value}`}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: activo ? 'bold' : 'normal',
                backgroundColor: activo ? '#2196F3' : 'white',
                color: activo ? 'white' : '#666',
                border: activo ? 'none' : '1px solid #ddd',
                textDecoration: 'none',
              }}
            >
              {r.label}
            </Link>
          )
        })}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '32px'
      }}>
        {[
          { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), color: '#4CAF50' },
          { titulo: 'Facturación', valor: formatARS(facturacion), color: '#2196F3' },
          { titulo: 'Ticket promedio', valor: formatARS(ticketPromedio), color: '#FF9800' },
          { titulo: 'Cancelaciones', valor: String(cancelaciones.length), color: '#f44336' },
        ].map((card) => (
          <div key={card.titulo} style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            borderTop: `4px solid ${card.color}`
          }}>
            <p style={{ color: '#666', fontSize: '14px', margin: '0 0 8px' }}>
              {card.titulo}
            </p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', margin: 0 }}>
              {card.valor}
            </p>
          </div>
        ))}
      </div>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px'
      }}>
        <h2 style={{ margin: '0 0 16px', color: '#333' }}>
          Últimas 100 ventas del período
        </h2>
        <p style={{ color: '#999', fontSize: '13px', margin: '0 0 16px' }}>
          Total de órdenes en el período: {todasOrdenes.length}
        </p>

        {ordenes.length === 0 ? (
          <p style={{ color: '#999' }}>
            No hay ventas en este período.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Fecha</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Order ID</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Comprador</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Estado</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((o) => (
                  <tr key={o.order_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px 8px', fontSize: '14px' }}>{formatFecha(o.date_created)}</td>
                    <td style={{ padding: '12px 8px', fontSize: '13px', color: '#666' }}>{o.order_id}</td>
                    <td style={{ padding: '12px 8px', fontSize: '14px' }}>{o.buyer_nickname ?? '-'}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span style={{
                        backgroundColor: colorStatus(o.status),
                        color: 'white',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}>
                        {o.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', fontWeight: 'bold' }}>
                      {formatARS(Number(o.total_amount ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
