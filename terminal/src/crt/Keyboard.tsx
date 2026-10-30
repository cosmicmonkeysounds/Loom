//! The CRT's virtual keyboard (wave 52b): hold Start while it asks for a pass,
//! and a program name goes in with the stick and A. It holds the controller
//! while it's up (`grabPad`), and B deletes a letter, then closes it.

import { useEffect, useRef, useState } from "react";
import { grabPad } from "../gamepad/pad.ts";
import { KEY_ROWS, keyMoved, keyPressed, type KeyAt } from "./prompt.ts";

export function CrtKeyboard({ onDone, onClose, onActivity }: { onDone: (text: string) => void; onClose: () => void; onActivity: () => void }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState<KeyAt>({ row: 0, col: 0 });
  const live = useRef({ text, at, onDone, onClose, onActivity });
  live.current = { text, at, onDone, onClose, onActivity };
  const press = (key: string) => {
    const r = keyPressed(live.current.text, key);
    setText(r.text);
    if (r.done && r.text.trim() !== "") live.current.onDone(r.text);
  };
  useEffect(
    () =>
      grabPad((e) => {
        live.current.onActivity();
        const now = live.current;
        if (e.t === "move") setAt(keyMoved(now.at, 0, e.dir));
        else if (e.t === "side") setAt(keyMoved(now.at, e.dir, 0));
        else if (e.t === "select") press(KEY_ROWS[now.at.row]![now.at.col]!);
        else if (e.t === "back") {
          if (now.text === "") now.onClose();
          else setText(now.text.slice(0, -1));
        }
      }),
    [],
  );
  return (
    <div className="crt-keys">
      <div className="crt-keys-head">TYPE YOUR PROGRAM NAME</div>
      <div className="crt-keys-text">&gt; {text}_</div>
      {KEY_ROWS.map((row, r) => (
        <div className="crt-keys-row" key={r}>
          {row.map((key, c) => (
            <button type="button" key={key} className={`crt-key${key.length > 1 ? " wide" : ""}`} data-lit={r === at.row && c === at.col ? "" : undefined} onClick={() => press(key)}>
              {key}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
