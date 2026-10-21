//! The idle show's little pictures (wave 17): one 32-px glyph per ad art
//! and popup icon, original vector art in the Win98 manner (flat fills,
//! black outlines, crisp edges). The dialog icons are the cutscene kit's.

import type { ReactNode } from "react";
import { Win98Icon } from "../cutscene/kit/win98.tsx";
import type { AdArt } from "./ads.ts";
import type { PopupIcon } from "./popups.ts";

const K = "#000";

const ART: Record<string, ReactNode> = {
  duck: (
    <>
      <ellipse cx="15" cy="21" rx="11" ry="7" fill="#ffd21f" stroke={K} />
      <circle cx="22" cy="11" r="6" fill="#ffd21f" stroke={K} />
      <path d="M27 10 L31 12 L27 14 Z" fill="#ff8a00" stroke={K} strokeWidth="0.8" />
      <rect x="22.5" y="8.5" width="2" height="2" fill={K} />
      <path d="M6 20 Q10 24 16 22" fill="none" stroke="#c99a00" strokeWidth="1.5" />
    </>
  ),
  coin: (
    <>
      <circle cx="16" cy="16" r="13" fill="#ffcc00" stroke={K} strokeWidth="1.5" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#b38600" strokeWidth="1.5" />
      <path d="M16 9 V23 M12 12.5 H20 M12 19.5 H20" stroke="#7a5b00" strokeWidth="2.2" />
    </>
  ),
  ram: (
    <>
      <rect x="2" y="10" width="28" height="11" fill="#1f7a3a" stroke={K} />
      {[5, 11, 17, 23].map((x) => (
        <rect key={x} x={x} y="12" width="4" height="6" fill="#111" />
      ))}
      {[3, 6, 9, 12, 15, 18, 21, 24, 27].map((x) => (
        <rect key={x} x={x} y="21" width="1.6" height="3" fill="#ffcc00" />
      ))}
    </>
  ),
  clock: (
    <>
      <circle cx="16" cy="16" r="13" fill="#fff" stroke={K} strokeWidth="2" />
      <path d="M16 8 V16 L22 19" fill="none" stroke={K} strokeWidth="2.4" />
      <circle cx="16" cy="16" r="1.6" fill="#ff0000" />
    </>
  ),
  trophy: (
    <>
      <path d="M9 4 H23 V12 Q23 19 16 19 Q9 19 9 12 Z" fill="#ffcc00" stroke={K} />
      <path d="M9 7 H4 Q4 13 9 13 M23 7 H28 Q28 13 23 13" fill="none" stroke={K} strokeWidth="1.5" />
      <rect x="14" y="19" width="4" height="5" fill="#c99a00" stroke={K} strokeWidth="0.8" />
      <rect x="9" y="24" width="14" height="4" fill="#8a5a00" stroke={K} />
    </>
  ),
  modem: (
    <>
      <rect x="2" y="12" width="28" height="10" fill="#d9d9d9" stroke={K} />
      {[6, 10, 14, 18].map((x, i) => (
        <circle key={x} cx={x} cy="17" r="1.6" fill={i % 2 === 0 ? "#33ff33" : "#ff3333"} />
      ))}
      <path d="M22 8 Q26 4 30 8 M23 10 Q26 7 29 10" fill="none" stroke={K} strokeWidth="1.3" />
    </>
  ),
  star: <path d="M16 2 L20 12 L31 12 L22 19 L25 30 L16 23 L7 30 L10 19 L1 12 L12 12 Z" fill="#ffdd00" stroke={K} strokeWidth="1.2" />,
  printer: (
    <>
      <rect x="8" y="3" width="16" height="9" fill="#fff" stroke={K} />
      <rect x="3" y="11" width="26" height="11" fill="#c0c0c0" stroke={K} />
      <rect x="8" y="19" width="16" height="10" fill="#fff" stroke={K} />
      <path d="M10 23 H22 M10 26 H19" stroke="#808080" />
      <circle cx="25" cy="15" r="1.4" fill="#33ff33" />
    </>
  ),
  shield: (
    <>
      <path d="M16 2 L28 6 V15 Q28 25 16 30 Q4 25 4 15 V6 Z" fill="#1d5fd6" stroke={K} strokeWidth="1.5" />
      <path d="M10 16 L14 20 L22 11" fill="none" stroke="#fff" strokeWidth="3" />
    </>
  ),
  bean: (
    <>
      <path d="M9 6 Q19 2 23 12 Q27 24 15 27 Q5 29 6 18 Q7 12 12 13 Q15 14 13 9 Z" fill="#8b3a1a" stroke={K} />
      <path d="M12 18 Q16 21 20 16" fill="none" stroke="#d9845a" strokeWidth="1.5" />
    </>
  ),
  cloud: <path d="M8 24 Q2 24 3 18 Q4 13 10 14 Q11 6 19 7 Q26 8 25 14 Q31 15 29 21 Q28 24 24 24 Z" fill="#fff" stroke="#3a6ea5" strokeWidth="1.6" />,
  face: (
    <>
      <circle cx="16" cy="16" r="13" fill="#0a1210" stroke="#33ff77" strokeWidth="2" />
      <rect x="10" y="11" width="3" height="5" fill="#33ff77" />
      <rect x="19" y="11" width="3" height="5" fill="#33ff77" />
      <path d="M10 20 Q16 25 22 20" fill="none" stroke="#33ff77" strokeWidth="2" />
    </>
  ),
  cd: (
    <>
      <circle cx="16" cy="16" r="14" fill="#dfe8f5" stroke={K} />
      <path d="M16 2 A14 14 0 0 1 30 16 L20 16 A4 4 0 0 0 16 12 Z" fill="#ff9be6" opacity="0.8" />
      <path d="M2 16 A14 14 0 0 0 16 30 L16 20 A4 4 0 0 1 12 16 Z" fill="#9bf0ff" opacity="0.8" />
      <circle cx="16" cy="16" r="4" fill="#fff" stroke={K} />
    </>
  ),
  pong: (
    <>
      <path d="M5 14 L9 29 H17 L21 14 Z" fill="#ff3b30" stroke={K} />
      <path d="M13 12 L16 27 H23 L26 12 Z" fill="#ff6b5e" stroke={K} />
      <circle cx="24" cy="6" r="3.5" fill="#fff" stroke={K} />
    </>
  ),
  chart: (
    <>
      <rect x="2" y="2" width="28" height="28" fill="#fff" stroke={K} />
      <rect x="6" y="18" width="5" height="9" fill="#ff3b30" />
      <rect x="13.5" y="11" width="5" height="16" fill="#ffcc00" />
      <rect x="21" y="6" width="5" height="21" fill="#34c759" />
    </>
  ),
  floppy: (
    <>
      <path d="M3 3 H26 L29 6 V29 H3 Z" fill="#2b2b8f" stroke={K} />
      <rect x="9" y="3" width="13" height="9" fill="#c0c0c0" />
      <rect x="17" y="4.5" width="3" height="6" fill="#2b2b8f" />
      <rect x="7" y="17" width="18" height="12" fill="#fff" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1" y="10" width="30" height="14" rx="1.5" fill="#d9d9d9" stroke={K} />
      {[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5].map((c) => <rect key={`${r}${c}`} x={3.5 + c * 4.3} y={12 + r * 3.7} width="3.2" height="2.6" fill="#fff" stroke="#808080" strokeWidth="0.5" />))}
    </>
  ),
  map: (
    <>
      <path d="M2 6 L11 3 L21 6 L30 3 V26 L21 29 L11 26 L2 29 Z" fill="#f2e6b8" stroke={K} />
      <path d="M11 3 V26 M21 6 V29" stroke="#a08c4a" />
      <path d="M5 20 Q12 12 18 17 T27 10" fill="none" stroke="#ff3b30" strokeWidth="1.6" strokeDasharray="2 1.5" />
      <circle cx="27" cy="10" r="2" fill="#ffd21f" stroke={K} strokeWidth="0.8" />
    </>
  ),
  cookie: (
    <>
      <circle cx="16" cy="16" r="13" fill="#d8a25a" stroke={K} />
      {[
        [10, 10],
        [20, 9],
        [14, 17],
        [22, 19],
        [11, 23],
        [18, 25],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.8" fill="#3b1d0a" />
      ))}
    </>
  ),
  bolt: <path d="M18 1 L5 18 H14 L11 31 L27 12 H17 Z" fill="#ffdd00" stroke={K} strokeWidth="1.2" />,
  toilet: (
    <>
      <rect x="6" y="3" width="13" height="9" fill="#fff" stroke={K} />
      <path d="M4 13 H26 Q26 22 17 22 L19 29 H10 L12 22 Q4 22 4 13 Z" fill="#fff" stroke={K} />
      <ellipse cx="15" cy="15" rx="7" ry="2" fill="#bfe6ff" />
    </>
  ),
  pager: (
    <>
      <rect x="4" y="8" width="24" height="17" rx="2" fill="#2d2d2d" stroke={K} />
      <rect x="7" y="11" width="18" height="7" fill="#9fdc5a" />
      <path d="M9 15 H13 M15 15 H22" stroke="#2d4d10" strokeWidth="1.6" />
      <circle cx="10" cy="21.5" r="1.4" fill="#c0c0c0" />
    </>
  ),
  dice: (
    <>
      <rect x="3" y="7" width="17" height="17" rx="2" fill="#fff" stroke={K} transform="rotate(-12 11 15)" />
      <rect x="14" y="10" width="15" height="15" rx="2" fill="#ff3b30" stroke={K} transform="rotate(10 21 17)" />
      <circle cx="8" cy="12" r="1.6" fill={K} />
      <circle cx="14" cy="18" r="1.6" fill={K} />
      <circle cx="21" cy="17" r="1.6" fill="#fff" />
    </>
  ),
  chat: (
    <>
      <path d="M3 5 H29 V21 H14 L7 28 V21 H3 Z" fill="#fff8b0" stroke={K} />
      <circle cx="10" cy="13" r="1.8" fill={K} />
      <circle cx="16" cy="13" r="1.8" fill={K} />
      <circle cx="22" cy="13" r="1.8" fill={K} />
    </>
  ),
};

/** The kit's dialog icons, by name. */
const KIT = new Set(["error", "warning", "info", "question", "computer", "mail", "globe"]);

/** One glyph, `size` a CSS length. */
export function IdleArt({ kind, size = "2em", className }: { kind: AdArt | PopupIcon; size?: string; className?: string }) {
  if (KIT.has(kind)) return <Win98Icon kind={kind as "error"} size={size} className={className} />;
  const art = ART[kind];
  if (art === undefined) return <Win98Icon kind="info" size={size} className={className} />;
  return (
    <svg className={`idle-art${className ? ` ${className}` : ""}`} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      {art}
    </svg>
  );
}
