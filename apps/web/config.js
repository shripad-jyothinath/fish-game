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

  // window.FISHIO_API_BASE = 'https://api.example.com';
  // window.FISHIO_ROOM_URL = 'wss://room.example.com';

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
