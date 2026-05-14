'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  onClose: () => void
}

function formatARSInput(s: string): string {
  const digits = s.replace(/[^\d]/g, '')
  if (!digits) return ''
  const n = Number(digits)
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n)
}

function parseARSInput(s: string): number {
  const digits = s.replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

export default function BillingOverrideModal({ onClose }: Props) {
  const router = useRouter()
  const [cargosPendientes, setCargosPendientes] = useState('')
  const [percepciones, setPercepciones] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/billing-override')
      .then(r => r.json())
      .then(data => {
        if (data?.override) {
          if (data.override.cargos_pendientes) {
            setCargosPendientes(formatARSInput(String(data.override.cargos_pendientes)))
          }
          if (data.override.percepciones_totales) {
            setPercepciones(formatARSInput(String(data.override.percepciones_totales)))
          }
          setLastUpdated(data.override.updated_at)
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const cp = parseARSInput(cargosPendientes)
      const p = parseARSInput(percepciones)
      if (p <= 0 && cp <= 0) {
        setError('Cargá al menos uno de los dos montos')
        setSaving(false)
        return
      }
      const r = await fetch('/api/billing-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cargos_pendientes: cp,
          percepciones_totales: p,
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        throw new Error(data?.error || 'Error guardando')
      }
      router.refresh()
      onClose()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('¿Borrar el override manual? Vuelve a usar el escalado automático.')) return
    setDeleting(true)
    try {
      await fetch('/api/billing-override', { method: 'DELETE' })
      router.refresh()
      onClose()
    } catch (e: any) {
      setError(e.message)
      setDeleting(false)
    }
  }

  const fechaActualizado = lastUpdated
    ? new Date(lastUpdated).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    : null

  const total = parseARSInput(cargosPendientes) + parseARSInput(percepciones)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>💰 Resumen de facturación · Mes en curso</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p className="help-text">
            Andá a tu panel de Mercado Libre →
            <strong> Facturación → Resumen de facturación</strong> y copiá los dos valores
            que ves en el encabezado.
          </p>

          {loading ? (
            <p className="muted">Cargando...</p>
          ) : (
            <>
              <div className="field-block">
                <label className="field-label">
                  Cargos pendientes de pago
                  <span className="field-hint">solo informativo, no descuenta del cálculo</span>
                </label>
                <div className="input-row input-secondary">
                  <span className="prefix">$</span>
                  <input
                    type="text"
                    value={cargosPendientes}
                    onChange={e => setCargosPendientes(formatARSInput(e.target.value))}
                    placeholder="160.123"
                  />
                </div>
              </div>

              <div className="field-block">
                <label className="field-label primary">
                  Percepciones aproximadas
                  <span className="field-hint primary">se distribuye en IVA + IIBB del cálculo</span>
                </label>
                <div className="input-row input-primary">
                  <span className="prefix">$</span>
                  <input
                    type="text"
                    value={percepciones}
                    onChange={e => setPercepciones(formatARSInput(e.target.value))}
                    placeholder="3.979.065"
                    autoFocus
                  />
                </div>
              </div>

              {total > 0 && (
                <div className="total-row">
                  <span>Total adeudado aproximado</span>
                  <span className="total-value">{formatARS(total)}</span>
                </div>
              )}

              {fechaActualizado && (
                <p className="muted small">Última actualización: {fechaActualizado}</p>
              )}

              {error && <p className="error">{error}</p>}

              <div className="distribution-info">
                <p className="info-label">Cómo se aplica:</p>
                <ul className="info-list">
                  <li><strong>Percepciones</strong>: se reparten en IVA crédito + IIBB por jurisdicción + Ganancias usando las proporciones del mes anterior cerrado.</li>
                  <li><strong>Cargos pendientes</strong>: por ahora solo se guardan como referencia (para evitar duplicar con Publicidad que cargás aparte). Avisame si querés que se descuenten automáticamente.</li>
                </ul>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {lastUpdated && (
            <button
              className="btn btn-danger-ghost"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? 'Borrando...' : '🗑️ Borrar'}
            </button>
          )}
          <div className="footer-right">
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0, 0, 0, 0.65);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; padding: 16px;
        }
        .modal {
          background: var(--bg-card, #0a121c);
          border: 1px solid rgba(62, 229, 224, 0.2);
          border-radius: 14px;
          width: 100%; max-width: 500px;
          max-height: 90vh; overflow: auto;
          display: flex; flex-direction: column;
        }
        .modal-header {
          padding: 18px 22px; border-bottom: 1px solid rgba(62, 229, 224, 0.1);
          display: flex; justify-content: space-between; align-items: center;
        }
        .modal-header h2 {
          margin: 0; font-size: 16px; font-weight: 600;
          color: var(--text-primary, #fff);
        }
        .close-btn {
          background: transparent; border: none; color: var(--text-muted, #94a3b8);
          font-size: 24px; cursor: pointer; padding: 0; width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center; border-radius: 6px;
        }
        .close-btn:hover { color: var(--text-primary, #fff); background: rgba(255,255,255,0.05); }

        .modal-body { padding: 20px 22px; }
        .help-text {
          font-size: 13px; color: var(--text-secondary, #cbd5e1); line-height: 1.5;
          margin: 0 0 18px;
        }
        .help-text strong { color: #3ee5e0; }

        .field-block { margin-bottom: 16px; }
        .field-label {
          display: flex; flex-direction: column; gap: 2px;
          font-size: 11px; letter-spacing: 0.8px;
          text-transform: uppercase; color: var(--text-muted, #94a3b8);
          font-weight: 600; margin-bottom: 6px;
        }
        .field-label.primary { color: #3ee5e0; }
        .field-hint {
          font-size: 10px; letter-spacing: 0;
          text-transform: none; font-weight: 400;
          color: var(--text-muted, #94a3b8);
        }
        .field-hint.primary { color: rgba(62, 229, 224, 0.7); }

        .input-row {
          display: flex; align-items: center;
          background: rgba(10, 18, 28, 0.6);
          border: 1px solid rgba(62, 229, 224, 0.15);
          border-radius: 10px; padding: 0 12px;
          transition: border-color 0.15s;
        }
        .input-row:focus-within { border-color: rgba(62, 229, 224, 0.6); }
        .input-primary { border-color: rgba(62, 229, 224, 0.35); }
        .input-secondary { opacity: 0.85; }
        .prefix { color: var(--text-muted, #94a3b8); font-size: 18px; margin-right: 6px; }
        .input-row input {
          flex: 1; background: transparent; border: none; outline: none;
          color: var(--text-primary, #fff); font-size: 20px; font-weight: 500;
          font-variant-numeric: tabular-nums; padding: 12px 0;
          font-family: inherit;
        }

        .total-row {
          display: flex; justify-content: space-between; align-items: center;
          margin-top: 14px; padding: 10px 14px;
          background: rgba(28, 160, 196, 0.06);
          border: 1px solid rgba(62, 229, 224, 0.15);
          border-radius: 8px;
          font-size: 12px; color: var(--text-secondary, #cbd5e1);
        }
        .total-value {
          font-size: 17px; font-weight: 600; color: var(--text-primary, #fff);
          font-variant-numeric: tabular-nums;
        }

        .muted { color: var(--text-muted, #94a3b8); }
        .small { font-size: 11px; margin: 8px 0 0; }
        .error {
          color: #f87171; font-size: 13px; margin: 10px 0 0;
          background: rgba(239, 68, 68, 0.08); padding: 8px 12px; border-radius: 6px;
        }

        .distribution-info {
          margin-top: 18px; padding: 12px; border-radius: 8px;
          background: rgba(62, 229, 224, 0.04); border: 1px solid rgba(62, 229, 224, 0.1);
        }
        .info-label {
          font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase;
          color: #3ee5e0; font-weight: 600; margin: 0 0 8px;
        }
        .info-list {
          font-size: 12px; color: var(--text-secondary, #cbd5e1);
          margin: 0; padding: 0 0 0 16px; line-height: 1.5;
        }
        .info-list li { margin-bottom: 4px; }
        .info-list strong { color: #3ee5e0; }

        .modal-footer {
          padding: 14px 22px; border-top: 1px solid rgba(62, 229, 224, 0.1);
          display: flex; justify-content: space-between; align-items: center; gap: 10px;
        }
        .footer-right { display: flex; gap: 10px; }
        .btn {
          padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
          cursor: pointer; font-family: inherit; border: 1px solid;
          transition: all 0.15s;
        }
        .btn-primary {
          background: linear-gradient(135deg, #1ca0c4 0%, #3ee5e0 100%);
          color: #0a121c; border-color: rgba(62, 229, 224, 0.5);
        }
        .btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-ghost {
          background: transparent; color: var(--text-secondary, #cbd5e1);
          border-color: rgba(62, 229, 224, 0.15);
        }
        .btn-ghost:hover:not(:disabled) {
          border-color: rgba(62, 229, 224, 0.35); color: var(--text-primary, #fff);
        }
        .btn-danger-ghost {
          background: transparent; color: #f87171;
          border-color: rgba(239, 68, 68, 0.25); font-size: 12px;
        }
        .btn-danger-ghost:hover:not(:disabled) { border-color: rgba(239, 68, 68, 0.5); }

        @media (max-width: 480px) {
          .modal-footer { flex-direction: column-reverse; gap: 8px; }
          .footer-right { width: 100%; }
          .footer-right .btn { flex: 1; }
          .btn-danger-ghost { width: 100%; }
        }
      `}</style>
    </div>
  )
}
