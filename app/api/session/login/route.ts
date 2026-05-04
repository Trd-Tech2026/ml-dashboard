import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'

const COOKIE_NAME = 'ml_dashboard_session'
const SESSION_DURATION_SECONDS = 24 * 60 * 60 // 1 día

function signSession(secret: string): string {
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000
  const payload = `auth:${expiresAt}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}:${signature}`
}

export async function POST(request: Request) {
  const ACCESS_PIN = process.env.ACCESS_PIN
  const SESSION_SECRET = process.env.SESSION_SECRET

  if (!ACCESS_PIN || !SESSION_SECRET) {
    return NextResponse.json({
      ok: false,
      error: 'Servidor no configurado correctamente'
    }, { status: 500 })
  }

  let body: { pin?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Solicitud inválida' }, { status: 400 })
  }

  const pin = (body.pin ?? '').trim()
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ ok: false, error: 'El PIN debe tener 6 dígitos' }, { status: 400 })
  }

  // Comparación timing-safe para evitar ataques de timing
  const pinBuffer = Buffer.from(pin)
  const expectedBuffer = Buffer.from(ACCESS_PIN)
  const sameLength = pinBuffer.length === expectedBuffer.length
  const isValid = sameLength && timingSafeEqual(pinBuffer, expectedBuffer)

  if (!isValid) {
    return NextResponse.json({ ok: false, error: 'PIN incorrecto' }, { status: 401 })
  }

  // PIN válido: crear cookie firmada
  const sessionValue = signSession(SESSION_SECRET)
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  })

  return NextResponse.json({ ok: true })
}