'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/'

  const [pin, setPin] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<boolean>(false)

  const submit = useCallback(async (pinValue: string) => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinValue }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(true)
        setTimeout(() => {
          setPin('')
          setError(false)
          setLoading(false)
        }, 600)
        return
      }
      router.push(redirectTo)
      router.refresh()
    } catch {
      setError(true)
      setTimeout(() => {
        setPin('')
        setError(false)
        setLoading(false)
      }, 600)
    }
  }, [router, redirectTo])

  const addDigit = (d: string) => {
    if (loading || error) return
    if (pin.length >= 6) return
    const next = pin + d
    setPin(next)
    if (next.length === 6) {
      submit(next)
    }
  }

  const removeDigit = () => {
    if (loading || error) return
    setPin(pin.slice(0, -1))
  }

  // Soporte teclado físico
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (loading || error) return
      if (/^\d$/.test(e.key)) {
        addDigit(e.key)
      } else if (e.key === 'Backspace') {
        removeDigit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, loading, error])

  const buttons = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return (
    <div className="content">
      {/* Logo SVG inspirado en TRDTECH */}
      <div className="logo">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="logo-svg">
          <defs>
            <linearGradient id="trdGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0d4d6e" />
              <stop offset="50%" stopColor="#1ca0c4" />
              <stop offset="100%" stopColor="#3ee5e0" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          {/* Arco superior */}
          <path
            d="M 50 80 Q 100 30 150 80"
            stroke="url(#trdGrad)"
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
            filter="url(#glow)"
          />
          {/* Arco inferior */}
          <path
            d="M 40 130 Q 100 180 160 120"
            stroke="url(#trdGrad)"
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
            filter="url(#glow)"
          />
        </svg>
      </div>

      <h1 className="brand">TRDTECH</h1>
      <p className="tagline">TODO PARA TU HOGAR</p>

      <p className="instruction">Ingresá tu PIN</p>
      <p className="hint">6 dígitos para acceder</p>

      {/* Indicadores del PIN */}
      <div className={`dots ${error ? 'dots-error' : ''}`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`dot ${i < pin.length ? 'dot-filled' : ''} ${error ? 'dot-error' : ''}`}
          />
        ))}
      </div>

      {/* Teclado numérico */}
      <div className="keypad">
        {buttons.map((b) => (
          <button
            key={b}
            type="button"
            className="key"
            onClick={() => addDigit(b)}
            disabled={loading || error}
          >
            {b}
          </button>
        ))}
        <div /> {/* placeholder vacío */}
        <button
          type="button"
          className="key"
          onClick={() => addDigit('0')}
          disabled={loading || error}
        >
          0
        </button>
        <button
          type="button"
          className="key key-back"
          onClick={removeDigit}
          disabled={loading || error || pin.length === 0}
          aria-label="Borrar"
        >
          ⌫
        </button>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="login-page">
      {/* Partículas de fondo */}
      <div className="particles">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 8}s`,
              animationDuration: `${4 + Math.random() * 6}s`,
              opacity: 0.1 + Math.random() * 0.6,
              transform: `scale(${0.3 + Math.random() * 1.2})`,
            }}
          />
        ))}
      </div>

      <Suspense fallback={<div className="loading-fallback">Cargando...</div>}>
        <LoginForm />
      </Suspense>

      <style>{`
        :global(body) {
          margin: 0;
        }
        .login-page {
          position: fixed;
          inset: 0;
          background:
            radial-gradient(ellipse at top, rgba(28, 160, 196, 0.15) 0%, transparent 50%),
            radial-gradient(ellipse at bottom, rgba(13, 77, 110, 0.2) 0%, transparent 60%),
            #050a14;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .particles {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
        }
        .particle {
          position: absolute;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #3ee5e0;
          box-shadow: 0 0 10px #3ee5e0, 0 0 20px rgba(62, 229, 224, 0.5);
          animation: float infinite ease-in-out;
        }
        @keyframes float {
          0%, 100% {
            transform: translate(0, 0) scale(1);
            opacity: 0.4;
          }
          50% {
            transform: translate(20px, -30px) scale(1.3);
            opacity: 0.8;
          }
        }

        .content {
          position: relative;
          z-index: 10;
          text-align: center;
          padding: 24px;
          max-width: 380px;
          width: 100%;
        }

        .logo {
          margin-bottom: 12px;
          display: flex;
          justify-content: center;
        }
        .logo-svg {
          width: 110px;
          height: 110px;
          animation: pulse 3s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { filter: drop-shadow(0 0 10px rgba(62, 229, 224, 0.5)); }
          50% { filter: drop-shadow(0 0 25px rgba(62, 229, 224, 0.9)); }
        }

        .brand {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: 4px;
          margin: 0 0 4px;
          background: linear-gradient(135deg, #ffffff 0%, #3ee5e0 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .tagline {
          font-size: 10px;
          letter-spacing: 3px;
          color: #5e8a9e;
          margin: 0 0 36px;
          font-weight: 600;
        }

        .instruction {
          font-size: 18px;
          font-weight: 600;
          color: white;
          margin: 0 0 4px;
        }
        .hint {
          font-size: 12px;
          color: #6b8a99;
          margin: 0 0 24px;
        }

        .dots {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-bottom: 32px;
        }
        .dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: transparent;
          border: 2px solid #2a4a5a;
          transition: all 0.18s ease;
        }
        .dot-filled {
          background: #3ee5e0;
          border-color: #3ee5e0;
          box-shadow: 0 0 12px rgba(62, 229, 224, 0.7);
        }
        .dots-error {
          animation: shake 0.4s ease;
        }
        .dot-error {
          background: #ff4757 !important;
          border-color: #ff4757 !important;
          box-shadow: 0 0 12px rgba(255, 71, 87, 0.7) !important;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }

        .keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          max-width: 280px;
          margin: 0 auto;
        }
        .key {
          background: rgba(28, 160, 196, 0.08);
          border: 1px solid rgba(62, 229, 224, 0.15);
          border-radius: 14px;
          color: white;
          font-size: 24px;
          font-weight: 500;
          height: 64px;
          cursor: pointer;
          transition: all 0.12s ease;
          font-family: inherit;
          backdrop-filter: blur(10px);
        }
        .key:hover:not(:disabled) {
          background: rgba(62, 229, 224, 0.18);
          border-color: rgba(62, 229, 224, 0.5);
          transform: translateY(-1px);
        }
        .key:active:not(:disabled) {
          transform: translateY(0) scale(0.95);
          background: rgba(62, 229, 224, 0.3);
        }
        .key:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .key-back {
          color: #6b8a99;
          font-size: 20px;
        }

        .loading-fallback {
          color: #6b8a99;
        }

        @media (max-width: 480px) {
          .logo-svg {
            width: 90px;
            height: 90px;
          }
          .brand {
            font-size: 24px;
          }
          .keypad {
            max-width: 240px;
            gap: 10px;
          }
          .key {
            height: 56px;
            font-size: 22px;
          }
          .dot {
            width: 12px;
            height: 12px;
          }
        }
      `}</style>
    </div>
  )
}