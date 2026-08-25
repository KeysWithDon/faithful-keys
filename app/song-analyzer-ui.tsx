"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canStartAnalysis, captureChartHarmony, loadPrivateCharts, nashvilleNumber,
  normalizedChart, parseChordChartFile, parseChordChartText, savePrivateCharts, transposeSongChart, type AnalysisJob, type ChordEvent,
  type Confidence, type SongChart, type SourceType,
} from "./song-analyzer";
import { ADMIN_SESSION_KEY, loadPublishedGospelStandards, publishGospelStandard, songChartToGospelStandard, unlockGospelAdmin, unpublishGospelStandard, validateGospelAdmin } from "./admin-gospel-standards";
import type { StandardChart } from "./standards";
import { deleteCloudChart, dispatchCloudAnalysis, ensureSongWorkspace, loadCloudCharts, queueCloudAnalysis, readCloudAnalysisJob, saveCloudChart, uploadPrivateAudio } from "./supabase-song-library";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";
import { buildFunctionReharm, type ReharmPlan } from "./reharm";

const KEYS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const confidenceLabel: Record<Confidence, string> = { high: "High confidence", medium: "Check", low: "Low confidence", uncertain: "Uncertain" };

function eventId() { return `chord-${Math.random().toString(36).slice(2, 10)}`; }
function duplicateSongChart(chart: SongChart) {
  const now = new Date().toISOString();
  return { ...chart, id: `chart-${Math.random().toString(36).slice(2, 10)}`, title: `${chart.title} copy`, createdAt: now, updatedAt: now };
}
function isLow(confidence: Confidence) { return confidence === "low" || confidence === "uncertain"; }

