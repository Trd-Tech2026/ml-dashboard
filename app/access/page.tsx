'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AccessPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    if (res.ok) {
      router.replace('/')
    } else {
      setError('Código incorrecto')
      setCode('')
    }
    setLoading(false)
  }

  return (
    <div className="access-wrap">
      <div className="access-box">
        <div className="access-icon">🔒</div>
        <h1>ML Dashboard</h1>
        <p>Ingresá el código de acceso</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Código"
            autoFocus
            autoComplete="off"
            disabled={loading}
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading || !code}>
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
      </div>

      <style>{`
        .access-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f5f5f5;
        }
        .access-box {
          background: white;
          border-radius: 16px;
          padding: 48px 40px;
          text-align: center;
          border: 1px solid #e5e5e5;
          width: 100%;
          max-width: 360px;
        }
        .access-icon {
          font-size: 40px;
          margin-bottom: 16px;
        }
        .access-box h1 {
          margin: 0 0 8px;
          font-size: 24px;
          color: #1a1a1a;
        }
        .access-box p {
          margin: 0 0 24px;
          color: #666;
          font-size: 15px;
        }
        form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        input {
          padding: 12px 16px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          font-size: 16px;
          text-align: center;
          letter-spacing: 4px;
          outline: none;
          transition: border-color 0.15s;
        }
        input:focus {
          border-color: #1a1a1a;
        }
        .error {
          margin: 0;
          color: #d32f2f;
          font-size: 14px;
        }
        button {
          padding: 12px;
          background: #1a1a1a;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        button:not(:disabled):hover {
          opacity: 0.85;
        }
      `}</style>
    </div>
  )
}
