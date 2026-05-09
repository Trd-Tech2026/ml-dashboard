import Link from 'next/link'

export default function Hub() {
  const cards = [
    {
      href: '/ventas/hoy',
      icon: '🛒',
      title: 'Ventas',
      description: 'Hoy y períodos pasados',
      accent: 'var(--accent)',
      available: true,
    },
    {
      href: '/stock',
      icon: '📦',
      title: 'Stock',
      description: 'Publicaciones, stock y archivado',
      accent: 'var(--info)',
      available: true,
    },
    {
      href: '/rentabilidad',
      icon: '💰',
      title: 'Rentabilidad',
      description: 'Ganancia real por venta y producto',
      accent: 'var(--warning)',
      available: true,
    },
  ]

  return (
    <div className="hub">
      <div className="hub-header">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0d4d6e" />
                  <stop offset="50%" stopColor="#1ca0c4" />
                  <stop offset="100%" stopColor="#3ee5e0" />
                </linearGradient>
              </defs>
              <path d="M 20 40 Q 50 12 80 40" stroke="url(#brandGrad)" strokeWidth="8" fill="none" strokeLinecap="round" />
              <path d="M 18 65 Q 50 92 82 60" stroke="url(#brandGrad)" strokeWidth="8" fill="none" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1>ML Dashboard</h1>
            <p className="subtitle">TRDTECH · Todo para tu hogar</p>
          </div>
        </div>
      </div>

      <div className="cards-grid">
        {cards.map((c) => {
          const Comp = c.available ? Link : 'div'
          const props: any = c.available ? { href: c.href } : {}
          return (
            <Comp
              key={c.title}
              {...props}
              className={`card ${!c.available ? 'card-disabled' : ''}`}
              style={{ '--card-accent': c.accent } as React.CSSProperties}
            >
              <div className="card-icon">{c.icon}</div>
              <h2 className="card-title">{c.title}</h2>
              <p className="card-desc">{c.description}</p>
              {!c.available && <span className="badge-soon">Pronto</span>}
              {c.available && <span className="card-arrow">→</span>}
            </Comp>
          )
        })}
      </div>

      <style>{`
        .hub {
          padding: 56px 40px 40px;
          max-width: 1100px;
          margin: 0 auto;
        }
        .hub-header {
          margin-bottom: 48px;
        }
        .brand-row {
          display: flex;
          align-items: center;
          gap: 18px;
        }
        .brand-mark {
          width: 56px;
          height: 56px;
          flex-shrink: 0;
          filter: drop-shadow(0 0 12px rgba(62, 229, 224, 0.4));
        }
        .brand-mark svg {
          width: 100%;
          height: 100%;
        }
        h1 {
          margin: 0 0 4px;
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.5px;
        }
        .subtitle {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
        }
        .card {
          position: relative;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          padding: 28px 24px;
          color: var(--text-primary);
          transition: all 0.18s ease;
          overflow: hidden;
          display: block;
        }
        .card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: var(--card-accent);
          opacity: 0.5;
          transition: opacity 0.18s ease;
        }
        .card:not(.card-disabled):hover {
          background: var(--bg-card-hover);
          border-color: var(--border-medium);
          transform: translateY(-2px);
          box-shadow: var(--shadow-card), 0 0 30px rgba(62, 229, 224, 0.08);
        }
        .card:not(.card-disabled):hover::before {
          opacity: 1;
        }
        .card:not(.card-disabled):hover .card-arrow {
          transform: translateX(4px);
          opacity: 1;
        }
        .card-disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .card-icon {
          font-size: 36px;
          margin-bottom: 12px;
          line-height: 1;
        }
        .card-title {
          margin: 0 0 6px;
          font-size: 20px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .card-desc {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
        }
        .badge-soon {
          position: absolute;
          top: 16px;
          right: 16px;
          font-size: 10px;
          background: var(--bg-elevated);
          color: var(--text-muted);
          padding: 4px 10px;
          border-radius: 10px;
          letter-spacing: 1px;
          font-weight: 600;
          border: 1px solid var(--border-subtle);
        }
        .card-arrow {
          position: absolute;
          right: 24px;
          bottom: 24px;
          font-size: 20px;
          color: var(--accent);
          opacity: 0;
          transition: all 0.18s ease;
        }

        @media (max-width: 768px) {
          .hub {
            padding: 24px 16px 32px;
          }
          .hub-header {
            margin-bottom: 28px;
          }
          .brand-mark {
            width: 44px;
            height: 44px;
          }
          h1 {
            font-size: 22px;
          }
          .subtitle {
            font-size: 11px;
          }
          .card {
            padding: 22px 18px;
          }
          .card-icon {
            font-size: 30px;
          }
          .card-title {
            font-size: 18px;
          }
        }
      `}</style>
    </div>
  )
}