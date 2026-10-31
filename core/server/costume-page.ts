//! The Task Manager costume's page (wave 59, `docs/trapped/costume.md`): three
//! beige keys and a Windows 95 dialog, for an iPad 2 on iOS 9.3.5 Safari, the
//! newest it gets. The terminal bundle can't run there, so this is hand-written
//! and has no build step, on the pattern of `cards-page.ts`: an HTML shell, a
//! stylesheet and a script, each its own same-origin file (iOS 9 knows no CSP2
//! nonce).
//!
//! **The script is ES5 and must stay ES5**: no `let`, `const`, arrows, classes,
//! template strings, modules or `fetch`; XMLHttpRequest and `addEventListener`.
//! The stylesheet has no grid, no `gap`, no custom properties and no web fonts.
//! `test/w59-costume-page.test.ts` parses the script as ES5 and reads the
//! stylesheet for those. The page holds no secret: the link carries the token
//! (`?e=<event>&k=<token>`), and behind the MacBook's relay
//! (`scripts/house-macbook/costume-relay.mjs`) it carries neither and the relay
//! adds them. `?test=1` lets a click latch a key, since a mouse can't chord.

import type { ServerResponse } from "node:http";

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Task Manager</title>
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="Task Manager">
<meta name="format-detection" content="telephone=no">
<link rel="stylesheet" href="/costume.css">
</head>
<body>
<div id="app">
  <div id="keys">
    <div id="led"></div>
    <div class="key" id="k-ctrl" data-key="ctrl"><span>CTRL</span></div>
    <div class="key" id="k-alt" data-key="alt"><span>ALT</span></div>
    <div class="key" id="k-del" data-key="del"><span>DELETE</span></div>
  </div>
  <div id="menu" class="hidden">
    <div id="dlg">
      <div id="bar"><span id="title">Close Program</span><span id="x">x</span></div>
      <div id="list"></div>
      <div id="status"></div>
    </div>
  </div>
</div>
<script src="/costume.js"></script>
</body>
</html>
`;

const CSS = `
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#2b2a27}
body{position:fixed;top:0;left:0;right:0;bottom:0;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:rgba(0,0,0,0);-webkit-text-size-adjust:none}
.hidden{display:none}
#app{position:absolute;top:0;left:0;right:0;bottom:0}

