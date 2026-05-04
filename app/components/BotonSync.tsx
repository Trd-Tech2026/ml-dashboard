'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function BotonSync() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [esError, setEsError] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    setMensaje(null)
    setEsError(false)
    try {
      const res = await fetch('/api/sync')
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setEsError(true)
        setMensaje(data.error ?? 'Error al sincronizar')
      } else {
        setMensaje(data.mensaje ?? 'Listo')
        router.refresh()
      }
    } catch {
      setEsError(true)
      setMensaje('Error de conexión')
    } finally {
      setLoading(false)
      setTimeout(() => setMensaje(null), 4000)
    }
  }

  return (
    <div className="sync-wrapper">
      <button onClick={handleClick} disabled={loading} className="sync-btn">
        <span className="sync-icon">{loading ? '⏳' : '⟳'}</span>
        <span>{loading ? 'Sincronizando...' : 'Actualizar ventas'}</span>
      </button>
      {mensaje && (
        <div className={`sync-msg ${esError ? 'sync-msg-error' : 'sync-msg-ok'}`}>
          {mensaje}
        </div>
      )}

      <style>{`
        .sync-wrapper {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-end;
        }
        .sync-btn {
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
          transition: all 0.15s ease;
          font-family: inherit;
          box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25);
        }
        .sync-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4);
        }
        .sync-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .sync-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .sync-icon {
          font-size: 16px;
          font-weight: bold;
        }
        .sync-msg {
          font-size: 12px;
          padding: 6px 12px;
          border-radius: 8px;
          font-weight: 500;
        }
        .sync-msg-ok {
          background: rgba(62, 229, 224, 0.1);
          color: var(--accent);
          border: 1px solid var(--border-subtle);
        }
        .sync-msg-error {
          background: rgba(255, 71, 87, 0.1);
          color: var(--danger);
          border: 1px solid rgba(255, 71, 87, 0.3);
        }
      `}</style>
    </div>
  )
}