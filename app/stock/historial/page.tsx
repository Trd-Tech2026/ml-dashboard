'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import StockTabs from '../../components/StockTabs'

type Supplier = {
  id: number
  name: string
  cuit: string | null
}

type PurchaseOrder = {
  id: number
  invoice_number: string | null
  invoice_date: string | null
  total_amount: number | null
  status: 'pending' | 'confirmed' | 'cancelled'
  confirmed_at: string | null
  created_at: string
  supplier: Supplier | null
  items_count: number
}

type CancelResult = {
  ok: boolean
  items_reverted?: number
  items_failed?: number
  results?: Array<{ sku: string; before: number; after: number; success: boolean; error?: string }>
  error?: string
}

export default function HistorialPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [cancellingId, setCancellingId] = useState<number | null>(null)
  const [cancelResult, setCancelResult] = useState<CancelResult | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'confirmed' | 'cancelled'>('all')

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/purchases/list', { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error al cargar')
        return
      }
      setOrders(json.orders ?? [])
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const handleCancel = async (order: PurchaseOrder) => {
    const confirmed = window.confirm(
      `¿Anular esta factura?\n\n` +
      `Proveedor: ${order.supplier?.name ?? '—'}\n` +
      `Factura: ${order.invoice_number ?? '—'}\n` +
      `Productos: ${order.items_count}\n\n` +
      `Se va a RESTAR el stock que sumó esta factura.\n` +
      `Esta acción no se puede deshacer.`
    )
    if (!confirmed) return

    setCancellingId(order.id)
    setCancelResult(null)
    setError(null)

    try {
      const res = await fetch('/api/purchases/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_order_id: order.id }),
      })
      const json: CancelResult = await res.json()

      if (!json.ok) {
        setError(json.error ?? 'Error al anular')
        return
      }

      setCancelResult(json)
      await fetchOrders()
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setCancellingId(null)
    }
  }

  const formatARS = (n: number | null) => {
    if (n == null) return '—'
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n)
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const formatDateTime = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const filteredOrders = orders.filter(o => {
    if (filterStatus === 'all') return true
    return o.status === filterStatus
  })

  const totalConfirmed = orders.filter(o => o.status === 'confirmed').length
  const totalCancelled = orders.filter(o => o.status === 'cancelled').length
  const totalAmountConfirmed = orders
    .filter(o => o.status === 'confirmed')
    .reduce((acc, o) => acc + (o.total_amount ?? 0), 0)

  return (
    <div className="page">
      <StockTabs />

      <div className="header">
        <h1>📋 Historial de ingresos</h1>
        <p className="subtitle">Listado de todas las facturas de compra cargadas. Podés anular ingresos para revertir el stock.</p>
      </div>

      <div className="kpis">
        <div className="kpi" style={{ '--kpi-c': 'var(--info)' } as any}>
          <div className="kpi-label">Total ingresos</div>
          <div className="kpi-value">{orders.length}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--success)' } as any}>
          <div className="kpi-label">Confirmados</div>
          <div className="kpi-value">{totalConfirmed}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--danger)' } as any}>
          <div className="kpi-label">Anulados</div>
          <div className="kpi-value">{totalCancelled}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--accent)' } as any}>
          <div className="kpi-label">Compras confirmadas</div>
          <div className="kpi-value-small">{formatARS(totalAmountConfirmed)}</div>
        </div>
      </div>

      <div className="filtros">
        <div className="filter-tabs">
          <button
            className={`tab-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            Todos ({orders.length})
          </button>
          <button
            className={`tab-btn ${filterStatus === 'confirmed' ? 'active' : ''}`}
            onClick={() => setFilterStatus('confirmed')}
          >
            Confirmados ({totalConfirmed})
          </button>
          <button
            className={`tab-btn ${filterStatus === 'cancelled' ? 'active' : ''}`}
            onClick={() => setFilterStatus('cancelled')}
          >
            Anulados ({totalCancelled})
          </button>
        </div>
        <button className="btn-refresh-mini" onClick={fetchOrders} disabled={loading}>
          {loading ? '⏳' : '⟳'} Actualizar
        </button>
      </div>

      {cancelResult && (
        <div className="result-banner success">
          ✅ <strong>Ingreso anulado.</strong> Se revirtió el stock de {cancelResult.items_reverted} producto(s)
          {cancelResult.items_failed && cancelResult.items_failed > 0 ? `. ${cancelResult.items_failed} fallaron.` : '.'}
          <button className="btn-close-result" onClick={() => setCancelResult(null)}>✕</button>
        </div>
      )}

      {error && (
        <div className="result-banner error">
          ⚠️ <strong>Error:</strong> {error}
          <button className="btn-close-result" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="empty">Cargando...</div>
      ) : filteredOrders.length === 0 ? (
        <div className="empty">
          <p>No hay {filterStatus === 'all' ? 'ingresos' : filterStatus === 'confirmed' ? 'ingresos confirmados' : 'ingresos anulados'} cargados aún.</p>
          {filterStatus === 'all' && (
            <button className="btn-primary" onClick={() => router.push('/stock/ingresos')}>
              📦 Cargar primera factura
            </button>
          )}
        </div>
      ) : (
        <div className="orders-list">
          {filteredOrders.map(order => (
            <div key={order.id} className={`order-card status-${order.status}`}>
              <div className="order-main">
                <div className="order-info">
                  <div className="order-line-1">
                    <span className="order-supplier">{order.supplier?.name ?? '—'}</span>
                    <span className={`status-badge status-${order.status}`}>
                      {order.status === 'confirmed' ? '✓ Confirmado' : order.status === 'cancelled' ? '✗ Anulado' : '⏳ Pendiente'}
                    </span>
                  </div>
                  <div className="order-line-2">
                    <span className="order-invoice">Factura {order.invoice_number ?? '—'}</span>
                    {order.supplier?.cuit && <span className="muted"> · CUIT {order.supplier.cuit}</span>}
                  </div>
                  <div className="order-line-3">
                    <span className="muted">Fecha factura:</span> {formatDate(order.invoice_date)}
                    <span className="separator">·</span>
                    <span className="muted">Cargado:</span> {formatDateTime(order.created_at)}
                    <span className="separator">·</span>
                    <span className="muted">Productos:</span> <strong>{order.items_count}</strong>
                  </div>
                </div>

                <div className="order-amount">
                  <div className="amount-label">Total factura</div>
                  <div className="amount-value">{formatARS(order.total_amount)}</div>
                </div>

                <div className="order-actions">
                  {order.status === 'confirmed' ? (
                    <button
                      className="btn-cancel"
                      onClick={() => handleCancel(order)}
                      disabled={cancellingId === order.id}
                    >
                      {cancellingId === order.id ? '⏳ Anulando...' : '↩️ Anular'}
                    </button>
                  ) : (
                    <span className="cancelled-text">No se puede anular</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .page { padding: 24px 40px 48px; max-width: 1200px; margin: 0 auto; }
        .header { margin-bottom: 24px; }
        .header h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; color: var(--text-primary); }
        .subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }

        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
        .kpi { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px 18px; position: relative; overflow: hidden; }
        .kpi::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--kpi-c); opacity: 0.7; }
        .kpi-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .kpi-value { font-size: 22px; font-weight: 700; color: var(--text-primary); }
        .kpi-value-small { font-size: 16px; font-weight: 700; color: var(--text-primary); }

        .filtros { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .filter-tabs { display: flex; gap: 6px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 4px; }
        .tab-btn { background: transparent; color: var(--text-muted); border: none; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .tab-btn:hover { color: var(--text-primary); }
        .tab-btn.active { background: rgba(62, 229, 224, 0.12); color: var(--accent); }
        .btn-refresh-mini { background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border-subtle); padding: 9px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .btn-refresh-mini:hover:not(:disabled) { color: var(--accent); border-color: var(--border-medium); }
        .btn-refresh-mini:disabled { opacity: 0.5; cursor: not-allowed; }

        .result-banner { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; }
        .result-banner.success { background: rgba(62, 229, 224, 0.08); border: 1px solid var(--border-medium); color: var(--text-secondary); }
        .result-banner.success strong { color: var(--accent); }
        .result-banner.error { background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3); color: var(--danger); }
        .btn-close-result { margin-left: auto; background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-family: inherit; flex-shrink: 0; }

        .empty { background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 60px 24px; text-align: center; border-radius: 12px; color: var(--text-muted); display: flex; flex-direction: column; align-items: center; gap: 16px; }
        .btn-primary { background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%); color: var(--bg-base); border: none; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }

        .orders-list { display: flex; flex-direction: column; gap: 10px; }
        .order-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px 18px; transition: all 0.15s ease; }
        .order-card.status-confirmed { border-left: 3px solid var(--success); }
        .order-card.status-cancelled { border-left: 3px solid var(--danger); opacity: 0.7; }
        .order-card.status-pending { border-left: 3px solid var(--warning); }

        .order-main { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
        .order-info { flex: 1; min-width: 250px; }
        .order-line-1 { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
        .order-supplier { font-size: 15px; font-weight: 600; color: var(--text-primary); }
        .order-line-2 { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
        .order-invoice { font-family: monospace; }
        .order-line-3 { font-size: 11px; color: var(--text-secondary); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
        .order-line-3 strong { color: var(--text-primary); }
        .muted { color: var(--text-muted); }
        .separator { color: var(--border-subtle); margin: 0 4px; }

        .order-amount { text-align: right; min-width: 140px; }
        .amount-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; margin-bottom: 4px; }
        .amount-value { font-size: 16px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }

        .order-actions { display: flex; align-items: center; }
        .btn-cancel { background: transparent; color: var(--danger); border: 1px solid rgba(255, 71, 87, 0.3); padding: 9px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s ease; }
        .btn-cancel:hover:not(:disabled) { background: rgba(255, 71, 87, 0.08); border-color: var(--danger); }
        .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
        .cancelled-text { font-size: 11px; color: var(--text-dim); font-style: italic; }

        .status-badge { padding: 3px 10px; border-radius: 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
        .status-badge.status-confirmed { background: rgba(62, 229, 224, 0.12); color: var(--accent); border: 1px solid var(--border-medium); }
        .status-badge.status-cancelled { background: rgba(255, 71, 87, 0.12); color: var(--danger); border: 1px solid rgba(255, 71, 87, 0.3); }
        .status-badge.status-pending { background: rgba(255, 167, 38, 0.12); color: var(--warning); border: 1px solid rgba(255, 167, 38, 0.3); }

        @media (max-width: 768px) {
          .page { padding: 16px; }
          .header h1 { font-size: 20px; }
          .kpis { grid-template-columns: repeat(2, 1fr); }
          .kpi-value { font-size: 18px; }
          .kpi-value-small { font-size: 14px; }
          .filtros { flex-direction: column; align-items: stretch; }
          .filter-tabs { overflow-x: auto; }
          .order-main { flex-direction: column; align-items: flex-start; gap: 12px; }
          .order-amount { text-align: left; min-width: 0; }
          .order-actions { width: 100%; }
          .btn-cancel { width: 100%; text-align: center; }
        }
      `}</style>
    </div>
  )
}
