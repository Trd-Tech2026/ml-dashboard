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

  // ✅ Autorizado: disparar el sync sin esperar respuesta (fire-and-forget)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ml-dashboard-rust.vercel.app'

  console.log('[cron] Disparando sync automático (fire-and-forget)...')

  // Fire-and-forget: no usamos await, dejamos que corra en segundo plano
  fetch(`${baseUrl}/api/sync`, {
    method: 'GET',
    cache: 'no-store'
  })
    .then(async (res) => {
      const data = await res.json()
      console.log('[cron] Sync terminó OK:', JSON.stringify(data))
    })
    .catch((err) => {
      console.log('[cron] Sync falló:', String(err))
    })

  // Devolvemos 202 inmediatamente (en menos de 100ms)
  return NextResponse.json({
    ok: true,
    mensaje: 'Sync disparado en segundo plano'
  }, { status: 202 })
}
