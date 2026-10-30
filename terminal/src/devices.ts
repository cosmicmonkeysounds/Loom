//! Which camera and microphone a stream opens (wave 52). The server room's
//! USB webcam is both, and Windows' default microphone is whatever it last
//! decided, so `config.webcam` names the device (part of its name, "C310")
//! and `camera.ts` and `voice/mic.ts` open that one. A device that's gone
//! falls back to the default: a scanner on the wrong camera beats no scanner.
//!
//! Names are blank until the page's first grant for that kind of device, so
//! with none to match the default opens first (that's the prompt), and the
//! named one takes over as soon as the names are readable.

export interface DeviceLike {
  kind: string;
  deviceId: string;
  label: string;
}

export type DeviceList = () => Promise<readonly DeviceLike[]>;

export function browserDevices(): Promise<readonly DeviceLike[]> {
  return navigator.mediaDevices.enumerateDevices();
}

/** Windows lists a device a second time under these two ids. */
const ALIASES = ["default", "communications"];

/** The device of `kind` whose name holds `label` (any case), or null. */
export function deviceFor(devices: readonly DeviceLike[], kind: string, label: string): DeviceLike | null {
  const want = label.trim().toLowerCase();
  if (want === "") return null;
  return devices.find((d) => d.kind === kind && !ALIASES.includes(d.deviceId) && d.label.toLowerCase().includes(want)) ?? null;
}

async function listed(list: DeviceList): Promise<readonly DeviceLike[]> {
  try {
    return await list();
  } catch {
    return [];
  }
}

function stop(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}

/** The device a stream is really on, when it can say. */
function deviceOf(stream: MediaStream): string | undefined {
  return stream.getTracks()[0]?.getSettings?.().deviceId;
}

interface OpenRequest {
  kind: string;
  label: string;
  list: DeviceList | null;
  /** `open(null)` is the default device. */
  open: (deviceId: string | null) => Promise<MediaStream>;
}

async function openNamed(o: OpenRequest, list: DeviceList): Promise<MediaStream> {
  const known = deviceFor(await listed(list), o.kind, o.label);
  if (known !== null) return o.open(known.deviceId).catch(() => o.open(null));
  const stream = await o.open(null);
  const named = deviceFor(await listed(list), o.kind, o.label);
  if (named === null || deviceOf(stream) === named.deviceId) return stream;
  // A camera often won't open twice: let go of the default first.
  stop(stream);
  return o.open(named.deviceId).catch(() => o.open(null));
}

/** Open the named device. No name: straight to the default, as every other terminal always has. */
export function openDevice(o: OpenRequest): Promise<MediaStream> {
  return o.label.trim() === "" || o.list === null ? o.open(null) : openNamed(o, o.list);
}
