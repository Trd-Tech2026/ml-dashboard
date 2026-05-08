'use client'

import { useState, useEffect, useCallback } from 'react'

type Props = {
  onClose: () => void
}

export default function QuickCalc({ onClose }: Props) {
  const [display, setDisplay] = useState('0')
  const [expression, setExpression] = useState('')
  const [history, setHistory] = useState<Array<{ exp: string; result: string }>>([])

  const calculate = useCallback((exp: string): string => {
    if (!exp.trim()) return '0'
    try {
      // Sanitizar: solo permitir números, operadores básicos, paréntesis y punto
      const clean = exp.replace(/[^\d+\-*/().% ]/g, '')
      if (!clean.trim()) return '0'

      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + clean + ')')()
      if (!Number.isFinite(result)) return 'Error'
      // Formatear bonito
      if (Number.isInteger(result)) return String(result)
      return String(Math.round(result * 100) / 100)
    } catch {
      return 'Error'
    }
  }, [])

  const handleKey = (key: string) => {
    if (key === 'C') {
      setDisplay('0')
      setExpression('')
      return
    }
    if (key === '⌫') {
      const next = expression.slice(0, -1)
      setExpression(next)
      setDisplay(next || '0')
      return
    }
    if (key === '=') {
      if (!expression) return
      const result = calculate(expression)
      setDisplay(result)
      if (result !== 'Error') {
        setHistory(prev => [{ exp: expression, result }, ...prev].slice(0, 5))
        setExpression(result)
      }
      return
    }
    const next = expression + key
    setExpression(next)
    // Calcular en vivo
    const result = calculate(next)
    setDisplay(result === 'Error' ? next : result)
  }

  // Atajos de teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); handleKey('='); return }
      if (e.key === 'Backspace') { handleKey('⌫'); return }
      if (e.key === 'c' || e.key === 'C') { handleKey('C'); return }
      if (/^[\d+\-*/().%]$/.test(e.key)) { handleKey(e.key); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expression, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  const formatARS = (n: string) => {
    const num = parseFloat(n)
    if (!Number.isFinite(num)) return ''
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(num)
  }

  const buttons = [
    ['C', '⌫', '%', '/'],
    ['7', '8', '9', '*'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '(', ')'],
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>🧮 Calc</h2>
            <p className="modal-subtitle">Atajos: Esc cerrar · Enter calcular · C limpiar</p>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="display-area">
          <div className="exp-line">{expression || ' '}</div>
          <div className="display-line">{display}</div>
          {parseFloat(display) > 0 && (
            <div className="ars-line">{formatARS(display)}</div>
          )}
        </div>

        <div className="keypad">
          {buttons.map((row, ri) => (
            <div key={ri} className="key-row">
              {row.map(k => {
                const isOp = ['/', '*', '-', '+', '%'].includes(k)
                const isSpecial = ['C', '⌫'].includes(k)
                return (
                  <button
                    key={k}
                    className={`key ${isOp ? 'key-op' : ''} ${isSpecial ? 'key-special' : ''}`}
                    onClick={() => handleKey(k)}
                  >
                    {k}
                  </button>
                )
              })}
            </div>
          ))}
          <button className="key key-equals" onClick={() => handleKey('=')}>= calcular</button>
        </div>

        {history.length > 0 && (
          <div className="history">
            <div className="history-title">Recientes</div>
            {history.map((h, i) => (
              <button
                key={i}
                className="history-row"
                onClick={() => { setExpression(h.result); setDisplay(h.result) }}
              >
                <span className="history-exp">{h.exp} =</span>
                <span className="history-result">{h.result}</span>
              </button>
            ))}
          </div>
        )}
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
          max-width: 380px; width: 100%; display: flex; flex-direction: column; overflow: hidden;
        }
        .modal-header {
          padding: 16px 20px; border-bottom: 1px solid var(--border-subtle);
          display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
        }
        .modal-header h2 { margin: 0 0 2px; font-size: 17px; color: var(--text-primary); font-weight: 700; }
        .modal-subtitle { margin: 0; font-size: 11px; color: var(--text-muted); }
        .btn-close {
          background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted);
          width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 13px; flex-shrink: 0; font-family: inherit;
        }
        .btn-close:hover { color: var(--text-primary); border-color: var(--border-medium); }

        .display-area {
          padding: 20px; background: var(--bg-elevated); border-bottom: 1px solid var(--border-subtle);
          text-align: right; font-variant-numeric: tabular-nums;
        }
        .exp-line { font-size: 12px; color: var(--text-muted); min-height: 16px; word-break: break-all; }
        .display-line {
          font-size: 32px; font-weight: 700; color: var(--text-primary);
          line-height: 1.1; word-break: break-all; margin-top: 4px;
        }
        .ars-line { font-size: 12px; color: var(--accent); margin-top: 6px; }

        .keypad { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
        .key-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .key {
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          color: var(--text-primary); padding: 14px 10px; border-radius: 10px;
          font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit;
          transition: all 0.1s ease;
        }
        .key:hover { background: var(--bg-card); border-color: var(--border-medium); transform: translateY(-1px); }
        .key:active { transform: translateY(0); }
        .key-op { color: var(--accent); border-color: var(--border-medium); }
        .key-op:hover { background: rgba(62, 229, 224, 0.08); }
        .key-special { color: var(--warning); }
        .key-equals {
          background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent) 100%);
          color: var(--bg-base); border: none; padding: 14px; border-radius: 10px;
          font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
          margin-top: 4px; box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25);
        }
        .key-equals:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4); }

        .history {
          padding: 12px 16px 16px; border-top: 1px solid var(--border-subtle);
          display: flex; flex-direction: column; gap: 4px;
        }
        .history-title {
          font-size: 10px; color: var(--text-muted); text-transform: uppercase;
          letter-spacing: 0.5px; font-weight: 600; margin-bottom: 4px;
        }
        .history-row {
          display: flex; justify-content: space-between; align-items: center;
          background: transparent; border: none; padding: 6px 8px; border-radius: 6px;
          cursor: pointer; font-family: monospace; font-size: 12px;
          color: var(--text-muted); transition: all 0.1s ease; text-align: left;
        }
        .history-row:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .history-result { font-weight: 700; color: var(--accent); }
      `}</style>
    </div>
  )
}
