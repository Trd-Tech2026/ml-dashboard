import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const codeVerifier = cookieStore.get('code_verifier')?.value

  if (!codeVerifier) {
    return NextResponse.json({ error: 'No code verifier found' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

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

  if (tokenData.access_token) {
    await supabase.from('ml_tokens').upsert({
      ml_user_id: String(tokenData.user_id),
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    })
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

 return NextResponse.redirect(new URL('/dashboard', 'https://clubbed-disinfect-fraying.ngrok-free.dev'))
}