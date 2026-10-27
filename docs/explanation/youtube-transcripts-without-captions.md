---
type: Explanation
title: YouTube transcripts without captions
description: How MacWhisper transcribes a YouTube video that has no captions, and what kasten would need to do the same.
tags: [video, transcript, youtube, whisper, research]
status: stable
---

# YouTube transcripts without captions

`<leader>cv` writes a video's captions into its note, but only where YouTube
has captions. MacWhisper also transcribes videos that have none. This page
records how it does that and what kasten would need to do the same (#955). It
is research: nothing here is built, and every speed below is cited or worked
out from a cited figure, not measured on this server. Prices were read on
2026-10-27.

## What kasten does today

`<leader>cv` asks the backend for
[`GET /api/transcripts/{video_id}`](/reference/http-api/capture.md), and the
note gets the answer under `## Transcript`
([its transcript in the note](/reference/editor-keys/video-pane.md#its-transcript-in-the-note)).
The backend's `transcripts.py` lists the video's caption tracks with
[youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api),
takes the first English one (a person's before the machine's) or else the
first track, and fetches it. No track at all is a `404`; YouTube refusing the
request (`RequestBlocked`) is a `502`. The fetch runs on a worker thread
inside the request, which works because it is two or three round trips.
Nothing downloads audio and nothing transcribes.

## How MacWhisper does it

The vault note "MacWhisper 15.7.1 overview" took build 1571 apart (strings,
Swift type metadata and imports, nothing run). For YouTube it found a
`DownloadMedia.MediaDownloadClient` module, the Swift package `YouTubeKit`,
the host `youtube.com/youtubei/v1` and InnerTube client IDs. Every input,
YouTube included, is then decoded to 16 kHz mono and handed to the engine you
picked, each with its own voice detection (whisper.cpp runs the bundled
Silero VAD, Parakeet always uses VAD, WhisperKit has a switch of its own): whisper.cpp on the Mac, WhisperKit, the paid
Argmax engines (Parakeet, Qwen3-ASR), or one of about 18 cloud APIs.

[YouTubeKit](https://github.com/alexeichhorn/YouTubeKit) "allows to extract
the direct video url or audio url for any YouTube video" through the
InnerTube player API. It has no caption code (no `caption` or `timedtext` in
the repo). So MacWhisper, as far as the binary shows, downloads the audio
stream and transcribes it itself; it does not find captions YouTube hides.
No MacWhisper page says this in words. The nearest is
[ifun.de on MacWhisper 13](https://www.ifun.de/macwhisper-13-bringt-neues-design-und-viele-verbesserungen-267979/),
which reports a fix for MacWhisper no longer being able to transcribe YouTube
videos. YouTubeKit also has an optional fallback to a remote `youtube-dl`
server that "makes all HTTP requests through the requesting device", so the
requests still leave from the user's own Mac.

That last point matters more than the model. MacWhisper downloads from a home
connection. kasten would download from a Hetzner data centre.

## Getting the audio

The tool for this on a server is [yt-dlp](https://github.com/yt-dlp/yt-dlp).
`-f bestaudio` normally picks itag 251, Opus at about 135 to 160 kbps
([measurements](https://audiomisc.co.uk/YouTube/SpotTheDifference.html)), so
an hour of video is about 60 to 70 MB of audio. Whisper wants 16 kHz mono, so
ffmpeg converts it, or faster-whisper decodes it itself through PyAV.

Three things make this harder than it was:

* **A JavaScript runtime.** Since 2025.11.12 yt-dlp needs one for full
  YouTube support; without it "format availability will be limited, and
  severely so in some cases"
  ([#15012](https://github.com/yt-dlp/yt-dlp/issues/15012)). Only Deno is on
  by default; Node, QuickJS and Bun must be turned on by hand.
* **PO tokens.** YouTube asks some clients for a Proof of Origin token.
  Without one, requests may fail with 403 or lead to IP or account blocks. The
  [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) no
  longer recommends pulling tokens by hand and points at a provider plugin
  such as [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider),
  which runs as a token server of its own.
* **Data centre IPs.** youtube-transcript-api's README says "YouTube has
  started blocking most IPs that are known to belong to cloud providers" and
  that you "will most likely run into RequestBlocked or IpBlocked exceptions";
  its answer is rotating residential proxies, since static ones get banned.
  yt-dlp users see "Sign in to confirm you're not a bot" from shared hosts
  ([Render](https://community.render.com/t/yt-dlp-sign-in-problem/26692),
  [Hugging Face](https://huggingface.co/spaces/openai/whisper/discussions/121)).
  Cookies from a logged-in account get past some of that, and the
  [yt-dlp wiki](https://github.com/yt-dlp/yt-dlp/wiki/Extractors) warns that
  the account may then be banned.

Whether this server's IP is blocked today was not tested. The `502` path in
the caption route exists because it can be.

The official way does not help. The Data API's
[`captions.download`](https://developers.google.com/youtube/v3/docs/captions/download)
"requires the user to have permission to edit the video", and it only returns
captions that exist.

## Which model, and where it runs

The server is a Ryzen 7 3700X (8 cores, 16 threads, AVX2, no AVX-512) with
62 GiB of RAM and no GPU, and it already runs prod. Three engines run Whisper
or something like it on such a CPU:

* [whisper.cpp](https://github.com/ggml-org/whisper.cpp): C++, no Python
  dependencies, the engine MacWhisper uses on the Mac.
* [faster-whisper](https://github.com/SYSTRAN/faster-whisper): Python on
  CTranslate2, int8 on CPU, batched decoding, decodes audio through PyAV.
* NVIDIA [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
  through [onnx-asr](https://github.com/istupakov/onnx-asr) or
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx): not Whisper, 25
  European languages including German. The model takes up to 24 minutes at
  once (its card), but onnx-asr feeds it 20 to 30 s clips, so long audio
  needs VAD there ([onnx-asr README](https://github.com/istupakov/onnx-asr)).

The models worth naming, by English word error rate on the Open ASR
Leaderboard ([paper](https://arxiv.org/html/2510.06961v3),
[turbo card](https://huggingface.co/openai/whisper-large-v3-turbo)):

| Model | English WER | German | Note |
|---|---|---|---|
| Whisper large-v3 | 7.44 | 4.97 | too slow on this CPU |
| Whisper large-v3-turbo | 7.83 | no figure found | large encoder, 4-layer decoder |
| Parakeet TDT 0.6B v3 | 6.32 | 4.90 | European languages only |
| Whisper small | no leaderboard figure | no figure found | weakest, fastest Whisper here |

The other two places it could run are a GPU host and a paid API; their prices
are under [Cost per hour of video](#cost-per-hour-of-video).

## Time per hour of video

Nothing was run on this server. The CPU figures scale a cited benchmark by
PassMark, which puts the 3700X about 1.5 times slower than the i7-12700K of
the faster-whisper README
([comparison](https://www.cpubenchmark.net/compare/AMD-Ryzen-7-3700X-vs-Intel-i7-12700K/3485vs4609)).

| Where | Model | Minutes per hour of audio | Worked out from |
|---|---|---|---|
| This CPU, faster-whisper int8, batch 8 | small | about 6 | README: 51 s for 13 min on a 12700K, times 60/13, times 1.5 |
| This CPU, faster-whisper int8 | small | about 12 | README: 1 min 42 s for 13 min, same scaling |
| This CPU, whisper.cpp | large-v3-turbo | about 35 to 45, low confidence | [whisper.cpp bench #89](https://github.com/ggml-org/whisper.cpp/issues/89): large encoder alone, 16.9 s per 30 s window, 8 threads on a Ryzen 9 3900X (same Zen 2 core), 2022 code; turbo keeps that encoder |
| This CPU, onnx-asr | Parakeet v3 | about 3 | onnx-asr README: 36 times real time on a Ryzen 9800X3D, scaled by PassMark (1.79 times) |
| A GPU, faster-whisper | large-v2 (turbo is faster) | at most 1.3 | README: 17 s for 13 min on an RTX 3070 Ti |
| Groq API | large-v3-turbo | about 0.3, plus upload | [Groq](https://console.groq.com/docs/speech-to-text): 216 times real time |

The CPU runs would compete with prod while they last. A turbo run is nearly
real time, so an hour of video holds the cores for most of an hour. The
download itself is 60 to 70 MB, seconds on this connection, if YouTube lets
it through.

## Cost per hour of video

Running on this server costs nothing more. Everything else is MONEY: the
user's call. Prices in USD unless marked, from each provider's own page.

| Option | Price | Per hour of audio | 10 h a month | 40 h a month | Upload limit |
|---|---|---|---|---|---|
| This server, CPU | none | 0 | 0 | 0 | none |
| [Groq](https://console.groq.com/docs/speech-to-text) whisper-large-v3-turbo | 0.04 a hour | 0.04 | 0.40 | 1.60 | 25 MB free tier, 100 MB paid, or a URL |
| [OpenAI](https://developers.openai.com/api/docs/pricing) gpt-4o-mini-transcribe | 0.003 a minute | 0.18 | 1.80 | 7.20 | 25 MB |
| OpenAI whisper-1 | 0.006 a minute | 0.36 | 3.60 | 14.40 | 25 MB |
| [Deepgram](https://deepgram.com/pricing) Nova-3, multilingual | 0.0052 a minute | 0.31 | 3.12 | 12.48 | 2 GB |
| [RunPod](https://www.runpod.io/product/serverless) serverless L4 | 0.69 a GPU hour | 0.015 to 0.026 | 0.15 to 0.26 | 0.60 to 1.06 | none |
| [Modal](https://modal.com/pricing) L4 | 0.000222 a second | 0.017 to 0.031 | 0.17 to 0.31 | 0.69 to 1.23 | none |
| [Hetzner GEX45](https://www.hetzner.com/dedicated-rootserver/matrix-gpu/) | €214 a month, €209 setup, before VAT | | €214 | €214 | none |

The GPU rows take the 78 s of GPU time per hour worked out above, which
assumes an L4 is no slower than the RTX 3070 Ti of that benchmark; the higher
figure adds a guessed 60 s cold start. Modal's Starter plan includes $30 a
month, more than either volume. A YouTube hour at 60 to 70 MB is over
OpenAI's 25 MB limit and Groq's free tier limit, so it would be cut into pieces or
re-encoded to about 32 kbps (about 14 MB).

With an API the audio leaves the server. OpenAI does not train on API data by
default ([data controls](https://developers.openai.com/api/docs/guides/your-data));
Groq keeps nothing by default bar troubleshooting logs for up to 30 days
([your data](https://console.groq.com/docs/your-data)); Deepgram keeps
requests for model improvement unless each one carries `mip_opt_out=true`
([policy](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program)).

A residential proxy, the usual way past an IP block, would be MONEY too. It
is not priced here.

## YouTube's terms

The [Terms of Service](https://www.youtube.com/static?template=terms&hl=en&gl=US)
(effective 15 December 2023), under "Permissions and Restrictions", say you
may not:

> access, reproduce, download, distribute, transmit, broadcast, display, sell,
> license, alter, modify or otherwise use any part of the Service or any
> Content except: (a) as expressly authorized by the Service; or (b) with
> prior written permission from YouTube and, if applicable, the respective
> rights holders

> circumvent, disable, fraudulently engage with, or otherwise interfere with
> any part of the Service (or attempt to do any of these things), including
> security-related features or features that (a) prevent or restrict the
> copying or other use of Content or (b) limit the use of the Service or
> Content

> access the Service using any automated means (such as robots, botnets or
> scrapers) except (a) in the case of public search engines, in accordance
> with YouTube's robots.txt file; or (b) with YouTube's prior written
> permission

Under those terms, which fall under California law, downloading audio to
transcribe it breaks the first and third. PO tokens and cookies to get past a
bot check likely break the second. `<leader>cv` already sits under the third,
since youtube-transcript-api scrapes the caption endpoint.

A user living in Germany gets
[other terms](https://www.youtube.com/static?template=terms&hl=en&gl=DE)
(5 January 2022) under German law, and they add "as permitted by applicable
law" to the download and automated access clauses. So whether a download for
one's own use breaks them turns on German law, on which this page gives no
view. Either way the practical risk is a blocked IP or a banned account.

## Licenses

Each read from the project's LICENSE file, or the model card for weights.

| Tool | License |
|---|---|
| [YouTubeKit](https://raw.githubusercontent.com/alexeichhorn/YouTubeKit/main/LICENSE) | MIT |
| [yt-dlp](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE) | The Unlicense (its README says the PyInstaller binaries include GPLv3+ code) |
| [youtube-transcript-api](https://raw.githubusercontent.com/jdepoix/youtube-transcript-api/master/LICENSE) | MIT |
| [FFmpeg](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md) | LGPL 2.1 or later, GPL when built with `--enable-gpl`; every [yt-dlp FFmpeg build](https://github.com/yt-dlp/FFmpeg-Builds/wiki/Latest) is a GPL build |
| [Deno](https://raw.githubusercontent.com/denoland/deno/main/LICENSE.md) | MIT |
| [bgutil-ytdlp-pot-provider](https://raw.githubusercontent.com/Brainicism/bgutil-ytdlp-pot-provider/master/LICENSE) | GPL 3 |
| [whisper.cpp](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE) | MIT |
| [faster-whisper](https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/LICENSE) | MIT |
| [CTranslate2](https://raw.githubusercontent.com/OpenNMT/CTranslate2/master/LICENSE) | MIT |
| [onnx-asr](https://raw.githubusercontent.com/istupakov/onnx-asr/main/LICENSE) | MIT |
| [sherpa-onnx](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE) | Apache 2.0 |
| [openai/whisper](https://raw.githubusercontent.com/openai/whisper/main/LICENSE), code and weights | MIT |
| [whisper-large-v3-turbo weights](https://huggingface.co/openai/whisper-large-v3-turbo) | MIT |
| [Parakeet TDT 0.6B v3 weights](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | CC BY 4.0: credit NVIDIA |

The [whisper-small card](https://huggingface.co/openai/whisper-small) says
Apache 2.0, against MIT in the openai/whisper repo. Either allows the use.
kasten would run the GPL tools (ffmpeg, the token server) as separate
programs, not link them.

## What kasten would need

The caption route cannot grow into this. It answers inside a request, and a
transcription on this CPU takes minutes to most of an hour. The shape that
fits is the one the bank sync already has: a one-shot job in `jobs/` that
writes into kasten through its HTTP API.

1. A trigger: `<leader>cv` on a video with no captions (today's `404`)
   queues a job and says so, instead of only saying there is no transcript.
2. A job container with yt-dlp, Deno and ffmpeg, and the model, that
   downloads the audio to a temporary folder, transcribes it with low CPU
   priority, deletes the audio, and writes the lines under `## Transcript`
   in the same shape `<leader>cv` writes now, marked as machine made.
3. A way past the block if this IP has one: a PO token server, cookies, a
   residential proxy (MONEY), or a download on the user's own machine.
4. A model fetched once into a volume, never into the image. Its size on
   disk was not checked.

## Recommendation

Do not build the full chain yet. The model is the easy part: Parakeet v3 at
about 3 minutes an hour, or turbo at 35 to 45, both free on this server, and
Groq at $0.04 an hour is a fallback cheaper than any proxy. The weak link is
the download. From a Hetzner IP it is the step most likely to fail, the step
that needs the most moving parts (a JS runtime, a token server, perhaps
cookies or a proxy), and the step YouTube's terms forbid, unless German law
permits it.

The build is worth doing only after two short trials the user runs or
approves, since this task could download nothing: does yt-dlp with Deno fetch
audio from this server for a few videos, and how long does Parakeet v3 and
turbo take on ten minutes of that audio here, with prod running. If both pass,
build the job above. If the download fails, the cheap way out is to download
on the user's own machine and send kasten the audio, which also keeps the
server's IP out of it.

The build is filed as its own wish, #1196, which names the choices the user
must make: whether to accept the terms risk, where the download runs, which
model, what triggers it, and its limits.
