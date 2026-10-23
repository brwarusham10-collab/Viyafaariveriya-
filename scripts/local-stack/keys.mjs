// Prints local anon / service_role JWTs signed with the local stack's secret.
// These are for the local stack only — never reuse this secret anywhere else.
import { createHmac } from "node:crypto";

const secret = process.argv[2] ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function sign(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const exp = 2_000_000_000;
console.log(`  VITE_SUPABASE_URL=http://localhost:54321`);
console.log(`  VITE_SUPABASE_ANON_KEY=${sign({ iss: "supabase-local", role: "anon", exp })}`);
console.log(`  (service_role, server-side only) ${sign({ iss: "supabase-local", role: "service_role", exp })}`);
