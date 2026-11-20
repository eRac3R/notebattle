/**
 * Game server URL. In production set NEXT_PUBLIC_SERVER_URL. In dev it defaults to the
 * same host the page was loaded from, so a phone opening http://<laptop-LAN-IP>:3000
 * talks to http://<laptop-LAN-IP>:4000 instead of its own localhost.
 */
export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  (typeof window === "undefined" ? "http://localhost:4000" : `${window.location.protocol}//${window.location.hostname}:4000`);
