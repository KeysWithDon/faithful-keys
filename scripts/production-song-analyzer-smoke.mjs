import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const url = process.env.FAITHFUL_KEYS_SUPABASE_URL;
const key = process.env.FAITHFUL_KEYS_SUPABASE_KEY;
if (!url || !key) throw new Error("Set FAITHFUL_KEYS_SUPABASE_URL and FAITHFUL_KEYS_SUPABASE_KEY.");

function testWav() {
  const sampleRate = 22050;
  const chordSeconds = 4;
  const chords = [
    [130.81, 164.81, 196.0],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
    [130.81, 164.81, 196.0],
  ];
  const frames = sampleRate * chordSeconds * chords.length;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let frame = 0; frame < frames; frame += 1) {
    const chordIndex = Math.min(chords.length - 1, Math.floor(frame / (sampleRate * chordSeconds)));
    const localTime = (frame % (sampleRate * chordSeconds)) / sampleRate;
    const edge = Math.min(1, localTime / 0.04, (chordSeconds - localTime) / 0.08);
    const sample = chords[chordIndex].reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * frame / sampleRate), 0);
    view.setInt16(44 + frame * 2, Math.round(Math.max(-1, Math.min(1, sample * edge * 0.18)) * 32767), true);
  }
  return bytes;
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: auth, error: authError } = await client.auth.signInAnonymously();
if (authError || !auth.user) throw authError ?? new Error("Anonymous authentication did not return a user.");

const now = new Date().toISOString();
const chartId = `production-smoke-${crypto.randomUUID()}`;
const audioPath = process.env.FAITHFUL_KEYS_SMOKE_AUDIO;
const audioName = audioPath ? basename(audioPath).replace(/[^a-zA-Z0-9._-]/g, "-") : "smoke.wav";
const audioType = audioName.endsWith(".ogg") ? "audio/ogg" : "audio/wav";
const objectKey = `${auth.user.id}/${chartId}/${audioName}`;
let chartCreated = false;
try {
  const chart = {
    id: chartId,
    title: "Production analyzer smoke test",
    artist: null,
    sourceType: "upload",
    sourceUrl: null,
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
    source_type: "upload",
    source_url: null,
    chart,
  });
  if (chartError) throw chartError;
  chartCreated = true;

  const audio = audioPath ? await readFile(audioPath) : testWav();
  const { error: uploadError } = await client.storage.from("faithful-keys-sources").upload(
    objectKey,
    new Blob([audio], { type: audioType }),
    { contentType: audioType, upsert: false },
  );
  if (uploadError) throw uploadError;

  const { data: job, error: jobError } = await client.from("analysis_jobs").insert({
    chart_id: chartId,
    source_type: "upload",
    source_object_key: objectKey,
    status: "queued",
    progress: 0,
  }).select("id").single();
  if (jobError || !job) throw jobError ?? new Error("The analysis job was not created.");

  const { error: dispatchError } = await client.functions.invoke("queue-song-analysis", { body: { jobId: job.id } });
  if (dispatchError) throw dispatchError;
  console.log("Production job accepted.");

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
  if (!finalJob || finalJob.status !== "completed") throw new Error(finalJob?.error ?? "Production analysis timed out.");

  const { data: result, error: resultError } = await client.from("song_charts").select("chart").eq("id", chartId).single();
  if (resultError || !result) throw resultError ?? new Error("The completed chart was not found.");
  const events = result.chart.sections.flatMap(section => section.measures.flatMap(measure => measure.chordEvents));
  if (events.length === 0) throw new Error("Production recognition completed without chord events.");
  console.log(`Production analyzer verified with ${events.length} recognized chord events.`);
} finally {
  await client.storage.from("faithful-keys-sources").remove([objectKey]);
  if (chartCreated) await client.from("song_charts").delete().eq("id", chartId);
  await client.auth.signOut();
}
