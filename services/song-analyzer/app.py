"""Authenticated private worker API for Faithful Keys chord recognition.

The worker receives either a short-lived signed upload URL or a permission-
confirmed YouTube video URL from the Edge Function, then returns chart data to
a token-protected callback. It never holds a Supabase service key or direct
database/storage privileges, and all source media remains temporary.
"""
from __future__ import annotations

import asyncio
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Literal, Optional
from urllib.parse import urlparse

import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, HttpUrl

from analysis_service import AnalysisInput, AnalysisStageError, run_analysis

app = FastAPI(title="Faithful Keys private analysis worker", docs_url=None, redoc_url=None)
MAX_SOURCE_BYTES = 100 * 1024 * 1024


class JobRequest(BaseModel):
    jobId: str = Field(min_length=1)
    chartId: str = Field(min_length=1)
    sourceType: Literal["upload", "youtube"]
    sourceObjectKey: Optional[str] = None
    sourceUrl: HttpUrl
    callbackUrl: HttpUrl


def worker_token() -> str:
    token = os.environ.get("ANALYSIS_WORKER_TOKEN", "")
    if not token:
        raise RuntimeError("ANALYSIS_WORKER_TOKEN is required.")
    return token


def permitted_callback(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and parsed.hostname is not None and parsed.hostname.endswith(".supabase.co")


def permitted_youtube_url(url: str) -> bool:
    """Accept one specific YouTube video, never a playlist or arbitrary URL."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return False
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    video_id = re.compile(r"^[A-Za-z0-9_-]{6,}$")
    if host == "youtu.be":
        return bool(video_id.fullmatch(parsed.path.strip("/")))
    if host not in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        return False
    if parsed.path == "/watch":
        from urllib.parse import parse_qs
        values = parse_qs(parsed.query).get("v", [])
        return len(values) == 1 and bool(video_id.fullmatch(values[0]))
    if parsed.path.startswith("/shorts/"):
        return bool(video_id.fullmatch(parsed.path.removeprefix("/shorts/").strip("/")))
    return False


async def download_uploaded_audio(client: httpx.AsyncClient, url: str, destination: Path) -> Path:
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        content_length = int(response.headers.get("content-length") or 0)
        if content_length > MAX_SOURCE_BYTES:
            raise RuntimeError("The permitted source exceeds the analysis size limit.")
        total = 0
        with destination.open("wb") as output:
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise RuntimeError("The permitted source exceeds the analysis size limit.")
                output.write(chunk)
    if not destination.exists() or destination.stat().st_size == 0:
        raise RuntimeError("The permitted source is empty.")
    return destination


def youtube_download_command(url: str, directory: Path) -> list[str]:
    if not permitted_youtube_url(url):
        raise RuntimeError("The YouTube source is not permitted.")
    executable = os.environ.get("YTDLP_PATH", "/home/opc/bin/yt-dlp")
    output_template = str(directory / "source.%(ext)s")
    command = [
        executable,
        "--ignore-config",
        "--no-playlist",
        "--no-cache-dir",
        "--no-part",
        "--no-progress",
        "--no-warnings",
        "--max-filesize", "100M",
        "--format", "bestaudio[filesize<=100M]/bestaudio/best[filesize<=100M]/best",
        "--extract-audio",
        "--audio-format", "wav",
        "--output", output_template,
        "--extractor-args", "youtube:player_client=mweb",
    ]
    proxy = os.environ.get("YOUTUBE_PROXY", "").strip()
    if proxy:
        command.extend(["--proxy", proxy])
    provider_home = os.environ.get("YTDLP_POT_PROVIDER_HOME", "").strip()
    if provider_home:
        command.extend(["--extractor-args", f"youtubepot-bgutilscript:server_home={provider_home}"])
    deno_path = os.environ.get("DENO_PATH", "/home/opc/bin/deno")
    if Path(deno_path).is_file():
        command.extend(["--js-runtimes", f"deno:{deno_path}", "--remote-components", "ejs:github"])
    command.extend(["--", url])
    return command


async def download_youtube_audio(url: str, directory: Path) -> Path:
    command = youtube_download_command(url, directory)
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=directory,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=8 * 60)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise RuntimeError("YouTube audio preparation timed out.")
    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="replace")[-1500:]
        print(f"YouTube preparation failed: {detail}")
        raise RuntimeError("YouTube audio could not be prepared.")
    candidates = [path for path in directory.glob("source.*") if path.is_file() and path.stat().st_size > 0]
    if not candidates:
        raise RuntimeError("YouTube audio could not be prepared.")
    source = max(candidates, key=lambda path: path.stat().st_mtime)
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise RuntimeError("The permitted source exceeds the analysis size limit.")
    return source


async def notify(client: httpx.AsyncClient, callback_url: str, token: str, body: dict[str, Any]) -> None:
    """Return a result to Supabase, retrying only transient delivery failures."""
    if not permitted_callback(callback_url):
        raise RuntimeError("The result callback is not a permitted Supabase endpoint.")
    last_error: Optional[Exception] = None
    for _ in range(3):
        try:
            response = await client.post(callback_url, headers={"content-type": "application/json", "x-faithful-worker-token": token}, json=body)
            response.raise_for_status()
            return
        except (httpx.HTTPError, OSError) as error:
            last_error = error
            await asyncio.sleep(1)
    raise RuntimeError("The private result callback could not be delivered.") from last_error


async def process(request: JobRequest) -> None:
    token = worker_token()
    callback_url = str(request.callbackUrl)
    async with httpx.AsyncClient(timeout=httpx.Timeout(60 * 30), follow_redirects=False) as client:
        try:
            with tempfile.TemporaryDirectory(prefix=f"faithful-keys-download-{request.jobId}-") as directory:
                work_dir = Path(directory)
                if request.sourceType == "youtube":
                    source = await download_youtube_audio(str(request.sourceUrl), work_dir)
                else:
                    if not request.sourceObjectKey:
                        raise RuntimeError("The private audio object is missing.")
                    suffix = Path(request.sourceObjectKey).suffix or ".audio"
                    source = await download_uploaded_audio(client, str(request.sourceUrl), work_dir / f"source{suffix}")
                result = await asyncio.to_thread(run_analysis, AnalysisInput(job_id=request.jobId, user_id="private-worker", source_path=source, title="Analyzed song"))
            await notify(client, callback_url, token, {"kind": "completed", "jobId": request.jobId, "chartId": request.chartId, "sourceObjectKey": request.sourceObjectKey, "result": result})
        except Exception as error:
            public_message = str(error) if isinstance(error, AnalysisStageError) else "YouTube audio could not be prepared." if request.sourceType == "youtube" else "Private chord recognition could not complete."
            try:
                await notify(client, callback_url, token, {"kind": "failed", "jobId": request.jobId, "chartId": request.chartId, "sourceObjectKey": request.sourceObjectKey, "message": public_message})
            except Exception:
                pass
            print(f"analysis failed for {request.jobId}: {type(error).__name__}: {error}")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
async def queue_job(request: JobRequest, tasks: BackgroundTasks, authorization: Optional[str] = Header(default=None)) -> dict[str, str]:
    if authorization != f"Bearer {worker_token()}":
        raise HTTPException(status_code=401, detail="Unauthorized worker request.")
    if not permitted_callback(str(request.callbackUrl)):
        raise HTTPException(status_code=403, detail="Invalid result callback.")
    if request.sourceType == "youtube" and not permitted_youtube_url(str(request.sourceUrl)):
        raise HTTPException(status_code=403, detail="Invalid YouTube source.")
    if request.sourceType == "upload" and not request.sourceObjectKey:
        raise HTTPException(status_code=400, detail="The private audio object is missing.")
    tasks.add_task(process, request)
    return {"status": "accepted", "jobId": request.jobId}