export default function SongAnalyzer() {
  const [sourceType, setSourceType] = useState<SourceType>("upload");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [chartFile, setChartFile] = useState<File | null>(null);
  const [chartText, setChartText] = useState("");
  const [referenceChart, setReferenceChart] = useState<SongChart | null>(null);
  const [chartImportError, setChartImportError] = useState("");
  const [chartImporting, setChartImporting] = useState(false);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [job, setJob] = useState<AnalysisJob>({ id: "new", sourceType: "upload", status: "idle", progress: 0, createdAt: new Date().toISOString() });
  const [charts, setCharts] = useState<SongChart[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [activeChartId, setActiveChartId] = useState<string | null>(null);
  const [showNumbers, setShowNumbers] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [currentPosition, setCurrentPosition] = useState({ section: 0, measure: 0, beat: 1 });
  const [following, setFollowing] = useState(false);
  const [loopSection, setLoopSection] = useState<number | null>(null);
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<"starting" | "ready" | "failed">(() => isSupabaseConfigured() ? "starting" : "failed");
  const [cloudMessage, setCloudMessage] = useState("");
  const [pendingChartId, setPendingChartId] = useState<string | null>(null);
  const [adminCode, setAdminCode] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [adminStatus, setAdminStatus] = useState<"checking" | "locked" | "unlocked">("checking");
  const [adminMessage, setAdminMessage] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedStandards, setPublishedStandards] = useState<StandardChart[]>([]);
  const [removingStandard, setRemovingStandard] = useState<string | null>(null);
  const [analyzerMode, setAnalyzerMode] = useState<"analysis" | "reharmonize">("analysis");
  const [eventDrafts, setEventDrafts] = useState<Record<string, string>>({});
  const [reharmTurn, setReharmTurn] = useState(0);
  const [reharmPreview, setReharmPreview] = useState<ReharmPlan | null>(null);
  const cloudEnabled = isSupabaseConfigured();

  useEffect(() => {
    const savedAdminToken = window.sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!savedAdminToken) {
      const frame = window.requestAnimationFrame(() => setAdminStatus("locked"));
      return () => window.cancelAnimationFrame(frame);
    }
    let active = true;
    void validateGospelAdmin(savedAdminToken).then(() => {
      if (!active) return;
      setAdminToken(savedAdminToken);
      setAdminStatus("unlocked");
    }).catch(() => {
      window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      if (active) setAdminStatus("locked");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (adminStatus !== "unlocked") return;
    const frame = window.requestAnimationFrame(() => {
      setCharts(loadPrivateCharts(window.localStorage));
      setLibraryReady(true);
    });
    void loadPublishedGospelStandards().then(setPublishedStandards).catch(error => {
      setAdminMessage(error instanceof Error ? error.message : "Published songs could not be loaded.");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [adminStatus]);
  useEffect(() => {
    if (adminStatus !== "unlocked") return;
    const client = getSupabaseClient();
    if (!client) return;
    void ensureSongWorkspace().then(user => {
      setCloudUserId(user.id);
      setWorkspaceStatus("ready");
    }).catch(error => {
      setWorkspaceStatus("failed");
      setCloudMessage(error instanceof Error ? error.message : "The private device workspace could not be started.");
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setCloudUserId(session?.user.id ?? null);
      if (session?.user) setWorkspaceStatus("ready");
    });
    return () => data.subscription.unsubscribe();
  }, [adminStatus]);
  useEffect(() => {
    if (!cloudUserId) return;
    void loadCloudCharts().then(cloudCharts => { if (cloudCharts.length) setCharts(cloudCharts); }).catch(error => setCloudMessage(error instanceof Error ? error.message : "Could not load your private device library."));
  }, [cloudUserId]);
  useEffect(() => {
    if (!libraryReady) return;
    savePrivateCharts(window.localStorage, charts);
    if (cloudUserId) void Promise.all(charts.map(saveCloudChart)).catch(error => setCloudMessage(error instanceof Error ? error.message : "Private workspace sync paused."));
  }, [charts, libraryReady, cloudUserId]);
  useEffect(() => {
    if (!cloudUserId || !job.id || job.id === "new" || job.id === "review" || !["queued", "processing"].includes(job.status)) return;
    const interval = window.setInterval(() => {
      void readCloudAnalysisJob(job.id).then(next => {
        setJob(current => next.status === "processing" ? { ...next, progress: Math.min(92, Math.max(next.progress, current.progress + 2)) } : next);
        if (next.status === "completed") void loadCloudCharts().then(cloudCharts => {
          setCharts(cloudCharts);
          if (pendingChartId) setActiveChartId(pendingChartId);
          setPendingChartId(null);
        });
      }).catch(error => setCloudMessage(error instanceof Error ? error.message : "Could not refresh the secure job."));
    }, 2500);
    return () => window.clearInterval(interval);
  }, [cloudUserId, job.id, job.status, pendingChartId]);
  const activeChart = charts.find(chart => chart.id === activeChartId) ?? null;

  useEffect(() => {
    if (!following || !activeChart) return;
    const numerator = Number(activeChart.timeSignature.split("/")[0]) || 4;
    const interval = window.setInterval(() => setCurrentPosition(position => {
      const section = activeChart.sections[position.section];
      if (!section) return { section: 0, measure: 0, beat: 1 };
      if (position.beat < numerator) return { ...position, beat: position.beat + 1 };
      if (position.measure < section.measures.length - 1) return { ...position, measure: position.measure + 1, beat: 1 };
      const nextSection = loopSection ?? (position.section < activeChart.sections.length - 1 ? position.section + 1 : 0);
      return { section: nextSection, measure: 0, beat: 1 };
    }), Math.max(180, 60000 / Math.max(30, activeChart.bpm ?? 72)));
    return () => window.clearInterval(interval);
  }, [activeChart, following, loopSection]);

  const mediaCheck = canStartAnalysis(sourceType, permissionConfirmed, sourceType === "youtube" ? youtubeUrl : audioFile);
  const check = referenceChart ? mediaCheck : { allowed: false as const, error: "Upload or paste the chord chart first." };
  const allEvents = useMemo(() => activeChart?.sections.flatMap((section, sectionIndex) => section.measures.flatMap((measure, measureIndex) => measure.chordEvents.map(event => ({ event, sectionIndex, measureIndex })))) ?? [], [activeChart]);
  const nowEvent = allEvents.filter(({ sectionIndex, measureIndex, event }) => sectionIndex === currentPosition.section && measureIndex === currentPosition.measure && event.beat <= currentPosition.beat).at(-1) ?? null;
  const nextEvent = allEvents.find(({ sectionIndex, measureIndex, event }) => sectionIndex > currentPosition.section || (sectionIndex === currentPosition.section && (measureIndex > currentPosition.measure || (measureIndex === currentPosition.measure && event.beat > currentPosition.beat))) ) ?? null;
  const reviewItems = allEvents.filter(({ event }) => event.needsUserReview);

  function updateChart(updater: (chart: SongChart) => SongChart) {
    if (!activeChartId) return;
    setCharts(current => current.map(chart => chart.id === activeChartId ? normalizedChart({ ...updater(chart), updatedAt: new Date().toISOString() }) : chart));
  }

  async function importChartFile(file: File | null) {
    setChartFile(file);
    setChartImportError("");
    if (!file) { setReferenceChart(null); return; }
    setChartImporting(true);
    try {
      const parsed = await parseChordChartFile(file);
      setReferenceChart(parsed);
      setChartText("");
    } catch (error) {
      setReferenceChart(null);
      setChartImportError(error instanceof Error ? error.message : "That chord chart could not be read.");
    } finally { setChartImporting(false); }
  }

  function importPastedChart() {
    setChartImportError("");
    try {
      setReferenceChart(parseChordChartText(chartText, { title: "Imported song chart", fileName: "Pasted chord chart" }));
      setChartFile(null);
    } catch (error) {
      setReferenceChart(null);
      setChartImportError(error instanceof Error ? error.message : "That chord chart could not be read.");
    }
  }

  function prepareRerun(chart: SongChart) {
    setReferenceChart(normalizedChart({ ...chart, sourceUrl: null, updatedAt: new Date().toISOString() }));
    setActiveChartId(null);
    setAudioFile(null);
    setYoutubeUrl("");
    setPermissionConfirmed(false);
    setJob({ id: "new", sourceType: "upload", status: "idle", progress: 0, createdAt: new Date().toISOString() });
    setCloudMessage("Chart corrections and locks are ready. Add audio or video to measure the revised chart's rhythm.");
  }

  async function startReviewChart() {
    if (!check.allowed) { setJob({ id: "failed", sourceType, status: "failed", progress: 0, error: check.error, createdAt: new Date().toISOString() }); return; }
    if (!referenceChart) return;
    setJob({ id: "review", sourceType, status: "queued", progress: 15, createdAt: new Date().toISOString() });
    const chart = captureChartHarmony(normalizedChart({
      ...referenceChart, sourceType, sourceUrl: sourceType === "youtube" ? youtubeUrl.trim() : null,
      updatedAt: new Date().toISOString(),
    }));
    setCharts(current => [chart, ...current.filter(item => item.id !== chart.id)]); setCurrentPosition({ section: 0, measure: 0, beat: 1 });
    setPendingChartId(chart.id);
    try {
      const user = await ensureSongWorkspace();
      setCloudUserId(user.id);
      setWorkspaceStatus("ready");
      await saveCloudChart(chart);
      const sourceObjectKey = sourceType === "upload" && audioFile ? await uploadPrivateAudio(user, chart.id, audioFile) : undefined;
      const queued = await queueCloudAnalysis({ chartId: chart.id, sourceType, sourceObjectKey, sourceUrl: sourceType === "youtube" ? youtubeUrl.trim() : null });
      setJob(queued);
      const dispatched = await dispatchCloudAnalysis(queued.id);
      setJob(dispatched);
      if (dispatched.status === "review") { setActiveChartId(chart.id); setPendingChartId(null); }
      setCloudMessage("Chart-first analysis started. Audio is measuring tempo and timing only; every chord remains exactly as written in the chart.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Private analysis could not be queued.";
      setCloudMessage(message);
      setPendingChartId(null);
      setJob({ id: "failed", sourceType, status: "failed", progress: 0, error: message, createdAt: new Date().toISOString() });
    }
  }

  function addChord(sectionIndex: number, measureIndex: number) {
    updateChart(chart => {
      const section = chart.sections[sectionIndex]; const measure = section.measures[measureIndex];
      const beat = Math.min(measure.beats, Math.max(1, measure.chordEvents.length + 1));
      const event: ChordEvent = { id: eventId(), chordSymbol: "?", nashvilleNumber: "?", startTime: 0, endTime: 0, measureNumber: measure.number, beat, confidence: "uncertain", userEdited: true, confirmed: false };
      return { ...chart, sections: chart.sections.map((item, index) => index !== sectionIndex ? item : { ...item, measures: item.measures.map((itemMeasure, itemIndex) => itemIndex !== measureIndex ? itemMeasure : { ...itemMeasure, chordEvents: [...itemMeasure.chordEvents, event] }) }) };
    });
  }

  function updateEvent(sectionIndex: number, measureIndex: number, eventIdValue: string, patch: Partial<ChordEvent>) {
    updateChart(chart => ({ ...chart, sections: chart.sections.map((section, index) => index !== sectionIndex ? section : { ...section, measures: section.measures.map((measure, measureIndexValue) => measureIndexValue !== measureIndex ? measure : { ...measure, chordEvents: measure.chordEvents.map(event => event.id === eventIdValue ? { ...event, ...patch, userEdited: true } : event) }) }) }));
  }

  function commitChordCorrection(sectionIndex: number, measureIndex: number, eventIdValue: string) {
    const draft = eventDrafts[eventIdValue]?.trim();
    if (!draft) { setEventDrafts(current => { const next = { ...current }; delete next[eventIdValue]; return next; }); return; }
    updateChart(chart => {
      const section = chart.sections[sectionIndex];
      const event = section?.measures[measureIndex]?.chordEvents.find(item => item.id === eventIdValue);
      if (!event || draft === event.chordSymbol) return chart;
      const correction = {
        eventId: event.id,
        timestamp: event.startTime,
        section: section.name,
        measure: event.measureNumber,
        beat: event.beat,
        bassNote: event.bassNote ?? null,
        detectedNotes: [...(event.detectedNotes ?? [])],
        originalResult: event.review?.originalChord ?? event.originalChord ?? event.chordSymbol,
        aiRecommendation: event.review?.recommendedChord ?? null,
        finalCorrection: draft,
        chartChord: event.chartChord ?? event.chordSymbol,
        detectedVoicing: [...(event.detectedVoicing ?? [])],
        melodyNotes: [...(event.melodyNotes ?? [])],
        correctionType: "chord" as const,
        correctedAt: new Date().toISOString(),
      };
      return {
        ...chart,
        correctionHistory: [...(chart.correctionHistory ?? []), correction].slice(-500),
        sections: chart.sections.map((item, index) => index !== sectionIndex ? item : {
          ...item,
          measures: item.measures.map((measure, itemIndex) => itemIndex !== measureIndex ? measure : {
            ...measure,
            chordEvents: measure.chordEvents.map(chord => chord.id === eventIdValue ? {
              ...chord,
              chordSymbol: draft,
              chartChord: draft,
              nashvilleNumber: nashvilleNumber(draft, chart.key, chart.mode),
              userEdited: true,
              confirmed: true,
            } : chord),
          }),
        }),
      };
    });
    setEventDrafts(current => { const next = { ...current }; delete next[eventIdValue]; return next; });
  }

  function toggleChordLock(sectionIndex: number, measureIndex: number, eventIdValue: string) {
    updateChart(chart => {
      const section = chart.sections[sectionIndex];
      const event = section?.measures[measureIndex]?.chordEvents.find(item => item.id === eventIdValue);
      if (!event) return chart;
      const locked = !event.locked;
      const correction = {
        eventId: event.id, timestamp: event.startTime, section: section.name, measure: event.measureNumber, beat: event.beat,
        bassNote: event.bassNote ?? null, detectedNotes: [...(event.detectedNotes ?? [])], chartChord: event.chartChord ?? event.chordSymbol,
        detectedVoicing: [...(event.detectedVoicing ?? [])], melodyNotes: [...(event.melodyNotes ?? [])],
        originalResult: event.chartChord ?? event.chordSymbol, aiRecommendation: event.review?.recommendedChord ?? null,
        finalCorrection: locked ? "locked" : "unlocked", correctionType: "lock" as const, correctedAt: new Date().toISOString(),
      };
      return { ...chart, correctionHistory: [...chart.correctionHistory, correction].slice(-500), sections: chart.sections.map((item, index) => index !== sectionIndex ? item : {
        ...item, measures: item.measures.map((measure, indexValue) => indexValue !== measureIndex ? measure : {
          ...measure, chordEvents: measure.chordEvents.map(chord => chord.id === eventIdValue ? { ...chord, locked } : chord),
        }),
      }) };
    });
  }

  function generateAnalyzerReharm() {
    if (!activeChart || !allEvents.length) return;
    const source = allEvents.map(({ event }) => event.chordSymbol);
    const durations = allEvents.map(({ event }) => Math.max(1, event.endTime - event.startTime));
    setReharmPreview(buildFunctionReharm(source, durations, activeChart.key, reharmTurn, true));
    setReharmTurn(turn => turn + 1);
  }

  function applyAnalyzerReharm() {
    if (!reharmPreview) return;
    updateChart(chart => {
      let eventIndex = 0;
      return {
        ...chart,
        sections: chart.sections.map(section => ({ ...section, measures: section.measures.map(measure => ({
          ...measure,
          chordEvents: measure.chordEvents.map(event => {
            const chordSymbol = reharmPreview.chords[eventIndex++] ?? event.chordSymbol;
            return chordSymbol === event.chordSymbol ? event : {
              ...event, chordSymbol, chartChord: chordSymbol, nashvilleNumber: nashvilleNumber(chordSymbol, chart.key, chart.mode), userEdited: true,
            };
          }),
        })) })),
      };
    });
    setReharmPreview(null);
  }

  function deleteChart(chartId: string) { if (cloudUserId) void deleteCloudChart(chartId).catch(error => setCloudMessage(error instanceof Error ? error.message : "Private chart deletion could not complete.")); setCharts(current => current.filter(chart => chart.id !== chartId)); if (activeChartId === chartId) setActiveChartId(null); }
  function duplicateChart(chart: SongChart) { setCharts(current => [duplicateSongChart(chart), ...current]); }
  function exportChart(chart: SongChart) { const url = URL.createObjectURL(new Blob([JSON.stringify(chart, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${chart.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "faithful-keys-chart"}.json`; anchor.click(); URL.revokeObjectURL(url); }
  async function unlockAdmin() {
    if (!adminCode.trim()) { setAdminMessage("Enter the Faithful Keys admin code."); return; }
    try {
      const session = await unlockGospelAdmin(adminCode.trim());
      window.sessionStorage.setItem(ADMIN_SESSION_KEY, session.token);
      setAdminToken(session.token);
      setAdminStatus("unlocked");
      setAdminCode("");
      setAdminMessage("Administrator workspace unlocked for this browser session.");
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "Admin access could not be unlocked.");
    }
  }

  function lockAdmin() {
    window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setAdminToken("");
    setAdminStatus("locked");
    setActiveChartId(null);
    setFollowing(false);
    setAdminMessage("");
  }

  async function addToGospelStandards() {
    if (!activeChart || !adminToken) return;
    setPublishing(true);
    try {
      const published = await publishGospelStandard(adminToken, songChartToGospelStandard(activeChart));
      setPublishedStandards(current => [published, ...current.filter(standard => standard.name !== published.name)]);
      setAdminMessage(`${activeChart.title} is now available in Gospel Standards.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The chart could not be published.";
      if (/expired|access/i.test(message)) {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
        setAdminToken("");
        setAdminStatus("locked");
      }
      setAdminMessage(message);
    } finally {
      setPublishing(false);
    }
  }

  async function removeFromGospelStandards(name: string) {
    if (!adminToken || removingStandard) return;
    if (!window.confirm(`Remove “${name}” from Gospel Standards? Your private analyzer chart will remain available.`)) return;
    setRemovingStandard(name);
    try {
      await unpublishGospelStandard(adminToken, name);
      setPublishedStandards(current => current.filter(standard => standard.name !== name));
      setAdminMessage(`${name} was removed from Gospel Standards.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The published song could not be removed.";
      if (/expired|access/i.test(message)) {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
        setAdminToken("");
        setAdminStatus("locked");
      }
      setAdminMessage(message);
    } finally {
      setRemovingStandard(null);
    }
  }

  if (adminStatus !== "unlocked") return <section className="song-analyzer admin-login" aria-label="Faithful Keys administrator access">
    <div className="admin-login-card">
      <span className="step">PRIVATE ADMINISTRATION</span>
      <div className="brandmark" aria-hidden="true">FK</div>
      <h2>{adminStatus === "checking" ? "Checking access…" : "Administrator access"}</h2>
      <p>The Song Analyzer and Gospel Standards publishing tools are restricted to the Faithful Keys administrator.</p>
      {adminStatus === "locked" && <form onSubmit={event => { event.preventDefault(); void unlockAdmin(); }}>
        <label>ADMIN ACCESS CODE<input aria-label="Faithful Keys admin code" type="password" autoComplete="current-password" value={adminCode} onChange={event => setAdminCode(event.target.value)}/></label>
        <button className="primary" type="submit">Unlock administration</button>
      </form>}
      {adminMessage && <small role="status">{adminMessage}</small>}
    </div>
  </section>;

  if (activeChart) return <section className="song-analyzer analyzer-results" aria-label="Song Analyzer results">
    <div className="analyzer-titlebar"><div><span className="step">Song Analyzer · chart chords with performance timing</span><input aria-label="Song title" className="song-title-input" value={activeChart.title} onChange={event => updateChart(chart => ({ ...chart, title: event.target.value }))}/><p>The uploaded chart is the only harmonic source. Media supplies tempo and rhythmic timing, then is deleted.</p></div><div className="analyzer-actions"><button onClick={() => setActiveChartId(null)}>My library</button><button onClick={() => prepareRerun(activeChart)}>Re-time corrected chart</button><button className="primary compact" onClick={() => exportChart(activeChart)}>Export JSON</button><button onClick={lockAdmin}>Lock admin</button></div></div>
    <div className="admin-publisher"><div><span>GOSPEL STANDARDS ADMIN</span><b>Review this chart, then publish it for every learner. Written 7ths, 9ths, 11ths, and 13ths are retained and sounded.</b></div><button className="primary" disabled={publishing} onClick={() => void addToGospelStandards()}>{publishing ? "Publishing…" : publishedStandards.some(standard => standard.name === activeChart.title) ? "Update Gospel Standard" : "Add to Gospel Standards"}</button>{publishedStandards.some(standard => standard.name === activeChart.title) && <button className="danger" disabled={removingStandard === activeChart.title} onClick={() => void removeFromGospelStandards(activeChart.title)}>{removingStandard === activeChart.title ? "Removing…" : "Remove published song"}</button>}{adminMessage && <small>{adminMessage}</small>}</div>
    <div className="analyzer-mode-tabs" role="tablist" aria-label="Chord chart mode"><button role="tab" aria-selected={analyzerMode === "analysis"} className={analyzerMode === "analysis" ? "active" : ""} onClick={() => setAnalyzerMode("analysis")}>Timing analysis</button><button role="tab" aria-selected={analyzerMode === "reharmonize"} className={analyzerMode === "reharmonize" ? "active" : ""} onClick={() => setAnalyzerMode("reharmonize")}>Reharmonize</button></div>
    <div className="analyzer-meta"><label>KEY<select value={activeChart.key} onChange={event => updateChart(chart => ({ ...chart, key: event.target.value }))}>{KEYS.map(key => <option key={key}>{key}</option>)}</select></label><label>MODE<select value={activeChart.mode} onChange={event => updateChart(chart => ({ ...chart, mode: event.target.value as "major" | "minor" }))}><option value="major">Major</option><option value="minor">Minor</option></select></label><label>BPM<input aria-label="Song BPM" type="number" min="30" max="240" value={activeChart.bpm ?? ""} placeholder="Review" onChange={event => updateChart(chart => ({ ...chart, bpm: event.target.value ? Number(event.target.value) : null }))}/></label><label>METER<select value={activeChart.timeSignature} onChange={event => updateChart(chart => ({ ...chart, timeSignature: event.target.value }))}>{["2/4", "3/4", "4/4", "6/8"].map(meter => <option key={meter}>{meter}</option>)}</select></label><button onClick={() => updateChart(chart => transposeSongChart(chart, -1))}>− transpose</button><button onClick={() => updateChart(chart => transposeSongChart(chart, 1))}>+ transpose</button><label className="analyzer-toggle"><input type="checkbox" checked={showNumbers} onChange={event => setShowNumbers(event.target.checked)}/><span/> Nashville</label><label className="analyzer-toggle"><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)}/><span/> Review only</label></div>
    <div className="follow-along"><div className="current-chord"><span>NOW</span><strong>{nowEvent?.event.chordSymbol ?? "—"}</strong><small>{nowEvent?.event ? `Beat ${currentPosition.beat}` : "Add a chord to begin"}</small></div><div className="next-chord"><span>NEXT</span><strong>{nextEvent?.event.chordSymbol ?? "—"}</strong><small>{nextEvent ? activeChart.sections[nextEvent.sectionIndex]?.name : "End of chart"}</small></div><div className="follow-controls"><button className={following ? "playing" : ""} onClick={() => setFollowing(value => !value)}>{following ? "■ Stop" : "▶ Follow chart"}</button><select aria-label="Loop section" value={loopSection ?? ""} onChange={event => setLoopSection(event.target.value === "" ? null : Number(event.target.value))}><option value="">No loop</option>{activeChart.sections.map((section, index) => <option value={index} key={section.id}>Loop {section.name}</option>)}</select></div></div>
    {analyzerMode === "analysis" ? <>
      <p className="analyzer-disclaimer">Every displayed chord comes only from the uploaded chart. Audio and video can set BPM, start times, and durations, but can never add, remove, extend, invert, respell, or replace a chord.</p>
      {reviewItems.length > 0 && <div className="analysis-review-panel"><b>Timing to review</b>{reviewItems.map(({ event }) => <article key={event.id}><strong>{event.chartChord ?? event.chordSymbol}</strong><p>{event.selectionReason ?? "Check this chord's rhythmic placement."}</p><small>{event.startTime.toFixed(2)}s–{event.endTime.toFixed(2)}s · chart chord unchanged</small></article>)}</div>}
    </> : <div className="reharm-workbench"><div><span>CREATIVE MODE</span><b>Reharmonization is intentionally separate from timing analysis.</b><p>Nothing from the uploaded performance enters this creative chart editor.</p></div><button onClick={generateAnalyzerReharm}>Generate creative idea</button>{reharmPreview && <><div className="reharm-preview">{reharmPreview.chords.map((chord, index) => <span className={index === reharmPreview.changedIndex ? "changed" : ""} key={`${chord}-${index}`}>{chord}</span>)}</div><button className="primary" onClick={applyAnalyzerReharm}>Apply to editable chart</button></>}</div>}
    <div className="chart-sections">{activeChart.sections.map((section, sectionIndex) => <section className="chart-section" key={section.id}><header><input aria-label={`Section ${sectionIndex + 1} name`} value={section.name} onChange={event => updateChart(chart => ({ ...chart, sections: chart.sections.map((item, index) => index === sectionIndex ? { ...item, name: event.target.value } : item) }))}/><span>{section.confidence === "uncertain" ? "Needs review" : confidenceLabel[section.confidence]}</span></header><div className="measure-grid">{section.measures.map((measure, measureIndex) => <div className={`measure ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex ? "current" : ""}`} key={measure.number}><small>BAR {measure.number}</small><div className="beats">{Array.from({ length: measure.beats }, (_, beatIndex) => { const beat = beatIndex + 1; const event = measure.chordEvents.find(item => item.beat === beat); if (!event) return <button className="empty-beat" key={beat} onClick={() => addChord(sectionIndex, measureIndex)} aria-label={`Add chord on bar ${measure.number}, beat ${beat}`}>{beat}</button>; if (reviewOnly && !isLow(event.confidence)) return <span className="beat-placeholder" key={beat}>{beat}</span>; return <label className={`chart-chord ${isLow(event.confidence) ? "low" : ""} ${event.locked ? "locked" : ""} ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex && currentPosition.beat === beat ? "playing" : ""}`} key={event.id}><span>{beat}</span>{event.review && <em className={`review-status status-${event.review.status.toLowerCase()}`} title={event.review.reason}>{event.review.status}</em>}<input disabled={event.locked || showNumbers} aria-label={`Chord on bar ${measure.number}, beat ${beat}`} value={showNumbers ? event.nashvilleNumber : eventDrafts[event.id] ?? event.chordSymbol} onChange={input => setEventDrafts(current => ({ ...current, [event.id]: input.target.value }))} onBlur={() => !showNumbers && commitChordCorrection(sectionIndex, measureIndex, event.id)} onKeyDown={input => { if (input.key === "Enter") input.currentTarget.blur(); }}/><button type="button" title={event.locked ? "Unlock chart chord" : "Lock chart chord for future analysis"} onClick={() => toggleChordLock(sectionIndex, measureIndex, event.id)}>{event.locked ? "🔒" : "🔓"}</button></label>; })}</div></div>)}</div></section>)}</div>
  </section>;

  return <section className="song-analyzer analyzer-entry" aria-label="Song Analyzer">
    <div className="analyzer-titlebar"><div><span className="step">Administrator song analyzer</span><h2>Chart chords. Performance rhythm.</h2><p>Your chart supplies every chord. Audio or video supplies only tempo, starts, and durations.</p></div><div className="analyzer-actions"><button onClick={() => setActiveChartId("library")}>My library · {charts.length}</button><button onClick={lockAdmin}>Lock admin</button></div></div>
    {cloudEnabled && <div className={`cloud-access workspace-${workspaceStatus}`}><span>PRIVATE DEVICE WORKSPACE</span><b>{workspaceStatus === "ready" ? "Ready · no email or account setup required." : workspaceStatus === "starting" ? "Preparing secure analysis…" : "Workspace setup needs attention."}</b>{cloudMessage && <small>{cloudMessage}</small>}</div>}
    {activeChartId === "library" && <><div className="private-library"><div><b>Your private library</b><span>{cloudUserId ? "Secured to this browser's private device workspace." : "Stored locally on this device only. Clearing browser data removes these charts."}</span></div>{charts.length ? charts.map(chart => <article key={chart.id}><button onClick={() => { setActiveChartId(chart.id); setCurrentPosition({ section: 0, measure: 0, beat: 1 }); }}><b>{chart.title}</b><small>{chart.key} {chart.mode} · {chart.sections.length} section{chart.sections.length === 1 ? "" : "s"}</small></button><div><button onClick={() => duplicateChart(chart)}>Duplicate</button><button onClick={() => exportChart(chart)}>Export</button><button className="danger" onClick={() => deleteChart(chart.id)}>Delete</button></div></article>) : <p>No saved charts yet.</p>}</div><div className="private-library published-library"><div><b>Published Gospel Standards · {publishedStandards.length}</b><span>These songs are live for every learner. Removing one does not delete its private analyzer chart.</span></div>{publishedStandards.length ? publishedStandards.map(standard => <article key={standard.name}><div className="published-song-name"><b>{standard.name}</b><small>{standard.key} · {standard.composer}</small></div><div><button className="danger" disabled={removingStandard === standard.name} onClick={() => void removeFromGospelStandards(standard.name)}>{removingStandard === standard.name ? "Removing…" : "Remove from standards"}</button></div></article>) : <p>No analyzer songs are published yet.</p>}</div></>}
    {(job.status === "queued" || job.status === "processing") && <div className="analyzer-processing" role="status" aria-live="polite"><div className="analyzer-processing-mark" aria-hidden="true">FK</div><div><span>{job.status === "queued" ? "Queued securely" : "Measuring performance rhythm"}</span><strong>{job.status === "queued" ? "Checking the chart and permissions…" : "Detecting tempo, beats, starts, and durations…"}</strong><p>The worker uses no video-detected chord in the chart. Source media is deleted after timing analysis.</p><i><b style={{ width: `${job.progress}%` }}/></i></div><em>{job.progress}%</em></div>}
    <div className="chart-first-flow">
      <section className={`analyzer-stage ${referenceChart ? "complete" : "current"}`}><header><span>1</span><div><b>Upload the chord chart</b><small>Harmony and section order come from this chart.</small></div>{referenceChart && <em>✓ {referenceChart.chartReference?.chordCount ?? 0} chords</em>}</header><div className="chart-import-grid"><label className="file-drop chart-drop"><input type="file" accept=".txt,.csv,.json,.cho,.pro,.chordpro,text/plain,text/csv,application/json" onChange={event => void importChartFile(event.target.files?.[0] ?? null)}/><b>{chartImporting ? "Reading chart…" : chartFile?.name ?? referenceChart?.chartReference?.fileName ?? "Choose chart file"}</b><span>Text, CSV, ChordPro, or exported Faithful Keys JSON</span></label><div className="chart-paste"><label>OR PASTE A CHART<textarea value={chartText} onChange={event => setChartText(event.target.value)} placeholder={'[Verse]\n| Cmaj7 | Am7 D7 | G7 | Cmaj7 |\n[Chorus]\n| Fmaj7 | G7 | Cmaj7 | Cmaj7 |'}/></label><button disabled={!chartText.trim()} onClick={importPastedChart}>Use pasted chart</button></div></div>{referenceChart && <div className="chart-import-summary"><b>{referenceChart.title}</b><span>{referenceChart.sections.length} sections · {referenceChart.chartReference?.chordCount} chart chords · {referenceChart.key} {referenceChart.mode}</span><small>You may edit any OCR or transcription mistake after analysis, then lock the correction.</small></div>}{chartImportError && <p className="analyzer-error">{chartImportError}</p>}</section>
      <section className={`analyzer-stage ${referenceChart ? "current" : "disabled"}`} aria-disabled={!referenceChart}><header><span>2</span><div><b>Add video or audio for rhythm</b><small>Faithful Keys measures only tempo, chord starts, and durations.</small></div></header><div className="analyzer-source-tabs"><button disabled={!referenceChart || job.status === "queued" || job.status === "processing"} className={sourceType === "upload" ? "active" : ""} onClick={() => setSourceType("upload")}>Upload video or audio</button><button disabled={!referenceChart || job.status === "queued" || job.status === "processing"} className={sourceType === "youtube" ? "active" : ""} onClick={() => setSourceType("youtube")}>Paste YouTube link</button></div><div className="analyzer-source-card">{sourceType === "upload" ? <label className="file-drop"><input disabled={!referenceChart} type="file" accept="audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4,.mov,.webm" onChange={event => setAudioFile(event.target.files?.[0] ?? null)}/><b>{audioFile ? audioFile.name : "Choose the performance"}</b><span>Audio or video · up to 100 MB</span></label> : <label className="youtube-input"><span>YOUTUBE PERFORMANCE LINK</span><input disabled={!referenceChart} value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} placeholder="https://youtube.com/watch?v=…"/><small>The performance supplies rhythm only and is deleted after processing.</small></label>}<label className="permission-check"><input disabled={!referenceChart} type="checkbox" checked={permissionConfirmed} onChange={event => setPermissionConfirmed(event.target.checked)}/><span>I own this media or have permission to analyze it. I understand source media is processed temporarily and is not retained or shared.</span></label><div className="analyzer-progress"><span>{job.status === "idle" ? referenceChart ? "CHART READY" : "CHART REQUIRED" : job.status.toUpperCase()}</span><i><b style={{ width: `${job.progress}%` }}/></i><small>{job.error ?? (workspaceStatus === "ready" ? "All chords come from the chart; media is used only for rhythm." : "Preparing your private device workspace…")}</small></div><button className="primary analyzer-start" disabled={!check.allowed || workspaceStatus === "starting" || job.status === "queued" || job.status === "processing"} onClick={startReviewChart}>Measure performance timing</button>{referenceChart && !check.allowed && permissionConfirmed && <p className="analyzer-error">{check.error}</p>}</div></section>
    </div>
  </section>;
}
