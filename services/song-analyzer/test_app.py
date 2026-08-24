import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from pydantic import ValidationError

from app import JobRequest, permitted_youtube_url, youtube_download_command


class WorkerRequestTest(unittest.TestCase):
    def test_accepts_only_specific_https_youtube_videos(self):
        self.assertTrue(permitted_youtube_url("https://youtu.be/abc123_DEF"))
        self.assertTrue(permitted_youtube_url("https://www.youtube.com/watch?v=abc123_DEF"))
        self.assertTrue(permitted_youtube_url("https://music.youtube.com/watch?v=abc123_DEF"))
        self.assertTrue(permitted_youtube_url("https://youtube.com/shorts/abc123_DEF"))
        self.assertFalse(permitted_youtube_url("http://youtube.com/watch?v=abc123_DEF"))
        self.assertFalse(permitted_youtube_url("https://example.com/watch?v=abc123_DEF"))
        self.assertFalse(permitted_youtube_url("https://youtube.com/channel/abc123_DEF"))

    def test_youtube_job_does_not_require_a_storage_object(self):
        request = JobRequest(
            jobId="job-1",
            chartId="chart-1",
            sourceType="youtube",
            sourceObjectKey=None,
            sourceUrl="https://youtu.be/abc123_DEF",
            callbackUrl="https://example.supabase.co/functions/v1/queue-song-analysis",
            referenceChart={"sections": [{"name": "Verse", "measures": []}]},
        )
        self.assertIsNone(request.sourceObjectKey)

    def test_rejects_unknown_source_types(self):
        with self.assertRaises(ValidationError):
            JobRequest(
                jobId="job-1",
                chartId="chart-1",
                sourceType="remote",
                sourceUrl="https://youtu.be/abc123_DEF",
                callbackUrl="https://example.supabase.co/functions/v1/queue-song-analysis",
            )

    def test_youtube_command_uses_isolated_proxy_and_token_provider(self):
        with TemporaryDirectory() as directory, patch.dict("os.environ", {
            "YTDLP_PATH": "/opt/faithful-keys/yt-dlp",
            "DENO_PATH": "/bin/sh",
            "YTDLP_POT_PROVIDER_HOME": "/opt/faithful-keys/provider",
            "YOUTUBE_PROXY": "socks5://127.0.0.1:40000",
        }):
            command = youtube_download_command("https://youtu.be/abc123_DEF", Path(directory))
        self.assertEqual(command[0], "/opt/faithful-keys/yt-dlp")
        self.assertIn("socks5://127.0.0.1:40000", command)
        self.assertIn("youtubepot-bgutilscript:server_home=/opt/faithful-keys/provider", command)
        self.assertIn("deno:/bin/sh", command)
        self.assertEqual(command[-2:], ["--", "https://youtu.be/abc123_DEF"])


if __name__ == "__main__":
    unittest.main()
