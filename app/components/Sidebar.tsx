'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Sidebar() {
  const pathname = usePathname()

  const items = [
    { href: '/hoy', label: 'Hoy', icon: '🟢' },
    { href: '/historicas', label: 'Históricas', icon: '📊' },
  ]

  return (
    <>
      {/* Sidebar desktop (oculto en mobile) */}
      <aside className="sidebar-desktop">
        <div className="sidebar-header">
          <h2>ML Dashboard</h2>
          <p>TRDTECH</p>
        </div>
        <nav>
          {items.map((item) => {
            const activo = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${activo ? 'activo' : ''}`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Bottom nav mobile (oculto en desktop) */}
      <nav className="bottom-nav">
        {items.map((item) => {
          const activo = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-link ${activo ? 'activo' : ''}`}
            >
              <span style={{ fontSize: '22px' }}>{item.icon}</span>
              <span style={{ fontSize: '11px' }}>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <style>{`
        .sidebar-desktop {
          width: 240px;
          background-color: #1a1a1a;
          color: white;
          min-height: 100vh;
          padding: 24px 0;
          flex-shrink: 0;
        }
        .sidebar-header {
          padding: 0 24px 24px;
          border-bottom: 1px solid #333;
        }
        .sidebar-header h2 {
          margin: 0;
          font-size: 18px;
          color: white;
        }
        .sidebar-header p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #888;
        }
        .sidebar-desktop nav {
          margin-top: 16px;
        }
        .sidebar-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 24px;
          color: #aaa;
          background-color: transparent;
          border-left: 3px solid transparent;
          text-decoration: none;
          font-size: 15px;
        }
        .sidebar-link.activo {
          color: white;
          background-color: #2a2a2a;
          border-left-color: #4CAF50;
          font-weight: bold;
        }

        .bottom-nav {
          display: none;
        }

        @media (max-width: 768px) {
          .sidebar-desktop {
            display: none;
          }
          .bottom-nav {
            display: flex;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background-color: #1a1a1a;
            border-top: 1px solid #333;
            z-index: 100;
            padding-bottom: env(safe-area-inset-bottom);
          }
          .bottom-link {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 10px 0;
            color: #888;
            text-decoration: none;
            border-top: 3px solid transparent;
          }
          .bottom-link.activo {
            color: white;
            border-top-color: #4CAF50;
            background-color: #2a2a2a;
          }
        }
      `}</style>
    </>
  )
}