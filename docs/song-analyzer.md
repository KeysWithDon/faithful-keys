# Song Analyzer architecture

Faithful Keys keeps analysis data and source media separate. `app/song-analyzer.ts` is the shared, testable chart model: chart import, source validation, permission gating, timing normalization, written-note transposition, Nashville numbers, and local fallback persistence. `app/song-analyzer-provider.ts` defines the server-only processing contract so a compliant provider can be installed without changing the chart UI.

The administrator workflow is chart-first. First upload a text, CSV, ChordPro,
or exported Faithful Keys JSON chart (or paste chart text). Then supply owned or
permitted audio/video evidence or a YouTube performance. The private worker
aligns the performance to the chart without changing chart order or structure.
The saved private library contains chart and evidence metadata, never media.

For a production processor, the included server path is: secure temporary ingest → authenticated Supabase Edge Function → private worker → beat/key/chord analysis → normalized `SongChart` response → source cleanup. The API authorizes every chart read/write by `userId`; returns chart metadata only; and never gives the browser a server credential. Required configuration includes storage, processing provider, retention hours, job concurrency, and enabled sources. No server secret belongs in the client or repository.

`services/song-analyzer/` now supplies a private-worker reference integration: a ChordMini-compatible timestamped chord-recognition command, beat analysis, and a constrained harmonic-review hook. It runs only on a separately deployed authenticated service. The browser and the GitHub Pages build still never receive or retain source media.

The evidence authority is `chart chord → bass → accompaniment → melody`.
Accompaniment and melody registers are analyzed separately, so a passing vocal
or lead note cannot create a chord. The worker first completes deterministic
audio recognition, then aligns it to the reference chart. Only then does the
reviewer receive strict per-event data containing key, mode,
tempo, section, measure, beat, timestamps, separately detected bass and
sustained upper notes, original chord, confidence, supplied alternatives,
neighbors, and matching repeated-section occurrences. Without an API key, a
built-in evidence reviewer ranks those candidates locally and requires stronger
audio evidence plus bass, upper-note, or repetition corroboration before a
correction. With a configured OpenAI key, strict JSON output is validated at the
same boundary. Neither path can add a chord; an invalid or unavailable attempted
AI response leaves the uploaded chart unchanged. Extensions and strong unmatched
passing-chord evidence remain pending until accepted; locked chords are never
replaced on later runs.

Administrator edits are appended to `SongChart.correctionHistory` with their
audio evidence, original result, AI recommendation, and final correction. That
private JSON is already protected by the chart's owner RLS policy. The queue
function sends at most 40 owner-scoped examples to future reviews for
calibration; those examples never authorize a new candidate. Reharmonize mode
is marked as creative and is intentionally excluded from correction learning.

## Supabase private cloud setup

The browser integration in `app/supabase-client.ts` activates when
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set at build time.
Run `supabase/migrations/20260822000000_song_analyzer.sql` in the project SQL
editor before enabling the feature. It creates the private chart/job tables,
enables Row Level Security, and makes the source bucket private. The browser
uses a publishable key only. Supabase's Edge Function holds the privileged
key available in its runtime; the external worker never receives it.

Deploy `supabase/functions/queue-song-analysis` with `--no-verify-jwt`. The
function performs its own JWT check and uses a user-scoped Supabase client, so
row-level security remains the ownership gate. Give that function only these
server-side secrets: `ANALYSIS_WORKER_URL` and `ANALYSIS_WORKER_TOKEN`.
Deploy `services/song-analyzer/` as a private (ideally GPU-backed) container
and give it `ANALYSIS_WORKER_TOKEN` plus the approved local model paths. The
Edge Function creates a short-lived signed download URL and the worker returns
only recognition metadata through a token-protected callback. The worker has
no Supabase database or storage credential.

The Pages build requires only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`, baked in at build time. A permitted upload or
permission-confirmed single-video YouTube link is dispatched through the same
private worker. Source media is temporary and deleted after the result callback.

The analyzer uses one anonymous, email-free device workspace. The worker must be
deployed separately and consume authenticated queued jobs with a server-side
token; GitHub Pages must never contain that token or process source audio itself.
