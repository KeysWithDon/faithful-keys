# Faithful Keys private timing worker

This is an original integration layer deployed on a private service behind the
authenticated Faithful Keys API. It must not run on GitHub Pages or expose its
server token to the browser. The browser uploads directly to a short-lived,
user-scoped object-store location, and only the server sends a secure object
reference to this worker.

Pipeline: uploaded/pasted reference chart → authorized temporary performance →
tempo and beat-grid analysis → chart-beat timing → normalized chart metadata.

The uploaded chart is the only source of chord identity, quality, extensions,
slash basses, spelling, chord order, and section order. Audio or video supplies
only BPM, beat positions, chord start times, and chord durations. Production
chart-first jobs do not call the chord recognizer or harmonic AI reviewer. No
detected chord, key, bass, note, voicing, extension, alternate candidate, or
passing chord from the performance is stored. The source is removed when the
job's working directory closes.

Creative reharmonization is a separate, deliberate editor mode. It never uses
the uploaded performance and never changes the authoritative imported chart
unless the administrator explicitly applies an edit.

Required runtime configuration:

```text
ANALYSIS_WORKER_TOKEN=long-random-shared-token
SKIP_VOCAL_SEPARATION=true
YTDLP_PATH=/usr/local/bin/yt-dlp
DENO_PATH=/usr/local/bin/deno
YTDLP_POT_PROVIDER_HOME=/opt/bgutil-ytdlp-pot-provider/server
YOUTUBE_PROXY=http://127.0.0.1:40001
```

Legacy recognizer settings may remain present in an existing deployment, but
they are not used by production chart-first jobs.

For a single Oracle VM, copy `.env.example` to a private `.env` file, fill in
the worker DNS name and server-only values, then run:

```bash
docker compose up --build --detach
```

The included Caddy gateway provisions HTTPS for `WORKER_DOMAIN` and only
forwards `/health` and `/jobs`; the worker container itself has no public port.
For a public Oracle IP, `<public-ip>.nip.io` can provide a DNS name without a
separate registrar. Allow inbound TCP 80 and 443 in the Oracle security list.

The worker analyzes an authorized upload or one permission-confirmed YouTube
video directly for tempo and beat timing. YouTube playlists and non-YouTube
URLs are rejected at both the Edge Function and worker boundaries. No source
media is retained after the job completes.

Cloud-hosted IP addresses are frequently challenged by YouTube. The deployed
worker therefore supports an isolated local WARP route, a loopback-only IPv4
bridge, and an automatic proof-of-origin token provider. The proxy setting
applies only to temporary YouTube retrieval; callbacks and uploaded-audio
analysis use the VM's normal network route.

Configure Supabase's `queue-song-analysis` Edge Function with the worker HTTPS
URL and the same `ANALYSIS_WORKER_TOKEN`. The Edge Function authenticates the
browser request and row-level security checks job ownership before issuing a
short-lived signed download URL. The worker posts timing metadata only to the
token-protected callback, and Supabase deletes the source object after success
or failure.

Manual chart corrections and locks remain in the private chart JSON and become
the source for later timing runs. Performance-derived harmony is never saved or
learned. The Edge Function also clears harmonic fields from any legacy or
malformed worker response before it updates a chart.

The container still includes the legacy recognizer for backward compatibility,
but production chart-first jobs do not invoke it. Any model code or artifact
retained in a deployment needs an independent licensing review and the required
notices.
