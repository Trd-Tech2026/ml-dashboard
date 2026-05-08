'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type QuickExpense = {
  id: number
  date: string
  amount: number
  category: string
  description: string | null
  created_at: string
}

type Props = {
  onClose: () => void
}

const CATEGORIES = [
  { value: 'packaging', label: 'Packaging', emoji: '📦' },
  { value: 'envios', label: 'Envíos manuales', emoji: '🚚' },
  { value: 'servicios', label: 'Servicios', emoji: '⚡' },
  { value: 'banco', label: 'Comisión banco', emoji: '🏦' },
  { value: 'impuestos', label: 'Impuestos', emoji: '📋' },
  { value: 'otro', label: 'Otro', emoji: '📌' },
]

function categoryLabel(c: string): string {
  return CATEGORIES.find(x => x.value === c)?.label ?? c
}
function categoryEmoji(c: string): string {
  return CATEGORIES.find(x => x.value === c)?.emoji ?? '📌'
}

function todayISO(): string {
  const d = new Date()
  const ar = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
  return ar
}

export default function GastoRapidoModal({ onClose }: Props) {
  const router = useRouter()
  const [expenses, setExpenses] = useState<QuickExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('otro')
  const [description, setDescription] = useState('')

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/expenses/list?limit=200', { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error al cargar')
      } else {
        setExpenses(json.expenses ?? [])
      }
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchExpenses() }, [fetchExpenses])

  const resetForm = () => {
    setEditingId(null)
    setDate(todayISO())
    setAmount('')
    setCategory('otro')
    setDescription('')
    setError(null)
  }

  const handleSave = async () => {
    setError(null)
    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('El monto tiene que ser un número mayor a 0')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/expenses/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          date,
          amount: amountNum,
          category,
          description: description.trim() || null,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error al guardar')
        return
      }
      resetForm()
      await fetchExpenses()
      router.refresh()
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (e: QuickExpense) => {
    setEditingId(e.id)
    setDate(e.date)
    setAmount(String(e.amount))
    setCategory(e.category)
    setDescription(e.description ?? '')
    setError(null)
  }

  const handleDelete = async (e: QuickExpense) => {
    if (!window.confirm(`¿Borrar gasto de ${formatARS(e.amount)} (${categoryLabel(e.category)} - ${formatDate(e.date)})?\n\nNo se puede deshacer.`)) return
    setDeletingId(e.id)
    try {
      const res = await fetch('/api/expenses/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: e.id }),
      })
      const json = await res.json()
      if (!json.ok) {
        alert(`Error: ${json.error}`)
        return
      }
      if (editingId === e.id) resetForm()
      await fetchExpenses()
      router.refresh()
    } catch (err: any) {
      alert(`Error: ${err?.message ?? 'red'}`)
    } finally {
      setDeletingId(null)
    }
  }

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const formatDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00-03:00')
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0)

  // Totales por categoría
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount ?? 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>💸 Gasto rápido</h2>
            <p className="modal-subtitle">Cargá gastos varios (packaging, envíos manuales, servicios, etc.) que no son Ads</p>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="form-section">
            <div className="form-title">
              {editingId ? '✏️ Editar gasto' : '➕ Nuevo gasto'}
              {editingId && (
                <button className="btn-mini" onClick={resetForm}>Cancelar edición</button>
              )}
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label>Fecha *</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  max={todayISO()}
                />
              </div>

              <div className="form-row">
                <label>Monto (ARS) *</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="Ej: 5000"
                />
              </div>

              <div className="form-row form-row-full">
                <label>Categoría *</label>
                <div className="categories">
                  {CATEGORIES.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`cat-btn ${category === c.value ? 'cat-active' : ''}`}
                      onClick={() => setCategory(c.value)}
                    >
                      <span>{c.emoji}</span>
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-row form-row-full">
                <label>Detalle (opcional)</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder='Ej: "Caja chica + cinta", "Envío extra a Ezeiza", "Luz Edenor", etc.'
                />
              </div>
            </div>

            {error && <div className="error-msg">⚠️ {error}</div>}

            <button
              className="btn-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '⏳ Guardando...' : editingId ? '💾 Guardar cambios' : '✓ Guardar gasto'}
            </button>
          </div>

          {/* Resumen por categoría si hay gastos */}
          {Object.keys(byCategory).length > 0 && (
            <div className="summary-by-cat">
              {CATEGORIES.filter(c => byCategory[c.value] > 0).map(c => (
                <div key={c.value} className="cat-summary">
                  <span className="cat-summary-emoji">{c.emoji}</span>
                  <div className="cat-summary-info">
                    <div className="cat-summary-label">{c.label}</div>
                    <div className="cat-summary-amount">{formatARS(byCategory[c.value])}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="list-section">
            <div className="list-header">
              <h3>Gastos cargados ({expenses.length})</h3>
              <span className="list-total">Total: {formatARS(total)}</span>
            </div>

            {loading ? (
              <p className="empty">Cargando...</p>
            ) : expenses.length === 0 ? (
              <div className="empty-box">
                <p>No hay gastos rápidos cargados todavía.</p>
                <p className="empty-hint">Cargá el primero usando el formulario de arriba 👆</p>
              </div>
            ) : (
              <div className="expenses-list">
                {expenses.map(e => (
                  <div key={e.id} className={`expense-row ${editingId === e.id ? 'expense-editing' : ''}`}>
                    <div className="expense-emoji">{categoryEmoji(e.category)}</div>
                    <div className="expense-info">
                      <div className="expense-line-1">
                        <span className="expense-amount">{formatARS(e.amount)}</span>
                        <span className="expense-cat">{categoryLabel(e.category)}</span>
                      </div>
                      <div className="expense-line-2">
                        <span className="expense-date">{formatDate(e.date)}</span>
                      </div>
                      {e.description && <div className="expense-desc">{e.description}</div>}
                    </div>
                    <div className="expense-actions">
                      <button
                        className="btn-mini"
                        onClick={() => handleEdit(e)}
                        disabled={deletingId === e.id}
                        title="Editar"
                      >
                        ✏️
                      </button>
                      <button
                        className="btn-mini btn-mini-danger"
                        onClick={() => handleDelete(e)}
                        disabled={deletingId === e.id}
                        title="Borrar"
                      >
                        {deletingId === e.id ? '⏳' : '🗑️'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
          padding: 20px 24px; border-bottom: 1px solid var(--border-subtle);
          display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
        }
        .modal-header h2 { margin: 0 0 4px; font-size: 20px; color: var(--text-primary); font-weight: 700; }
        .modal-subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }
        .btn-close {
          background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted);
          width: 36px; height: 36px; border-radius: 8px; cursor: pointer; font-size: 14px;
          flex-shrink: 0; font-family: inherit;
        }
        .btn-close:hover { color: var(--text-primary); border-color: var(--border-medium); }

        .modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 20px; }

        .form-section {
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;
        }
        .form-title {
          font-size: 13px; color: var(--text-secondary); font-weight: 600;
          display: flex; justify-content: space-between; align-items: center;
        }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .form-row { display: flex; flex-direction: column; gap: 6px; }
        .form-row-full { grid-column: 1 / -1; }
        .form-row label {
          font-size: 11px; color: var(--text-muted); font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.4px;
        }
        .form-row input, .form-row textarea {
          padding: 9px 11px; background: var(--bg-base); border: 1px solid var(--border-subtle);
          border-radius: 8px; font-size: 13px; color: var(--text-primary); font-family: inherit; outline: none;
          transition: border-color 0.15s ease;
        }
        .form-row input:focus, .form-row textarea:focus { border-color: var(--accent); }
        .form-row textarea { resize: vertical; }

        .categories { display: flex; flex-wrap: wrap; gap: 6px; }
        .cat-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 11px; background: var(--bg-base); color: var(--text-secondary);
          border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 12px;
          cursor: pointer; font-family: inherit; transition: all 0.15s ease;
        }
        .cat-btn:hover { color: var(--text-primary); }
        .cat-btn.cat-active {
          background: rgba(255, 167, 38, 0.12); color: var(--warning); border-color: var(--warning);
        }

        .error-msg {
          padding: 8px 12px; background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3);
          border-radius: 8px; color: var(--danger); font-size: 13px;
        }

        .btn-save {
          background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
          color: #1a1a1a; border: none; padding: 11px 20px; border-radius: 10px;
          font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25); align-self: flex-start;
        }
        .btn-save:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4); }
        .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-mini {
          background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border-subtle);
          padding: 5px 9px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit;
        }
        .btn-mini:hover:not(:disabled) { border-color: var(--border-medium); color: var(--text-primary); }
        .btn-mini-danger:hover:not(:disabled) { border-color: rgba(255, 71, 87, 0.4); color: var(--danger); }
        .btn-mini:disabled { opacity: 0.5; cursor: not-allowed; }

        .summary-by-cat {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px;
        }
        .cat-summary {
          display: flex; gap: 8px; align-items: center;
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          border-radius: 10px; padding: 10px 12px;
        }
        .cat-summary-emoji { font-size: 18px; flex-shrink: 0; }
        .cat-summary-info { min-width: 0; flex: 1; }
        .cat-summary-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
        .cat-summary-amount { font-size: 13px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; margin-top: 2px; }

        .list-section { display: flex; flex-direction: column; gap: 10px; }
        .list-header {
          display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
        }
        .list-header h3 { margin: 0; font-size: 14px; color: var(--text-primary); font-weight: 600; }
        .list-total {
          font-size: 13px; color: var(--warning); font-weight: 700;
          background: rgba(255, 167, 38, 0.08); padding: 4px 12px; border-radius: 8px;
          border: 1px solid rgba(255, 167, 38, 0.3);
        }
        .empty { color: var(--text-muted); font-size: 13px; text-align: center; padding: 16px; }
        .empty-box {
          background: var(--bg-elevated); border: 1px dashed var(--border-subtle); border-radius: 10px;
          padding: 24px; text-align: center;
        }
        .empty-box p { margin: 0; color: var(--text-muted); font-size: 13px; }
        .empty-hint { margin-top: 6px !important; font-style: italic; }

        .expenses-list { display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow-y: auto; padding-right: 4px; }
        .expense-row {
          display: flex; gap: 12px; align-items: center; padding: 10px 12px;
          background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 10px;
          transition: all 0.15s ease;
        }
        .expense-row:hover { border-color: var(--border-medium); }
        .expense-row.expense-editing { border-color: var(--warning); background: rgba(255, 167, 38, 0.04); }
        .expense-emoji { font-size: 20px; flex-shrink: 0; }
        .expense-info { flex: 1; min-width: 0; }
        .expense-line-1 { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .expense-amount { font-size: 14px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
        .expense-cat { font-size: 11px; color: var(--text-secondary); }
        .expense-line-2 { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .expense-desc { font-size: 11px; color: var(--text-dim); margin-top: 4px; font-style: italic; }
        .expense-actions { display: flex; gap: 4px; flex-shrink: 0; }

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
        }
      `}</style>
    </div>
  )
}
