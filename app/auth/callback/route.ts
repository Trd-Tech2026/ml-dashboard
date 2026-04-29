import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: pendingToken } = await supabase
    .from('ml_tokens')
    .select('refresh_token')
    .eq('ml_user_id', state)
    .single()

  if (!pendingToken) {
    console.log('No pending token found for state:', state)
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const codeVerifier = pendingToken.refresh_token

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
  console.log('Token data:', JSON.stringify(tokenData))

  await supabase.from('ml_tokens').delete().eq('ml_user_id', state)
  await supabase.from('ml_tokens').delete().eq('ml_user_id', String(tokenData.user_id))

  const insertData = {
    ml_user_id: String(tokenData.user_id),
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
  }
  
  console.log('Inserting:', JSON.stringify(insertData))
  
  const { error } = await supabase.from('ml_tokens').insert(insertData)
  
  console.log('Insert error:', JSON.stringify(error))

  return NextResponse.redirect(new URL('/dashboard', request.url))
}