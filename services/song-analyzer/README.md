# Faithful Keys private analysis worker

This is an original integration layer, not a copy of another product. Deploy it
on a private CPU/GPU service behind the authenticated Faithful Keys API—not on
GitHub Pages or a public URL. The browser uploads directly to a short-lived,
user-scoped object-store location and only the server sends a secure object
reference to this worker.

Pipeline: authorized temporary input → beat grid → timestamped chord
recognition → constrained harmonic review → normalized chart metadata. The
source is removed when the job's working directory closes.

Required runtime configuration:

```text
CHORD_RECOGNIZER_HOME=/opt/chord-recognizer
CHORD_RECOGNIZER_CHECKPOINT=/opt/models/chord-recognizer.pth
CHORD_RECOGNIZER_CONFIG=config/ChordMini.yaml
CHORD_RECOGNIZER_MODEL=ChordNet
ANALYSIS_WORKER_TOKEN=long-random-shared-token
SKIP_VOCAL_SEPARATION=true
YTDLP_PATH=/usr/local/bin/yt-dlp
DENO_PATH=/usr/local/bin/deno
YTDLP_POT_PROVIDER_HOME=/opt/bgutil-ytdlp-pot-provider/server
YOUTUBE_PROXY=http://127.0.0.1:40001
```

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
video directly for beats and chords. YouTube playlists and non-YouTube URLs
are rejected at both the Edge Function and worker boundaries. This
keeps the model inside the memory limits of a small CPU-only Oracle VM. No
source media is retained after the job completes.

Cloud-hosted IP addresses are frequently challenged by YouTube. The deployed
worker therefore uses an isolated local WARP route, a loopback-only IPv4 bridge,
and an automatic proof-of-origin token provider. The proxy setting applies only
to the temporary YouTube retrieval command; Supabase callbacks and uploaded-
audio analysis continue to use the VM's normal network route.

Configure Supabase's `queue-song-analysis` Edge Function with the resulting
HTTPS worker URL and the same `ANALYSIS_WORKER_TOKEN`. The Edge Function
authenticates the browser request and row-level security checks job ownership
before issuing a short-lived signed download URL to this worker. The worker
posts recognition metadata only to the token-protected callback; Supabase then
deletes the source object after success or failure. Results retain confidence
labels and remain editable.

The container installs the ChordMini implementation and its included ChordNet
checkpoint. Build this image in a trusted CI environment, then deploy it to a
private long-running CPU/GPU container host. It must not be placed in GitHub
Pages or an Edge Function, which cannot run these models.

Any model code or model artifact used in deployment needs an independent
licensing review and the required notices. Keep those notices in deployment
documentation; no third-party branding is required in the Faithful Keys UI.
