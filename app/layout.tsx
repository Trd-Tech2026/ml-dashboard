import type { Metadata } from 'next'
import './globals.css'
import Sidebar from './components/Sidebar'

export const metadata: Metadata = {
  title: 'ML Dashboard',
  description: 'Dashboard de ventas Mercado Libre',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body>
        <div className="layout-root">
          <Sidebar />
          <main className="layout-main">
            {children}
          </main>
        </div>
        <style>{`
          .layout-root {
            display: flex;
            min-height: 100vh;
          }
          .layout-main {
            flex: 1;
            min-width: 0;
          }
          @media (max-width: 768px) {
            .layout-main {
              padding-top: 56px;
            }
          }
        `}</style>
      </body>
    </html>
  )
}