import { NextRequest, NextResponse } from 'next/server';
import { MASTER_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/lib/auth-constants';

const protectedPrefixes = ['/', '/pedidos', '/pdv', '/clientes', '/cardapio-admin', '/settings'];
const authPages = ['/login', '/signup'];

function isProtectedPath(pathname: string) {
  if (pathname === '/') return true;
  return protectedPrefixes.some((prefix) => prefix !== '/' && pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/master/auth') ||
    pathname.startsWith('/cardapio') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const hasMasterSession = Boolean(request.cookies.get(MASTER_SESSION_COOKIE_NAME)?.value);

  if (pathname.startsWith('/empresas') && !hasMasterSession) {
    return NextResponse.redirect(new URL('/master/login', request.url));
  }

  if (pathname.startsWith('/master/login') && hasMasterSession) {
    return NextResponse.redirect(new URL('/empresas', request.url));
  }

  if (isProtectedPath(pathname) && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (authPages.some((page) => pathname.startsWith(page)) && hasSession) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
