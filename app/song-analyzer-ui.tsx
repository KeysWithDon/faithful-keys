"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canStartAnalysis, createPrivateReviewChart, filenameTitle, loadPrivateCharts, nashvilleNumber,
  normalizedChart, savePrivateCharts, transposeSongChart, type AnalysisJob, type ChordEvent,
  type Confidence, type SongChart, type SourceType,
} from "./song-analyzer";
import { currentSongUser, deleteCloudChart, dispatchCloudAnalysis, loadCloudCharts, queueCloudAnalysis, readCloudAnalysisJob, saveCloudChart, sendSongMagicLink, signOutSongUser, uploadPrivateAudio } from "./supabase-song-library";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client";

const KEYS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const confidenceLabel: Record<Confidence, string> = { high: "High confidence", medium: "Check", low: "Low confidence", uncertain: "Uncertain" };

function eventId() { return `chord-${Math.random().toString(36).slice(2, 10)}`; }
function isLow(confidence: Confidence) { return confidence === "low" || confidence === "uncertain"; }

export default function SongAnalyzer() {
  const [sourceType, setSourceType] = useState<SourceType>("upload");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
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
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudMessage, setCloudMessage] = useState("");
  const [pendingChartId, setPendingChartId] = useState<string | null>(null);
  const cloudEnabled = isSupabaseConfigured();

  useEffect(() => { setCharts(loadPrivateCharts(window.localStorage)); setLibraryReady(true); }, []);
  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    void currentSongUser().then(user => setCloudUserId(user?.id ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => setCloudUserId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!cloudUserId) return;
    void loadCloudCharts().then(cloudCharts => { if (cloudCharts.length) setCharts(cloudCharts); }).catch(error => setCloudMessage(error instanceof Error ? error.message : "Could not load your private cloud library."));
  }, [cloudUserId]);
  useEffect(() => {
    if (!libraryReady) return;
    savePrivateCharts(window.localStorage, charts);
    if (cloudUserId) void Promise.all(charts.map(saveCloudChart)).catch(error => setCloudMessage(error instanceof Error ? error.message : "Cloud sync paused."));
  }, [charts, libraryReady, cloudUserId]);
  useEffect(() => {
    if (!cloudUserId || !job.id || job.id === "new" || job.id === "review" || !["queued", "processing"].includes(job.status)) return;
    const interval = window.setInterval(() => {
      void readCloudAnalysisJob(job.id).then(next => {
        setJob(next);
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

  const check = canStartAnalysis(sourceType, permissionConfirmed, sourceType === "youtube" ? youtubeUrl : audioFile);
  const allEvents = useMemo(() => activeChart?.sections.flatMap((section, sectionIndex) => section.measures.flatMap((measure, measureIndex) => measure.chordEvents.map(event => ({ event, sectionIndex, measureIndex })))) ?? [], [activeChart]);
  const nowEvent = allEvents.filter(({ sectionIndex, measureIndex, event }) => sectionIndex === currentPosition.section && measureIndex === currentPosition.measure && event.beat <= currentPosition.beat).at(-1) ?? null;
  const nextEvent = allEvents.find(({ sectionIndex, measureIndex, event }) => sectionIndex > currentPosition.section || (sectionIndex === currentPosition.section && (measureIndex > currentPosition.measure || (measureIndex === currentPosition.measure && event.beat > currentPosition.beat))) ) ?? null;

  function updateChart(updater: (chart: SongChart) => SongChart) {
    if (!activeChartId) return;
    setCharts(current => current.map(chart => chart.id === activeChartId ? normalizedChart({ ...updater(chart), updatedAt: new Date().toISOString() }) : chart));
  }

  async function startReviewChart() {
    if (!check.allowed) { setJob({ id: "failed", sourceType, status: "failed", progress: 0, error: check.error, createdAt: new Date().toISOString() }); return; }
    const title = sourceType === "upload" && audioFile ? filenameTitle(audioFile.name) : "Untitled song";
    setJob({ id: "review", sourceType, status: "queued", progress: 15, createdAt: new Date().toISOString() });
    window.setTimeout(() => setJob({ id: "review", sourceType, status: "processing", progress: 55, createdAt: new Date().toISOString() }), 650);
    const chart = createPrivateReviewChart({ sourceType, title, sourceUrl: sourceType === "youtube" ? youtubeUrl : null });
    setCharts(current => [chart, ...current]); setCurrentPosition({ section: 0, measure: 0, beat: 1 });
    if (!cloudUserId) {
      window.setTimeout(() => {
        setJob({ id: "review", sourceType, status: "review", progress: 100, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() });
        setActiveChartId(chart.id);
      }, 900);
      return;
    }
    setPendingChartId(chart.id);
    try {
      await saveCloudChart(chart);
      const user = await currentSongUser();
      const sourceObjectKey = sourceType === "upload" && audioFile && user ? await uploadPrivateAudio(user, chart.id, audioFile) : undefined;
      const queued = await queueCloudAnalysis({ chartId: chart.id, sourceType, sourceObjectKey, sourceUrl: sourceType === "youtube" ? youtubeUrl : null });
      setJob(queued);
      const dispatched = await dispatchCloudAnalysis(queued.id);
      setJob(dispatched);
      if (dispatched.status === "review") { setActiveChartId(chart.id); setPendingChartId(null); }
      setCloudMessage(sourceType === "upload" ? "Secure analysis started. Keep this page open while your editable chart is prepared." : "The permitted link is saved as a private review chart. Upload audio you own to run recognition.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud analysis could not be queued.";
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

  function deleteChart(chartId: string) { if (cloudUserId) void deleteCloudChart(chartId).catch(error => setCloudMessage(error instanceof Error ? error.message : "Cloud deletion could not complete.")); setCharts(current => current.filter(chart => chart.id !== chartId)); if (activeChartId === chartId) setActiveChartId(null); }
  function duplicateChart(chart: SongChart) { const copy = { ...chart, id: `chart-${Math.random().toString(36).slice(2, 10)}`, title: `${chart.title} copy`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; setCharts(current => [copy, ...current]); }
  function exportChart(chart: SongChart) { const url = URL.createObjectURL(new Blob([JSON.stringify(chart, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${chart.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "faithful-keys-chart"}.json`; anchor.click(); URL.revokeObjectURL(url); }
  async function requestCloudSignIn() {
    if (!cloudEmail.trim()) { setCloudMessage("Enter an email address for your private library."); return; }
    try { await sendSongMagicLink(cloudEmail.trim()); setCloudMessage("Check your email for a secure sign-in link."); }
    catch (error) { setCloudMessage(error instanceof Error ? error.message : "Could not send the sign-in link."); }
  }

  if (activeChart) return <section className="song-analyzer analyzer-results" aria-label="Song Analyzer results">
    <div className="analyzer-titlebar"><div><span className="step">Song Analyzer · private review chart</span><input aria-label="Song title" className="song-title-input" value={activeChart.title} onChange={event => updateChart(chart => ({ ...chart, title: event.target.value }))}/><p>{cloudUserId ? "Private to your signed-in account. Source audio and stems are never shared." : "Only this browser can see this chart. Source audio and stems are never saved here."}</p></div><div className="analyzer-actions"><button onClick={() => setActiveChartId(null)}>My library</button><button className="primary compact" onClick={() => exportChart(activeChart)}>Export JSON</button></div></div>
    <div className="analyzer-meta"><label>KEY<select value={activeChart.key} onChange={event => updateChart(chart => ({ ...chart, key: event.target.value }))}>{KEYS.map(key => <option key={key}>{key}</option>)}</select></label><label>MODE<select value={activeChart.mode} onChange={event => updateChart(chart => ({ ...chart, mode: event.target.value as "major" | "minor" }))}><option value="major">Major</option><option value="minor">Minor</option></select></label><label>BPM<input aria-label="Song BPM" type="number" min="30" max="240" value={activeChart.bpm ?? ""} placeholder="Review" onChange={event => updateChart(chart => ({ ...chart, bpm: event.target.value ? Number(event.target.value) : null }))}/></label><label>METER<select value={activeChart.timeSignature} onChange={event => updateChart(chart => ({ ...chart, timeSignature: event.target.value }))}>{["2/4", "3/4", "4/4", "6/8"].map(meter => <option key={meter}>{meter}</option>)}</select></label><button onClick={() => updateChart(chart => transposeSongChart(chart, -1))}>− transpose</button><button onClick={() => updateChart(chart => transposeSongChart(chart, 1))}>+ transpose</button><label className="analyzer-toggle"><input type="checkbox" checked={showNumbers} onChange={event => setShowNumbers(event.target.checked)}/><span/> Nashville</label><label className="analyzer-toggle"><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)}/><span/> Review only</label></div>
    <div className="follow-along"><div className="current-chord"><span>NOW</span><strong>{nowEvent?.event.chordSymbol ?? "—"}</strong><small>{nowEvent?.event ? `Beat ${currentPosition.beat}` : "Add a chord to begin"}</small></div><div className="next-chord"><span>NEXT</span><strong>{nextEvent?.event.chordSymbol ?? "—"}</strong><small>{nextEvent ? activeChart.sections[nextEvent.sectionIndex]?.name : "End of chart"}</small></div><div className="follow-controls"><button className={following ? "playing" : ""} onClick={() => setFollowing(value => !value)}>{following ? "■ Stop" : "▶ Follow chart"}</button><select aria-label="Loop section" value={loopSection ?? ""} onChange={event => setLoopSection(event.target.value === "" ? null : Number(event.target.value))}><option value="">No loop</option>{activeChart.sections.map((section, index) => <option value={index} key={section.id}>Loop {section.name}</option>)}</select></div></div>
    <p className="analyzer-disclaimer">Recognition suggestions remain editable. Confirm the chords you trust and correct anything that does not match the recording.</p>
    <div className="chart-sections">{activeChart.sections.map((section, sectionIndex) => <section className="chart-section" key={section.id}><header><input aria-label={`Section ${sectionIndex + 1} name`} value={section.name} onChange={event => updateChart(chart => ({ ...chart, sections: chart.sections.map((item, index) => index === sectionIndex ? { ...item, name: event.target.value } : item) }))}/><span>{section.confidence === "uncertain" ? "Needs review" : confidenceLabel[section.confidence]}</span></header><div className="measure-grid">{section.measures.map((measure, measureIndex) => <div className={`measure ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex ? "current" : ""}`} key={measure.number}><small>BAR {measure.number}</small><div className="beats">{Array.from({ length: measure.beats }, (_, beatIndex) => { const beat = beatIndex + 1; const event = measure.chordEvents.find(item => item.beat === beat); if (!event) return <button className="empty-beat" key={beat} onClick={() => addChord(sectionIndex, measureIndex)} aria-label={`Add chord on bar ${measure.number}, beat ${beat}`}>{beat}</button>; if (reviewOnly && !isLow(event.confidence)) return <span className="beat-placeholder" key={beat}>{beat}</span>; return <label className={`chart-chord ${isLow(event.confidence) ? "low" : ""} ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex && currentPosition.beat === beat ? "playing" : ""}`} key={event.id}><span>{beat}</span><input aria-label={`Chord on bar ${measure.number}, beat ${beat}`} value={showNumbers ? event.nashvilleNumber : event.chordSymbol} onChange={input => updateEvent(sectionIndex, measureIndex, event.id, showNumbers ? { nashvilleNumber: input.target.value } : { chordSymbol: input.target.value, nashvilleNumber: nashvilleNumber(input.target.value, activeChart.key, activeChart.mode) })}/><button type="button" title={event.confirmed ? "Confirmed" : "Mark confirmed"} onClick={() => updateEvent(sectionIndex, measureIndex, event.id, { confirmed: !event.confirmed, confidence: event.confirmed ? "uncertain" : "high" })}>{event.confirmed ? "✓" : "?"}</button></label>; })}</div></div>)}</div></section>)}</div>
  </section>;

  return <section className="song-analyzer analyzer-entry" aria-label="Song Analyzer">
    <div className="analyzer-titlebar"><div><span className="step">Private song analyzer</span><h2>Bring your own chart to life.</h2><p>Analyze only music you own or are allowed to use. Your source media is never retained in Faithful Keys.</p></div><button onClick={() => setActiveChartId("library")}>My library · {charts.length}</button></div>
    {cloudEnabled && <div className="cloud-access">{cloudUserId ? <><span>PRIVATE CLOUD SYNC ON</span><b>Your charts are secured to your signed-in account.</b><button onClick={() => void signOutSongUser()}>Sign out</button></> : <><span>PRIVATE CLOUD SYNC</span><input aria-label="Email for private cloud library" type="email" value={cloudEmail} onChange={event => setCloudEmail(event.target.value)} placeholder="you@example.com"/><button onClick={() => void requestCloudSignIn()}>Email me a sign-in link</button></>}{cloudMessage && <small>{cloudMessage}</small>}</div>}
    {activeChartId === "library" && <div className="private-library"><div><b>Your private library</b><span>{cloudUserId ? "Private cloud sync is on for this account." : "Stored locally on this device only. Clearing browser data removes these charts."}</span></div>{charts.length ? charts.map(chart => <article key={chart.id}><button onClick={() => { setActiveChartId(chart.id); setCurrentPosition({ section: 0, measure: 0, beat: 1 }); }}><b>{chart.title}</b><small>{chart.key} {chart.mode} · {chart.sections.length} section{chart.sections.length === 1 ? "" : "s"}</small></button><div><button onClick={() => duplicateChart(chart)}>Duplicate</button><button onClick={() => exportChart(chart)}>Export</button><button className="danger" onClick={() => deleteChart(chart.id)}>Delete</button></div></article>) : <p>No saved charts yet.</p>}</div>}
    {(job.status === "queued" || job.status === "processing") && <div className="analyzer-processing" role="status" aria-live="polite"><div className="analyzer-processing-mark" aria-hidden="true">FK</div><div><span>{job.status === "queued" ? "Queued securely" : "Analyzing private audio"}</span><strong>{job.status === "queued" ? "Checking permissions…" : "Separating vocals, finding beats, and building an editable chart…"}</strong><p>{cloudUserId ? "Your private job is being processed by the secure analysis worker." : "Faithful Keys is not uploading, retaining, or sharing your source media in this local-only Pages experience."}</p><i><b style={{ width: `${job.progress}%` }}/></i></div><em>{job.progress}%</em></div>}
    <div className="analyzer-source-tabs"><button disabled={job.status === "queued" || job.status === "processing"} className={sourceType === "upload" ? "active" : ""} onClick={() => setSourceType("upload")}>Upload audio file</button><button disabled={job.status === "queued" || job.status === "processing"} className={sourceType === "youtube" ? "active" : ""} onClick={() => setSourceType("youtube")}>Paste YouTube link</button></div>
    <div className="analyzer-source-card">{sourceType === "upload" ? <label className="file-drop"><input type="file" accept="audio/mpeg,audio/wav,audio/x-m4a,audio/aac,audio/flac,audio/ogg,.mp3,.wav,.m4a,.aac,.flac,.ogg" onChange={event => setAudioFile(event.target.files?.[0] ?? null)}/><b>{audioFile ? audioFile.name : "Choose permitted audio"}</b><span>MP3, WAV, M4A, AAC, FLAC, or OGG · up to 100 MB</span></label> : <label className="youtube-input"><span>YOUTUBE LINK</span><input value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} placeholder="https://youtube.com/watch?v=…"/><small>The link is saved to your private chart. Faithful Keys does not retrieve audio from YouTube.</small></label>}<label className="permission-check"><input type="checkbox" checked={permissionConfirmed} onChange={event => setPermissionConfirmed(event.target.checked)}/><span>I own this audio or have permission to analyze it. I understand uploaded media and any temporary stems are not retained or shared.</span></label><div className="analyzer-progress"><span>{job.status === "idle" ? "READY" : job.status.toUpperCase()}</span><i><b style={{ width: `${job.progress}%` }}/></i><small>{job.error ?? (job.status === "review" ? "Private review chart created. Add your musician-approved changes." : cloudUserId ? "Sign in and upload audio you have rights to use for private recognition." : "Sign in to enable private cloud analysis.")}</small></div><button className="primary analyzer-start" disabled={!check.allowed || job.status === "queued" || job.status === "processing"} onClick={startReviewChart}>{sourceType === "youtube" ? "Save private review chart" : cloudUserId ? "Analyze private audio" : "Prepare private review chart"}</button>{!check.allowed && permissionConfirmed && <p className="analyzer-error">{check.error}</p>}</div>
  </section>;
}
