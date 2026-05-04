'use client'

import { Suspense, useState, useRef, useEffect, KeyboardEvent, ChangeEvent, ClipboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/'

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [])

  const handleChange = (i: number, e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '')
    if (val.length === 0) {
      const next = [...digits]
      next[i] = ''
      setDigits(next)
      return
    }
    if (val.length > 1) {
      const chars = val.slice(0, 6).split('')
      const next = [...digits]
      for (let j = 0; j < chars.length && i + j < 6; j++) {
        next[i + j] = chars[j]
      }
      setDigits(next)
      const last = Math.min(i + chars.length, 5)
      inputs.current[last]?.focus()
      if (next.every(d => d !== '')) {
        submit(next.join(''))
      }
      return
    }

    const next = [...digits]
    next[i] = val[0]
    setDigits(next)

    if (i < 5) {
      inputs.current[i + 1]?.focus()
    } else {
      if (next.every(d => d !== '')) {
        submit(next.join(''))
      }
    }
  }

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && i > 0) {
      inputs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < 5) {
      inputs.current[i + 1]?.focus()
    } else if (e.key === 'Enter') {
      const pin = digits.join('')
      if (pin.length === 6) submit(pin)
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 0) return
    const next = ['', '', '', '', '', '']
    for (let j = 0; j < text.length; j++) next[j] = text[j]
    setDigits(next)
    const last = Math.min(text.length, 5)
    inputs.current[last]?.focus()
    if (next.every(d => d !== '')) {
      submit(next.join(''))
    }
  }

  const submit = async (pin: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'PIN incorrecto')
        setDigits(['', '', '', '', '', ''])
        inputs.current[0]?.focus()
        setLoading(false)
        return
      }
      router.push(redirectTo)
      router.refresh()
    } catch (err) {
      setError('Error de conexión, intentá de nuevo')
      setLoading(false)
    }
  }

  return (
    <div className="login-card">
      <div className="logo">
        <h1>ML Dashboard</h1>
        <p>TRDTECH</p>
      </div>

      <h2>Ingresá tu PIN</h2>
      <p className="subtitle">6 dígitos para acceder al dashboard</p>

      <div className="pin-inputs">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            disabled={loading}
            className={`pin-input ${error ? 'pin-error' : ''}`}
          />
        ))}
      </div>

      {error && <div className="error-msg">⚠ {error}</div>}
      {loading && <div className="loading-msg">Verificando...</div>}
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="login-page">
      <Suspense fallback={<div className="login-card"><p>Cargando...</p></div>}>
        <LoginForm />
      </Suspense>

      <style>{`
        .login-page {
          min-height: 100vh;
          background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .login-card {
          background: white;
          border-radius: 16px;
          padding: 40px 32px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
        }
        .logo h1 {
          margin: 0 0 4px;
          font-size: 22px;
          color: #1a1a1a;
        }
        .logo p {
          margin: 0 0 32px;
          font-size: 12px;
          color: #888;
          letter-spacing: 1px;
        }
        h2 {
          margin: 0 0 6px;
          font-size: 20px;
          color: #1a1a1a;
        }
        .subtitle {
          margin: 0 0 28px;
          font-size: 14px;
          color: #666;
        }
        .pin-inputs {
          display: flex;
          gap: 8px;
          justify-content: center;
          margin-bottom: 16px;
        }
        .pin-input {
          width: 48px;
          height: 56px;
          font-size: 24px;
          font-weight: 600;
          text-align: center;
          border: 2px solid #e5e5e5;
          border-radius: 10px;
          background: #fafafa;
          color: #1a1a1a;
          outline: none;
          transition: all 0.15s ease;
        }
        .pin-input:focus {
          border-color: #2196F3;
          background: white;
          box-shadow: 0 0 0 3px rgba(33,150,243,0.15);
        }
        .pin-input.pin-error {
          border-color: #f44336;
          background: #fff5f5;
          animation: shake 0.4s ease;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .error-msg {
          color: #d32f2f;
          font-size: 14px;
          margin-top: 8px;
          font-weight: 500;
        }
        .loading-msg {
          color: #2196F3;
          font-size: 14px;
          margin-top: 8px;
        }

        @media (max-width: 480px) {
          .pin-input {
            width: 42px;
            height: 50px;
            font-size: 20px;
          }
          .login-card {
            padding: 32px 20px;
          }
        }
      `}</style>
    </div>
  )
}