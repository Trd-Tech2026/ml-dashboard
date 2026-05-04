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

  // No mostrar el sidebar en /login
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
          <div>
            <h2>ML Dashboard</h2>
            <p>TRDTECH</p>
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
                <span>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
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
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          width: 44px;
          height: 44px;
          font-size: 22px;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .overlay {
          display: none;
        }
        .sidebar {
          width: 240px;
          background-color: #1a1a1a;
          color: white;
          min-height: 100vh;
          padding: 24px 0;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
        }
        .sidebar-header {
          padding: 0 24px 24px;
          border-bottom: 1px solid #333;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
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
        .close-btn {
          display: none;
          background: transparent;
          border: none;
          color: white;
          font-size: 22px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
        }
        .sidebar nav {
          margin-top: 16px;
          flex: 1;
        }
        .sidebar-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 24px;
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
        .badge-soon {
          font-size: 10px;
          background: #444;
          color: #ccc;
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: normal;
          letter-spacing: 0.5px;
        }
        .sidebar-footer {
          padding: 16px 24px;
          border-top: 1px solid #333;
        }
        .logout-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          background: transparent;
          color: #888;
          border: 1px solid #333;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          width: 100%;
          transition: all 0.15s ease;
        }
        .logout-btn:hover {
          color: #f44336;
          border-color: #f44336;
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
            background: rgba(0, 0, 0, 0.5);
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