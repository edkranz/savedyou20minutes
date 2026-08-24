# Privacy Policy — Saved You 20 Minutes

**Last updated: 24 August 2026**

Short version: there is no server. I never receive your data, because there is
nowhere for it to be sent to me. Everything below is a description of what your
own browser does.

## What the extension sends, and when

Nothing is transmitted until you click **Worth it?** on a video (or the button
on the watch page). Browsing YouTube with the extension installed sends nothing.

When you do click, two requests happen:

1. **To YouTube** — to fetch that video's caption track. This is the same
   public data YouTube already serves to the page you are on, and is sent
   without your cookies, so it is not tied to your YouTube account.

2. **To the AI provider you configured** — Anthropic, OpenAI, or Google,
   whichever one you chose. This request contains:
   - the video's title
   - the channel name
   - the video's duration, rounded to minutes
   - the transcript text
   - the transcript's language code, only when it is not English
   - your API key, as the authentication header

   That is the complete list. No browsing history, no other tabs, no
   identifiers, nothing about you.

Only the provider you selected is contacted. The other two receive nothing.

## What is stored, and where

Everything is stored locally in your browser's extension storage. Nothing is
synced, uploaded, or backed up anywhere by this extension.

- **Your API keys**, so you don't re-enter them. They are sent only to the
  matching provider, as authentication. They are held in the background script
  and are never exposed to any web page, including YouTube.
- **Your settings** — chosen provider, model, and whether to show verdicts on
  thumbnails you have already summarised.
- **A cache of summaries**, keyed by video ID, capped at 500 entries with the
  oldest evicted first. This is what stops you paying twice for the same video.

You can erase all of it at any time: **Settings → Clear cache** removes the
summaries, and uninstalling the extension removes everything, keys included.

## What the extension does not do

- No analytics, telemetry, crash reporting, or usage statistics.
- No advertising, and no data sold or shared with anyone.
- No tracking of what you watch or search for.
- No account, no sign-up, no server operated by me — none exists to run.

## The AI provider is a separate relationship

The provider you choose receives your transcript and processes it under **their**
terms and privacy policy, using **your** API key and account. I am not a party
to that. If retention matters to you, read the policy of whichever you pick:

- Anthropic — https://www.anthropic.com/legal/privacy
- OpenAI — https://openai.com/policies/privacy-policy
- Google — https://policies.google.com/privacy

API providers generally treat their paid API traffic differently from their
consumer chat products, but that is their commitment to you, not mine, and it
can change. Choosing the provider is the point at which you decide who sees
your transcripts.

## Changes

Material changes will be published here and in the extension's listing, with
the date above updated.

## Contact

Questions or problems: https://github.com/edkranz/savedyou20minutes/issues
