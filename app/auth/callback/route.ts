import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  const jar = await cookies()
  const codeVerifier = jar.get('ml_pkce_verifier')?.value
  const savedState = jar.get('ml_oauth_state')?.value

  if (!code || !state || !codeVerifier || !savedState) {
    return NextResponse.redirect(new URL('/hoy?error=missing_oauth_data', request.url))
  }

  if (state !== savedState) {
    return NextResponse.redirect(new URL('/hoy?error=state_mismatch', request.url))
  }

  jar.delete('ml_pkce_verifier')
  jar.delete('ml_oauth_state')

  const response = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI,
      code_verifier: codeVerifier
    })
  })

  const tokenData = await response.json()

  if (!tokenData.access_token) {
    console.log('Error obteniendo token:', JSON.stringify(tokenData))
    return NextResponse.redirect(new URL('/hoy?error=token_exchange_failed', request.url))
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error: insertError } = await supabase.from('ml_tokens').upsert({
    ml_user_id: String(tokenData.user_id),
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
  }, { onConflict: 'ml_user_id' })

  if (insertError) {
    console.log('Error guardando token:', JSON.stringify(insertError))
    return NextResponse.redirect(new URL('/hoy?error=db_save_failed', request.url))
  }

  return NextResponse.redirect(new URL('/hoy', request.url))
}
