import type { User } from "@supabase/supabase-js";
import { normalizedChart, type AnalysisJob, type SongChart, type SourceType } from "./song-analyzer";
import { getSupabaseClient } from "./supabase-client";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("The private device workspace is not configured for this deployment.");
  return client;
}

let workspacePromise: Promise<User> | null = null;

export async function currentSongUser(): Promise<User | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user;
}

/** Create one persistent, email-free workspace identity for this browser. */
export async function ensureSongWorkspace(): Promise<User> {
  if (workspacePromise) return workspacePromise;
  workspacePromise = (async () => {
    const existing = await currentSongUser();
    if (existing) return existing;
    const client = requireClient();
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    if (!data.user) throw new Error("The private device workspace could not be created.");
    return data.user;
  })();
  try {
    return await workspacePromise;
  } catch (error) {
    workspacePromise = null;
    throw error;
  }
}

export async function resetSongWorkspace() {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  workspacePromise = null;
}

export async function loadCloudCharts(): Promise<SongChart[]> {
  const client = requireClient();
  const { data, error } = await client.from("song_charts").select("chart").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => normalizedChart(row.chart as SongChart));
}

export async function saveCloudChart(chart: SongChart) {
  const client = requireClient();
  const clean = normalizedChart(chart);
  const { error } = await client.from("song_charts").upsert({
    id: clean.id, title: clean.title, source_type: clean.sourceType, source_url: clean.sourceUrl,
    chart: clean, updated_at: clean.updatedAt,
  });
  if (error) throw error;
}

export async function deleteCloudChart(chartId: string) {
  const client = requireClient();
  const { error } = await client.from("song_charts").delete().eq("id", chartId);
  if (error) throw error;
}

export async function uploadPrivateAudio(user: User, chartId: string, file: File) {
  const client = requireClient();
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const objectKey = `${user.id}/${chartId}/${crypto.randomUUID()}-${filename}`;
  const { error } = await client.storage.from("faithful-keys-sources").upload(objectKey, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return objectKey;
}

export async function queueCloudAnalysis(input: { chartId: string; sourceType: SourceType; sourceObjectKey?: string; sourceUrl?: string | null }): Promise<AnalysisJob> {
  const client = requireClient();
  const { data, error } = await client.from("analysis_jobs").insert({
    chart_id: input.chartId, source_type: input.sourceType, source_object_key: input.sourceObjectKey ?? null,
    source_url: input.sourceUrl ?? null, status: "queued", progress: 0,
  }).select("id, source_type, status, progress, error, created_at, completed_at").single();
  if (error) throw error;
  return jobFromRow(data);
}

type JobRow = {
  id: string; source_type: string; status: string; progress: number; error: string | null;
  created_at: string; completed_at: string | null;
};

function jobFromRow(data: JobRow): AnalysisJob {
  return {
    id: data.id, sourceType: data.source_type as SourceType, status: data.status as AnalysisJob["status"],
    progress: data.progress, error: data.error ?? undefined, createdAt: data.created_at,
    completedAt: data.completed_at ?? undefined,
  };
}

/** Dispatch through an Edge Function: the browser never receives worker credentials. */
export async function dispatchCloudAnalysis(jobId: string): Promise<AnalysisJob> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("queue-song-analysis", { body: { jobId } });
  if (error) throw error;
  if (!data?.job) throw new Error("The secure analysis service did not return a job status.");
  return jobFromRow(data.job as JobRow);
}

export async function readCloudAnalysisJob(jobId: string): Promise<AnalysisJob> {
  const client = requireClient();
  const { data, error } = await client.from("analysis_jobs")
    .select("id, source_type, status, progress, error, created_at, completed_at").eq("id", jobId).single();
  if (error) throw error;
  return jobFromRow(data as JobRow);
}
