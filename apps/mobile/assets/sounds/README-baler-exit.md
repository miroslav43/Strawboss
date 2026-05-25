# `baler_exit.wav` — sound asset

**Status:** **TBD** — actual `.wav` file is not yet committed (Plan B agent
could not download external assets from the sandbox). Until it lands, the
`expo-notifications` plugin entry in `app.json` does NOT declare any custom
sounds, and the Android `baler-exit` channel (registered in
`src/lib/notifications.ts`) falls back to the device default tone — see
"Fallback behaviour" below. The channel still bypasses DND and uses the
strong vibration pattern.

## Why no hyphen in the filename

`expo-notifications` validates each sound filename against Android's resource
naming rules (lowercase a-z, digits, underscore only — no dashes, no Java
reserved words). `baler-exit.wav` fails validation at `expo prebuild` time
with:

```
[expo-notifications] Resource name "baler-exit" is not valid.
```

The channel **ID** (`baler-exit` in `notifications.ts`) is fine — only the
resource **file name** is restricted. Pick `baler_exit.wav` when you drop
the file in.

## Requirements

| Property      | Value                              |
| ------------- | ---------------------------------- |
| Container     | WAV (PCM)                          |
| Sample rate   | 44.1 kHz                           |
| Bit depth     | 16-bit                             |
| Channels      | Mono                               |
| Duration      | 1 – 2 seconds (loud horn / klaxon) |
| Loudness      | -12 LUFS or louder, no clipping    |
| File name     | `baler_exit.wav` (underscore!)     |
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
   ffmpeg -i input.wav -ar 44100 -ac 1 -sample_fmt s16 baler_exit.wav
   ```
3. Place at `apps/mobile/assets/sounds/baler_exit.wav` (underscore — see
   above).
4. Re-enable the sound in `apps/mobile/app.json` — change the
   `expo-notifications` plugin entry to:
   ```json
   [
     "expo-notifications",
     {
       "color": "#0A5C36",
       "sounds": ["./assets/sounds/baler_exit.wav"]
     }
   ]
   ```
5. Rebuild the Android app (`./strawboss.sh mobile-build-local release` or
   `eas build --profile preview --platform android`). The plugin copies the
   asset to `android/app/src/main/res/raw/baler_exit.wav` at build time, and
   the channel's `sound: 'baler_exit'` in `notifications.ts` will pick it up.
6. Verify on a real device by triggering `/api/v1/notifications/simulate-push`
   with event `field_exit_production`.

## Fallback behaviour today (no asset)

- Android: the channel exists but the missing sound falls back to the device
  default notification tone. Vibration pattern + bypass-DND still fire.
- iOS: standard notification sound; the foreground screen plays an extra
  warning haptic on mount (see `production-entry.tsx`).
