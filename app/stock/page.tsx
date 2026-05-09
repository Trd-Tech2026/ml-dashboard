'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import StockTabs from '../../components/StockTabs'
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
  is_manual?: boolean
  cost?: number | null
  iva_rate?: number
}

type Group = {
  key: string
  sku: string | null
  title: string
  thumbnail: string | null
  items: Item[]
  totalStock: number
  totalSold: number
  minPrice: number
  maxPrice: number
  currency: string
  is_manual?: boolean
}

type Kpis = {
  total: number
  sin_stock: number
  critico: number
  stock_total: number
  archived_count: number
  manual_count?: number
}

type SyncState = {
  last_sync_at: string | null
  total_items: number
} | null

type StockApiResponse = {
  ok: boolean
  mode: 'flat' | 'grouped'
  items: Item[]
  groups: Group[]
  page: number
  pageSize: number
  totalFiltered: number
  totalGroups: number
  archivedView: string
  kpis: Kpis
  sync_state: SyncState
}

type ComboComponent = {
  component_sku: string
  component_title: string
  quantity: number
  notes: string | null
  component_stock: number
  possible_combos: number
  found: boolean
}

type ComboPublication = {
  item_id: string
  permalink: string | null
  available_quantity: number
  price: number
  status: string
}

type Combo = {
  sku: string
  title: string
  thumbnail: string | null
  ml_stock: number
  real_stock: number | null
  total_sold: number
  publications_count: number
  currency: string
  is_configured: boolean
  components: ComboComponent[]
  publications: ComboPublication[]
}

type CombosApiResponse = {
  ok: boolean
  combos: Combo[]
  total: number
  configured: number
  unconfigured: number
}

type SkuSearchResult = {
  sku: string
  title: string
  thumbnail: string | null
  minStock: number
}

type CostInfo = { cost: number | null; iva_rate: number }

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

function itemsToFakeGroups(items: Item[]): Group[] {
  return items.map(item => ({
    key: item.item_id,
    sku: item.seller_sku,
    title: item.title,
    thumbnail: item.thumbnail,
    items: [item],
    totalStock: item.available_quantity,
    totalSold: item.sold_quantity,
    minPrice: item.price,
    maxPrice: item.price,
    currency: item.currency,
    is_manual: !!item.is_manual,
  }))
}

function costMapKey(item: Item): string {
  if (item.is_manual && item.seller_sku) return `MANUAL:${item.seller_sku}`
  return item.item_id
}

// ===== Componente principal =====
export default function StockPage() {
  return (
    <Suspense fallback={<div className="stock-page-fallback" />}>
      <StockPageContent />
    </Suspense>
  )
}

function StockPageContent() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'productos'
  const activeTab: 'productos' | 'combos' = tab === 'combos' ? 'combos' : 'productos'

  return (
    <div className="stock-page">
      <StockTabs />

      {activeTab === 'productos' ? <ProductosView /> : <CombosView />}

      <style jsx>{`
        .stock-page {
          padding: 24px 40px 48px;
          max-width: 1400px;
          margin: 0 auto;
        }
        @media (max-width: 768px) {
          .stock-page { padding: 16px; }
        }
      `}</style>
    </div>
  )
}

