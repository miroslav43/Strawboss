# `baler-exit.wav` — sound asset

**Status:** **TBD** — actual `.wav` file is not yet committed (Plan B agent
could not download external assets from the sandbox). The expo-notifications
plugin config in `app.json` already references `./assets/sounds/baler-exit.wav`
and `notifications.ts` registers the `baler-exit` Android channel with
`sound: 'baler_exit'`. Once the file lands the plugin will copy it into
`android/app/src/main/res/raw/baler_exit.wav` at build time.

## Requirements

| Property      | Value                              |
| ------------- | ---------------------------------- |
| Container     | WAV (PCM)                          |
| Sample rate   | 44.1 kHz                           |
| Bit depth     | 16-bit                             |
| Channels      | Mono                               |
| Duration      | 1 – 2 seconds (loud horn / klaxon) |
| Loudness      | -12 LUFS or louder, no clipping    |
| File name     | `baler-exit.wav` (dash, not space) |
| License       | CC0 / Public Domain                |

## Suggested source

- **freesound.org** — query: `air horn short`, `truck horn` — pick a sound
  tagged `Creative Commons 0` (CC0) so we have unrestricted redistribution.
- Recommended candidates (verify license at download time):
  - <https://freesound.org/people/InspectorJ/sounds/352208/> ("Air Horn,
    Single, A.wav") — short, very loud, attribution required (not CC0).
  - <https://freesound.org/people/Soughtaftersounds/sounds/145436/> (search
    "air horn cc0").

## Drop-in instructions

1. Download the WAV from the source.
2. Re-encode to 16-bit / 44.1 kHz / mono if needed:
   ```bash
   ffmpeg -i input.wav -ar 44100 -ac 1 -sample_fmt s16 baler-exit.wav
   ```
3. Place at `apps/mobile/assets/sounds/baler-exit.wav`.
4. Rebuild the Android app (`./strawboss.sh mobile-build-local` or `eas
   build --profile preview --platform android`) — the plugin run copies the
   asset to `android/app/src/main/res/raw/baler_exit.wav` (note Android
   replaces dashes with underscores in resource names).
5. Verify on a real device by triggering `/api/v1/notifications/simulate-push`
   with event `field_exit_production`.

## Fallback behaviour today (no asset)

- Android: the channel exists but the missing sound falls back to the device
  default notification tone. Vibration pattern + bypass-DND still fire.
- iOS: standard notification sound; the foreground screen plays an extra
  warning haptic on mount (see `production-entry.tsx`).
