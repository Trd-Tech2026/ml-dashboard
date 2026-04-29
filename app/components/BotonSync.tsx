'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function BotonSync() {
  const [loading, setLoading] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const router = useRouter()

  const handleSync = async () => {
    setLoading(true)
    setMensaje(null)

    try {
      const res = await fetch('/api/sync')
      const data = await res.json()

      if (data.ok) {
        setMensaje(`✅ ${data.mensaje}`)
        router.refresh()
      } else {
        setMensaje(`⚠️ Error: ${data.mensaje ?? 'desconocido'}`)
      }
    } catch (err) {
      setMensaje('⚠️ Error de red')
    } finally {
      setLoading(false)
      setTimeout(() => setMensaje(null), 4000)
    }
  }

  return (
    <div className="boton-sync-wrapper">
      <button
        onClick={handleSync}
        disabled={loading}
        className="boton-sync"
      >
        {loading ? (
          <>
            <span className="spinner" />
            Sincronizando...
          </>
        ) : (
          <>🔄 Actualizar ventas</>
        )}
      </button>

      {mensaje && (
        <span className="boton-sync-mensaje">{mensaje}</span>
      )}

      <style>{`
        .boton-sync-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .boton-sync {
          background-color: #4CAF50;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          white-space: nowrap;
        }
        .boton-sync:disabled {
          background-color: #999;
          cursor: not-allowed;
        }
        .boton-sync-mensaje {
          font-size: 14px;
          color: #555;
        }
        .spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid white;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          .boton-sync-wrapper {
            flex-direction: column;
            align-items: stretch;
            width: 100%;
            gap: 8px;
          }
          .boton-sync {
            width: 100%;
            padding: 14px;
            font-size: 15px;
          }
          .boton-sync-mensaje {
            text-align: center;
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  )
}