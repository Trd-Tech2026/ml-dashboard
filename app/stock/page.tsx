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
    case 'drop_off': return 'A domicilio (vendedor)'
    case 'default': return 'Sin Mercado Envíos'
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

function statusColor(status: string): string {
  switch (status) {
    case 'active': return '#4CAF50'
    case 'paused': return '#FF9800'
    case 'closed': return '#999'
    default: return '#666'
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

  // Selección de items (Set para performance)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Cargar items
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

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // Volver a página 1 cuando cambia un filtro
  useEffect(() => {
    setPage(1)
  }, [search, status, logistic, stockFilter, sort, showArchived])

  // Limpiar selección al cambiar entre vistas (archivadas / no archivadas)
  useEffect(() => {
    setSelected(new Set())
  }, [showArchived])

  // ===== Búsqueda =====
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  // ===== Refresh stock (sync) =====
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

  // ===== Selección =====
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
        // Deseleccionar los de esta página
        pageIds.forEach(id => next.delete(id))
      } else {
        // Seleccionar los de esta página
        pageIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  // ===== Archivar / Desarchivar =====
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
      console.log(`${action}: ${json.affected} items afectados`)
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
          {refrescando ? '⏳ Sincronizando...' : '🔄 Actualizar stock'}
        </button>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi kpi-blue">
          <div className="kpi-label">Publicaciones</div>
          <div className="kpi-value">{kpis.total.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi kpi-green">
          <div className="kpi-label">Stock total</div>
          <div className="kpi-value">{kpis.stock_total.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi kpi-yellow">
          <div className="kpi-label">Stock crítico (&lt;5)</div>
          <div className="kpi-value">{kpis.critico.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi kpi-red">
          <div className="kpi-label">Sin stock</div>
          <div className="kpi-value">{kpis.sin_stock.toLocaleString('es-AR')}</div>
        </div>
      </div>

      {/* Toggle "Mostrar archivadas" */}
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

      {/* BARRA DE ACCIÓN — solo si hay selección */}
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
          <button className="btn-clear-sel" onClick={clearSelection}>Limpiar selección</button>
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
                  <td>{item.sold_quantity}</td>
                  <td>{formatearPrecio(item.price, item.currency)}</td>
                  <td>
                    <span className="logistic-badge">
                      {logisticLabel(item.logistic_type)}
                      {item.free_shipping && ' 🆓'}
                    </span>
                  </td>
                  <td>
                    <div className="logistic-badges">
                      <span className={`logistic-badge logistic-${item.logistic_type ?? 'none'}`}>
                        {logisticLabel(item.logistic_type)}
                      </span>
                      {item.is_flex && item.logistic_type !== 'self_service' && (
                        <span className="logistic-badge logistic-flex">⚡ Flex</span>
                      )}
                      {item.free_shipping && (
                        <span className="logistic-badge logistic-free">🆓</span>
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
                <span className="status-badge" style={{ backgroundColor: statusColor(item.status) }}>{statusLabel(item.status)}</span>
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
          padding: 24px 32px 48px;
          max-width: 1400px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          gap: 16px;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          color: #1a1a1a;
        }
        .subtitle {
          margin: 4px 0 0;
          font-size: 13px;
          color: #888;
        }
        .btn-refresh {
          background: #4CAF50;
          color: white;
          border: none;
          padding: 10px 18px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .btn-refresh:hover:not(:disabled) { background: #45a049; }
        .btn-refresh:disabled { opacity: 0.6; cursor: not-allowed; }

        /* KPIs */
        .kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }
        .kpi {
          background: white;
          padding: 16px;
          border-radius: 10px;
          border-top: 3px solid;
        }
        .kpi-blue { border-top-color: #2196F3; }
        .kpi-green { border-top-color: #4CAF50; }
        .kpi-yellow { border-top-color: #FF9800; }
        .kpi-red { border-top-color: #f44336; }
        .kpi-label { font-size: 12px; color: #666; margin-bottom: 6px; }
        .kpi-value { font-size: 24px; font-weight: 700; color: #1a1a1a; }

        /* Toggle archivadas */
        .archived-toggle {
          margin-bottom: 12px;
        }
        .toggle-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: white;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          color: #555;
          cursor: pointer;
          user-select: none;
        }
        .toggle-label input { cursor: pointer; }

        /* Action bar (cuando hay selección) */
        .action-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          background: #1a1a1a;
          color: white;
          padding: 12px 16px;
          border-radius: 10px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .action-text { flex: 1; font-size: 14px; }
        .btn-action {
          background: #FF9800;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-action:hover:not(:disabled) { background: #f57c00; }
        .btn-action:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-clear-sel {
          background: transparent;
          color: #ccc;
          border: 1px solid #555;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
        }
        .btn-clear-sel:hover { color: white; border-color: #888; }

        /* Filtros */
        .filtros {
          background: white;
          padding: 16px;
          border-radius: 10px;
          margin-bottom: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .search-form { display: flex; gap: 8px; }
        .search-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 14px;
        }
        .btn-search {
          background: #1a1a1a;
          color: white;
          border: none;
          padding: 10px 18px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
        }
        .btn-clear {
          background: #f0f0f0;
          color: #666;
          border: none;
          padding: 10px 14px;
          border-radius: 8px;
          cursor: pointer;
        }
        .dropdowns { display: flex; gap: 8px; flex-wrap: wrap; }
        .dropdowns select {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 14px;
          background: white;
          cursor: pointer;
          min-width: 140px;
        }

        .counter { font-size: 13px; color: #666; margin-bottom: 12px; }

        /* Tabla */
        .tabla-wrapper {
          background: white;
          border-radius: 10px;
          overflow: hidden;
          overflow-x: auto;
        }
        .tabla { width: 100%; border-collapse: collapse; }
        .tabla th {
          background: #fafafa;
          padding: 12px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid #eee;
        }
        .tabla td {
          padding: 12px 16px;
          border-bottom: 1px solid #f0f0f0;
          font-size: 14px;
          vertical-align: middle;
        }
        .tabla tr:last-child td { border-bottom: none; }
        .tabla tr.stock-zero { background: #fff5f5; }
        .tabla tr.stock-zero .td-stock strong { color: #d32f2f; }
        .tabla tr.stock-low { background: #fffbf0; }
        .tabla tr.stock-low .td-stock strong { color: #e65100; }
        .tabla tr.fila-selected { background: #e3f2fd !important; }

        .col-check { width: 32px; text-align: center; }
        .col-check input { cursor: pointer; transform: scale(1.2); }

        .thumb {
          width: 48px; height: 48px;
          object-fit: cover;
          border-radius: 6px;
          background: #f5f5f5;
        }
        .thumb-placeholder {
          width: 48px; height: 48px;
          background: #f5f5f5;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
        }

        .td-title { max-width: 380px; }
        .title-text { font-weight: 500; color: #1a1a1a; line-height: 1.3; }
        .sku { font-size: 11px; color: #888; font-family: monospace; margin-top: 2px; }
        .td-stock strong { font-size: 16px; }

        .logistic-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .logistic-badge {
          display: inline-block;
          padding: 3px 8px;
          background: #f0f0f0;
          color: #555;
          border-radius: 6px;
          font-size: 12px;
          white-space: nowrap;
        }
        .logistic-flex {
          background: #fff3e0;
          color: #e65100;
          font-weight: 600;
        }
        .logistic-fulfillment {
          background: #e8f5e9;
          color: #2e7d32;
          font-weight: 600;
        }
        .logistic-cross_docking {
          background: #e3f2fd;
          color: #1565c0;
        }
        .logistic-drop_off {
          background: #f3e5f5;
          color: #6a1b9a;
        }
        .logistic-free {
          background: #e1f5fe;
          color: #0277bd;
        }
        .status-badge {
          display: inline-block;
          padding: 3px 10px;
          color: white;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        .btn-ver {
          color: #2196F3;
          text-decoration: none;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
        }
        .btn-ver:hover { text-decoration: underline; }

        /* Cards mobile (ocultas en desktop) */
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
          background: white;
          border: 1px solid #ddd;
          padding: 8px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        }
        .paginacion button:disabled { opacity: 0.4; cursor: not-allowed; }
        .paginacion span { font-size: 14px; color: #555; padding: 0 12px; }

        .empty {
          background: white;
          padding: 48px;
          text-align: center;
          border-radius: 10px;
          color: #888;
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
          .btn-refresh { width: 100%; }

          .kpis { grid-template-columns: repeat(2, 1fr); }
          .kpi-value { font-size: 20px; }

          .action-bar {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }
          .action-bar > * { width: 100%; }

          .dropdowns select { flex: 1; min-width: 0; }

          .tabla-wrapper { display: none; }
          .cards-mobile { display: flex; flex-direction: column; gap: 12px; }
          .card-item {
            background: white;
            padding: 14px;
            border-radius: 10px;
          }
          .card-item.stock-zero { background: #fff5f5; }
          .card-item.stock-low { background: #fffbf0; }
          .card-item.card-selected {
            outline: 2px solid #2196F3;
            outline-offset: -2px;
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
          }
          .card-info { flex: 1; min-width: 0; }
          .card-title {
            font-weight: 500;
            font-size: 14px;
            line-height: 1.3;
            margin-bottom: 4px;
          }
          .card-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            padding: 8px 0;
            border-top: 1px solid #f0f0f0;
            border-bottom: 1px solid #f0f0f0;
            font-size: 13px;
          }
          .stat-label {
            display: block;
            font-size: 11px;
            color: #888;
            text-transform: uppercase;
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