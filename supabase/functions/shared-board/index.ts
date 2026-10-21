// Public, read-only data for a shared campaign board.
// GET /functions/v1/shared-board?t=<share_token>
// Returns only safe fields (no email, phone, date of birth, notes, scores or status)
// plus short-lived signed links to the creators' photos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-z0-9-]{8,64}$/i.test(token)) {
    return Response.json({ error: "invalid link" }, { status: 400, headers: cors });
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db.rpc("shared_board", { p_token: token });
  if (error) return Response.json({ error: "could not load board" }, { status: 500, headers: cors });
  if (!data) return Response.json({ error: "This link has expired or been turned off." }, { status: 404, headers: cors });

  const paths: string[] = [];
  for (const c of data.creators ?? []) {
    if (c.headshot_path) paths.push(c.headshot_path);
    for (const p of c.setup_paths ?? []) paths.push(p);
    for (const pv of c.previews ?? []) if (pv.thumb_path) paths.push(pv.thumb_path);
  }
  const signed: Record<string, string> = {};
  if (paths.length) {
    const { data: urls } = await db.storage.from("media").createSignedUrls(paths, 60 * 60);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed[u.path] = u.signedUrl;
  }
  return Response.json({ ...data, signed }, { headers: { ...cors, "Cache-Control": "private, max-age=300" } });
});
