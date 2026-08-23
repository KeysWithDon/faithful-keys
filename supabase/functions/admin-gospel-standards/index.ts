import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });
const encoder = new TextEncoder();

function adminKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default as string;
  } catch { /* legacy key fallback below */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function validSession(admin: ReturnType<typeof createClient>, token: unknown) {
  if (typeof token !== "string" || token.length !== 64) return false;
  const { data } = await admin.from("faithful_admin_sessions").select("id")
    .eq("token_hash", await hash(token)).gt("expires_at", new Date().toISOString()).maybeSingle();
  return Boolean(data);
}

type Bar = string | string[] | { chords: string[]; durations: number[]; beats?: number };
type StandardInput = {
  name?: unknown; key?: unknown; composer?: unknown; style?: unknown; timeSignature?: unknown;
  bars?: unknown; sourceTitle?: unknown; note?: unknown;
};

function cleanText(value: unknown, fallback: string, maximum: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function cleanChord(value: unknown) {
  if (typeof value !== "string") throw new Error("Every chart chord must be a chord symbol.");
  const chord = value.trim().slice(0, 64);
  if (!chord) throw new Error("Empty chord symbols cannot be published.");
  return chord;
}

function cleanBar(value: unknown): Bar {
  if (typeof value === "string") return cleanChord(value);
  if (Array.isArray(value)) {
    if (!value.length || value.length > 16) throw new Error("A bar must contain between 1 and 16 chord events.");
    return value.map(cleanChord);
  }
  if (!value || typeof value !== "object") throw new Error("The chart contains an invalid measure.");
  const input = value as { chords?: unknown; durations?: unknown; beats?: unknown };
  if (!Array.isArray(input.chords) || !Array.isArray(input.durations) || input.chords.length !== input.durations.length || !input.chords.length || input.chords.length > 16) {
    throw new Error("Shared-bar chords and durations must have matching lengths.");
  }
  const durations = input.durations.map(duration => Number(duration));
  if (durations.some(duration => !Number.isFinite(duration) || duration <= 0 || duration > 16)) throw new Error("The chart contains an invalid chord duration.");
  const beats = input.beats === undefined ? undefined : Number(input.beats);
  if (beats !== undefined && (!Number.isFinite(beats) || beats <= 0 || beats > 16)) throw new Error("The chart contains an invalid bar length.");
  return { chords: input.chords.map(cleanChord), durations, ...(beats === undefined ? {} : { beats }) };
}

function cleanStandard(input: StandardInput) {
  const name = cleanText(input.name, "", 180);
  const key = cleanText(input.key, "", 8);
  if (!name || !key) throw new Error("A title and key are required.");
  if (!Array.isArray(input.bars) || !input.bars.length || input.bars.length > 500) throw new Error("A published chart must contain between 1 and 500 bars.");
  const meter = Array.isArray(input.timeSignature) ? input.timeSignature.map(Number) : [];
  const numerator = meter[0];
  const denominator = meter[1];
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 12 || ![2, 4, 8, 16].includes(denominator)) throw new Error("The chart has an unsupported time signature.");
  return {
    name,
    key,
    composer: cleanText(input.composer, "Faithful Keys admin chart", 180),
    style: cleanText(input.style, "Song Analyzer transcription", 120),
    timeSignature: [numerator, denominator],
    bars: input.bars.map(cleanBar),
    source: "manual-transcription",
    matchStatus: "manual",
    sourceTitle: cleanText(input.sourceTitle, name, 180),
    note: cleanText(input.note, "Admin-reviewed chart published from the Faithful Keys Song Analyzer.", 500),
  };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (request.method !== "POST") return respond({ error: "Use POST." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secret = adminKey();
  if (!supabaseUrl || !secret) return respond({ error: "Admin publishing is not configured." }, 503);
  const admin = createClient(supabaseUrl, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return respond({ error: "Invalid request." }, 400); }

  if (body.action === "login") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code.length < 16 || code.length > 160) return respond({ error: "Admin access was not recognized." }, 401);
    const { data: access } = await admin.from("faithful_admin_access").select("code_hash").eq("id", true).maybeSingle();
    const candidate = await hash(code);
    if (!access?.code_hash || !secureEqual(candidate, String(access.code_hash))) {
      await new Promise(resolve => setTimeout(resolve, 350));
      return respond({ error: "Admin access was not recognized." }, 401);
    }
    await admin.from("faithful_admin_sessions").delete().lt("expires_at", new Date().toISOString());
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from("faithful_admin_sessions").insert({ token_hash: await hash(token), expires_at: expiresAt });
    return error ? respond({ error: "Admin access could not be started." }, 500) : respond({ token, expiresAt });
  }

  if (body.action === "validate") {
    return await validSession(admin, body.token)
      ? respond({ ok: true })
      : respond({ error: "Admin access has expired. Unlock it again." }, 401);
  }

  if (body.action === "publish") {
    if (!await validSession(admin, body.token)) return respond({ error: "Admin access has expired. Unlock it again." }, 401);
    let standard;
    try { standard = cleanStandard((body.standard ?? {}) as StandardInput); }
    catch (error) { return respond({ error: error instanceof Error ? error.message : "The chart is invalid." }, 400); }
    const { data, error } = await admin.from("published_gospel_standards").upsert({
      name: standard.name,
      composer: standard.composer,
      style: standard.style,
      chart: standard,
      updated_at: new Date().toISOString(),
    }, { onConflict: "name" }).select("chart").single();
    return error || !data ? respond({ error: "The chart could not be added to Gospel Standards." }, 500) : respond({ standard: data.chart });
  }

  if (body.action === "unpublish") {
    if (!await validSession(admin, body.token)) return respond({ error: "Admin access has expired. Unlock it again." }, 401);
    const name = cleanText(body.name, "", 180);
    if (!name) return respond({ error: "A chart title is required." }, 400);
    const { error } = await admin.from("published_gospel_standards").delete().eq("name", name);
    return error ? respond({ error: "The chart could not be removed." }, 500) : respond({ ok: true });
  }

  return respond({ error: "Unknown admin action." }, 400);
});
