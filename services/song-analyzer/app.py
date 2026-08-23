"""Authenticated private worker API for Faithful Keys chord recognition.

The worker receives a short-lived signed object URL from the Edge Function and
returns analysis data to a token-protected callback. It therefore never holds
a Supabase service key or direct database/storage privileges.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any
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
    sourceObjectKey: str = Field(min_length=1)
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


async def notify(client: httpx.AsyncClient, callback_url: str, token: str, body: dict[str, Any]) -> None:
    """Return a result to Supabase, retrying only transient delivery failures."""
    if not permitted_callback(callback_url):
        raise RuntimeError("The result callback is not a permitted Supabase endpoint.")
    last_error: Exception | None = None
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
            audio = await client.get(str(request.sourceUrl))
            audio.raise_for_status()
            content_length = int(audio.headers.get("content-length") or 0)
            if content_length > MAX_SOURCE_BYTES or len(audio.content) > MAX_SOURCE_BYTES:
                raise RuntimeError("The permitted source exceeds the analysis size limit.")
            if not audio.content:
                raise RuntimeError("The permitted source is empty.")
            with tempfile.TemporaryDirectory(prefix=f"faithful-keys-download-{request.jobId}-") as directory:
                suffix = Path(request.sourceObjectKey).suffix or ".audio"
                source = Path(directory) / f"source{suffix}"
                source.write_bytes(audio.content)
                result = await asyncio.to_thread(run_analysis, AnalysisInput(job_id=request.jobId, user_id="private-worker", source_path=source, title="Uploaded song"))
            await notify(client, callback_url, token, {"kind": "completed", "jobId": request.jobId, "chartId": request.chartId, "sourceObjectKey": request.sourceObjectKey, "result": result})
        except Exception as error:
            public_message = str(error) if isinstance(error, AnalysisStageError) else "Private chord recognition could not complete."
            try:
                await notify(client, callback_url, token, {"kind": "failed", "jobId": request.jobId, "chartId": request.chartId, "sourceObjectKey": request.sourceObjectKey, "message": public_message})
            except Exception:
                pass
            print(f"analysis failed for {request.jobId}: {type(error).__name__}: {error}")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
async def queue_job(request: JobRequest, tasks: BackgroundTasks, authorization: str | None = Header(default=None)) -> dict[str, str]:
    if authorization != f"Bearer {worker_token()}":
        raise HTTPException(status_code=401, detail="Unauthorized worker request.")
    if not permitted_callback(str(request.callbackUrl)):
        raise HTTPException(status_code=403, detail="Invalid result callback.")
    tasks.add_task(process, request)
    return {"status": "accepted", "jobId": request.jobId}
