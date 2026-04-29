import { NextRequest, NextResponse } from 'next/server';

const protectedRoutes = ['/statistics', '/monthly-issues', '/monthly-data', '/monthly-report', '/reply-draft'];
const masterOnlyRoutes = ['/monthly-data', '/monthly-report', '/reply-draft'];
const MASTER_EMPLOYEE_ID = '21W00035';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));
  if (!isProtected) return NextResponse.next();

  const session = request.cookies.get('jb_session')?.value;
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const emp = session.trim().toUpperCase();
  const isMasterOnly = masterOnlyRoutes.some((route) => pathname.startsWith(route));
  if (isMasterOnly && emp !== MASTER_EMPLOYEE_ID) {
    const denyUrl = new URL('/statistics', request.url);
    return NextResponse.redirect(denyUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/statistics',
    '/statistics/:path*',
    '/monthly-issues',
    '/monthly-issues/:path*',
    '/monthly-data',
    '/monthly-data/:path*',
    '/monthly-report',
    '/monthly-report/:path*',
    '/reply-draft',
    '/reply-draft/:path*'
  ]
};

