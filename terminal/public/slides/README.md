# Slides (OCT31 K-17)

Drop the TV / terminal slide PNGs here, named after the cue (DESIGN.md §2.13):
`screens_call_desktop.png`, `tv_bingo.png`, `tv_bingo_time.png`, `screens_trivia_1.png`, …
(the bare value — `trivia_1.png` — works too). Served at `/terminal/slides/<name>.png`.
A missing PNG renders a Win98 text card, never a broken image. `screens_y2k` is always
drawn live (the clock), so it needs no PNG. 16:9, 1920×1080.

**TV clips (N-04a, optional).** On the TV (`view=tv`) only, a slide first plays
`<cue>.mp4` (else `<value>.mp4`) from this folder — e.g. `screens_ad_hijack.mp4` —
once, with sound unless the director muted the TV voice, then shows the PNG / text
card. No mp4 = no change. H.264 MP4, short (under the TV's 90 s slide hold) and
small: it is served whole from the VPS. The wall tablets never play video.
