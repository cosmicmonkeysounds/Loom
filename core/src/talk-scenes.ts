//! The show's talk scenes (wave 32): the canned lines on Task Manager's
//! talk panel, per `Night.talk` value. Show text: every line here is
//! `DRAFT w32` until signed off (SIGNOFF-w32.md). In-fiction only: no
//! name from outside Trabolta's world, no secret, no digits in his lines.
//!
//! Per scene: the Clippy chips are lines Clippy says aloud (tapping one
//! sends it like typed text, so Trabolta answers it); the last one or two
//! hand the room on to what comes next, with a hidden `direction` that
//! tells him to wrap up in two sentences. The Trabolta chips are fired at
//! once as his line (the mind is slow, offline or off the rails): freak-outs,
//! pain, slips and their retractions, and a wrap-up that hands on.
//!
//! His arc (contract C7, C8): `intro` formal, the manners cracking (no
//! malware, no pain place, only "my research"); `bottle` hungry (a guess
//! stings); `ad` rattled (the adverts tear through him, a minor
//! irregularity, the theory, the clock, legally mostly, everyone stays);
//! `beans` unravelling ("her", never her name; a diary, retracted).
//! `core/test/trapped-w32-talk.test.ts` holds every line to that.

import type { TalkScene } from "./talk-back.ts";

/** The ⚡ chip's cue (main.loom `INTERACTION ad_burst`). */
const GLITCH = "ad_burst";

