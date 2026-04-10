// Singleton: przechowywanie session cookie Circle.so
// Sesja w pamięci Astro (resetuje się po restart dev servera)

let sessionCookie: string | null = null;
let sessionEmail: string | null = null;
let sessionExpiresAt: number | null = null;

export function getSession() {
  // Sprawdzaj czy sesja wygasła (jeśli mamy expiresAt)
  if (sessionExpiresAt && Date.now() > sessionExpiresAt) {
    clearSession();
    return null;
  }
  return sessionCookie ? { cookie: sessionCookie, email: sessionEmail } : null;
}

export function setSession(cookie: string, email: string, expiresInMs: number = 24 * 60 * 60 * 1000) {
  sessionCookie = cookie;
  sessionEmail = email;
  sessionExpiresAt = Date.now() + expiresInMs;
}

export function clearSession() {
  sessionCookie = null;
  sessionEmail = null;
  sessionExpiresAt = null;
}

export function isSessionValid(): boolean {
  return getSession() !== null;
}
