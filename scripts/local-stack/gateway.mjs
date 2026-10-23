// Minimal stand-in for Supabase's API gateway (Kong): routes /auth/v1 → Supabase Auth and
// /rest/v1 → PostgREST on one origin with CORS, so @supabase/supabase-js works unchanged.
import http from "node:http";

const routes = [
  { prefix: "/auth/v1", port: 9999 },
  { prefix: "/rest/v1", port: 3000 },
];

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-supabase-api-version",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, x-total-count",
};

const server = (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end('{"ok":true}');
    }
    const route = routes.find((r) => req.url.startsWith(r.prefix));
    if (!route) {
      res.writeHead(501, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify({ message: "Not available in the local stack (storage/realtime need hosted Supabase or `supabase start`)" }));
    }
    const headers = { ...req.headers, host: `localhost:${route.port}` };
    // Supabase sends the anon key as a bearer token when no user is signed in; PostgREST maps it to `anon`.
    const upstream = http.request(
      { host: "127.0.0.1", port: route.port, path: req.url.slice(route.prefix.length) || "/", method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ message: `Upstream unavailable: ${e.message}` }));
    });
    req.pipe(upstream);
};

// Loopback only (IPv4 and IPv6, since "localhost" may resolve to either).
http.createServer(server).listen(54321, "127.0.0.1", () => console.log("gateway on http://127.0.0.1:54321"));
http.createServer(server).listen(54321, "::1", () => console.log("gateway on http://[::1]:54321")).on("error", () => undefined);
