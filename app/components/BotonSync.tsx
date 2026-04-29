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
      // Limpiar mensaje después de 4 segundos
      setTimeout(() => setMensaje(null), 4000)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <button
        onClick={handleSync}
        disabled={loading}
        style={{
          backgroundColor: loading ? '#999' : '#4CAF50',
          color: 'white',
          border: 'none',
          padding: '10px 20px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 'bold',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {loading ? (
          <>
            <span style={{
              display: 'inline-block',
              width: '14px',
              height: '14px',
              border: '2px solid white',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            Sincronizando...
          </>
        ) : (
          <>🔄 Actualizar ventas</>
        )}
      </button>

      {mensaje && (
        <span style={{ fontSize: '14px', color: '#555' }}>{mensaje}</span>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
