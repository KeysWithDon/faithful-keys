# Song Analyzer architecture

Faithful Keys keeps chart data and source media separate.
`app/song-analyzer.ts` is the shared chart model: chart import, source
validation, permission gating, timing normalization, written-note
transposition, Nashville numbers, and local fallback persistence.
`app/song-analyzer-provider.ts` defines the server-only processing contract.

The administrator workspace defaults to a manual chart builder. Set the song
details, meter, tempo, swing, first section, and initial bar count; then add
or remove bars and place any written chord on any beat or eighth-note “&”. No
chord is generated or inferred for a manual chart. An administrator can add
sections, copy/paste bars or sections, and publish the completed chart to Gospel
Standards. Removing a populated bar asks once before deleting its unlocked
chords; locked chords must be unlocked first.

Manual entry includes a key-aware chord bank and a guided-entry option. The
guide advances through each beat and eighth-note “&”, offering a chord choice
or a skip. Bank choices preserve the key's written spelling. Simple on-beat
entries distribute a bar evenly: one chord is a whole-bar hold, two are two
half-bar chords, and four are quarter-bar chords. Adding an “&” preserves the
explicit rhythmic grid instead. The same manual durations are exported with the
published standard.

The optional import-and-timing workflow remains chart-first. Upload a text,
CSV, ChordPro, or exported Faithful Keys JSON chart, or paste chart text; then
supply owned or permitted audio/video or a YouTube performance. The private
worker measures its tempo and beat grid and applies those timings to the chart
without changing any chord, spelling, extension, inversion, slash bass, chord
order, or section. The saved private library contains the chart and timing
metadata, never media.

The importer also accepts a selectable-text PDF and extracts its text locally
in the browser before parsing it as a chart. A scanned PDF with no text layer
returns an explicit OCR-required error rather than creating guessed chords.

For production, the server path is: secure temporary ingest → authenticated
Supabase Edge Function → private timing worker → tempo/beat analysis →
normalized `SongChart` timing response → source cleanup. The API authorizes
every chart read and write by `userId`, returns chart metadata only, and never
gives the browser a server credential.

The chart is the sole harmonic authority. Audio and video may provide only:

- BPM
- beat positions
- chord start times
- chord end times and durations

Production chart-first jobs deliberately skip pitch, key, chord, bass,
extension, inversion, voicing, and harmonic AI analysis. The Edge Function also
strips every harmonic field from a legacy or malformed worker response before
saving it. Performance media therefore cannot add, remove, invert, extend,
respell, or replace a chart chord.

Administrator chord edits and locks remain attached to the chart and are used
unchanged on a later timing run. Reharmonize mode is a separate creative editor
and never uses performance audio as harmonic evidence.

## Supabase private cloud setup

The browser integration in `app/supabase-client.ts` activates when
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set at build time.
Run `supabase/migrations/20260822000000_song_analyzer.sql` in the project SQL
editor before enabling the feature. It creates the private chart/job tables,
enables Row Level Security, and makes the source bucket private. The browser
uses a publishable key only.

Deploy `supabase/functions/queue-song-analysis` with `--no-verify-jwt`. The
function performs its own JWT check and uses a user-scoped Supabase client, so
row-level security remains the ownership gate. Give it only these server-side
secrets: `ANALYSIS_WORKER_URL` and `ANALYSIS_WORKER_TOKEN`.

Deploy `services/song-analyzer/` as a private container and give it the same
worker token. The Edge Function creates a short-lived signed download URL, the
worker returns timing metadata through a token-protected callback, and the
worker receives no Supabase database or storage credential.

The Pages build requires only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`, baked in at build time. A permitted upload or
permission-confirmed single-video YouTube link is dispatched through the same
private worker. Source media is temporary and deleted after the callback.

The analyzer uses one anonymous, email-free device workspace. The private
worker must be deployed separately; GitHub Pages must never contain its token
or process source media itself.
