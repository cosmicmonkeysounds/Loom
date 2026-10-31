# Wave 54: through their eyes

A placed terminal linked to its room shows the room through the eyes of the
program in it. When that program comes close to the terminal, or into its
view, the terminal goes back to its mirror. Both games get it for free: the
picture is the terminal's own, drawn from the pose stream, so nothing changes
in the web game, the VR game, the server or the story.

All new show text is `DRAFT w54` (sheet: `SIGNOFF-w54.md`). Branch
`oct31-w54/terminal-eyes`.

## C1. The rule

`terminal/src/world/eyes.ts`, pure, one judge per mounted picture:

- **Seen** (`seenBy`): on the terminal's floor, with no wall between its
  camera and the body, and within `CLOSE_M` (1.5 m, any direction) or within
  `IN_VIEW_M` (2.5 m) inside the horizontal fov at 16:10. Anyone seen brings
  the mirror, in that room or not.
- **The mirror** goes on at once. It comes off `MIRROR_HOLD_MS` (2 s) after
  the last sighting, and the ranges stretch by `SEEN_SLACK` (1.25) meanwhile.
- **The wearer** is the freshest program in the room, kept while they stay and
  for `PRESENCE_LINGER_MS` (3 s) after they leave it.

The ranges were picked on the show's map: a walker is out of sight in 42% of
the smallest linked room (`optical-drive`) and 74-95% of the others; at the
first try of 1.75 / 3.5 m the Optical Drive was 13%. `test/eyes.test.ts` holds
every wall's room above 20%.

## C2. What the mirror is

Whatever that terminal drew before this wave: the shadow (the camera with the
ghosts in it) on an awake `auto` wall with a live camera or `view=shadow`,
else the window into the virtual room. Linking is unchanged (`linkedNow`): the
eyes only choose the picture of a terminal that is already linked, so its voice
link and its camera feed to the games carry on underneath.

`WorldSlot` and `ShadowSlot` (`app.tsx`) hold `useEyes`, so the walls, the
TV, `view=mirror` and `view=shadow` all follow one rule. A shadow gives way
to the world view while eyes are on, which swaps a GL context; that is why the
mirror's hold exists. A terminal with no spot never wears anyone.

## C3. The picture

`director.ts`: the `eyes` shot, `eyesCamera` (the feet + `EYE_HEIGHT` 1.6,
the pose's yaw and pitch, `EYES_FOV` 70, under the ceiling), smoothed at
`EYES_SMOOTH` for a headset's jitter; a change of shot is a cut. The wearer's
ghost is hidden. The tablet's own screen shows in the room. The raycaster draws
the same with `eyeCamera` for a tablet with no WebGL2.

It is a redraw from the pose, not a copy of the player's screen: the terminal's
own world, so no HUD, trail, lamps or descent visions. In the Hallway the pose
stays at the door, so the picture holds there.

## C4. Deploy

A terminal bundle only: ship, then reload every terminal and the TV. No
`sync-show`, no APK, nothing on the Desktop or the MacBook.
