import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'ml_dashboard_session'

// Rutas que NO requieren autenticación
const PUBLIC_PATHS = [
  '/login',
  '/api/session/login',
  '/api/session/logout',
  '/api/auth',          // OAuth ML (login y callback)
  '/api/sync',          // cron público (protegido con CRON_SECRET aparte)
  '/api/sync-items',
  '/api/cron',          // todos los cron-* protegidos con CRON_SECRET
  '/api/backfill-orders',
  '/api/test-mp',
]

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

async function isValidSession(cookieValue: string | undefined, secret: string): Promise<boolean> {
  if (!cookieValue) return false
  const parts = cookieValue.split(':')
  if (parts.length !== 3) return false
  const [prefix, expiresAtStr, signature] = parts
  if (prefix !== 'auth') return false

  const expiresAt = parseInt(expiresAtStr, 10)
  if (isNaN(expiresAt) || expiresAt < Date.now()) return false

  // Recalcular firma usando Web Crypto API (compatible con Edge runtime)
  const payload = `${prefix}:${expiresAtStr}`
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(payload)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, messageData)
  const sigArray = Array.from(new Uint8Array(sigBuffer))
  const expectedSig = sigArray.map(b => b.toString(16).padStart(2, '0')).join('')

  return signature === expectedSig
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Permitir rutas públicas
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // Permitir assets estáticos (Next.js los maneja por matcher, pero por las dudas)
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next()
  }

  // Verificar cookie de sesión
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
  const SESSION_SECRET = process.env.SESSION_SECRET ?? ''

  const valid = await isValidSession(sessionCookie, SESSION_SECRET)

  if (!valid) {
    // Redirigir a /login con redirect a la URL original
    const loginUrl = new URL('/login', request.url)
    if (pathname !== '/') {
      loginUrl.searchParams.set('redirect', pathname + request.nextUrl.search)
    }
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Aplica a todas las rutas excepto archivos estáticos
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}
