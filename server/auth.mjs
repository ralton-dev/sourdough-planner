// Login, logout and /api/me (decision 39, §3). P1 stub: no routes yet; P2 fills this file.
//
// Contract with index.mjs (do not change index.mjs to fill this in):
//   authRoutes({ config, store }) => Array<{ method, path, handler }>
//   - called once by createApp, always, accounts on or off;
//   - `config` is readConfig()'s result; `config.accounts` is null when accounts are off, else
//     { dataDir, appUrl, issuer, clientId, clientSecret, sessionSecret, sessionDays, secureCookies };
//   - `store` is store.mjs's createStore() result, or null when accounts are off. When accounts
//     are on but the database failed to open, createApp mounts no routes at all and answers
//     /api/* and /auth/* with 503 itself, so a handler never sees a null store with accounts on;
//   - route shape and handler signature: router.mjs; cookie helpers: session.mjs.
//   Paths under /api/ and /auth/ that no route claims answer 404 JSON from index.mjs, so with
//   accounts off P2 must still return GET /api/me ({ enabled: false }, cache-control max-age=3600).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function authRoutes({ config, store }) {
  return [];
}