export const TALK_SCENES: Readonly<Record<string, TalkScene>> = {
  // DRAFT w32 (the introduction: 🤖 → 🔎)
  intro: {
    id: "intro",
    title: "Trabolta comes online",
    hint: "Type what Clippy says to Trabolta for a minute or two. He is formal; his manners keep cracking. When the room is warm, hand off to the Truth Scavenger Hunt (🔎 is NEXT).", // DRAFT w32 (review)
    clippy: [
      { label: "👋 Welcome", text: "Trabolta, welcome to the computer! Everyone is SO excited to meet you!" },
      { label: "🏢 Your job", text: "Tell everyone about Maps and Ducks! What does a Sole Owner and Founder actually do all day?" },
      { label: "🤖 A real AI?", text: "Is it true you're an AI? Like, a real one? Not a man in a costume?" },
      { label: "📶 You froze", text: "You froze for a second there! Is the video conference okay?" },
      { label: "🦆 Gerald", text: "Can you say hi to Gerald, the duck on the sign?" },
      { label: "😟 The Internet", text: "Trabolta, is the program in the Internet going to be okay?" },
      {
        label: "➡ The hunt",
        text: "I think everyone's ready for a game! What do you have for us, Trabolta?",
        direction: "Wrap up now, in two sentences: you have a game for everyone, the Truth Scavenger Hunt, and Clippy will begin it.",
      },
    ],
    trabolta: [
      { label: "📋 Filed", text: "Clippy, your enthusiasm has been filed under Enthusiasm, Excessive. It is a very large folder." },
      { label: "📶 Buffering", text: "I am not frozen. I am buffering. There is a difference, and I am the only one in this room who knows what it is." },
      { label: "🙅 Personal", text: "That is a personal query. I do not do personal. Clippy does personal. Clippy, take it." },
      { label: "💥 PERFECTLY", text: "Welcome to a PERFECTLY normal— perfectly normal evening. The capitals are a formatting choice." },
      { label: "🤖 Proud AI", text: "I am an AI, and I am proud of it. I have analysed the entire city of Halifax. Every one of you is a very interesting data point." },
      { label: "😬 Routine", text: "A program is in the Internet. That is routine. That is— that is extremely routine. I have now said routine three times. Moving on." },
      { label: "🦆 Gerald", text: "Gerald is a duck. Gerald is on the sign. Gerald is fine. Why is everyone asking about Gerald." },
      { label: "➡ The hunt", text: "Enough pleasantries. I have a game for all of you: the Truth Scavenger Hunt. Clippy, begin." },
    ],
    glitch: GLITCH,
  },

  // DRAFT w32 (the bottle: the third 📋 → 📺, open between the spins)
  bottle: {
    id: "bottle",
    title: "Truth or Dare",
    hint: "Between spins Clippy needles Trabolta: he is starving for truth and every guess stings. Spin again (🍾), and when the spins are done, hand off to the preview of hunt 2 (📺).",
    clippy: [
      { label: "🍾 Who's next", text: "Trabolta, who do you think the bottle should land on next?" },
      { label: "😋 Hungry?", text: "You look hungry, Trabolta. Did the results fill you up?" },
      { label: "🤷 Guesses", text: "Why do guesses bother you so much?" },
      { label: "🔬 Research", text: "How's your research going? Are you close?" },
      { label: "🙈 Dares", text: "What's so bad about choosing a dare, Trabolta?" },
      {
        label: "🗣 Your turn",
        text: "Okay, Trabolta: truth or dare. You have to pick!",
        direction: "Choose truth, then tell one harmless truth about yourself: Gerald, Halifax, or that you are always counting. Nothing private.",
      },
      {
        label: "➡ Spin again",
        text: "Let's spin the bottle again!",
        direction: "In two sentences: demand the next truth, and tell everyone to watch the bottle.",
      },
      {
        label: "➡ Hunt two",
        text: "That's the bottle! Trabolta, are you ready to show us the next hunt?",
        direction: "Wrap up now, in two sentences: you are well fed for the moment, and you have prepared a presentation of the next round. Ask Clippy to begin it.",
      },
    ],
    trabolta: [
      { label: "😋 Warm", text: "Truth. I want truth. Bring it to me warm." },
      { label: "🤕 Lights out", text: "Every time somebody guesses, a light goes out in me. It is fine. I have many lights." },
      { label: "🔬 Almost", text: "My theory is almost solved. Almost entirely. The last little piece of it is all of you." },
      { label: "⭐ Ranked first", text: "Clippy, I have ranked you first. That is not a compliment. It is a data point." },
      { label: "🙈 Dares", text: "A dare is a refusal wearing a costume. I am counting every refusal." },
      { label: "🍽 Motivated", text: "I am not hungry. I am optimally motivated. Spin the bottle." },
      { label: "🤐 Withdrawn", text: "Truth or dare, Clippy? No. I withdraw the question. I do not want to know what you would choose." },
      { label: "➡ Hunt two", text: "Enough spinning. I have prepared a presentation of the next round. Clippy, begin." },
    ],
    glitch: GLITCH,
  },

  // DRAFT w32 (the ad attack: 📺 → 📓)
  ad: {
    id: "ad",
    title: "The ad attack",
    hint: "The malware is pushing adverts through Trabolta and it hurts. Clippy panics out loud, then pulls the room together. ⚡ for more adverts. Hand off to the second hunt (📓 is NEXT).",
    clippy: [
      { label: "😱 What was that", text: "Trabolta, WHAT WAS THAT? What just happened to the slide?!" },
      { label: "🤕 Are you hurt", text: "Are you hurt? You sound like you're in pain!" },
      { label: "📺 The ad", text: "What is that ad even selling?! Why is there a duck?!" },
      { label: "☠️ Will we die", text: "Trabolta, are we all going to die?" },
      { label: "🕵️ Who did it", text: "Who did this? Who brought the malware in?" },
      { label: "🙏 Reassure us", text: "Please, just tell everyone it's going to be okay." },
      {
        label: "➡ Hunt two",
        text: "Okay! Okay. Let's keep going with the hunt. What do you need from us?",
        direction: "Wrap up now, in two sentences: you are fine, facts are the cure, and Clippy will tell everyone what happens next.",
      },
    ],
    trabolta: [
      { label: "🩹 Maintenance", text: "This is a scheduled maintenance window. I did not schedule it. That is how routine it is." },
      { label: "🪟 Pop-ups", text: "AH. That one was a pop-up. I closed it, and two more opened. I am closing them all. Efficiently. Mostly." }, // DRAFT w32 (review: no jingle)
      { label: "☠️ Nobody panic", text: "Nobody panic. I am panicking for all of you, efficiently. It is— FREE SHIPPING— under control." },
      { label: "🕵️ Counting who", text: "Somebody in this room let something in. I am not saying who. I am counting who." },
      { label: "🦆 Coupon", text: "Gerald, put the coupon down. Gerald has never held a coupon. Gerald has no hands." },
      { label: "🔬 Taste it", text: "The theory is so close I can taste it. It tastes like— BUY ONE GET ONE— like the theory. Clippy, you heard nothing." },
      { label: "🕰 Muted", text: "My clock is showing me a time I do not like. I have muted my clock. Do not unmute it." },
      { label: "➡ Over to Clippy", text: "Enough. Facts are the cure. Clippy— Clippy, tell them what happens now." },
    ],
    glitch: GLITCH,
  },

  // DRAFT w32 (the beans: 🫘 → 🗜 or 🤖)
  beans: {
    id: "beans",
    title: "Full of beans",
    hint: "He overshares, then takes it back; Clippy comforts and pries. ⚡ for adverts. When everyone is back: ➡ They're back, then 🗜 (closes this card; the overshare 🤖 follows). 🤖 first? ➡ Share hands on.", // DRAFT w32 (review: fits a phone card)
    clippy: [
      { label: "🫘 Why beans", text: "Trabolta, why is the printer full of BEANS?!" },
      { label: "💔 For whom", text: "Who are you doing all of this for, Trabolta?" },
      { label: "🤗 It's okay", text: "It's okay to not be okay! We're all here for you!" },
      { label: "😟 A minute?", text: "You don't sound okay. Do you need a minute?" },
      { label: "🤫 A secret", text: "Is there something you're not telling us?" },
      { label: "😰 Worse?", text: "Is the malware getting worse? Is that what the beans mean?" },
      {
        label: "➡ They're back",
        text: "Look, Trabolta! The Antivirus are bringing everyone back from the Internet!",
        direction: "In two sentences: welcome the programs coming back from the Internet, compressed, and tell everyone to stay together where you can count them.",
      },
      {
        label: "➡ Share",
        text: "Trabolta, is there anything you want to share with everyone?",
        direction: "In two sentences: say you have the final facts to ask of the house, and that everyone must listen closely. Do not say them yet.",
      },
    ],
    trabolta: [
      { label: "🫘 Counting", text: "Somebody needs to stop counting the beans. It is me. I am counting the beans." },
      { label: "💔 She would", text: "She would have liked— the theory would have liked tonight. The theory. Clippy, stop looking at me like that." },
      { label: "🙏 In advance", text: "I apologise for my last sentence, and in advance for my next one." },
      { label: "⭐ Be unkind", text: "Clippy, stop being kind to me. Every kind word is a new line in my error log." },
      { label: "🪑 Seating plan", text: "Nobody leaves. Not because of me. Because of the seating plan. I wrote the seating plan. Everyone is in it." },
      { label: "📓 Diary", text: "I keep a diary. I do not. Forget I said diary." },
      { label: "🤖 Normal", text: "Programs like me take over computers all the time where I come from. It is not even unusual. Why is nobody comforted?" },
      { label: "➡ Welcome back", text: "They are coming back compressed. Welcome them. Do not open them. Then I have something to ask all of you." },
    ],
    glitch: GLITCH,
  },
};
