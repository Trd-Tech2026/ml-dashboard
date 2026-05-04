'use client'

import { useEffect, useState, useCallback } from 'react'

// ===== Tipos =====
type Item = {
  item_id: string
  title: string
  thumbnail: string | null
  permalink: string | null
  available_quantity: number
  sold_quantity: number
  price: number
  currency: string
  status: string
  logistic_type: string | null
  free_shipping: boolean
  shipping_tags: string[]
  is_flex: boolean
  seller_sku: string | null
  last_updated: string | null
  archived: boolean
}

type Kpis = {
  total: number
  sin_stock: number
  critico: number
  stock_total: number
  archived_count: number
}

type SyncState = {
  last_sync_at: string | null
  total_items: number
} | null

type ApiResponse = {
  ok: boolean
  items: Item[]
  page: number
  pageSize: number
  totalFiltered: number
  archivedView: string
  kpis: Kpis
  sync_state: SyncState
}

// ===== Helpers =====
function formatearPrecio(price: number, currency: string) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 0,
  }).format(price)
}

function formatearFecha(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

function logisticLabel(type: string | null): string {
  switch (type) {
    case 'self_service': return 'Flex'
    case 'fulfillment': return 'Full'
    case 'cross_docking': return 'Colecta'
    case 'drop_off': return 'A domicilio'
    case 'default': return 'Sin ME'
    case null:
    case undefined: return 'Sin envío'
    default: return type
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Activa'
    case 'paused': return 'Pausada'
    case 'closed': return 'Finalizada'
    case 'under_review': return 'En revisión'
    default: return status
  }
}

function stockClass(qty: number): string {
  if (qty === 0) return 'stock-zero'
  if (qty < 5) return 'stock-low'
  return ''
}

// ===== Componente =====
export default function StockPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [archivando, setArchivando] = useState(false)

  // Filtros
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [status, setStatus] = useState('all')
  const [logistic, setLogistic] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [sort, setSort] = useState('stock_desc')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 50

  const [selected, setSelected] = useState<Set<string>>(new Set())

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      search,
      status,
      logistic,
      stock: stockFilter,
      sort,
      archived: showArchived ? 'true' : 'false',
      page: String(page),
      pageSize: String(pageSize),
    })
    try {
      const res = await fetch(`/api/stock/list?${params.toString()}`, { cache: 'no-store' })
      const json: ApiResponse = await res.json()
      setData(json)
    } catch (err) {
      console.error('Error fetch stock:', err)
    } finally {
      setLoading(false)
    }
  }, [search, status, logistic, stockFilter, sort, showArchived, page])

  useEffect(() => { fetchItems() }, [fetchItems])
  useEffect(() => { setPage(1) }, [search, status, logistic, stockFilter, sort, showArchived])
  useEffect(() => { setSelected(new Set()) }, [showArchived])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  const handleRefresh = async () => {
    setRefrescando(true)
    try {
      const res = await fetch('/api/sync-items', { cache: 'no-store' })
      const json = await res.json()
      console.log('Sync result:', json)
      await fetchItems()
    } catch (err) {
      console.error('Error refrescando:', err)
    } finally {
      setRefrescando(false)
    }
  }

  const toggleSelect = (itemId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const selectAllInPage = () => {
    const pageIds = (data?.items ?? []).map(i => i.item_id)
    const todosSeleccionados = pageIds.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (todosSeleccionados) {
        pageIds.forEach(id => next.delete(id))
      } else {
        pageIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const handleArchive = async (archive: boolean) => {
    if (selected.size === 0) return
    const action = archive ? 'archivar' : 'desarchivar'
    const confirmed = window.confirm(
      `¿${action.charAt(0).toUpperCase() + action.slice(1)} ${selected.size} publicación${selected.size === 1 ? '' : 'es'}?`
    )
    if (!confirmed) return

    setArchivando(true)
    try {
      const res = await fetch('/api/stock/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_ids: Array.from(selected),
          archived: archive,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        alert(`Error: ${json.error ?? 'desconocido'}`)
        return
      }
      setSelected(new Set())
      await fetchItems()
    } catch (err) {
      console.error(`Error al ${action}:`, err)
      alert(`Error al ${action}`)
    } finally {
      setArchivando(false)
    }
  }

  const kpis = data?.kpis ?? { total: 0, sin_stock: 0, critico: 0, stock_total: 0, archived_count: 0 }
  const items = data?.items ?? []
  const totalFiltered = data?.totalFiltered ?? 0
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))

  const todosEnPaginaSeleccionados = items.length > 0 && items.every(i => selected.has(i.item_id))

  return (
    <div className="stock-page">
      {/* HEADER */}
      <div className="header">
        <div>
          <h1>{showArchived ? '🗄️ Stock archivado' : 'Stock'}</h1>
          <p className="subtitle">
            {data?.sync_state?.last_sync_at
              ? `Última sincronización: ${formatearFecha(data.sync_state.last_sync_at)}`
              : 'Sin sincronizaciones aún'}
          </p>
        </div>
        <button className="btn-refresh" onClick={handleRefresh} disabled={refrescando}>
          <span>{refrescando ? '⏳' : '⟳'}</span>
          <span>{refrescando ? 'Sincronizando...' : 'Actualizar stock'}</span>
        </button>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi" style={{ '--kpi-c': 'var(--info)' } as any}>
          <div className="kpi-label">Publicaciones</div>
          <div className="kpi-value">{kpis.total.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--success)' } as any}>
          <div className="kpi-label">Stock total</div>
          <div className="kpi-value">{kpis.stock_total.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--warning)' } as any}>
          <div className="kpi-label">Stock crítico (&lt;5)</div>
          <div className="kpi-value">{kpis.critico.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--danger)' } as any}>
          <div className="kpi-label">Sin stock</div>
          <div className="kpi-value">{kpis.sin_stock.toLocaleString('es-AR')}</div>
        </div>
      </div>

      {/* Toggle archivadas */}
      <div className="archived-toggle">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          <span>Mostrar archivadas {kpis.archived_count > 0 && `(${kpis.archived_count})`}</span>
        </label>
      </div>

      {/* BARRA DE ACCIÓN */}
      {selected.size > 0 && (
        <div className="action-bar">
          <span className="action-text">
            <strong>{selected.size}</strong> seleccionada{selected.size === 1 ? '' : 's'}
          </span>
          <button className="btn-action" onClick={() => handleArchive(!showArchived)} disabled={archivando}>
            {archivando
              ? '⏳ Procesando...'
              : showArchived
                ? '↩️ Desarchivar seleccionadas'
                : '🗄️ Archivar seleccionadas'}
          </button>
          <button className="btn-clear-sel" onClick={clearSelection}>Limpiar</button>
        </div>
      )}

      {/* FILTROS */}
      <div className="filtros">
        <form onSubmit={handleSearchSubmit} className="search-form">
          <input
            type="text"
            placeholder="Buscar por título o SKU..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="btn-search">Buscar</button>
          {search && (
            <button
              type="button"
              className="btn-clear"
              onClick={() => { setSearchInput(''); setSearch('') }}
            >
              ✕
            </button>
          )}
        </form>

        <div className="dropdowns">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="paused">Pausadas</option>
            <option value="closed">Finalizadas</option>
          </select>

          <select value={logistic} onChange={(e) => setLogistic(e.target.value)}>
            <option value="all">Todo envío</option>
            <option value="flex">Flex (incluye coexistencia)</option>
            <option value="fulfillment">Full</option>
            <option value="cross_docking">Colecta</option>
            <option value="drop_off">A domicilio</option>
            <option value="default">Sin Mercado Envíos</option>
            <option value="null">Sin envío</option>
          </select>

          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
            <option value="all">Todo stock</option>
            <option value="zero">Sin stock (0)</option>
            <option value="critical">Crítico (1-4)</option>
            <option value="normal">Normal (5+)</option>
          </select>

          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="stock_desc">Más stock primero</option>
            <option value="stock_asc">Menos stock primero</option>
            <option value="sold_desc">Más vendidos</option>
            <option value="title_asc">Alfabético</option>
            <option value="recent">Recientes primero</option>
          </select>
        </div>
      </div>

      {/* CONTADOR */}
      <div className="counter">
        {loading
          ? 'Cargando...'
          : `Mostrando ${items.length} de ${totalFiltered.toLocaleString('es-AR')} publicaciones${showArchived ? ' archivadas' : ''}`
        }
      </div>

      {/* TABLA (desktop) */}
      <div className="tabla-wrapper">
        <table className="tabla">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={todosEnPaginaSeleccionados}
                  onChange={selectAllInPage}
                  aria-label="Seleccionar todos"
                />
              </th>
              <th>Foto</th>
              <th>Título / SKU</th>
              <th>Stock</th>
              <th>Vendidos</th>
              <th>Precio</th>
              <th>Envío</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isSelected = selected.has(item.item_id)
              return (
                <tr
                  key={item.item_id}
                  className={`${stockClass(item.available_quantity)} ${isSelected ? 'fila-selected' : ''}`}
                >
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.item_id)}
                    />
                  </td>
                  <td>
                    {item.thumbnail
                      ? <img src={item.thumbnail.replace('http://', 'https://')} alt="" className="thumb" />
                      : <div className="thumb-placeholder">📦</div>
                    }
                  </td>
                  <td className="td-title">
                    <div className="title-text">{item.title}</div>
                    {item.seller_sku && <div className="sku">SKU: {item.seller_sku}</div>}
                  </td>
                  <td className="td-stock"><strong>{item.available_quantity}</strong></td>
                  <td className="td-num">{item.sold_quantity}</td>
                  <td className="td-num">{formatearPrecio(item.price, item.currency)}</td>
                  <td>
                    <div className="logistic-badges">
                      <span className={`logistic-badge logistic-${item.logistic_type ?? 'none'}`}>
                        {logisticLabel(item.logistic_type)}
                      </span>
                      {item.free_shipping && <span className="logistic-badge logistic-free">🆓</span>}
                    </div>
                  </td>
                  <td>
                    <div className="logistic-badges">
                      <span className={`logistic-badge logistic-${item.logistic_type ?? 'none'}`}>
                        {logisticLabel(item.logistic_type)}
                      </span>
                      {item.is_flex && item.logistic_type !== 'self_service' && (
                        <span className="logistic-badge logistic-flex">⚡ Flex</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {item.permalink && (
                      <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="btn-ver">
                        Ver →
                      </a>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* CARDS (mobile) */}
      <div className="cards-mobile">
        {items.map((item) => {
          const isSelected = selected.has(item.item_id)
          return (
            <div
              key={item.item_id}
              className={`card-item ${stockClass(item.available_quantity)} ${isSelected ? 'card-selected' : ''}`}
            >
              <div className="card-top">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(item.item_id)}
                  className="card-checkbox"
                />
                {item.thumbnail
                  ? <img src={item.thumbnail.replace('http://', 'https://')} alt="" className="thumb" />
                  : <div className="thumb-placeholder">📦</div>
                }
                <div className="card-info">
                  <div className="card-title">{item.title}</div>
                  {item.seller_sku && <div className="sku">SKU: {item.seller_sku}</div>}
                </div>
              </div>
              <div className="card-stats">
                <div><span className="stat-label">Stock</span> <strong>{item.available_quantity}</strong></div>
                <div><span className="stat-label">Vendidos</span> {item.sold_quantity}</div>
                <div><span className="stat-label">Precio</span> {formatearPrecio(item.price, item.currency)}</div>
              </div>
              <div className="card-bottom">
                <span className={`logistic-badge logistic-${item.logistic_type ?? 'none'}`}>
                  {logisticLabel(item.logistic_type)}
                </span>
                {item.is_flex && item.logistic_type !== 'self_service' && (
                  <span className="logistic-badge logistic-flex">⚡ Flex</span>
                )}
                {item.free_shipping && <span className="logistic-badge logistic-free">🆓</span>}
                <span className={`status-badge status-${item.status}`}>{statusLabel(item.status)}</span>
                {item.permalink && (
                  <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="btn-ver">Ver →</a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* PAGINACIÓN */}
      {totalPages > 1 && (
        <div className="paginacion">
          <button onClick={() => setPage(1)} disabled={page === 1}>«</button>
          <button onClick={() => setPage(page - 1)} disabled={page === 1}>‹</button>
          <span>Página {page} de {totalPages}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= totalPages}>›</button>
          <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</button>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="empty">
          <p>{showArchived ? 'No hay publicaciones archivadas con esos filtros.' : 'No se encontraron publicaciones con esos filtros.'}</p>
        </div>
      )}

      <style>{`
        .stock-page {
          padding: 32px 40px 48px;
          max-width: 1400px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
          gap: 16px;
        }
        .header h1 {
          margin: 0 0 4px;
          font-size: 26px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .subtitle {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
        }
        .btn-refresh {
          display: flex;
          align-items: center;
          gap: 8px;
          background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%);
          color: var(--bg-base);
          border: none;
          padding: 11px 18px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25);
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .btn-refresh:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4);
        }
        .btn-refresh:disabled { opacity: 0.6; cursor: not-allowed; }

        /* KPIs */
        .kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }
        .kpi {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 16px 18px;
          position: relative;
          overflow: hidden;
        }
        .kpi::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          background: var(--kpi-c);
          opacity: 0.7;
        }
        .kpi-label {
          font-size: 11px;
          color: var(--text-muted);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .kpi-value {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Toggle archivadas */
        .archived-toggle {
          margin-bottom: 14px;
        }
        .toggle-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          padding: 8px 14px;
          border-radius: 10px;
          font-size: 13px;
          color: var(--text-secondary);
          cursor: pointer;
          user-select: none;
          transition: border-color 0.15s ease;
        }
        .toggle-label:hover { border-color: var(--border-medium); }
        .toggle-label input { cursor: pointer; accent-color: var(--accent); }

        /* Action bar */
        .action-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          background: linear-gradient(135deg, rgba(62, 229, 224, 0.12) 0%, rgba(28, 160, 196, 0.08) 100%);
          color: var(--text-primary);
          border: 1px solid var(--border-medium);
          padding: 12px 16px;
          border-radius: 10px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .action-text { flex: 1; font-size: 14px; }
        .btn-action {
          background: var(--warning);
          color: var(--bg-base);
          border: none;
          padding: 9px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .btn-action:hover:not(:disabled) { filter: brightness(1.1); }
        .btn-action:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-clear-sel {
          background: transparent;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
        }
        .btn-clear-sel:hover {
          color: var(--text-primary);
          border-color: var(--border-medium);
        }

        /* Filtros */
        .filtros {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          padding: 16px;
          border-radius: 12px;
          margin-bottom: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .search-form { display: flex; gap: 8px; }
        .search-input {
          flex: 1;
          padding: 10px 14px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          font-size: 14px;
          color: var(--text-primary);
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .search-input::placeholder { color: var(--text-muted); }
        .search-input:focus { border-color: var(--accent); }
        .btn-search {
          background: var(--accent);
          color: var(--bg-base);
          border: none;
          padding: 10px 18px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        .btn-search:hover { background: var(--accent-hover); }
        .btn-clear {
          background: var(--bg-elevated);
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          padding: 10px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-family: inherit;
        }
        .dropdowns { display: flex; gap: 8px; flex-wrap: wrap; }
        .dropdowns select {
          padding: 9px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
          font-family: inherit;
          min-width: 150px;
          outline: none;
        }
        .dropdowns select:focus { border-color: var(--accent); }
        .dropdowns select option {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }

        .counter {
          font-size: 13px;
          color: var(--text-muted);
          margin-bottom: 12px;
        }

        /* Tabla */
        .tabla-wrapper {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          overflow: hidden;
          overflow-x: auto;
        }
        .tabla {
          width: 100%;
          border-collapse: collapse;
        }
        .tabla th {
          background: var(--bg-elevated);
          padding: 12px 16px;
          text-align: left;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.6px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .tabla td {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-subtle);
          font-size: 13px;
          color: var(--text-secondary);
          vertical-align: middle;
        }
        .tabla tr:last-child td { border-bottom: none; }
        .tabla tr.stock-zero { background: rgba(255, 71, 87, 0.06); }
        .tabla tr.stock-zero .td-stock strong { color: var(--danger); }
        .tabla tr.stock-low { background: rgba(255, 167, 38, 0.05); }
        .tabla tr.stock-low .td-stock strong { color: var(--warning); }
        .tabla tr.fila-selected { background: rgba(62, 229, 224, 0.08) !important; }

        .col-check { width: 36px; text-align: center; }
        .col-check input {
          cursor: pointer;
          transform: scale(1.2);
          accent-color: var(--accent);
        }

        .thumb {
          width: 44px; height: 44px;
          object-fit: cover;
          border-radius: 6px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
        }
        .thumb-placeholder {
          width: 44px; height: 44px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }

        .td-title { max-width: 380px; }
        .title-text {
          font-weight: 500;
          color: var(--text-primary);
          line-height: 1.3;
        }
        .sku {
          font-size: 11px;
          color: var(--text-muted);
          font-family: monospace;
          margin-top: 2px;
        }
        .td-stock strong {
          font-size: 15px;
          color: var(--text-primary);
        }
        .td-num {
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }

        .logistic-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .logistic-badge {
          display: inline-block;
          padding: 3px 8px;
          background: var(--bg-elevated);
          color: var(--text-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
        }
        .logistic-flex {
          background: rgba(255, 167, 38, 0.12);
          color: var(--warning);
          border-color: rgba(255, 167, 38, 0.3);
        }
        .logistic-self_service {
          background: rgba(255, 167, 38, 0.12);
          color: var(--warning);
          border-color: rgba(255, 167, 38, 0.3);
        }
        .logistic-fulfillment {
          background: rgba(62, 229, 224, 0.12);
          color: var(--accent);
          border-color: var(--border-medium);
        }
        .logistic-cross_docking {
          background: rgba(28, 160, 196, 0.15);
          color: var(--accent-secondary);
          border-color: rgba(28, 160, 196, 0.3);
        }
        .logistic-drop_off {
          background: rgba(28, 160, 196, 0.1);
          color: var(--text-secondary);
          border-color: var(--border-subtle);
        }
        .logistic-free {
          background: rgba(62, 229, 224, 0.1);
          color: var(--accent);
          border-color: var(--border-medium);
        }

        .status-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .status-active {
          background: rgba(62, 229, 224, 0.15);
          color: var(--accent);
          border: 1px solid var(--border-medium);
        }
        .status-paused {
          background: rgba(255, 167, 38, 0.15);
          color: var(--warning);
          border: 1px solid rgba(255, 167, 38, 0.3);
        }
        .status-closed {
          background: var(--bg-elevated);
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
        }
        .status-under_review {
          background: rgba(28, 160, 196, 0.15);
          color: var(--accent-secondary);
          border: 1px solid rgba(28, 160, 196, 0.3);
        }

        .btn-ver {
          color: var(--accent);
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          transition: opacity 0.15s ease;
        }
        .btn-ver:hover { opacity: 0.7; }

        /* Cards mobile */
        .cards-mobile { display: none; }

        /* Paginación */
        .paginacion {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          margin-top: 24px;
        }
        .paginacion button {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-family: inherit;
        }
        .paginacion button:hover:not(:disabled) {
          background: var(--bg-card-hover);
          border-color: var(--border-medium);
        }
        .paginacion button:disabled { opacity: 0.4; cursor: not-allowed; }
        .paginacion span {
          font-size: 13px;
          color: var(--text-muted);
          padding: 0 12px;
        }

        .empty {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          padding: 48px;
          text-align: center;
          border-radius: 12px;
          color: var(--text-muted);
          margin-top: 16px;
        }

        /* MOBILE */
        @media (max-width: 768px) {
          .stock-page { padding: 16px; }
          .header {
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
          }
          .header h1 { font-size: 22px; }
          .btn-refresh { width: 100%; justify-content: center; }

          .kpis { grid-template-columns: repeat(2, 1fr); }
          .kpi-value { font-size: 18px; }

          .action-bar {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }
          .action-bar > * { width: 100%; text-align: center; }

          .dropdowns select { flex: 1; min-width: 0; }

          .tabla-wrapper { display: none; }
          .cards-mobile {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .card-item {
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            padding: 14px;
            border-radius: 12px;
          }
          .card-item.stock-zero { border-color: rgba(255, 71, 87, 0.3); }
          .card-item.stock-zero .card-stats strong { color: var(--danger); }
          .card-item.stock-low { border-color: rgba(255, 167, 38, 0.3); }
          .card-item.stock-low .card-stats strong { color: var(--warning); }
          .card-item.card-selected {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px rgba(62, 229, 224, 0.2);
          }
          .card-top {
            display: flex;
            gap: 12px;
            margin-bottom: 12px;
            align-items: flex-start;
          }
          .card-checkbox {
            transform: scale(1.3);
            margin-top: 14px;
            cursor: pointer;
            accent-color: var(--accent);
          }
          .card-info { flex: 1; min-width: 0; }
          .card-title {
            font-weight: 500;
            font-size: 14px;
            line-height: 1.3;
            margin-bottom: 4px;
            color: var(--text-primary);
          }
          .card-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            padding: 10px 0;
            border-top: 1px solid var(--border-subtle);
            border-bottom: 1px solid var(--border-subtle);
            font-size: 13px;
            color: var(--text-secondary);
          }
          .card-stats strong { color: var(--text-primary); }
          .stat-label {
            display: block;
            font-size: 10px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-bottom: 2px;
          }
          .card-bottom {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 12px;
            flex-wrap: wrap;
            gap: 8px;
          }
        }
      `}</style>
    </div>
  )
}