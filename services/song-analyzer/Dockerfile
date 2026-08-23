FROM python:3.11-slim
WORKDIR /app
ARG CHORDMINI_REPOSITORY=https://github.com/ptnghia-j/ChordMini.git
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
COPY requirements-core.txt ./
# The worker recognizes chords directly from a short-lived signed audio file.
RUN git clone --depth 1 "$CHORDMINI_REPOSITORY" /opt/chordmini \
    && pip install --no-cache-dir -r /opt/chordmini/requirements.txt \
    && pip install --no-cache-dir -r requirements-core.txt
COPY analysis_service.py app.py ./
ENV PORT=8080
ENV CHORD_RECOGNIZER_HOME=/opt/chordmini
ENV CHORD_RECOGNIZER_CHECKPOINT=/opt/chordmini/checkpoints/2e1d_model_best.pth
ENV SKIP_VOCAL_SEPARATION=true
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
