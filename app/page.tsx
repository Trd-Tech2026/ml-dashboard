import Link from 'next/link'

type ModuleCard = {
  href: string
  title: string
  description: string
  icon: string
  color: string
  soon?: boolean
}

const modules: ModuleCard[] = [
  {
    href: '/ventas/hoy',
    title: 'Ventas',
    description: 'Ventas del día y análisis histórico. KPIs, detalle de cada venta y filtros por período.',
    icon: '🛒',
    color: '#4CAF50',
  },
  {
    href: '/stock',
    title: 'Stock',
    description: 'Inventario en tiempo real de tus publicaciones de Mercado Libre. Alertas de stock bajo.',
    icon: '📦',
    color: '#2196F3',
    soon: true,
  },
  {
    href: '/rentabilidad',
    title: 'Rentabilidad',
    description: 'Ganancia neta por venta y por producto. Costos, comisiones de ML y márgenes.',
    icon: '💰',
    color: '#FF9800',
    soon: true,
  },
]

export default function Home() {
  return (
    <div className="hub">
      <div className="hub-header">
        <h1>ML Dashboard</h1>
        <p>TRDTECH — Elegí qué querés gestionar</p>
      </div>

      <div className="cards">
        {modules.map((mod) => (
          <Link key={mod.href} href={mod.href} className="card">
            <div className="card-icon" style={{ backgroundColor: mod.color + '20', color: mod.color }}>
              {mod.icon}
            </div>
            <div className="card-body">
              <div className="card-title-row">
                <h2>{mod.title}</h2>
                {mod.soon && <span className="badge">Próximamente</span>}
              </div>
              <p>{mod.description}</p>
            </div>
            <div className="card-arrow">→</div>
          </Link>
        ))}
      </div>

      <style>{`
        .hub {
          padding: 48px 32px;
          max-width: 1100px;
          margin: 0 auto;
        }
        .hub-header {
          margin-bottom: 32px;
        }
        .hub-header h1 {
          margin: 0 0 8px;
          font-size: 32px;
          color: #1a1a1a;
        }
        .hub-header p {
          margin: 0;
          color: #666;
          font-size: 16px;
        }
        .cards {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .card {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 24px;
          background: white;
          border: 1px solid #e5e5e5;
          border-radius: 12px;
          text-decoration: none;
          color: inherit;
          transition: all 0.15s ease;
        }
        .card:hover {
          border-color: #c5c5c5;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
          transform: translateY(-1px);
        }
        .card-icon {
          width: 56px;
          height: 56px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          flex-shrink: 0;
        }
        .card-body {
          flex: 1;
          min-width: 0;
        }
        .card-title-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 6px;
        }
        .card-body h2 {
          margin: 0;
          font-size: 20px;
          color: #1a1a1a;
        }
        .badge {
          font-size: 11px;
          background: #fff3e0;
          color: #e65100;
          padding: 3px 10px;
          border-radius: 12px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .card-body p {
          margin: 0;
          color: #666;
          font-size: 14px;
          line-height: 1.5;
        }
        .card-arrow {
          color: #999;
          font-size: 22px;
          flex-shrink: 0;
        }
        .card:hover .card-arrow {
          color: #1a1a1a;
          transform: translateX(2px);
        }

        @media (min-width: 768px) {
          .cards {
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          }
        }

        /* 📱 Mobile: cards más compactas */
        @media (max-width: 768px) {
  .hub {
    padding: 56px 16px 32px;
  }
          .hub-header {
            margin-bottom: 20px;
          }
          .hub-header h1 {
            font-size: 24px;
          }
          .hub-header p {
            font-size: 14px;
          }
          .cards {
            gap: 12px;
          }
          .card {
            padding: 16px;
            gap: 14px;
            border-radius: 10px;
          }
          .card-icon {
            width: 44px;
            height: 44px;
            font-size: 22px;
            border-radius: 10px;
          }
          .card-body h2 {
            font-size: 17px;
          }
          .card-title-row {
            margin-bottom: 4px;
            gap: 8px;
          }
          .card-body p {
            font-size: 13px;
            line-height: 1.4;
          }
          .badge {
            font-size: 10px;
            padding: 2px 8px;
          }
          .card-arrow {
            font-size: 18px;
          }
        }
      `}</style>
    </div>
  )
}
