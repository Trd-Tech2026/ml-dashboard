import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function generateCodeVerifier() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Buffer.from(array).toString('base64url')
}

async function generateCodeChallenge(verifier: string) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(digest).toString('base64url')
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateCodeVerifier()

  await supabase.from('ml_tokens').delete().eq('ml_user_id', 'pending')
  await supabase.from('ml_tokens').insert({
    ml_user_id: state,
    access_token: 'pending',
    refresh_token: codeVerifier,
    expires_at: new Date(Date.now() + 600000).toISOString()
  })

  const url = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${process.env.ML_CLIENT_ID}&redirect_uri=${process.env.ML_REDIRECT_URI}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&scope=offline_access`

  return NextResponse.redirect(url)
}