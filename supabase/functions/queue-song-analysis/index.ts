// Authenticated queue and result callback for Faithful Keys private analysis.
// Browser calls use a user JWT. The worker callback uses a separate secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import { chartWithResults, type RecognitionResult } from "./chart-builder.ts";

const BUCKET = "faithful-keys-sources";
const jsonHeaders = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

type WorkerResult = { kind: "completed" | "failed"; jobId: string; chartId: string; sourceObjectKey?: string | null; result?: RecognitionResult; message?: string };

function adminKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default as string;
  } catch { /* legacy key fallback below */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function callbackUrl(supabaseUrl: string) { return supabaseUrl + "/functions/v1/queue-song-analysis"; }

function referenceChartPayload(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Upload a parsed chord chart before measuring performance timing.");
  const chart = value as Record<string, unknown>;
  const authority = chart.harmonicAuthority && typeof chart.harmonicAuthority === "object"
    ? chart.harmonicAuthority as Record<string, unknown>
    : null;
  const sourceSections = authority && Array.isArray(authority.sections) && authority.sections.length
    ? authority.sections
    : Array.isArray(chart.sections) ? chart.sections : [];
  const sections = sourceSections.map((sectionValue, sectionIndex) => {
    const section = sectionValue as Record<string, unknown>;
    return {
      name: String(section.name ?? `Section ${sectionIndex + 1}`).slice(0, 80),
      measures: (Array.isArray(section.measures) ? section.measures : []).map((measureValue, measureIndex) => {
        const measure = measureValue as Record<string, unknown>;
        const beats = Math.max(1, Math.min(12, Number(measure.beats) || 4));
        return {
          number: Number(measure.number) || measureIndex + 1,
          beats,
          chordEvents: (Array.isArray(measure.chordEvents) ? measure.chordEvents : []).map(eventValue => {
            const event = eventValue as Record<string, unknown>;
            return {
              id: String(event.id ?? "").slice(0, 80),
              chordSymbol: String(event.chordSymbol ?? "?").slice(0, 40),
              chartChord: String(event.chartChord ?? event.chordSymbol ?? "?").slice(0, 40),
              measureNumber: Number(event.measureNumber) || Number(measure.number) || measureIndex + 1,
              beat: Math.max(1, Math.min(beats + .5, Math.round((Number(event.beat) || 1) * 2) / 2)),
              locked: Boolean(event.locked),
            };
          }).filter(event => event.chartChord !== "?"),
        };
      }),
    };
  }).filter(section => section.measures.some(measure => measure.chordEvents.length));
  if (!sections.length) throw new Error("The uploaded chart does not contain any usable chords.");
  const bpm = Number(chart.bpm);
  if (!Number.isFinite(bpm) || bpm < 10 || bpm > 250) {
    throw new Error("Set the chart tempo between 10 and 250 BPM before measuring performance timing.");
  }
  return {
    key: String(authority?.key ?? chart.key ?? "C").slice(0, 8),
    mode: (authority?.mode ?? chart.mode) === "minor" ? "minor" : "major",
    bpm,
    swingPercent: Math.round(Math.max(50, Math.min(75, Number(authority?.swingPercent ?? chart.swingPercent) || 50))),
    timeSignature: String(authority?.timeSignature ?? chart.timeSignature ?? "4/4").slice(0, 8),
    sections,
  };
}

function permittedYouTubeUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return /^\/[A-Za-z0-9_-]{6,}$/.test(url.pathname);
    if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return false;
    if (url.pathname === "/watch") return /^[A-Za-z0-9_-]{6,}$/.test(url.searchParams.get("v") ?? "");
    return /^\/shorts\/[A-Za-z0-9_-]{6,}\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

async function completeWorkerResult(request: Request, supabaseUrl: string, token: string) {
  if (request.headers.get("x-faithful-worker-token") !== token) return respond({ error: "Unauthorized worker callback." }, 401);
  let payload: WorkerResult;
  try { payload = await request.json(); } catch { return respond({ error: "Invalid worker callback." }, 400); }
  if (!payload?.jobId || !payload.chartId || !["completed", "failed"].includes(payload.kind)) return respond({ error: "Invalid worker callback." }, 400);
  const secret = adminKey();
  if (!secret) return respond({ error: "The callback is not configured." }, 500);
  const admin = createClient(supabaseUrl, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: job } = await admin.from("analysis_jobs").select("id, chart_id, source_type, source_object_key").eq("id", payload.jobId).maybeSingle();
  const sourceMatches = job?.source_type === "youtube"
    ? job.source_object_key === null && (payload.sourceObjectKey ?? null) === null
    : Boolean(job?.source_object_key) && job?.source_object_key === payload.sourceObjectKey;
  if (!job || job.chart_id !== payload.chartId || !sourceMatches) return respond({ error: "Unknown worker job." }, 404);
  if (payload.kind === "failed" || !payload.result) {
    const safeFailures = new Set([
      "Instrumental separation is unavailable.",
      "Instrumental separation could not be completed.",
      "Instrumental separation did not return a usable music stem.",
      "Beat detection could not be completed.",
      "Chord recognition could not be completed.",
      "YouTube audio could not be prepared.",
      "Private chord recognition could not complete.",
    ]);
    const message = payload.message && safeFailures.has(payload.message)
      ? payload.message
      : "Private chord recognition could not complete. Check the permitted audio file and try again.";
    await admin.from("analysis_jobs").update({ status: "failed", progress: 0, error: message, completed_at: new Date().toISOString() }).eq("id", payload.jobId);
  } else {
    const { data: row } = await admin.from("song_charts").select("chart").eq("id", payload.chartId).single();
    if (!row) return respond({ error: "The destination chart no longer exists." }, 404);
    const chart = chartWithResults(row.chart as Record<string, unknown>, payload.result);
    await admin.from("song_charts").update({ chart, updated_at: chart.updatedAt }).eq("id", payload.chartId);
    await admin.from("analysis_jobs").update({ status: "completed", progress: 100, error: null, completed_at: new Date().toISOString() }).eq("id", payload.jobId);
  }
  if (payload.sourceObjectKey) await admin.storage.from(BUCKET).remove([payload.sourceObjectKey]);
  return respond({ ok: true });
}

Deno.serve(async request => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const workerToken = Deno.env.get("ANALYSIS_WORKER_TOKEN");
  if (!supabaseUrl || !workerToken) return respond({ error: "The analysis service is not configured." }, 503);
  if (request.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (request.method !== "POST") return respond({ error: "Use POST." }, 405);
  if (request.headers.has("x-faithful-worker-token")) return completeWorkerResult(request, supabaseUrl, workerToken);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return respond({ error: "Sign in before starting analysis." }, 401);
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!publicKey) return respond({ error: "The analysis service is not configured." }, 500);
  const client = createClient(supabaseUrl, publicKey, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return respond({ error: "Your session has expired. Please sign in again." }, 401);
  let jobId = "";
  try { ({ jobId } = await request.json()); } catch { return respond({ error: "A job id is required." }, 400); }
  if (typeof jobId !== "string" || !jobId) return respond({ error: "A job id is required." }, 400);
  const { data: job, error: jobError } = await client.from("analysis_jobs")
    .select("id, chart_id, source_type, source_object_key, source_url, status, progress, error, created_at, completed_at").eq("id", jobId).single();
  if (jobError || !job) return respond({ error: "That private job was not found." }, 404);
  if (job.status === "completed" || job.status === "review") return respond({ job });
  if (job.source_type === "youtube" && !permittedYouTubeUrl(job.source_url)) return respond({ error: "The saved YouTube link is not valid." }, 400);
  if (job.source_type === "upload" && !job.source_object_key) return respond({ error: "The private audio object is missing." }, 400);
  const secret = adminKey();
  const workerUrl = Deno.env.get("ANALYSIS_WORKER_URL");
  if (!secret || !workerUrl) return respond({ error: "Private audio analysis is not enabled yet." }, 503);
  const admin = createClient(supabaseUrl, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  let sourceUrl = job.source_url as string | null;
  if (job.source_type === "upload") {
    const { data: signed, error: signingError } = await admin.storage.from(BUCKET).createSignedUrl(job.source_object_key, 60 * 30);
    if (signingError || !signed?.signedUrl) return respond({ error: "Could not securely prepare the audio source." }, 500);
    sourceUrl = signed.signedUrl;
  }
  const { data: processing, error: processingError } = await client.from("analysis_jobs").update({ status: "processing", progress: 5, error: null }).eq("id", job.id)
    .select("id, source_type, status, progress, error, created_at, completed_at").single();
  if (processingError || !processing) return respond({ error: processingError?.message ?? "Could not start the private job." }, 500);
  try {
    const { data: referenceRow, error: referenceError } = await client.from("song_charts").select("chart").eq("id", job.chart_id).single();
    if (referenceError || !referenceRow) throw new Error("The reference chart is unavailable.");
    const referenceChart = referenceChartPayload(referenceRow.chart);
    const workerBase = workerUrl.endsWith("/") ? workerUrl.slice(0, -1) : workerUrl;
    const dispatched = await fetch(workerBase + "/jobs", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + workerToken },
      body: JSON.stringify({ jobId: job.id, chartId: job.chart_id, sourceType: job.source_type, sourceObjectKey: job.source_object_key, sourceUrl, callbackUrl: callbackUrl(supabaseUrl), referenceChart }),
    });
    if (!dispatched.ok) throw new Error("The private worker could not be reached.");
    return respond({ job: processing }, 202);
  } catch {
    const { data } = await client.from("analysis_jobs").update({ status: "failed", progress: 0, error: "The private worker could not be reached.", completed_at: new Date().toISOString() }).eq("id", job.id)
      .select("id, source_type, status, progress, error, created_at, completed_at").single();
    return respond({ job: data, error: "The private worker could not be reached." }, 502);
  }
});
