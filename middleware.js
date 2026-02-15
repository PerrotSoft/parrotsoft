import { NextResponse } from 'next/server';

const SUBDOMAINS = ['test', 'dev', 'admin', 'aura'];

export function middleware(request) {
  const hostname = request.headers.get('host');
  const url = request.nextUrl.clone();

  const subdomain = hostname?.split('.')[0];

  if (subdomain && SUBDOMAINS.includes(subdomain)) {
    if (!url.pathname.startsWith(`/${subdomain}`)) {
      url.pathname = `/${subdomain}${url.pathname}`;
      return NextResponse.rewrite(url);
    }
  }
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};