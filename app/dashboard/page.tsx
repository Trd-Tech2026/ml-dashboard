export default function Dashboard() {
  return (
    <div style={{
      fontFamily: 'sans-serif',
      padding: '40px',
      backgroundColor: '#f5f5f5',
      minHeight: '100vh'
    }}>
      <h1 style={{ color: '#333', marginBottom: '4px' }}>Dashboard ML Full</h1>
      <p style={{ color: '#666', marginBottom: '32px' }}>
        Conectado con Mercado Libre ✅
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '32px'
      }}>
        {[
          { titulo: 'Ventas del mes', valor: '0', color: '#4CAF50' },
          { titulo: 'Facturación', valor: '$0', color: '#2196F3' },
          { titulo: 'Stock Full', valor: '0 unidades', color: '#FF9800' },
          { titulo: 'Cancelaciones', valor: '0', color: '#f44336' },
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
        <h2 style={{ margin: '0 0 16px', color: '#333' }}>Últimas ventas</h2>
        <p style={{ color: '#999' }}>
          Todavía no hay ventas sincronizadas. 
          La sincronización con ML se configura en el siguiente paso.
        </p>
      </div>
    </div>
  )
}
