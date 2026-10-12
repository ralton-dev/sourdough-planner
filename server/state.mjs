// GET and PUT /api/state (decision 43). P1 stub: no routes yet; P3 fills this file.
//
// Contract with index.mjs (do not change index.mjs to fill this in):
//   stateRoutes({ config, store }) => Array<{ method, path, handler }>
//   - same arguments and guarantees as authRoutes in auth.mjs (read its comment);
//   - with accounts off, `store` is null: return [] (unclaimed /api/state then answers 404 JSON)
//     or routes that answer 401; the user comes from session.mjs's readSession.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function stateRoutes({ config, store }) {
  return [];
}