// ============================================================
// VISTA: PRODUCTOS
// ============================================================
function ProductosView() {
  const router = useRouter()
  const [data, setData] = useState<StockApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [archivando, setArchivando] = useState(false)

  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [status, setStatus] = useState('all')
  const [logistic, setLogistic] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [sort, setSort] = useState('stock_desc')
  const [showArchived, setShowArchived] = useState(false)
  const [groupBySku, setGroupBySku] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 50

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const [showManualModal, setShowManualModal] = useState(false)
  const [editingManualSku, setEditingManualSku] = useState<string | null>(null)

  // ===== Modificación de costos =====
  const [editingCosts, setEditingCosts] = useState(false)
  const [costInfoMap, setCostInfoMap] = useState<Map<string, CostInfo>>(new Map())
  const [savingCostKey, setSavingCostKey] = useState<string | null>(null)
  const [savedRecentlyKey, setSavedRecentlyKey] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      search,
      status,
      logistic,
      stock: stockFilter,
      sort,
      archived: showArchived ? 'true' : 'false',
      group: groupBySku ? 'true' : 'false',
      page: String(page),
      pageSize: String(pageSize),
    })
    try {
      const res = await fetch(`/api/stock/list?${params.toString()}`, { cache: 'no-store' })
      const json: StockApiResponse = await res.json()
      setData(json)
    } catch (err) {
      console.error('Error fetch stock:', err)
    } finally {
      setLoading(false)
    }
  }, [search, status, logistic, stockFilter, sort, showArchived, groupBySku, page])

  useEffect(() => { fetchItems() }, [fetchItems])
  useEffect(() => { setPage(1) }, [search, status, logistic, stockFilter, sort, showArchived, groupBySku])
  useEffect(() => { setSelected(new Set()) }, [showArchived])

  // Después de cargar items, fetch cost-info para mostrar costos en tabla
  useEffect(() => {
    if (!data) return
    const allItems: Item[] = data.mode === 'grouped'
      ? (data.groups ?? []).flatMap(g => g.items)
      : (data.items ?? [])
    if (allItems.length === 0) return

    const itemIds: string[] = []
    const sellerSkus: string[] = []
    for (const item of allItems) {
      if (item.is_manual) {
        if (item.seller_sku) sellerSkus.push(item.seller_sku)
      } else {
        itemIds.push(item.item_id)
      }
    }
    if (itemIds.length === 0 && sellerSkus.length === 0) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/items/cost-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_ids: itemIds, seller_skus: sellerSkus }),
        })
        const json = await res.json()
        if (cancelled || !json.ok) return
        const map = new Map<string, CostInfo>()
        for (const [key, value] of Object.entries(json.costs as Record<string, CostInfo>)) {
          map.set(key, value)
        }
        setCostInfoMap(map)
      } catch (err) {
        console.error('Error fetch cost-info:', err)
      }
    })()
    return () => { cancelled = true }
  }, [data])

  const getCostInfo = (item: Item): CostInfo => {
    const fromMap = costInfoMap.get(costMapKey(item))
    if (fromMap) return fromMap
    return { cost: item.cost ?? null, iva_rate: item.iva_rate ?? 21 }
  }

  const handleSaveCost = async (item: Item, newCost: number | null, newIvaRate: number) => {
    const key = costMapKey(item)
    setSavingCostKey(key)
    try {
      const res = await fetch('/api/items/update-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.item_id,
          seller_sku: item.seller_sku,
          is_manual: !!item.is_manual,
          cost: newCost,
          iva_rate: newIvaRate,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        alert(`No se pudo guardar: ${json.error ?? 'error desconocido'}`)
        return
      }
      setCostInfoMap(prev => {
        const next = new Map(prev)
        next.set(key, { cost: newCost, iva_rate: newIvaRate })
        return next
      })
      setSavedRecentlyKey(key)
      setTimeout(() => {
        setSavedRecentlyKey(curr => (curr === key ? null : curr))
      }, 1500)
    } catch (err: any) {
      alert(`Error de red: ${err?.message ?? 'desconocido'}`)
    } finally {
      setSavingCostKey(null)
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  const handleRefresh = async () => {
    setRefrescando(true)
    try {
      const res = await fetch('/api/sync-items', { cache: 'no-store' })
      await res.json()
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

  const toggleSelectGroup = (group: Group) => {
    const ids = group.items.map(i => i.item_id)
    const allSelected = ids.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  const toggleExpand = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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

    const idsToArchive = Array.from(selected).filter(id => !id.startsWith('MANUAL_'))
    if (idsToArchive.length === 0) {
      alert('No se pueden archivar productos manuales. Borralos desde el botón de cada producto.')
      return
    }

    setArchivando(true)
    try {
      const res = await fetch('/api/stock/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_ids: idsToArchive,
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

  const handleEditManual = (sku: string) => {
    setEditingManualSku(sku)
    setShowManualModal(true)
  }

  const handleDeleteManual = async (sku: string, title: string) => {
    if (!window.confirm(`¿Borrar el producto manual "${title}"?\n\nEsta acción no se puede deshacer.`)) return
    try {
      const res = await fetch('/api/manual-items/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seller_sku: sku }),
      })
      const json = await res.json()
      if (!json.ok) {
        alert(`No se pudo borrar: ${json.error}`)
        return
      }
      await fetchItems()
    } catch (err) {
      alert('Error al borrar')
    }
  }

  const kpis = data?.kpis ?? { total: 0, sin_stock: 0, critico: 0, stock_total: 0, archived_count: 0, manual_count: 0 }
  const totalFiltered = data?.totalFiltered ?? 0
  const totalGroups = data?.totalGroups ?? 0

  const groups: Group[] = data?.mode === 'grouped'
    ? (data?.groups ?? [])
    : itemsToFakeGroups(data?.items ?? [])

  const totalPages = data?.mode === 'grouped'
    ? Math.max(1, Math.ceil(totalGroups / pageSize))
    : Math.max(1, Math.ceil(totalFiltered / pageSize))

  const totalItemsEnPagina = groups.reduce((acc, g) => acc + g.items.length, 0)
  const todosEnPaginaSeleccionados = totalItemsEnPagina > 0 &&
    groups.flatMap(g => g.items).every(i => selected.has(i.item_id))

  const selectAllInPage = () => {
    const allIds = groups.flatMap(g => g.items.map(i => i.item_id))
    const todosSeleccionados = allIds.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (todosSeleccionados) allIds.forEach(id => next.delete(id))
      else allIds.forEach(id => next.add(id))
      return next
    })
  }

  return (
    <div className="productos-view">
      <div className="header">
        <div>
          <h1>{showArchived ? '🗄️ Stock archivado' : 'Stock'}</h1>
          <p className="subtitle">
            {data?.sync_state?.last_sync_at
              ? `Última sincronización: ${formatearFecha(data.sync_state.last_sync_at)}`
              : 'Sin sincronizaciones aún'}
            {(kpis.manual_count ?? 0) > 0 && ` · ${kpis.manual_count} producto${kpis.manual_count === 1 ? '' : 's'} manual${kpis.manual_count === 1 ? '' : 'es'}`}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn-create-manual" onClick={() => { setEditingManualSku(null); setShowManualModal(true); }}>
            <span>+</span>
            <span>Producto manual</span>
          </button>
          <button
            className={`btn-edit-costs ${editingCosts ? 'btn-edit-costs-active' : ''}`}
            onClick={() => setEditingCosts(v => !v)}
            title="Activá la edición inline de costos en la tabla"
          >
            <span>{editingCosts ? '✓' : '💰'}</span>
            <span>{editingCosts ? 'Listo' : 'Modificar costos'}</span>
          </button>
          <button className="btn-refresh" onClick={handleRefresh} disabled={refrescando}>
            <span>{refrescando ? '⏳' : '⟳'}</span>
            <span>{refrescando ? 'Sincronizando...' : 'Actualizar stock'}</span>
          </button>
        </div>
      </div>

      {editingCosts && (
        <div className="edit-costs-banner">
          <span className="banner-icon">💡</span>
          <div className="banner-text">
            <strong>Modo edición de costos activo.</strong> Los costos se guardan al apretar Enter o salir del campo.
            Cambiá el IVA con el dropdown chiquito al lado.
          </div>
          <button className="btn-mini" onClick={() => setEditingCosts(false)}>✓ Salir</button>
        </div>
      )}

      <div className="kpis">
        <div className="kpi" style={{ '--kpi-c': 'var(--info)' } as any}>
          <div className="kpi-label">Productos</div>
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

      <div className="top-toggles">
        <label className="toggle">
          <input type="checkbox" checked={groupBySku} onChange={(e) => setGroupBySku(e.target.checked)} />
          <span>Agrupar por SKU</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span>Mostrar archivadas {kpis.archived_count > 0 && `(${kpis.archived_count})`}</span>
        </label>
      </div>

      {selected.size > 0 && (
        <div className="action-bar">
          <span className="action-text">
            <strong>{selected.size}</strong> seleccionada{selected.size === 1 ? '' : 's'}
          </span>
          <button className="btn-action" onClick={() => handleArchive(!showArchived)} disabled={archivando}>
            {archivando ? '⏳ Procesando...' : showArchived ? '↩️ Desarchivar seleccionadas' : '🗄️ Archivar seleccionadas'}
          </button>
          <button className="btn-clear-sel" onClick={clearSelection}>Limpiar</button>
        </div>
      )}

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
            <button type="button" className="btn-clear" onClick={() => { setSearchInput(''); setSearch('') }}>✕</button>
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

      <div className="counter">
        {loading
          ? 'Cargando...'
          : data?.mode === 'grouped'
            ? `Mostrando ${groups.length} producto${groups.length === 1 ? '' : 's'} de ${totalGroups.toLocaleString('es-AR')} (${totalFiltered.toLocaleString('es-AR')} publicaciones${showArchived ? ' archivadas' : ''})`
            : `Mostrando ${totalItemsEnPagina} de ${totalFiltered.toLocaleString('es-AR')} publicaciones${showArchived ? ' archivadas' : ''}`
        }
      </div>

      <div className="tabla-wrapper">
        <table className="tabla">
          <thead>
            <tr>
              <th className="col-check">
                <input type="checkbox" checked={todosEnPaginaSeleccionados} onChange={selectAllInPage} />
              </th>
              <th className="col-arrow"></th>
              <th>Foto</th>
              <th>Título / SKU</th>
              <th>Stock</th>
              <th>Vendidos</th>
              <th>Costo</th>
              <th>Precio</th>
              <th>Envío</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const isMulti = group.items.length > 1
              const isExpanded = expandedGroups.has(group.key)
              const groupSelected = group.items.every(i => selected.has(i.item_id))
              const groupPartial = !groupSelected && group.items.some(i => selected.has(i.item_id))
              const single = group.items[0]
              const isManual = !!single.is_manual

              if (!isMulti) {
                const ci = getCostInfo(single)
                const key = costMapKey(single)
                return (
                  <tr key={group.key} className={`${stockClass(single.available_quantity)} ${selected.has(single.item_id) ? 'fila-selected' : ''} ${isManual ? 'fila-manual' : ''}`}>
                    <td className="col-check">
                      <input type="checkbox" checked={selected.has(single.item_id)} onChange={() => toggleSelect(single.item_id)} />
                    </td>
                    <td className="col-arrow"></td>
                    <td>
                      {isManual ? (
                        <div className="thumb-placeholder thumb-manual">📋</div>
                      ) : single.thumbnail
                        ? <img src={single.thumbnail.replace('http://', 'https://')} alt="" className="thumb" />
                        : <div className="thumb-placeholder">📦</div>
                      }
                    </td>
                    <td className="td-title">
                      <div className="title-text">
                        {single.title}
                        {isManual && <span className="badge-manual">MANUAL</span>}
                      </div>
                      {single.seller_sku
                        ? <div className="sku">SKU: {single.seller_sku}</div>
                        : <div className="sku-missing">Sin SKU</div>
                      }
                    </td>
                    <td className="td-stock"><strong>{single.available_quantity}</strong></td>
                    <td className="td-num">{isManual ? '—' : single.sold_quantity}</td>
                    <CostCell
                      item={single}
                      costInfo={ci}
                      editing={editingCosts}
                      saving={savingCostKey === key}
                      saved={savedRecentlyKey === key}
                      onSave={(c, iva) => handleSaveCost(single, c, iva)}
                    />
                    <td className="td-num">
                      {isManual
                        ? <span className="text-dim">—</span>
                        : formatearPrecio(single.price, single.currency)
                      }
                    </td>
                    <td>
                      {isManual ? (
                        <span className="logistic-badge">Sin envío</span>
                      ) : (
                        <div className="logistic-badges">
                          <span className={`logistic-badge logistic-${single.logistic_type ?? 'none'}`}>{logisticLabel(single.logistic_type)}</span>
                          {single.is_flex && single.logistic_type !== 'self_service' && (
                            <span className="logistic-badge logistic-flex">⚡ Flex</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {isManual
                        ? <span className="status-badge status-active">Manual</span>
                        : <span className={`status-badge status-${single.status}`}>{statusLabel(single.status)}</span>
                      }
                    </td>
                    <td>
                      {isManual ? (
                        <div className="manual-actions">
                          <button className="btn-mini" onClick={() => handleEditManual(single.seller_sku!)} title="Editar">✏️</button>
                          <button className="btn-mini btn-mini-danger" onClick={() => handleDeleteManual(single.seller_sku!, single.title)} title="Borrar">🗑️</button>
                        </div>
                      ) : single.permalink && (
                        <a href={single.permalink} target="_blank" rel="noopener noreferrer" className="btn-ver">Ver →</a>
                      )}
                    </td>
                  </tr>
                )
              }

              return (
                <>
                  <tr key={group.key} className={`group-row ${stockClass(group.totalStock)} ${groupSelected ? 'fila-selected' : ''}`}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={groupSelected}
                        ref={el => { if (el) el.indeterminate = groupPartial }}
                        onChange={() => toggleSelectGroup(group)}
                      />
                    </td>
                    <td className="col-arrow">
                      <button className="arrow-btn" onClick={() => toggleExpand(group.key)}>
                        <span className={`arrow ${isExpanded ? 'arrow-open' : ''}`}>▶</span>
                      </button>
                    </td>
                    <td>
                      {group.thumbnail
                        ? <img src={group.thumbnail.replace('http://', 'https://')} alt="" className="thumb" />
                        : <div className="thumb-placeholder">📦</div>
                      }
                    </td>
                    <td className="td-title">
                      <div className="title-text">{group.title}</div>
                      <div className="group-meta">
                        <span className="sku">SKU: {group.sku}</span>
                        <span className="badge-count">{group.items.length} publicaciones</span>
                      </div>
                    </td>
                    <td className="td-stock"><strong>{group.totalStock}</strong></td>
                    <td className="td-num">{group.totalSold}</td>
                    <td className="td-num"><span className="text-dim">—</span></td>
                    <td className="td-num">
                      {group.minPrice === group.maxPrice
                        ? formatearPrecio(group.minPrice, group.currency)
                        : <span className="price-range">
                            {formatearPrecio(group.minPrice, group.currency)}
                            <small> – </small>
                            {formatearPrecio(group.maxPrice, group.currency)}
                          </span>
                      }
                    </td>
                    <td className="td-summary" colSpan={3}>
                      <span className="summary-text">Click ▶ para ver publicaciones</span>
                    </td>
                  </tr>
                  {isExpanded && group.items.map((item) => {
                    const ciChild = getCostInfo(item)
                    const keyChild = costMapKey(item)
                    return (
                      <tr key={item.item_id} className={`child-row ${stockClass(item.available_quantity)} ${selected.has(item.item_id) ? 'fila-selected' : ''}`}>
                        <td className="col-check">
                          <input type="checkbox" checked={selected.has(item.item_id)} onChange={() => toggleSelect(item.item_id)} />
                        </td>
                        <td className="col-arrow"></td>
                        <td className="td-child-thumb"><span className="child-indent">└</span></td>
                        <td className="td-title">
                          <div className="title-text-child">{item.item_id}</div>
                          <div className="sku">{item.title}</div>
                        </td>
                        <td className="td-stock"><strong>{item.available_quantity}</strong></td>
                        <td className="td-num">{item.sold_quantity}</td>
                        <CostCell
                          item={item}
                          costInfo={ciChild}
                          editing={editingCosts}
                          saving={savingCostKey === keyChild}
                          saved={savedRecentlyKey === keyChild}
                          onSave={(c, iva) => handleSaveCost(item, c, iva)}
                        />
                        <td className="td-num">{formatearPrecio(item.price, item.currency)}</td>
                        <td>
                          <div className="logistic-badges">
                            <span className={`logistic-badge logistic-${item.logistic_type ?? 'none'}`}>{logisticLabel(item.logistic_type)}</span>
                            {item.is_flex && item.logistic_type !== 'self_service' && (
                              <span className="logistic-badge logistic-flex">⚡ Flex</span>
                            )}
                          </div>
                        </td>
                        <td><span className={`status-badge status-${item.status}`}>{statusLabel(item.status)}</span></td>
                        <td>
                          {item.permalink && (
                            <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="btn-ver">Ver →</a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="cards-mobile">
        {groups.map((group) => {
          const single = group.items[0]
          const isManual = !!single.is_manual
          const isSelected = selected.has(single.item_id)
          const ci = getCostInfo(single)
          const key = costMapKey(single)
          return (
            <div key={group.key} className={`card-item ${stockClass(single.available_quantity)} ${isSelected ? 'card-selected' : ''} ${isManual ? 'card-manual' : ''}`}>
              <div className="card-top">
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(single.item_id)} className="card-checkbox" />
                {isManual ? (
                  <div className="thumb-placeholder thumb-manual">📋</div>
                ) : single.thumbnail
                  ? <img src={single.thumbnail.replace('http://', 'https://')} alt="" className="thumb" />
                  : <div className="thumb-placeholder">📦</div>
                }
                <div className="card-info">
                  <div className="card-title">
                    {single.title}
                    {isManual && <span className="badge-manual">MANUAL</span>}
                  </div>
                  {single.seller_sku && <div className="sku">SKU: {single.seller_sku}</div>}
                </div>
              </div>
              <div className="card-stats">
                <div><span className="stat-label">Stock</span> <strong>{single.available_quantity}</strong></div>
                <div><span className="stat-label">Vendidos</span> {isManual ? '—' : single.sold_quantity}</div>
                <div>
                  <span className="stat-label">Precio</span>{' '}
                  {isManual ? '—' : formatearPrecio(single.price, single.currency)}
                </div>
              </div>
              <div className="card-cost-row">
                <span className="stat-label">Costo</span>
                {editingCosts ? (
                  <CostCellMobile
                    item={single}
                    costInfo={ci}
                    saving={savingCostKey === key}
                    saved={savedRecentlyKey === key}
                    onSave={(c, iva) => handleSaveCost(single, c, iva)}
                  />
                ) : (
                  ci.cost != null ? (
                    <span><strong>{formatearPrecio(ci.cost, 'ARS')}</strong> <span className="cost-iva-hint">+ {ci.iva_rate}% IVA</span></span>
                  ) : <span className="text-dim">— sin costo</span>
                )}
              </div>
              <div className="card-bottom">
                {isManual ? (
                  <>
                    <span className="status-badge status-active">Manual</span>
                    <div className="manual-actions">
                      <button className="btn-mini" onClick={() => handleEditManual(single.seller_sku!)}>✏️ Editar</button>
                      <button className="btn-mini btn-mini-danger" onClick={() => handleDeleteManual(single.seller_sku!, single.title)}>🗑️ Borrar</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className={`logistic-badge logistic-${single.logistic_type ?? 'none'}`}>{logisticLabel(single.logistic_type)}</span>
                    <span className={`status-badge status-${single.status}`}>{statusLabel(single.status)}</span>
                    {single.permalink && <a href={single.permalink} target="_blank" rel="noopener noreferrer" className="btn-ver">Ver →</a>}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="paginacion">
          <button onClick={() => setPage(1)} disabled={page === 1}>«</button>
          <button onClick={() => setPage(page - 1)} disabled={page === 1}>‹</button>
          <span>Página {page} de {totalPages}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= totalPages}>›</button>
          <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</button>
        </div>
      )}

      {!loading && groups.length === 0 && (
        <div className="empty">
          <p>{showArchived ? 'No hay publicaciones archivadas con esos filtros.' : 'No se encontraron publicaciones con esos filtros.'}</p>
        </div>
      )}

      {showManualModal && (
        <ManualItemModal
          editingSku={editingManualSku}
          onClose={() => { setShowManualModal(false); setEditingManualSku(null); }}
          onSaved={async () => { setShowManualModal(false); setEditingManualSku(null); await fetchItems(); }}
        />
      )}

      <style jsx>{`
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; gap: 16px; flex-wrap: wrap; }
        .header h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; color: var(--text-primary); }
        .subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }
        .header-actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .btn-create-manual { display: flex; align-items: center; gap: 8px; background: transparent; color: var(--accent); border: 1px solid var(--border-medium); padding: 11px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s ease; white-space: nowrap; }
        .btn-create-manual:hover { background: rgba(62, 229, 224, 0.08); border-color: var(--accent); }
        .btn-create-manual span:first-child { font-size: 16px; line-height: 1; }
        .btn-edit-costs { display: flex; align-items: center; gap: 8px; background: transparent; color: var(--warning); border: 1px solid rgba(255, 167, 38, 0.4); padding: 11px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s ease; white-space: nowrap; }
        .btn-edit-costs:hover { background: rgba(255, 167, 38, 0.08); border-color: var(--warning); }
        .btn-edit-costs.btn-edit-costs-active { background: var(--warning); color: var(--bg-base); border-color: var(--warning); box-shadow: 0 4px 14px rgba(255, 167, 38, 0.25); }
        .btn-edit-costs span:first-child { font-size: 14px; line-height: 1; }
        .btn-refresh { display: flex; align-items: center; gap: 8px; background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%); color: var(--bg-base); border: none; padding: 11px 18px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); transition: all 0.15s ease; white-space: nowrap; }
        .btn-refresh:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4); }
        .btn-refresh:disabled { opacity: 0.6; cursor: not-allowed; }

        .edit-costs-banner {
          display: flex; align-items: center; gap: 10px;
          background: rgba(255, 167, 38, 0.08); border: 1px solid rgba(255, 167, 38, 0.3);
          border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; flex-wrap: wrap;
        }
        .banner-icon { font-size: 18px; flex-shrink: 0; }
        .banner-text { flex: 1; font-size: 13px; color: var(--text-secondary); line-height: 1.5; min-width: 220px; }
        .banner-text strong { color: var(--warning); }

        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
        .kpi { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px 18px; position: relative; overflow: hidden; }
        .kpi::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--kpi-c); opacity: 0.7; }
        .kpi-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .kpi-value { font-size: 22px; font-weight: 700; color: var(--text-primary); }

        .top-toggles { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
        .toggle { display: inline-flex; align-items: center; gap: 8px; background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 8px 14px; border-radius: 10px; font-size: 13px; color: var(--text-secondary); cursor: pointer; user-select: none; }
        .toggle input { accent-color: var(--accent); }

        .action-bar { display: flex; align-items: center; gap: 12px; background: linear-gradient(135deg, rgba(62, 229, 224, 0.12) 0%, rgba(28, 160, 196, 0.08) 100%); color: var(--text-primary); border: 1px solid var(--border-medium); padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .action-text { flex: 1; font-size: 14px; }
        .btn-action { background: var(--warning); color: var(--bg-base); border: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-clear-sel { background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 8px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }

        .filtros { background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 16px; border-radius: 12px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
        .search-form { display: flex; gap: 8px; }
        .search-input { flex: 1; padding: 10px 14px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 14px; color: var(--text-primary); font-family: inherit; outline: none; }
        .search-input::placeholder { color: var(--text-muted); }
        .search-input:focus { border-color: var(--accent); }
        .btn-search { background: var(--accent); color: var(--bg-base); border: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-clear { background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 10px 14px; border-radius: 8px; cursor: pointer; font-family: inherit; }
        .dropdowns { display: flex; gap: 8px; flex-wrap: wrap; }
        .dropdowns select { padding: 9px 12px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 13px; color: var(--text-primary); cursor: pointer; font-family: inherit; min-width: 150px; outline: none; }
        .dropdowns select option { background: var(--bg-elevated); color: var(--text-primary); }

        .counter { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }

        .tabla-wrapper { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; overflow: hidden; overflow-x: auto; }
        .tabla { width: 100%; border-collapse: collapse; }
        .tabla th { background: var(--bg-elevated); padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid var(--border-subtle); }
        .tabla td { padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); font-size: 13px; color: var(--text-secondary); vertical-align: middle; }
        .tabla tr:last-child td { border-bottom: none; }
        .tabla tr.stock-zero { background: rgba(255, 71, 87, 0.06); }
        .tabla tr.stock-zero .td-stock strong { color: var(--danger); }
        .tabla tr.stock-low { background: rgba(255, 167, 38, 0.05); }
        .tabla tr.stock-low .td-stock strong { color: var(--warning); }
        .tabla tr.fila-selected { background: rgba(62, 229, 224, 0.08) !important; }
        .tabla tr.fila-manual { background: rgba(62, 229, 224, 0.04); }
        .tabla tr.group-row { font-weight: 500; }
        .tabla tr.child-row { background: rgba(0, 0, 0, 0.18); font-size: 12px; }
        .tabla tr.child-row td { padding: 9px 16px; }

        .col-check { width: 36px; text-align: center; }
        .col-check input { cursor: pointer; transform: scale(1.2); accent-color: var(--accent); }
        .col-arrow { width: 32px; text-align: center; }
        .arrow-btn { background: transparent; border: none; cursor: pointer; color: var(--text-muted); font-size: 11px; padding: 4px 8px; }
        .arrow { display: inline-block; transition: transform 0.18s ease; }
        .arrow-open { transform: rotate(90deg); color: var(--accent); }

        .thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); }
        .thumb-placeholder { width: 44px; height: 44px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
        .thumb-manual { border-color: var(--accent); background: rgba(62, 229, 224, 0.08); color: var(--accent); }

        .td-title { max-width: 380px; }
        .title-text { font-weight: 500; color: var(--text-primary); line-height: 1.3; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .title-text-child { font-family: monospace; font-size: 12px; color: var(--accent); }
        .sku { font-size: 11px; color: var(--text-muted); font-family: monospace; margin-top: 2px; }
        .sku-missing { font-size: 11px; color: var(--text-dim); font-style: italic; margin-top: 2px; }
        .badge-manual { background: rgba(62, 229, 224, 0.15); color: var(--accent); padding: 2px 7px; border-radius: 6px; font-size: 9px; font-weight: 700; letter-spacing: 0.5px; border: 1px solid var(--border-medium); }
        .group-meta { display: flex; align-items: center; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
        .badge-count { background: rgba(62, 229, 224, 0.12); color: var(--accent); padding: 2px 8px; border-radius: 8px; font-size: 10px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; border: 1px solid var(--border-subtle); }
        .price-range { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
        .price-range small { color: var(--text-muted); margin: 0 2px; }
        .td-summary { color: var(--text-muted); font-size: 11px; font-style: italic; }
        .summary-text { opacity: 0.7; }

        .td-stock strong { font-size: 15px; color: var(--text-primary); }
        .td-num { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
        .text-dim { color: var(--text-dim); }
        .td-child-thumb { color: var(--text-dim); padding-left: 24px !important; }
        .child-indent { color: var(--text-dim); }

        .logistic-badges { display: flex; flex-wrap: wrap; gap: 4px; }
        .logistic-badge { display: inline-block; padding: 3px 8px; background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: 6px; font-size: 11px; font-weight: 500; white-space: nowrap; }
        .logistic-flex, .logistic-self_service { background: rgba(255, 167, 38, 0.12); color: var(--warning); border-color: rgba(255, 167, 38, 0.3); }
        .logistic-fulfillment { background: rgba(62, 229, 224, 0.12); color: var(--accent); border-color: var(--border-medium); }
        .logistic-cross_docking { background: rgba(28, 160, 196, 0.15); color: var(--accent-secondary); border-color: rgba(28, 160, 196, 0.3); }

        .status-badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; }
        .status-active { background: rgba(62, 229, 224, 0.15); color: var(--accent); border: 1px solid var(--border-medium); }
        .status-paused { background: rgba(255, 167, 38, 0.15); color: var(--warning); border: 1px solid rgba(255, 167, 38, 0.3); }
        .status-closed { background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border-subtle); }

        .btn-ver { color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
        .manual-actions { display: flex; gap: 6px; }
        .btn-mini { background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border-subtle); padding: 5px 9px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .btn-mini:hover { border-color: var(--border-medium); color: var(--text-primary); }
        .btn-mini-danger:hover { border-color: rgba(255, 71, 87, 0.4); color: var(--danger); }

        .cards-mobile { display: none; }
        .card-cost-row { display: none; }

        .paginacion { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 24px; }
        .paginacion button { background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text-secondary); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; font-family: inherit; }
        .paginacion button:disabled { opacity: 0.4; cursor: not-allowed; }
        .paginacion span { font-size: 13px; color: var(--text-muted); padding: 0 12px; }

        .empty { background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 48px; text-align: center; border-radius: 12px; color: var(--text-muted); margin-top: 16px; }

        @media (max-width: 768px) {
          .header { flex-direction: column; align-items: stretch; gap: 12px; }
          .header h1 { font-size: 22px; }
          .header-actions { flex-direction: column; }
          .btn-create-manual, .btn-edit-costs, .btn-refresh { width: 100%; justify-content: center; }
          .kpis { grid-template-columns: repeat(2, 1fr); }
          .kpi-value { font-size: 18px; }
          .top-toggles { flex-direction: column; }
          .action-bar { flex-direction: column; align-items: stretch; gap: 8px; }
          .dropdowns select { flex: 1; min-width: 0; }
          .tabla-wrapper { display: none; }
          .cards-mobile { display: flex; flex-direction: column; gap: 12px; }
          .card-item { background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 14px; border-radius: 12px; }
          .card-item.card-manual { border-color: var(--border-medium); background: rgba(62, 229, 224, 0.03); }
          .card-item.card-selected { border-color: var(--accent); }
          .card-top { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
          .card-checkbox { transform: scale(1.3); margin-top: 14px; cursor: pointer; accent-color: var(--accent); }
          .card-info { flex: 1; min-width: 0; }
          .card-title { font-weight: 500; font-size: 14px; line-height: 1.3; margin-bottom: 4px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
          .card-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px 0; border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); font-size: 13px; color: var(--text-secondary); }
          .card-stats strong { color: var(--text-primary); }
          .stat-label { display: block; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
          .card-cost-row { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); font-size: 13px; color: var(--text-secondary); }
          .card-cost-row strong { color: var(--text-primary); font-weight: 600; }
          .card-bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; flex-wrap: wrap; gap: 8px; }
        }
      `}</style>
    </div>
  )
}

// ============================================================
// CELDA DE COSTO (con modo lectura y modo edición)
// ============================================================
function CostCell({
  item, costInfo, editing, saving, saved, onSave,
}: {
  item: Item
  costInfo: CostInfo
  editing: boolean
  saving: boolean
  saved: boolean
  onSave: (cost: number | null, ivaRate: number) => void
}) {
  const [costInput, setCostInput] = useState(costInfo.cost != null ? String(costInfo.cost) : '')

  useEffect(() => {
    setCostInput(costInfo.cost != null ? String(costInfo.cost) : '')
  }, [costInfo.cost])

  const trySave = (newCostStr: string, newIva: number) => {
    const trimmed = newCostStr.trim()
    const newCost = trimmed === '' ? null : parseFloat(trimmed)
    if (newCost !== null && (!Number.isFinite(newCost) || newCost < 0)) return
    if (newCost === costInfo.cost && newIva === costInfo.iva_rate) return
    onSave(newCost, newIva)
  }

  if (!editing) {
    return (
      <td className="td-num td-cost">
        {costInfo.cost != null ? (
          <>
            <div className="cost-value">{formatearPrecio(costInfo.cost, 'ARS')}</div>
            <div className="cost-iva-hint">+ {costInfo.iva_rate}% IVA</div>
          </>
        ) : <span className="text-dim">—</span>}
        <style jsx>{`
          .td-cost { white-space: nowrap; }
          .cost-value { font-weight: 500; color: var(--text-primary); font-variant-numeric: tabular-nums; }
          .cost-iva-hint { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
          .text-dim { color: var(--text-dim); }
        `}</style>
      </td>
    )
  }

  return (
    <td className="td-cost-edit">
      <div className="cost-edit-wrap">
        <div className="cost-input-row">
          <span className="cost-prefix">$</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={costInput}
            onChange={e => setCostInput(e.target.value)}
            onBlur={() => trySave(costInput, costInfo.iva_rate)}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setCostInput(costInfo.cost != null ? String(costInfo.cost) : '')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            placeholder="—"
            disabled={saving}
            className="cost-input"
          />
          {saving && <span className="cost-state">⏳</span>}
          {!saving && saved && <span className="cost-state cost-saved">✓</span>}
        </div>
        <select
          value={String(costInfo.iva_rate)}
          onChange={e => trySave(costInput, parseFloat(e.target.value))}
          disabled={saving}
          className="cost-iva-select"
        >
          <option value="21">21% IVA</option>
          <option value="10.5">10.5% IVA</option>
          <option value="27">27% IVA</option>
          <option value="0">0% IVA</option>
        </select>
      </div>
      <style jsx>{`
        .td-cost-edit { padding: 8px 12px !important; min-width: 130px; }
        .cost-edit-wrap { display: flex; flex-direction: column; gap: 4px; }
        .cost-input-row { display: flex; align-items: center; gap: 4px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0 6px; transition: border-color 0.15s ease; }
        .cost-input-row:focus-within { border-color: var(--warning); }
        .cost-prefix { color: var(--text-muted); font-size: 12px; }
        .cost-input { flex: 1; min-width: 0; width: 70px; background: transparent; border: none; color: var(--text-primary); font-size: 13px; font-family: inherit; outline: none; padding: 6px 0; font-variant-numeric: tabular-nums; }
        .cost-input::-webkit-outer-spin-button, .cost-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .cost-input[type=number] { -moz-appearance: textfield; }
        .cost-state { font-size: 12px; flex-shrink: 0; }
        .cost-saved { color: var(--success); }
        .cost-iva-select { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; color: var(--text-secondary); font-size: 11px; padding: 3px 4px; cursor: pointer; font-family: inherit; outline: none; }
        .cost-iva-select:focus { border-color: var(--warning); }
      `}</style>
    </td>
  )
}

// Versión mobile (sin <td>)
function CostCellMobile({
  item, costInfo, saving, saved, onSave,
}: {
  item: Item
  costInfo: CostInfo
  saving: boolean
  saved: boolean
  onSave: (cost: number | null, ivaRate: number) => void
}) {
  const [costInput, setCostInput] = useState(costInfo.cost != null ? String(costInfo.cost) : '')

  useEffect(() => {
    setCostInput(costInfo.cost != null ? String(costInfo.cost) : '')
  }, [costInfo.cost])

  const trySave = (newCostStr: string, newIva: number) => {
    const trimmed = newCostStr.trim()
    const newCost = trimmed === '' ? null : parseFloat(trimmed)
    if (newCost !== null && (!Number.isFinite(newCost) || newCost < 0)) return
    if (newCost === costInfo.cost && newIva === costInfo.iva_rate) return
    onSave(newCost, newIva)
  }

  return (
    <div className="cost-mobile-wrap">
      <div className="cost-mobile-row">
        <span className="cost-prefix">$</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={costInput}
          onChange={e => setCostInput(e.target.value)}
          onBlur={() => trySave(costInput, costInfo.iva_rate)}
          placeholder="Sin costo"
          disabled={saving}
        />
        <select
          value={String(costInfo.iva_rate)}
          onChange={e => trySave(costInput, parseFloat(e.target.value))}
          disabled={saving}
        >
          <option value="21">21%</option>
          <option value="10.5">10.5%</option>
          <option value="27">27%</option>
          <option value="0">0%</option>
        </select>
        {saving && <span>⏳</span>}
        {!saving && saved && <span style={{ color: 'var(--success)' }}>✓</span>}
      </div>
      <style jsx>{`
        .cost-mobile-wrap { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
        .cost-mobile-row { display: flex; align-items: center; gap: 6px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 6px 10px; }
        .cost-mobile-row:focus-within { border-color: var(--warning); }
        .cost-prefix { color: var(--text-muted); font-size: 13px; }
        .cost-mobile-row input { flex: 1; background: transparent; border: none; color: var(--text-primary); font-size: 14px; font-family: inherit; outline: none; min-width: 0; }
        .cost-mobile-row select { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; color: var(--text-secondary); font-size: 12px; padding: 4px; cursor: pointer; font-family: inherit; outline: none; }
      `}</style>
    </div>
  )
}

// ============================================================
// MODAL: CREAR / EDITAR PRODUCTO MANUAL
// ============================================================
function ManualItemModal({ editingSku, onClose, onSaved }: { editingSku: string | null; onClose: () => void; onSaved: () => void }) {
  const [sku, setSku] = useState('')
  const [title, setTitle] = useState('')
  const [stock, setStock] = useState('0')
  const [cost, setCost] = useState('')
  const [ivaRate, setIvaRate] = useState('21')
  const [loading, setLoading] = useState(!!editingSku)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = !!editingSku

  useEffect(() => {
    if (!editingSku) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/manual-items/list?search=${encodeURIComponent(editingSku)}`, { cache: 'no-store' })
        const json = await res.json()
        if (cancelled) return
        const item = (json.items ?? []).find((i: any) => i.seller_sku === editingSku)
        if (item) {
          setSku(item.seller_sku)
          setTitle(item.title)
          setStock(String(item.available_quantity))
          setCost(item.cost != null ? String(item.cost) : '')
          setIvaRate(item.iva_rate != null ? String(item.iva_rate) : '21')
        }
      } catch (err) {
        if (!cancelled) setError('Error cargando datos del producto')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [editingSku])

  const handleSave = async () => {
    setError(null)

    const skuTrim = sku.trim()
    const titleTrim = title.trim()
    const stockNum = parseInt(stock, 10)
    const costNum = cost.trim() === '' ? null : parseFloat(cost)
    const ivaNum = parseFloat(ivaRate)

    if (!skuTrim) { setError('El SKU es requerido'); return }
    if (!titleTrim) { setError('El título es requerido'); return }
    if (!Number.isInteger(stockNum) || stockNum < 0) { setError('El stock debe ser un número entero ≥ 0'); return }
    if (costNum !== null && (isNaN(costNum) || costNum < 0)) { setError('El costo debe ser un número ≥ 0'); return }
    if (!Number.isFinite(ivaNum) || ivaNum < 0 || ivaNum > 100) { setError('IVA inválido'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/manual-items/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller_sku: skuTrim,
          title: titleTrim,
          available_quantity: stockNum,
          cost: costNum,
          iva_rate: ivaNum,
          is_edit: isEdit,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error desconocido')
        return
      }
      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{isEdit ? 'Editar producto manual' : 'Crear producto manual'}</div>
            <div className="modal-subtitle">
              {isEdit ? 'Modificá los datos del producto' : 'Para llaveros, peluches y otros productos que cargás manualmente'}
            </div>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <p className="loading-text">Cargando...</p>
          ) : (
            <>
              <div className="form-row">
                <label className="form-label">SKU *</label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  placeholder="Ej: LLAVMICKEY, PELUCHE, etc."
                  className="form-input"
                  disabled={isEdit}
                  autoFocus={!isEdit}
                />
                <span className="form-hint">{isEdit ? 'El SKU no se puede cambiar' : 'Identificador único. No puede coincidir con un SKU de Mercado Libre.'}</span>
              </div>

              <div className="form-row">
                <label className="form-label">Título *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Llavero Mickey"
                  className="form-input"
                />
              </div>

              <div className="form-row-double">
                <div>
                  <label className="form-label">Stock *</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Costo unitario (sin IVA)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="ARS, opcional"
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">IVA aplicable</label>
                <select value={ivaRate} onChange={e => setIvaRate(e.target.value)} className="form-input">
                  <option value="21">21% (general)</option>
                  <option value="10.5">10.5% (reducido)</option>
                  <option value="27">27% (servicios)</option>
                  <option value="0">0% (exento)</option>
                </select>
              </div>
            </>
          )}
        </div>

        {error && (<div className="error-msg">{error}</div>)}

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn-save" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Guardando...' : (isEdit ? '💾 Guardar cambios' : '✓ Crear producto')}
          </button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.15s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 16px; max-width: 560px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
        .modal-header { padding: 20px 24px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
        .modal-title { font-size: 18px; color: var(--text-primary); font-weight: 700; line-height: 1.3; margin-bottom: 4px; }
        .modal-subtitle { font-size: 13px; color: var(--text-muted); }
        .btn-close { background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 14px; flex-shrink: 0; font-family: inherit; }
        .btn-close:hover { color: var(--text-primary); border-color: var(--border-medium); }

        .modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px; }
        .loading-text { color: var(--text-muted); text-align: center; padding: 24px; }

        .form-row { display: flex; flex-direction: column; gap: 6px; }
        .form-row-double { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .form-row-double > div { display: flex; flex-direction: column; gap: 6px; }
        .form-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
        .form-input { padding: 10px 12px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 14px; color: var(--text-primary); font-family: inherit; outline: none; transition: border-color 0.15s ease; }
        .form-input:focus { border-color: var(--accent); }
        .form-input:disabled { opacity: 0.6; cursor: not-allowed; }
        .form-input::placeholder { color: var(--text-muted); }
        .form-hint { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

        .error-msg { margin: 0 24px; padding: 10px 14px; background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3); border-radius: 8px; color: var(--danger); font-size: 13px; }

        .modal-footer { padding: 16px 24px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; gap: 10px; }
        .btn-cancel { background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 10px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit; }
        .btn-cancel:hover:not(:disabled) { color: var(--text-primary); border-color: var(--border-medium); }
        .btn-save { background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%); color: var(--bg-base); border: none; padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); }
        .btn-save:hover:not(:disabled) { transform: translateY(-1px); }
        .btn-save:disabled, .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

        @media (max-width: 600px) {
          .form-row-double { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}

// ============================================================
// VISTA: COMBOS
// ============================================================
function CombosView() {
  const [data, setData] = useState<CombosApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<'all' | 'unconfigured' | 'configured' | 'with_stock' | 'without_stock'>('all')
  const [sort, setSort] = useState<'stock_desc' | 'title_asc' | 'sold_desc'>('stock_desc')

  const [editingCombo, setEditingCombo] = useState<Combo | null>(null)

  const fetchCombos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/combos/list', { cache: 'no-store' })
      const json: CombosApiResponse = await res.json()
      setData(json)
    } catch (err) {
      console.error('Error fetch combos:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCombos() }, [fetchCombos])

  const allCombos = data?.combos ?? []

  const searchLower = search.trim().toLowerCase()
  const filtered = allCombos.filter(c => {
    if (searchLower && !c.title.toLowerCase().includes(searchLower) && !c.sku.toLowerCase().includes(searchLower)) return false
    if (filterState === 'unconfigured' && c.is_configured) return false
    if (filterState === 'configured' && !c.is_configured) return false
    if (filterState === 'with_stock' && (!c.is_configured || (c.real_stock ?? 0) === 0)) return false
    if (filterState === 'without_stock' && (c.real_stock ?? 0) > 0) return false
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'title_asc') return a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })
    if (sort === 'sold_desc') return b.total_sold - a.total_sold
    const sa = a.is_configured ? (a.real_stock ?? 0) : a.ml_stock
    const sb = b.is_configured ? (b.real_stock ?? 0) : b.ml_stock
    return sb - sa
  })

  const total = data?.total ?? 0
  const configured = data?.configured ?? 0
  const unconfigured = data?.unconfigured ?? 0
  const withStock = allCombos.filter(c => c.is_configured && (c.real_stock ?? 0) > 0).length

  return (
    <div className="combos-view">
      <div className="header">
        <div>
          <h1>Combos</h1>
          <p className="subtitle">Configurá los componentes de cada combo para calcular su stock real</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi" style={{ '--kpi-c': 'var(--info)' } as any}>
          <div className="kpi-label">Total combos</div>
          <div className="kpi-value">{total.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--success)' } as any}>
          <div className="kpi-label">Configurados</div>
          <div className="kpi-value">{configured.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--warning)' } as any}>
          <div className="kpi-label">Sin configurar</div>
          <div className="kpi-value">{unconfigured.toLocaleString('es-AR')}</div>
        </div>
        <div className="kpi" style={{ '--kpi-c': 'var(--accent)' } as any}>
          <div className="kpi-label">Con stock real</div>
          <div className="kpi-value">{withStock.toLocaleString('es-AR')}</div>
        </div>
      </div>

      <div className="filtros">
        <input
          type="text"
          className="search-input"
          placeholder="Buscar combo por título o SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="dropdowns">
          <select value={filterState} onChange={(e) => setFilterState(e.target.value as any)}>
            <option value="all">Todos</option>
            <option value="unconfigured">Sin configurar</option>
            <option value="configured">Configurados</option>
            <option value="with_stock">Configurados con stock</option>
            <option value="without_stock">Configurados sin stock</option>
          </select>

          <select value={sort} onChange={(e) => setSort(e.target.value as any)}>
            <option value="stock_desc">Más stock primero</option>
            <option value="title_asc">Alfabético</option>
            <option value="sold_desc">Más vendidos</option>
          </select>
        </div>
      </div>

      <div className="counter">
        {loading ? 'Cargando combos...' : `Mostrando ${sorted.length} de ${total} combos`}
      </div>

      {!loading && sorted.length === 0 && (
        <div className="empty">
          <p>No hay combos que coincidan con los filtros.</p>
        </div>
      )}

      <div className="combos-grid">
        {sorted.map(combo => (
          <ComboCard key={combo.sku} combo={combo} onConfigure={() => setEditingCombo(combo)} />
        ))}
      </div>

      {editingCombo && (
        <ComboModal
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSaved={async () => {
            setEditingCombo(null)
            await fetchCombos()
          }}
        />
      )}

      <style jsx>{`
        .combos-view { padding-bottom: 32px; }
        .header { margin-bottom: 24px; }
        .header h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; color: var(--text-primary); }
        .subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }

        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
        .kpi { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px 18px; position: relative; overflow: hidden; }
        .kpi::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--kpi-c); opacity: 0.7; }
        .kpi-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .kpi-value { font-size: 22px; font-weight: 700; color: var(--text-primary); }

        .filtros { background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 16px; border-radius: 12px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
        .search-input { padding: 10px 14px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 14px; color: var(--text-primary); font-family: inherit; outline: none; }
        .search-input::placeholder { color: var(--text-muted); }
        .search-input:focus { border-color: var(--accent); }
        .dropdowns { display: flex; gap: 8px; flex-wrap: wrap; }
        .dropdowns select { padding: 9px 12px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 13px; color: var(--text-primary); cursor: pointer; font-family: inherit; min-width: 200px; outline: none; }
        .dropdowns select:focus { border-color: var(--accent); }

        .counter { font-size: 13px; color: var(--text-muted); margin-bottom: 14px; }

        .combos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }

        .empty { background: var(--bg-card); border: 1px solid var(--border-subtle); padding: 48px; text-align: center; border-radius: 12px; color: var(--text-muted); margin-top: 16px; }

        @media (max-width: 768px) {
          .kpis { grid-template-columns: repeat(2, 1fr); }
          .kpi-value { font-size: 18px; }
          .dropdowns select { flex: 1; min-width: 0; }
          .combos-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}

// ============================================================
// CARD DE UN COMBO
// ============================================================
function ComboCard({ combo, onConfigure }: { combo: Combo; onConfigure: () => void }) {
  const [showComponents, setShowComponents] = useState(false)
  const stockToShow = combo.is_configured ? (combo.real_stock ?? 0) : combo.ml_stock
  const stockColor = stockToShow === 0 ? 'danger' : stockToShow < 5 ? 'warning' : 'success'

  return (
    <div className={`combo-card ${combo.is_configured ? 'configured' : 'unconfigured'}`}>
      <div className="combo-header">
        {combo.thumbnail
          ? <img src={combo.thumbnail.replace('http://', 'https://')} alt="" className="combo-thumb" />
          : <div className="combo-thumb-placeholder">🎁</div>
        }
        <div className="combo-info">
          <div className="combo-title">{combo.title}</div>
          <div className="combo-sku">SKU: {combo.sku}</div>
        </div>
      </div>

      <div className="combo-status">
        {combo.is_configured ? (
          <span className="badge-configured">✓ Configurado ({combo.components.length} componentes)</span>
        ) : (
          <span className="badge-unconfigured">⚠ Sin configurar</span>
        )}
      </div>

      <div className="combo-stats">
        <div className="stat">
          <span className="stat-label">Stock ML</span>
          <span className="stat-value">{combo.ml_stock}</span>
        </div>
        <div className="stat stat-real">
          <span className="stat-label">Stock real</span>
          <span className={`stat-value stat-${stockColor}`}>
            {combo.is_configured ? combo.real_stock ?? 0 : '—'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Vendidos</span>
          <span className="stat-value">{combo.total_sold}</span>
        </div>
      </div>

      {combo.is_configured && combo.components.length > 0 && (
        <button className="btn-toggle-components" onClick={() => setShowComponents(!showComponents)}>
          <span className={`arrow ${showComponents ? 'arrow-open' : ''}`}>▶</span>
          {showComponents ? 'Ocultar componentes' : 'Ver componentes'}
        </button>
      )}

      {showComponents && combo.is_configured && (
        <div className="components-list">
          {combo.components.map(c => (
            <div key={c.component_sku} className={`component-item ${!c.found ? 'missing' : ''}`}>
              <div className="component-info">
                <div className="component-title">{c.component_title}</div>
                <div className="component-sku">{c.component_sku} × {c.quantity}</div>
              </div>
              <div className="component-stock">
                {c.found ? (
                  <>
                    <div className="cs-num">{c.component_stock}</div>
                    <div className="cs-label">stock</div>
                  </>
                ) : (
                  <div className="missing-label">No encontrado</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn-configure" onClick={onConfigure}>
        {combo.is_configured ? '✏️ Editar componentes' : '⚙️ Configurar combo'}
      </button>

      <style jsx>{`
        .combo-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .combo-card.unconfigured { border-color: rgba(255, 167, 38, 0.25); }
        .combo-card.configured { border-color: var(--border-medium); }
        .combo-header { display: flex; gap: 12px; align-items: flex-start; }
        .combo-thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border-subtle); background: var(--bg-elevated); flex-shrink: 0; }
        .combo-thumb-placeholder { width: 56px; height: 56px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; }
        .combo-info { flex: 1; min-width: 0; }
        .combo-title { font-weight: 500; color: var(--text-primary); font-size: 14px; line-height: 1.35; margin-bottom: 4px; }
        .combo-sku { font-family: monospace; font-size: 11px; color: var(--text-muted); word-break: break-all; }

        .combo-status { display: flex; }
        .badge-configured { background: rgba(62, 229, 224, 0.12); color: var(--accent); padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; border: 1px solid var(--border-medium); }
        .badge-unconfigured { background: rgba(255, 167, 38, 0.12); color: var(--warning); padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; border: 1px solid rgba(255, 167, 38, 0.3); }

        .combo-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px 0; border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); }
        .stat { display: flex; flex-direction: column; gap: 2px; }
        .stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
        .stat-value { font-size: 18px; font-weight: 700; color: var(--text-primary); }
        .stat-real { padding: 0 6px; border-left: 1px solid var(--border-subtle); border-right: 1px solid var(--border-subtle); }
        .stat-success { color: var(--success); }
        .stat-warning { color: var(--warning); }
        .stat-danger { color: var(--danger); }

        .btn-toggle-components { background: transparent; border: 1px dashed var(--border-subtle); color: var(--accent); padding: 8px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; display: flex; align-items: center; gap: 8px; justify-content: center; }
        .btn-toggle-components:hover { border-color: var(--accent); }
        .arrow { display: inline-block; transition: transform 0.18s ease; font-size: 10px; }
        .arrow-open { transform: rotate(90deg); }

        .components-list { display: flex; flex-direction: column; gap: 6px; }
        .component-item { display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; gap: 10px; }
        .component-item.missing { border-color: rgba(255, 71, 87, 0.3); }
        .component-info { flex: 1; min-width: 0; }
        .component-title { font-size: 12px; color: var(--text-primary); font-weight: 500; line-height: 1.2; margin-bottom: 2px; }
        .component-sku { font-size: 10px; color: var(--text-muted); font-family: monospace; }
        .component-stock { text-align: right; min-width: 50px; }
        .cs-num { font-size: 16px; font-weight: 700; color: var(--text-primary); }
        .cs-label { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
        .missing-label { font-size: 10px; color: var(--danger); font-weight: 500; }

        .btn-configure { background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%); color: var(--bg-base); border: none; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s ease; }
        .btn-configure:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(62, 229, 224, 0.3); }
      `}</style>
    </div>
  )
}

// ============================================================
// MODAL DE CONFIGURACIÓN DE COMBO
// ============================================================
function ComboModal({ combo, onClose, onSaved }: { combo: Combo; onClose: () => void; onSaved: () => void }) {
  type EditComponent = { component_sku: string; component_title: string; quantity: number }

  const [components, setComponents] = useState<EditComponent[]>(
    combo.components.map(c => ({
      component_sku: c.component_sku,
      component_title: c.component_title,
      quantity: c.quantity,
    }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SkuSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!showSearch || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    const timeout = setTimeout(async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ q: searchQuery.trim(), exclude: combo.sku })
        const res = await fetch(`/api/combos/search-skus?${params.toString()}`, { cache: 'no-store' })
        const json = await res.json()
        if (json.ok) setSearchResults(json.results)
      } catch (err) {
        console.error('Error buscando SKUs:', err)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchQuery, showSearch, combo.sku])

  const addComponent = (sku: string, title: string) => {
    if (components.some(c => c.component_sku === sku)) {
      setError(`El componente ${sku} ya está agregado`)
      return
    }
    setComponents([...components, { component_sku: sku, component_title: title, quantity: 1 }])
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    setError(null)
  }

  const removeComponent = (sku: string) => {
    setComponents(components.filter(c => c.component_sku !== sku))
  }

  const updateQuantity = (sku: string, quantity: number) => {
    setComponents(components.map(c =>
      c.component_sku === sku ? { ...c, quantity: Math.max(1, Math.floor(quantity)) } : c
    ))
  }

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/combos/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_sku: combo.sku,
          components: components.map(c => ({ component_sku: c.component_sku, quantity: c.quantity })),
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error desconocido')
        return
      }
      onSaved()
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Configurar combo</div>
            <div className="modal-subtitle">{combo.title}</div>
            <div className="modal-sku">SKU: {combo.sku}</div>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="section-title">Productos que componen el combo</div>

          {components.length === 0 && !showSearch && (
            <div className="empty-components">
              <p>Aún no hay componentes. Agregá los productos que forman parte de este combo.</p>
            </div>
          )}

          <div className="components-edit-list">
            {components.map(c => (
              <div key={c.component_sku} className="component-edit-row">
                <div className="component-edit-info">
                  <div className="component-edit-title">{c.component_title}</div>
                  <div className="component-edit-sku">{c.component_sku}</div>
                </div>
                <div className="qty-input-wrap">
                  <span className="qty-label">Cantidad</span>
                  <input
                    type="number"
                    min={1}
                    value={c.quantity}
                    onChange={(e) => updateQuantity(c.component_sku, parseInt(e.target.value) || 1)}
                    className="qty-input"
                  />
                </div>
                <button className="btn-remove-component" onClick={() => removeComponent(c.component_sku)}>
                  ✕
                </button>
              </div>
            ))}
          </div>

          {!showSearch && (
            <button className="btn-add-component" onClick={() => setShowSearch(true)}>
              + Agregar componente
            </button>
          )}

          {showSearch && (
            <div className="search-component-section">
              <div className="search-header">
                <input
                  type="text"
                  className="search-component-input"
                  placeholder="Buscar por SKU o título..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                <button className="btn-cancel-search" onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}>
                  Cancelar
                </button>
              </div>
              {searchQuery.trim().length < 2 ? (
                <div className="search-hint">Escribí al menos 2 caracteres...</div>
              ) : searching ? (
                <div className="search-hint">Buscando...</div>
              ) : searchResults.length === 0 ? (
                <div className="search-hint">Sin resultados</div>
              ) : (
                <div className="search-results">
                  {searchResults.map(r => {
                    const alreadyAdded = components.some(c => c.component_sku === r.sku)
                    return (
                      <button
                        key={r.sku}
                        className={`search-result ${alreadyAdded ? 'already-added' : ''}`}
                        onClick={() => !alreadyAdded && addComponent(r.sku, r.title)}
                        disabled={alreadyAdded}
                      >
                        {r.thumbnail
                          ? <img src={r.thumbnail.replace('http://', 'https://')} alt="" className="result-thumb" />
                          : <div className="result-thumb-ph">📦</div>
                        }
                        <div className="result-info">
                          <div className="result-title">{r.title}</div>
                          <div className="result-sku">SKU: {r.sku} · Stock: {r.minStock}</div>
                        </div>
                        {alreadyAdded && <span className="already-tag">Ya agregado</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="error-msg">{error}</div>
        )}

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando...' : '💾 Guardar combo'}
          </button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.15s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 16px; max-width: 720px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
        .modal-header { padding: 20px 24px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
        .modal-title { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600; }
        .modal-subtitle { font-size: 17px; color: var(--text-primary); font-weight: 600; line-height: 1.3; margin-bottom: 4px; }
        .modal-sku { font-family: monospace; font-size: 11px; color: var(--text-muted); }
        .btn-close { background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 14px; flex-shrink: 0; }
        .btn-close:hover { color: var(--text-primary); border-color: var(--border-medium); }

        .modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
        .section-title { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; font-weight: 600; }

        .empty-components { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; background: var(--bg-elevated); border: 1px dashed var(--border-subtle); border-radius: 10px; }

        .components-edit-list { display: flex; flex-direction: column; gap: 8px; }
        .component-edit-row { display: flex; gap: 10px; align-items: center; background: var(--bg-elevated); border: 1px solid var(--border-subtle); padding: 10px 12px; border-radius: 10px; }
        .component-edit-info { flex: 1; min-width: 0; }
        .component-edit-title { font-size: 13px; color: var(--text-primary); font-weight: 500; line-height: 1.3; margin-bottom: 2px; }
        .component-edit-sku { font-family: monospace; font-size: 11px; color: var(--text-muted); }
        .qty-input-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .qty-label { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
        .qty-input { width: 60px; padding: 6px 8px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 6px; color: var(--text-primary); text-align: center; font-family: inherit; outline: none; }
        .qty-input:focus { border-color: var(--accent); }
        .btn-remove-component { background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); width: 32px; height: 32px; border-radius: 8px; cursor: pointer; flex-shrink: 0; }
        .btn-remove-component:hover { color: var(--danger); border-color: rgba(255, 71, 87, 0.4); }

        .btn-add-component { margin-top: 12px; width: 100%; background: transparent; border: 1px dashed var(--border-medium); color: var(--accent); padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-add-component:hover { background: rgba(62, 229, 224, 0.05); }

        .search-component-section { margin-top: 12px; background: var(--bg-elevated); border: 1px solid var(--border-medium); border-radius: 10px; padding: 12px; }
        .search-header { display: flex; gap: 8px; margin-bottom: 10px; }
        .search-component-input { flex: 1; padding: 9px 12px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); font-family: inherit; outline: none; }
        .search-component-input:focus { border-color: var(--accent); }
        .btn-cancel-search { background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 9px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
        .search-hint { padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px; }
        .search-results { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
        .search-result { display: flex; gap: 10px; align-items: center; padding: 8px 10px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; text-align: left; font-family: inherit; }
        .search-result:hover:not(:disabled) { border-color: var(--accent); }
        .search-result.already-added { opacity: 0.5; cursor: not-allowed; }
        .result-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-subtle); flex-shrink: 0; }
        .result-thumb-ph { width: 36px; height: 36px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .result-info { flex: 1; min-width: 0; }
        .result-title { font-size: 12px; color: var(--text-primary); line-height: 1.2; margin-bottom: 2px; }
        .result-sku { font-size: 10px; color: var(--text-muted); font-family: monospace; }
        .already-tag { font-size: 10px; color: var(--text-muted); background: var(--bg-elevated); padding: 3px 8px; border-radius: 6px; }

        .error-msg { margin: 12px 24px 0; padding: 10px 14px; background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3); border-radius: 8px; color: var(--danger); font-size: 13px; }

        .modal-footer { padding: 16px 24px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; gap: 10px; }
        .btn-cancel { background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 10px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit; }
        .btn-cancel:hover:not(:disabled) { color: var(--text-primary); border-color: var(--border-medium); }
        .btn-save { background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%); color: var(--bg-base); border: none; padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); }
        .btn-save:hover:not(:disabled) { transform: translateY(-1px); }
        .btn-save:disabled, .btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
