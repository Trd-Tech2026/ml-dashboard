import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'

export async function GET() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('base64url')

  const jar = await cookies()
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  }
  jar.set('ml_pkce_verifier', codeVerifier, cookieOptions)
  jar.set('ml_oauth_state', state, cookieOptions)

  const url = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.ML_CLIENT_ID}&redirect_uri=${process.env.ML_REDIRECT_URI}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&scope=offline_access`

  return NextResponse.redirect(url)
}