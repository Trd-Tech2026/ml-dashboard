import { createClient } from '@supabase/supabase-js'
import BotonSync from '../components/BotonSync'

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

// Devuelve el inicio del día actual en hora Argentina, en formato ISO UTC
function inicioDiaArgentinaISO(): string {
  const ahora = new Date()
  // Formateamos como YYYY-MM-DD en zona Argentina
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora) // ej: "2026-04-29"
  // Construimos el inicio del día Argentina (00:00 ART = 03:00 UTC)
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

  return (
    <div style={{ padding: '40px', minHeight: '100vh' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '32px',
      }}>
        <div>
          <h1 style={{ color: '#333', margin: '0 0 4px' }}>Ventas de hoy</h1>
          <p style={{ color: '#666', margin: 0, textTransform: 'capitalize' }}>
            {fechaHoy}
          </p>
        </div>
        <BotonSync />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '32px'
      }}>
        {[
          { titulo: 'Ventas pagadas', valor: String(ventasPagadas.length), color: '#4CAF50' },
          { titulo: 'Facturación del día', valor: formatARS(facturacion), color: '#2196F3' },
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
          Detalle ({ordenes.length} {ordenes.length === 1 ? 'venta' : 'ventas'})
        </h2>

        {ordenes.length === 0 ? (
          <p style={{ color: '#999' }}>
            Todavía no hay ventas hoy. Apretá &quot;Actualizar ventas&quot; para sincronizar.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Hora</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Order ID</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Comprador</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px' }}>Estado</th>
                  <th style={{ padding: '12px 8px', color: '#666', fontSize: '13px', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((o) => (
                  <tr key={o.order_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px 8px', fontSize: '14px' }}>{formatHora(o.date_created)}</td>
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