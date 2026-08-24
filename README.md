# Saved You 20 Minutes

A Firefox (and Chrome) extension that reads a YouTube video's transcript and tells you, in one line, whether it's worth watching — and what the clickbait was hiding.

Hover any thumbnail, click **Worth it?**, and you get the payoff the title was dangling, a WORTH IT / SKIM IT / SKIP IT verdict, and the two or three things the video actually says. Spoiling the video is the point.

## Install

**Firefox** (128+)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `manifest.json` in this folder
3. Click the toolbar icon → **Settings** → paste an API key

Temporary add-ons are cleared when Firefox restarts. To install permanently you need a signed build (`web-ext sign`) or Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

**Chrome / Edge**

1. Open `chrome://extensions`, turn on **Developer mode**
2. **Load unpacked** → pick this folder

The same `manifest.json` covers both: Chrome reads `background.service_worker`, Firefox reads `background.scripts`, and each ignores the other's key.

## Bring your own key

Pick one provider in Settings and paste its key:

| Provider | Default model | Get a key |
|---|---|---|
| Anthropic | `claude-haiku-4-5` | https://console.anthropic.com/settings/keys |
| OpenAI | `gpt-4.1-mini` | https://platform.openai.com/api-keys |
| Google Gemini | `gemini-2.5-flash` | https://aistudio.google.com/apikey |

The default is Claude Haiku 4.5 because this runs per-video on demand and the job — read a transcript, answer one question — is well within a small model. Sonnet 5 and Opus 5 are in the dropdown if you want sharper judgement on the "is this actually worth it" call. **Test key** in Settings does a one-token round trip so you can check it works before spending anything on a video.

Roughly: a 6-minute video is about 1,100 tokens of transcript, a 20-minute one about 4,000. On Haiku that's well under a cent per video, and every summary is cached so you only pay once per video ever.

Your key is stored in extension storage and only ever sent to the provider you chose. It lives in the background script, never in a content script, so no page — YouTube included — can read it.

**What leaves your browser.** When you click *Worth it?* on a video, that video's title, channel and transcript are sent to the AI provider you configured. Nothing else, nowhere else — there is no server of mine involved, and nothing is sent until you click. The manifest declares this to Firefox as `websiteContent` (the transcript and title are page content) and `browsingActivity` (sending them identifies the video you're looking at). Summaries are cached locally in your browser.

## How it gets the transcript

This is the part that took the most work, and it's worth writing down.

YouTube's caption URLs used to be sitting in the watch page HTML. Since 2025 they still are, but **they return an empty 200** — the signature attached to the WEB client's `baseUrl` no longer produces content. Scraping `ytInitialPlayerResponse` gets you a URL that silently yields nothing, which is a fun way to spend an afternoon.

The `ANDROID` InnerTube client (`POST /youtubei/v1/player`) still returns caption URLs that fetch normally, and it works under the two constraints an extension actually has:

- **no custom `User-Agent`** — `fetch()` refuses to set it
- **no cookies** — the request goes out with `credentials: 'omit'`, so it isn't tied to your account

The same call also returns title, channel and duration, so one request gets both the metadata and the captions.

There is a second trap behind the first. That player endpoint returns **403 to any request carrying a non-YouTube `Origin` header** — and browsers attach `Origin: moz-extension://…` (or `chrome-extension://…`) to every POST a background script makes. This is invisible to `curl` and Node, which send no `Origin` at all, so it passes every test you can write outside a browser and then fails the moment you load the extension. `X-Origin`, `Referer` and the `youtubei.googleapis.com` host were all tried; all 403.

The fix is `src/content/yt-bridge.js`, a MAIN-world content script. It runs in the page's own JS context, where the origin genuinely is `youtube.com`, so the call succeeds. The chain is background → content script → page → back. Only that one call needs it: the caption download itself accepts any origin and stays in the background script.

That split is deliberate rather than incidental — the MAIN world is visible to the page, so only the public metadata call happens there. The API key never leaves the background script.

Auto-generated caption XML interleaves "rolling" duplicate lines (marked `a="1"`) — the half-line repeats that make live captions scroll. Left in, they roughly double the transcript and read like a stutter, so they're dropped. Parsing is regex-based rather than `DOMParser`-based because Chrome's MV3 background is a service worker and has no `DOMParser`.

For very long videos the transcript is thinned to fit the token budget by dropping evenly-spaced cues rather than truncating the tail — the payoff of a clickbait video is usually held back until the final minutes, and that payoff is the single thing this extension exists to extract.

## The prompt

`src/lib/prompt.js` is the product; everything else is plumbing. The rules it enforces:

- **Answer the title's implicit promise first**, concretely. If the title asks a question, answer it. If it teases a reveal, state the reveal. Never "the video explains…" — that describes the video instead of delivering it.
- **Judge the verdict against the summary, not against nothing.** The reader has already read the takeaways; the only question left is what watching adds on top.
- **Snark is earned, not default.** Tone is informative first; the model is only allowed to be dry and pointed at bait 4–5, and then one line at most, aimed at the framing rather than the person.
- **Stay grounded.** Everything comes from the transcript, no outside knowledge filling gaps. Auto-captions garble names and numbers, so mangled terms get a reconstruction marked `(?)` rather than a silent confident correction.

Output is forced through a JSON schema on all three providers — forced tool use on Anthropic, strict `json_schema` on OpenAI, `responseSchema` on Gemini — so the UI never has to parse prose.

## Layout

```
manifest.json
src/
  background.js          orchestrator; owns the API key and all network calls
  lib/
    innertube.js         ANDROID InnerTube client + caption track selection
    transcript.js        timedtext parsing, flattening, thinning
    prompt.js            system prompt + result schema
    cache.js             per-video cache in storage.local, 500-entry LRU
    settings.js          provider registry and stored settings
    providers/           anthropic.js, openai.js, gemini.js
  content/
    yt-bridge.js         MAIN-world shim: the one call needing a youtube.com origin
    content.js           thumbnail badges, popover, watch-page panel
  options/               settings page
  popup/                 toolbar popup
```

UI renders inside a shadow root — YouTube restyles the page aggressively and ships its own `.badge` / `.title` / `.chip` classes.

## Known limits

- **No captions, no summary.** Some videos genuinely have none, and there's nothing to fall back on short of downloading audio and transcribing it.
- Age-restricted and members-only videos are refused by the InnerTube call, since it deliberately sends no cookies.
- Live streams have no transcript until they end.
- The ANDROID client version string in `innertube.js` is the sort of thing YouTube can invalidate. If transcripts stop resolving, that constant is the first place to look.
