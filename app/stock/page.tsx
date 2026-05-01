export default function StockPage() {
  return (
    <div className="placeholder">
      <div className="content">
        <div className="icon">📦</div>
        <h1>Stock</h1>
        <p className="subtitle">Inventario en tiempo real</p>
        <div className="badge">En construcción</div>
        <p className="description">
          Estamos preparando este módulo. Pronto vas a poder ver el stock de todas tus
          publicaciones de Mercado Libre, recibir alertas de stock bajo y filtrar por estado.
        </p>
      </div>

      <style>{`
        .placeholder {
          padding: 48px 32px;
          min-height: calc(100vh - 56px);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .content {
          text-align: center;
          max-width: 480px;
        }
        .icon {
          font-size: 72px;
          margin-bottom: 16px;
        }
        h1 {
          margin: 0 0 8px;
          font-size: 32px;
          color: #1a1a1a;
        }
        .subtitle {
          margin: 0 0 20px;
          color: #666;
          font-size: 16px;
        }
        .badge {
          display: inline-block;
          background: #fff3e0;
          color: #e65100;
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 24px;
        }
        .description {
          margin: 0;
          color: #555;
          font-size: 15px;
          line-height: 1.6;
        }
      `}</style>
    </div>
  )
}
