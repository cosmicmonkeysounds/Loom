//! A wall terminal's link to the reinstallation games (wave 59): what can go
//! wrong with its camera and the games' stream, in the words ⚙ and Run →
//! Terminals both show. The heartbeat's `ce=` carries the code, so a tablet on
//! a wall says what's wrong from across the house.

export const LINK_ERRORS = {
  cam_denied: "the camera was refused: allow it for this site in Chrome, then reload",
  cam_insecure: "the camera needs the https address",
  cam_none: "no camera on this device",
  cam_error: "the camera failed to open",
  no_frames: "the camera opened but no picture has arrived",
  blank: "the camera's pictures are blank",
  no_spot: "the house map has no such spot",
  refused: "the server refused this terminal",
  too_big: "a frame was too big",
  http: "the server answered with an error",
  offline: "the server can't be reached",
  stream_down: "the games' stream dropped",
} as const;

export type LinkError = keyof typeof LINK_ERRORS;

export function isLinkError(v: unknown): v is LinkError {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LINK_ERRORS, v);
}

/** The highest rate the heartbeat carries (frames per second). */
export const LINK_RATE_MAX = 99.9;
