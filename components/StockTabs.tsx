'use client'

import { Suspense } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'

type TabKey = 'productos' | 'combos' | 'facturas' | 'historial' | 'masivo'

function StockTabsInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  const tab = searchParams.get('tab') || 'productos'

  let activeTab: TabKey = 'productos'
  if (pathname === '/stock/ingresos') activeTab = 'facturas'
  else if (pathname === '/stock/historial') activeTab = 'historial'
  else if (pathname === '/stock/cargador-masivo') activeTab = 'masivo'
  else if (pathname === '/stock' && tab === 'combos') activeTab = 'combos'
  else activeTab = 'productos'

  return (
    <div className="tabs-header">
      <button
        className={`tab ${activeTab === 'productos' ? 'tab-active' : ''}`}
        onClick={() => router.push('/stock')}
      >
        Productos
      </button>
      <button
        className={`tab ${activeTab === 'combos' ? 'tab-active' : ''}`}
        onClick={() => router.push('/stock?tab=combos')}
      >
        Combos
      </button>
      <button
        className={`tab ${activeTab === 'facturas' ? 'tab-active' : ''}`}
        onClick={() => router.push('/stock/ingresos')}
      >
        Cargar factura
      </button>
      <button
        className={`tab ${activeTab === 'historial' ? 'tab-active' : ''}`}
        onClick={() => router.push('/stock/historial')}
      >
        Historial
      </button>
      <button
        className={`tab ${activeTab === 'masivo' ? 'tab-active' : ''}`}
        onClick={() => router.push('/stock/cargador-masivo')}
      >
        📥 Cargador masivo
      </button>

      <style jsx>{`
        .tabs-header {
          display: flex;
          gap: 4px;
          border-bottom: 1px solid var(--border-subtle);
          margin-bottom: 24px;
          flex-wrap: wrap;
        }
        .tab {
          background: transparent;
          border: none;
          padding: 12px 20px;
          color: var(--text-muted);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .tab:hover { color: var(--text-secondary); }
        .tab.tab-active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }
        @media (max-width: 600px) {
          .tab { padding: 10px 14px; font-size: 13px; }
        }
      `}</style>
    </div>
  )
}

export default function StockTabs() {
  return (
    <Suspense fallback={<div style={{ height: 45, marginBottom: 24, borderBottom: '1px solid var(--border-subtle)' }} />}>
      <StockTabsInner />
    </Suspense>
  )
}
