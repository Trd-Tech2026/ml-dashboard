import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/access') ||
    pathname.startsWith('/api/access') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  const granted = request.cookies.get('access_granted')?.value
  if (granted === process.env.ACCESS_CODE) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = '/access'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
