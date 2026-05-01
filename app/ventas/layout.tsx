'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function VentasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  const tabs = [
    { href: '/ventas/hoy', label: 'Hoy', icon: '🟢' },
    { href: '/ventas/historicas', label: 'Históricas', icon: '📊' },
  ]

  return (
    <div className="ventas-wrapper">
      <div className="tabs">
        {tabs.map((tab) => {
          const activo = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`tab ${activo ? 'tab-activa' : ''}`}
              prefetch
            >
              <span className="tab-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>

      <div className="ventas-content">
        {children}
      </div>

      <style>{`
        .ventas-wrapper {
          width: 100%;
        }
        .tabs {
          display: flex;
          gap: 4px;
          padding: 16px 32px 0;
          background: #f5f5f5;
          border-bottom: 1px solid #e5e5e5;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .tab {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          color: #666;
          text-decoration: none;
          font-size: 15px;
          font-weight: 500;
          border-bottom: 3px solid transparent;
          margin-bottom: -1px;
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .tab:hover {
          color: #1a1a1a;
        }
        .tab-activa {
          color: #1a1a1a;
          border-bottom-color: #4CAF50;
          font-weight: 600;
        }
        .tab-icon {
          font-size: 14px;
        }
        .ventas-content {
          width: 100%;
        }

        @media (max-width: 768px) {
          .tabs {
            padding: 12px 16px 0;
            padding-left: 68px; /* deja espacio para el botón hamburguesa */
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
          .tab {
            padding: 10px 16px;
            font-size: 14px;
          }
        }
      `}</style>
    </div>
  )
}
