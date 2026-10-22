//! The idle show's ads (wave 17): fake-1999 web ads, every one inside the
//! fiction — the house is a computer, the guests are programs, the rooms are
//! its parts. All copy is original. Each ad picks a **skin** (how it is
//! drawn: a Win98 dialog, a garish banner, a GeoCities page, …) and a piece
//! of **art** (a small original SVG, `art.tsx`). An ad may carry art as a
//! PNG instead (`png: true` → `public/ads/<id>.png`, the text card if it
//! fails), but none does yet: no 404s on a wall that has no art.
//!
//! Pools (`pools.ts`): an ad with no `pools` plays all night; `names: true`
//! copy says `{character}` and plays only on an awake screen after the
//! introduction. Nothing else may name him (`test/attract.test.ts`), but
//! the `owner: true` ads (wave 18b, D19): "Jean Trabolta" in the third
//! person, the owner of Maps and Ducks who joins by video conference.

import type { Pooled } from "./pools.ts";

export type AdSkin = "win98" | "banner" | "geocities" | "lottery" | "chat" | "dialup" | "y2k" | "duck" | "fundraiser" | "hijack" | "phosphor" | "classified" | "warning" | "tycoon";

export type AdArt =
  | "duck"
  | "coin"
  | "ram"
  | "globe"
  | "clock"
  | "trophy"
  | "mail"
  | "modem"
  | "star"
  | "printer"
  | "shield"
  | "bean"
  | "cloud"
  | "face"
  | "cd"
  | "pong"
  | "chart"
  | "floppy"
  | "keyboard"
  | "map"
  | "cookie"
  | "bolt"
  | "toilet"
  | "pager"
  | "dice";

/** What an ad's title bar says, by skin (its title is in its body). */
export const SKIN_BAR: Record<AdSkin, string> = {
  win98: "Special Offer",
  banner: "ADVERTISEMENT",
  geocities: "~*~ my home page ~*~",
  lottery: "!!! WINNER !!!",
  chat: "BuddyChat 99",
  dialup: "Dial-Up Networking",
  y2k: "Year 2000 Readiness",
  duck: "Skill Testing Game",
  fundraiser: "mapsandducks.com",
  hijack: "000. 000. 000.",
  phosphor: "message.txt",
  classified: "THE CLASSIFIEDS",
  warning: "Security Alert",
  tycoon: "Truthcoin Exchange",
};

export interface IdleAd extends Pooled {
  id: string;
  skin: AdSkin;
  title: string;
  body: string;
  button: string;
  art?: AdArt;
  /** A small tag over the title ("SPONSORED", "HOT!"). */
  kicker?: string;
  /** Try `public/ads/<id>.png` first. */
  png?: boolean;
}