#keys{position:absolute;top:0;left:0;right:0;bottom:0;background:#a9a28c;background-image:-webkit-linear-gradient(top,#bdb6a0,#97907a);background-image:linear-gradient(to bottom,#bdb6a0,#97907a)}
#led{position:absolute;top:1%;right:1.5%;width:14px;height:14px;border-radius:7px;background:#4a4636;border:1px solid #6d6753}
#led.on{background:#39ff14;border-color:#1f8f0b}
.key{position:absolute;box-sizing:border-box;-webkit-box-sizing:border-box;border-radius:18px;border:3px solid #6f6955;border-bottom-width:16px;border-right-width:9px;
  background:#e7dfc9;background-image:-webkit-linear-gradient(top,#f4eedd,#d9d1b9);background-image:linear-gradient(to bottom,#f4eedd,#d9d1b9);color:#37342b}
.key.on{background:#ffcf3f;background-image:none;border-bottom-width:5px;border-right-width:5px;color:#000;-webkit-box-shadow:0 0 34px 8px #ffcf3f;box-shadow:0 0 34px 8px #ffcf3f}
.key span{position:absolute;left:0;right:0;top:50%;margin-top:-.62em;text-align:center;font-weight:bold;font-size:60px;line-height:1.2;letter-spacing:.02em}

/* Landscape: the three in a row, as on the keyboard. */
#k-ctrl{left:2%;top:7%;width:29%;height:87%}
#k-alt{left:33%;top:7%;width:29%;height:87%}
#k-del{left:64%;top:7%;width:34%;height:87%}
/* Portrait: CTRL and ALT over a wide DELETE. */
@media (orientation:portrait){
  #k-ctrl{left:3%;top:4%;width:45%;height:45%}
  #k-alt{left:52%;top:4%;width:45%;height:45%}
  #k-del{left:3%;top:52%;width:94%;height:44%}
  .key span{font-size:76px}
}

#menu{position:absolute;top:0;left:0;right:0;bottom:0;background:#008080}
#dlg{position:absolute;top:2.5%;left:2.5%;right:2.5%;bottom:2.5%;background:#c0c0c0;border:3px solid;border-color:#fff #000 #000 #fff;
  -webkit-box-shadow:inset -2px -2px 0 #808080,inset 2px 2px 0 #dfdfdf;box-shadow:inset -2px -2px 0 #808080,inset 2px 2px 0 #dfdfdf}
#bar{position:absolute;top:4px;left:4px;right:4px;height:50px;background:#000080;background-image:-webkit-linear-gradient(left,#000080,#1084d0);background-image:linear-gradient(to right,#000080,#1084d0);color:#fff;font-weight:bold;font-size:28px;line-height:50px;padding-left:12px}
#x{position:absolute;top:8px;right:8px;width:34px;height:32px;line-height:28px;text-align:center;background:#c0c0c0;color:#000;font-size:22px;border:2px solid;border-color:#fff #404040 #404040 #fff}
#list{position:absolute;top:66px;left:14px;right:14px;bottom:82px}
.btn{position:relative;float:left;box-sizing:border-box;-webkit-box-sizing:border-box;width:49%;height:31.5%;margin:0 1% 1.5% 0;background:#c0c0c0;color:#000;border:4px solid;border-color:#fff #000 #000 #fff;
  -webkit-box-shadow:inset -3px -3px 0 #808080,inset 3px 3px 0 #dfdfdf;box-shadow:inset -3px -3px 0 #808080,inset 3px 3px 0 #dfdfdf}
.btn.down{border-color:#000 #fff #fff #000;background:#b0b0b0;-webkit-box-shadow:inset 3px 3px 0 #808080;box-shadow:inset 3px 3px 0 #808080}
.btn span{position:absolute;left:4px;right:4px;top:50%;margin-top:-.62em;text-align:center;font-weight:bold;font-size:34px;line-height:1.24;white-space:nowrap;overflow:hidden}
#status{position:absolute;left:14px;right:14px;bottom:14px;height:54px;box-sizing:border-box;-webkit-box-sizing:border-box;border:3px solid;border-color:#808080 #fff #fff #808080;background:#c0c0c0;font-size:28px;line-height:48px;padding-left:12px;color:#000}
#status.bad{color:#a00000;font-weight:bold}
`;

/** ES5 only (see the header). Kept as plain text so no tool ever touches it. */
const JS = String.raw`(function () {
  'use strict';

  var IDLE_MS = 5000;
  var POLL_MS = 20000;
  var XHR_MS = 4000;
  var KEYS = ['ctrl', 'alt', 'del'];
  // DRAFT w59 (the dialog's words)
  var NOT_RESPONDING = 'Not Responding';
  var DONE = 'Done';
  var CANCEL = 'Cancel';

  function query() {
    var out = {};
    var pairs = window.location.search.replace(/^\?/, '').split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
    return out;
  }

  var q = query();
  var token = q.k || '';
  var base = q.e ? '/e/' + encodeURIComponent(q.e) : '';
  var testMode = q.test === '1';

  var els = {
    keys: document.getElementById('keys'),
    menu: document.getElementById('menu'),
    list: document.getElementById('list'),
    status: document.getElementById('status'),
    title: document.getElementById('title'),
    led: document.getElementById('led')
  };

  var menuItems = [];
  var onMenu = false;
  var shown = [];
  var idleTimer = null;
  var touchKeys = {};
  var touchBtns = {};
  var latched = {};

  function hasClass(el, c) {
    return (' ' + el.className + ' ').indexOf(' ' + c + ' ') !== -1;
  }
  function setClass(el, c, on) {
    if (on === hasClass(el, c)) return;
    if (on) el.className = (el.className + ' ' + c).replace(/^ /, '');
    else el.className = (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').replace(/^ | $/g, '');
  }

  function post(path, body, done) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function finish(ok, json) {
      if (finished) return;
      finished = true;
      done(ok, json);
    }
    xhr.open('POST', base + path, true);
    xhr.timeout = XHR_MS;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var json = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch (e) {
        json = null;
      }
      finish(xhr.status === 200 && json !== null, json);
    };
    xhr.ontimeout = function () {
      finish(false, null);
    };
    xhr.onerror = function () {
      finish(false, null);
    };
    xhr.send(JSON.stringify(body));
  }

  function loadMenu() {
    post('/api/costume/menu', { k: token }, function (ok, json) {
      setClass(els.led, 'on', ok && json.on === true);
      if (!ok) return;
      menuItems = json.items || [];
      if (json.title) els.title.textContent = json.title;
      // The dialog opened before the first answer: fill it. Never redrawn
      // under a finger otherwise.
      if (onMenu && shown.length === 0 && menuItems.length > 0) {
        status('', false);
        draw(menuItems, false);
      }
    });
  }

  function status(text, bad) {
    els.status.textContent = text;
    setClass(els.status, 'bad', bad === true);
  }

  function draw(items, withCancel) {
    while (els.list.firstChild) els.list.removeChild(els.list.firstChild);
    touchBtns = {};
    var rows = items.slice();
    if (withCancel) rows.push({ cancel: true, label: CANCEL });
    for (var i = 0; i < rows.length; i++) {
      var b = document.createElement('div');
      var s = document.createElement('span');
      b.className = 'btn';
      b.setAttribute('data-i', String(i));
      s.textContent = rows[i].label;
      b.appendChild(s);
      els.list.appendChild(b);
    }
    shown = rows;
  }

  function idle() {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = onMenu ? setTimeout(home, IDLE_MS) : null;
  }

  function home() {
    onMenu = false;
    latched = {};
    touchBtns = {};
    setClass(els.menu, 'hidden', true);
    setClass(els.keys, 'hidden', false);
    paint();
    idle();
  }

  function open() {
    onMenu = true;
    latched = {};
    status('', false);
    draw(menuItems, false);
    if (menuItems.length === 0) status(NOT_RESPONDING, true);
    setClass(els.keys, 'hidden', true);
    setClass(els.menu, 'hidden', false);
    idle();
    loadMenu();
  }

  function held(name) {
    if (latched[name] === true) return true;
    for (var id in touchKeys) {
      if (touchKeys[id] === name) return true;
    }
    return false;
  }

  function paint() {
    setClass(document.getElementById('k-ctrl'), 'on', held('ctrl'));
    setClass(document.getElementById('k-alt'), 'on', held('alt'));
    setClass(document.getElementById('k-del'), 'on', held('del'));
  }

  function chord() {
    for (var i = 0; i < KEYS.length; i++) {
      if (!held(KEYS[i])) return false;
    }
    return true;
  }

  function fire(item) {
    status('...', false);
    post('/api/costume/fire', { k: token, id: item.id }, function (ok, json) {
      if (!onMenu) return;
      if (ok && json.ok === true) status(DONE, false);
      else status(NOT_RESPONDING, true);
    });
  }

  function press(item) {
    if (item.cancel === true) {
      status('', false);
      draw(menuItems, false);
    } else if (item.items) {
      status('', false);
      draw(item.items, true);
    } else {
      fire(item);
    }
  }

  function keyOf(el) {
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute('data-key')) return el.getAttribute('data-key');
      el = el.parentNode;
    }
    return null;
  }

  function btnOf(el) {
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute('data-i') !== null) return el;
      el = el.parentNode;
    }
    return null;
  }

  function itemOf(btn) {
    return shown[Number(btn.getAttribute('data-i'))];
  }

  // A touch that left the glass without its touchend (a system gesture) must
  // not hold a key down for ever.
  function forget(e) {
    var live = {};
    for (var i = 0; i < e.touches.length; i++) live[e.touches[i].identifier] = true;
    for (var id in touchKeys) {
      if (live[id] !== true) delete touchKeys[id];
    }
    for (var b in touchBtns) {
      if (live[b] !== true) {
        setClass(touchBtns[b], 'down', false);
        delete touchBtns[b];
      }
    }
  }

  function onStart(e) {
    e.preventDefault();
    forget(e);
    var down = false;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (onMenu) {
        var b = btnOf(t.target);
        if (b) {
          touchBtns[t.identifier] = b;
          setClass(b, 'down', true);
        }
      } else {
        var k = keyOf(t.target);
        if (k) {
          touchKeys[t.identifier] = k;
          down = true;
        }
      }
    }
    paint();
    if (down && chord()) open();
    idle();
  }

  function onMove(e) {
    e.preventDefault();
    idle();
  }

  function onEnd(e) {
    e.preventDefault();
    var fired = null;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var b = touchBtns[t.identifier];
      delete touchKeys[t.identifier];
      if (b) {
        delete touchBtns[t.identifier];
        setClass(b, 'down', false);
        if (e.type === 'touchend' && btnOf(document.elementFromPoint(t.clientX, t.clientY)) === b) fired = b;
      }
    }
    forget(e);
    paint();
    if (fired !== null && onMenu) press(itemOf(fired));
    idle();
  }

  // On an element, not the document: a newer browser makes a document's touch
  // listeners passive, and then nothing stops the page scrolling.
  var app = document.getElementById('app');
  app.addEventListener('touchstart', onStart, false);
  app.addEventListener('touchmove', onMove, false);
  app.addEventListener('touchend', onEnd, false);
  app.addEventListener('touchcancel', onEnd, false);

  if (testMode) {
    document.addEventListener('mousedown', function (e) {
      if (onMenu) {
        var b = btnOf(e.target);
        if (b) press(itemOf(b));
      } else {
        var k = keyOf(e.target);
        if (k) {
          latched[k] = latched[k] !== true;
          paint();
          if (chord()) open();
        }
      }
      idle();
    }, false);
  }

  loadMenu();
  setInterval(loadMenu, POLL_MS);
})();
`;

/** The script, for the test that holds it to ES5. */
export const COSTUME_JS = JS;
/** The stylesheet, for the test that holds it to what iOS 9 draws. */
export const COSTUME_CSS = CSS;
export const COSTUME_HTML = HTML;

export function serveCostumePage(method: string, path: string, res: ServerResponse, csp: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const send = (type: string, body: string, headers: Record<string, string> = {}): boolean => {
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache", ...headers });
    res.end(method === "HEAD" ? undefined : body);
    return true;
  };
  if (path === "/costume" || path === "/costume/") return send("text/html; charset=utf-8", HTML, { "content-security-policy": csp });
  if (path === "/costume.js") return send("text/javascript; charset=utf-8", JS);
  if (path === "/costume.css") return send("text/css; charset=utf-8", CSS);
  return false;
}
