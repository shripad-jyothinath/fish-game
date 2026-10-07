/**
 * Runtime configuration for split deployments.
 *
 * Local dev: leave everything empty — the game uses same-origin /api and
 * ws://<host>:8787 for the arena.
 *
 * Production (game on Vercel, backend on the VPS): uncomment and set these
 * before deploying the web app, or set them via an injected script/query params.
 * Query params always win (handy for testing preview deployments):
 *   ?api=https://api.example.com&room=wss://room.example.com
 */
(function () {
  'use strict';

  // Same-origin API through the Vercel proxy (/api/* → VPS API). First-party
  // cookies mean sign-in survives browser restarts and strict privacy settings.
  window.FISHIO_API_BASE = '';

  // The arena is a WebSocket on the VPS (Caddy TLS).
  window.FISHIO_ROOM_URL = 'wss://room.69-62-81-172.sslip.io';

  try {
    var params = new URLSearchParams(window.location.search);
    var api = params.get('api');
    var room = params.get('room');
    if (api) window.FISHIO_API_BASE = api;
    if (room) window.FISHIO_ROOM_URL = room;
  } catch (err) {
    /* URLSearchParams unavailable — ignore */
  }
})();
