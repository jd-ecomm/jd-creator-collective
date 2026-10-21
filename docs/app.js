/* JD Creator Collective CRM: live app.
   Reads applicants (synced hourly from Jotform) and team data from Supabase, writes team changes back,
   and listens for teammates' changes in real time. */
(function () {
'use strict';
const CFG = window.CRM_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const DAY = 864e5;
let ME = '';
let TODAY = new Date();

/* ---------------------------------------------------------------- reference data */
const STORES = (window.JD_STORES || []).map((s, i) => ({ i, name: s[0], addr: s[1], unit: s[2], city: s[3], prov: s[4], postal: s[5], lat: s[6], lng: s[7], phone: s[8] }));
const fullAddr = (s) => `${s.addr}${s.unit ? ', ' + s.unit : ''}, ${s.city}, ${s.prov} ${s.postal}`;
const PROV = { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', NS: 'Nova Scotia', NB: 'New Brunswick', MB: 'Manitoba', SK: 'Saskatchewan', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island', YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut' };
const PROV_IN = { ontario: 'ON', quebec: 'QC', 'québec': 'QC', 'british columbia': 'BC', 'colombie-britannique': 'BC', alberta: 'AB', manitoba: 'MB', saskatchewan: 'SK', 'nova scotia': 'NS', 'nouvelle-écosse': 'NS', 'new brunswick': 'NB', 'nouveau-brunswick': 'NB', 'newfoundland and labrador': 'NL', 'terre-neuve-et-labrador': 'NL', 'prince edward island': 'PE', 'île-du-prince-édouard': 'PE', yukon: 'YT', 'northwest territories': 'NT', 'territoires du nord-ouest': 'NT', nunavut: 'NU' };
const provCode = (p) => { const s = String(p || '').trim(); if (PROV[s.toUpperCase()]) return s.toUpperCase(); return PROV_IN[s.toLowerCase()] || ''; };
const METROS = [
  ['Greater Toronto and Hamilton', 43.65, -79.6, 60], ['Greater Montréal', 45.52, -73.65, 40], ['Metro Vancouver', 49.22, -122.95, 40],
  ['Ottawa and Gatineau', 45.42, -75.7, 30], ['Calgary', 51.05, -114.07, 30], ['Edmonton', 53.54, -113.5, 30], ['Winnipeg', 49.9, -97.14, 25],
  ['Québec City', 46.81, -71.23, 25], ['Halifax', 44.65, -63.58, 25], ['Greater Victoria', 48.45, -123.37, 20], ['Kitchener-Waterloo', 43.45, -80.49, 20],
  ['London', 42.98, -81.25, 20], ['Saskatoon', 52.13, -106.67, 20], ['Regina', 50.45, -104.61, 20]
];
const STATUSES = ['New', 'Reviewed', 'Shortlisted', 'Contacted', 'Onboarded', 'Declined'];
const STCOL = { New: 'var(--st-new)', Reviewed: 'var(--st-rev)', Shortlisted: 'var(--st-short)', Contacted: 'var(--st-con)', Onboarded: 'var(--st-on)', Declined: 'var(--st-dec)' };
const TYPES = ['Not set', 'Micro', 'Influencer', 'Employee'];
const REMS = ['Not set', 'Gifting', 'Monthly retainer', 'Pay per package'];
const REMS_FR = { Gifting: 'cadeaux', 'Monthly retainer': 'mandat mensuel', 'Pay per package': 'paiement par forfait', 'Not set': 'à confirmer' };
const TIERS = ['Not set', 'Everything', 'Full Usage Raw', 'Full Usage Finished', 'Organic Only', 'Creator Channel'];
const TAG_SUGG = ['Strong on camera', 'FR native', 'Sneakerhead', 'Fitness', 'Quick turnaround', 'Needs brief', 'Maybe', 'Holiday campaign'];
const CRIT = [['cam', 'On camera', 'Presence, delivery, energy'], ['prod', 'Production', 'Lighting, sound, editing'], ['fit', 'Brand fit', 'Style, audience, JD feel']];
const LANES_FR = { sneakers: 'sneakers', streetwear: 'streetwear', running: 'course à pied', basketball: 'basketball', 'gym and training': 'gym et entraînement', soccer: 'soccer', outdoor: 'plein air', 'campus life': 'vie de campus', 'kids and family': 'famille' };

/* ---------------------------------------------------------------- helpers */
const yes = (v) => /^(yes|oui|y\b|true|i consent|i agree|j'accepte)/i.test(String(v || '').trim());
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function fmt(n) { if (n == null) return '–'; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e4) return Math.round(n / 1e3) + 'k'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'; return String(n); }
function km(a, b, c, d) { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 2 * 6371 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); }
const kmTxt = (d) => !isFinite(d) ? 'Location unknown' : d < 10 ? d.toFixed(1) + ' km' : Math.round(d) + ' km';
const dispName = (email) => { if (!email || email === 'Unassigned') return 'Unassigned'; if (!email.includes('@')) return email; const p = email.split('@')[0].split(/[._-]+/).filter(Boolean); return p.map((x, i) => i === p.length - 1 && p.length > 1 ? x[0].toUpperCase() + '.' : x[0].toUpperCase() + x.slice(1)).join(' '); };
const fullName = (email) => { if (!email) return ''; const p = email.split('@')[0].split(/[._-]+/).filter(Boolean); return p.map((x) => x[0].toUpperCase() + x.slice(1)).join(' '); };
const allowedEmail = (e) => CFG.allowedDomains.includes(String(e || '').toLowerCase().split('@')[1] || '');
const normLang = (l) => { const s = norm(l); if (/^(english|anglais)/.test(s)) return 'English'; if (/^(french|francais)/.test(s)) return 'French'; return l; };
function handleOf(url, platform) {
  if (!url) return null;
  if (/^@/.test(url)) return url.slice(1);
  try { const u = new URL(url); const seg = u.pathname.split('/').filter(Boolean); if (!seg.length) return u.hostname; if (platform === 'YouTube' && seg[0] === 'channel') return seg[1]; return seg[0].replace(/^@/, ''); } catch { return url; }
}
function initialsSvg(name) {
  const ini = String(name || '?').split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase();
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><radialGradient id="g" cx=".2" cy=".15" r="1"><stop offset="0" stop-color="#A8F04C"/><stop offset=".55" stop-color="#4E9E9A"/><stop offset="1" stop-color="#2433B4"/></radialGradient></defs><rect width="400" height="500" fill="url(#g)"/><text x="200" y="285" font-family="Arial Narrow,Arial,sans-serif" font-style="italic" font-weight="900" font-size="150" text-anchor="middle" fill="#000">${ini}</text><text x="200" y="460" font-family="Arial,sans-serif" font-size="20" text-anchor="middle" fill="#000" opacity=".6">No headshot uploaded</text></svg>`);
}
function postBg(i) { const p = ['#A8F04C', '#4E9E9A', '#2433B4']; return `radial-gradient(80% 60% at ${20 + i * 30}% 20%, ${p[i % 3]} 0%, transparent 70%), linear-gradient(160deg, ${p[(i + 1) % 3]}, ${p[(i + 2) % 3]})`; }

/* ---------------------------------------------------------------- data */
let C = [];            // creators
let CRM = {};          // team data per creator
let BOARDS = [];       // active boards
let MEMBERS = new Map(); // `${board}|${sid}` -> active
let TEAM = [];         // team emails
let SIGNED = {};       // storage path -> signed url
let LAST_SYNC = null;

function toCreator(a) {
  const name = a.full_name || 'Unnamed applicant';
  const prov = provCode(a.province);
  const langs = (a.languages || []).map(normLang).filter((x) => !/^other/i.test(x));
  if (a.language_other) langs.push(a.language_other);
  const near = a.lat != null ? STORES.map((s) => ({ s, d: km(a.lat, a.lng, s.lat, s.lng) })).sort((x, y) => x.d - y.d) : [];
  const metro = a.lat != null ? (METROS.find((m) => km(a.lat, a.lng, m[1], m[2]) <= m[3]) || [a.city])[0] : (a.city || 'Unknown');
  const previews = Array.isArray(a.previews) ? a.previews : [];
  const posts = (a.post_urls || []).map((u, i) => {
    const pv = previews.find((p) => p.url === u) || {};
    return { url: u, platform: pv.platform || 'Post', caption: pv.title || 'Post ' + (i + 1), author: pv.author, thumb: pv.thumb_path ? SIGNED[pv.thumb_path] : null, embed: pv.embed_url || null, bg: postBg(i) };
  });
  const tt = a.tiktok_followers, ig = a.instagram_followers, yt = a.youtube_subscribers;
  const handle = handleOf(a.tiktok_url, 'TikTok') || handleOf(a.instagram_url, 'Instagram') || handleOf(a.youtube_url, 'YouTube') || norm(name).replace(/[^a-z]+/g, '.');
  return {
    id: a.submission_id, raw: a, name, first: name.split(' ')[0], city: a.city || 'Unknown city', prov, provName: PROV[prov] || a.province || '', metro, langs,
    handle, tt, ig, yt, reach: (tt || 0) + (ig || 0) + (yt || 0), lat: a.lat, lng: a.lng, near,
    head: a.headshot_path && SIGNED[a.headshot_path] ? SIGNED[a.headshot_path] : initialsSvg(name), hasHead: !!a.headshot_path,
    setups: (a.setup_paths || []).filter((p) => SIGNED[p]).map((p, i) => ({ src: SIGNED[p], label: 'Filming setup ' + (i + 1) })),
    posts, previews,
    equipment: a.equipment || [], software: a.editing_software || [], style: a.speaking_style || 'Not given', can: a.can_do || [], lanes: a.content_lanes || [], brands: a.brands || [],
    niche: a.niche || '', apart: a.sets_apart || '', more: [a.tell_more, a.anything_else].filter(Boolean).join('\n\n'),
    workedJD: yes(a.worked_with_jd), employee: yes(a.is_employee), customer: yes(a.is_customer), pads: yes(a.partnership_ads), padsRaw: a.partnership_ads,
    portfolio: a.portfolio_url, ageBand: a.age_band || 'Not given', ageOk: a.age_confirmed !== false && a.age_band !== 'Under 18', consent: a.consent !== false,
    email: a.email || '', phone: a.phone || '', applied: new Date(a.submitted_at),
    urls: { TikTok: a.tiktok_url, Instagram: a.instagram_url, YouTube: a.youtube_url }
  };
}
function blankCRM() { return { fav: false, status: 'New', stageSince: new Date().toISOString(), owner: 'Unassigned', type: 'Not set', rem: 'Not set', tier: 'Not set', tags: [], contacted: null, rightsStart: null, notes: [], scores: {}, log: [] }; }
function fromState(r) { const o = CRM[r.submission_id] || blankCRM(); Object.assign(o, { fav: r.favourite, status: r.status, stageSince: r.stage_since, owner: r.owner, type: r.creator_type, rem: r.remuneration, tier: r.tier, tags: r.tags || [], contacted: r.contacted_at, rightsStart: r.rights_start }); CRM[r.submission_id] = o; }
async function signPaths(paths) {
  const need = [...new Set(paths.filter((p) => p && !SIGNED[p]))];
  for (let i = 0; i < need.length; i += 400) {
    const { data } = await sb.storage.from('media').createSignedUrls(need.slice(i, i + 400), 6 * 3600);
    (data || []).forEach((u) => { if (u.signedUrl) SIGNED[u.path] = u.signedUrl; });
  }
}
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function loadApplications() {
  const apps = await q(sb.from('app_applications').select('*').order('submitted_at', { ascending: false }));
  const paths = []; apps.forEach((a) => { paths.push(a.headshot_path, ...(a.setup_paths || [])); (a.previews || []).forEach((p) => paths.push(p.thumb_path)); });
  await signPaths(paths);
  C = apps.map(toCreator);
  C.forEach((c) => { if (!CRM[c.id]) CRM[c.id] = blankCRM(); });
}
async function loadAll() {
  TODAY = new Date();
  const [state, notes, scores, boards, members, act, team, runs] = await Promise.all([
    q(sb.from('crm_state').select('*')),
    q(sb.from('notes').select('*').order('created_at')),
    q(sb.from('scores').select('*')),
    q(sb.from('boards').select('*').eq('archived', false).order('created_at')),
    q(sb.from('board_members').select('*')),
    q(sb.from('activity').select('*').order('at', { ascending: false }).limit(5000)),
    sb.rpc('team_members').then((r) => r.data || []),
    q(sb.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(1)),
  ]);
  CRM = {};
  state.forEach(fromState);
  notes.forEach((n) => { (CRM[n.submission_id] = CRM[n.submission_id] || blankCRM()).notes.push({ id: n.id, by: n.author, at: n.created_at, text: n.body }); });
  scores.forEach((s) => { (CRM[s.submission_id] = CRM[s.submission_id] || blankCRM()).scores[s.reviewer] = { cam: s.cam, prod: s.prod, fit: s.fit }; });
  act.forEach((a) => { if (a.submission_id) (CRM[a.submission_id] = CRM[a.submission_id] || blankCRM()).log.push({ id: a.id, at: a.at, by: a.actor, text: a.action }); });
  MEMBERS = new Map(members.map((m) => [m.board_id + '|' + m.submission_id, m.active]));
  BOARDS = boards.map(boardFrom);
  TEAM = team.map((t) => t.email).filter(Boolean);
  if (ME && !TEAM.includes(ME)) TEAM.push(ME);
  LAST_SYNC = runs[0] || null;
  await loadApplications();
}
function boardFrom(b) { return { id: b.id, name: b.name, desc: b.description || '', created_by: b.created_by, share: { on: b.share_on, token: b.share_token, expires: b.share_expires_at }, get ids() { return C.filter((c) => MEMBERS.get(b.id + '|' + c.id)).map((c) => c.id); } }; }

/* ---------------------------------------------------------------- derived */
const maxAud = (c) => Math.max(c.tt || 0, c.ig || 0, c.yt || 0);
const band = (c) => { const m = maxAud(c); return m === 0 ? 'Not given' : m < 1000 ? 'Under 1k' : m < 5000 ? '1k to 5k' : m < 10000 ? '5k to 10k' : m < 50000 ? '10k to 50k' : '50k+'; };
const nd = (c) => c.near.length ? c.near[0].d : Infinity;
const storeBand = (c) => { const d = nd(c); return !isFinite(d) ? 'Location unknown' : d <= 10 ? 'Within 10 km' : d <= 25 ? '10 to 25 km' : d <= 50 ? '25 to 50 km' : 'Over 50 km'; };
const storeLabel = (d) => !isFinite(d) ? 'Location unknown' : d <= 10 ? 'Easy in-store shoot' : d <= 25 ? 'In-store shoot ready' : d <= 50 ? 'Short drive' : d <= 150 ? 'Day trip' : 'Travel needed';
const bilingual = (c) => c.langs.includes('English') && c.langs.includes('French');
const media = (c) => [{ kind: 'img', src: c.head, label: 'Headshot' }, ...c.setups.map((s) => ({ kind: 'img', src: s.src, label: s.label })), ...c.posts.map((p, i) => ({ kind: 'post', post: p, label: 'Post ' + (i + 1) + ' · ' + p.platform }))];
const daysAgo = (c) => Math.max(0, Math.floor((TODAY - c.applied) / DAY));
const stageDays = (id) => Math.max(0, Math.floor((TODAY - new Date(CRM[id].stageSince)) / DAY));
function teamScore(id) { const s = Object.values(CRM[id].scores); let t = 0, n = 0; s.forEach((o) => CRIT.forEach(([k]) => { if (o[k]) { t += o[k]; n++; } })); return n ? t / n : null; }
function critAvg(id, k) { const v = Object.values(CRM[id].scores).map((o) => o[k]).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function isSplit(id) { const s = Object.values(CRM[id].scores); if (s.length < 2) return false; return CRIT.some(([k]) => { const v = s.map((o) => o[k]).filter(Boolean); return v.length > 1 && Math.max(...v) - Math.min(...v) >= 2; }); }
function needs(c) {
  const cr = CRM[c.id], o = [];
  if (!c.ageOk) o.push('Age not confirmed');
  if (cr.status === 'New' && daysAgo(c) > 14) o.push('Waiting 14+ days');
  if (['Reviewed', 'Shortlisted', 'Contacted'].includes(cr.status) && cr.owner === 'Unassigned') o.push('No owner');
  if (['Reviewed', 'Shortlisted', 'Contacted'].includes(cr.status) && stageDays(c.id) > 7) o.push('Stuck 7+ days');
  if (!c.setups.length) o.push('Missing setup photos');
  if (!c.posts.length) o.push('No post links');
  if (isSplit(c.id)) o.push('Split opinion');
  return o;
}
function rights(c) { const cr = CRM[c.id]; if (cr.status !== 'Onboarded') return null; if (!cr.rightsStart) return { state: 'Not started' }; const s = new Date(cr.rightsStart); const e = new Date(s); e.setFullYear(e.getFullYear() + 1); const left = Math.round((e - TODAY) / DAY); return { state: left < 0 ? 'Expired' : left <= 60 ? 'Expiring within 60 days' : 'Active', end: e, left }; }

/* ---------------------------------------------------------------- filters */
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
const GROUPS = [
  { k: 'status', l: 'Status', open: true, opts: () => STATUSES, get: (c) => [CRM[c.id].status] },
  { k: 'needs', l: 'Needs attention', open: false, opts: () => ['Age not confirmed', 'Waiting 14+ days', 'No owner', 'Stuck 7+ days', 'Missing setup photos', 'No post links', 'Split opinion'], get: needs },
  { k: 'boards', l: 'Campaign boards', open: false, opts: () => BOARDS.map((b) => b.name), get: (c) => BOARDS.filter((b) => MEMBERS.get(b.id + '|' + c.id)).map((b) => b.name) },
  { k: 'owner', l: 'Owner', open: false, opts: () => uniq(C.map((c) => dispName(CRM[c.id].owner))), get: (c) => [dispName(CRM[c.id].owner)] },
  { k: 'store', l: 'Near a JD store', sub: "Distance from the creator's city to the closest store", open: true, opts: () => ['Within 10 km', '10 to 25 km', '25 to 50 km', 'Over 50 km', 'Location unknown'], get: (c) => [storeBand(c)] },
  { k: 'nstore', l: 'Closest JD store', open: false, opts: () => uniq(C.map((c) => c.near[0] && c.near[0].s.name)), get: (c) => [c.near[0] && c.near[0].s.name].filter(Boolean) },
  { k: 'metro', l: 'Metro area', open: false, opts: () => uniq(C.map((c) => c.metro)), get: (c) => [c.metro] },
  { k: 'province', l: 'Province', open: false, opts: () => uniq(C.map((c) => c.prov)), get: (c) => [c.prov] },
  { k: 'language', l: 'Language', open: true, opts: () => ['French-ready (EN + FR)', 'English', 'French', 'Other'], get: (c) => [bilingual(c) ? 'French-ready (EN + FR)' : 0, ...c.langs.map((x) => (x === 'English' || x === 'French' ? x : 'Other'))].filter(Boolean) },
  { k: 'platform', l: 'Platform', open: false, opts: () => ['TikTok', 'Instagram', 'YouTube'], get: (c) => [c.tt || c.urls.TikTok ? 'TikTok' : 0, c.ig || c.urls.Instagram ? 'Instagram' : 0, c.yt || c.urls.YouTube ? 'YouTube' : 0].filter(Boolean) },
  { k: 'band', l: 'Largest audience', open: false, opts: () => ['Under 1k', '1k to 5k', '5k to 10k', '10k to 50k', '50k+', 'Not given'], get: (c) => [band(c)] },
  { k: 'score', l: 'Team score', open: false, opts: () => ['4 and above', '3 to 3.9', 'Below 3', 'Not scored'], get: (c) => { const s = teamScore(c.id); return [s == null ? 'Not scored' : s >= 4 ? '4 and above' : s >= 3 ? '3 to 3.9' : 'Below 3']; } },
  { k: 'age', l: 'Age band', open: false, opts: () => ['18 to 24', '25 to 34', '35+', 'Not given'], get: (c) => [c.ageBand] },
  { k: 'lanes', l: 'Content lanes', open: false, opts: () => uniq(C.flatMap((c) => c.lanes)), get: (c) => c.lanes },
  { k: 'can', l: 'What they can do', open: false, opts: () => uniq(C.flatMap((c) => c.can)), get: (c) => c.can },
  { k: 'style', l: 'On-camera style', open: false, opts: () => uniq(C.map((c) => c.style)), get: (c) => [c.style] },
  { k: 'equipment', l: 'Equipment', open: false, opts: () => uniq(C.flatMap((c) => c.equipment)), get: (c) => c.equipment },
  { k: 'brands', l: 'Brand pools', sub: 'Brands they wear or follow', open: false, opts: () => uniq(C.flatMap((c) => c.brands)), get: (c) => c.brands },
  { k: 'rights', l: 'Usage rights', open: false, opts: () => ['Active', 'Expiring within 60 days', 'Expired', 'Not started'], get: (c) => { const r = rights(c); return r ? [r.state] : []; } },
  { k: 'tags', l: 'Team tags', open: false, opts: () => uniq(C.flatMap((c) => CRM[c.id].tags)), get: (c) => CRM[c.id].tags },
  { k: 'flags', l: 'Flags', open: true, opts: () => ['Favourite', 'Ad-ready', 'Partnership Ads OK', 'JD customer', 'JD employee', 'Worked with JD', 'Has portfolio'], get: (c) => [CRM[c.id].fav && 'Favourite', c.pads && maxAud(c) >= 10000 && 'Ad-ready', c.pads && 'Partnership Ads OK', c.customer && 'JD customer', c.employee && 'JD employee', c.workedJD && 'Worked with JD', c.portfolio && 'Has portfolio'].filter(Boolean) },
];
const weekFn = (c) => daysAgo(c) <= 7;
const PRESETS = [
  { k: 'all', l: 'All applicants', f: {} },
  { k: 'fav', l: 'Favourites', f: { flags: ['Favourite'] } },
  { k: 'week', l: 'New this week', f: {}, fn: weekFn },
  { k: 'mine', l: 'Mine', f: {}, fn: (c) => CRM[c.id].owner === ME },
  { k: 'needs', l: 'Needs attention', warn: 1, f: { needs: ['Age not confirmed', 'Waiting 14+ days', 'No owner', 'Stuck 7+ days', 'Missing setup photos', 'No post links', 'Split opinion'] } },
  { k: 'near', l: 'Near a JD store', f: { store: ['Within 10 km', '10 to 25 km'] } },
  { k: 'fr', l: 'French-ready', f: { language: ['French-ready (EN + FR)'] } },
  { k: 'adr', l: 'Ad-ready', f: { flags: ['Ad-ready'] } },
  { k: 'short', l: 'Shortlisted', f: { status: ['Shortlisted'] } },
];
const S = { view: 'wall', q: '', sort: 'new', f: {}, fn: null, fnLabel: '', cmp: [], open: null, lb: null, cmpOpen: false, cast: null, board: null, share: null, drag: null, openGroups: {}, mapT: null, jump: 'ca', popPinned: null, showStores: true, showCreators: true, otLang: null, otTpl: null, reveal: {}, armDelete: null };
GROUPS.forEach((g) => (S.openGroups[g.k] = g.open));
try { const v = JSON.parse(localStorage.getItem('jdcc-crm-ui') || 'null'); if (v) { if (v.view) S.view = v.view; if (v.sort) S.sort = v.sort; } } catch (e) {}
function saveUI() { try { localStorage.setItem('jdcc-crm-ui', JSON.stringify({ view: S.view, sort: S.sort })); } catch (e) {} }
function matchQ(c, qq) { if (!qq) return true; const cr = CRM[c.id]; const hay = norm([c.name, c.city, c.metro, c.provName, c.prov, c.handle, c.niche, c.apart, c.more, c.style, c.near[0] && c.near[0].s.name, ...c.lanes, ...c.can, ...c.brands, ...c.equipment, ...c.langs, ...cr.tags, ...cr.notes.map((n) => n.text), cr.status, dispName(cr.owner)].join(' ')); return qq.split(/\s+/).every((t) => hay.includes(t)); }
function applyF(list, f, skip, fn) { return list.filter((c) => { if (fn && !fn(c)) return false; for (const g of GROUPS) { if (g.k === skip) continue; const sel = f[g.k]; if (!sel || !sel.length) continue; const v = g.get(c); if (!sel.some((x) => v.includes(x))) return false; } return true; }); }
const nq = () => norm(S.q.trim());
function results() {
  const l = applyF(C.filter((c) => matchQ(c, nq())), S.f, null, S.fn); const s = S.sort;
  l.sort((a, b) => s === 'name' ? a.name.localeCompare(b.name) : s === 'score' ? (teamScore(b.id) ?? -1) - (teamScore(a.id) ?? -1) : s === 'near' ? nd(a) - nd(b) : s === 'reach' ? maxAud(b) - maxAud(a) : s === 'tt' ? (b.tt || 0) - (a.tt || 0) : s === 'ig' ? (b.ig || 0) - (a.ig || 0) : s === 'yt' ? (b.yt || 0) - (a.yt || 0) : b.applied - a.applied);
  return l;
}
const fCountNoFn = () => Object.values(S.f).reduce((n, a) => n + (a ? a.length : 0), 0);
const fCount = () => fCountNoFn() + (S.fn ? 1 : 0);
const sameF = (a, b) => { const ka = Object.keys(a).filter((k) => a[k] && a[k].length), kb = Object.keys(b); if (ka.length !== kb.length) return false; return kb.every((k) => a[k] && a[k].length === b[k].length && b[k].every((x) => a[k].includes(x))); };

/* ---------------------------------------------------------------- small pieces */
const STAR = (on) => `<svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>`;
const PLAY = '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const stPill = (s) => `<span class="stpill"><span class="dot" style="background:${STCOL[s]}"></span>${esc(s)}</span>`;
const stInline = (s) => `<span style="display:inline-flex;align-items:center;gap:6px;font-weight:600"><span class="dot" style="background:${STCOL[s]}"></span>${esc(s)}</span>`;
const langTags = (c) => c.langs.map((l) => `<span class="lang">${l === 'English' ? 'EN' : l === 'French' ? 'FR' : esc(String(l).slice(0, 2).toUpperCase())}</span>`).join('');
const sc1 = (v) => (v == null ? '–' : v.toFixed(1));
const nearLine = (c) => { const d = nd(c); return `<div class="near${d <= 25 ? ' ok' : ''}">${PIN}<span>${isFinite(d) ? kmTxt(d) + ' to JD ' + esc(c.near[0].s.name) : 'City not found on the map'}</span></div>`; };
const fmtDate = (d, o) => new Date(d).toLocaleDateString('en-CA', o || { month: 'short', day: 'numeric' });
const mask = (s) => { if (!s) return 'Not given'; if (s.includes('@')) { const [u, d] = s.split('@'); return u[0] + '•••@' + d; } return s.replace(/\d(?=\d{4})/g, '•'); };

/* ---------------------------------------------------------------- render */
let rT = null;
function scheduleRender() { clearTimeout(rT); rT = setTimeout(render, 120); }
function render() { if (!C) return; renderViews(); renderActive(); renderRail(); renderMain(); renderTray(); renderOverlays(); renderSync(); }
function renderSync() {
  const el = $('syncchip'); if (!el) return;
  if (!LAST_SYNC) { el.textContent = 'Waiting for first sync'; return; }
  const t = new Date(LAST_SYNC.finished_at || LAST_SYNC.started_at); const m = Math.round((Date.now() - t) / 60000);
  el.className = 'syncchip' + (LAST_SYNC.error ? ' err' : '');
  el.textContent = LAST_SYNC.error ? 'Last sync failed' : 'Synced ' + (m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago');
  el.title = LAST_SYNC.error || 'Applications sync from Jotform every hour';
}
function renderViews() {
  const base = C.filter((c) => matchQ(c, nq()));
  $('views').innerHTML = PRESETS.map((p) => { const on = p.fn ? S.fn === p.fn && !fCountNoFn() : !S.fn && sameF(S.f, p.f); return `<button type="button" class="vchip${p.warn ? ' warn' : ''}" data-act="preset" data-p="${p.k}" aria-pressed="${on}">${esc(p.l)} <b class="num">${applyF(base, p.f, null, p.fn).length}</b></button>`; }).join('');
}
function renderActive() {
  let h = `<span class="count"><strong class="num">${results().length}</strong> of ${C.length} creators</span>`;
  if (S.fn) h += `<span class="pill-x"><span>View</span>${esc(S.fnLabel)}<button type="button" aria-label="Remove filter" data-act="rmfn">×</button></span>`;
  for (const g of GROUPS) (S.f[g.k] || []).forEach((v) => { h += `<span class="pill-x"><span>${esc(g.l)}</span>${esc(g.k === 'province' ? PROV[v] || v : v)}<button type="button" aria-label="Remove filter" data-act="rmf" data-g="${g.k}" data-v="${esc(v)}">×</button></span>`; });
  if (fCount() || S.q) h += `<button type="button" class="linkbtn" data-act="clearf">Clear all</button>`;
  $('active').innerHTML = h;
}
function renderRail() {
  const base = C.filter((c) => matchQ(c, nq()));
  let h = `<div class="rail-head"><span class="dsp" style="font-size:26px">Filters</span><button type="button" class="ib" data-act="closerail" aria-label="Close filters">×</button></div>`;
  for (const g of GROUPS) {
    const opts = g.opts(); if (!opts.length) continue;
    const pool = applyF(base, S.f, g.k, S.fn); const sel = S.f[g.k] || [];
    const ob = opts.map((o) => { const n = pool.filter((c) => g.get(c).includes(o)).length; const on = sel.includes(o); const dot = g.k === 'status' ? `<span class="dot" style="background:${STCOL[o]}"></span>` : '';
      return `<button type="button" class="opt${!n && !on ? ' zero' : ''}" data-act="facet" data-g="${g.k}" data-v="${esc(o)}" aria-pressed="${on}">${dot}${esc(g.k === 'province' ? PROV[o] || o : o)}<em class="num">${n}</em></button>`; }).join('');
    h += `<details class="fg" data-g="${g.k}"${S.openGroups[g.k] ? ' open' : ''}><summary>${esc(g.l)}${sel.length ? `<i>${sel.length}</i>` : ''}</summary>${g.sub ? `<div class="sub">${esc(g.sub)}</div>` : ''}<div class="opts">${ob}</div></details>`;
  }
  $('rail').innerHTML = h;
}
function emptyState() { return C.length ? `<div class="empty"><div class="dsp">No creators match</div><p>Try removing a filter or clearing your search.</p><button type="button" class="btn pri" data-act="clearf">Clear filters</button></div>` : `<div class="empty"><div class="dsp">No applicants yet</div><p>Applications appear here after the next hourly sync from Jotform.</p></div>`; }
function renderMain() {
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === S.view));
  $('sort').value = S.sort;
  $('layout').classList.toggle('wide', S.view === 'boards');
  const L = results();
  if (S.view === 'board') { $('main').innerHTML = boardHTML(L); return; }
  if (S.view === 'map') { $('main').innerHTML = mapHTML(L); drawMap(L); return; }
  if (S.view === 'boards') { $('main').innerHTML = S.board ? boardDetailHTML() : boardsHTML(); return; }
  if (S.view === 'insights') { $('main').innerHTML = insightsHTML(L); return; }
  if (!L.length) { $('main').innerHTML = emptyState(); return; }
  $('main').innerHTML = S.view === 'table' ? tableHTML(L) : wallHTML(L);
}
function statBox(k, v, top) { return `<div class="stat${v == null ? ' na' : ''}${top ? ' top' : ''}"><div class="k">${k}</div><div class="v num">${fmt(v)}</div></div>`; }
function cardHTML(c, extra) {
  const cr = CRM[c.id]; const m = media(c).filter((x) => x.kind === 'img'); const top = maxAud(c); const ts = teamScore(c.id);
  const thumbs = c.setups.length ? c.setups.slice(0, 3).map((s, i) => `<button type="button" data-act="lb" data-id="${c.id}" data-i="${i + 1}" aria-label="View ${esc(s.label)}"><img src="${s.src}" alt="" loading="lazy"></button>`).join('') : `<span class="miss" style="grid-column:span 3">No setup photos uploaded</span>`;
  return `<article class="card${S.cmp.includes(c.id) ? ' cmp-on' : ''}" data-id="${c.id}">
    <div class="cm" data-act="open" data-id="${c.id}" data-scrub="${c.id}">
      <div class="scrub">${m.map((x, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>
      <img src="${c.head}" alt="${esc(c.name)}" loading="lazy">
      ${stPill(cr.status)}
      <button type="button" class="star${cr.fav ? ' on' : ''}" data-act="fav" data-id="${c.id}" aria-label="${cr.fav ? 'Remove from' : 'Add to'} favourites">${STAR(cr.fav)}</button>
      ${ts != null ? `<span class="scorepill num" title="Team score">${sc1(ts)}</span>` : ''}
      ${extra || ''}
      <div class="shade"></div>
      <div class="who"><div class="n">${esc(c.name)}</div><div class="l">${esc(c.city)}${c.prov ? ', ' + c.prov : ''} ${langTags(c)}</div></div>
    </div>
    <div class="cbody">
      <div class="strip">${thumbs}${c.posts.length ? `<button type="button" class="more" data-act="lb" data-id="${c.id}" data-i="${1 + c.setups.length}">${c.posts.length} post${c.posts.length > 1 ? 's' : ''}</button>` : '<span class="miss">No posts</span>'}</div>
      <div class="stats">${statBox('TikTok', c.tt, c.tt === top && top > 0)}${statBox('Insta', c.ig, c.ig === top && top > 0)}${statBox('YouTube', c.yt, c.yt === top && top > 0)}</div>
      ${nearLine(c)}
      <div class="tags">${cr.tags.slice(0, 2).map((t) => `<span class="tag team">${esc(t)}</span>`).join('')}${needs(c).slice(0, 1).map((t) => `<span class="tag warn">${esc(t)}</span>`).join('')}${c.lanes.slice(0, cr.tags.length ? 1 : 2).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="cfoot"><span>Applied ${daysAgo(c) === 0 ? 'today' : daysAgo(c) + 'd ago'}</span><label class="cmpbox"><input type="checkbox" data-act="cmp" data-id="${c.id}" ${S.cmp.includes(c.id) ? 'checked' : ''}> Compare</label></div>
    </div></article>`;
}
function wallHTML(L) { return `<div class="wall">${L.map((c) => cardHTML(c)).join('')}</div>`; }
function boardHTML(L) {
  return `<div class="board">${STATUSES.map((s) => { const items = L.filter((c) => CRM[c.id].status === s);
    return `<section class="col" data-drop="${s}"><div class="colh"><span class="t"><span class="dot" style="background:${STCOL[s]}"></span>${s}</span><span class="c num">${items.length}</span></div>
    <div class="colb">${items.map((c) => { const sd = stageDays(c.id); const stuck = ['Reviewed', 'Shortlisted', 'Contacted'].includes(s) && sd > 7; const ts = teamScore(c.id);
      return `<div class="mini" draggable="true" data-drag="${c.id}" data-act="open" data-id="${c.id}"><img src="${c.head}" alt=""><div style="min-width:0"><div class="n">${CRM[c.id].fav ? '<span class="fv">★</span> ' : ''}${esc(c.name)}</div><div class="m">${esc(c.city)} · ${kmTxt(nd(c))} to store</div>${stuck ? `<span class="stuck">${sd} days in stage</span>` : ''}</div><div class="r num">${ts != null ? sc1(ts) : fmt(maxAud(c))}<div style="font-family:var(--body);font-style:normal;font-size:9.5px;color:var(--fg3);font-weight:600">${ts != null ? 'score' : 'top reach'}</div></div></div>`; }).join('') || '<div class="colempty">Drag a creator here</div>'}</div></section>`; }).join('')}</div>`;
}
function tableHTML(L) {
  const sb2 = (k, l) => `<button type="button" data-act="sortby" data-k="${k}" aria-pressed="${S.sort === k}">${l}</button>`;
  return `<div class="tw"><table><thead><tr><th></th><th></th><th>${sb2('name', 'Creator')}</th><th>Location</th><th>${sb2('near', 'Closest JD store')}</th><th>Lang</th><th style="text-align:right">${sb2('tt', 'TikTok')}</th><th style="text-align:right">${sb2('ig', 'Instagram')}</th><th style="text-align:right">${sb2('yt', 'YouTube')}</th><th style="text-align:right">${sb2('score', 'Score')}</th><th>Status</th><th>Owner</th><th>Tags</th><th>${sb2('new', 'Applied')}</th></tr></thead><tbody>
  ${L.map((c) => { const cr = CRM[c.id]; return `<tr data-act="open" data-id="${c.id}"><td><button type="button" class="tstar${cr.fav ? ' on' : ''}" data-act="fav" data-id="${c.id}" aria-label="Favourite">${STAR(cr.fav)}</button></td><td><img src="${c.head}" alt=""></td><td><div class="n">${esc(c.name)}</div><div style="color:var(--fg3);font-size:11px">@${esc(c.handle)}</div></td><td>${esc(c.city)}${c.prov ? ', ' + c.prov : ''}</td><td>${c.near[0] ? `<div style="font-weight:600">${esc(c.near[0].s.name)}</div><div style="color:${nd(c) <= 25 ? 'var(--lime)' : 'var(--fg3)'};font-size:11px">${kmTxt(nd(c))}</div>` : '<span class="muted">Unknown</span>'}</td><td>${c.langs.map((l) => (l === 'French' ? 'FR' : l === 'English' ? 'EN' : '')).filter(Boolean).join(' / ')}</td><td class="r">${fmt(c.tt)}</td><td class="r">${fmt(c.ig)}</td><td class="r">${fmt(c.yt)}</td><td class="r">${sc1(teamScore(c.id))}</td><td>${stInline(cr.status)}</td><td>${esc(dispName(cr.owner))}</td><td><div class="tags">${cr.tags.map((t) => `<span class="tag team">${esc(t)}</span>`).join('')}</div></td><td class="num">${fmtDate(c.applied)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function renderTray() {
  const t = document.querySelector('.tray'); if (t) t.remove(); if (!S.cmp.length) return;
  const el = document.createElement('div'); el.className = 'tray';
  el.innerHTML = `<div class="fs">${S.cmp.map((id) => { const c = C.find((x) => x.id === id); return c ? `<img src="${c.head}" alt="">` : ''; }).join('')}</div><span class="t">${S.cmp.length} selected${S.cmp.length < 2 ? ', pick one more' : ''}</span><button type="button" class="btn" data-act="cmpclear">Clear</button><button type="button" class="btn pri" data-act="cmpopen" ${S.cmp.length < 2 ? 'disabled' : ''}>Compare</button>`;
  document.body.appendChild(el);
}

/* ---------------------------------------------------------------- link previews */
function linkPreviews(c) {
  const out = [];
  const byUrl = (u) => c.previews.find((p) => p.url === u) || {};
  [['TikTok', c.tt, 'followers'], ['Instagram', c.ig, 'followers'], ['YouTube', c.yt, 'subscribers']].forEach(([plat, n, unit]) => {
    const u = c.urls[plat]; if (!u) return; const pv = byUrl(u); const img = pv.thumb_path && SIGNED[pv.thumb_path] ? SIGNED[pv.thumb_path] : c.head; const isUrl = /^https?:/.test(u);
    out.push(`<a class="lp round" ${isUrl ? `href="${esc(u)}" target="_blank" rel="noopener noreferrer"` : ''}><img src="${img}" alt=""><span style="min-width:0"><span class="pt">${esc(pv.title || c.name)}${pv.author ? ' (' + esc(pv.author) + ')' : ''}</span><span class="pd">${n != null ? fmt(n) + ' ' + unit + (pv.description ? ' · ' : '') : ''}${esc((pv.description || '').slice(0, 140))}</span><span class="pu"><span class="plat">${plat}</span><span>${esc(u.replace(/^https?:\/\/(www\.)?/, ''))}</span></span></span></a>`);
  });
  if (c.portfolio) { const pv = byUrl(c.portfolio); const img = pv.thumb_path && SIGNED[pv.thumb_path];
    out.push(`<a class="lp${img ? ' wide' : ''}" href="${esc(c.portfolio)}" target="_blank" rel="noopener noreferrer">${img ? `<img src="${img}" alt="">` : `<img src="${c.head}" alt="">`}<span class="${img ? 'lpb' : ''}" style="min-width:0"><span class="pt">${esc(pv.title || 'Portfolio or content reel')}</span><span class="pd">${esc((pv.description || '').slice(0, 160))}</span><span class="pu"><span class="plat">Website</span><span>${esc(c.portfolio.replace(/^https?:\/\/(www\.)?/, ''))}</span></span></span></a>`); }
  return out.join('') || '<div class="muted">No links shared.</div>';
}

/* ---------------------------------------------------------------- store card */
function storeCard(c) {
  if (!c.near.length) return `<div class="store"><div class="store-top"><div class="store-k"><span>Closest JD store</span><span class="tagx far">Location unknown</span></div><div class="store-a" style="margin-top:8px">We couldn't place "${esc(c.city)}" on the map, so distances aren't available. The next sync will try again.</div></div></div>`;
  const [a, b, d] = c.near; const far = a.d > 50;
  return `<div class="store"><div class="store-top">
    <div class="store-k"><span>Closest JD store</span><span class="tagx${far ? ' far' : ''}">${storeLabel(a.d)}</span></div>
    <div class="store-main"><div style="min-width:0"><div class="store-n dsp">JD ${esc(a.s.name)}</div><div class="store-a">${esc(fullAddr(a.s))}</div><div class="store-p">${esc(a.s.phone)}</div></div>
    <div class="store-d"><div class="v num${far ? ' far' : ''}">${a.d < 10 ? a.d.toFixed(1) : Math.round(a.d)}</div><div class="u">km away</div></div></div>
  </div><div class="store-more">${[b, d].filter(Boolean).map((x) => `<div class="store-row"><b>JD ${esc(x.s.name)} <span>· ${esc(x.s.city)}, ${x.s.prov}</span></b><span class="num">${kmTxt(x.d)}</span></div>`).join('')}</div>
  <div class="store-note">Straight-line distance from ${esc(c.city)}, the city given on the application. Store details from jdsports.ca.</div></div>`;
}

/* ---------------------------------------------------------------- scorecard */
function scoreHTML(id) {
  const cr = CRM[id]; const mine = cr.scores[ME] || {}; const others = Object.entries(cr.scores).filter(([w]) => w !== ME); const ts = teamScore(id); const n = Object.values(cr.scores).filter((o) => o.cam || o.prod || o.fit).length;
  return `<div class="score">${CRIT.map(([k, l, s]) => `<div class="srow"><div class="cr">${l}<small>${s}</small></div><div class="dots">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-act="rate" data-k="${k}" data-v="${v}" aria-pressed="${mine[k] === v}" aria-label="${l} ${v} of 5">${v}</button>`).join('')}<span class="others">${others.map(([w, o]) => (o[k] ? `<span title="${esc(w)}">${esc(dispName(w))} ${o[k]}</span>` : '')).join('')}</span></div><div class="savg num">${sc1(critAvg(id, k))}</div></div>`).join('')}
  <div class="score-foot"><div><div class="lbl" style="margin:0">Team score</div><div class="big num">${sc1(ts)}<span style="font-size:16px;color:var(--fg3)"> / 5</span></div></div><div style="display:grid;gap:6px;justify-items:end"><span class="muted" style="font-size:11.5px">${n} reviewer${n === 1 ? '' : 's'}${mine.cam || mine.prod || mine.fit ? '' : ', you have not scored yet'}</span>${isSplit(id) ? '<span class="split">Split opinion: discuss before deciding</span>' : ''}</div></div></div>`;
}

/* ---------------------------------------------------------------- outreach */
const TPL = {
  invite: { l: 'Invite to a call', en: { s: 'Your JD Creator Collective application', b: `Hi {first},\n\nThanks for applying to the JD Creator Collective. We loved your {lane} content and we'd like to get to know you better.\n\nCould you reply with your availability for a 15 minute call next week? We're also planning shoots at JD {store}, so let us know if that location works for you.\n\nThanks,\n{sender}\nJD Sports Canada` }, fr: { s: 'Ta candidature au JD Creator Collective', b: `Salut {first},\n\nMerci d'avoir postulé au JD Creator Collective. On a adoré ton contenu ({lane}) et on aimerait te connaître davantage.\n\nPeux-tu nous indiquer tes disponibilités pour un appel de 15 minutes la semaine prochaine? Nous prévoyons aussi des tournages au magasin JD {store}. Dis-nous si cet emplacement te convient.\n\nMerci,\n{sender}\nJD Sports Canada` } },
  info: { l: 'Ask for more info', en: { s: 'A quick follow-up on your application', b: `Hi {first},\n\nThanks for applying to the JD Creator Collective. Before we review your application, could you send a few examples of recent content and a photo of your filming setup?\n\nYou can reply to this email with links or attachments.\n\nThanks,\n{sender}\nJD Sports Canada` }, fr: { s: 'Un suivi rapide sur ta candidature', b: `Salut {first},\n\nMerci d'avoir postulé au JD Creator Collective. Avant d'étudier ta candidature, peux-tu nous envoyer quelques exemples de contenu récent et une photo de ton espace de tournage?\n\nTu peux répondre à ce courriel avec des liens ou des pièces jointes.\n\nMerci,\n{sender}\nJD Sports Canada` } },
  onboard: { l: 'Welcome and next steps', en: { s: 'Welcome to the JD Creator Collective', b: `Hi {first},\n\nWelcome to the JD Creator Collective! Your package is {rem}, with {tier} usage for 12 months.\n\nNext steps:\n1. Sign the creator agreement we'll send separately.\n2. Reply with your shipping address and sizes.\n3. Watch for your first brief this week.\n\nYour closest store for in-store shoots is JD {store}.\n\n{sender}\nJD Sports Canada` }, fr: { s: 'Bienvenue dans le JD Creator Collective', b: `Salut {first},\n\nBienvenue dans le JD Creator Collective! Ton forfait : {rem}, avec des droits d'utilisation {tier} pendant 12 mois.\n\nProchaines étapes :\n1. Signer l'entente de créateur que nous t'enverrons séparément.\n2. Nous répondre avec ton adresse de livraison et tes tailles.\n3. Surveiller ton premier brief cette semaine.\n\nTon magasin le plus proche pour les tournages en magasin : JD {store}.\n\n{sender}\nJD Sports Canada` } },
  decline: { l: 'Not this time', en: { s: 'Your JD Creator Collective application', b: `Hi {first},\n\nThanks for applying to the JD Creator Collective and for sharing your work. We won't be moving forward with your application this round, but we'll keep your details on file for future campaigns.\n\nKeep creating, and thanks again for your interest in JD.\n\n{sender}\nJD Sports Canada` }, fr: { s: 'Ta candidature au JD Creator Collective', b: `Salut {first},\n\nMerci d'avoir postulé au JD Creator Collective et de nous avoir partagé ton travail. Nous n'irons pas de l'avant avec ta candidature cette fois-ci, mais nous conservons ton dossier pour de futures campagnes.\n\nContinue de créer, et merci encore de ton intérêt pour JD.\n\n{sender}\nJD Sports Canada` } },
};
const defLang = (c) => (c.langs.includes('French') && (!c.langs.includes('English') || c.prov === 'QC') ? 'fr' : 'en');
const defTpl = (c) => { const s = CRM[c.id].status; return s === 'Onboarded' ? 'onboard' : s === 'Declined' ? 'decline' : !c.setups.length || !c.posts.length ? 'info' : 'invite'; };
function fillT(c, lang, key) {
  const cr = CRM[c.id]; const t = TPL[key][lang]; const lane0 = (c.lanes[0] || 'creator').toLowerCase(); const lane = lang === 'fr' ? LANES_FR[lane0] || lane0 : lane0;
  const st = c.near[0] ? c.near[0].s : null;
  const map = { first: c.first, lane, store: st ? st.name + (lang === 'fr' ? ' (' + st.city + ')' : ' in ' + st.city) : (lang === 'fr' ? 'le plus proche' : 'nearest you'), rem: lang === 'fr' ? REMS_FR[cr.rem] || cr.rem : cr.rem.toLowerCase(), tier: cr.tier === 'Not set' ? (lang === 'fr' ? 'à confirmer' : 'to be confirmed') : cr.tier, sender: fullName(ME) || 'The JD Creator Collective team' };
  const f = (s) => s.replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m); return { s: f(t.s), b: f(t.b) };
}
function outreachHTML(c) {
  const lang = S.otLang || defLang(c); const key = S.otTpl || defTpl(c); const m = fillT(c, lang, key); const cr = CRM[c.id];
  return `<div class="outreach">
    <div class="ot-row"><select id="ottpl" aria-label="Template">${Object.entries(TPL).map(([k, t]) => `<option value="${k}"${k === key ? ' selected' : ''}>${t.l}</option>`).join('')}</select>
    <div class="ltog" role="group" aria-label="Language"><button type="button" data-act="otlang" data-l="en" aria-pressed="${lang === 'en'}">EN</button><button type="button" data-act="otlang" data-l="fr" aria-pressed="${lang === 'fr'}">FR</button></div></div>
    <div class="subj">Subject: <b id="otsubj">${esc(m.s)}</b></div>
    <textarea id="otbody" aria-label="Message">${esc(m.b)}</textarea>
    <div class="to"><span>To: ${S.reveal[c.id] ? esc(c.email) : esc(mask(c.email))}</span><span>${cr.contacted ? 'Last contacted ' + fmtDate(cr.contacted) : 'Not contacted yet'}</span></div>
    <div class="ot-row"><button type="button" class="btn pri" data-act="otcopy">Copy message</button><button type="button" class="btn" data-act="otsent">Mark as sent</button><span class="muted" style="font-size:11px">Send from your own inbox. Marking as sent logs it and updates the stage.</span></div>
  </div>`;
}

/* ---------------------------------------------------------------- drawer */
function drawerHTML(c) {
  const cr = CRM[c.id]; const L = results(); const idx = L.findIndex((x) => x.id === c.id); const m = media(c); const top = maxAud(c); const r = rights(c);
  const owners = ['Unassigned', ...uniq([...TEAM, cr.owner].filter((x) => x && x !== 'Unassigned'))];
  const sel = (id, label, opts, val, show) => `<div class="fld"><label for="${id}">${label}</label><select id="${id}" data-field="${id.replace('f-', '')}">${opts.map((o) => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(show ? show(o) : o)}</option>`).join('')}</select></div>`;
  const ps = (k, v, plat) => `<div class="pstat${v == null ? ' na' : ''}"><div class="k">${k}</div><div class="v num" style="${v && v === top ? 'color:var(--lime)' : ''}">${fmt(v)}</div><div class="h">${c.urls[plat] ? '@' + esc(handleOf(c.urls[plat], plat)) : 'No profile'}</div></div>`;
  const rev = S.reveal[c.id];
  return `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(c.name)}">
  <div class="dh"><div class="nav"><button type="button" class="ib" data-act="prev" aria-label="Previous creator">‹</button><button type="button" class="ib" data-act="next" aria-label="Next creator">›</button><span class="num">${idx >= 0 ? idx + 1 + ' of ' + L.length : 'Not in current filter'}</span><span class="muted">· ← → to browse · F to favourite</span></div><button type="button" class="ib" data-act="close" aria-label="Close">×</button></div>
  <div class="db">
    <div style="min-width:0">
      <div class="media-main" data-act="lb" data-id="${c.id}" data-i="0"><img src="${c.head}" alt="${esc(c.name)} headshot"><span class="hint">${m.length} photo${m.length === 1 ? '' : 's'} and posts · click to expand</span></div>
      ${c.setups.length ? `<div class="thumbs">${c.setups.map((s, i) => `<button type="button" data-act="lb" data-id="${c.id}" data-i="${i + 1}" aria-label="${esc(s.label)}"><img src="${s.src}" alt=""></button>`).join('')}</div>` : `<div class="misscard" style="margin-top:8px">No filming setup photos uploaded. Use the "Ask for more info" template to request them.</div>`}
      <div class="sec-t">Best posts <small>Click to play</small></div>
      ${c.posts.length ? `<div class="posts">${c.posts.map((p, i) => `<button type="button" class="post" data-act="lb" data-id="${c.id}" data-i="${1 + c.setups.length + i}" aria-label="Play ${esc(p.caption)}"><span class="pg" style="background:${p.bg}"></span>${p.thumb ? `<img class="pthumb" src="${p.thumb}" alt="">` : ''}<span class="pp"><span>${PLAY}</span></span><span class="pf">${esc(p.platform)}</span><span class="pc">${esc(p.caption.slice(0, 70))}${p.author ? `<em>${esc(p.author)}</em>` : ''}</span></button>`).join('')}</div>` : '<div class="misscard">No post links shared on the application.</div>'}
      <div class="sec-t">Links <small>Previews built from their application links</small></div>
      <div class="links">${linkPreviews(c)}</div>
      <div class="sec-t">In their words</div>
      ${c.niche ? `<div class="quote"><div class="q">Niche or edge</div>${esc(c.niche)}</div>` : ''}
      ${c.apart ? `<div class="quote"><div class="q">What sets them apart</div>${esc(c.apart)}</div>` : ''}
      ${c.more ? `<div class="quote"><div class="q">Tell us more</div>${esc(c.more).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="sec-t">Their craft</div>
      <dl class="kv">
        <dt>Content lanes</dt><dd><div class="chips">${c.lanes.map((x) => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="muted">Not given</span>'}</div></dd>
        <dt>What they can do</dt><dd><div class="chips">${c.can.map((x) => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="muted">Not given</span>'}</div></dd>
        <dt>On camera</dt><dd>${esc(c.style)}</dd>
        <dt>Equipment</dt><dd><div class="chips">${c.equipment.map((x) => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="muted">Not given</span>'}</div></dd>
        <dt>Editing</dt><dd>${c.software.map(esc).join(', ') || '<span class="muted">Not given</span>'}</dd>
        <dt>Brand pools</dt><dd><div class="chips">${c.brands.map((x) => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="muted">Not given</span>'}</div></dd>
        <dt>Partnership Ads</dt><dd>${esc(c.padsRaw || 'Not given')}</dd>
        <dt>Age band</dt><dd>${esc(c.ageBand)} <span class="muted">(date of birth is not stored)</span></dd>
        <dt>Applied</dt><dd>${fmtDate(c.applied, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</dd>
      </dl>
    </div>
    <div style="min-width:0">
      <div class="pname dsp">${esc(c.name)}</div>
      <div class="ploc">${esc(c.city)}${c.provName ? ', ' + esc(c.provName) : ''} <span class="muted">· ${esc(c.metro)}</span> ${c.langs.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</div>
      <div class="badges">
        ${bilingual(c) ? '<span class="bdg lime">French-ready</span>' : ''}
        ${c.pads && maxAud(c) >= 10000 ? '<span class="bdg lime">Ad-ready</span>' : ''}
        ${c.ageOk ? '<span class="bdg ok">18+ confirmed</span>' : '<span class="bdg warn">18+ not confirmed</span>'}
        ${c.consent ? '<span class="bdg ok">Data consent given</span>' : ''}
        ${c.pads ? '<span class="bdg ok">Partnership Ads OK</span>' : '<span class="bdg">No Partnership Ads</span>'}
        ${c.customer ? '<span class="bdg">JD customer</span>' : ''}${c.employee ? '<span class="bdg">JD employee</span>' : ''}${c.workedJD ? '<span class="bdg">Worked with JD before</span>' : ''}
        ${needs(c).filter((x) => x !== 'Age not confirmed').map((x) => `<span class="bdg warn">${esc(x)}</span>`).join('')}
      </div>
      ${storeCard(c)}
      <div class="crm">
        <div class="crm-top"><button type="button" class="favbtn${cr.fav ? ' on' : ''}" data-act="fav" data-id="${c.id}">${STAR(cr.fav)} ${cr.fav ? 'Favourited' : 'Favourite'}</button><span class="muted" style="font-size:11.5px">In ${esc(cr.status)} for ${stageDays(c.id)} day${stageDays(c.id) === 1 ? '' : 's'}</span></div>
        <div><span class="lbl">Pipeline stage</span><div class="stages">${STATUSES.map((s) => `<button type="button" class="stg" data-act="stage" data-s="${s}" aria-pressed="${cr.status === s}" style="${cr.status === s ? 'background:' + STCOL[s] + ';border-color:' + STCOL[s] : ''}"><span class="dot" style="background:${STCOL[s]}"></span>${s}</button>`).join('')}</div></div>
        <div class="fields">${sel('f-owner', 'Owner', owners, cr.owner, dispName)}${sel('f-type', 'Creator type', TYPES, cr.type)}${sel('f-rem', 'Remuneration', REMS, cr.rem)}${sel('f-tier', 'Deliverable tier', TIERS, cr.tier)}</div>
        ${cr.status === 'Onboarded' ? `<div class="fld"><label for="f-rights">Usage rights start</label><input id="f-rights" type="date" value="${cr.rightsStart || ''}" style="background:var(--s2);border:1px solid var(--line);border-radius:8px;padding:7px 10px">${r && r.end ? `<div style="font-size:12px;margin-top:6px">${esc(r.state)} · 12 months to ${fmtDate(r.end, { month: 'short', day: 'numeric', year: 'numeric' })} <span class="muted">(${r.left} days left)</span></div>` : '<div class="muted" style="font-size:11.5px;margin-top:6px">Set this when content is first delivered.</div>'}</div>` : ''}
        <div><span class="lbl">Campaign boards</span><div class="bchips">${BOARDS.map((b) => `<button type="button" class="bchip" data-act="tboard" data-b="${b.id}" aria-pressed="${!!MEMBERS.get(b.id + '|' + c.id)}">${esc(b.name)}</button>`).join('') || '<span class="muted" style="font-size:12px">No boards yet. Create one in the Boards tab.</span>'}</div></div>
        <div><span class="lbl">Team tags</span>
          <div class="tagedit">${cr.tags.map((t) => `<span class="tag team">${esc(t)}<button type="button" data-act="rmtag" data-t="${esc(t)}" aria-label="Remove tag">×</button></span>`).join('') || '<span class="muted" style="font-size:12px">No tags yet</span>'}</div>
          <div class="tagadd"><input id="tagin" placeholder="Add a tag, press Enter" aria-label="Add tag">${TAG_SUGG.filter((t) => !cr.tags.includes(t)).slice(0, 4).map((t) => `<button type="button" class="sugg" data-act="addtag" data-t="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div></div>
      </div>
      <div class="sec-t">Scorecard <small>Your scores plus the team's</small></div>
      ${scoreHTML(c.id)}
      <div class="sec-t">Audience</div>
      <div class="pstats">${ps('TikTok', c.tt, 'TikTok')}${ps('Instagram', c.ig, 'Instagram')}${ps('YouTube', c.yt, 'YouTube')}</div>
      <div class="sec-t">Outreach <small>Templates fill in from this profile</small></div>
      ${outreachHTML(c)}
      <div class="sec-t">Contact</div>
      <div class="contact"><span>${rev ? esc(c.email) + ' · ' + esc(c.phone || 'No phone') : esc(mask(c.email)) + ' · ' + esc(mask(c.phone))}</span>${rev ? '<span class="muted">Viewing is logged</span>' : `<button type="button" class="reveal" data-act="reveal">Show contact details</button>`}</div>
      <div class="sec-t">Notes <small>${cr.notes.length} note${cr.notes.length === 1 ? '' : 's'}</small></div>
      <div class="notes">${cr.notes.map((n) => `<div class="note"><div class="m"><b>${esc(dispName(n.by))}</b> · ${new Date(n.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>${esc(n.text).replace(/\n/g, '<br>')}</div>`).join('')}
        <div class="noteform"><textarea id="notein" placeholder="Add a note for the team"></textarea><div><button type="button" class="btn pri" data-act="addnote">Add note</button></div></div></div>
      <div class="sec-t">Activity</div>
      <div class="log">${cr.log.slice(0, 15).map((l) => `<div><b>${fmtDate(l.at)}</b> · ${esc(l.text)} <span class="muted">· ${esc(dispName(l.by))}</span></div>`).join('')}</div>
      <div class="dangerzone"><b style="color:var(--fg)">Erase this applicant</b><span>Use this if the applicant asks to be removed. They disappear from the CRM now and their data and photos are permanently erased at the next hourly sync. Also delete the submission in Jotform.</span><div><button type="button" class="btn danger${S.armDelete === c.id ? ' armed' : ''}" data-act="erase">${S.armDelete === c.id ? 'Click again to confirm' : 'Erase applicant'}</button></div></div>
    </div>
  </div></aside>`;
}

/* ---------------------------------------------------------------- lightbox */
function embedStage(p) {
  if (p.embed) { const wide = /youtube\.com\/embed/.test(p.embed) && !/shorts/.test(p.url); return `<div class="embedwrap${wide ? ' wide' : ''}"><iframe src="${esc(p.embed)}" title="${esc(p.caption)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`; }
  return `<div class="postbig" style="background:${p.bg}">${p.thumb ? `<img src="${p.thumb}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : ''}<div class="note2"><b>${esc(p.caption)}</b><br><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--lime);font-weight:700">Open on ${esc(p.platform)} ↗</a></div></div>`;
}
function lbHTML() {
  const c = C.find((x) => x.id === S.lb.id); if (!c) return ''; const m = media(c); const i = Math.min(S.lb.i, m.length - 1); const it = m[i];
  const stage = it.kind === 'img' ? `<img src="${it.src}" alt="${esc(it.label)}">` : embedStage(it.post);
  return `<div class="lb" role="dialog" aria-modal="true" aria-label="Media viewer"><div class="lbh"><div><div class="t">${esc(c.name)}</div><div class="c num">${esc(it.label)} · ${i + 1} of ${m.length}${it.kind === 'post' ? ` · <a href="${esc(it.post.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--lime)">Open original ↗</a>` : ''}</div></div><div style="display:flex;gap:8px"><button type="button" class="btn" data-act="lbprofile">Open profile</button><button type="button" class="ib" data-act="lbclose" aria-label="Close">×</button></div></div>
  <div class="lbs">${stage}<button type="button" class="lbn p" data-act="lbprev" aria-label="Previous">‹</button><button type="button" class="lbn n" data-act="lbnext" aria-label="Next">›</button></div>
  <div class="lbt">${m.map((x, j) => `<button type="button" class="${j === i ? 'on' : ''}" data-act="lbgo" data-i="${j}" aria-label="${esc(x.label)}">${x.kind === 'img' ? `<img src="${x.src}" alt="">` : x.post.thumb ? `<img src="${x.post.thumb}" alt="">` : `<span style="display:block;width:100%;height:100%;background:${x.post.bg}"></span>`}</button>`).join('')}</div></div>`;
}

/* ---------------------------------------------------------------- compare */
function cmpHTML() {
  const cs = S.cmp.map((id) => C.find((c) => c.id === id)).filter(Boolean); const cols = `grid-template-columns:150px repeat(${cs.length},minmax(0,1fr))`;
  const best = (f, low) => { const v = cs.map(f); const ok = v.filter((x) => x != null && x !== 0 && isFinite(x)); if (!ok.length) return v.map(() => false); const t = low ? Math.min(...ok) : Math.max(...ok); return v.map((x) => x === t); };
  const row = (l, f, b, low) => { const bb = b ? best(b, low) : []; return `<div class="crow" style="${cols}"><div>${l}</div>${cs.map((c, i) => `<div class="${bb[i] ? 'best' : ''}">${f(c)}</div>`).join('')}</div>`; };
  const chips = (a) => `<div class="chips">${a.map((x) => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="muted">None</span>'}</div>`;
  return `<div class="full" role="dialog" aria-modal="true" aria-label="Compare creators"><div class="dh"><span class="dsp" style="font-size:28px">Compare creators</span><button type="button" class="ib" data-act="cmpclose" aria-label="Close">×</button></div><div class="fullb"><div style="overflow-x:auto"><div class="cgrid">
  <div class="crow chead" style="${cols}"><div></div>${cs.map((c) => `<div><img src="${c.head}" alt="" data-act="open" data-id="${c.id}"><div class="n">${esc(c.name)}</div><div class="muted" style="font-size:11.5px;margin-top:4px">${esc(c.city)}${c.prov ? ', ' + c.prov : ''}</div><div style="margin-top:8px"><button type="button" class="favbtn${CRM[c.id].fav ? ' on' : ''}" data-act="fav" data-id="${c.id}">${STAR(CRM[c.id].fav)} ${CRM[c.id].fav ? 'Favourited' : 'Favourite'}</button></div></div>`).join('')}</div>
  ${row('Status', (c) => stInline(CRM[c.id].status))}
  ${row('Team score', (c) => sc1(teamScore(c.id)), (c) => teamScore(c.id))}
  ${row('Closest JD store', (c) => (c.near[0] ? `${esc(c.near[0].s.name)}<div class="muted">${kmTxt(nd(c))}</div>` : 'Unknown'), (c) => nd(c), true)}
  ${row('TikTok', (c) => fmt(c.tt), (c) => c.tt)}${row('Instagram', (c) => fmt(c.ig), (c) => c.ig)}${row('YouTube', (c) => fmt(c.yt), (c) => c.yt)}${row('Total reach', (c) => fmt(c.reach), (c) => c.reach)}
  ${row('Languages', (c) => c.langs.map(esc).join(', '))}${row('On camera', (c) => esc(c.style))}
  ${row('Content lanes', (c) => chips(c.lanes))}${row('Can do', (c) => chips(c.can))}${row('Equipment', (c) => chips(c.equipment))}${row('Brand pools', (c) => chips(c.brands))}
  ${row('Partnership Ads', (c) => (c.pads ? 'Yes' : 'No'))}${row('Team tags', (c) => chips(CRM[c.id].tags))}
  ${row('Setup photos', (c) => (c.setups.length ? `<div class="strip" style="grid-template-columns:repeat(3,1fr)">${c.setups.slice(0, 3).map((s, i) => `<button type="button" data-act="lb" data-id="${c.id}" data-i="${i + 1}"><img src="${s.src}" alt=""></button>`).join('')}</div>` : '<span style="color:var(--warn)">None uploaded</span>'))}
  </div></div></div></div>`;
}

/* ---------------------------------------------------------------- casting */
function startCast(mode) { const L = mode === 'new' ? C.filter((c) => CRM[c.id].status === 'New').sort((a, b) => a.applied - b.applied) : results(); S.cast = { mode, queue: L.map((c) => c.id), i: 0, hist: [], tally: { yes: 0, maybe: 0, no: 0, skip: 0 }, mi: 0 }; S.open = null; renderOverlays(); }
function castHTML() {
  const K = S.cast; const n = K.queue.length;
  const head = `<div class="cast-h"><span class="dsp t">Casting mode</span><div class="prog"><div class="lab">${K.i < n ? `Creator ${K.i + 1} of ${n}` : 'Queue finished'} · ${K.mode === 'new' ? 'All New applicants, oldest first' : 'Current filters'}</div><div class="bar3"><i style="width:${n ? Math.min(100, (K.i / n) * 100) : 100}%"></i></div></div>
    <div style="display:flex;gap:8px;align-items:center"><select class="sel" id="castmode" aria-label="Queue"><option value="new"${K.mode === 'new' ? ' selected' : ''}>New applicants</option><option value="filtered"${K.mode === 'filtered' ? ' selected' : ''}>Current filters</option></select><button type="button" class="ib" data-act="castoff" aria-label="Close casting mode">×</button></div></div>`;
  if (K.i >= n) return `<div class="cast" role="dialog" aria-modal="true" aria-label="Casting mode">${head}<div style="overflow:auto"><div class="done"><div class="dsp">${n ? 'Queue cleared' : 'Nothing to review'}</div><p class="muted">${n ? 'Here is how this session went. Every decision is logged on the creator profile.' : 'There are no creators in this queue. Try switching to Current filters.'}</p>
    <div class="tally">${[['Yes', 'yes', 'var(--lime)'], ['Maybe', 'maybe', 'var(--warn)'], ['No', 'no', 'var(--st-dec)'], ['Skipped', 'skip', 'var(--fg2)']].map(([l, k, col]) => `<div class="kpi"><div class="k">${l}</div><div class="v num" style="color:${col}">${K.tally[k]}</div></div>`).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${K.hist.length ? '<button type="button" class="btn" data-act="castundo">Undo last</button>' : ''}<button type="button" class="btn pri" data-act="castshort">See the shortlist</button><button type="button" class="btn" data-act="castoff">Close</button></div></div></div><div></div></div>`;
  const c = C.find((x) => x.id === K.queue[K.i]); if (!c) { K.i++; return castHTML(); }
  const m = media(c); const mi = Math.min(K.mi, m.length - 1); const it = m[mi]; const cr = CRM[c.id]; const mine = cr.scores[ME] || {};
  const big = it.kind === 'img' ? `<img src="${it.src}" alt="">` : embedStage(it.post);
  return `<div class="cast" role="dialog" aria-modal="true" aria-label="Casting mode">${head}
  <div class="cast-b"><div class="cast-card" style="min-width:0"><div class="cast-media"><div class="mm">${big}</div><div class="side">${m.slice(0, 5).map((x, j) => `<button type="button" class="${j === mi ? 'on' : ''}" data-act="castmi" data-i="${j}" aria-label="${esc(x.label)}">${x.kind === 'img' ? `<img src="${x.src}" alt="">` : x.post.thumb ? `<img src="${x.post.thumb}" alt="">` : `<span style="background:${x.post.bg}"></span>`}</button>`).join('')}</div></div><div class="muted" style="font-size:11px;margin-top:6px">${esc(it.label)} · press 1 to 5 to flick through media</div></div>
  <div class="cast-card" style="min-width:0">
    <div class="pname dsp">${esc(c.name)}</div>
    <div class="ploc">${esc(c.city)}${c.provName ? ', ' + esc(c.provName) : ''} ${c.langs.map((l) => `<span class="chip">${esc(l)}</span>`).join('')} <span class="muted">· applied ${daysAgo(c)}d ago</span></div>
    <div class="badges">${bilingual(c) ? '<span class="bdg lime">French-ready</span>' : ''}${c.pads && maxAud(c) >= 10000 ? '<span class="bdg lime">Ad-ready</span>' : ''}${needs(c).filter((x) => !['No owner', 'Stuck 7+ days', 'Waiting 14+ days'].includes(x)).map((x) => `<span class="bdg warn">${esc(x)}</span>`).join('')}</div>
    <div class="pstats" style="margin-top:14px">${[['TikTok', c.tt], ['Instagram', c.ig], ['YouTube', c.yt]].map(([k, v]) => `<div class="pstat${v == null ? ' na' : ''}"><div class="k">${k}</div><div class="v num">${fmt(v)}</div></div>`).join('')}</div>
    <div class="near${nd(c) <= 25 ? ' ok' : ''}" style="margin-top:12px;font-size:13px">${PIN}<span>${c.near[0] ? kmTxt(nd(c)) + ' to JD ' + esc(c.near[0].s.name) + ' · ' + storeLabel(nd(c)) : 'Location unknown'}</span></div>
    ${c.niche ? `<div class="quote" style="margin-top:12px"><div class="q">Niche or edge</div>${esc(c.niche)}</div>` : ''}
    <div class="chips" style="margin-bottom:12px">${[...c.lanes, ...c.can].map((x) => `<span class="chip">${esc(x)}</span>`).join('')}<span class="chip">${esc(c.style)}</span></div>
    <span class="lbl">Your score</span>
    <div class="score" style="padding:6px 12px">${CRIT.map(([k, l]) => `<div class="srow" style="grid-template-columns:110px minmax(0,1fr)"><div class="cr">${l}</div><div class="dots">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-act="rate" data-cid="${c.id}" data-k="${k}" data-v="${v}" aria-pressed="${mine[k] === v}">${v}</button>`).join('')}</div></div>`).join('')}</div>
    <span class="lbl" style="margin-top:12px">Add to a board</span><div class="bchips">${BOARDS.map((b) => `<button type="button" class="bchip" data-act="tboard" data-cid="${c.id}" data-b="${b.id}" aria-pressed="${!!MEMBERS.get(b.id + '|' + c.id)}">${esc(b.name)}</button>`).join('') || '<span class="muted" style="font-size:12px">No boards yet</span>'}</div>
    <div style="margin-top:12px"><button type="button" class="linkbtn" data-act="castprofile" style="padding:0">Open full profile</button></div>
  </div></div>
  <div class="cast-f"><button type="button" class="cbtn ghost" data-act="castundo" ${K.hist.length ? '' : 'disabled'}>Undo <kbd>Z</kbd></button><button type="button" class="cbtn no" data-act="castgo" data-d="no">No <kbd>←</kbd></button><button type="button" class="cbtn maybe" data-act="castgo" data-d="maybe">Maybe <kbd>↓</kbd></button><button type="button" class="cbtn yes" data-act="castgo" data-d="yes">Yes, shortlist <kbd>→</kbd></button><button type="button" class="cbtn ghost" data-act="castgo" data-d="skip">Skip <kbd>Space</kbd></button></div></div>`;
}
async function castDecide(d) {
  const K = S.cast; if (K.i >= K.queue.length) return; const id = K.queue[K.i]; const cr = CRM[id];
  K.hist.push({ id, d, prev: { status: cr.status, tags: cr.tags.slice() } }); K.tally[d]++; K.i++; K.mi = 0; renderOverlays();
  if (d === 'yes') await setCRM(id, { status: 'Shortlisted' });
  else if (d === 'no') await setCRM(id, { status: 'Declined' });
  else if (d === 'maybe') await setCRM(id, { status: cr.status === 'New' ? 'Reviewed' : cr.status, tags: cr.tags.includes('Maybe') ? cr.tags : [...cr.tags, 'Maybe'] });
  if (d !== 'skip') logAct(id, 'Casting: ' + (d === 'yes' ? 'Yes' : d === 'no' ? 'No' : 'Maybe'));
  scheduleRender();
}
async function castUndo() { const K = S.cast; const h = K.hist.pop(); if (!h) return; K.tally[h.d]--; K.i = K.queue.indexOf(h.id); K.mi = 0; if (h.d !== 'skip') { await setCRM(h.id, { status: h.prev.status, tags: h.prev.tags }); logAct(h.id, 'Casting decision undone'); } toast('Undone'); render(); }

/* ---------------------------------------------------------------- boards + sharing */
const shareUrl = (b) => location.origin + location.pathname.replace(/[^/]*$/, '') + 'share.html?t=' + encodeURIComponent(b.share.token);
function boardsHTML() {
  return `<div class="bhead"><div><div class="dsp" style="font-size:44px">Campaign boards</div><div class="muted">Group creators by campaign or brief. Share a read-only board with brand partners or leadership.</div></div></div>
  <div class="boards">${BOARDS.map((b) => { const cs = b.ids.map((id) => C.find((c) => c.id === id)).filter(Boolean); return `<article class="bcard"><div class="mosaic" data-act="bopen" data-b="${b.id}">${cs.length ? cs.slice(0, 6).map((c) => `<img src="${c.head}" alt="">`).join('') : '<div class="mempty">No creators yet</div>'}</div>
    <div class="bbody"><div class="dsp n">${esc(b.name)}</div><div class="d">${esc(b.desc)}</div><div class="muted" style="font-size:11.5px">${cs.length} creator${cs.length === 1 ? '' : 's'} · reach ${fmt(cs.reduce((a, c) => a + c.reach, 0))} · ${cs.filter((c) => nd(c) <= 25).length} near a store · made by ${esc(dispName(b.created_by))}</div>
    <div class="bacts"><button type="button" class="btn" data-act="bopen" data-b="${b.id}">Open</button><button type="button" class="btn${b.share.on ? ' pri' : ''}" data-act="bshare" data-b="${b.id}">${b.share.on ? 'Shared' : 'Share'}</button></div></div></article>`; }).join('')}
    <form class="newb" id="newboard"><div class="dsp" style="font-size:26px">New board</div><input id="nbname" placeholder="Board name, e.g. Back to School 2027" required maxlength="120" aria-label="Board name"><textarea id="nbdesc" rows="2" placeholder="What is it for? (optional)" aria-label="Board description"></textarea><div><button class="btn pri" type="submit">Create board</button></div></form>
  </div>`;
}
function boardDetailHTML() {
  const b = BOARDS.find((x) => x.id === S.board); if (!b) { S.board = null; return boardsHTML(); } const cs = b.ids.map((id) => C.find((c) => c.id === id)).filter(Boolean);
  return `<div class="bhead"><div><button type="button" class="linkbtn" data-act="bback" style="padding:0 0 6px">‹ All boards</button><div class="dsp n">${esc(b.name)}</div><div class="muted">${esc(b.desc)}</div></div><div class="bacts"><button type="button" class="btn${b.share.on ? ' pri' : ''}" data-act="bshare" data-b="${b.id}">${b.share.on ? 'Shared · manage link' : 'Share board'}</button><button type="button" class="btn" data-act="barchive" data-b="${b.id}">${S.armDelete === 'b' + b.id ? 'Click again to archive' : 'Archive board'}</button></div></div>
  ${cs.length ? `<div class="wall">${cs.map((c) => cardHTML(c, `<button type="button" class="rmb" data-act="bremove" data-b="${b.id}" data-id="${c.id}">Remove</button>`)).join('')}</div>` : `<div class="empty"><div class="dsp">Board is empty</div><p>Add creators from their profile or in Casting mode.</p></div>`}`;
}
function shareHTML() {
  const b = BOARDS.find((x) => x.id === S.share); if (!b) return ''; const cs = b.ids.map((id) => C.find((c) => c.id === id)).filter(Boolean); const url = shareUrl(b);
  const expDays = b.share.expires ? Math.max(0, Math.round((new Date(b.share.expires) - Date.now()) / DAY)) : null;
  return `<div class="full" role="dialog" aria-modal="true" aria-label="Share board"><div class="dh"><span class="dsp" style="font-size:28px">Share: ${esc(b.name)}</span><button type="button" class="ib" data-act="shareclose" aria-label="Close">×</button></div><div class="fullb"><div class="share">
  <div class="panel"><div class="tog"><span>Anyone with the link can view</span><button type="button" class="switch" role="switch" aria-checked="${b.share.on}" data-act="sharetog" aria-label="Turn sharing on or off"></button></div>
    ${b.share.on ? `<div class="linkbox"><input id="sharelink" readonly value="${esc(url)}" aria-label="Share link"><button type="button" class="btn pri" data-act="sharecopy">Copy</button></div>
    <div class="fld"><label for="shareexp">Link expires</label><select id="shareexp">${[7, 30, 90].map((d) => `<option value="${d}">${'In ' + d + ' days'}</option>`).join('')}<option value="0">Never</option></select><div class="muted" style="font-size:11.5px;margin-top:6px">${expDays == null ? 'Currently never expires.' : 'Currently expires in ' + expDays + ' days.'}</div></div>
    <button type="button" class="btn" data-act="sharenew">Reset link (old link stops working)</button>` : `<p class="muted" style="margin:0">Sharing is off. Turn it on to create a read-only link.</p>`}
    <div><span class="lbl">What viewers see</span><div class="chk"><div><span class="y">✓</span>Headshots, setup photos and posts</div><div><span class="y">✓</span>Name, city and closest JD store</div><div><span class="y">✓</span>Audience size and content lanes</div><div><span class="x">✕</span>Email, phone and age</div><div><span class="x">✕</span>Notes, scores and pipeline status</div></div></div>
    <p class="muted" style="font-size:11px;margin:0">Viewers do not need a login. The link only shows this board, and photo links inside it expire after an hour.</p></div>
  <div style="min-width:0"><span class="lbl">Preview of the shared page</span><div class="pub"><div class="pub-h hero"><div style="position:relative;z-index:1"><img class="lockup" src="lockup.png" alt="JD Creator Collective"><div class="bn">${esc(b.name)}</div><div class="bd">${esc(b.desc)}${b.desc ? ' · ' : ''}${cs.length} creators</div></div></div>
    <div class="pub-g">${cs.map((c) => `<div class="pub-c"><img src="${c.head}" alt=""><div class="b"><div class="n">${esc(c.name)}</div><div class="m">${esc(c.city)}${c.prov ? ', ' + c.prov : ''} · ${fmt(maxAud(c))} top reach</div><div class="m">${esc(c.lanes.join(', '))}</div>${c.near[0] ? `<div class="m">Near JD ${esc(c.near[0].s.name)}</div>` : ''}</div></div>`).join('') || '<div class="muted">Add creators to this board first.</div>'}</div>
    <div class="pub-f">Shared by JD Sports Canada. Confidential, please do not forward.</div></div></div>
  </div></div></div>`;
}

/* ---------------------------------------------------------------- insights */
function insightsHTML(L) {
  const N = L.length; if (!N) return emptyState();
  const wk = L.filter((c) => daysAgo(c) <= 7).length, pwk = L.filter((c) => daysAgo(c) > 7 && daysAgo(c) <= 14).length;
  const reviewed = L.filter((c) => CRM[c.id].status !== 'New').length; const adv = L.filter((c) => ['Shortlisted', 'Contacted', 'Onboarded'].includes(CRM[c.id].status)).length;
  const onb = L.filter((c) => CRM[c.id].status === 'Onboarded').length; const newC = L.filter((c) => CRM[c.id].status === 'New');
  const waits = newC.map(daysAgo).sort((a, b) => a - b); const med = waits.length ? waits[Math.floor(waits.length / 2)] : 0;
  const located = L.filter((c) => c.lat != null); const near25 = located.filter((c) => nd(c) <= 25).length;
  const gaps = STORES.filter((s) => !located.some((c) => km(c.lat, c.lng, s.lat, s.lng) <= 25));
  const frR = L.filter(bilingual).length;
  const mon = new Date(TODAY); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const weeks = []; for (let w = 7; w >= 0; w--) { const a = new Date(mon.getTime() - w * 7 * DAY), b = new Date(a.getTime() + 7 * DAY); weeks.push({ a, n: L.filter((c) => c.applied >= a && c.applied < b).length }); }
  const wmax = Math.max(1, ...weeks.map((w) => w.n)); const W = 560, H = 200, bw = W / weeks.length;
  const bars = weeks.map((w, i) => { const h = (w.n / wmax) * (H - 50); const x = i * bw + 10, y = H - 24 - h; return `<rect x="${x}" y="${y}" width="${bw - 20}" height="${Math.max(h, 1)}" rx="4" fill="${i === weeks.length - 1 ? 'var(--lime)' : 'var(--teal)'}"/><text class="v" x="${x + (bw - 20) / 2}" y="${y - 6}" text-anchor="middle">${w.n}</text><text x="${x + (bw - 20) / 2}" y="${H - 6}" text-anchor="middle">${fmtDate(w.a)}</text>`; }).join('');
  const fun = STATUSES.map((s) => [s, L.filter((c) => CRM[c.id].status === s).length]); const fmax = Math.max(1, ...fun.map((f) => f[1]));
  const plist = uniq([...L.map((c) => c.prov), ...STORES.map((s) => s.prov)]).map((p) => ({ p, c: L.filter((c) => c.prov === p).length, s: STORES.filter((s) => s.prov === p).length })).sort((a, b) => b.c - a.c || b.s - a.s);
  const lanes = uniq(L.flatMap((c) => c.lanes)).map((l) => [l, L.filter((c) => c.lanes.includes(l)).length]).sort((a, b) => b[1] - a[1]).slice(0, 6); const lmax = Math.max(1, ...lanes.map((x) => x[1]));
  const gapCities = uniq(gaps.map((g) => g.city)).slice(0, 4).join(', ');
  const gm = {}; gaps.forEach((g) => (gm[g.prov] = (gm[g.prov] || 0) + 1)); const topGapProv = Object.entries(gm).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([p, n]) => (PROV[p] || p) + ' (' + n + ')').join(' and ');
  return `<div class="ins">
  <div class="swhat"><div><div class="k">What</div><p><b>${N} applicants</b>, ${wk} in the last 7 days. ${Math.round((reviewed / N) * 100)}% have been reviewed and ${onb} onboarded. <b>${gaps.length} of ${STORES.length} stores</b> have no applicant within 25 km.</p></div>
    <div><div class="k">So what</div><p>${newC.length} New applicant${newC.length === 1 ? ' has' : 's have'} waited a median of <b>${med} days</b>. ${topGapProv ? 'Store coverage is thinnest in ' + esc(topGapProv) + ', which limits in-store content there. ' : ''}${frR} applicant${frR === 1 ? ' is' : 's are'} French-ready for Quebec campaigns.</p></div>
    <div><div class="k">What's next</div><p>Clear the New queue in Casting mode this week.${gapCities ? ' Point recruitment at gap areas such as ' + esc(gapCities) + '.' : ''} Use the French-ready view to cast Quebec work.</p></div></div>
  <div class="kpis">
    <div class="kpi"><div class="k">Applicants</div><div class="v num">${N}</div><div class="d">${wk} this week, ${pwk} the week before</div></div>
    <div class="kpi"><div class="k">Reviewed</div><div class="v num">${Math.round((reviewed / N) * 100)}%</div><div class="d">${reviewed} of ${N}</div></div>
    <div class="kpi"><div class="k">Moved forward</div><div class="v num">${reviewed ? Math.round((adv / reviewed) * 100) : 0}%</div><div class="d">Shortlisted or later, of reviewed</div></div>
    <div class="kpi"><div class="k">Onboarded</div><div class="v num">${onb}</div><div class="d">${L.filter((c) => { const r = rights(c); return r && r.state === 'Expiring within 60 days'; }).length} with rights expiring soon</div></div>
    <div class="kpi"><div class="k">Wait in New</div><div class="v num">${med}d</div><div class="d">Median, ${newC.length} waiting</div></div>
    <div class="kpi"><div class="k">Near a store</div><div class="v num">${located.length ? Math.round((near25 / located.length) * 100) : 0}%</div><div class="d">${near25} within 25 km of a JD store</div></div>
  </div>
  <div class="igrid">
    <div class="panel"><h3>Applications per week</h3><svg class="chartsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Applications per week">${bars}</svg><div class="muted" style="font-size:11px">Weeks start Monday. The latest week is still in progress.</div></div>
    <div class="panel"><h3>Pipeline</h3><div class="funnel">${fun.map(([s, n]) => `<div class="frow"><span>${s}</span><span class="tr"><i style="width:${(n / fmax) * 100}%;background:${STCOL[s]}"></i></span><span class="n num">${n}</span></div>`).join('')}</div></div>
    <div class="panel"><h3>Store coverage gaps</h3><div class="muted" style="font-size:11.5px">Stores with no applicant within 25 km. These are where in-store content is hardest to cast.</div><div class="gaps">${gaps.map((g) => `<div class="gap"><b>JD ${esc(g.name)}</b><span>${esc(g.city)}, ${g.prov}</span></div>`).join('') || '<div class="muted">Every store has an applicant nearby.</div>'}</div></div>
    <div class="panel"><h3>Applicants vs stores by province</h3><div class="tw" style="border:0"><table class="ptab"><thead><tr><th>Province</th><th style="text-align:right">Applicants</th><th style="text-align:right">Stores</th><th style="text-align:right">Per store</th></tr></thead><tbody>${plist.map((x) => `<tr><td>${esc(PROV[x.p] || x.p || 'Unknown')}</td><td class="r">${x.c}</td><td class="r">${x.s}</td><td class="r" style="color:${x.s && x.c / x.s < 0.5 ? 'var(--warn)' : 'var(--fg)'}">${x.s ? (x.c / x.s).toFixed(1) : '–'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><h3>Top content lanes</h3>${lanes.map(([l, n]) => `<div class="pbar"><span>${esc(l)}</span><em class="num">${n}</em><span class="track"><i style="width:${(n / lmax) * 100}%"></i></span></div>`).join('') || '<div class="muted">No lanes given yet.</div>'}</div>
    <div class="panel"><h3>Mix</h3>${[['French-ready (EN + FR)', frR], ['Partnership Ads OK', L.filter((c) => c.pads).length], ['Ad-ready', L.filter((c) => c.pads && maxAud(c) >= 10000).length], ['On TikTok', L.filter((c) => c.tt || c.urls.TikTok).length], ['On Instagram', L.filter((c) => c.ig || c.urls.Instagram).length], ['On YouTube', L.filter((c) => c.yt || c.urls.YouTube).length]].map(([l, n]) => `<div class="pbar"><span>${l}</span><em class="num">${n} · ${Math.round((n / N) * 100)}%</em><span class="track"><i style="width:${(n / N) * 100}%"></i></span></div>`).join('')}</div>
  </div>
  <div class="muted" style="font-size:11px">Insights follow the filters you have set.${fCount() || S.q ? ' Clear filters to see the whole applicant pool.' : ''}</div></div>`;
}

/* ---------------------------------------------------------------- map */
const JUMPS = [{ k: 'ca', l: 'All Canada' }, { k: 'bc', l: 'Lower Mainland', c: [-122.9, 49.15], z: 12 }, { k: 'pr', l: 'Prairies', c: [-106, 51.6], z: 3.2 }, { k: 'gta', l: 'Greater Toronto', c: [-79.55, 43.7], z: 13 }, { k: 'qc', l: 'Montréal to Québec', c: [-72.8, 46.1], z: 5.5 }, { k: 'atl', l: 'Atlantic', c: [-59, 46.8], z: 3.4 }];
let MAP = null, hideT = null, TOPO = null;
function mapHTML(L) {
  const loc = L.filter((c) => c.lat != null); const byP = {}; L.forEach((c) => (byP[c.prov] = (byP[c.prov] || 0) + 1));
  const cities = {}; loc.forEach((c) => { const k = c.city + '|' + c.prov; (cities[k] = cities[k] || []).push(c); });
  const pmax = Math.max(1, ...Object.values(byP)); const sel = S.f.province || []; const provs = uniq([...Object.keys(byP), ...STORES.map((s) => s.prov)]).map((k) => [k, byP[k] || 0]).sort((a, b) => b[1] - a[1]);
  const gaps = STORES.filter((s) => !loc.some((c) => km(c.lat, c.lng, s.lat, s.lng) <= 25)).length;
  return `<div class="mapwrap"><div class="mapbox" id="mapbox"><svg id="mapsvg" viewBox="0 0 1000 680" role="img" aria-label="Map of creators and JD stores across Canada"></svg>
    <div class="jumps">${JUMPS.map((j) => `<button type="button" class="jump" data-act="jump" data-k="${j.k}" aria-pressed="${S.jump === j.k}">${j.l}</button>`).join('')}</div>
    <div class="mapctl"><button type="button" class="ib" data-act="zin" aria-label="Zoom in">+</button><button type="button" class="ib" data-act="zout" aria-label="Zoom out">−</button></div>
    <div class="maplegend"><button type="button" data-act="lgc" aria-pressed="${S.showCreators}"><span class="lg-c"></span>Creators</button><span><span class="lg-r"></span>Applied this week</span><button type="button" data-act="lgs" aria-pressed="${S.showStores}"><span class="lg-s"></span>JD stores (${STORES.length})</button></div>
    <div class="pop" id="pop" hidden></div></div>
  <aside class="mapside">
    <div class="msum"><div class="stat"><div class="k">Creators</div><div class="v num">${loc.length}</div></div><div class="stat"><div class="k">Cities</div><div class="v num">${Object.keys(cities).length}</div></div><div class="stat"><div class="k">Store gaps</div><div class="v num" style="color:var(--warn)">${gaps}</div></div></div>
    ${L.length > loc.length ? `<div class="muted" style="font-size:11.5px">${L.length - loc.length} creator${L.length - loc.length > 1 ? 's' : ''} not shown: city not found.</div>` : ''}
    <div><h3>By province</h3>${provs.map(([k, n]) => `<button type="button" class="pbar" data-act="facet" data-g="province" data-v="${esc(k)}" aria-pressed="${sel.includes(k)}"><span>${esc(PROV[k] || k || 'Unknown')}</span><em class="num">${n} · ${STORES.filter((s) => s.prov === k).length} stores</em><span class="track"><i style="width:${(n / pmax) * 100}%"></i></span></button>`).join('')}</div>
    <div><h3>Top cities</h3>${Object.entries(cities).sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([k, v]) => `<button type="button" class="pbar" data-act="city" data-c="${esc(k)}"><span>${esc(k.replace('|', ', '))}</span><em class="num">${v.length}</em></button>`).join('') || '<div class="muted">No creators match these filters</div>'}</div>
    <div class="muted" style="font-size:11px">Store gaps: stores with no creator in view within 25 km. Hover a white diamond to see a store.</div>
  </aside></div>`;
}
async function drawMap(L) {
  const svgEl = $('mapsvg'); if (!svgEl) return;
  if (!window.d3 || !window.topojson) { $('mapbox').innerHTML = '<div class="mapfail">The map could not load. Check your connection and reload the page.</div>'; return; }
  if (!TOPO) { try { TOPO = await fetch('ca.topo.json').then((r) => r.json()); } catch (e) { $('mapbox').innerHTML = '<div class="mapfail">The map could not load.</div>'; return; } }
  if (!document.body.contains(svgEl)) return;
  const W = 1000, H = 680; const fc = topojson.feature(TOPO, TOPO.objects.p);
  const proj = d3.geoConicConformal().rotate([96, 0]).parallels([49, 77]).fitExtent([[20, 64], [W - 20, H - 20]], { type: 'MultiPoint', coordinates: [[-139, 60], [-52.6, 47.5], [-123.5, 48.3], [-80, 42.2], [-95, 71], [-62, 60]] });
  const path = d3.geoPath(proj); const svg = d3.select(svgEl);
  const loc = L.filter((c) => c.lat != null); const byP = {}; L.forEach((c) => (byP[c.prov] = (byP[c.prov] || 0) + 1)); const pmax = Math.max(1, ...Object.values(byP));
  const g = svg.append('g');
  g.append('g').selectAll('path').data(fc.features).join('path').attr('class', 'prov').attr('d', path).style('fill', (d) => (byP[d.properties.code] ? 'var(--lime)' : 'var(--s3)')).attr('fill-opacity', (d) => (byP[d.properties.code] ? 0.12 + (0.42 * byP[d.properties.code]) / pmax : 1))
    .append('title').text((d) => d.properties.name + (byP[d.properties.code] ? ' · ' + byP[d.properties.code] + ' creator' + (byP[d.properties.code] > 1 ? 's' : '') : ''));
  const stores = STORES.map((s) => { const [x, y] = proj([s.lng, s.lat]); return { s, x, y, near: loc.filter((c) => km(c.lat, c.lng, s.lat, s.lng) <= 25) }; });
  const groups = {}; loc.forEach((c) => { const k = c.city + '|' + c.prov; (groups[k] = groups[k] || []).push(c); });
  const pins = Object.entries(groups).map(([k, cs]) => { const [x, y] = proj([cs[0].lng, cs[0].lat]); return { k, cs, x, y, r: cs.length > 1 ? 11 + 3 * Math.sqrt(cs.length - 1) : 8, fresh: cs.some((c) => daysAgo(c) <= 7) }; }).sort((a, b) => b.cs.length - a.cs.length);
  const kmPx = (() => { const a = proj([-79.38, 43.65]), b = proj([-79.38, 43.65 + 25 / 111]); return Math.hypot(a[0] - b[0], a[1] - b[1]); })();
  const sg = g.append('g').style('display', S.showStores ? null : 'none').selectAll('g').data(stores).join('g').attr('class', 'spin').attr('tabindex', 0).attr('role', 'button').attr('aria-label', (d) => 'JD ' + d.s.name + ', ' + d.s.city);
  sg.append('circle').attr('class', 'halo').attr('r', kmPx);
  const sm = sg.append('g'); sm.append('rect').attr('x', -4.5).attr('y', -4.5).attr('width', 9).attr('height', 9).attr('transform', 'rotate(45)');
  const pg = g.append('g').style('display', S.showCreators ? null : 'none').selectAll('g').data(pins).join('g').attr('class', 'pin').attr('tabindex', 0).attr('role', 'button').attr('aria-label', (d) => d.k.replace('|', ', ') + ', ' + d.cs.length + ' creators');
  pg.filter((d) => d.fresh).append('circle').attr('class', 'ring').attr('r', (d) => d.r); pg.append('circle').attr('class', 'b').attr('r', (d) => d.r); pg.filter((d) => d.cs.length > 1).append('text').text((d) => d.cs.length);
  let k = 1; const place = () => { pg.attr('transform', (d) => `translate(${d.x},${d.y}) scale(${1 / k})`); sg.attr('transform', (d) => `translate(${d.x},${d.y})`); sm.attr('transform', `scale(${1 / k})`); sg.select('.halo').style('display', k >= 4 ? null : 'none'); };
  const zoom = d3.zoom().scaleExtent([1, 30]).translateExtent([[-150, -150], [W + 150, H + 150]]).on('zoom', (ev) => { k = ev.transform.k; g.attr('transform', ev.transform); place(); S.mapT = ev.transform; hidePop(true); });
  svg.call(zoom).on('dblclick.zoom', null); MAP = { svg, zoom, proj, pins, stores, W, H };
  if (S.mapT) svg.call(zoom.transform, S.mapT); else place();
  const touch = matchMedia('(hover: none)').matches;
  pg.on('mouseenter', (ev, d) => { if (!touch) showPop(d, false); }).on('mouseleave', () => schedHide()).on('click', (ev, d) => { ev.stopPropagation(); if (d.cs.length === 1 && !touch) { openProfile(d.cs[0].id); } else showPop(d, true); }).on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showPop(d, true); } });
  sg.on('mouseenter', (ev, d) => { if (!touch) showStorePop(d, false); }).on('mouseleave', () => schedHide()).on('click', (ev, d) => { ev.stopPropagation(); showStorePop(d, true); }).on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showStorePop(d, true); } });
  svg.on('click', () => hidePop(true));
  const pop = $('pop'); pop.addEventListener('mouseenter', () => clearTimeout(hideT)); pop.addEventListener('mouseleave', () => schedHide());
}
function creatorRows(cs, max) { return cs.slice(0, max).map((c) => { const cr = CRM[c.id]; const top = [['TikTok', c.tt], ['Instagram', c.ig], ['YouTube', c.yt]].sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
  return `<button type="button" class="pcr" data-act="open" data-id="${c.id}"><img src="${c.head}" alt=""><span style="min-width:0;display:block"><span class="n">${cr.fav ? '<span style="color:var(--lime)">★</span>' : ''}${esc(c.name)} ${langTags(c)}</span><span class="m"><span class="dot" style="background:${STCOL[cr.status]}"></span>${cr.status}${top[1] ? ' · ' + top[0] + ' ' + fmt(top[1]) : ''}</span><span class="m">${PIN.replace('<svg', '<svg style="width:11px;height:11px"')}${kmTxt(nd(c))} to JD ${esc(c.near[0] ? c.near[0].s.name : '')}</span></span></button>`; }).join(''); }
function placePop(x, y, key) { const pop = $('pop'); pop.hidden = false; const box = $('mapbox').getBoundingClientRect(), sr = $('mapsvg').getBoundingClientRect(); const t = S.mapT || d3.zoomIdentity; const sc = sr.width / MAP.W;
  const px = t.applyX(x) * sc + (sr.left - box.left), py = t.applyY(y) * sc + (sr.top - box.top); const pw = pop.offsetWidth, ph = pop.offsetHeight; let left = px + 18, top = py - ph / 2;
  if (left + pw > box.width - 10) left = px - pw - 18; left = Math.max(10, left); top = Math.max(10, Math.min(top, box.height - ph - 10)); pop.style.left = left + 'px'; pop.style.top = top + 'px';
  d3.selectAll('.pin').classed('on', (p) => p.k === key); d3.selectAll('.spin').classed('on', (p) => p.s.name === key); }
function showPop(d, pinned) { clearTimeout(hideT); const pop = $('pop'); if (!pop || !MAP) return; if (pinned) S.popPinned = d.k; const c0 = d.cs[0];
  pop.innerHTML = `<div class="ph"><span class="t">${esc(c0.city)}</span><span class="c">${esc(c0.provName)} · ${d.cs.length} creator${d.cs.length > 1 ? 's' : ''}</span></div>${creatorRows(d.cs, 4)}<div class="pf2">${d.cs.length > 4 ? '+' + (d.cs.length - 4) + ' more. Filter by this city to see everyone.' : 'Click a creator to open their profile'}</div>`; placePop(d.x, d.y, d.k); }
function showStorePop(d, pinned) { clearTimeout(hideT); const pop = $('pop'); if (!pop || !MAP) return; if (pinned) S.popPinned = d.s.name; const near = d.near.slice().sort((a, b) => km(a.lat, a.lng, d.s.lat, d.s.lng) - km(b.lat, b.lng, d.s.lat, d.s.lng));
  pop.innerHTML = `<div class="ph"><span class="t">JD ${esc(d.s.name)}</span><span class="c">${esc(fullAddr(d.s))}</span><span class="c">${esc(d.s.phone)}</span></div>${near.length ? `<div class="pf2" style="padding-top:0">${near.length} creator${near.length > 1 ? 's' : ''} within 25 km</div>${creatorRows(near, 3)}` : '<div class="pf2" style="color:var(--warn)">No creators within 25 km. Recruitment gap.</div>'}`; placePop(d.x, d.y, d.s.name); }
function schedHide() { if (S.popPinned) return; clearTimeout(hideT); hideT = setTimeout(() => hidePop(false), 240); }
function hidePop(force) { if (!force && S.popPinned) return; S.popPinned = null; const p = $('pop'); if (p) p.hidden = true; if (window.d3) { d3.selectAll('.pin').classed('on', false); d3.selectAll('.spin').classed('on', false); } }
function zoomTo(c, z) { if (!MAP) return null; const t = c ? (() => { const [x, y] = MAP.proj(c); return d3.zoomIdentity.translate(MAP.W / 2, MAP.H / 2).scale(z).translate(-x, -y); })() : d3.zoomIdentity; return MAP.svg.transition().duration(650).call(MAP.zoom.transform, t); }

/* ---------------------------------------------------------------- overlays (keeps typing intact during live updates) */
let lastOpen = null;
function renderOverlays() {
  const keep = {}; const sameProfile = lastOpen === S.open; lastOpen = S.open; document.querySelectorAll('#overlays textarea[id], #overlays input[id]').forEach((el) => { if (el.type !== 'date') keep[el.id] = { v: el.value, focus: document.activeElement === el, s: el.selectionStart, e: el.selectionEnd }; });
  let h = '';
  if (S.open) { const c = C.find((x) => x.id === S.open); if (c) h += drawerHTML(c); else S.open = null; }
  if (S.cmpOpen) h += cmpHTML(); if (S.share) h += shareHTML(); if (S.cast) h += castHTML(); if (S.lb) h += lbHTML();
  const db = document.querySelector('.drawer .db'); const top = db ? db.scrollTop : 0;
  $('overlays').innerHTML = h;
  const db2 = document.querySelector('.drawer .db'); if (db2 && top) db2.scrollTop = top;
  if (sameProfile) Object.entries(keep).forEach(([id, k]) => { const el = $(id); if (!el || el.readOnly) return; if (id !== 'otbody' || k.v) el.value = k.v; if (k.focus) { el.focus(); try { el.setSelectionRange(k.s, k.e); } catch (e) {} } });
  document.body.style.overflow = S.open || S.lb || S.cmpOpen || S.cast || S.share ? 'hidden' : '';
}
function openProfile(id) { S.open = id; S.otLang = null; S.otTpl = null; S.cmpOpen = false; S.lb = null; S.cast = null; S.share = null; S.armDelete = null; renderOverlays(); }

/* ---------------------------------------------------------------- writes */
let tt, undoFn = null;
function toast(m, undo) { const t = $('toast'); t.innerHTML = esc(m) + (undo ? ' <button type="button" data-act="toastundo">Undo</button>' : ''); undoFn = undo || null; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; undoFn = null; }, undo ? 4500 : 2200); }
const DBF = { fav: 'favourite', status: 'status', owner: 'owner', type: 'creator_type', rem: 'remuneration', tier: 'tier', tags: 'tags', contacted: 'contacted_at', rightsStart: 'rights_start' };
async function setCRM(id, patch) {
  const cr = CRM[id]; const before = {}; const row = {};
  for (const [k, v] of Object.entries(patch)) { before[k] = cr[k]; cr[k] = v; row[DBF[k]] = v; }
  if ('status' in patch && patch.status !== before.status) cr.stageSince = new Date().toISOString();
  S.cast ? renderOverlays() : render();
  const { error } = await sb.from('crm_state').update(row).eq('submission_id', id);
  if (error) { Object.assign(cr, before); toast("Couldn't save that change. Check your connection and try again."); console.error(error); render(); return false; }
  return true;
}
async function logAct(id, text) { const { error } = await sb.from('activity').insert({ submission_id: id, actor: ME, action: text }); if (error) console.error(error); }
async function setStatus(id, s) {
  const prev = CRM[id].status; if (prev === s) return; const ok = await setCRM(id, { status: s }); render();
  if (ok) toast((C.find((c) => c.id === id) || {}).name + ' moved to ' + s, async () => { await setCRM(id, { status: prev }); render(); });
}
async function toggleFav(id) { const on = !CRM[id].fav; if (await setCRM(id, { fav: on })) toast(on ? 'Added to favourites' : 'Removed from favourites'); }
async function addTag(t) { t = t.trim(); if (!t || !S.open) return; const cr = CRM[S.open]; if (cr.tags.some((x) => x.toLowerCase() === t.toLowerCase())) return; await setCRM(S.open, { tags: [...cr.tags, t] }); const el = $('tagin'); if (el) el.value = ''; render(); }
async function rate(cid, k, v) {
  const cr = CRM[cid]; const o = { ...(cr.scores[ME] || {}) }; o[k] = o[k] === v ? null : v; cr.scores[ME] = o; S.cast ? renderOverlays() : render();
  const { error } = await sb.from('scores').upsert({ submission_id: cid, reviewer: ME, cam: o.cam || null, prod: o.prod || null, fit: o.fit || null }, { onConflict: 'submission_id,reviewer' });
  if (error) { toast("Couldn't save your score."); console.error(error); }
}
async function toggleBoard(cid, bid) {
  const key = bid + '|' + cid; const was = MEMBERS.has(key); const on = !MEMBERS.get(key); MEMBERS.set(key, on); const b = BOARDS.find((x) => x.id === bid);
  S.cast ? renderOverlays() : render();
  const r = was ? await sb.from('board_members').update({ active: on }).eq('board_id', bid).eq('submission_id', cid) : await sb.from('board_members').insert({ board_id: bid, submission_id: cid, added_by: ME });
  if (r.error) { MEMBERS.set(key, !on); toast("Couldn't update the board."); console.error(r.error); render(); return; }
  toast((on ? 'Added to ' : 'Removed from ') + b.name);
}
async function copyText(txt, el) { try { await navigator.clipboard.writeText(txt); toast('Copied'); } catch (e) { if (el) { el.focus(); el.select(); } toast('Press Ctrl+C or Cmd+C to copy'); } }
async function updateBoard(bid, row) { const { data, error } = await sb.from('boards').update(row).eq('id', bid).select().single(); if (error) { toast("Couldn't update the board."); console.error(error); return null; } const i = BOARDS.findIndex((b) => b.id === bid); if (data.archived) BOARDS.splice(i, 1); else BOARDS[i] = boardFrom(data); return data; }

/* ---------------------------------------------------------------- events */
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]'); if (!a || !ME) return; const act = a.dataset.act, id = a.dataset.id;
  if (act !== 'erase' && act !== 'barchive') S.armDelete = null;
  switch (act) {
    case 'fav': e.stopPropagation(); toggleFav(id); break;
    case 'cmp': { e.stopPropagation(); const i = S.cmp.indexOf(id); if (i >= 0) S.cmp.splice(i, 1); else { if (S.cmp.length >= 4) { a.checked = false; toast('Compare up to 4 creators'); return; } S.cmp.push(id); } renderMain(); renderTray(); break; }
    case 'open': if (e.target.closest('.cmpbox,.star,.strip,.rmb')) return; openProfile(id); break;
    case 'close': S.open = null; renderOverlays(); break;
    case 'prev': case 'next': step(act === 'next' ? 1 : -1); break;
    case 'view': S.view = a.dataset.v; if (S.view !== 'boards') S.board = null; saveUI(); hidePop(true); renderMain(); break;
    case 'sortby': S.sort = a.dataset.k; saveUI(); renderMain(); break;
    case 'preset': { const p = PRESETS.find((x) => x.k === a.dataset.p); S.f = JSON.parse(JSON.stringify(p.f)); S.fn = p.fn || null; S.fnLabel = p.l; if (S.view === 'boards') S.view = 'wall'; render(); break; }
    case 'facet': { const g = a.dataset.g, v = a.dataset.v; const arr = (S.f[g] = S.f[g] || []); const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); if (!arr.length) delete S.f[g]; render(); break; }
    case 'rmf': { const arr = S.f[a.dataset.g] || []; const i = arr.indexOf(a.dataset.v); if (i >= 0) arr.splice(i, 1); if (!arr.length) delete S.f[a.dataset.g]; render(); break; }
    case 'rmfn': S.fn = null; render(); break;
    case 'clearf': S.f = {}; S.fn = null; S.q = ''; $('q').value = ''; render(); break;
    case 'closerail': $('rail').classList.remove('open'); break;
    case 'stage': setStatus(S.open, a.dataset.s); break;
    case 'addtag': addTag(a.dataset.t); break;
    case 'rmtag': { const cr = CRM[S.open]; await setCRM(S.open, { tags: cr.tags.filter((t) => t !== a.dataset.t) }); render(); break; }
    case 'addnote': { const v = $('notein').value.trim(); if (!v) { toast('Write a note first'); return; } const sid = S.open; $('notein').value = '';
      const { data, error } = await sb.from('notes').insert({ submission_id: sid, body: v, author: ME }).select().single();
      if (error) { toast("Couldn't save the note."); console.error(error); if ($('notein')) $('notein').value = v; return; }
      if (!CRM[sid].notes.some((n) => n.id === data.id)) CRM[sid].notes.push({ id: data.id, by: data.author, at: data.created_at, text: data.body }); toast('Note added'); render(); break; }
    case 'rate': rate(a.dataset.cid || S.open, a.dataset.k, +a.dataset.v); break;
    case 'tboard': toggleBoard(a.dataset.cid || S.open, a.dataset.b); break;
    case 'otlang': S.otLang = a.dataset.l; { const el = $('otbody'); if (el) el.value = ''; } renderOverlays(); break;
    case 'otcopy': { const body = $('otbody'); copyText('Subject: ' + $('otsubj').textContent + '\n\n' + body.value, body); break; }
    case 'otsent': { const c = C.find((x) => x.id === S.open); const cr = CRM[c.id]; const key = $('ottpl').value; const lang = S.otLang || defLang(c);
      await setCRM(c.id, { contacted: new Date().toISOString() }); await logAct(c.id, 'Outreach sent: ' + TPL[key].l + ' (' + lang.toUpperCase() + ')');
      if (key === 'invite' && ['New', 'Reviewed', 'Shortlisted'].includes(cr.status)) await setStatus(c.id, 'Contacted'); else if (key === 'decline' && cr.status !== 'Declined') await setStatus(c.id, 'Declined'); else toast('Logged as sent'); render(); break; }
    case 'reveal': S.reveal[S.open] = true; logAct(S.open, 'Viewed contact details'); renderOverlays(); break;
    case 'erase': { if (S.armDelete !== S.open) { S.armDelete = S.open; renderOverlays(); return; }
      const sid = S.open; const { error } = await sb.from('deleted_submissions').insert({ submission_id: sid, deleted_by: ME });
      if (error) { toast("Couldn't erase. Try again."); console.error(error); return; }
      C = C.filter((c) => c.id !== sid); S.open = null; S.armDelete = null; toast('Erased from the CRM. Data and photos are permanently removed at the next sync.'); render(); break; }
    case 'lb': e.stopPropagation(); S.lb = { id, i: +a.dataset.i }; renderOverlays(); break;
    case 'lbclose': S.lb = null; renderOverlays(); break;
    case 'lbprev': case 'lbnext': { const n = media(C.find((c) => c.id === S.lb.id)).length; S.lb.i = (S.lb.i + (act === 'lbnext' ? 1 : -1) + n) % n; renderOverlays(); break; }
    case 'lbgo': S.lb.i = +a.dataset.i; renderOverlays(); break;
    case 'lbprofile': { const sid = S.lb.id; openProfile(sid); break; }
    case 'cmpopen': if (S.cmp.length >= 2) { S.cmpOpen = true; renderOverlays(); } break;
    case 'cmpclose': S.cmpOpen = false; renderOverlays(); break;
    case 'cmpclear': S.cmp = []; renderMain(); renderTray(); break;
    case 'caston': startCast('new'); break;
    case 'castoff': S.cast = null; renderOverlays(); break;
    case 'castgo': castDecide(a.dataset.d); break;
    case 'castundo': castUndo(); break;
    case 'castmi': S.cast.mi = +a.dataset.i; renderOverlays(); break;
    case 'castprofile': { const sid = S.cast.queue[S.cast.i]; openProfile(sid); break; }
    case 'castshort': S.cast = null; S.f = { status: ['Shortlisted'] }; S.fn = null; S.view = 'wall'; render(); break;
    case 'bopen': S.board = a.dataset.b; S.view = 'boards'; renderMain(); window.scrollTo({ top: 0 }); break;
    case 'bback': S.board = null; renderMain(); break;
    case 'bremove': e.stopPropagation(); toggleBoard(id, a.dataset.b); break;
    case 'barchive': { const k = 'b' + a.dataset.b; if (S.armDelete !== k) { S.armDelete = k; renderMain(); return; } S.armDelete = null; if (await updateBoard(a.dataset.b, { archived: true, share_on: false })) { S.board = null; toast('Board archived'); render(); } break; }
    case 'bshare': S.share = a.dataset.b; renderOverlays(); break;
    case 'shareclose': S.share = null; renderOverlays(); renderMain(); break;
    case 'sharetog': { const b = BOARDS.find((x) => x.id === S.share); if (await updateBoard(b.id, { share_on: !b.share.on })) { toast(!b.share.on ? 'Link created' : 'Sharing turned off'); renderOverlays(); } break; }
    case 'sharecopy': copyText($('sharelink').value, $('sharelink')); break;
    case 'sharenew': { const tok = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, ''); if (await updateBoard(S.share, { share_token: tok })) { toast('New link created. The old link no longer works'); renderOverlays(); } break; }
    case 'jump': { S.jump = a.dataset.k; const j = JUMPS.find((x) => x.k === S.jump); zoomTo(j.c, j.z); document.querySelectorAll('.jump').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === S.jump)); break; }
    case 'zin': if (MAP) MAP.svg.transition().duration(300).call(MAP.zoom.scaleBy, 1.7); break;
    case 'zout': if (MAP) MAP.svg.transition().duration(300).call(MAP.zoom.scaleBy, 1 / 1.7); break;
    case 'lgs': S.showStores = !S.showStores; renderMain(); break;
    case 'lgc': S.showCreators = !S.showCreators; renderMain(); break;
    case 'city': { const d = MAP && MAP.pins.find((p) => p.k === a.dataset.c); if (d) { const tr = zoomTo([d.cs[0].lng, d.cs[0].lat], 10); if (tr) tr.on('end', () => showPop(d, true)); } break; }
    case 'toastundo': if (undoFn) { const f = undoFn; undoFn = null; $('toast').hidden = true; f(); } break;
    case 'signout': await sb.auth.signOut(); location.reload(); break;
  }
});
function step(d) { const L = results(); if (!L.length) return; let i = L.findIndex((c) => c.id === S.open); i = i < 0 ? 0 : (i + d + L.length) % L.length; openProfile(L[i].id); const db = document.querySelector('.drawer .db'); if (db) db.scrollTop = 0; }
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'newboard') return; e.preventDefault(); const n = $('nbname').value.trim(); if (!n) return;
  const { data, error } = await sb.from('boards').insert({ name: n, description: $('nbdesc').value.trim() || null, created_by: ME }).select().single();
  if (error) { toast("Couldn't create the board."); console.error(error); return; }
  if (!BOARDS.some((b) => b.id === data.id)) BOARDS.push(boardFrom(data)); toast('Board created'); render();
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.field && S.open) { const map = { owner: 'owner', type: 'type', rem: 'rem', tier: 'tier' }; if (await setCRM(S.open, { [map[t.dataset.field]]: t.value })) toast('Saved'); render(); return; }
  if (t.id === 'f-rights' && S.open) { if (await setCRM(S.open, { rightsStart: t.value || null })) toast('Saved'); render(); return; }
  if (t.id === 'ottpl') { S.otTpl = t.value; const el = $('otbody'); if (el) el.value = ''; renderOverlays(); return; }
  if (t.id === 'castmode') { startCast(t.value); return; }
  if (t.id === 'shareexp') { const d = +t.value; if (await updateBoard(S.share, { share_expires_at: d ? new Date(Date.now() + d * DAY).toISOString() : null })) { toast('Expiry updated'); renderOverlays(); } }
});
document.addEventListener('toggle', (e) => { const d = e.target; if (d.classList && d.classList.contains('fg')) S.openGroups[d.dataset.g] = d.open; }, true);
document.addEventListener('keydown', (e) => {
  if (!ME) return; const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
  if (e.target.id === 'tagin' && e.key === 'Enter') { e.preventDefault(); addTag(e.target.value); return; }
  if (typing) return;
  if (S.lb) { if (e.key === 'Escape') { S.lb = null; renderOverlays(); } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = media(C.find((c) => c.id === S.lb.id)).length; S.lb.i = (S.lb.i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n; renderOverlays(); } return; }
  if (S.cast) { if (e.key === 'Escape') { S.cast = null; renderOverlays(); } else if (e.key === 'ArrowRight') { e.preventDefault(); castDecide('yes'); } else if (e.key === 'ArrowLeft') { e.preventDefault(); castDecide('no'); } else if (e.key === 'ArrowDown') { e.preventDefault(); castDecide('maybe'); } else if (e.key === ' ') { e.preventDefault(); castDecide('skip'); } else if (e.key === 'z' || e.key === 'Z') castUndo(); else if (/^[1-5]$/.test(e.key)) { S.cast.mi = +e.key - 1; renderOverlays(); } return; }
  if (S.share || S.cmpOpen) { if (e.key === 'Escape') { S.share = null; S.cmpOpen = false; renderOverlays(); } return; }
  if (S.open) { if (e.key === 'Escape') { S.open = null; renderOverlays(); } else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'f') toggleFav(S.open); }
  else if (e.key === 'Escape') hidePop(true);
  else if (e.key === '/') { e.preventDefault(); $('q').focus(); }
});
$('q').addEventListener('input', (e) => { S.q = e.target.value; renderViews(); renderActive(); renderRail(); renderMain(); });
$('sort').addEventListener('change', (e) => { S.sort = e.target.value; saveUI(); renderMain(); });
$('filterBtn').addEventListener('click', () => $('rail').classList.add('open'));
document.addEventListener('mousemove', (e) => { const cm = e.target.closest('[data-scrub]'); if (!cm) return; const c = C.find((x) => x.id === cm.dataset.scrub); if (!c) return; const imgs = [c.head, ...c.setups.map((s) => s.src)]; const r = cm.getBoundingClientRect(); const i = Math.min(imgs.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * imgs.length))); const im = cm.querySelector('img'); if (im.dataset.i != String(i)) { im.src = imgs[i]; im.dataset.i = i; cm.querySelectorAll('.scrub span').forEach((s, j) => s.classList.toggle('on', j === i)); } });
document.addEventListener('mouseout', (e) => { const cm = e.target.closest && e.target.closest('[data-scrub]'); if (!cm || cm.contains(e.relatedTarget)) return; const c = C.find((x) => x.id === cm.dataset.scrub); if (!c) return; const im = cm.querySelector('img'); im.src = c.head; im.dataset.i = 0; cm.querySelectorAll('.scrub span').forEach((s, j) => s.classList.toggle('on', j === 0)); });
document.addEventListener('dragstart', (e) => { const d = e.target.closest && e.target.closest('[data-drag]'); if (!d) return; S.drag = d.dataset.drag; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', S.drag); } catch (_) {} });
document.addEventListener('dragover', (e) => { const col = e.target.closest && e.target.closest('[data-drop]'); if (!col || !S.drag) return; e.preventDefault(); document.querySelectorAll('.col.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); });
document.addEventListener('dragleave', (e) => { const col = e.target.closest && e.target.closest('[data-drop]'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
document.addEventListener('drop', (e) => { const col = e.target.closest && e.target.closest('[data-drop]'); if (!col || !S.drag) return; e.preventDefault(); setStatus(S.drag, col.dataset.drop); S.drag = null; });
document.addEventListener('dragend', () => { S.drag = null; document.querySelectorAll('.col.over').forEach((x) => x.classList.remove('over')); });

/* ---------------------------------------------------------------- live updates */
function subscribe() {
  const on = (table, fn) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => { try { fn(p); } catch (e) { console.error(e); } scheduleRender(); });
  const ch = sb.channel('crm-live');
  on('crm_state', (p) => { if (p.new && p.new.submission_id) fromState(p.new); });
  on('notes', (p) => { const n = p.new; if (!n || !n.submission_id) return; const cr = CRM[n.submission_id] || (CRM[n.submission_id] = blankCRM()); const i = cr.notes.findIndex((x) => x.id === n.id); const o = { id: n.id, by: n.author, at: n.created_at, text: n.body }; if (i >= 0) cr.notes[i] = o; else cr.notes.push(o); });
  on('scores', (p) => { const s = p.new; if (!s || !s.submission_id) return; (CRM[s.submission_id] || (CRM[s.submission_id] = blankCRM())).scores[s.reviewer] = { cam: s.cam, prod: s.prod, fit: s.fit }; });
  on('activity', (p) => { const a = p.new; if (!a || !a.submission_id) return; const cr = CRM[a.submission_id] || (CRM[a.submission_id] = blankCRM()); if (!cr.log.some((x) => x.id === a.id)) cr.log.unshift({ id: a.id, at: a.at, by: a.actor, text: a.action }); });
  on('boards', (p) => { const b = p.new; if (!b || !b.id) return; const i = BOARDS.findIndex((x) => x.id === b.id); if (b.archived) { if (i >= 0) BOARDS.splice(i, 1); } else if (i >= 0) BOARDS[i] = boardFrom(b); else BOARDS.push(boardFrom(b)); });
  on('board_members', (p) => { const m = p.new; if (!m || !m.board_id) return; MEMBERS.set(m.board_id + '|' + m.submission_id, m.active); });
  ch.subscribe();
}
async function checkSync() {
  try {
    const { data } = await sb.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(1);
    const r = data && data[0]; if (!r) return;
    const changed = !LAST_SYNC || r.id !== LAST_SYNC.id || r.finished_at !== LAST_SYNC.finished_at; LAST_SYNC = r;
    if (changed && r.finished_at && (r.inserted || r.updated)) { const before = C.length; await loadApplications(); const added = C.length - before; render(); if (added > 0) toast(added + ' new application' + (added > 1 ? 's' : '') + ' synced'); }
    renderSync();
  } catch (e) { console.error(e); }
}

/* ---------------------------------------------------------------- sign in */
function showLogin(msg, isErr) { $('appView').hidden = true; $('loginView').hidden = false; $('me').hidden = true; const m = $('loginMsg'); m.className = isErr ? 'err' : 'ok'; m.textContent = msg || ''; }
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const email = $('loginEmail').value.trim().toLowerCase();
  if (!allowedEmail(email)) { showLogin('Use your JD email address (' + CFG.allowedDomains.map((d) => '@' + d).join(' or ') + ').', true); return; }
  const btn = e.target.querySelector('button'); btn.disabled = true;
  const pass = $('loginPass').value;
  if (pass) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    btn.disabled = false; $('loginPass').value = '';
    if (error) { showLogin(/invalid/i.test(error.message) ? 'That email and password do not match.' : "Couldn't sign in: " + error.message, true); return; }
    if (data.session) start(data.session);
    return;
  }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
  btn.disabled = false;
  if (error) showLogin(/rate|limit/i.test(error.message) ? 'Too many sign-in emails were sent. Wait a few minutes and try again.' : "Couldn't send the email: " + error.message, true);
  else showLogin('Check your inbox for a sign-in link from the JD Creator Collective CRM. It can take a minute to arrive.');
});
let started = false;
async function start(session) {
  if (started) return; const email = (session.user.email || '').toLowerCase();
  if (!allowedEmail(email)) { await sb.auth.signOut(); showLogin('Only JD staff can use this CRM. Sign in with your JD email.', true); return; }
  started = true; ME = email;
  $('loginView').hidden = true; $('appView').hidden = false; const me = $('me'); me.hidden = false; me.innerHTML = `${esc(email)} · <button type="button" class="linkbtn" data-act="signout" style="padding:0;color:#000;text-decoration:underline">Sign out</button>`;
  try { await loadAll(); } catch (e) { console.error(e); $('main').innerHTML = `<div class="empty"><div class="dsp">Couldn't load the CRM</div><p>${esc(e.message || e)}</p><button type="button" class="btn pri" onclick="location.reload()">Try again</button></div>`; return; }
  render(); subscribe();
  setInterval(checkSync, 5 * 60 * 1000);
  setInterval(async () => { SIGNED = {}; await loadApplications(); render(); }, 5 * 3600 * 1000); // refresh photo links before they expire
  setInterval(() => { TODAY = new Date(); renderSync(); }, 60 * 1000);
}
sb.auth.onAuthStateChange((ev, session) => { if (session && !started) start(session); });
sb.auth.getSession().then(({ data }) => { if (data.session) start(data.session); else if (!/access_token|code=/.test(location.href)) showLogin(); });
})();
