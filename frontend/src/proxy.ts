import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { safeInternalPath } from '@/src/lib/safeRedirect';
import { isLegacyRestaurantPagePath, restaurantHref, RESTAURANT_PATH_PREFIX } from '@/src/lib/restaurantPath';

// A restaurant URL name or id as the cookie may hold it. Anything else is
// ignored rather than pasted into a redirect.
const restaurantSegmentPattern = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|\d+)$/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get('token')?.value;

  const isRestaurantPath = pathname.startsWith(`${RESTAURANT_PATH_PREFIX}/`);
  const isLegacyPage = isLegacyRestaurantPagePath(pathname);
  // หน้าที่ต้อง login ก่อนถึงจะเข้าได้
  const isProtected = pathname.startsWith('/restaurants') || isRestaurantPath || isLegacyPage;

  // ยังไม่ login แล้วพยายามเข้าหน้าที่ต้องล็อค → กลับไปหน้า landing
  if (!token && isProtected) {
    const url = new URL('/', request.url);
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  // login แล้วแต่เข้าหน้า landing → ไปที่ dashboard
  if (token && pathname === '/') {
    const next = safeInternalPath(request.nextUrl.searchParams.get('next'), request.url);
    if (next) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.redirect(new URL('/restaurants', request.url));
  }

  // The dashboard pages moved under /r/<slug>. An old link or bookmark such as
  // /home goes to the restaurant used last, or to the picker when there is
  // none. Which restaurant a /r/ page belongs to is the URL's business, so
  // those are not checked against the cookie at all - the client guard
  // resolves the slug against the user's memberships.
  if (token && isLegacyPage) {
    const lastRestaurant = request.cookies.get('active_restaurant_slug')?.value
      || request.cookies.get('active_restaurant_id')?.value;
    if (lastRestaurant && restaurantSegmentPattern.test(lastRestaurant)) {
      return NextResponse.redirect(new URL(`${restaurantHref(lastRestaurant, pathname)}${search}`, request.url));
    }
    const url = new URL('/restaurants', request.url);
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
