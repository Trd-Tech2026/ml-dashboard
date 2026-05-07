'use client'

import { useState, ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  subtitle?: string
}

export default function CollapsibleSection({ title, children, defaultOpen = true, subtitle }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <>
      <button
        className="toggle-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={`arrow ${open ? 'arrow-open' : ''}`}>▶</span>
        <div className="title-area">
          <h2>{title}</h2>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
      </button>
      {open && (
        <div className="collapsible-content">
          {children}
        </div>
      )}
      <style jsx>{`
        .toggle-header {
          width: 100%;
          background: transparent;
          border: none;
          padding: 0;
          margin: 0 0 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-family: inherit;
          color: var(--text-primary);
          text-align: left;
        }
        .toggle-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
          transition: color 0.15s ease;
        }
        .toggle-header:hover h2 {
          color: var(--accent);
        }
        .arrow {
          color: var(--text-muted);
          font-size: 11px;
          transition: transform 0.18s ease, color 0.15s ease;
          flex-shrink: 0;
          line-height: 1;
          display: inline-block;
        }
        .arrow-open {
          transform: rotate(90deg);
          color: var(--accent);
        }
        .toggle-header:hover .arrow {
          color: var(--accent);
        }
        .title-area {
          flex: 1;
          min-width: 0;
        }
        .subtitle {
          margin: 2px 0 0;
          font-size: 12px;
          color: var(--text-muted);
        }
        .collapsible-content {
          animation: slideDown 0.2s ease;
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .toggle-header h2 {
            font-size: 15px;
          }
        }
      `}</style>
    </>
  )
}
