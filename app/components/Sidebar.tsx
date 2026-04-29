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
    <aside style={{
      width: '240px',
      backgroundColor: '#1a1a1a',
      color: 'white',
      minHeight: '100vh',
      padding: '24px 0',
      flexShrink: 0,
    }}>
      <div style={{ padding: '0 24px 24px', borderBottom: '1px solid #333' }}>
        <h2 style={{ margin: 0, fontSize: '18px', color: 'white' }}>ML Dashboard</h2>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
          TRDTECH
        </p>
      </div>

      <nav style={{ marginTop: '16px' }}>
        {items.map((item) => {
          const activo = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 24px',
                color: activo ? 'white' : '#aaa',
                backgroundColor: activo ? '#2a2a2a' : 'transparent',
                borderLeft: activo ? '3px solid #4CAF50' : '3px solid transparent',
                textDecoration: 'none',
                fontSize: '15px',
                fontWeight: activo ? 'bold' : 'normal',
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}