'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type AdExpense = {
  id: number
  date: string
  amount: number
  platform: string
  campaign: string | null
  description: string | null
  created_at: string
}

type Props = {
  onClose: () => void
}

const PLATFORMS = [
  { value: 'meli', label: 'Mercado Libre Ads', emoji: '🟡' },
  { value: 'meta', label: 'Meta (Instagram/Facebook)', emoji: '📘' },
  { value: 'google', label: 'Google Ads', emoji: '🔍' },
  { value: 'tiktok', label: 'TikTok Ads', emoji: '🎵' },
  { value: 'other', label: 'Otra', emoji: '📌' },
]

function platformLabel(p: string): string {
  return PLATFORMS.find(x => x.value === p)?.label ?? p
}
function platformEmoji(p: string): string {
  return PLATFORMS.find(x => x.value === p)?.emoji ?? '📌'
}

function todayISO(): string {
  const d = new Date()
  const ar = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
  return ar
}

export default function CargarAdsModal({ onClose }: Props) {
  const router = useRouter()
  const [expenses, setExpenses] = useState<AdExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form
  const [editingId, setEditingId] = useState<number | null>(null)
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [platform, setPlatform] = useState('meli')
  const [campaign, setCampaign] = useState('')
  const [description, setDescription] = useState('')

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ads/list?limit=200', { cache: 'no-store' })
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
    setPlatform('meli')
    setCampaign('')
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
      const res = await fetch('/api/ads/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          date,
          amount: amountNum,
          platform,
          campaign: campaign.trim() || null,
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

  const handleEdit = (e: AdExpense) => {
    setEditingId(e.id)
    setDate(e.date)
    setAmount(String(e.amount))
    setPlatform(e.platform)
    setCampaign(e.campaign ?? '')
    setDescription(e.description ?? '')
    setError(null)
  }

  const handleDelete = async (e: AdExpense) => {
    if (!window.confirm(`¿Borrar gasto de ${formatARS(e.amount)} (${platformLabel(e.platform)} - ${formatDate(e.date)})?\n\nNo se puede deshacer.`)) return
    setDeletingId(e.id)
    try {
      const res = await fetch('/api/ads/delete', {
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>📊 Cargar gasto Ads</h2>
            <p className="modal-subtitle">Registrá tus gastos de publicidad para calcular ROAS y ganancia real</p>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* FORM */}
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
                  placeholder="Ej: 50000"
                />
              </div>

              <div className="form-row form-row-full">
                <label>Plataforma *</label>
                <div className="platforms">
                  {PLATFORMS.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      className={`platform-btn ${platform === p.value ? 'platform-active' : ''}`}
                      onClick={() => setPlatform(p.value)}
                    >
                      <span>{p.emoji}</span>
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-row form-row-full">
                <label>Campaña (opcional)</label>
                <input
                  type="text"
                  value={campaign}
                  onChange={e => setCampaign(e.target.value)}
                  placeholder='Ej: "Promo cafeteras Stitch"'
                />
              </div>

              <div className="form-row form-row-full">
                <label>Notas (opcional)</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Cualquier detalle que quieras recordar..."
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

          {/* LIST */}
          <div className="list-section">
            <div className="list-header">
              <h3>Gastos cargados ({expenses.length})</h3>
              <span className="list-total">Total: {formatARS(total)}</span>
            </div>

            {loading ? (
              <p className="empty">Cargando...</p>
            ) : expenses.length === 0 ? (
              <div className="empty-box">
                <p>No hay gastos de Ads cargados todavía.</p>
                <p className="empty-hint">Cargá el primero usando el formulario de arriba 👆</p>
              </div>
            ) : (
              <div className="expenses-list">
                {expenses.map(e => (
                  <div key={e.id} className={`expense-row ${editingId === e.id ? 'expense-editing' : ''}`}>
                    <div className="expense-emoji">{platformEmoji(e.platform)}</div>
                    <div className="expense-info">
                      <div className="expense-line-1">
                        <span className="expense-amount">{formatARS(e.amount)}</span>
                        <span className="expense-platform">{platformLabel(e.platform)}</span>
                      </div>
                      <div className="expense-line-2">
                        <span className="expense-date">{formatDate(e.date)}</span>
                        {e.campaign && <span className="expense-campaign">· {e.campaign}</span>}
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

        .modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 24px; }

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
        .form-row input, .form-row textarea, .form-row select {
          padding: 9px 11px; background: var(--bg-base); border: 1px solid var(--border-subtle);
          border-radius: 8px; font-size: 13px; color: var(--text-primary); font-family: inherit; outline: none;
          transition: border-color 0.15s ease;
        }
        .form-row input:focus, .form-row textarea:focus { border-color: var(--accent); }
        .form-row textarea { resize: vertical; }

        .platforms { display: flex; flex-wrap: wrap; gap: 6px; }
        .platform-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 11px; background: var(--bg-base); color: var(--text-secondary);
          border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 12px;
          cursor: pointer; font-family: inherit; transition: all 0.15s ease;
        }
        .platform-btn:hover { color: var(--text-primary); }
        .platform-btn.platform-active {
          background: rgba(62, 229, 224, 0.12); color: var(--accent); border-color: var(--accent);
        }

        .error-msg {
          padding: 8px 12px; background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3);
          border-radius: 8px; color: var(--danger); font-size: 13px;
        }

        .btn-save {
          background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%);
          color: var(--bg-base); border: none; padding: 11px 20px; border-radius: 10px;
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); align-self: flex-start;
        }
        .btn-save:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4); }
        .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-mini {
          background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border-subtle);
          padding: 5px 9px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit;
        }
        .btn-mini:hover:not(:disabled) { border-color: var(--border-medium); color: var(--text-primary); }
        .btn-mini-danger:hover:not(:disabled) { border-color: rgba(255, 71, 87, 0.4); color: var(--danger); }
        .btn-mini:disabled { opacity: 0.5; cursor: not-allowed; }

        .list-section { display: flex; flex-direction: column; gap: 10px; }
        .list-header {
          display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
        }
        .list-header h3 { margin: 0; font-size: 14px; color: var(--text-primary); font-weight: 600; }
        .list-total {
          font-size: 13px; color: var(--accent); font-weight: 700;
          background: rgba(62, 229, 224, 0.08); padding: 4px 12px; border-radius: 8px;
          border: 1px solid var(--border-medium);
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
        .expense-row.expense-editing { border-color: var(--accent); background: rgba(62, 229, 224, 0.04); }
        .expense-emoji { font-size: 20px; flex-shrink: 0; }
        .expense-info { flex: 1; min-width: 0; }
        .expense-line-1 { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .expense-amount { font-size: 14px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
        .expense-platform { font-size: 11px; color: var(--text-secondary); }
        .expense-line-2 { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .expense-campaign { color: var(--text-secondary); }
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
