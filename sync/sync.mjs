// Hourly sync: Jotform -> Supabase
// - copies new and changed submissions into public.applications
// - copies uploaded photos into the private "media" storage bucket (once per file)
// - looks up each creator's city on the map (cached)
// - builds link previews for TikTok, Instagram, YouTube and portfolio links
// - mirrors deletions made in Jotform
// Runs in GitHub Actions. Needs: JOTFORM_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { mapSubmission } from './mapping.mjs';

const env = (k, d) => process.env[k] || d;
const JOTFORM_API_KEY = env('JOTFORM_API_KEY');
const JOTFORM_FORM_ID = env('JOTFORM_FORM_ID', '262455225676261');
const JOTFORM_API_BASE = env('JOTFORM_API_BASE', 'https://api.jotform.com');
const JOTFORM_UTC_OFFSET = env('JOTFORM_UTC_OFFSET', '-04:00');
const META_OEMBED_TOKEN = env('META_OEMBED_TOKEN', '');
const CONTACT = env('SYNC_CONTACT_EMAIL', 'creator-crm@jdsports.ca');
const DRY = env('DRY_RUN', '') === '1';
for (const k of ['JOTFORM_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[k]) { console.error(`Missing ${k}. Add it as a GitHub Actions secret.`); process.exit(1); }
}
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash('sha1').update(s).digest('hex');
const UA = `JD-Creator-Collective-CRM/1.0 (${CONTACT})`;

async function jot(path, params = {}) {
  const u = new URL(JOTFORM_API_BASE + path);
  u.searchParams.set('apiKey', JOTFORM_API_KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Jotform ${path} -> HTTP ${r.status}`);
  const j = await r.json();
  if (j.responseCode !== 200) throw new Error(`Jotform ${path} -> ${j.message}`);
  return j.content;
}

async function allSubmissions() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await jot(`/form/${JOTFORM_FORM_ID}/submissions`, { limit: '1000', offset: String(offset), orderby: 'created_at' });
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out.filter((s) => s.status === 'ACTIVE');
}

// ------------------------------------------------------------- media
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' };
async function download(url, withKey) {
  let u = url;
  if (withKey) { const x = new URL(url); x.searchParams.set('apiKey', JOTFORM_API_KEY); u = x.toString(); }
  const r = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!r.ok || type.startsWith('text/html')) return null;
  return { buf: Buffer.from(await r.arrayBuffer()), type: type || 'application/octet-stream' };
}
async function copyFile(url, destNoExt, isJotform = true) {
  let f = await download(url, false);
  if (!f && isJotform) f = await download(url, true);
  if (!f) { console.warn('  could not download', url.slice(0, 80)); return null; }
  if (f.buf.length > 15 * 1024 * 1024) { console.warn('  file too large, skipped', url.slice(0, 80)); return null; }
  const path = `${destNoExt}.${EXT[f.type] || (url.split('?')[0].split('.').pop() || 'bin').slice(0, 5).toLowerCase()}`;
  if (DRY) return path;
  const { error } = await db.storage.from('media').upload(path, f.buf, { contentType: f.type, upsert: true });
  if (error) { console.warn('  upload failed', path, error.message); return null; }
  return path;
}

// ------------------------------------------------------------- fast photo versions
// sm: 480x600 card thumbnail, lg: up to 1400px for the profile and viewer. Originals stay untouched.
const T0 = Date.now();
async function makeVariants(path) {
  const { data, error } = await db.storage.from('media').download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const stem = path.replace(/\.[^./]+$/, '');
  try {
    const base = sharp(buf, { failOn: 'none' }).rotate();
    const sm = await base.clone().resize({ width: 480, height: 600, fit: 'cover', position: 'attention' }).webp({ quality: 72 }).toBuffer();
    const lg = await base.clone().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    if (!DRY) {
      const a = await db.storage.from('media').upload(stem + '.sm.webp', sm, { contentType: 'image/webp', upsert: true });
      const b = await db.storage.from('media').upload(stem + '.lg.webp', lg, { contentType: 'image/webp', upsert: true });
      if (a.error || b.error) return null;
    }
    return { sm: stem + '.sm.webp', lg: stem + '.lg.webp' };
  } catch (e) {
    console.warn('  could not resize', path, e.message);
    return { failed: true };
  }
}
async function backfillVariants() {
  const { data: rows } = await db.from('applications').select('submission_id,headshot_path,setup_paths,previews,variants');
  const byId = new Map((rows || []).map((r) => [r.submission_id, { ...(r.variants || {}) }]));
  // headshots first (they fill the wall), then setup photos, then link preview images
  const jobs = [];
  for (const tier of [0, 1, 2]) for (const r of rows || []) {
    const v = byId.get(r.submission_id);
    const ps = tier === 0 ? [r.headshot_path] : tier === 1 ? (r.setup_paths || []) : (r.previews || []).map((p) => p.thumb_path);
    ps.filter((p) => p && !v[p]).forEach((p) => jobs.push([r.submission_id, p]));
  }
  if (!jobs.length) return;
  console.log('Making fast versions of', jobs.length, 'photos');
  const dirty = new Set(); let made = 0;
  const flush = async () => { for (const id of dirty) if (!DRY) await db.from('applications').update({ variants: byId.get(id) }).eq('submission_id', id); dirty.clear(); };
  for (let i = 0; i < jobs.length; i += 8) {
    if (Date.now() - T0 > 15 * 60 * 1000) { console.log('Time limit reached, the next run continues the photo resizing'); break; }
    const batch = jobs.slice(i, i + 8);
    const out = await Promise.all(batch.map(([, p]) => makeVariants(p)));
    out.forEach((o, j) => { if (o) { byId.get(batch[j][0])[batch[j][1]] = o; dirty.add(batch[j][0]); made++; } });
    if (dirty.size >= 10) await flush();
  }
  await flush();
  console.log('Made fast versions of', made, 'photos');
}

// ------------------------------------------------------------- geocoding (OpenStreetMap, cached)
const PROV_CODES = { ontario: 'ON', quebec: 'QC', 'québec': 'QC', 'british columbia': 'BC', 'colombie-britannique': 'BC', alberta: 'AB', manitoba: 'MB', saskatchewan: 'SK', 'nova scotia': 'NS', 'nouvelle-écosse': 'NS', 'new brunswick': 'NB', 'nouveau-brunswick': 'NB', 'newfoundland and labrador': 'NL', 'terre-neuve-et-labrador': 'NL', 'prince edward island': 'PE', 'île-du-prince-édouard': 'PE', yukon: 'YT', 'northwest territories': 'NT', 'territoires du nord-ouest': 'NT', nunavut: 'NU' };
async function geocode(city, province) {
  if (!city) return null;
  const key = `${city}|${province || ''}`.toLowerCase().trim();
  const { data: hit } = await db.from('geocache').select('lat,lng').eq('key', key).maybeSingle();
  if (hit) return hit.lat == null ? null : hit;
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('format', 'json'); u.searchParams.set('limit', '1'); u.searchParams.set('countrycodes', 'ca');
  u.searchParams.set('city', city); if (province) u.searchParams.set('state', province);
  await sleep(1100); // Nominatim usage policy: max 1 request per second
  let res = null;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    const j = r.ok ? await r.json() : [];
    if (j[0]) res = { lat: +j[0].lat, lng: +j[0].lon };
  } catch (e) { console.warn('  geocode failed', key, e.message); return null; }
  if (!DRY) await db.from('geocache').upsert({ key, lat: res?.lat ?? null, lng: res?.lng ?? null });
  return res;
}

// ------------------------------------------------------------- link previews
function platformOf(url) {
  const h = (() => { try { return new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return ''; } })();
  if (/tiktok\.com$/.test(h)) return 'TikTok';
  if (/instagram\.com$/.test(h)) return 'Instagram';
  if (/youtube\.com$|youtu\.be$/.test(h)) return 'YouTube';
  return 'Website';
}
export function embedUrl(url) {
  try {
    const u = new URL(url);
    let m;
    if ((m = u.pathname.match(/\/video\/(\d+)/)) && /tiktok/.test(u.hostname)) return `https://www.tiktok.com/embed/v2/${m[1]}`;
    if (/youtu\.be$/.test(u.hostname)) return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (/youtube\.com$/.test(u.hostname.replace(/^www\.|^m\./, ''))) {
      if (u.searchParams.get('v')) return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
      if ((m = u.pathname.match(/\/shorts\/([\w-]+)/))) return `https://www.youtube.com/embed/${m[1]}`;
    }
    if ((m = u.pathname.match(/\/(p|reel|tv)\/([\w-]+)/)) && /instagram/.test(u.hostname)) return `https://www.instagram.com/${m[1]}/${m[2]}/embed`;
  } catch {}
  return null;
}
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function ogTags(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ' + UA + ')', 'Accept-Language': 'en-CA,en;q=0.9' }, redirect: 'follow' });
    if (!r.ok) return {};
    const html = (await r.text()).slice(0, 400000);
    const get = (p) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i')); return m ? decode(m[1]) : null; };
    const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return { title: get('og:title') || (t && decode(t[1].trim())), description: get('og:description') || get('description'), image: get('og:image') };
  } catch { return {}; }
}
async function oembed(url, platform) {
  try {
    let api = null;
    if (platform === 'TikTok') api = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    if (platform === 'YouTube' && embedUrl(url)) api = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    if (platform === 'Instagram' && META_OEMBED_TOKEN) api = `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${META_OEMBED_TOKEN}`;
    if (!api) return null;
    const r = await fetch(api, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title || null, author: j.author_name || null, image: j.thumbnail_url || null };
  } catch { return null; }
}
async function buildPreviews(row) {
  const items = [
    ...['tiktok_url', 'instagram_url', 'youtube_url'].filter((k) => row[k] && /^https?:/.test(row[k])).map((k) => ({ url: row[k], kind: 'profile' })),
    ...(row.post_urls || []).map((u) => ({ url: u, kind: 'post' })),
    ...(row.portfolio_url ? [{ url: row.portfolio_url, kind: 'portfolio' }] : []),
  ];
  const out = [];
  for (const [i, it] of items.entries()) {
    const platform = platformOf(it.url);
    const meta = (await oembed(it.url, platform)) || (await ogTags(it.url));
    let thumb_path = null;
    if (meta?.image && /^https?:/.test(meta.image)) thumb_path = await copyFile(meta.image, `${row.submission_id}/preview-${i + 1}-${sha(it.url).slice(0, 8)}`, false);
    out.push({ url: it.url, kind: it.kind, platform, title: meta?.title || null, author: meta?.author || null, description: meta?.description || null, thumb_path, embed_url: embedUrl(it.url) });
    await sleep(300);
  }
  return out;
}