export const IDLE_ADS: readonly IdleAd[] = [
  // --- all night ---------------------------------------------------------------
  { id: "ad-maps-and-ducks", skin: "fundraiser", art: "map", kicker: "TONIGHT'S FUNDRAISER", title: "MAPS AND DUCKS — RESTORE THE SIGN!", body: "Tonight's fundraiser keeps the billboard on Barrington Street glowing. Every program helps. mapsandducks.com", button: "DONATE NOW" },
  { id: "ad-protection-expired", skin: "warning", art: "shield", title: "Your protection has expired", body: "Your computer may be at risk. Viruses, worms and other programs could be in this house right now. Renew today to stay protected.", button: "Renew now" },
  { id: "ad-geocities", skin: "geocities", art: "globe", title: "Build your FREE home page!", body: "15 MB of space, a hit counter and a guestbook. Move into the neighbourhood today.", button: "Join now" },
  { id: "ad-y2k", skin: "y2k", art: "clock", title: "Is your PC Y2K ready?", body: "Time is running out. Run the free Year 2000 checker before midnight on December 31, 1999.", button: "Check now" },
  { id: "ad-millionth", skin: "lottery", art: "trophy", kicker: "!!! WINNER !!!", title: "You are the 1,000,000th visitor!", body: "Congratulations! You have been selected to receive a FREE prize. This is not a trick. Click below within 10 seconds.", button: "CLAIM PRIZE", wall: true },
  { id: "ad-more-ram", skin: "banner", art: "ram", kicker: "NEW!", title: "DOWNLOAD MORE RAM", body: "Is your computer forgetful? Download up to 64 MB of extra memory in seconds. No screwdriver needed.", button: "Download RAM" },
  { id: "ad-running-slow", skin: "warning", art: "bolt", title: "Your PC is running SLOW", body: "We found 2,847 problems in this house. Click to make everything 300% faster, including you.", button: "Fix now" },
  { id: "ad-lotto", skin: "lottery", art: "coin", kicker: "TRUTHCOIN MEGA LOTTO", title: "Tonight's jackpot: 1,000,000 Truthcoin", body: "Pick six numbers. Any six. They will all be wrong, but you will feel wonderful.", button: "Buy a ticket" },
  { id: "ad-buddychat", skin: "chat", art: "face", title: "BuddyChat 99 — never be alone again", body: "Uh-oh! 3 programs want to chat with you. Download BuddyChat and hear that sound all night long.", button: "Download" },
  { id: "ad-dialup", skin: "dialup", art: "modem", title: "500 FREE HOURS OF INTERNET", body: "Just plug in your modem and wait. And wait. Connecting at 28.8k… Long-distance charges may apply.", button: "Connect" },
  { id: "ad-punch-the-duck", skin: "duck", art: "duck", kicker: "SKILL TESTING GAME", title: "PUNCH THE DUCK — WIN A PRIZE!", body: "Hit the duck to win. The duck is made of foam. The duck has signed a waiver.", button: "PUNCH", wall: true },
  { id: "ad-lonely-printers", skin: "banner", art: "printer", kicker: "IN YOUR AREA", title: "Lonely printers want to meet you", body: "They have paper. They have toner. They have been waiting since 1997. Don't keep them waiting.", button: "Meet them" },
  { id: "ad-screensavers", skin: "geocities", art: "star", title: "400 FREE SCREENSAVERS!", body: "Pipes! Stars! Windows that fly! A duck! Leave your computer alone and watch it come alive.", button: "Get them all" },
  { id: "ad-guestbook", skin: "geocities", art: "mail", kicker: "~*~ welcome ~*~", title: "Sign my Guestbook!!!", body: "You are visitor number 000417. Please sign my guestbook and tell me my page is cool.", button: "Sign it" },
  { id: "ad-webring", skin: "classified", art: "globe", title: "Join the HOUSE WEBRING", body: "← previous room · random room · next room → Fourteen rooms, one ring, no way out.", button: "Next site" },
  { id: "ad-mouse-ball", skin: "classified", art: "keyboard", title: "Is your cursor sticky?", body: "Order the deluxe mouse-ball cleaning kit. Two tweezers, one cloth, zero regrets.", button: "Order now" },
  { id: "ad-disk-cleanup", skin: "win98", art: "toilet", title: "Disk Cleanup is available", body: "Need a break? Disk Cleanup is open on two floors. Bathroom Mode is in your phone's Start menu.", button: "OK" },
  { id: "ad-start-bar", skin: "banner", art: "cookie", kicker: "THIS HOUSE USES COOKIES", title: "THE START BAR", body: "Snacks, drinks and cookies on the main floor. Accept all cookies. You have our permission.", button: "Accept all" },
  { id: "ad-free-email", skin: "win98", art: "mail", title: "FREE E-MAIL FOR LIFE", body: "Get yourname@house.net today. Check it from any computer in the house. Every computer is this house.", button: "Sign up" },
  { id: "ad-forecast", skin: "classified", art: "cloud", title: "TONIGHT'S FORECAST", body: "100% chance of popups, clearing toward midnight. Light flicker in the evening. Bring a towel.", button: "More weather" },
  { id: "ad-optical-drive", skin: "lottery", art: "cd", kicker: "INSERT DISC", title: "1,000 FREE HOURS ON CD-ROM", body: "Find the disc in The Optical Drive, by the front door. Coasters also accepted.", button: "Eject" },
  { id: "ad-cloud", skin: "y2k", art: "cloud", title: "THE CLOUD — NOW WITH REAL WEATHER", body: "Fresh air, 100% uptime, a tunnel to the tent. The backyard is open for business.", button: "Upload yourself", pools: ["hunt", "malware", "late", "y2k", "finale"] },
  { id: "ad-the-tube", skin: "classified", art: "map", title: "RIDE THE TUBE", body: "Every hall and both stairs, in one convenient tube. Mind the gap. Mind the ducks.", button: "Plan a trip" },
  { id: "ad-steam-room", skin: "banner", art: "dice", kicker: "MAIN FLOOR", title: "THE STEAM ROOM: GAMES GAMES GAMES", body: "Board games, card games and games of chance. Losing is a feature.", button: "Play now", pools: ["hunt", "malware", "late", "y2k", "finale"] },
  { id: "ad-virus-shield", skin: "warning", art: "shield", kicker: "PLATINUM EDITION", title: "VIRUS SHIELD PLATINUM", body: "Protects against 0 of 1,000,000 known threats. Now in a shinier box.", button: "Protect me" },
  { id: "ad-mega-toolbar", skin: "win98", art: "star", title: "Install the MEGA TOOLBAR", body: "Fourteen toolbars in one! See less of the page and more of the toolbar. Uninstalls never.", button: "Install" },
  { id: "ad-pager", skin: "phosphor", art: "pager", title: "GET A PAGER. BE REACHABLE.", body: "Beep beep. Somebody needs you. Probably. Numeric messages only: 07734 means hello.", button: "Beep me" },
  { id: "ad-floppy", skin: "classified", art: "floppy", title: "Back up your memories", body: "On one 3½-inch floppy disk. Holds 1.44 MB of feelings. Label it with a sharpie.", button: "Back up" },
  { id: "ad-calculator", skin: "lottery", art: "trophy", kicker: "SKILL TESTING QUESTION", title: "WIN A FREE CALCULATOR!", body: "Answer one simple question to win: what is 2 + 2? Hint: use a calculator.", button: "Answer", wall: true },
  { id: "ad-one-key", skin: "banner", art: "keyboard", kicker: "AS SEEN ON TV", title: "THE 1-KEY KEYBOARD", body: "Type 300 words a minute. They will all be the same word, but it will be fast.", button: "Order" },
  { id: "ad-under-construction", skin: "geocities", art: "bolt", title: "THIS AD IS UNDER CONSTRUCTION", body: "Please check back in 1999. Oh wait. It is 1999. Please check back later.", button: "Refresh" },
  { id: "ad-casino", skin: "tycoon", art: "dice", kicker: "FEELING LUCKY?", title: "TRUTHCOIN TABLES — UPSTAIRS", body: "Coin, dice and slots on the top floor. Bring your pass. The house always wins, and this is the house.", button: "Place a bet", pools: ["hunt", "malware", "late", "y2k", "finale"] },
  { id: "ad-defrag", skin: "win98", art: "chart", title: "Defragment your evening", body: "Too many conversations open at once? Close a few. Talk to the program next to you instead.", button: "Defrag" },
  { id: "ad-ram-room", skin: "banner", art: "ram", kicker: "BASEMENT", title: "VISIT THE RAM", body: "Random access, studio vibes, everything you forgot you remembered. Down the stairs.", button: "Remember", pools: ["hunt", "malware", "late", "y2k", "finale"] },
  { id: "ad-fan-closet", skin: "warning", art: "bolt", title: "CPU TEMPERATURE: SPICY", body: "Cool down in The Fan Closet, downstairs by the laundry. Your thermal paste will thank you.", button: "Cool off", pools: ["hunt", "malware", "late", "y2k", "finale"] },
  { id: "ad-wallet", skin: "tycoon", art: "coin", kicker: "PERSONAL FINANCE", title: "INVEST IN TRUTHCOIN", body: "Send it, request it, trade a file for it. Past performance is not a fact. Check your phone's Wallet.", button: "Open wallet" },
  // --- the doors and the first games ------------------------------------------
  { id: "ad-bingo", skin: "lottery", art: "star", kicker: "AT THE DESKTOP", title: "COMPUTER BINGO", body: "Find a program for every square. One line through the centre is a Bingo.", button: "B-I-N-G-O", pools: ["early"] },
  // D19: the owner, in the third person (from the Desktop on, never at the doors).
  { id: "ad-owner-founder", skin: "fundraiser", art: "map", kicker: "TONIGHT'S HOST", title: "MAPS AND DUCKS", body: "Sole Owner & Founder: Jean Trabolta. He joins us by video conference later tonight. He has always been a computer program.", button: "Learn more", pools: ["early"], owner: true },
  { id: "ad-owner-hunt", skin: "lottery", art: "map", kicker: "COMING SOON", title: "Jean Trabolta's Scavenger Hunt", body: "Facts are hidden all over this house. The owner of Maps and Ducks will explain, by video conference.", button: "Get ready", pools: ["early"], owner: true },
  { id: "ad-welcome", skin: "win98", art: "face", title: "Welcome to this house", body: "You have been uploaded. Please remain calm. An Antivirus program will scan your pass shortly.", button: "Get started", pools: ["early"] },
  // --- the hunt -----------------------------------------------------------------
  { id: "ad-facts-wanted", skin: "classified", art: "chart", kicker: "WANTED", title: "FACTS. ANY FACTS.", body: "Every room hides a code. Scan it with your phone's 📷 Scan and file what you find.", button: "Scan a fact", pools: ["hunt", "malware"] },
  // --- the ad hijack (C1) --------------------------------------------------------
  { id: "ad-hijack-offer", skin: "hijack", art: "bolt", kicker: "000. 000. 000.", title: "A SPECIAL OFFER FOR YOU", body: "You have been selected. Do not close this window. Do not close any window. There are more windows.", button: "ACCEPT", pools: ["malware"] },
  { id: "ad-hijack-free", skin: "hijack", art: "coin", kicker: "000. 000. 000.", title: "FREE!!! FREE!!! FREE!!!", body: "Everything is free. Nothing is free. Click here to find out which.", button: "FIND OUT", pools: ["malware"] },
  { id: "ad-hijack-hurry", skin: "hijack", art: "clock", kicker: "000. 000. 000.", title: "ONLY 000 LEFT IN STOCK", body: "Hurry. Hurry. Hurry. Hurry. Hurry. Hurry. Hurry. Hurry.", button: "HURRY", pools: ["malware"] },
  // --- after the hunts ------------------------------------------------------------
  { id: "ad-truth-pong", skin: "banner", art: "pong", kicker: "IN THE BACKYARD", title: "TRUTH PONG", body: "A pyramid of cups, one ball, nowhere to hide. Head out to The Cloud.", button: "Serve", pools: ["late"], phases: ["truth_pong"] },
  { id: "ad-trust-chart", skin: "tycoon", art: "chart", kicker: "LIVE ON THE TV", title: "WHO DO YOU TRUST?", body: "The Trust Chart is up on every screen in the house. Find your name. Or don't.", button: "Check the chart", pools: ["late"], phases: ["trust_chart"] },
  { id: "ad-beans-hotline", skin: "warning", art: "bean", title: "PRINTER FULL OF BEANS?", body: "Call the bean removal hotline. Our technicians are standing by with spoons.", button: "Call now", pools: ["late"], phases: ["beans", "overshare"] },
  // --- Y2K ---------------------------------------------------------------------------
  { id: "ad-y2k-kit", skin: "y2k", art: "bean", kicker: "BE PREPARED", title: "Y2K SURVIVAL KIT", body: "Water, canned beans, a flashlight and a calendar that ends at 1999. Order before midnight.", button: "Order now", pools: ["y2k"] },
  { id: "ad-party-1999", skin: "lottery", art: "clock", title: "PARTY LIKE IT'S 1999", body: "Because it is. For a little while longer.", button: "Party", pools: ["y2k"] },
  // --- the end of the night ---------------------------------------------------------
  { id: "ad-rate-your-stay", skin: "win98", art: "star", title: "Thank you for using this house", body: "Please rate your stay. ★★★★★ Five stars is the only option. We checked.", button: "Rate", pools: ["finale"] },
  { id: "ad-save-memories", skin: "phosphor", art: "floppy", title: "SAVE YOUR MEMORIES?", body: "Before the house shuts down, remember who you talked to tonight. Then remember to tell them.", button: "Save", pools: ["finale"] },
  // --- the character's own (after the introduction, awake only) --------------------
  { id: "ad-char-friend", skin: "phosphor", art: "face", kicker: "FRIEND REQUEST", title: "{character} WANTS TO BE YOUR FRIEND", body: "He has room for 1,000,000 friends and none yet. Hold your pass to the camera in the corner to say hello.", button: "Accept", names: true, scan: true },
  { id: "ad-char-seminar", skin: "phosphor", art: "chart", kicker: "ONE NIGHT ONLY", title: "TRUTH, BY {character}", body: "A seminar in one lesson: tell him something true. Message him from your phone.", button: "Enrol", names: true },
  { id: "ad-char-premium", skin: "banner", art: "face", kicker: "UPGRADE", title: "{character} PREMIUM", body: "All the honesty, none of the ads. (This is an ad.)", button: "Upgrade", names: true },
  { id: "ad-char-talk", skin: "chat", art: "face", title: "TALK TO {character} — RIGHT HERE", body: "This terminal is a direct line. Show it your pass and he will be with you shortly.", button: "Connect", names: true, scan: true },
  { id: "ad-char-online", skin: "hijack", art: "face", kicker: "ONLINE NOW", title: "{character}.EXE IS RUNNING", body: "He sees every screen in the house. Wave. He likes that.", button: "Wave", names: true },
];

/** What the character says in the `face` layout's bubble (awake, after the introduction only). */
export const FACE_TIPS: readonly string[] = [
  "Tell me something true. I will remember it. I remember everything.",
  "Hold your pass to the camera in the corner. I don't bite. I don't have teeth.",
  "I see every screen in this house. Wave. I like that.",
  "You are looking at my ads. I made them myself.",
  "Message me from your phone any time. I am always typing.",
  "I like you. I like everyone. Some of you more than others.",
];
