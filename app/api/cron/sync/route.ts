import { NextResponse } from 'next/server'

export const maxDuration = 60

export async function GET(request: Request) {
  // 🔒 Verificar autorización
  const authHeader = request.headers.get('authorization')
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET) {
    console.log('[cron] CRON_SECRET no configurado')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  if (authHeader !== expectedToken) {
    console.log('[cron] Llamada no autorizada')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ✅ Autorizado: llamar al endpoint de sync existente
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ml-dashboard-rust.vercel.app'

  console.log('[cron] Iniciando sync automático...')
  const inicio = Date.now()

  try {
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: 'GET',
      cache: 'no-store'
    })

    const data = await res.json()
    const duracionMs = Date.now() - inicio

    console.log(`[cron] Sync completado en ${duracionMs}ms:`, JSON.stringify(data))

    return NextResponse.json({
      ok: true,
      duracion_ms: duracionMs,
      sync_result: data
    })
  } catch (error) {
    console.log('[cron] Error ejecutando sync:', error)
    return NextResponse.json({
      ok: false,
      error: String(error)
    }, { status: 500 })
  }
}
