// Authenticated queue and result callback for Faithful Keys private analysis.
// Browser calls use a user JWT. The worker callback uses a separate secret.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "faithful-keys-sources";
const jsonHeaders = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

type RecognitionResult = { key?: string; mode?: string; bpm?: number; beatTimes?: number[]; events?: Array<{ startTime?: number; endTime?: number; chordSymbol?: string }> };
type WorkerResult = { kind: "completed" | "failed"; jobId: string; chartId: string; sourceObjectKey: string; result?: RecognitionResult; message?: string };

function adminKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default as string;
  } catch { /* legacy key fallback below */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function callbackUrl(supabaseUrl: string) { return supabaseUrl + "/functions/v1/queue-song-analysis"; }

function chartWithResults(chart: Record<string, unknown>, result: RecognitionResult) {
  const beats = result.beatTimes ?? [];
  const events = result.events ?? [];
  const bpm = Math.max(Number(result.bpm ?? 72), 30);
  const numerator = 4;
  const duration = Math.max(0, ...events.map(item => Number(item.endTime ?? 0)));
  const measureCount = Math.max(4, Math.ceil(beats.length / numerator));
  const measures = Array.from({ length: measureCount }, (_, index) => ({
    number: index + 1,
    startTime: Number(beats[index * numerator] ?? (index * numerator * 60 / bpm)),
    beats: numerator,
    chordEvents: [] as Array<Record<string, unknown>>,
  }));
  events.forEach((item, index) => {
    const start = Number(item.startTime ?? 0);
    const closest = beats.length
      ? beats.reduce((best, beat, beatIndex) => Math.abs(beat - start) < Math.abs(beats[best] - start) ? beatIndex : best, 0)
      : Math.round(start * bpm / 60);
    const [measureIndex, beat] = [Math.floor(Math.max(0, closest) / numerator), Math.max(0, closest) % numerator];
    if (!measures[measureIndex]) return;
    measures[measureIndex].chordEvents.push({
      id: "recognized-" + (index + 1), chordSymbol: String(item.chordSymbol ?? "?"), nashvilleNumber: "?",
      startTime: start, endTime: Number(item.endTime ?? start), measureNumber: measureIndex + 1,
      beat: beat + 1, confidence: "medium", userEdited: false, confirmed: false,
    });
  });
  return {
    ...chart, key: result.key ?? chart.key ?? "C", mode: result.mode ?? chart.mode ?? "major",
    bpm: result.bpm ?? null, timeSignature: "4/4", confidence: "medium", durationSeconds: duration || null,
    sections: [{ id: "recognized-section", name: "Recognized progression", order: 1, startTime: 0, endTime: duration, confidence: "medium", measures }],
    updatedAt: new Date().toISOString(),
  };
}

async function completeWorkerResult(request: Request, supabaseUrl: string, token: string) {
  if (request.headers.get("x-faithful-worker-token") !== token) return respond({ error: "Unauthorized worker callback." }, 401);
  let payload: WorkerResult;
  try { payload = await request.json(); } catch { return respond({ error: "Invalid worker callback." }, 400); }
  if (!payload?.jobId || !payload.chartId || !payload.sourceObjectKey || !["completed", "failed"].includes(payload.kind)) return respond({ error: "Invalid worker callback." }, 400);
  const secret = adminKey();
  if (!secret) return respond({ error: "The callback is not configured." }, 500);
  const admin = createClient(supabaseUrl, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: job } = await admin.from("analysis_jobs").select("id, chart_id, source_object_key").eq("id", payload.jobId).maybeSingle();
  if (!job || job.chart_id !== payload.chartId || job.source_object_key !== payload.sourceObjectKey) return respond({ error: "Unknown worker job." }, 404);
  if (payload.kind === "failed" || !payload.result) {
    await admin.from("analysis_jobs").update({ status: "failed", progress: 0, error: "Private chord recognition could not complete. Check the permitted audio file and try again.", completed_at: new Date().toISOString() }).eq("id", payload.jobId);
  } else {
    const { data: row } = await admin.from("song_charts").select("chart").eq("id", payload.chartId).single();
    if (!row) return respond({ error: "The destination chart no longer exists." }, 404);
    const chart = chartWithResults(row.chart as Record<string, unknown>, payload.result);
    await admin.from("song_charts").update({ chart, updated_at: chart.updatedAt }).eq("id", payload.chartId);
    await admin.from("analysis_jobs").update({ status: "completed", progress: 100, error: null, completed_at: new Date().toISOString() }).eq("id", payload.jobId);
  }
  await admin.storage.from(BUCKET).remove([payload.sourceObjectKey]);
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
    .select("id, chart_id, source_type, source_object_key, status, progress, error, created_at, completed_at").eq("id", jobId).single();
  if (jobError || !job) return respond({ error: "That private job was not found." }, 404);
  if (job.status === "completed" || job.status === "review") return respond({ job });
  if (job.source_type === "youtube") {
    const { data, error } = await client.from("analysis_jobs").update({ status: "review", progress: 100, completed_at: new Date().toISOString(), error: "Upload audio you own or are permitted to analyze to run recognition." }).eq("id", job.id)
      .select("id, source_type, status, progress, error, created_at, completed_at").single();
    return error ? respond({ error: error.message }, 500) : respond({ job: data });
  }
  if (!job.source_object_key) return respond({ error: "The private audio object is missing." }, 400);
  const secret = adminKey();
  const workerUrl = Deno.env.get("ANALYSIS_WORKER_URL");
  if (!secret || !workerUrl) return respond({ error: "Private audio analysis is not enabled yet." }, 503);
  const admin = createClient(supabaseUrl, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: signed, error: signingError } = await admin.storage.from(BUCKET).createSignedUrl(job.source_object_key, 60 * 30);
  if (signingError || !signed?.signedUrl) return respond({ error: "Could not securely prepare the audio source." }, 500);
  const { data: processing, error: processingError } = await client.from("analysis_jobs").update({ status: "processing", progress: 5, error: null }).eq("id", job.id)
    .select("id, source_type, status, progress, error, created_at, completed_at").single();
  if (processingError || !processing) return respond({ error: processingError?.message ?? "Could not start the private job." }, 500);
  try {
    const workerBase = workerUrl.endsWith("/") ? workerUrl.slice(0, -1) : workerUrl;
    const dispatched = await fetch(workerBase + "/jobs", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + workerToken },
      body: JSON.stringify({ jobId: job.id, chartId: job.chart_id, sourceObjectKey: job.source_object_key, sourceUrl: signed.signedUrl, callbackUrl: callbackUrl(supabaseUrl) }),
    });
    if (!dispatched.ok) throw new Error("The private worker could not be reached.");
    return respond({ job: processing }, 202);
  } catch {
    const { data } = await client.from("analysis_jobs").update({ status: "failed", progress: 0, error: "The private worker could not be reached.", completed_at: new Date().toISOString() }).eq("id", job.id)
      .select("id, source_type, status, progress, error, created_at, completed_at").single();
    return respond({ job: data, error: "The private worker could not be reached." }, 502);
  }
});
