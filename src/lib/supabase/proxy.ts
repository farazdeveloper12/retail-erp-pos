import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, key } = getSupabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Check: kya user login hai? (sahi login token hona zaroori hai)
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);
  const isLoginPage = request.nextUrl.pathname === "/login";

  // Login nahi hai aur /login ke ilawa kuch khola: /login par bhejo
  if (!isLoggedIn && !isLoginPage) {
    return redirectTo(request, "/login", response);
  }

  // Login hai aur /login khola: Dashboard par bhejo
  if (isLoggedIn && isLoginPage) {
    return redirectTo(request, "/", response);
  }

  return response;
}

function redirectTo(
  request: NextRequest,
  path: string,
  sessionResponse: NextResponse
) {
  const target = request.nextUrl.clone();
  target.pathname = path;
  target.search = "";

  const redirectResponse = NextResponse.redirect(target);
  // Session ke tazaa cookies redirect ke saath bhi bhejna zaroori hai
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}