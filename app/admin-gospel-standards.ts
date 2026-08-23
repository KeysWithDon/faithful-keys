import type { SongChart } from "./song-analyzer.ts";
import type { StandardChart, StandardMeasure } from "./standards.ts";
import { getSupabaseClient } from "./supabase-client.ts";

export const ADMIN_SESSION_KEY = "faithful-keys-gospel-admin-session";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("The Gospel Standards publisher is not configured.");
  return client;
}

function errorMessage(data: unknown, fallback: string) {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : fallback;
}

export async function unlockGospelAdmin(code: string) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("admin-gospel-standards", {
    body: { action: "login", code },
  });
  if (error) throw error;
  if (!data?.token) throw new Error(errorMessage(data, "Admin access could not be unlocked."));
  return { token: String(data.token), expiresAt: String(data.expiresAt ?? "") };
}

export async function validateGospelAdmin(token: string) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("admin-gospel-standards", {
    body: { action: "validate", token },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(errorMessage(data, "Admin access has expired."));
  return true;
}

export async function publishGospelStandard(token: string, standard: StandardChart) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("admin-gospel-standards", {
    body: { action: "publish", token, standard },
  });
  if (error) throw error;
  if (!data?.standard) throw new Error(errorMessage(data, "The chart could not be added to Gospel Standards."));
  window.dispatchEvent(new CustomEvent("faithful-keys-gospel-standards"));
  return data.standard as StandardChart;
}

export async function unpublishGospelStandard(token: string, name: string) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("admin-gospel-standards", {
    body: { action: "unpublish", token, name },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(errorMessage(data, "The song could not be removed from Gospel Standards."));
  window.dispatchEvent(new CustomEvent("faithful-keys-gospel-standards"));
  return true;
}

export async function loadPublishedGospelStandards(): Promise<StandardChart[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.from("published_gospel_standards")
    .select("chart").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => row.chart as StandardChart).filter(standard =>
    Boolean(standard?.name && standard?.key && Array.isArray(standard?.bars) && standard.bars.length),
  );
}

function measureForStandard(chart: SongChart, measure: SongChart["sections"][number]["measures"][number], previousChord: string | null) {
  const events = [...measure.chordEvents]
    .filter(event => event.chordSymbol && event.chordSymbol !== "?")
    .sort((a, b) => a.beat - b.beat)
    .filter((event, index, all) => index === 0 || event.beat !== all[index - 1].beat);
  const fallback = previousChord ?? events[0]?.chordSymbol ?? chart.key;
  if (!events.length) return { bar: fallback as StandardMeasure, lastChord: fallback };
  const timeline = events[0].beat > 1
    ? [{ chordSymbol: fallback, beat: 1 }, ...events]
    : events.map(event => ({ chordSymbol: event.chordSymbol, beat: event.beat }));
  const chords = timeline.map(event => event.chordSymbol);
  const durations = timeline.map((event, index) => {
    const nextBeat = timeline[index + 1]?.beat ?? measure.beats + 1;
    return Math.max(0.25, nextBeat - event.beat);
  });
  const bar: StandardMeasure = chords.length === 1
    ? chords[0]
    : { chords, durations, beats: measure.beats };
  return { bar, lastChord: chords.at(-1) ?? fallback };
}

export function songChartToGospelStandard(chart: SongChart): StandardChart {
  let previousChord: string | null = null;
  const bars: StandardMeasure[] = [];
  for (const section of chart.sections) {
    for (const measure of section.measures) {
      const converted = measureForStandard(chart, measure, previousChord);
      bars.push(converted.bar);
      previousChord = converted.lastChord;
    }
  }
  const [numerator, denominator] = chart.timeSignature.split("/").map(Number);
  return {
    name: chart.title.trim() || "Untitled Gospel Standard",
    key: chart.key,
    composer: chart.artist?.trim() || "Faithful Keys admin chart",
    style: "Song Analyzer transcription",
    timeSignature: [Number.isFinite(numerator) ? numerator : 4, Number.isFinite(denominator) ? denominator : 4],
    bars: bars.length ? bars : [chart.key],
    source: "manual-transcription",
    matchStatus: "manual",
    sourceTitle: chart.title.trim() || "Untitled Gospel Standard",
    note: "Admin-reviewed chart published from the Faithful Keys Song Analyzer.",
  };
}
