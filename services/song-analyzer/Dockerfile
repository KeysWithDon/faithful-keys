FROM python:3.11-slim
WORKDIR /app
ARG CHORDMINI_REPOSITORY=https://github.com/ptnghia-j/ChordMini.git
ARG BGUTIL_REPOSITORY=https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
ARG BGUTIL_COMMIT=7511309af023b09788dc8f2efc96cc3671291e6c
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
COPY requirements-core.txt ./
# The worker recognizes chords directly from a short-lived signed audio file.
RUN git clone --depth 1 "$CHORDMINI_REPOSITORY" /opt/chordmini \
    && git clone --depth 1 --branch 1.3.2 "$BGUTIL_REPOSITORY" /opt/bgutil-ytdlp-pot-provider \
    && test "$(git -C /opt/bgutil-ytdlp-pot-provider rev-parse HEAD)" = "$BGUTIL_COMMIT" \
    && pip install --no-cache-dir -r /opt/chordmini/requirements.txt \
    && pip install --no-cache-dir -r requirements-core.txt \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && deno install --allow-scripts=npm:canvas --frozen \
    && deno cache --frozen src/generate_once.ts
COPY analysis_service.py app.py ./
ENV PORT=8080
ENV CHORD_RECOGNIZER_HOME=/opt/chordmini
ENV CHORD_RECOGNIZER_CHECKPOINT=/opt/chordmini/checkpoints/2e1d_model_best.pth
ENV SKIP_VOCAL_SEPARATION=true
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV DENO_PATH=/usr/local/bin/deno
ENV YTDLP_POT_PROVIDER_HOME=/opt/bgutil-ytdlp-pot-provider/server
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
