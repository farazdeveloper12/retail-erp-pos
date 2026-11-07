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

  // Check whether the user is signed in (requires a valid login token)
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);
  const isLoginPage = request.nextUrl.pathname === "/login";

  // Not signed in and opening any page other than /login: send to /login
  if (!isLoggedIn && !isLoginPage) {
    return redirectTo(request, "/login", response);
  }

  // Signed in and opening /login: send to the dashboard
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
  // The fresh session cookies must also be sent with the redirect
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}