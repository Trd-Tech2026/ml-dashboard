import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type Order = {
  order_id: number
  status: string
  total_amount: number
  currency: string
  buyer_nickname: string
  date_created: string
}

export default async function Dashboard() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // KPIs: traer TODAS las órdenes (solo columnas necesarias para que sea rápido)
  const { data: todas } = await supabase
    .from('orders')
    .select('status, total_amount')
    .limit(10000)

  const todasOrdenes = (todas ?? []) as Pick<Order, 'status' | 'total_amount'>[]
  const ventasPagadas = todasOrdenes.filter(o => o.status === 'paid')
  const cancelaciones = todasOrdenes.filter(o => o.status === 'cancelled')
  const facturacion = ventasPagadas.reduce((sum, o) => sum + Number(o.total_amount ?? 0), 0)
  const ticketPromedio = ventasPagadas.length > 0 ? facturacion / ventasPagadas.length : 0

  // Tabla: solo las 100 más recientes
  const { data: recientes } = await supabase
    .from('orders')
    .select('*')
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

  return (
    <div style={{
      fontFamily: 'sans-serif',
      padding: '40px',
      backgroundColor: '#f5f5f5',
      minHeight: '100vh'
    }}>
      <h1 style={{ color: '#333', marginBottom: '4px' }}>Dashboard ML Full</h1>
      <p style={{ color: '#666', marginBottom: '32px' }}>
        Conectado con Mercado Libre ✅ — Sincronizadas {todasOrdenes.length} órdenes (últimos 90 días)
      </p>

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
        <h2 style={{ margin: '0 0 16px', color: '#333' }}>Últimas 100 ventas</h2>

        {ordenes.length === 0 ? (
          <p style={{ color: '#999' }}>
            Todavía no hay ventas sincronizadas. Andá a <code>/api/sync</code> para traerlas.
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
