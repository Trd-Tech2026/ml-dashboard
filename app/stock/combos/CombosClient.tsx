'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ComponenteRow = {
  child_sku: string
  title: string
  quantity: number
  cost: number | null
  iva_rate: number | null
}

type ComboRow = {
  seller_sku: string
  title: string
  cost_manual: number | null
  costo_calculado: number
  iva_rate: number
  publicaciones: number
  archived_count: number
  estado: 'manual' | 'auto' | 'partial' | 'sin_componentes'
  componentes: ComponenteRow[]
  missing: string[]
}

const formatARS = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

export default function CombosClient() {
  const [combos, setCombos] = useState<ComboRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSku, setEditingSku] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<'todos' | 'sin_componentes' | 'partial' | 'manual' | 'auto'>('todos')
  const [search, setSearch] = useState('')

  const cargar = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/combos', { cache: 'no-store' })
      const data = await res.json()
      if (data.ok) setCombos(data.combos)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const filtrados = combos.filter(c => {
    if (filtro !== 'todos' && c.estado !== filtro) return false
    if (search) {
      const s = search.toLowerCase()
      if (!c.seller_sku.toLowerCase().includes(s) && !c.title.toLowerCase().includes(s)) return false
    }
    return true
  })

  const stats = {
    total: combos.length,
    auto: combos.filter(c => c.estado === 'auto').length,
    manual: combos.filter(c => c.estado === 'manual').length,
    partial: combos.filter(c => c.estado === 'partial').length,
    sin: combos.filter(c => c.estado === 'sin_componentes').length,
  }

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Combos</h1>
          <p className="sub">Mapeá los componentes de cada combo para calcular su costo real</p>
        </div>
        <Link href="/stock" className="back">← Volver a Stock</Link>
      </div>

      <div className="stats">
        <div className="stat-card">
          <div className="stat-num">{stats.total}</div>
          <div className="stat-lbl">Total combos</div>
        </div>
        <div className="stat-card stat-good">
          <div className="stat-num">{stats.auto + stats.manual}</div>
          <div className="stat-lbl">Resueltos</div>
        </div>
        <div className="stat-card stat-warn">
          <div className="stat-num">{stats.partial}</div>
          <div className="stat-lbl">Parciales</div>
        </div>
        <div className="stat-card stat-bad">
          <div className="stat-num">{stats.sin}</div>
          <div className="stat-lbl">Sin resolver</div>
        </div>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Buscar por SKU o título..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="search-input"
        />
        <select value={filtro} onChange={e => setFiltro(e.target.value as any)} className="filter-select">
          <option value="todos">Todos los estados</option>
          <option value="sin_componentes">Sin resolver</option>
          <option value="partial">Parciales (faltan componentes)</option>
          <option value="manual">Mapeo manual cargado</option>
          <option value="auto">Auto-resueltos</option>
        </select>
        <button className="btn-refresh" onClick={cargar} disabled={loading}>
          {loading ? '⏳' : '🔄'} Recargar
        </button>
      </div>

      {loading ? (
        <div className="empty">Cargando...</div>
      ) : filtrados.length === 0 ? (
        <div className="empty">No hay combos con ese filtro.</div>
      ) : (
        <div className="combos-list">
          {filtrados.map(c => (
            <ComboCard
              key={c.seller_sku}
              combo={c}
              isEditing={editingSku === c.seller_sku}
              onEdit={() => setEditingSku(c.seller_sku)}
              onClose={() => setEditingSku(null)}
              onSaved={cargar}
            />
          ))}
        </div>
      )}

      <style jsx>{`
        .page { padding: 24px 40px 48px; max-width: 1500px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; gap: 16px; flex-wrap: wrap; }
        .header h1 { margin: 0 0 4px; font-size: 26px; font-weight: 600; color: var(--text-primary); }
        .sub { margin: 0; font-size: 13px; color: var(--text-muted); }
        .back { color: var(--text-muted); text-decoration: none; font-size: 13px; padding: 6px 0; }
        .back:hover { color: #3ee5e0; }

        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .stat-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px 18px; }
        .stat-good { border-color: rgba(62, 229, 224, 0.3); }
        .stat-warn { border-color: rgba(255, 167, 38, 0.3); }
        .stat-bad { border-color: rgba(239, 68, 68, 0.3); }
        .stat-num { font-size: 26px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
        .stat-good .stat-num { color: #3ee5e0; }
        .stat-warn .stat-num { color: #fbbf24; }
        .stat-bad .stat-num { color: #f87171; }
        .stat-lbl { font-size: 11px; color: var(--text-muted); letter-spacing: 0.5px; margin-top: 2px; }

        .filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .search-input, .filter-select {
          background: var(--bg-card); color: var(--text-primary);
          border: 1px solid var(--border-subtle); border-radius: 10px;
          padding: 10px 14px; font-size: 13px; font-family: inherit;
        }
        .search-input { flex: 1; min-width: 200px; }
        .btn-refresh {
          background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border-subtle);
          border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .btn-refresh:hover { border-color: #3ee5e0; color: #3ee5e0; }

        .empty { color: var(--text-muted); text-align: center; padding: 40px; background: var(--bg-card); border-radius: 12px; }

        .combos-list { display: flex; flex-direction: column; gap: 10px; }

        @media (max-width: 768px) {
          .page { padding: 16px; }
          .stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  )
}

function ComboCard({
  combo, isEditing, onEdit, onClose, onSaved,
}: {
  combo: ComboRow
  isEditing: boolean
  onEdit: () => void
  onClose: () => void
  onSaved: () => void
}) {
  const [skusInput, setSkusInput] = useState(
    combo.estado === 'manual' ? combo.componentes.map(c => c.child_sku).join('\n') : ''
  )
  const [saving, setSaving] = useState(false)

  const guardar = async () => {
    setSaving(true)
    try {
      const skus = skusInput.split('\n').map(s => s.trim()).filter(Boolean)
      const res = await fetch('/api/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_sku: combo.seller_sku,
          components: skus.map(s => ({ child_sku: s, quantity: 1 })),
        })
      })
      const data = await res.json()
      if (data.ok) {
        onSaved()
        onClose()
      } else {
        alert('Error: ' + data.error)
      }
    } finally {
      setSaving(false)
    }
  }

  const eliminar = async () => {
    if (!confirm('¿Eliminar el mapeo manual de este combo?')) return
    setSaving(true)
    try {
      await fetch(`/api/combos?parent_sku=${encodeURIComponent(combo.seller_sku)}`, { method: 'DELETE' })
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const estadoLabel = {
    manual: { txt: 'Manual', color: '#3ee5e0' },
    auto: { txt: 'Auto', color: '#22c55e' },
    partial: { txt: 'Parcial', color: '#fbbf24' },
    sin_componentes: { txt: 'Sin resolver', color: '#f87171' },
  }[combo.estado]

  return (
    <div className="combo-card">
      <div className="combo-row">
        <div className="combo-info">
          <div className="combo-title">{combo.title}</div>
          <div className="combo-sku">{combo.seller_sku}</div>
          <div className="combo-meta">
            {combo.publicaciones} {combo.publicaciones === 1 ? 'publicación' : 'publicaciones'}
            {combo.archived_count > 0 && <span> · {combo.archived_count} archivada{combo.archived_count === 1 ? '' : 's'}</span>}
          </div>
        </div>

        <div className="combo-costs">
          <div className="cost-item">
            <div className="cost-lbl">Cost manual</div>
            <div className="cost-val">{combo.cost_manual ? formatARS(combo.cost_manual) : '—'}</div>
          </div>
          <div className="cost-item">
            <div className="cost-lbl">Cost calculado</div>
            <div className="cost-val cost-calc">{combo.costo_calculado > 0 ? formatARS(combo.costo_calculado) : '—'}</div>
          </div>
          <div className="combo-estado" style={{ color: estadoLabel.color, borderColor: estadoLabel.color + '40' }}>
            {estadoLabel.txt}
          </div>
          <button className="btn-edit" onClick={isEditing ? onClose : onEdit}>
            {isEditing ? 'Cerrar' : 'Editar'}
          </button>
        </div>
      </div>

      {!isEditing && combo.componentes.length > 0 && (
        <div className="combo-comps">
          <div className="comps-title">Componentes</div>
          {combo.componentes.map((c, i) => (
            <div key={i} className="comp-row">
              <span className="comp-qty">{c.quantity}×</span>
              <span className="comp-sku">{c.child_sku}</span>
              <span className="comp-title">{c.title}</span>
              <span className="comp-cost">{c.cost ? formatARS(c.cost * c.quantity) : '—'}</span>
            </div>
          ))}
          {combo.missing.length > 0 && (
            <div className="comp-missing">
              ⚠️ Faltan componentes: {combo.missing.join(', ')}
            </div>
          )}
        </div>
      )}

      {isEditing && (
        <div className="combo-edit">
          <label className="edit-lbl">SKUs componentes (uno por línea):</label>
          <textarea
            value={skusInput}
            onChange={e => setSkusInput(e.target.value)}
            placeholder={`Ej:\nAT-JAR-PE1821AP2\nAT-COC-CA2180P\nAT-COC-T02180WP`}
            rows={6}
            className="edit-textarea"
          />
          <div className="edit-actions">
            <button className="btn-save" onClick={guardar} disabled={saving}>
              {saving ? '⏳' : '💾'} Guardar
            </button>
            {combo.estado === 'manual' && (
              <button className="btn-delete" onClick={eliminar} disabled={saving}>
                🗑️ Borrar mapeo
              </button>
            )}
            <button className="btn-cancel" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      )}

      <style jsx>{`
        .combo-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 14px 18px;
        }
        .combo-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .combo-info { flex: 1; min-width: 220px; }
        .combo-title { font-size: 14px; font-weight: 500; color: var(--text-primary); margin-bottom: 4px; }
        .combo-sku { font-size: 12px; color: #94e8e6; font-family: monospace; }
        .combo-meta { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

        .combo-costs { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .cost-item { display: flex; flex-direction: column; align-items: flex-end; }
        .cost-lbl { font-size: 10px; color: var(--text-muted); letter-spacing: 0.5px; }
        .cost-val { font-size: 13px; font-weight: 500; color: var(--text-primary); font-variant-numeric: tabular-nums; }
        .cost-calc { color: #3ee5e0; }
        .combo-estado {
          font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 8px;
          border: 1px solid; letter-spacing: 0.5px;
        }
        .btn-edit {
          background: rgba(28, 160, 196, 0.1); color: #3ee5e0;
          border: 1px solid rgba(62, 229, 224, 0.3);
          border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; font-family: inherit; font-weight: 500;
        }
        .btn-edit:hover { background: rgba(28, 160, 196, 0.2); }

        .combo-comps {
          margin-top: 12px; padding-top: 12px;
          border-top: 1px solid var(--border-subtle);
        }
        .comps-title { font-size: 10px; color: var(--text-muted); letter-spacing: 1px; margin-bottom: 8px; font-weight: 600; }
        .comp-row {
          display: grid;
          grid-template-columns: 30px 200px 1fr auto;
          gap: 10px;
          padding: 4px 0;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .comp-qty { color: #3ee5e0; font-weight: 500; }
        .comp-sku { font-family: monospace; color: #94e8e6; }
        .comp-title { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .comp-cost { font-variant-numeric: tabular-nums; color: var(--text-primary); }
        .comp-missing {
          margin-top: 8px; padding: 6px 10px;
          background: rgba(255, 167, 38, 0.1); border: 1px solid rgba(255, 167, 38, 0.3);
          border-radius: 6px; font-size: 11px; color: #fbbf24;
        }

        .combo-edit {
          margin-top: 12px; padding-top: 12px;
          border-top: 1px solid var(--border-subtle);
        }
        .edit-lbl { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; display: block; }
        .edit-textarea {
          width: 100%; box-sizing: border-box;
          background: rgba(10, 18, 28, 0.5); color: var(--text-primary);
          border: 1px solid var(--border-subtle); border-radius: 8px;
          padding: 10px 12px; font-family: monospace; font-size: 12px;
          resize: vertical; min-height: 90px;
        }
        .edit-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
        .btn-save, .btn-cancel, .btn-delete {
          padding: 8px 14px; border-radius: 8px; font-size: 12px;
          cursor: pointer; font-family: inherit; font-weight: 500;
        }
        .btn-save {
          background: linear-gradient(135deg, #1ca0c4, #3ee5e0); color: #0a121c; border: none;
        }
        .btn-cancel {
          background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle);
        }
        .btn-delete {
          background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);
        }
      `}</style>
    </div>
  )
}