// Maps Jotform questions (by their English label) to CRM columns.
// If a question is renamed in Jotform, update the matching pattern here.
// Patterns are tested against the lower-cased question label.

export const FIELDS = [
  { col: 'full_name',           kind: 'name',     match: /^full name/ },
  { col: 'email',               kind: 'text',     match: /^email address/ },
  { col: 'phone',               kind: 'phone',    match: /^mobile phone/ },
  { col: 'province',            kind: 'text',     match: /^province or territory/ },
  { col: 'city',                kind: 'text',     match: /^city$/ },
  { col: 'dob',                 kind: 'date',     match: /^date of birth/ },
  { col: 'identity',            kind: 'text',     match: /^how do you identify/ },
  { col: 'equipment',           kind: 'list',     match: /^what equipment do you/ },
  { col: 'languages',           kind: 'list',     match: /^languages you create in/ },
  { col: 'language_other',      kind: 'text',     match: /^please specify language/ },
  { col: 'speaking_style',      kind: 'text',     match: /speaking style on camera/ },
  { col: 'editing_software',    kind: 'list',     match: /^which editing software/ },
  { col: 'tiktok_url',          kind: 'url',      match: /^tiktok profile url/ },
  { col: 'instagram_url',       kind: 'url',      match: /^instagram profile url/ },
  { col: 'youtube_url',         kind: 'url',      match: /^youtube channel url/ },
  { col: 'tiktok_followers',    kind: 'count',    match: /^tiktok followers/ },
  { col: 'instagram_followers', kind: 'count',    match: /^instagram followers/ },
  { col: 'youtube_subscribers', kind: 'count',    match: /^youtube subscribers/ },
  { col: 'post_1',              kind: 'url',      match: /^post 1 url/ },
  { col: 'post_2',              kind: 'url',      match: /^post 2 url/ },
  { col: 'post_3',              kind: 'url',      match: /^post 3 url/ },
  { col: 'headshot_files',      kind: 'files',    match: /^upload a recent headshot/ },
  { col: 'setup_files',         kind: 'files',    match: /^upload images of your filming setup/ },
  { col: 'portfolio_url',       kind: 'url',      match: /^link to your portfolio/ },
  { col: 'brands',              kind: 'list',     match: /^which brands do you wear/ },
  { col: 'worked_with_jd',      kind: 'text',     match: /^have you worked with jd/ },
  { col: 'consent',             kind: 'bool',     match: /^do you consent to jd sports canada storing/ },
  { col: 'age_confirmed',       kind: 'bool',     match: /^i confirm i am 18/ },
  { col: 'anything_else',       kind: 'text',     match: /^anything else we should know/ },
  { col: 'is_employee',         kind: 'text',     match: /^are you a current jd sports canada employee/ },
  { col: 'is_customer',         kind: 'text',     match: /^are you a jd sports canada customer/ },
  { col: 'partnership_ads',     kind: 'text',     match: /^partnership ads permission/ },
  { col: 'can_do',              kind: 'list',     match: /^what can you do/ },
  { col: 'content_lanes',       kind: 'list',     match: /^strongest content lanes/ },
  { col: 'niche',               kind: 'text',     match: /^your niche or edge/ },
  { col: 'sets_apart',          kind: 'text',     match: /^what sets you apart/ },
  { col: 'tell_more',           kind: 'text',     match: /^tell us more/ },
  { col: 'terms_agreed',        kind: 'bool',     match: /^application terms agreement/ },
];

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export function asText(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ') || null;
  if (typeof v === 'object') return Object.values(v).map(asText).filter(Boolean).join(' ') || null;
  const s = String(v).trim();
  return s || null;
}

export function asList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(asList);
  if (typeof v === 'object') {
    // checkbox answers with an "Other" box arrive as { 0: 'A', 1: 'B', other: 'text' }
    return Object.entries(v).flatMap(([k, x]) => (k === 'other' && x ? [`Other: ${x}`] : asList(x)));
  }
  return String(v).split(/\r?\n|<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
}

export function asCount(v) {
  const s = asText(v);
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([km])?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
  return Math.round(n);
}

export function asBool(v) {
  const s = (asText(v) || '').toLowerCase();
  if (!s) return null;
  return /^(yes|oui|i agree|i confirm|j'accepte|je confirme|i have read|true|1|accept)/.test(s) || (s.length > 0 && !/^(no|non|false|0)/.test(s));
}

export function asDate(v) {
  if (!v) return null;
  if (typeof v === 'object' && v.year) {
    const m = String(v.month).match(/\d+/) ? String(v.month).padStart(2, '0') : String(new Date(`${v.month} 1, 2000`).getMonth() + 1).padStart(2, '0');
    return `${v.year}-${m}-${String(v.day).padStart(2, '0')}`;
  }
  const d = new Date(asText(v));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

export function asName(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return [v.first, v.middle, v.last].filter(Boolean).join(' ').trim() || null;
  return asText(v);
}

export function asPhone(v) {
  if (v && typeof v === 'object' && v.full) return v.full;
  return asText(v);
}

export function asUrl(v) {
  let s = asText(v);
  if (!s) return null;
  s = s.trim();
  if (/^@[\w.]+$/.test(s)) return s; // bare handle, kept as typed
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try { return new URL(s).toString(); } catch { return null; }
}

export function asFiles(v) {
  return asList(v).filter((s) => /^https?:\/\//i.test(s));
}

// Turn one Jotform submission into an applications row (plus file lists for the media step)
export function mapSubmission(sub, formId, utcOffset = '+00:00') {
  const ts = (t) => new Date(t.replace(' ', 'T') + utcOffset).toISOString();
  const out = {};
  const unmatched = [];
  for (const [, q] of Object.entries(sub.answers || {})) {
    const label = stripTags(q.text).toLowerCase();
    if (!label) continue;
    const f = FIELDS.find((x) => x.match.test(label));
    if (!f) { if (q.answer != null && q.answer !== '') unmatched.push(label); continue; }
    const a = q.answer;
    const val = f.kind === 'name' ? asName(a)
      : f.kind === 'phone' ? asPhone(a)
      : f.kind === 'date' ? asDate(a)
      : f.kind === 'list' ? asList(a)
      : f.kind === 'count' ? asCount(a)
      : f.kind === 'bool' ? asBool(a)
      : f.kind === 'url' ? asUrl(a)
      : f.kind === 'files' ? asFiles(a)
      : asText(a);
    out[f.col] = val;
  }
  const row = {
    submission_id: String(sub.id),
    form_id: String(formId),
    submitted_at: ts(sub.created_at),
    jotform_updated_at: sub.updated_at ? ts(sub.updated_at) : null,
  };
  for (const f of FIELDS) {
    if (['post_1', 'post_2', 'post_3', 'headshot_files', 'setup_files'].includes(f.col)) continue;
    if (f.col in out) row[f.col] = out[f.col];
  }
  row.post_urls = [out.post_1, out.post_2, out.post_3].filter(Boolean);
  return { row, headshots: out.headshot_files || [], setups: (out.setup_files || []).slice(0, 4), unmatched };
}
