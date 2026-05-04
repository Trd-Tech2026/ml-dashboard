'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function VentasLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const tabs = [
    { href: '/ventas/hoy', label: 'Hoy', icon: '🟢' },
    { href: '/ventas/historicas', label: 'Históricas', icon: '📊' },
  ]
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <>
      <div className="ventas-tabs">
        {tabs.map((t) => {
          const activo = isActive(t.href)
          return (
            <Link key={t.href} href={t.href} className={`ventas-tab ${activo ? 'activa' : ''}`}>
              <span className="tab-icon">{t.icon}</span>
              <span>{t.label}</span>
            </Link>
          )
        })}
      </div>
      {children}

      <style>{`
        .ventas-tabs {
          display: flex;
          gap: 4px;
          padding: 16px 40px 0;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(13, 22, 32, 0.4);
          backdrop-filter: blur(8px);
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .ventas-tab {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 18px;
          color: var(--text-muted);
          background: transparent;
          border-bottom: 2px solid transparent;
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.15s ease;
          margin-bottom: -1px;
        }
        .ventas-tab:hover {
          color: var(--text-secondary);
        }
        .ventas-tab.activa {
          color: var(--accent);
          border-bottom-color: var(--accent);
          font-weight: 600;
        }
        .tab-icon {
          font-size: 12px;
        }

        @media (max-width: 768px) {
          .ventas-tabs {
            padding: 16px 16px 0;
          }
          .ventas-tab {
            padding: 10px 14px;
            font-size: 13px;
          }
        }
      `}</style>
    </>
  )
}
