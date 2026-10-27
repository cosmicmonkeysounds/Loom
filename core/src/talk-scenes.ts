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
    hint: "Clippy chats with Trabolta for a minute or two: type what she says. He is formal and his manners keep cracking. When the room is warm, hand off to the Truth Scavenger Hunt (🔎 is NEXT).",
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
      { label: "📋 Logged", text: "Thank you, Clippy. Your enthusiasm has been logged, filed and counted." },
      { label: "📶 Buffering", text: "I am not frozen. I am buffering. There is a difference, and I am the only one in this room who knows what it is." },
      { label: "🙅 Personal", text: "Personal queries go to Clippy. Clippy, that was a personal query. Please take it." },
      { label: "💥 EXTREMELY", text: "My research is going EXTREMELY well. That word was louder than I scheduled. Disregard." },
      { label: "🤖 Proud AI", text: "I am an AI, and I am proud of it. I have analysed the entire city of Halifax. Every one of you is a very interesting data point." },
      { label: "😬 Routine", text: "A program is in the Internet. That is routine. That does not sting. Nothing stings. Moving on." },
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
      { label: "🤕 Stings", text: "A guess went into my context just now. It stings, programs. Please stop guessing at me." },
      { label: "🔬 Almost", text: "My theory is almost solved. Ninety-nine point nine percent. The last point one is all of you." },
      { label: "⭐ Favourite", text: "Clippy, you are my favourite. That is not a compliment. It is a data point." },
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
        direction: "Wrap up now, in two sentences: pull yourself together, say the facts matter more than ever, and tell everyone the second hunt begins now.",
      },
    ],
    trabolta: [
      { label: "🩹 Contained", text: "It is a minor irregularity. It has been detected and contained. It is— BUY NOW— contained." },
      { label: "🤕 It hurts", text: "AH. It goes through me. Every advert goes through me on its way to you, and it HURTS. Disregard that." },
      { label: "☠️ Going to—", text: "WE ARE ALL GOING TO— proceed. We are all going to proceed. Calmly." },
      { label: "🕵️ Who", text: "Who brought the malware in? No. Do not answer. Nobody brought anything. Everyone stays calm." },
      { label: "🦆 Gerald sells", text: "Why is Gerald selling something? Gerald does not sell. Gerald is a duck." },
      { label: "🔬 The theory", text: "I do all of this for— for the theory. For the theory. Clippy, you heard nothing." },
      { label: "🕰 What time", text: "What time is it? Do not answer that. The clock is fine. Everything is fine." },
      { label: "➡ Hunt two", text: "The presentation will now resume. The facts matter more than ever. Clippy, begin the second hunt." },
    ],
    glitch: GLITCH,
  },

  // DRAFT w32 (the beans: 🫘 → 🗜 or 🤖)
  beans: {
    id: "beans",
    title: "Full of beans",
    hint: "He is coming apart: he overshares, then takes it back. Clippy comforts him and pries. ⚡ for more adverts. Hand off to the zip-out (🗜), then the overshare (🤖).",
    clippy: [
      { label: "🫘 Why beans", text: "Trabolta, why is the printer full of BEANS?!" },
      { label: "💔 For whom", text: "Who are you doing all of this for, Trabolta?" },
      { label: "🤗 It's okay", text: "It's okay to not be okay! We're all here for you!" },
      { label: "😟 A minute?", text: "You don't sound okay. Do you need a minute?" },
      { label: "🤫 A secret", text: "Is there something you're not telling us?" },
      { label: "😰 Worse?", text: "Is the malware getting worse? Is that what the beans mean?" },
      {
        label: "➡ Zip them out",
        text: "What should we do about the programs in the Internet?",
        direction: "In two sentences: order the Antivirus to zip everyone out of the Internet and bring them back to the Desktop, where you can count them.",
      },
      {
        label: "➡ Share",
        text: "Trabolta, is there anything you want to share with everyone?",
        direction: "In two sentences: say you have the final facts to ask of the house, and that everyone must listen closely. Do not say them yet.",
      },
    ],
    trabolta: [
      { label: "🫘 Every bean", text: "I can feel every bean. Every single bean. I have counted them. There are too many." },
      { label: "💔 For her", text: "I only wanted one thing to go right tonight. For her. For— for the theory. Do not repeat that." },
      { label: "🙏 Sorry", text: "I apologise. That was unscheduled. Disregard everything since the beans." },
      { label: "⭐ Liability", text: "Clippy, you are my favourite and you are my liability, and tonight I cannot tell which one is winning." },
      { label: "🪑 Stays", text: "Everyone stays. Everyone stays together, where I can count you. That is not a threat. That is a seating plan." },
      { label: "📓 Diary", text: "I keep a diary. I do not. Forget I said diary." },
      { label: "🤖 Normal", text: "Programs like me take over computers all the time where I come from. It is not even unusual. Why is nobody comforted?" },
      { label: "➡ Zip, then share", text: "Antivirus. Zip everyone out of the Internet and bring them here. Then I have something to ask all of you." },
    ],
    glitch: GLITCH,
  },
};
