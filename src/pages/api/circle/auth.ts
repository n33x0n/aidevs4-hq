import type { APIRoute } from 'astro';
import { setSession, clearSession, getSession } from '../../../lib/circle-session';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({
      action: 'login',
    }))) as { action?: string; sessionCookie?: string };

    const action = body.action || 'login';

    if (action === 'logout') {
      clearSession();
      return new Response(
        JSON.stringify({ success: true, message: 'Wylogowano' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Załaduj sesję z .env
    if (action === 'load_env') {
      const envCookies = import.meta.env.CIRCLE_COOKIES;
      const envEmail = import.meta.env.CIRCLE_EMAIL || 'user';

      if (!envCookies) {
        return new Response(
          JSON.stringify({ success: false, error: 'Brak CIRCLE_COOKIES w .env' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[CIRCLE] Loading cookies from .env for ${envEmail} (${envCookies.length} chars)`);
      setSession(envCookies, envEmail, 24 * 60 * 60 * 1000);

      return new Response(
        JSON.stringify({ success: true, message: `Zalogowano: ${envEmail}`, email: envEmail }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Użyj ręcznie wklejonej sesji
    if (action === 'use_session') {
      const { sessionCookie } = body;
      if (!sessionCookie) {
        return new Response(
          JSON.stringify({ success: false, error: 'Brak sessionCookie' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const email = import.meta.env.CIRCLE_EMAIL || 'user';
      console.log(`[CIRCLE] Using pasted session cookie for ${email}...`);
      // Jeśli wklejony cookie nie zawiera nazwy, dodaj prefix
      const cookieHeader = sessionCookie.includes('=') ? sessionCookie : `_circle_session=${sessionCookie}`;
      setSession(cookieHeader, email, 24 * 60 * 60 * 1000);

      return new Response(
        JSON.stringify({ success: true, message: `Zalogowano: ${email}`, email }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Status sesji
    if (action === 'status') {
      const session = getSession();
      return new Response(
        JSON.stringify({
          success: true,
          loggedIn: !!session,
          email: session?.email || null,
          hasEnvCookie: !!import.meta.env.CIRCLE_SESSION_COOKIE,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CIRCLE] Auth error:`, msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
