import { createPrivateReviewChart, nashvilleNumber, normalizedChart, normalizeSwingPercent, snapBeatPosition, type SongChart } from "./song-analyzer.ts";
import type { StandardChart, StandardMeasure } from "./standards.ts";
import { getSupabaseClient } from "./supabase-client.ts";
import { spellChordInKey } from "./music-theory.ts";

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

export async function publishGospelStandard(token: string, standard: StandardChart, originalName?: string) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("admin-gospel-standards", {
    body: { action: "publish", token, standard, originalName: originalName ?? null },
  });
  if (error) throw error;
  if (!data?.standard) throw new Error(errorMessage(data, "The chart could not be added to Gospel Standards."));
  window.dispatchEvent(new CustomEvent("faithful-keys-gospel-standards"));
  return data.standard as StandardChart;
}

function editableStandardId(name: string) {
  let hash = 2166136261;
  for (const character of name) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return `published-${(hash >>> 0).toString(36)}`;
}

/** Rebuild an editable admin chart from the exact published bars. */
export function gospelStandardToSongChart(standard: StandardChart): SongChart {
  const now = new Date().toISOString();
  const [numerator, denominator] = standard.timeSignature;
  const chart = createPrivateReviewChart({ sourceType: "upload", title: standard.name });
  chart.id = editableStandardId(standard.name);
  chart.artist = standard.composer;
  chart.key = standard.key;
  chart.mode = "major";
  chart.timeSignature = `${numerator}/${denominator}`;
  chart.swingPercent = normalizeSwingPercent(standard.swingPercent);
  chart.confidence = "high";
  chart.chartReference = {
    fileName: `Published Gospel Standard · ${standard.name}`,
    format: "json",
    importedAt: now,
    chordCount: 0,
  };
  chart.publishedStandard = {
    originalName: standard.name,
    style: standard.style,
    sourceTitle: standard.sourceTitle,
    ...(standard.note ? { note: standard.note } : {}),
  };

  let timelineBeat = 0;
  chart.sections = [{
    id: `published-section-${chart.id}`,
    name: "Song",
    order: 1,
    startTime: 0,
    endTime: 0,
    confidence: "high",
    measures: standard.bars.map((bar, measureIndex) => {
      const barObject = typeof bar === "object" && !Array.isArray(bar) ? bar : null;
      const chords = (barObject ? barObject.chords : Array.isArray(bar) ? bar : [bar]).map(chord => chord.trim()).filter(Boolean);
      const beats = Math.max(1, Math.round(barObject?.beats ?? numerator));
      const explicitDurations = barObject?.durations;
      const durations = explicitDurations?.length === chords.length
        ? explicitDurations.map(duration => Math.max(0.25, duration))
        : chords.map(() => beats / Math.max(1, chords.length));
      let elapsed = 0;
      const chordEvents = chords.map((chordSymbol, chordIndex) => {
        const duration = durations[chordIndex] ?? 1;
        const beat = snapBeatPosition(elapsed + 1, beats);
        const startTime = timelineBeat + elapsed;
        elapsed += duration;
        return {
          id: `${chart.id}-bar-${measureIndex + 1}-chord-${chordIndex + 1}`,
          chordSymbol,
          chartChord: chordSymbol,
          nashvilleNumber: nashvilleNumber(chordSymbol, standard.key),
          startTime,
          endTime: startTime + duration,
          measureNumber: measureIndex + 1,
          beat,
          confidence: "high" as const,
          userEdited: false,
          confirmed: true,
          locked: false,
          needsUserReview: false,
          sustainAcrossBar: Boolean(barObject?.sustainAcrossBars?.[chordIndex]),
        };
      });
      const measure = { number: measureIndex + 1, startTime: timelineBeat, beats, chordEvents };
      timelineBeat += beats;
      return measure;
    }),
  }];
  chart.sections[0].endTime = timelineBeat;
  chart.chartReference.chordCount = chart.sections[0].measures.reduce((sum, measure) => sum + measure.chordEvents.length, 0);
  chart.createdAt = now;
  chart.updatedAt = now;
  return normalizedChart(chart);
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
  const fallback = previousChord ?? (events[0]?.chordSymbol ? spellChordInKey(events[0].chordSymbol, chart.key) : chart.key);
  if (!events.length) return { bar: fallback as StandardMeasure, lastChord: fallback };
  const timeline: Array<{ chordSymbol: string; beat: number; sustainAcrossBar?: boolean; startTime?: number; endTime?: number; timingAdjusted?: boolean }> = events[0].beat > 1
    ? [{ chordSymbol: fallback, beat: 1 }, ...events]
    : events.map(event => ({
      chordSymbol: event.chordSymbol, beat: event.beat, sustainAcrossBar: event.sustainAcrossBar,
      startTime: event.startTime, endTime: event.endTime, timingAdjusted: event.timingAdjusted,
    }));
  // Publication is the one boundary where roots are respelled for the key
  // selected by the administrator. The editable source chart stays untouched.
  const chords = timeline.map(event => spellChordInKey(event.chordSymbol, chart.key));
  const durations = timeline.map((event, index) => {
    const nextBeat = timeline[index + 1]?.beat ?? measure.beats + 1;
    const availableBeats = Math.max(.25, nextBeat - event.beat);
    const measuredBeats = chart.bpm && event.timingAdjusted && Number.isFinite(event.startTime) && Number.isFinite(event.endTime)
      ? Math.max(.25, ((event.endTime as number) - (event.startTime as number)) * chart.bpm / 60)
      : availableBeats;
    return Math.round(Math.min(availableBeats, measuredBeats) * 1000) / 1000;
  });
  const sustainAcrossBars = timeline.map(event => Boolean(event.sustainAcrossBar));
  const bar: StandardMeasure = chords.length === 1 && !sustainAcrossBars[0]
    ? chords[0]
    : { chords, durations, beats: measure.beats, ...(sustainAcrossBars.some(Boolean) ? { sustainAcrossBars } : {}) };
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
    style: chart.publishedStandard?.style?.trim() || "Song Analyzer transcription",
    timeSignature: [Number.isFinite(numerator) ? numerator : 4, Number.isFinite(denominator) ? denominator : 4],
    swingPercent: normalizeSwingPercent(chart.swingPercent),
    bars: bars.length ? bars : [chart.key],
    source: "manual-transcription",
    matchStatus: "manual",
    sourceTitle: chart.title.trim() || chart.publishedStandard?.sourceTitle?.trim() || "Untitled Gospel Standard",
    note: chart.publishedStandard?.note?.trim() || "Admin-reviewed chart published from the Faithful Keys Song Analyzer.",
  };
}
