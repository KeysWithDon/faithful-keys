"use client";

import { useEffect, useMemo, useState } from "react";
import {
  analysisProgressPresentation, appendSongMeasure, appendSongSection, beatPositionLabel, canStartAnalysis, captureChartHarmony, chordBankForKey, chordEventAtSlot, createManualSongChart, loadPrivateCharts, moveChordEvent,
  nashvilleNumber, normalizeSwingPercent, normalizedChart, parseChordChartFile, parseChordChartText, pasteChordEvent, pasteSongSection, reflowManualChart,
  pasteSongMeasure, removeChordEvent, removeSongMeasure, savePrivateCharts, transposeSongChart, type AnalysisJob, type ChartSlot, type ChordEvent, type Confidence,
  type Measure, type SongChart, type SongSection, type SourceType,
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
type MeasureSelection = { sectionIndex: number; measureIndex: number };
type MeasureClipboard = { measure: Measure };
type EntryWorkflow = "manual" | "analyze";
type ManualChartDraft = {
  title: string;
  artist: string;
  key: string;
  mode: "major" | "minor";
  bpm: number;
  swingPercent: number;
  timeSignature: string;
  sectionName: string;
  bars: number;
};

export default function SongAnalyzer() {
  const [entryWorkflow, setEntryWorkflow] = useState<EntryWorkflow>("manual");
  const [manualDraft, setManualDraft] = useState<ManualChartDraft>({
    title: "", artist: "", key: "C", mode: "major", bpm: 72, swingPercent: 50, timeSignature: "4/4", sectionName: "Verse", bars: 4,
  });
  const [sourceType, setSourceType] = useState<SourceType>("upload");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [chartFile, setChartFile] = useState<File | null>(null);
  const [chartText, setChartText] = useState("");
  const [referenceChart, setReferenceChart] = useState<SongChart | null>(null);
  const [chartImportError, setChartImportError] = useState("");
  const [chartImporting, setChartImporting] = useState(false);
  const [chartImportOpen, setChartImportOpen] = useState(false);
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
  const [cloudLibraryReady, setCloudLibraryReady] = useState(() => !isSupabaseConfigured());
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
  const [selectedSectionIndex, setSelectedSectionIndex] = useState<number | null>(null);
  const [selectedMeasure, setSelectedMeasure] = useState<MeasureSelection | null>(null);
  const [editorClipboard, setEditorClipboard] = useState<EditorClipboard | null>(null);
  const [sectionClipboard, setSectionClipboard] = useState<SectionClipboard | null>(null);
  const [measureClipboard, setMeasureClipboard] = useState<MeasureClipboard | null>(null);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [draggingBankChord, setDraggingBankChord] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ChartSlot | null>(null);
  const [guidedEntrySlot, setGuidedEntrySlot] = useState<ChartSlot | null>(null);
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
    if (!client) {
      setCloudLibraryReady(true);
      return;
    }
    setCloudLibraryReady(false);
    void ensureSongWorkspace().then(user => {
      setCloudUserId(user.id);
      setWorkspaceStatus("ready");
    }).catch(error => {
      setWorkspaceStatus("failed");
      setCloudLibraryReady(true);
      setCloudMessage(error instanceof Error ? error.message : "The private device workspace could not be started.");
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setCloudUserId(session?.user.id ?? null);
      if (session?.user) setWorkspaceStatus("ready");
      else setCloudLibraryReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, [adminStatus]);
  useEffect(() => {
    if (!cloudUserId) {
      if (workspaceStatus === "failed") setCloudLibraryReady(true);
      return;
    }
    let active = true;
    setCloudLibraryReady(false);
    void loadCloudCharts().then(cloudCharts => {
      if (active && cloudCharts.length) setCharts(cloudCharts);
    }).catch(error => {
      if (active) setCloudMessage(error instanceof Error ? error.message : "Could not load your private device library.");
    }).finally(() => {
      if (active) setCloudLibraryReady(true);
    });
    return () => { active = false; };
  }, [cloudUserId, workspaceStatus]);
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
  const chordBank = useMemo(() => activeChart ? chordBankForKey(activeChart.key, activeChart.mode) : [], [activeChart?.key, activeChart?.mode]);
  const manualBankTarget = activeChart?.manual ? (guidedEntrySlot ?? editorSelection) : null;
  const progressView = analysisProgressPresentation(job, progressClock);
  const editingPublishedName = activeChart?.publishedStandard?.originalName ?? null;

  useEffect(() => {
    if (adminStatus !== "unlocked" || !libraryReady || (cloudEnabled && !cloudLibraryReady) || activeChartId || referenceChart) return;
    const blankChart = createManualSongChart();
    setCharts(current => [blankChart, ...current]);
    setActiveChartId(blankChart.id);
    setCurrentPosition({ section: 0, measure: 0, beat: 1 });
    setSelectedSectionIndex(0);
    setEditorNotice("Your blank chart is ready. Select any beat or “&” to add a chord.");
  }, [activeChartId, adminStatus, cloudEnabled, cloudLibraryReady, libraryReady, referenceChart]);

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
    setCharts(current => current.map(chart => {
      if (chart.id !== activeChartId) return chart;
      const updated = { ...updater(chart), updatedAt: new Date().toISOString() };
      return normalizedChart(updated.manual ? reflowManualChart(updated) : updated);
    }));
  }

  async function importChartFile(file: File | null) {
    setChartFile(file);
    setChartImportError("");
    if (!file) return;
    setChartImporting(true);
    try {
      const parsed = await parseChordChartFile(file);
      openChartInEditor({ ...parsed, manual: true }, "Chart imported. Edit its exact chord spelling and rhythmic placements here; choose Re-time chart only if you want performance phrasing.");
      setChartText("");
    } catch (error) {
      setChartImportError(error instanceof Error ? error.message : "That chord chart could not be read.");
    } finally { setChartImporting(false); }
  }

  function importPastedChart() {
    setChartImportError("");
    try {
      openChartInEditor({ ...parseChordChartText(chartText, { title: "Imported song chart", fileName: "Pasted chord chart" }), manual: true }, "Pasted chart opened in the editor. Its written chords are preserved exactly as entered.");
      setChartFile(null);
    } catch (error) {
      setChartImportError(error instanceof Error ? error.message : "That chord chart could not be read.");
    }
  }

  function prepareRerun(chart: SongChart) {
    setReferenceChart(normalizedChart({ ...chart, sourceUrl: null, updatedAt: new Date().toISOString() }));
    setEntryWorkflow("analyze");
    setActiveChartId(null);
    setAudioFile(null);
    setYoutubeUrl("");
    setPermissionConfirmed(false);
    setJob({ id: "new", sourceType: "upload", status: "idle", progress: 0, createdAt: new Date().toISOString() });
    setCloudMessage("Chart corrections and locks are ready. Add audio or video to measure the revised chart's rhythm.");
  }

  function openChartInEditor(chart: SongChart, notice: string) {
    setCharts(current => [chart, ...current.filter(item => item.id !== chart.id)]);
    setActiveChartId(chart.id);
    setReferenceChart(null);
    setChartImportOpen(false);
    setCurrentPosition({ section: 0, measure: 0, beat: 1 });
    setEditorSelection(null);
    setSelectedSectionIndex(0);
    setSelectedMeasure(null);
    setEventDrafts({});
    setAnalyzerMode("analysis");
    setReharmPreview(null);
    setEditorNotice(notice);
  }

  function createCustomChart() {
    openChartInEditor(createManualSongChart({
      title: manualDraft.title,
      artist: manualDraft.artist || null,
      key: manualDraft.key,
      mode: manualDraft.mode,
      bpm: manualDraft.bpm,
      swingPercent: manualDraft.swingPercent,
      timeSignature: manualDraft.timeSignature,
      sectionName: manualDraft.sectionName,
      bars: manualDraft.bars,
    }), "Your blank chart is ready. Select any beat or “&” to add a chord.");
    setAdminMessage("Custom chart created. Add chords freely, then publish when the chart is complete.");
  }

  function createBlankChart() {
    openChartInEditor(createManualSongChart(), "Your blank chart is ready. Select any beat or “&” to add a chord.");
    setAdminMessage("Blank chart created. Add chords freely, then publish when the chart is complete.");
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
    setSelectedSectionIndex(sectionIndex);
    setSelectedMeasure(null);
    setEditorSelection({ sectionIndex, measureIndex, beat, eventId: id });
    setEditorNotice("New chord selected. Type its symbol, or paste a copied chord here.");
  }

  function nextOpenGuidedSlot(chart: SongChart, after?: ChartSlot | null): ChartSlot | null {
    const slots: ChartSlot[] = chart.sections.flatMap((section, sectionIndex) => section.measures.flatMap((measure, measureIndex) =>
      Array.from({ length: measure.beats * 2 }, (_, slotIndex) => ({ sectionIndex, measureIndex, beat: slotIndex / 2 + 1 })),
    ));
    const currentIndex = after ? slots.findIndex(slot => slot.sectionIndex === after.sectionIndex && slot.measureIndex === after.measureIndex && slot.beat === after.beat) : -1;
    return slots.slice(currentIndex + 1).find(slot => !chordEventAtSlot(chart, slot)) ?? null;
  }

  function focusGuidedSlot(target: ChartSlot | null) {
    setGuidedEntrySlot(target);
    setEditorSelection(target);
    setSelectedSectionIndex(target?.sectionIndex ?? null);
    setSelectedMeasure(null);
  }

  function startGuidedEntry() {
    if (!activeChart) return;
    const target = nextOpenGuidedSlot(activeChart);
    if (!target) { setEditorNotice("Every beat and “&” already has a chord. Remove a chord to enter it again."); return; }
    focusGuidedSlot(target);
    const measure = activeChart.sections[target.sectionIndex]?.measures[target.measureIndex];
    setEditorNotice(`Choose a chord or skip bar ${measure?.number ?? target.measureIndex + 1}, beat ${beatPositionLabel(target.beat)}.`);
  }

  function skipGuidedEntry() {
    if (!activeChart || !guidedEntrySlot) return;
    const target = nextOpenGuidedSlot(activeChart, guidedEntrySlot);
    if (!target) {
      focusGuidedSlot(null);
      setEditorNotice("Guided entry complete. You can still select any beat to edit it.");
      return;
    }
    focusGuidedSlot(target);
    const measure = activeChart.sections[target.sectionIndex]?.measures[target.measureIndex];
    setEditorNotice(`Skipped. Choose a chord or skip bar ${measure?.number ?? target.measureIndex + 1}, beat ${beatPositionLabel(target.beat)}.`);
  }

  function placeChordFromBank(chordSymbol: string, target = editorSelection) {
    if (!activeChart || !target) { setEditorNotice("Select a beat or start guided entry before choosing a chord."); return; }
    const existing = chordEventAtSlot(activeChart, target);
    if (existing?.locked) { setEditorNotice("Unlock this chord before replacing it."); return; }
    const id = existing?.id ?? eventId();
    const advancingGuide = guidedEntrySlot?.sectionIndex === target.sectionIndex
      && guidedEntrySlot.measureIndex === target.measureIndex && guidedEntrySlot.beat === target.beat;
    const next = advancingGuide ? nextOpenGuidedSlot(activeChart, target) : null;
    updateChart(chart => {
      const measure = chart.sections[target.sectionIndex]?.measures[target.measureIndex];
      if (!measure) return chart;
      const chord: ChordEvent = {
        id,
        chordSymbol,
        chartChord: chordSymbol,
        nashvilleNumber: nashvilleNumber(chordSymbol, chart.key, chart.mode),
        startTime: 0,
        endTime: 0,
        measureNumber: measure.number,
        beat: target.beat,
        confidence: "high",
        userEdited: true,
        confirmed: true,
        locked: false,
      };
      return {
        ...chart,
        sections: chart.sections.map((section, sectionIndex) => sectionIndex !== target.sectionIndex ? section : {
          ...section,
          measures: section.measures.map((item, measureIndex) => measureIndex !== target.measureIndex ? item : {
            ...item,
            chordEvents: existing ? item.chordEvents.map(event => event.id === id ? { ...event, ...chord } : event) : [...item.chordEvents, chord],
          }),
        }),
      };
    });
    setEventDrafts(current => { const nextDrafts = { ...current }; delete nextDrafts[id]; return nextDrafts; });
    if (next) {
      focusGuidedSlot(next);
      const measure = activeChart.sections[next.sectionIndex]?.measures[next.measureIndex];
      setEditorNotice(`${chordSymbol} added. Choose a chord or skip bar ${measure?.number ?? next.measureIndex + 1}, beat ${beatPositionLabel(next.beat)}.`);
    } else if (advancingGuide) {
      focusGuidedSlot(null);
      setEditorNotice(`${chordSymbol} added. Guided entry complete.`);
    } else {
      setSelectedSectionIndex(target.sectionIndex);
      setSelectedMeasure(null);
      setEditorSelection({ ...target, eventId: id });
      setEditorNotice(`${chordSymbol} placed at beat ${beatPositionLabel(target.beat)}. Its duration will fill to the next chord or bar boundary.`);
    }
  }

  function addEditorBar(sectionIndex: number) {
    updateChart(chart => appendSongMeasure(chart, sectionIndex));
    setSelectedSectionIndex(sectionIndex);
    setSelectedMeasure(null);
    setEditorSelection(null);
    setEditorNotice("A blank bar was added. Select any beat or “&” to enter a chord.");
  }

  function removeEditorBar(sectionIndex: number, measureIndex: number) {
    const section = activeChart?.sections[sectionIndex];
    const measure = section?.measures[measureIndex];
    if (!section || !measure) return;
    if (section.measures.length <= 1) {
      setEditorNotice("Each section keeps at least one bar. Add another section if you need a different form.");
      return;
    }
    if (measure.chordEvents.some(event => event.locked)) {
      setEditorNotice("Unlock the chords in this bar before removing it.");
      return;
    }
    if (measure.chordEvents.length && !window.confirm(`Remove bar ${measure.number} and its ${measure.chordEvents.length} chord${measure.chordEvents.length === 1 ? "" : "s"}?`)) return;
    updateChart(chart => removeSongMeasure(chart, sectionIndex, measureIndex));
    setSelectedSectionIndex(sectionIndex);
    setSelectedMeasure(null);
    setEditorSelection(null);
    setEditorNotice("Bar removed.");
  }

  function addEditorSection() {
    updateChart(chart => appendSongSection(chart, "New section", 4));
    const nextIndex = activeChart?.sections.length ?? 0;
    setSelectedSectionIndex(nextIndex);
    setSelectedMeasure(null);
    setEditorSelection(null);
    setEditorNotice("A new four-bar section was added. Rename it and build its progression.");
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
    setSelectedSectionIndex(target.sectionIndex);
    setSelectedMeasure(null);
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
    setSelectedSectionIndex(target.sectionIndex);
    setSelectedMeasure(null);
    setEditorSelection({ ...target, eventId: eventIdValue });
    setEditorNotice(occupied ? `${source.event.chordSymbol} moved and swapped with ${occupied.chordSymbol}.` : `${source.event.chordSymbol} moved to beat ${beatPositionLabel(target.beat)}.`);
  }

  function chooseEmptyBeat(target: ChartSlot) {
    setGuidedEntrySlot(null);
    setSelectedSectionIndex(target.sectionIndex);
    setSelectedMeasure(null);
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
    setSelectedSectionIndex(sectionIndex);
    setSelectedMeasure(null);
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

  function selectEditorChord(target: ChartSlot, eventIdValue: string) {
    const deselecting = editorSelection?.eventId === eventIdValue;
    setGuidedEntrySlot(null);
    setSelectedSectionIndex(deselecting ? null : target.sectionIndex);
    setSelectedMeasure(null);
    setEditorSelection(deselecting ? null : { ...target, eventId: eventIdValue });
    setEditorNotice("Use the selected beat tools below this section, or press Escape when finished.");
  }

  function selectEditorSection(sectionIndex: number) {
    setGuidedEntrySlot(null);
    setEditorSelection(null);
    setSelectedMeasure(null);
    setSelectedSectionIndex(current => current === sectionIndex ? null : sectionIndex);
    setEditorNotice("Section tools are available only for this section.");
  }

  function clearEditorSelection() {
    setGuidedEntrySlot(null);
    setEditorSelection(null);
    setSelectedSectionIndex(null);
    setSelectedMeasure(null);
    setEditorNotice("Select a chord or section to show its editing tools.");
  }

  function selectEditorMeasure(sectionIndex: number, measureIndex: number) {
    const deselecting = selectedMeasure?.sectionIndex === sectionIndex && selectedMeasure.measureIndex === measureIndex;
    setGuidedEntrySlot(null);
    setEditorSelection(null);
    setSelectedSectionIndex(deselecting ? null : sectionIndex);
    setSelectedMeasure(deselecting ? null : { sectionIndex, measureIndex });
    setEditorNotice(deselecting ? "Measure tools closed." : "This entire bar is selected. Copy it, or paste another copied bar over it.");
  }

  function copyEditorMeasure(sectionIndex: number, measureIndex: number) {
    const measure = activeChart?.sections[sectionIndex]?.measures[measureIndex];
    if (!measure) return;
    setMeasureClipboard({ measure });
    setEditorNotice(`Bar ${measure.number} copied with all chord placements and sustain choices.`);
  }

  function pasteEditorMeasure(sectionIndex: number, measureIndex: number) {
    if (!measureClipboard) return;
    const destination = activeChart?.sections[sectionIndex]?.measures[measureIndex];
    if (destination?.chordEvents.some(event => event.locked)) {
      setEditorNotice("Unlock every chord in this bar before replacing the whole measure.");
      return;
    }
    updateChart(chart => pasteSongMeasure(chart, measureClipboard.measure, sectionIndex, measureIndex, eventId()));
    setSelectedSectionIndex(sectionIndex);
    setSelectedMeasure({ sectionIndex, measureIndex });
    setEditorSelection(null);
    setEditorNotice(`Copied bar pasted over bar ${destination?.number ?? measureIndex + 1}.`);
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
    if (!activeChart.sections.some(section => section.measures.some(measure => measure.chordEvents.some(event => event.chordSymbol && event.chordSymbol !== "?")))) {
      setAdminMessage("Add at least one chord before publishing this chart to Gospel Standards.");
      return;
    }
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
      if (event.key === "Escape") {
        event.preventDefault();
        clearEditorSelection();
        return;
      }
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key === "c" && selectedMeasure) {
        event.preventDefault();
        copyEditorMeasure(selectedMeasure.sectionIndex, selectedMeasure.measureIndex);
      } else if (key === "v" && selectedMeasure) {
        event.preventDefault();
        pasteEditorMeasure(selectedMeasure.sectionIndex, selectedMeasure.measureIndex);
      } else if (key === "c") { event.preventDefault(); copyEditorChord("copy"); }
      if (key === "x") { event.preventDefault(); copyEditorChord("cut"); }
      if (key === "v" && !selectedMeasure) { event.preventDefault(); pasteEditorChord(); }
    }
    window.addEventListener("keydown", handleEditorShortcut);
    return () => window.removeEventListener("keydown", handleEditorShortcut);
  }, [activeChart, editorSelection, editorClipboard, selectedMeasure, measureClipboard]);

  useEffect(() => {
    setEditorSelection(null);
    setSelectedSectionIndex(null);
    setSelectedMeasure(null);
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
    <div className="analyzer-titlebar"><div><span className="step">{activeChart.manual ? "Custom chart builder" : "Song Analyzer · chart chords with performance timing"}</span><input aria-label="Song title" className="song-title-input" value={activeChart.title} onChange={event => updateChart(chart => ({ ...chart, title: event.target.value }))}/><p>{activeChart.manual ? "Build the harmony yourself: add bars, choose any beat or “&”, and enter the chord exactly as you want it written." : "The uploaded chart supplies every chord and the selected tempo. Media supplies rhythmic placement, then is deleted."}</p></div><div className="analyzer-actions"><button onClick={createBlankChart}>New chart</button><button onClick={() => { setChartImportError(""); setChartImportOpen(open => !open); }}>Import chart</button><button onClick={() => setActiveChartId("library")}>My library</button><button onClick={() => prepareRerun(activeChart)}>Re-time chart</button><button className="primary compact" onClick={() => exportChart(activeChart)}>Export JSON</button><button onClick={lockAdmin}>Lock admin</button></div></div>
    {chartImportOpen && <section className="editor-import-chart" aria-label="Import a chord chart into the editor"><div><span>IMPORT CHART</span><b>Open a chart directly in the editor.</b><small>Text, CSV, ChordPro, selectable-text PDF, or exported Faithful Keys JSON. The chart's written chord spelling remains intact.</small></div><label className="file-drop editor-chart-drop"><input type="file" accept=".txt,.csv,.json,.cho,.pro,.chordpro,.pdf,text/plain,text/csv,application/json,application/pdf" onChange={event => void importChartFile(event.target.files?.[0] ?? null)}/><b>{chartImporting ? "Reading chart…" : chartFile?.name ?? "Choose chart file"}</b><span>Choose PDF, text, CSV, ChordPro, or JSON</span></label><div className="chart-paste"><label>OR PASTE A CHART<textarea value={chartText} onChange={event => setChartText(event.target.value)} placeholder={'[Verse]\n| Cmaj7 | Am7 D7 | G7 | Cmaj7 |\n[Chorus]\n| Fmaj7 | G7 | Cmaj7 | Cmaj7 |'}/></label><button disabled={!chartText.trim() || chartImporting} onClick={importPastedChart}>Open pasted chart</button></div><button className="quiet" onClick={() => setChartImportOpen(false)}>Close</button>{chartImportError && <p className="analyzer-error">{chartImportError}</p>}</section>}
    <div className="admin-publisher"><div><span>GOSPEL STANDARDS ADMIN</span><b>{editingPublishedName ? `Editing published Standard · ${editingPublishedName}` : "Review this chart, then publish it for every learner."} Written 7ths, 9ths, 11ths, 13ths, and slash basses are retained and sounded.</b></div><button className="primary" disabled={publishing} onClick={() => void addToGospelStandards()}>{publishing ? "Saving…" : editingPublishedName || publishedStandards.some(standard => standard.name === activeChart.title) ? "Save Standard changes" : "Add to Gospel Standards"}</button>{(editingPublishedName || publishedStandards.some(standard => standard.name === activeChart.title)) && <button className="danger" disabled={removingStandard === (editingPublishedName ?? activeChart.title)} onClick={() => void removeFromGospelStandards(editingPublishedName ?? activeChart.title)}>{removingStandard === (editingPublishedName ?? activeChart.title) ? "Removing…" : "Remove published song"}</button>}{adminMessage && <small>{adminMessage}</small>}</div>
    <div className="analyzer-mode-tabs" role="tablist" aria-label="Chord chart mode"><button role="tab" aria-selected={analyzerMode === "analysis"} className={analyzerMode === "analysis" ? "active" : ""} onClick={() => setAnalyzerMode("analysis")}>Timing analysis</button><button role="tab" aria-selected={analyzerMode === "reharmonize"} className={analyzerMode === "reharmonize" ? "active" : ""} onClick={() => setAnalyzerMode("reharmonize")}>Reharmonize</button></div>
    <div className="analyzer-meta"><label className="meta-wide">COMPOSER<input aria-label="Song composer" value={activeChart.artist ?? ""} onChange={event => updateChart(chart => ({ ...chart, artist: event.target.value || null }))}/></label>{editingPublishedName && <label className="meta-wide">STYLE<input aria-label="Standard style" value={activeChart.publishedStandard?.style ?? ""} onChange={event => updateChart(chart => ({ ...chart, publishedStandard: { ...(chart.publishedStandard ?? { originalName: editingPublishedName, sourceTitle: chart.title }), style: event.target.value } }))}/></label>}<label>KEY<select value={activeChart.key} onChange={event => updateChart(chart => ({ ...chart, key: event.target.value }))}>{KEYS.map(key => <option key={key}>{key}</option>)}</select></label><label>MODE<select value={activeChart.mode} onChange={event => updateChart(chart => ({ ...chart, mode: event.target.value as "major" | "minor" }))}><option value="major">Major</option><option value="minor">Minor</option></select></label><label>BPM<input aria-label="Song BPM" type="number" inputMode="numeric" min="10" max="250" value={activeChart.bpm ?? ""} placeholder="Review" onChange={event => updateChart(chart => ({ ...chart, bpm: event.target.value ? Number(event.target.value) : null }))}/></label><label>SWING<input aria-label="Song swing percentage" type="number" inputMode="numeric" min="50" max="75" value={normalizeSwingPercent(activeChart.swingPercent)} onChange={event => updateChart(chart => ({ ...chart, swingPercent: normalizeSwingPercent(event.target.value) }))}/></label><label>METER<select value={activeChart.timeSignature} onChange={event => updateChart(chart => ({ ...chart, timeSignature: event.target.value }))}>{["2/4", "3/4", "4/4", "6/8"].map(meter => <option key={meter}>{meter}</option>)}</select></label><button onClick={() => updateChart(chart => transposeSongChart(chart, -1))}>− transpose</button><button onClick={() => updateChart(chart => transposeSongChart(chart, 1))}>+ transpose</button><label className="analyzer-toggle"><input type="checkbox" checked={showNumbers} onChange={event => setShowNumbers(event.target.checked)}/><span/> Nashville</label><label className="analyzer-toggle"><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)}/><span/> Review only</label></div>
    <div className="follow-along"><div className="current-chord"><span>NOW</span><strong>{nowEvent?.event.chordSymbol ?? "—"}</strong><small>{nowEvent?.event ? `Beat ${beatPositionLabel(currentPosition.beat)}` : "Add a chord to begin"}</small></div><div className="next-chord"><span>NEXT</span><strong>{nextEvent?.event.chordSymbol ?? "—"}</strong><small>{nextEvent ? activeChart.sections[nextEvent.sectionIndex]?.name : "End of chart"}</small></div><div className="follow-controls"><button className={following ? "playing" : ""} onClick={() => setFollowing(value => !value)}>{following ? "■ Stop" : "▶ Follow chart"}</button><select aria-label="Loop section" value={loopSection ?? ""} onChange={event => setLoopSection(event.target.value === "" ? null : Number(event.target.value))}><option value="">No loop</option>{activeChart.sections.map((section, index) => <option value={index} key={section.id}>Loop {section.name}</option>)}</select></div></div>
    {analyzerMode === "analysis" ? <>
      <p className="analyzer-disclaimer">{activeChart.manual ? "This is a hand-authored chart. Your written chord symbols are the source of truth; add media only when you want its timing and phrasing measured." : "Every displayed chord comes only from the uploaded chart. Audio and video can set BPM, start times, and durations, but can never add, remove, extend, invert, respell, or replace a chord."}</p>
      {reviewItems.length > 0 && <div className="analysis-review-panel"><b>Timing to review</b>{reviewItems.map(({ event }) => <article key={event.id}><strong>{event.chartChord ?? event.chordSymbol}</strong><p>{event.selectionReason ?? "Check this chord's rhythmic placement."}</p><small>{event.startTime.toFixed(2)}s–{event.endTime.toFixed(2)}s · chart chord unchanged</small></article>)}</div>}
    </> : <div className="reharm-workbench"><div><span>CREATIVE MODE</span><b>Reharmonization is intentionally separate from timing analysis.</b><p>Nothing from the uploaded performance enters this creative chart editor.</p></div><button onClick={generateAnalyzerReharm}>Generate creative idea</button>{reharmPreview && <><div className="reharm-preview">{reharmPreview.chords.map((chord, index) => <span className={index === reharmPreview.changedIndex ? "changed" : ""} key={`${chord}-${index}`}>{chord}</span>)}</div><button className="primary" onClick={applyAnalyzerReharm}>Apply to editable chart</button></>}</div>}
    {!editorSelection && editorClipboard && <div className="editor-clipboard-hint" role="status"><b>{editorClipboard.event.chordSymbol} ready to paste</b><span>Select an empty beat to paste it there, or select a chord to replace.</span></div>}
    {!editorSelection && measureClipboard && <div className="editor-clipboard-hint" role="status"><b>Bar {measureClipboard.measure.number} ready to paste</b><span>Select another bar heading, then choose Paste bar or press Ctrl/Cmd+V.</span></div>}
    {activeChart.manual && <><div className="manual-chart-actions"><div><span>CUSTOM CHART</span><b>Build a form that serves the song.</b><small>Add sections and bars, then use the chord bank or type directly into any beat or “&” position.</small></div><div><button onClick={startGuidedEntry}>Guided entry</button><button onClick={addEditorSection}>+ Add section</button></div></div>
      {guidedEntrySlot && <div className="guided-chart-entry" role="status" aria-live="polite"><div><span>GUIDED ENTRY</span><b>Bar {activeChart.sections[guidedEntrySlot.sectionIndex]?.measures[guidedEntrySlot.measureIndex]?.number ?? guidedEntrySlot.measureIndex + 1} · beat {beatPositionLabel(guidedEntrySlot.beat)}</b><small>Choose a chord from the bank, or skip this attack point.</small></div><button onClick={skipGuidedEntry}>Skip this beat</button><button className="quiet" onClick={() => { focusGuidedSlot(null); setEditorNotice("Guided entry stopped. Select any beat to keep editing."); }}>Stop guide</button></div>}
      <div className={`manual-chord-bank ${manualBankTarget ? "ready" : ""}`} aria-label="Chord bank">
        <div className="manual-chord-bank-heading"><div><span>CHORD BANK · {activeChart.key} {activeChart.mode}</span><b>{manualBankTarget ? `Place on bar ${activeChart.sections[manualBankTarget.sectionIndex]?.measures[manualBankTarget.measureIndex]?.number ?? manualBankTarget.measureIndex + 1}, beat ${beatPositionLabel(manualBankTarget.beat)}` : "Select a beat or start guided entry"}</b></div><small>Click or drag a chord to a beat. One on-beat chord fills the bar; two on-beat chords share it evenly.</small></div>
        {(["Core", "Color"] as const).map(group => <div className="manual-chord-bank-group" key={group}><span>{group}</span><div>{chordBank.filter(choice => choice.group === group).map(choice => <button key={`${choice.roman}-${choice.chord}`} disabled={!manualBankTarget} draggable={Boolean(manualBankTarget)} onClick={() => placeChordFromBank(choice.chord)} onDragStart={event => { setDraggingBankChord(choice.chord); event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-faithful-keys-chord", choice.chord); }} onDragEnd={() => { setDraggingBankChord(null); setDropTarget(null); }}><small>{choice.roman}</small><b>{choice.chord}</b></button>)}</div></div>)}
      </div>
    </>}
    <div className="chart-sections">
      {activeChart.sections.map((section, sectionIndex) => <section className={`chart-section ${selectedSectionIndex === sectionIndex ? "selected-section" : ""}`} key={section.id}>
        <header onClick={() => selectEditorSection(sectionIndex)} title="Select this section to show section tools">
          <input aria-label={`Section ${sectionIndex + 1} name`} value={section.name} onClick={event => event.stopPropagation()} onFocus={() => { setSelectedSectionIndex(sectionIndex); setEditorSelection(null); }} onChange={event => updateChart(chart => ({ ...chart, sections: chart.sections.map((item, index) => index === sectionIndex ? { ...item, name: event.target.value } : item) }))}/>
          <div className="section-edit-actions">
            <span>{section.confidence === "uncertain" ? "Needs review" : confidenceLabel[section.confidence]}</span>
            {selectedSectionIndex === sectionIndex && !editorSelection && !selectedMeasure && <>
              {activeChart.manual && <button onClick={event => { event.stopPropagation(); addEditorBar(sectionIndex); }}>+ Add bar</button>}
              <button onClick={event => { event.stopPropagation(); copyEditorSection(sectionIndex); }}>Copy section</button>
              <button disabled={!sectionClipboard} onClick={event => { event.stopPropagation(); pasteEditorSection(sectionIndex); }}>{sectionClipboard ? `Paste ${sectionClipboard.section.name}` : "Paste over section"}</button>
              <button onClick={event => { event.stopPropagation(); clearEditorSelection(); }}>Done</button>
            </>}
          </div>
        </header>
        {editorSelection?.sectionIndex === sectionIndex && <div className="chart-edit-toolbar" role="toolbar" aria-label={`Bar ${section.measures[editorSelection.measureIndex]?.number ?? editorSelection.measureIndex + 1}, beat ${beatPositionLabel(editorSelection.beat)} tools`}>
          <div>
            <b>{selectedChord ? `${selectedChord.chordSymbol} · bar ${selectedChord.measureNumber}, beat ${beatPositionLabel(selectedChord.beat)}` : `Empty beat · bar ${section.measures[editorSelection.measureIndex]?.number ?? editorSelection.measureIndex + 1}, beat ${beatPositionLabel(editorSelection.beat)}`}</b>
            <span role="status" aria-live="polite">{editorNotice}</span>
          </div>
          <button disabled={!selectedChord} onClick={() => copyEditorChord("copy")} title="Copy selected chord (Ctrl/Cmd+C)">Copy</button>
          <button disabled={!selectedChord || selectedChord.locked} onClick={() => copyEditorChord("cut")} title="Cut selected chord (Ctrl/Cmd+X)">Cut</button>
          <button disabled={!editorClipboard} onClick={() => pasteEditorChord()} title="Paste into the selected beat (Ctrl/Cmd+V)">Paste</button>
          <button disabled={!selectedChord || !selectedChordIsFinal || selectedChord.locked} className={selectedChord?.sustainAcrossBar ? "active" : ""} onClick={toggleSelectedSustain} title="Choose whether this final chord rings through the next bar line">{selectedChord?.sustainAcrossBar ? "Cut at bar" : "Hold over bar"}</button>
          {selectedChord && selectedChordLocation && <button onClick={() => toggleChordLock(selectedChordLocation.sectionIndex, selectedChordLocation.measureIndex, selectedChord.id)}>{selectedChord.locked ? "Unlock" : "Lock"}</button>}
          {selectedChord && selectedChordLocation && <button className="danger" disabled={selectedChord.locked} onClick={() => removeChord(selectedChordLocation.sectionIndex, selectedChordLocation.measureIndex, selectedChord.id)}>Delete</button>}
          <button className="quiet" onClick={clearEditorSelection}>Done</button>
        </div>}
        <div className="measure-grid">
          {section.measures.map((measure, measureIndex) => <div className={`measure ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex ? "current" : ""} ${selectedMeasure?.sectionIndex === sectionIndex && selectedMeasure.measureIndex === measureIndex ? "selected-measure" : ""}`} key={measure.number}>
            <div className="measure-heading" onClick={() => selectEditorMeasure(sectionIndex, measureIndex)} title="Select this whole measure"><small>BAR {measure.number} · SELECT BAR</small><b>{measure.chordEvents.length ? [...measure.chordEvents].sort((a, b) => a.beat - b.beat).map(event => eventDrafts[event.id]?.trim() || event.chordSymbol).join(" · ") : "No chords"}</b></div>
            {selectedMeasure?.sectionIndex === sectionIndex && selectedMeasure.measureIndex === measureIndex && <div className="measure-edit-toolbar" role="toolbar" aria-label={`Bar ${measure.number} tools`}>
              <button onClick={() => copyEditorMeasure(sectionIndex, measureIndex)}>Copy bar</button>
              <button disabled={!measureClipboard} onClick={() => pasteEditorMeasure(sectionIndex, measureIndex)}>{measureClipboard ? `Paste bar ${measureClipboard.measure.number}` : "Paste bar"}</button>
              {activeChart.manual && <button className="danger" disabled={section.measures.length <= 1 || measure.chordEvents.some(event => event.locked)} title={measure.chordEvents.some(event => event.locked) ? "Unlock this bar's chords before removing it" : measure.chordEvents.length ? "Remove this bar and its chords" : "Remove empty bar"} onClick={() => removeEditorBar(sectionIndex, measureIndex)}>Remove bar</button>}
              <button onClick={clearEditorSelection}>Done</button>
            </div>}
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
                  onDragOver={dragEvent => { if (!draggingEventId && !draggingBankChord) return; dragEvent.preventDefault(); dragEvent.dataTransfer.dropEffect = draggingBankChord ? "copy" : "move"; setDropTarget(target); }}
                  onDragLeave={() => setDropTarget(current => current?.sectionIndex === sectionIndex && current.measureIndex === measureIndex && current.beat === beat ? null : current)}
                  onDrop={dragEvent => { dragEvent.preventDefault(); const bankChord = draggingBankChord ?? dragEvent.dataTransfer.getData("application/x-faithful-keys-chord"); const sourceId = draggingEventId ?? dragEvent.dataTransfer.getData("text/plain"); if (bankChord) placeChordFromBank(bankChord, target); else if (sourceId) moveEditorChord(sourceId, target); setDraggingEventId(null); setDraggingBankChord(null); setDropTarget(null); }}
                  aria-label={`${editorClipboard ? "Paste chord" : "Add chord"} on bar ${measure.number}, beat ${label}`}
                >{offbeat ? "&" : label}</button>;
                if (reviewOnly && !isLow(event.confidence)) return <span className={`beat-placeholder ${offbeat ? "offbeat" : ""}`} key={beat}>{label}</span>;
                return <label
                  className={`chart-chord ${offbeat ? "offbeat" : ""} ${isLow(event.confidence) ? "low" : ""} ${event.locked ? "locked" : ""} ${event.sustainAcrossBar ? "sustained" : ""} ${editorSelection?.eventId === event.id ? "selected" : ""} ${isDropTarget ? "drop-target" : ""} ${currentPosition.section === sectionIndex && currentPosition.measure === measureIndex && currentPosition.beat === beat ? "playing" : ""}`}
                  key={event.id}
                  draggable={!event.locked && !showNumbers}
                  onClick={() => selectEditorChord(target, event.id)}
                  onDragStart={dragEvent => { setDraggingBankChord(null); setDraggingEventId(event.id); setSelectedSectionIndex(sectionIndex); setSelectedMeasure(null); setEditorSelection({ ...target, eventId: event.id }); dragEvent.dataTransfer.effectAllowed = "move"; dragEvent.dataTransfer.setData("text/plain", event.id); }}
                  onDragEnd={() => { setDraggingEventId(null); setDraggingBankChord(null); setDropTarget(null); }}
                  onDragOver={dragEvent => { if ((!draggingEventId && !draggingBankChord) || event.locked) return; dragEvent.preventDefault(); dragEvent.dataTransfer.dropEffect = draggingBankChord ? "copy" : "move"; setDropTarget(target); }}
                  onDragLeave={() => setDropTarget(current => current?.sectionIndex === sectionIndex && current.measureIndex === measureIndex && current.beat === beat ? null : current)}
                  onDrop={dragEvent => { dragEvent.preventDefault(); const bankChord = draggingBankChord ?? dragEvent.dataTransfer.getData("application/x-faithful-keys-chord"); const sourceId = draggingEventId ?? dragEvent.dataTransfer.getData("text/plain"); if (bankChord) placeChordFromBank(bankChord, target); else if (sourceId) moveEditorChord(sourceId, target); setDraggingEventId(null); setDraggingBankChord(null); setDropTarget(null); }}
                  title={event.locked ? "Unlock to move this chord" : "Drag to move this chord"}
                >
                  <span>{label}</span>
                  <i className="chord-drag-handle" aria-hidden="true">⋮⋮</i>
                  {event.sustainAcrossBar && <em className="chord-hold" title="This chord rings through the next bar line">HOLD →</em>}
                  {event.review && <em className={`review-status status-${event.review.status.toLowerCase()}`} title={event.review.reason}>{event.review.status}</em>}
                  <input disabled={event.locked || showNumbers} aria-label={`Chord on bar ${measure.number}, beat ${label}`} value={showNumbers ? event.nashvilleNumber : eventDrafts[event.id] ?? event.chordSymbol} onClick={input => input.stopPropagation()} onFocus={() => { setSelectedSectionIndex(sectionIndex); setSelectedMeasure(null); setEditorSelection({ ...target, eventId: event.id }); }} onChange={input => setEventDrafts(current => ({ ...current, [event.id]: input.target.value }))} onBlur={() => !showNumbers && commitChordCorrection(sectionIndex, measureIndex, event.id)} onKeyDown={input => { if (input.key === "Enter") input.currentTarget.blur(); }}/>
                </label>;
              })}
            </div>
          </div>)}
        </div>
      </section>)}
    </div>
  </section>;

  if (activeChartId !== "library" && !referenceChart) return <section className="song-analyzer analyzer-entry editor-loading" aria-label="Opening chart editor"><div className="analyzer-titlebar"><div><span className="step">ADMIN CHART EDITOR</span><h2>Opening a blank chart…</h2><p>Your saved charts stay in My library; a fresh editable chart is always the starting point.</p></div><div className="analyzer-actions"><button onClick={lockAdmin}>Lock admin</button></div></div></section>;

  return <section className="song-analyzer analyzer-entry" aria-label="Song Analyzer">
    <div className="analyzer-titlebar"><div><span className="step">Administrator chart workspace</span><h2>Build the chart. Then add timing if you need it.</h2><p>Create a blank chart from scratch, add as many bars as the song needs, and write the exact chords before optionally measuring a performance.</p></div><div className="analyzer-actions"><button onClick={() => setActiveChartId("library")}>My library · {charts.length}</button><button onClick={lockAdmin}>Lock admin</button></div></div>
    {cloudEnabled && <div className={`cloud-access workspace-${workspaceStatus}`}><span>PRIVATE DEVICE WORKSPACE</span><b>{workspaceStatus === "ready" ? "Ready · no email or account setup required." : workspaceStatus === "starting" ? "Preparing secure analysis…" : "Workspace setup needs attention."}</b>{cloudMessage && <small>{cloudMessage}</small>}</div>}
    {activeChartId === "library" && <><div className="private-library"><div><b>Your private library</b><span>{cloudUserId ? "Secured to this browser's private device workspace." : "Stored locally on this device only. Clearing browser data removes these charts."}</span></div>{charts.length ? charts.map(chart => <article key={chart.id}><button onClick={() => { setActiveChartId(chart.id); setCurrentPosition({ section: 0, measure: 0, beat: 1 }); }}><b>{chart.title}</b><small>{chart.key} {chart.mode} · {chart.sections.length} section{chart.sections.length === 1 ? "" : "s"}</small></button><div><button onClick={() => duplicateChart(chart)}>Duplicate</button><button onClick={() => exportChart(chart)}>Export</button><button className="danger" onClick={() => deleteChart(chart.id)}>Delete</button></div></article>) : <p>No saved charts yet.</p>}</div><div className="private-library published-library"><div><b>Published Gospel Standards · {publishedStandards.length}</b><span>Open any live song in the full chart editor, then save its changes back to Standards.</span></div>{publishedStandards.length ? publishedStandards.map(standard => <article key={standard.name}><div className="published-song-name"><b>{standard.name}</b><small>{standard.key} · {standard.composer} · {standard.style}</small></div><div><button className="edit-standard" onClick={() => openPublishedStandard(standard)}>Open and edit</button><button className="danger" disabled={removingStandard === standard.name} onClick={() => void removeFromGospelStandards(standard.name)}>{removingStandard === standard.name ? "Removing…" : "Remove from standards"}</button></div></article>) : <p>No analyzer songs are published yet.</p>}</div></>}
    {activeChartId !== "library" && <>
    {(job.status === "queued" || job.status === "processing") && <div className="analyzer-processing" role="status" aria-live="polite"><div className="analyzer-processing-mark" aria-hidden="true">FK</div><div><span>{job.status === "queued" ? "Queued securely" : "Analysis in progress"}</span><strong>{progressView.stage}</strong><p>{progressView.detail} The chart remains unchanged while this runs.</p><i className="indeterminate"><b/></i></div><em>WORKING</em></div>}
    <div className="chart-entry-switch" role="tablist" aria-label="Chart creation workflow">
      <button role="tab" aria-selected={entryWorkflow === "manual"} className={entryWorkflow === "manual" ? "active" : ""} onClick={() => setEntryWorkflow("manual")}>Create custom chart</button>
      <button role="tab" aria-selected={entryWorkflow === "analyze"} className={entryWorkflow === "analyze" ? "active" : ""} onClick={() => setEntryWorkflow("analyze")}>Import chart + measure timing</button>
    </div>
    {entryWorkflow === "manual" ? <section className="manual-chart-builder" aria-label="Create a custom chord chart">
      <header><span>1</span><div><b>Create a blank chart</b><small>Set the song details and starting bar count. Nothing is generated automatically.</small></div></header>
      <form className="manual-chart-form" onSubmit={event => { event.preventDefault(); createCustomChart(); }}>
        <label className="manual-wide">SONG TITLE<input aria-label="Custom chart title" value={manualDraft.title} placeholder="Untitled custom chart" onChange={event => setManualDraft(draft => ({ ...draft, title: event.target.value }))}/></label>
        <label className="manual-wide">COMPOSER / ARTIST<input aria-label="Custom chart artist" value={manualDraft.artist} placeholder="Optional" onChange={event => setManualDraft(draft => ({ ...draft, artist: event.target.value }))}/></label>
        <label>KEY<select aria-label="Custom chart key" value={manualDraft.key} onChange={event => setManualDraft(draft => ({ ...draft, key: event.target.value }))}>{KEYS.map(key => <option key={key}>{key}</option>)}</select></label>
        <label>MODE<select aria-label="Custom chart mode" value={manualDraft.mode} onChange={event => setManualDraft(draft => ({ ...draft, mode: event.target.value as "major" | "minor" }))}><option value="major">Major</option><option value="minor">Minor</option></select></label>
        <label>BPM<input aria-label="Custom chart BPM" type="number" inputMode="numeric" min="10" max="250" value={manualDraft.bpm} onChange={event => setManualDraft(draft => ({ ...draft, bpm: Number(event.target.value) || 10 }))}/></label>
        <label>SWING<input aria-label="Custom chart swing" type="number" inputMode="numeric" min="50" max="75" value={manualDraft.swingPercent} onChange={event => setManualDraft(draft => ({ ...draft, swingPercent: Number(event.target.value) || 50 }))}/></label>
        <label>METER<select aria-label="Custom chart meter" value={manualDraft.timeSignature} onChange={event => setManualDraft(draft => ({ ...draft, timeSignature: event.target.value }))}>{["2/4", "3/4", "4/4", "6/8"].map(meter => <option key={meter}>{meter}</option>)}</select></label>
        <label>FIRST SECTION<input aria-label="Custom chart first section" value={manualDraft.sectionName} onChange={event => setManualDraft(draft => ({ ...draft, sectionName: event.target.value }))}/></label>
        <label>STARTING BARS<input aria-label="Custom chart starting bars" type="number" inputMode="numeric" min="1" max="128" value={manualDraft.bars} onChange={event => setManualDraft(draft => ({ ...draft, bars: Number(event.target.value) || 1 }))}/></label>
        <div className="manual-chart-submit"><small>After opening the editor, select a bar heading to add or remove a bar. Select any beat or “&” to add a chord.</small><button className="primary" type="submit">Create custom chart</button></div>
      </form>
    </section> : <div className="chart-first-flow">
      <section className={`analyzer-stage ${referenceChart && tempoReady && swingReady ? "complete" : "current"}`}><header><span>1</span><div><b>Upload the chord chart and set tempo</b><small>Harmony, section order, BPM, and swing become authoritative.</small></div>{referenceChart && <em>✓ {referenceChart.chartReference?.chordCount ?? 0} chords</em>}</header><div className="chart-import-grid"><label className="file-drop chart-drop"><input type="file" accept=".txt,.csv,.json,.cho,.pro,.chordpro,.pdf,text/plain,text/csv,application/json,application/pdf" onChange={event => void importChartFile(event.target.files?.[0] ?? null)}/><b>{chartImporting ? "Reading chart…" : chartFile?.name ?? referenceChart?.chartReference?.fileName ?? "Choose chart file"}</b><span>Text, CSV, ChordPro, selectable-text PDF, or exported Faithful Keys JSON</span></label><div className="chart-paste"><label>OR PASTE A CHART<textarea value={chartText} onChange={event => setChartText(event.target.value)} placeholder={'[Verse]\n| Cmaj7 | Am7 D7 | G7 | Cmaj7 |\n[Chorus]\n| Fmaj7 | G7 | Cmaj7 | Cmaj7 |'}/></label><button disabled={!chartText.trim()} onClick={importPastedChart}>Use pasted chart</button></div></div>{referenceChart && <><div className="chart-import-summary"><div><b>{referenceChart.title}</b><span>{referenceChart.sections.length} sections · {referenceChart.chartReference?.chordCount} chart chords · {referenceChart.key} {referenceChart.mode}</span><small>You may edit any OCR or transcription mistake after analysis, then lock the correction.</small></div></div><div className={`analysis-tempo-panel ${tempoReady && swingReady ? "valid" : "invalid"}`}><div><span>STEP 1 RHYTHM</span><b>Set tempo and swing</b><small>50% is straight. About 67% is triplet swing. Use up to 75% for a harder shuffle.</small></div><div className="analysis-rhythm-fields"><label className="analysis-tempo"><input aria-label="Tempo for analysis" type="number" inputMode="numeric" min="10" max="250" step="1" value={referenceChart.bpm ?? ""} placeholder="BPM" onChange={event => setReferenceChart(chart => chart ? { ...chart, bpm: event.target.value === "" ? null : Number(event.target.value) } : chart)}/><strong>BPM</strong><small>{tempoReady ? `${selectedTempo} BPM locked` : "Enter 10–250"}</small></label><label className="analysis-tempo"><input aria-label="Swing percentage for analysis" type="number" inputMode="numeric" min="50" max="75" step="1" value={referenceChart.swingPercent ?? 50} onChange={event => setReferenceChart(chart => chart ? { ...chart, swingPercent: Number(event.target.value) } : chart)}/><strong>%</strong><small>{swingReady ? `${selectedSwing}% swing locked` : "Enter 50–75"}</small></label></div></div></>}{chartImportError && <p className="analyzer-error">{chartImportError}</p>}</section>
      <section className={`analyzer-stage ${referenceChart && tempoReady && swingReady ? "current" : "disabled"}`} aria-disabled={!referenceChart || !tempoReady || !swingReady}><header><span>2</span><div><b>Add video or audio for rhythm</b><small>Faithful Keys finds beat and “&” attacks, natural releases, connected phrases, and holds across bars without changing the chart.</small></div></header><div className="analyzer-source-tabs"><button disabled={!referenceChart || !tempoReady || !swingReady || job.status === "queued" || job.status === "processing"} className={sourceType === "upload" ? "active" : ""} onClick={() => setSourceType("upload")}>Upload video or audio</button><button disabled={!referenceChart || !tempoReady || !swingReady || job.status === "queued" || job.status === "processing"} className={sourceType === "youtube" ? "active" : ""} onClick={() => setSourceType("youtube")}>Paste YouTube link</button></div><div className="analyzer-source-card">{sourceType === "upload" ? <label className="file-drop"><input disabled={!referenceChart || !tempoReady || !swingReady} type="file" accept="audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4,.mov,.webm" onChange={event => setAudioFile(event.target.files?.[0] ?? null)}/><b>{audioFile ? audioFile.name : "Choose the performance"}</b><span>Audio or video · up to 100 MB</span></label> : <label className="youtube-input"><span>YOUTUBE PERFORMANCE LINK</span><input disabled={!referenceChart || !tempoReady || !swingReady} value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} placeholder="https://youtube.com/watch?v=…"/><small>The performance supplies rhythm only and is deleted after processing.</small></label>}<label className="permission-check"><input disabled={!referenceChart || !tempoReady || !swingReady} type="checkbox" checked={permissionConfirmed} onChange={event => setPermissionConfirmed(event.target.checked)}/><span>I own this media or have permission to analyze it. I understand source media is processed temporarily and is not retained or shared.</span></label><div className="analyzer-progress"><span>{job.status === "idle" ? referenceChart && tempoReady && swingReady ? "CHART + RHYTHM READY" : "STEP 1 REQUIRED" : progressView.stage.toUpperCase()}</span><i className={progressView.indeterminate ? "indeterminate" : ""}><b style={progressView.indeterminate ? undefined : { width: `${progressView.percent ?? 0}%` }}/></i><small>{job.error ?? (job.status === "queued" || job.status === "processing" ? progressView.detail : workspaceStatus === "ready" ? "Chart chords, tempo, and swing stay fixed; media supplies attacks, releases, and sustain phrasing only." : "Preparing your private device workspace…")}</small></div><button className="primary analyzer-start" disabled={!check.allowed || workspaceStatus === "starting" || job.status === "queued" || job.status === "processing"} onClick={startReviewChart}>Measure performance timing</button>{referenceChart && !check.allowed && <p className="analyzer-error">{check.error}</p>}</div></section>
    </div>}</>}
  </section>;
}