function ageBand(dob) {
  if (!dob) return null;
  const d = new Date(dob + 'T00:00:00Z');
  if (isNaN(d)) return null;
  const now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) a--;
  return a < 18 ? 'Under 18' : a < 25 ? '18 to 24' : a < 35 ? '25 to 34' : '35+';
}

// permanently erase an applicant's CRM data and photos
async function purge(id) {
  if (DRY) return;
  const { data: files } = await db.storage.from('media').list(id, { limit: 200 });
  if (files?.length) await db.storage.from('media').remove(files.map((f) => `${id}/${f.name}`));
  await db.from('applications').delete().eq('submission_id', id);
}

// ------------------------------------------------------------- main
async function main() {
  const run = DRY ? { id: 0 } : (await db.from('sync_runs').insert({}).select('id').single()).data;
  const stats = { fetched: 0, inserted: 0, updated: 0, files_copied: 0 };
  try {
    const subs = await allSubmissions();
    stats.fetched = subs.length;
    const [{ data: existing }, { data: tomb }] = await Promise.all([
      db.from('applications').select('submission_id,answers_hash,media_sources,headshot_path,setup_paths,lat,lng,previews,previews_built_at,post_urls,tiktok_url,instagram_url,youtube_url,portfolio_url'),
      db.from('deleted_submissions').select('submission_id,purged_at'),
    ]);
    const byId = new Map((existing || []).map((r) => [r.submission_id, r]));
    const deleted = new Set((tomb || []).map((r) => r.submission_id));

    // erase applicants the team marked for deletion
    for (const t of (tomb || []).filter((r) => !r.purged_at)) {
      console.log('Erasing applicant marked for deletion', t.submission_id);
      await purge(t.submission_id);
      if (!DRY) await db.from('deleted_submissions').update({ purged_at: new Date().toISOString() }).eq('submission_id', t.submission_id);
      byId.delete(t.submission_id);
    }
    const activeIds = new Set();
    const unmatchedAll = new Set();

    for (const sub of subs) {
      const id = String(sub.id);
      activeIds.add(id);
      if (deleted.has(id)) continue;
      const { row, headshots, setups, unmatched } = mapSubmission(sub, JOTFORM_FORM_ID, JOTFORM_UTC_OFFSET);
      unmatched.forEach((u) => unmatchedAll.add(u));
      // the form says data is not stored without consent: skip, and erase if it was stored before
      if (row.consent === false) {
        if (byId.has(id)) { console.log('Consent withdrawn, erasing', id); await purge(id); byId.delete(id); }
        continue;
      }
      const hash = sha(JSON.stringify(sub.answers));
      const prev = byId.get(id);
      const stalePreviews = !prev?.previews_built_at || Date.now() - new Date(prev.previews_built_at) > 30 * 864e5;
      if (prev && prev.answers_hash === hash && !stalePreviews) continue;
      console.log(`${prev ? 'Updating' : 'Adding'} ${row.full_name || id}`);

      // photos: copy each Jotform file once
      const sources = { ...(prev?.media_sources || {}) };
      const copy = async (url, dest) => {
        if (sources[url]) return sources[url];
        const p = await copyFile(url, dest);
        if (p) { sources[url] = p; stats.files_copied++; }
        return p;
      };
      row.headshot_path = headshots[0] ? await copy(headshots[0], `${id}/headshot-${sha(headshots[0]).slice(0, 8)}`) : null;
      row.setup_paths = (await Promise.all(setups.map((u, i) => copy(u, `${id}/setup-${i + 1}-${sha(u).slice(0, 8)}`)))).filter(Boolean);
      row.media_sources = sources;

      // map location (only when the city changes)
      const geo = prev && prev.lat != null && prev.answers_hash === hash ? { lat: prev.lat, lng: prev.lng } : await geocode(row.city, row.province);
      row.lat = geo?.lat ?? null; row.lng = geo?.lng ?? null;

      // link previews (when links change, or monthly)
      const linksChanged = !prev || JSON.stringify([prev.tiktok_url, prev.instagram_url, prev.youtube_url, prev.post_urls, prev.portfolio_url]) !== JSON.stringify([row.tiktok_url, row.instagram_url, row.youtube_url, row.post_urls, row.portfolio_url]);
      if (linksChanged || stalePreviews) { row.previews = await buildPreviews(row); row.previews_built_at = new Date().toISOString(); }

      // keep less personal data: store only the age band, never the date of birth or identity answer
      row.age_band = ageBand(row.dob);
      delete row.dob; delete row.identity;

      row.answers_hash = hash;
      row.synced_at = new Date().toISOString();
      if (!DRY) {
        const { error } = await db.from('applications').upsert(row, { onConflict: 'submission_id' });
        if (error) throw new Error(`Saving ${id}: ${error.message}`);
      }
      prev ? stats.updated++ : stats.inserted++;
    }

    // mirror deletions made in Jotform (guarded against a partial API response)
    const missing = [...byId.keys()].filter((id) => !activeIds.has(id));
    if (missing.length && subs.length >= 0.9 * byId.size) {
      for (const id of missing) {
        console.log('Removing submission deleted in Jotform', id);
        await purge(id);
      }
    }
    await backfillVariants();
    if (unmatchedAll.size) console.log('Questions not mapped to a CRM field (update sync/mapping.mjs if needed):\n - ' + [...unmatchedAll].join('\n - '));
    console.log('Done', stats);
    if (!DRY) await db.from('sync_runs').update({ ...stats, finished_at: new Date().toISOString() }).eq('id', run.id);
  } catch (e) {
    console.error(e);
    if (!DRY && run?.id) await db.from('sync_runs').update({ ...stats, finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 500) }).eq('id', run.id);
    process.exit(1);
  }
}
main();
