'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type TaxConfig = {
  id: number
  name: string
  type: string
  percentage: number
  jurisdiction: string | null
  active: boolean
  notes: string | null
  updated_at: string
}

type ItemSinCosto = {
  item_id: string
  title: string
  thumbnail: string | null
  iva_rate: number
  vendidos: number
}

type Props = {
  onClose: () => void
}

const JURISDICTIONS = [
  { value: 'multilateral', label: 'Convenio multilateral' },
  { value: 'caba', label: 'CABA' },
  { value: 'bsas', label: 'Buenos Aires (provincia)' },
  { value: 'cordoba', label: 'Córdoba' },
  { value: 'santafe', label: 'Santa Fe' },
  { value: 'mendoza', label: 'Mendoza' },
  { value: 'other', label: 'Otra' },
]

export default function ConfigModal({ onClose }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'taxes' | 'items'>('taxes')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [taxConfigs, setTaxConfigs] = useState<TaxConfig[]>([])
  const [itemsStats, setItemsStats] = useState({ total: 0, conCosto: 0, sinCosto: 0 })

  // Items sin costo
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemsSinCosto, setItemsSinCosto] = useState<ItemSinCosto[]>([])
  const [daysFilter, setDaysFilter] = useState(30)

  // Form de IIBB
  const [iibbId, setIibbId] = useState<number | null>(null)
  const [iibbPercentage, setIibbPercentage] = useState('')
  const [iibbJurisdiction, setIibbJurisdiction] = useState('multilateral')
  const [iibbNotes, setIibbNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/config/get', { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error al cargar')
        return
      }
      setTaxConfigs(json.taxConfigs ?? [])
      setItemsStats(json.itemsStats ?? { total: 0, conCosto: 0, sinCosto: 0 })

      // Cargar el IIBB activo en el form
      const iibbActivo = (json.taxConfigs ?? []).find((t: TaxConfig) => t.type === 'iibb' && t.active)
      if (iibbActivo) {
        setIibbId(iibbActivo.id)
        setIibbPercentage(String(iibbActivo.percentage))
        setIibbJurisdiction(iibbActivo.jurisdiction ?? 'multilateral')
        setIibbNotes(iibbActivo.notes ?? '')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const fetchItemsSinCosto = useCallback(async (days: number) => {
    setLoadingItems(true)
    try {
      const res = await fetch(`/api/config/items-without-cost?days=${days}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) {
        setItemsSinCosto(json.items ?? [])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingItems(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'items') {
      fetchItemsSinCosto(daysFilter)
    }
  }, [activeTab, daysFilter, fetchItemsSinCosto])

  const handleSaveIibb = async () => {
    setError(null)
    setSuccess(null)
    const pct = parseFloat(iibbPercentage)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setError('El porcentaje debe ser un número entre 0 y 100')
      return
    }
    if (!iibbId) {
      setError('No hay registro de IIBB para actualizar. Recargá la página.')
      return
    }

    setSaving(true)
    try {
      const jurisdictionLabel = JURISDICTIONS.find(j => j.value === iibbJurisdiction)?.label ?? 'IIBB'
      const res = await fetch('/api/config/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: iibbId,
          percentage: pct,
          name: `IIBB ${jurisdictionLabel}`,
          jurisdiction: iibbJurisdiction,
          notes: iibbNotes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error al guardar')
        return
      }
      setSuccess('✓ Configuración guardada')
      await fetchConfig()
      router.refresh()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setSaving(false)
    }
  }

  const formatPct = (p: number) => `${Number(p).toFixed(p % 1 === 0 ? 0 : 2)}%`

  const cobertura = itemsStats.total > 0 ? (itemsStats.conCosto / itemsStats.total) * 100 : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>⚙️ Configuración</h2>
            <p className="modal-subtitle">Parámetros del cálculo de rentabilidad</p>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'taxes' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('taxes')}
          >
            🧾 Impuestos
          </button>
          <button
            className={`tab ${activeTab === 'items' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('items')}
          >
            📦 Items sin costo
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <p className="empty">Cargando...</p>
          ) : activeTab === 'taxes' ? (
            <>
              {/* === IIBB === */}
              <div className="config-section">
                <div className="section-title">
                  <span className="section-emoji">📊</span>
                  <div>
                    <h3>IIBB (Ingresos Brutos)</h3>
                    <p className="section-desc">Se descuenta de la facturación total para calcular la ganancia neta.</p>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-row">
                    <label>Jurisdicción</label>
                    <select value={iibbJurisdiction} onChange={e => setIibbJurisdiction(e.target.value)}>
                      {JURISDICTIONS.map(j => (
                        <option key={j.value} value={j.value}>{j.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-row">
                    <label>Porcentaje (%)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0"
                      max="100"
                      value={iibbPercentage}
                      onChange={e => setIibbPercentage(e.target.value)}
                      placeholder="Ej: 5"
                    />
                  </div>

                  <div className="form-row form-row-full">
                    <label>Notas internas (opcional)</label>
                    <textarea
                      rows={2}
                      value={iibbNotes}
                      onChange={e => setIibbNotes(e.target.value)}
                      placeholder='Ej: "Régimen general SUSS, julio 2025"'
                    />
                  </div>
                </div>

                {error && <div className="msg msg-error">⚠️ {error}</div>}
                {success && <div className="msg msg-success">{success}</div>}

                <button className="btn-save" onClick={handleSaveIibb} disabled={saving}>
                  {saving ? '⏳ Guardando...' : '💾 Guardar configuración'}
                </button>
              </div>

              {/* === IVA INFO === */}
              <div className="info-card">
                <div className="info-icon">💡</div>
                <div className="info-text">
                  <strong>Sobre el IVA</strong>
                  <p>
                    El IVA se aplica por producto. Por defecto cada item tiene 21%, pero podés cambiarlo
                    individualmente desde el panel de Stock (próximamente, Entrega 5).
                  </p>
                  <p className="info-hint">
                    El costo de mercadería en el cálculo se hace sumando: <code>cost × (1 + iva/100) × cantidad</code>
                  </p>
                </div>
              </div>

              {/* Lista de configs activas */}
              <div className="configs-list">
                <h4>Configuración activa</h4>
                {taxConfigs.filter(t => t.active).map(t => (
                  <div key={t.id} className="config-row">
                    <div className="config-row-info">
                      <div className="config-row-name">{t.name}</div>
                      <div className="config-row-meta">
                        {t.jurisdiction && <span>{t.jurisdiction}</span>}
                        {t.notes && <span className="config-row-notes">· {t.notes}</span>}
                      </div>
                    </div>
                    <div className="config-row-pct">{formatPct(t.percentage)}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            // === TAB ITEMS SIN COSTO ===
            <>
              <div className="cobertura-card">
                <div className="cobertura-header">
                  <span className="cobertura-emoji">📦</span>
                  <div>
                    <h3>Cobertura de costos</h3>
                    <p>Items con costo cargado vs total de items activos</p>
                  </div>
                </div>
                <div className="cobertura-stats">
                  <div className="cobertura-stat">
                    <div className="cobertura-stat-value">{itemsStats.conCosto}</div>
                    <div className="cobertura-stat-label">Con costo</div>
                  </div>
                  <div className="cobertura-stat">
                    <div className="cobertura-stat-value text-warning">{itemsStats.sinCosto}</div>
                    <div className="cobertura-stat-label">Sin costo</div>
                  </div>
                  <div className="cobertura-stat">
                    <div className="cobertura-stat-value text-accent">{cobertura.toFixed(0)}%</div>
                    <div className="cobertura-stat-label">Cobertura</div>
                  </div>
                </div>
                <div className="cobertura-bar">
                  <div className="cobertura-bar-fill" style={{ width: `${cobertura}%` }} />
                </div>
              </div>

              <div className="filter-row">
                <label>Items vendidos en los últimos:</label>
                <div className="day-buttons">
                  {[7, 30, 90, 180].map(d => (
                    <button
                      key={d}
                      className={`day-btn ${daysFilter === d ? 'day-btn-active' : ''}`}
                      onClick={() => setDaysFilter(d)}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              {loadingItems ? (
                <p className="empty">Cargando...</p>
              ) : itemsSinCosto.length === 0 ? (
                <div className="empty-box success-box">
                  <p>🎉 ¡Todos los items vendidos en los últimos {daysFilter} días tienen costo cargado!</p>
                </div>
              ) : (
                <>
                  <div className="alert-box">
                    <span>⚠️</span>
                    <span>
                      <strong>{itemsSinCosto.length} items vendidos sin costo cargado.</strong>
                      {' '}Los precios de venta de estos productos están sumando a la facturación pero NO descontando costo merca, distorsionando la ganancia real.
                    </span>
                  </div>

                  <div className="items-list">
                    {itemsSinCosto.slice(0, 50).map(it => (
                      <div key={it.item_id} className="item-row">
                        {it.thumbnail
                          ? <img src={it.thumbnail.replace('http://', 'https://')} alt="" className="item-thumb" />
                          : <div className="item-thumb-ph">📦</div>
                        }
                        <div className="item-info">
                          <div className="item-title">{it.title}</div>
                          <div className="item-meta">
                            <span className="item-id">{it.item_id}</span>
                            <span>·</span>
                            <span><strong>{it.vendidos}</strong> vendidos en {daysFilter}d</span>
                            <span>·</span>
                            <span>IVA {it.iva_rate}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {itemsSinCosto.length > 50 && (
                      <p className="more-items">... y {itemsSinCosto.length - 50} más</p>
                    )}
                  </div>

                  <div className="info-card">
                    <div className="info-icon">💡</div>
                    <div className="info-text">
                      <p>Para cargar el costo, andá a <strong>Stock → Productos</strong> y editá cada uno. Próximamente vamos a agregar carga masiva.</p>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cerrar</button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
          z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px;
          animation: fadeIn 0.15s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal {
          background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 16px;
          max-width: 720px; width: 100%; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden;
        }
        .modal-header {
          padding: 20px 24px 16px; border-bottom: 1px solid var(--border-subtle);
          display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
        }
        .modal-header h2 { margin: 0 0 4px; font-size: 20px; color: var(--text-primary); font-weight: 700; }
        .modal-subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }
        .btn-close {
          background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted);
          width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 14px; flex-shrink: 0; font-family: inherit;
        }
        .btn-close:hover { color: var(--text-primary); border-color: var(--border-medium); }

        .tabs {
          display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid var(--border-subtle);
        }
        .tab {
          background: transparent; border: none; padding: 12px 16px; color: var(--text-muted);
          font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
          border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s ease;
        }
        .tab:hover { color: var(--text-secondary); }
        .tab.tab-active { color: var(--accent); border-bottom-color: var(--accent); }

        .modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 20px; }

        .config-section {
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px;
        }
        .section-title { display: flex; gap: 12px; align-items: flex-start; }
        .section-emoji { font-size: 28px; flex-shrink: 0; line-height: 1; margin-top: 2px; }
        .section-title h3 { margin: 0 0 4px; font-size: 16px; color: var(--text-primary); font-weight: 700; }
        .section-desc { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4; }

        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .form-row { display: flex; flex-direction: column; gap: 6px; }
        .form-row-full { grid-column: 1 / -1; }
        .form-row label {
          font-size: 11px; color: var(--text-muted); font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.4px;
        }
        .form-row input, .form-row textarea, .form-row select {
          padding: 9px 11px; background: var(--bg-base); border: 1px solid var(--border-subtle);
          border-radius: 8px; font-size: 13px; color: var(--text-primary); font-family: inherit; outline: none;
          transition: border-color 0.15s ease;
        }
        .form-row input:focus, .form-row textarea:focus, .form-row select:focus { border-color: var(--accent); }
        .form-row textarea { resize: vertical; }

        .msg {
          padding: 8px 12px; border-radius: 8px; font-size: 13px;
        }
        .msg-error { background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3); color: var(--danger); }
        .msg-success { background: rgba(62, 229, 224, 0.08); border: 1px solid var(--border-medium); color: var(--accent); }

        .btn-save {
          background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%);
          color: var(--bg-base); border: none; padding: 11px 20px; border-radius: 10px;
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); align-self: flex-start;
        }
        .btn-save:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4); }
        .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

        .info-card {
          display: flex; gap: 12px; padding: 14px 16px;
          background: rgba(62, 229, 224, 0.05); border: 1px solid rgba(62, 229, 224, 0.2);
          border-radius: 10px;
        }
        .info-icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
        .info-text { flex: 1; }
        .info-text strong { display: block; color: var(--text-primary); font-size: 13px; margin-bottom: 4px; }
        .info-text p { margin: 0 0 4px; font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
        .info-text p:last-child { margin-bottom: 0; }
        .info-hint { font-size: 11px !important; color: var(--text-muted) !important; }
        .info-text code { font-family: monospace; font-size: 11px; background: var(--bg-base); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border-subtle); }

        .configs-list { display: flex; flex-direction: column; gap: 8px; }
        .configs-list h4 {
          margin: 0 0 4px; font-size: 11px; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
        }
        .config-row {
          display: flex; justify-content: space-between; align-items: center;
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          border-radius: 8px; padding: 10px 14px;
        }
        .config-row-name { font-size: 13px; color: var(--text-primary); font-weight: 500; }
        .config-row-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .config-row-notes { font-style: italic; }
        .config-row-pct {
          font-size: 18px; font-weight: 700; color: var(--accent);
          font-variant-numeric: tabular-nums; flex-shrink: 0;
        }

        /* === COBERTURA === */
        .cobertura-card {
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          border-radius: 12px; padding: 18px 20px;
        }
        .cobertura-header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
        .cobertura-emoji { font-size: 28px; flex-shrink: 0; line-height: 1; margin-top: 2px; }
        .cobertura-header h3 { margin: 0 0 4px; font-size: 16px; color: var(--text-primary); font-weight: 700; }
        .cobertura-header p { margin: 0; font-size: 12px; color: var(--text-muted); }
        .cobertura-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
        .cobertura-stat { text-align: center; }
        .cobertura-stat-value { font-size: 26px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1; }
        .cobertura-stat-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .text-warning { color: var(--warning); }
        .text-accent { color: var(--accent); }
        .cobertura-bar {
          height: 8px; background: var(--bg-base); border-radius: 4px; overflow: hidden;
          border: 1px solid var(--border-subtle);
        }
        .cobertura-bar-fill {
          height: 100%; background: linear-gradient(90deg, var(--accent-deep) 0%, var(--accent) 100%);
          transition: width 0.3s ease;
        }

        .filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .filter-row label { font-size: 13px; color: var(--text-secondary); }
        .day-buttons { display: flex; gap: 4px; }
        .day-btn {
          background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-secondary);
          padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600;
          cursor: pointer; font-family: inherit;
        }
        .day-btn:hover { border-color: var(--border-medium); color: var(--text-primary); }
        .day-btn.day-btn-active {
          background: rgba(62, 229, 224, 0.12); color: var(--accent); border-color: var(--accent);
        }

        .alert-box {
          display: flex; gap: 10px; padding: 12px 14px;
          background: rgba(255, 167, 38, 0.08); border: 1px solid rgba(255, 167, 38, 0.3);
          border-radius: 10px; font-size: 13px; color: var(--text-secondary); line-height: 1.4;
        }
        .alert-box strong { color: var(--warning); }

        .items-list { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; padding-right: 4px; }
        .item-row {
          display: flex; gap: 10px; align-items: center; padding: 9px 11px;
          background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 10px;
        }
        .item-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-subtle); flex-shrink: 0; background: var(--bg-base); }
        .item-thumb-ph { width: 36px; height: 36px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .item-info { flex: 1; min-width: 0; }
        .item-title { font-size: 12px; color: var(--text-primary); line-height: 1.3; margin-bottom: 2px; }
        .item-meta { font-size: 10px; color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
        .item-id { font-family: monospace; }
        .more-items { text-align: center; color: var(--text-muted); font-size: 12px; font-style: italic; padding: 8px; }
        .empty-box {
          background: var(--bg-elevated); border: 1px dashed var(--border-subtle); border-radius: 10px;
          padding: 24px; text-align: center;
        }
        .success-box { background: rgba(62, 229, 224, 0.04); border-color: rgba(62, 229, 224, 0.3); color: var(--accent); }
        .empty-box p { margin: 0; font-size: 13px; }
        .empty { color: var(--text-muted); font-size: 13px; text-align: center; padding: 16px; }

        .modal-footer {
          padding: 14px 24px; border-top: 1px solid var(--border-subtle);
          display: flex; justify-content: flex-end; gap: 10px;
        }
        .btn-cancel {
          background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle);
          padding: 9px 18px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit;
        }
        .btn-cancel:hover { color: var(--text-primary); border-color: var(--border-medium); }

        @media (max-width: 600px) {
          .form-grid { grid-template-columns: 1fr; }
          .cobertura-stats { gap: 8px; }
          .cobertura-stat-value { font-size: 20px; }
        }
      `}</style>
    </div>
  )
}
