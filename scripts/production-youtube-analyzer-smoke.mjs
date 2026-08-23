import { createClient } from "@supabase/supabase-js";

const url = process.env.FAITHFUL_KEYS_SUPABASE_URL;
const key = process.env.FAITHFUL_KEYS_SUPABASE_KEY;
const sourceUrl = process.env.FAITHFUL_KEYS_SMOKE_YOUTUBE_URL;
if (!url || !key || !sourceUrl) {
  throw new Error("Set FAITHFUL_KEYS_SUPABASE_URL, FAITHFUL_KEYS_SUPABASE_KEY, and FAITHFUL_KEYS_SMOKE_YOUTUBE_URL.");
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: auth, error: authError } = await client.auth.signInAnonymously();
if (authError || !auth.user) throw authError ?? new Error("Anonymous authentication did not return a user.");

const now = new Date().toISOString();
const chartId = `production-youtube-smoke-${crypto.randomUUID()}`;
let chartCreated = false;
try {
  const chart = {
    id: chartId,
    title: "Production YouTube analyzer smoke test",
    artist: null,
    sourceType: "youtube",
    sourceUrl,
    key: "C",
    mode: "major",
    bpm: null,
    timeSignature: "4/4",
    confidence: "uncertain",
    durationSeconds: null,
    createdAt: now,
    updatedAt: now,
    sections: [{
      id: "section-1",
      name: "Section 1",
      order: 1,
      startTime: 0,
      endTime: 0,
      confidence: "uncertain",
      measures: Array.from({ length: 4 }, (_, index) => ({ number: index + 1, startTime: 0, beats: 4, chordEvents: [] })),
    }],
  };
  const { error: chartError } = await client.from("song_charts").insert({
    id: chartId,
    title: chart.title,
    source_type: "youtube",
    source_url: sourceUrl,
    chart,
  });
  if (chartError) throw chartError;
  chartCreated = true;

  const { data: job, error: jobError } = await client.from("analysis_jobs").insert({
    chart_id: chartId,
    source_type: "youtube",
    source_object_key: null,
    source_url: sourceUrl,
    status: "queued",
    progress: 0,
  }).select("id").single();
  if (jobError || !job) throw jobError ?? new Error("The YouTube analysis job was not created.");

  const { error: dispatchError } = await client.functions.invoke("queue-song-analysis", { body: { jobId: job.id } });
  if (dispatchError) throw dispatchError;
  console.log("Production YouTube job accepted.");

  const deadline = Date.now() + 20 * 60 * 1000;
  let finalJob;
  while (Date.now() < deadline) {
    const { data, error } = await client.from("analysis_jobs").select("status, progress, error").eq("id", job.id).single();
    if (error) throw error;
    finalJob = data;
    console.log(`Analysis status: ${data.status} (${data.progress}%)`);
    if (["completed", "failed", "review"].includes(data.status)) break;
    await new Promise(resolve => setTimeout(resolve, 8000));
  }
  if (!finalJob || finalJob.status !== "completed") throw new Error(finalJob?.error ?? "Production YouTube analysis timed out.");

  const { data: result, error: resultError } = await client.from("song_charts").select("chart").eq("id", chartId).single();
  if (resultError || !result) throw resultError ?? new Error("The completed YouTube chart was not found.");
  const events = result.chart.sections.flatMap(section => section.measures.flatMap(measure => measure.chordEvents));
  if (events.length === 0) throw new Error("Production YouTube recognition completed without chord events.");
  if (!Number.isFinite(result.chart.bpm) || result.chart.bpm <= 0) throw new Error("Production YouTube recognition completed without a beat/BPM result.");
  console.log(`Production YouTube analyzer verified at ${Math.round(result.chart.bpm)} BPM with ${events.length} recognized chord events.`);
} finally {
  if (chartCreated) await client.from("song_charts").delete().eq("id", chartId);
  await client.auth.signOut();
}
