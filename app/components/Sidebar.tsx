'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  type Item = {
    href: string
    label: string
    icon: string
    soon?: boolean
  }

  const items: Item[] = [
    { href: '/', label: 'Inicio', icon: '🏠' },
    { href: '/ventas/hoy', label: 'Ventas', icon: '🛒' },
    { href: '/stock', label: 'Stock', icon: '📦' },
    { href: '/rentabilidad', label: 'Rentabilidad', icon: '💰', soon: true },
  ]

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href + '/')
  }

  if (pathname === '/login') {
    return null
  }

  const handleLogout = async () => {
    await fetch('/api/session/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      <button
        className="hamburger"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
      >
        ☰
      </button>

      {open && <div className="overlay" onClick={() => setOpen(false)} />}

      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="sidebarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0d4d6e" />
                    <stop offset="50%" stopColor="#1ca0c4" />
                    <stop offset="100%" stopColor="#3ee5e0" />
                  </linearGradient>
                </defs>
                <path d="M 20 40 Q 50 12 80 40" stroke="url(#sidebarGrad)" strokeWidth="9" fill="none" strokeLinecap="round" />
                <path d="M 18 65 Q 50 92 82 60" stroke="url(#sidebarGrad)" strokeWidth="9" fill="none" strokeLinecap="round" />
              </svg>
            </div>
            <div className="brand-text">
              <h2>TRDTECH</h2>
              <p>ML Dashboard</p>
            </div>
          </div>
          <button
            className="close-btn"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>
        <nav>
          {items.map((item) => {
            const activo = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${activo ? 'activo' : ''}`}
              >
                <span className="link-icon">{item.icon}</span>
                <span className="link-label">{item.label}</span>
                {item.soon && <span className="badge-soon">Pronto</span>}
              </Link>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <span>🔒</span>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <style>{`
        .hamburger {
          display: none;
          position: fixed;
          top: 12px;
          left: 12px;
          z-index: 90;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          width: 44px;
          height: 44px;
          font-size: 22px;
          color: var(--text-primary);
          cursor: pointer;
          box-shadow: var(--shadow-card);
        }
        .overlay {
          display: none;
        }
        .sidebar {
          width: 240px;
          background: linear-gradient(180deg, #0a121c 0%, #050a14 100%);
          color: var(--text-primary);
          min-height: 100vh;
          padding: 20px 0 0;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-subtle);
        }
        .sidebar-header {
          padding: 0 20px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .brand-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-mark {
          width: 36px;
          height: 36px;
          flex-shrink: 0;
          filter: drop-shadow(0 0 8px rgba(62, 229, 224, 0.4));
        }
        .brand-mark svg {
          width: 100%;
          height: 100%;
        }
        .brand-text h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 1.5px;
          background: linear-gradient(135deg, #ffffff 0%, #3ee5e0 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .brand-text p {
          margin: 2px 0 0;
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }
        .close-btn {
          display: none;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
        }
        .sidebar nav {
          margin-top: 20px;
          flex: 1;
          padding: 0 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sidebar-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 11px 14px;
          color: var(--text-muted);
          background-color: transparent;
          border-radius: 10px;
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.15s ease;
          position: relative;
        }
        .sidebar-link:hover {
          background-color: rgba(62, 229, 224, 0.06);
          color: var(--text-secondary);
        }
        .sidebar-link.activo {
          color: var(--text-primary);
          background: linear-gradient(135deg, rgba(62, 229, 224, 0.15) 0%, rgba(28, 160, 196, 0.08) 100%);
          font-weight: 600;
        }
        .sidebar-link.activo::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 60%;
          background: var(--accent);
          border-radius: 0 3px 3px 0;
          box-shadow: 0 0 8px var(--accent-glow);
        }
        .link-icon {
          font-size: 16px;
          width: 20px;
          text-align: center;
        }
        .link-label {
          flex: 1;
        }
        .badge-soon {
          font-size: 9px;
          background: var(--bg-elevated);
          color: var(--text-muted);
          padding: 3px 8px;
          border-radius: 8px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          border: 1px solid var(--border-subtle);
        }
        .sidebar-footer {
          padding: 16px 20px 20px;
          border-top: 1px solid var(--border-subtle);
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          background: transparent;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 13px;
          font-family: inherit;
          font-weight: 500;
          cursor: pointer;
          width: 100%;
          transition: all 0.15s ease;
        }
        .logout-btn:hover {
          color: var(--danger);
          border-color: rgba(255, 71, 87, 0.4);
          background: rgba(255, 71, 87, 0.05);
        }

        @media (max-width: 768px) {
          .hamburger {
            display: block;
          }
          .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            z-index: 100;
            min-height: 0;
          }
          .sidebar-open {
            transform: translateX(0);
          }
          .overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            z-index: 99;
          }
          .close-btn {
            display: block;
          }
        }
      `}</style>
    </>
  )
}