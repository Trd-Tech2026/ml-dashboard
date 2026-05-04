import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { code } = await request.json()

  if (code !== process.env.ACCESS_CODE) {
    return NextResponse.json({ error: 'Código incorrecto' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('access_granted', process.env.ACCESS_CODE!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return response
}
