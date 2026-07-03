# NanoHTTPD reflects on nothing we ship; keep defaults. Minify is off in release
# for this small app, so these are mostly a safety net if it is ever turned on.
-keep class fi.iki.elonen.** { *; }
-dontwarn fi.iki.elonen.**
