"use client";

import { useEffect, useMemo, useState } from "react";
import {
  analysisProgressPresentation, beatPositionLabel, canStartAnalysis, captureChartHarmony, chordEventAtSlot, loadPrivateCharts, moveChordEvent,
  nashvilleNumber, normalizeSwingPercent, normalizedChart, parseChordChartFile, parseChordChartText, pasteChordEvent, pasteSongSection,
  removeChordEvent, savePrivateCharts, transposeSongChart, type AnalysisJob, type ChartSlot, type ChordEvent, type Confidence, type SongChart,
  type SongSection, type SourceType,
} from "./song-analyzer";
import { ADMIN_SESSION_KEY, gospelStandardToSongChart, loadPublishedGospelStandards, publishGospelStandard, songChartToGospelStandard, unlockGospelAdmin, unpublishGospelStandard, validateGospelAdmin } from "./admin-gospel-standards";
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
type EditorSelection = ChartSlot & { eventId?: string };
type EditorClipboard = { event: ChordEvent; mode: "copy" | "cut" };
type SectionClipboard = { section: SongSection };

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
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null);
  const [editorClipboard, setEditorClipboard] = useState<EditorClipboard | null>(null);
  const [sectionClipboard, setSectionClipboard] = useState<SectionClipboard | null>(null);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ChartSlot | null>(null);
  const [editorNotice, setEditorNotice] = useState("Select a chord, then drag it or use Copy, Cut, and Paste.");
  const [reharmTurn, setReharmTurn] = useState(0);
  const [reharmPreview, setReharmPreview] = useState<ReharmPlan | null>(null);
  const [progressClock, setProgressClock] = useState(() => Date.now());
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
  useEffect(() => {
    if (!["queued", "processing"].includes(job.status)) return;
    const timer = window.setInterval(() => setProgressClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.status]);
  const activeChart = charts.find(chart => chart.id === activeChartId) ?? null;
  const progressView = analysisProgressPresentation(job, progressClock);
  const editingPublishedName = activeChart?.publishedStandard?.originalName ?? null;

  useEffect(() => {
    if (!following || !activeChart) return;
    const numerator = Number(activeChart.timeSignature.split("/")[0]) || 4;
    const interval = window.setInterval(() => setCurrentPosition(position => {
      const section = activeChart.sections[position.section];
      if (!section) return { section: 0, measure: 0, beat: 1 };
      if (position.beat < numerator + .5) return { ...position, beat: position.beat + .5 };
      if (position.measure < section.measures.length - 1) return { ...position, measure: position.measure + 1, beat: 1 };
      const nextSection = loopSection ?? (position.section < activeChart.sections.length - 1 ? position.section + 1 : 0);
      return { section: nextSection, measure: 0, beat: 1 };
    }), Math.max(90, 30000 / Math.max(10, activeChart.bpm ?? 72)));
    return () => window.clearInterval(interval);
  }, [activeChart, following, loopSection]);

  const mediaCheck = canStartAnalysis(sourceType, permissionConfirmed, sourceType === "youtube" ? youtubeUrl : audioFile);
  const selectedTempo = Number(referenceChart?.bpm);
  const tempoReady = Number.isFinite(selectedTempo) && selectedTempo >= 10 && selectedTempo <= 250;
  const selectedSwing = Number(referenceChart?.swingPercent);
  const swingReady = Number.isFinite(selectedSwing) && selectedSwing >= 50 && selectedSwing <= 75;
  const check = !referenceChart
    ? { allowed: false as const, error: "Upload or paste the chord chart first." }
    : !tempoReady
      ? { allowed: false as const, error: "Set the tempo between 10 and 250 BPM in Step 1." }
      : !swingReady
        ? { allowed: false as const, error: "Set swing between 50% and 75% in Step 1." }
      : mediaCheck;
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
      setCloudMessage(`Chart-first analysis started at the fixed ${chart.bpm} BPM. Audio is measuring pulse placement only; every chord remains exactly as written in the chart.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Private analysis could not be queued.";
      setCloudMessage(message);
      setPendingChartId(null);
      setJob({ id: "failed", sourceType, status: "failed", progress: 0, error: message, createdAt: new Date().toISOString() });
    }
  }

  function addChord(sectionIndex: number, measureIndex: number, beat: number) {
    const id = eventId();
    updateChart(chart => {
      const section = chart.sections[sectionIndex]; const measure = section.measures[measureIndex];
      const event: ChordEvent = { id, chordSymbol: "?", nashvilleNumber: "?", startTime: 0, endTime: 0, measureNumber: measure.number, beat, confidence: "uncertain", userEdited: true, confirmed: false };
      return { ...chart, sections: chart.sections.map((item, index) => index !== sectionIndex ? item : { ...item, measures: item.measures.map((itemMeasure, itemIndex) => itemIndex !== measureIndex ? itemMeasure : { ...itemMeasure, chordEvents: [...itemMeasure.chordEvents, event] }) }) };
    });
    setEditorSelection({ sectionIndex, measureIndex, beat, eventId: id });
    setEditorNotice("New chord selected. Type its symbol, or paste a copied chord here.");
  }

  function removeChord(sectionIndex: number, measureIndex: number, eventIdValue: string) {
    updateChart(chart => removeChordEvent(chart, eventIdValue));
    if (editorSelection?.eventId === eventIdValue) setEditorSelection({ sectionIndex, measureIndex, beat: editorSelection.beat });
    setEditorNotice("Chord removed. The beat is ready for another chord.");
  }

  function selectedEditorEvent() {
    if (!editorSelection) return null;
    return allEvents.find(({ event }) => event.id === editorSelection.eventId)?.event ?? null;
  }

  function copyEditorChord(mode: "copy" | "cut") {
    const selected = selectedEditorEvent();
    if (!selected) { setEditorNotice("Select a chord before copying or cutting."); return; }
    if (mode === "cut" && selected.locked) { setEditorNotice("Unlock this chord before cutting it."); return; }
    setEditorClipboard({ event: { ...selected }, mode });
    if (mode === "cut") {
      updateChart(chart => removeChordEvent(chart, selected.id));
      setEditorSelection(current => current ? { sectionIndex: current.sectionIndex, measureIndex: current.measureIndex, beat: current.beat } : null);
    }
    setEditorNotice(`${selected.chordSymbol} ${mode === "cut" ? "cut" : "copied"}. Choose a beat and paste.`);
  }

  function pasteEditorChord(target = editorSelection) {
    if (!target || !editorClipboard || !activeChart) { setEditorNotice("Copy or cut a chord, then choose its destination beat."); return; }
    const occupied = chordEventAtSlot(activeChart, target);
    if (occupied?.locked) { setEditorNotice("Unlock the destination chord before replacing it."); return; }
    const pastedId = editorClipboard.mode === "cut" ? editorClipboard.event.id : eventId();
    updateChart(chart => pasteChordEvent(chart, editorClipboard.event, target, pastedId));
    setEditorSelection({ ...target, eventId: pastedId });
    setEditorNotice(`${editorClipboard.event.chordSymbol} pasted at bar ${activeChart.sections[target.sectionIndex]?.measures[target.measureIndex]?.number ?? target.measureIndex + 1}, beat ${beatPositionLabel(target.beat)}.`);
    if (editorClipboard.mode === "cut") setEditorClipboard(null);
  }

  function moveEditorChord(eventIdValue: string, target: ChartSlot) {
    if (!activeChart) return;
    const source = allEvents.find(({ event }) => event.id === eventIdValue);
    const occupied = chordEventAtSlot(activeChart, target);
    if (!source || source.event.locked) { setEditorNotice("Unlock this chord before moving it."); return; }
    if (occupied?.locked) { setEditorNotice("Unlock the destination chord before moving here."); return; }
    updateChart(chart => moveChordEvent(chart, eventIdValue, target));
    setEditorSelection({ ...target, eventId: eventIdValue });
    setEditorNotice(occupied ? `${source.event.chordSymbol} moved and swapped with ${occupied.chordSymbol}.` : `${source.event.chordSymbol} moved to beat ${beatPositionLabel(target.beat)}.`);
  }

  function chooseEmptyBeat(target: ChartSlot) {
    setEditorSelection(target);
    if (editorClipboard) pasteEditorChord(target);
    else addChord(target.sectionIndex, target.measureIndex, target.beat);
  }

  function copyEditorSection(sectionIndex: number) {
    const section = activeChart?.sections[sectionIndex];
    if (!section) return;
    setSectionClipboard({ section });
    setEditorNotice(`${section.name} copied. Choose “Paste over section” on its destination.`);
  }

  function pasteEditorSection(sectionIndex: number) {
    if (!sectionClipboard) return;
    updateChart(chart => pasteSongSection(chart, sectionClipboard.section, sectionIndex, eventId()));
    setEditorSelection(null);
    setEditorNotice(`${sectionClipboard.section.name} pasted over section ${sectionIndex + 1}. All chord placements and hold settings were copied.`);
  }

  function toggleSelectedSustain() {
    const selected = selectedEditorEvent();
    const location = allEvents.find(({ event }) => event.id === selected?.id);
    if (!selected || !location) { setEditorNotice("Select the final chord of a bar to change its release."); return; }
    const measure = activeChart?.sections[location.sectionIndex]?.measures[location.measureIndex];
    const finalEvent = measure?.chordEvents.reduce<ChordEvent | null>((latest, event) => !latest || event.beat > latest.beat ? event : latest, null);
    if (finalEvent?.id !== selected.id) { setEditorNotice("Only the final chord in a bar can sustain across its bar line."); return; }
    if (selected.locked) { setEditorNotice("Unlock this chord before changing its release."); return; }
    const sustainAcrossBar = !selected.sustainAcrossBar;
    updateEvent(location.sectionIndex, location.measureIndex, selected.id, { sustainAcrossBar });
    setEditorNotice(`${selected.chordSymbol} will ${sustainAcrossBar ? "ring through" : "cut off at"} the next bar line.`);
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

  function openPublishedStandard(standard: StandardChart) {
    const editable = gospelStandardToSongChart(standard);
    setCharts(current => [editable, ...current.filter(chart => chart.id !== editable.id)]);
    setActiveChartId(editable.id);
    setCurrentPosition({ section: 0, measure: 0, beat: 1 });
    setEventDrafts({});
    setAnalyzerMode("analysis");
    setReharmPreview(null);
    setAdminMessage(`Opened ${standard.name}. Edit the chart, then save the Standard changes.`);
  }

  async function addToGospelStandards() {
    if (!activeChart || !adminToken) return;
    setPublishing(true);
    try {
      const originalName = activeChart.publishedStandard?.originalName;
      const published = await publishGospelStandard(adminToken, songChartToGospelStandard(activeChart), originalName);
      setPublishedStandards(current => [published, ...current.filter(standard => standard.name !== published.name && standard.name !== originalName)]);
      setCharts(current => current.map(chart => chart.id === activeChart.id ? {
        ...chart,
        publishedStandard: {
          originalName: published.name,
          style: published.style,
          sourceTitle: published.sourceTitle,
          ...(published.note ? { note: published.note } : {}),
        },
      } : chart));
      setAdminMessage(originalName ? `${published.name} was updated in Gospel Standards.` : `${activeChart.title} is now available in Gospel Standards.`);
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

  useEffect(() => {
    function handleEditorShortcut(event: KeyboardEvent) {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key === "c") { event.preventDefault(); copyEditorChord("copy"); }
      if (key === "x") { event.preventDefault(); copyEditorChord("cut"); }
      if (key === "v") { event.preventDefault(); pasteEditorChord(); }
    }
    window.addEventListener("keydown", handleEditorShortcut);
    return () => window.removeEventListener("keydown", handleEditorShortcut);
  }, [activeChart, editorSelection, editorClipboard]);

  useEffect(() => {
    setEditorSelection(null);
    setEditorClipboard(null);
    setDraggingEventId(null);
    setDropTarget(null);
  }, [activeChartId]);

  const selectedChord = selectedEditorEvent();
  const selectedChordLocation = allEvents.find(({ event }) => event.id === selectedChord?.id);
  const selectedChordMeasure = selectedChordLocation && activeChart?.sections[selectedChordLocation.sectionIndex]?.measures[selectedChordLocation.measureIndex];
  const selectedChordIsFinal = Boolean(selectedChord && selectedChordMeasure && selectedChordMeasure.chordEvents.every(event => event.id === selectedChord.id || event.beat <= selectedChord.beat));

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
    <div className="analyzer-titlebar"><div><span className="step">Song Analyzer · chart chords with performance timing</span><input aria-label="Song title" className="song-title-input" value={activeChart.title} onChange={event => updateChart(chart => ({ ...chart, title: event.target.value }))}/><p>The uploaded chart supplies every chord and the selected tempo. Media supplies rhythmic placement, then is deleted.</p></div><div className="analyzer-actions"><button onClick={() => setActiveChartId("library")}>My library</button><button onClick={() => prepareRerun(activeChart)}>Re-time corrected chart</button><button className="primary compact" onClick={() => exportChart(activeChart)}>Export JSON</button><button onClick={lockAdmin}>Lock admin</button></div></div>
    <div className="admin-publisher"><div><span>GOSPEL STANDARDS ADMIN</span><b>{editingPublishedName ? `Editing published Standard · ${editingPublishedName}` : "Review this chart, then publish it for every learner."} Written 7ths, 9ths, 11ths, 13ths, and slash basses are retained and sounded.</b></div><button className="primary" disabled={publishing} onClick={() => void addToGospelStandards()}>{publishing ? "Saving…" : editingPublishedName || publishedStandards.some(standard => standard.name === activeChart.title) ? "Save Standard changes" : "Add to Gospel Standards"}</button>{(editingPublishedName || publishedStandards.some(standard => standard.name === activeChart.title)) && <button className="danger" disabled={removingStandard === (editingPublishedName ?? activeChart.title)} onClick={() => void removeFromGospelStandards(editingPublishedName ?? activeChart.title)}>{removingStandard === (editingPublishedName ?? activeChart.title) ? "Removing…" : "Remove published song"}</button>}{adminMessage && <small>{adminMessage}</small>}</div>
    <div className="analyzer-mode-tabs" role="tablist" aria-label="Chord chart mode"><button role="tab" aria-selected={analyzerMode === "analysis"} className={analyzerMode === "analysis" ? "active" : ""} onClick={() => setAnalyzerMode("analysis")}>Timing analysis</button><button role="tab" aria-selected={analyzerMode === "reharmonize"} className={analyzerMode === "reharmonize" ? "active" : ""} onClick={() => setAnalyzerMode("reharmonize")}>Reharmonize</button></div>
    <div className="analyzer-meta"><label className="meta-wide">COMPOSER<input aria-label="Song composer" value={activeChart.artist ?? ""} onChange={event => updateChart(chart => ({ ...chart, artist: event.target.value || null }))}/></label>{editingPublishedName && <label className="meta-wide">STYLE<input aria-label="Standard style" value={activeChart.publishedStandard?.style ?? ""} onChange={event => updateChart(chart => ({ ...chart, publishedStandard: { ...(chart.publishedStandard ?? { originalName: editingPublishedName, sourceTitle: chart.title }), style: event.target.value } }))}/></label>}<label>KEY<select value={activeChart.key} onChange={event => updateChart(chart => ({ ...chart, key: event.target.value }))}>{KEYS.map(key => <option key={key}>{key}</option>)}</select></label><label>MODE<select value={activeChart.mode} onChange={event => updateChart(chart => ({ ...chart, mode: event.target.value as "major" | "minor" }))}><option value="major">Major</option><option value="minor">Minor</option></select></label><label>BPM<input aria-label="Song BPM" type="number" inputMode="numeric" min="10" max="250" value={activeChart.bpm ?? ""} placeholder="Review" onChange={event => updateChart(chart => ({ ...chart, bpm: event.target.value ? Number(event.target.value) : null }))}/></label><label>SWING<input aria-label="Song swing percentage" type="number" inputMode="numeric" min="50" max="75" value={normalizeSwingPercent(activeChart.swingPercent)} onChange={event => updateChart(chart => ({ ...chart, swingPercent: normalizeSwingPercent(event.target.value) }))}/></label><label>METER<select value={activeChart.timeSignature} onChange={event => updateChart(chart => ({ ...chart, timeSignature: event.target.value }))}>{["2/4", "3/4", "4/4", "6/8"].map(meter => <option key={meter}>{meter}</option>)}</select></label><button onClick={() => updateChart(chart => transposeSongChart(chart, -1))}>− transpose</button><button onClick={() => updateChart(chart => transposeSongChart(chart, 1))}>+ transpose</button><label className="analyzer-toggle"><input type="checkbox" checked={showNumbers} onChange={event => setShowNumbers(event.target.checked)}/><span/> Nashville</label><label className="analyzer-toggle"><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)}/><span/> Review only</label></div>
    <div className="follow-along"><div className="current-chord"><span>NOW</span><strong>{nowEvent?.event.chordSymbol ?? "—"}</strong><small>{nowEvent?.event ? `Beat ${beatPositionLabel(currentPosition.beat)}` : "Add a chord to begin"}</small></div><div className="next-chord"><span>NEXT</span><strong>{nextEvent?.event.chordSymbol ?? "—"}</strong><small>{nextEvent ? activeChart.sections[nextEvent.sectionIndex]?.name : "End of chart"}</small></div><div className="follow-controls"><button className={following ? "playing" : ""} onClick={() => setFollowing(value => !value)}>{following ? "■ Stop" : "▶ Follow chart"}</button><select aria-label="Loop section" value={loopSection ?? ""} onChange={event => setLoopSection(event.target.value === "" ? null : Number(event.target.value))}><option value="">No loop</option>{activeChart.sections.map((section, index) => <option value={index} key={section.id}>Loop {section.name}</option>)}</select></div></div>
    {analyzerMode === "analysis" ? <>
      <p className="analyzer-disclaimer">Every displayed chord comes only from the uploaded chart. Audio and video can set BPM, start times, and durations, but can never add, remove, extend, invert, respell, or replace a chord.</p>
      {reviewItems.length > 0 && <div className="analysis-review-panel"><b>Timing to review</b>{reviewItems.map(({ event }) => <article key={event.id}><strong>{event.chartChord ?? event.chordSymbol}</strong><p>{event.selectionReason ?? "Check this chord's rhythmic placement."}</p><small>{event.startTime.toFixed(2)}s–{event.endTime.toFixed(2)}s · chart chord unchanged</small></article>)}</div>}
    </> : <div className="reharm-workbench"><div><span>CREATIVE MODE</span><b>Reharmonization is intentionally separate from timing analysis.</b><p>Nothing from the uploaded performance enters this creative chart editor.</p></div><button onClick={generateAnalyzerReharm}>Generate creative idea</button>{reharmPreview && <><div className="reharm-preview">{reharmPreview.chords.map((chord, index) => <span className={index === reharmPreview.changedIndex ? "changed" : ""} key={`${chord}-${index}`}>{chord}</span>)}</div><button className="primary" onClick={applyAnalyzerReharm}>Apply to editable chart</button></>}</div>}
    <div className="chart-edit-toolbar" role="toolbar" aria-label="Chord placement tools">
      <div>
        <b>{selectedChord ? `${selectedChord.chordSymbol} selected` : editorClipboard ? `${editorClipboard.event.chordSymbol} ready to paste` : "Arrange chord placements"}</b>
        <span role="status" aria-live="polite">{editorNotice}</span>
      </div>
      <button disabled={!selectedChord} onClick={() => copyEditorChord("copy")} title="Copy selected chord (Ctrl/Cmd+C)">Copy</button>
      <button disabled={!selectedChord || selectedChord.locked} onClick={() => copyEditorChord("cut")} title="Cut selected chord (Ctrl/Cmd+X)">Cut</button>
      <button disabled={!editorClipboard || !editorSelection} onClick={() => pasteEditorChord()} title="Paste into the selected beat (Ctrl/Cmd+V)">Paste</button>
      <button disabled={!selectedChord || !selectedChordIsFinal || selectedChord.locked} className={selectedChord?.sustainAcrossBar ? "active" : ""} onClick={toggleSelectedSustain} title="Choose whether this final chord rings through the next bar line">{selectedChord?.sustainAcrossBar ? "Cut at bar" : "Hold over bar"}</button>
      <small>Drag a chord to any beat or “&”. Dropping onto another chord swaps them.</small>
    </div>
    <div className="chart-sections">
      {activeChart.sections.map((section, sectionIndex) => <section className="chart-section" key={section.id}>
        <header>
          <input aria-label={`Section ${sectionIndex + 1} name`} value={section.name} onChange={event => updateChart(chart => ({ ...chart, sections: chart.sections.map((item, index) => index === sectionIndex ? { ...item, name: event.target.value } : item) }))}/>
          <div className="section-edit-actions">
            <span>{section.confidence === "uncertain" ? "Needs review" : confidenceLabel[section.confidence]}</span>
            <button onClick={() => copyEditorSection(sectionIndex)}>Copy section</button>
            <button disabled={!sectionClipboard} onClick={() => pasteEditorSection(sectionIndex)}>{sectionClipboard ? `Paste ${sectionClipboard.section.name}` : "Paste over section"}</button>
          </div>
        </header>
        <div className="measure-grid">
          {section.measures.map((measure, measureIndex) => <div className={`measure ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex ? "current" : ""}`} key={measure.number}>
            <small>BAR {measure.number}</small>
            <div className="beats subdivided" style={{ gridTemplateColumns: `repeat(${measure.beats * 2}, minmax(0, 1fr))` }}>
              {Array.from({ length: measure.beats * 2 }, (_, slotIndex) => {
                const beat = slotIndex / 2 + 1;
                const label = beatPositionLabel(beat);
                const event = measure.chordEvents.find(item => item.beat === beat);
                const offbeat = !Number.isInteger(beat);
                const target = { sectionIndex, measureIndex, beat };
                const isDropTarget = dropTarget?.sectionIndex === sectionIndex && dropTarget.measureIndex === measureIndex && dropTarget.beat === beat;
                if (!event) return <button
                  className={`empty-beat ${offbeat ? "offbeat" : ""} ${isDropTarget ? "drop-target" : ""}`}
                  key={beat}
                  onClick={() => chooseEmptyBeat(target)}
                  onDragOver={dragEvent => { if (!draggingEventId) return; dragEvent.preventDefault(); dragEvent.dataTransfer.dropEffect = "move"; setDropTarget(target); }}
                  onDragLeave={() => setDropTarget(current => current?.sectionIndex === sectionIndex && current.measureIndex === measureIndex && current.beat === beat ? null : current)}
                  onDrop={dragEvent => { dragEvent.preventDefault(); const sourceId = draggingEventId ?? dragEvent.dataTransfer.getData("text/plain"); if (sourceId) moveEditorChord(sourceId, target); setDraggingEventId(null); setDropTarget(null); }}
                  aria-label={`${editorClipboard ? "Paste chord" : "Add chord"} on bar ${measure.number}, beat ${label}`}
                >{offbeat ? "&" : label}</button>;
                if (reviewOnly && !isLow(event.confidence)) return <span className={`beat-placeholder ${offbeat ? "offbeat" : ""}`} key={beat}>{label}</span>;
                return <label
                  className={`chart-chord ${offbeat ? "offbeat" : ""} ${isLow(event.confidence) ? "low" : ""} ${event.locked ? "locked" : ""} ${event.sustainAcrossBar ? "sustained" : ""} ${editorSelection?.eventId === event.id ? "selected" : ""} ${isDropTarget ? "drop-target" : ""} ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex && currentPosition.beat === beat ? "playing" : ""}`}
                  key={event.id}
                  draggable={!event.locked && !showNumbers}
                  onClick={() => setEditorSelection({ ...target, eventId: event.id })}
                  onDragStart={dragEvent => { setDraggingEventId(event.id); setEditorSelection({ ...target, eventId: event.id }); dragEvent.dataTransfer.effectAllowed = "move"; dragEvent.dataTransfer.setData("text/plain", event.id); }}
                  onDragEnd={() => { setDraggingEventId(null); setDropTarget(null); }}
                  onDragOver={dragEvent => { if (!draggingEventId || event.locked) return; dragEvent.preventDefault(); dragEvent.dataTransfer.dropEffect = "move"; setDropTarget(target); }}
                  onDragLeave={() => setDropTarget(current => current?.sectionIndex === sectionIndex && current.measureIndex === measureIndex && current.beat === beat ? null : current)}
                  onDrop={dragEvent => { dragEvent.preventDefault(); const sourceId = draggingEventId ?? dragEvent.dataTransfer.getData("text/plain"); if (sourceId) moveEditorChord(sourceId, target); setDraggingEventId(null); setDropTarget(null); }}
                  title={event.locked ? "Unlock to move this chord" : "Drag to move this chord"}
                >
                  <span>{label}</span>
                  <i className="chord-drag-handle" aria-hidden="true">⋮⋮</i>
                  {event.sustainAcrossBar && <em className="chord-hold" title="This chord rings through the next bar line">HOLD →</em>}
                  {event.review && <em className={`review-status status-${event.review.status.toLowerCase()}`} title={event.review.reason}>{event.review.status}</em>}
                  <input disabled={event.locked || showNumbers} aria-label={`Chord on bar ${measure.number}, beat ${label}`} value={showNumbers ? event.nashvilleNumber : eventDrafts[event.id] ?? event.chordSymbol} onChange={input => setEventDrafts(current => ({ ...current, [event.id]: input.target.value }))} onBlur={() => !showNumbers && commitChordCorrection(sectionIndex, measureIndex, event.id)} onKeyDown={input => { if (input.key === "Enter") input.currentTarget.blur(); }}/>
                  <button className="chord-remove" type="button" disabled={event.locked} title="Remove chord" aria-label={`Remove ${event.chordSymbol} from bar ${measure.number}`} onClick={() => removeChord(sectionIndex, measureIndex, event.id)}>×</button>
                  <button className="chord-lock" type="button" title={event.locked ? "Unlock chart chord" : "Lock chart chord for future analysis"} onClick={() => toggleChordLock(sectionIndex, measureIndex, event.id)}>{event.locked ? "🔒" : "🔓"}</button>
                </label>;
              })}
            </div>
          </div>)}
        </div>
      </section>)}
    </div>
  </section>;

  return <section className="song-analyzer analyzer-entry" aria-label="Song Analyzer">
    <div className="analyzer-titlebar"><div><span className="step">Administrator song analyzer</span><h2>Chart chords. Performance rhythm.</h2><p>Your chart supplies every chord. Set the tempo first; audio or video supplies only rhythmic placement.</p></div><div className="analyzer-actions"><button onClick={() => setActiveChartId("library")}>My library · {charts.length}</button><button onClick={lockAdmin}>Lock admin</button></div></div>
    {cloudEnabled && <div className={`cloud-access workspace-${workspaceStatus}`}><span>PRIVATE DEVICE WORKSPACE</span><b>{workspaceStatus === "ready" ? "Ready · no email or account setup required." : workspaceStatus === "starting" ? "Preparing secure analysis…" : "Workspace setup needs attention."}</b>{cloudMessage && <small>{cloudMessage}</small>}</div>}
    {activeChartId === "library" && <><div className="private-library"><div><b>Your private library</b><span>{cloudUserId ? "Secured to this browser's private device workspace." : "Stored locally on this device only. Clearing browser data removes these charts."}</span></div>{charts.length ? charts.map(chart => <article key={chart.id}><button onClick={() => { setActiveChartId(chart.id); setCurrentPosition({ section: 0, measure: 0, beat: 1 }); }}><b>{chart.title}</b><small>{chart.key} {chart.mode} · {chart.sections.length} section{chart.sections.length === 1 ? "" : "s"}</small></button><div><button onClick={() => duplicateChart(chart)}>Duplicate</button><button onClick={() => exportChart(chart)}>Export</button><button className="danger" onClick={() => deleteChart(chart.id)}>Delete</button></div></article>) : <p>No saved charts yet.</p>}</div><div className="private-library published-library"><div><b>Published Gospel Standards · {publishedStandards.length}</b><span>Open any live song in the full chart editor, then save its changes back to Standards.</span></div>{publishedStandards.length ? publishedStandards.map(standard => <article key={standard.name}><div className="published-song-name"><b>{standard.name}</b><small>{standard.key} · {standard.composer} · {standard.style}</small></div><div><button className="edit-standard" onClick={() => openPublishedStandard(standard)}>Open and edit</button><button className="danger" disabled={removingStandard === standard.name} onClick={() => void removeFromGospelStandards(standard.name)}>{removingStandard === standard.name ? "Removing…" : "Remove from standards"}</button></div></article>) : <p>No analyzer songs are published yet.</p>}</div></>}
    {(job.status === "queued" || job.status === "processing") && <div className="analyzer-processing" role="status" aria-live="polite"><div className="analyzer-processing-mark" aria-hidden="true">FK</div><div><span>{job.status === "queued" ? "Queued securely" : "Analysis in progress"}</span><strong>{progressView.stage}</strong><p>{progressView.detail} The chart remains unchanged while this runs.</p><i className="indeterminate"><b/></i></div><em>WORKING</em></div>}
    <div className="chart-first-flow">
      <section className={`analyzer-stage ${referenceChart && tempoReady && swingReady ? "complete" : "current"}`}><header><span>1</span><div><b>Upload the chord chart and set tempo</b><small>Harmony, section order, BPM, and swing become authoritative.</small></div>{referenceChart && <em>✓ {referenceChart.chartReference?.chordCount ?? 0} chords</em>}</header><div className="chart-import-grid"><label className="file-drop chart-drop"><input type="file" accept=".txt,.csv,.json,.cho,.pro,.chordpro,text/plain,text/csv,application/json" onChange={event => void importChartFile(event.target.files?.[0] ?? null)}/><b>{chartImporting ? "Reading chart…" : chartFile?.name ?? referenceChart?.chartReference?.fileName ?? "Choose chart file"}</b><span>Text, CSV, ChordPro, or exported Faithful Keys JSON</span></label><div className="chart-paste"><label>OR PASTE A CHART<textarea value={chartText} onChange={event => setChartText(event.target.value)} placeholder={'[Verse]\n| Cmaj7 | Am7 D7 | G7 | Cmaj7 |\n[Chorus]\n| Fmaj7 | G7 | Cmaj7 | Cmaj7 |'}/></label><button disabled={!chartText.trim()} onClick={importPastedChart}>Use pasted chart</button></div></div>{referenceChart && <><div className="chart-import-summary"><div><b>{referenceChart.title}</b><span>{referenceChart.sections.length} sections · {referenceChart.chartReference?.chordCount} chart chords · {referenceChart.key} {referenceChart.mode}</span><small>You may edit any OCR or transcription mistake after analysis, then lock the correction.</small></div></div><div className={`analysis-tempo-panel ${tempoReady && swingReady ? "valid" : "invalid"}`}><div><span>STEP 1 RHYTHM</span><b>Set tempo and swing</b><small>50% is straight. About 67% is triplet swing. Use up to 75% for a harder shuffle.</small></div><div className="analysis-rhythm-fields"><label className="analysis-tempo"><input aria-label="Tempo for analysis" type="number" inputMode="numeric" min="10" max="250" step="1" value={referenceChart.bpm ?? ""} placeholder="BPM" onChange={event => setReferenceChart(chart => chart ? { ...chart, bpm: event.target.value === "" ? null : Number(event.target.value) } : chart)}/><strong>BPM</strong><small>{tempoReady ? `${selectedTempo} BPM locked` : "Enter 10–250"}</small></label><label className="analysis-tempo"><input aria-label="Swing percentage for analysis" type="number" inputMode="numeric" min="50" max="75" step="1" value={referenceChart.swingPercent ?? 50} onChange={event => setReferenceChart(chart => chart ? { ...chart, swingPercent: Number(event.target.value) } : chart)}/><strong>%</strong><small>{swingReady ? `${selectedSwing}% swing locked` : "Enter 50–75"}</small></label></div></div></>}{chartImportError && <p className="analyzer-error">{chartImportError}</p>}</section>
      <section className={`analyzer-stage ${referenceChart && tempoReady && swingReady ? "current" : "disabled"}`} aria-disabled={!referenceChart || !tempoReady || !swingReady}><header><span>2</span><div><b>Add video or audio for rhythm</b><small>Faithful Keys locates beat and “&” placements while keeping Step 1 rhythm fixed.</small></div></header><div className="analyzer-source-tabs"><button disabled={!referenceChart || !tempoReady || !swingReady || job.status === "queued" || job.status === "processing"} className={sourceType === "upload" ? "active" : ""} onClick={() => setSourceType("upload")}>Upload video or audio</button><button disabled={!referenceChart || !tempoReady || !swingReady || job.status === "queued" || job.status === "processing"} className={sourceType === "youtube" ? "active" : ""} onClick={() => setSourceType("youtube")}>Paste YouTube link</button></div><div className="analyzer-source-card">{sourceType === "upload" ? <label className="file-drop"><input disabled={!referenceChart || !tempoReady || !swingReady} type="file" accept="audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4,.mov,.webm" onChange={event => setAudioFile(event.target.files?.[0] ?? null)}/><b>{audioFile ? audioFile.name : "Choose the performance"}</b><span>Audio or video · up to 100 MB</span></label> : <label className="youtube-input"><span>YOUTUBE PERFORMANCE LINK</span><input disabled={!referenceChart || !tempoReady || !swingReady} value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} placeholder="https://youtube.com/watch?v=…"/><small>The performance supplies rhythm only and is deleted after processing.</small></label>}<label className="permission-check"><input disabled={!referenceChart || !tempoReady || !swingReady} type="checkbox" checked={permissionConfirmed} onChange={event => setPermissionConfirmed(event.target.checked)}/><span>I own this media or have permission to analyze it. I understand source media is processed temporarily and is not retained or shared.</span></label><div className="analyzer-progress"><span>{job.status === "idle" ? referenceChart && tempoReady && swingReady ? "CHART + RHYTHM READY" : "STEP 1 REQUIRED" : progressView.stage.toUpperCase()}</span><i className={progressView.indeterminate ? "indeterminate" : ""}><b style={progressView.indeterminate ? undefined : { width: `${progressView.percent ?? 0}%` }}/></i><small>{job.error ?? (job.status === "queued" || job.status === "processing" ? progressView.detail : workspaceStatus === "ready" ? "Chart chords, tempo, and swing stay fixed; media supplies rhythmic placement only." : "Preparing your private device workspace…")}</small></div><button className="primary analyzer-start" disabled={!check.allowed || workspaceStatus === "starting" || job.status === "queued" || job.status === "processing"} onClick={startReviewChart}>Measure performance timing</button>{referenceChart && !check.allowed && <p className="analyzer-error">{check.error}</p>}</div></section>
    </div>
  </section>;
}
