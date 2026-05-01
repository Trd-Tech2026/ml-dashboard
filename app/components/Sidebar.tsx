'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

export default function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Cerrar el menú cuando cambia la ruta
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Bloquear scroll del body cuando el menú mobile está abierto
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
  { href: '/stock', label: 'Stock', icon: '📦', soon: true },
  { href: '/rentabilidad', label: 'Rentabilidad', icon: '💰', soon: true },
]

  // Una ruta está activa si coincide exacto, o si la actual empieza con esa ruta
  // (ej: /ventas/hoy debería marcar "Ventas hoy" como activo).
  // Excepción: la home "/" solo se marca si el pathname es exactamente "/".
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <>
      {/* Botón hamburguesa (solo mobile) */}
      <button
        className="hamburger"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
      >
        ☰
      </button>

      {/* Overlay oscuro detrás del menú abierto */}
      {open && <div className="overlay" onClick={() => setOpen(false)} />}

      {/* Sidebar (siempre visible en desktop, deslizable en mobile) */}
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
