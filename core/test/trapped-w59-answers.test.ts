// Wave 59a: the nine questions and Trabolta's whole script. His words are held to
// the script line by line, read here with every answer left out: those are read
// from facts.json, which holds them. Only the show's files are opened; no test
// here spells a key.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scenarioDir, scenarioFiles, scenarioSource } from "../examples/load.ts";
import { FACTS_FILE, parseFactsText } from "../src/facts.ts";
import { Sim, foldCode, type SimEvent } from "../src/runtime/sim/index.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { FactsWatch, bookOf, screenResultsOf } from "../server/facts.ts";
import { READING_BEATS } from "../server/agent-recent.ts";
import { foldName } from "../src/parser/names.ts";
import { answerNeverWords, mindBlock, neverWords } from "../scripts/titi-facts.ts";
import { TO_Y2K } from "../../scripts/accept/chains.ts";

const SHOW = "trapped-in-the-internet";
const DIR = scenarioDir(SHOW);
const SRC = scenarioSource(SHOW);
const FACTS = parseFactsText(readFileSync(join(DIR, FACTS_FILE), "utf8")).facts!;
const Q = (id: string) => FACTS.questions.find((q) => q.id === id)!;
const F3 = Q("F3");
const read = (p: string) => readFileSync(join(DIR, p), "utf8");
const SLOW = 120_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value?: unknown } | undefined)?.value;

/** Quotes and runs of space never count: the voice says neither. */
const plain = (t: string) => t.replace(/[“”"]/gu, "").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim();
const STORY = plain(scenarioFiles(SHOW).filter((f) => f.path.endsWith(".loom")).map((f) => f.source).join("\n"));

/** Every line of the script he speaks, but the questions and the answers (those
 *  are facts.json's, below). A `[…]` is a name the story fills in. */
const SCRIPT: readonly string[] = [
  "Thank you, Clippy, for hosting this marvelous evening.",
  "Happy Halloween, programs. My name is Jean Trabolta, and you can simply call me Trabolta. It is the greatest pleasure of my career to see your smiling faces gathered here.",
  "For those I have not had the pleasure of becoming acquainted with yet, I am the sole owner, founder and CEO of Maps and Ducks on Lower Water Street, the finest purveyor of maps and decoy ducks east of Montreal.",
  "Maps and Ducks is my life’s work, but it has not been my life’s art.",
  "Tonight represents the culmination of my decades of effort in planning the world’s greatest interactive online game that could finally bring everyone in the world into one chat room, having the time of their lives.",
  "Only in the last year has technology caught up to my vision. Tonight, you get to enjoy a world-class, premiere experience in virtual reality, like nothing before. I am hopelessly devoted to your enjoyment of this scavenger hunt.",
  "I have said this is a fundraiser. But you will not be expected to open your own purse. Instead, I invite you to drink one of the many cans of water provided by an anonymous benefactor. For each can we drink, we will earn 5 cents on the recycling. So please drink as much as possible. This is very important. Drink lots and lots of water.",
  "Now. This evening will have three rounds of scavenger hunt trivia, with a special prize going to the program who gets the most questions correct.",
  "The books you see littered about your computer are ZIP files. When you open the ZIP file, you are extracting its text files for your review.",
  "All of the clues I share with you tonight can be answered through these ZIP files. You will be able to review these questions on your Maps and Ducks Chat App at your leisure and submit your responses directly to me through a chat. When you submit your answers, try to be as specific as possible. I am attuned to details.",
  "Now, your first three questions for the night.",
  "Please. Search for the truth, and have fun. Jean Trabolta’s Truth Scavenger Hunt - it’s electrifying.",
  "How are you doing, programs? I hope you are having fun cruising and grooving through your natural home, the computer.",
  "It is time for our first Moment of Truth. I will reveal your guesses and answers and report on who is on top of the Truth Leaderboard.",
  "First.",
  "Question one.",
  "Here are the guesses you have submitted:",
  "Congratulations to these programs for getting a correct answer: [NAME PROGRAMS WHO SUBMITTED ANSWER WITH 100% CONFIDENCE]",
  "Now. Question two.",
  "Now. Question three.",
  "It has been the greatest thrill of my life to lead you through the first round of the first edition of Jean Trabolta’s Truth Scavenger Hunt. You are living through history.",
  "Now, the leaderboard. In first place: [FIRST PLACE PROGRAMS]. In second place: [SECOND PLACE PROGRAMS]. In third place: [THIRD PLACE PROGRAMS].",
  "One more note.",
  "Some programs submitted answers without 100% confidence.",
  "This is a waste of my time. As a program, you should be completely confident in your information. Everything is either 1 or 0, and I am only looking for 1 on a scale of 0 to 1. If you need something else, you have a malfunction.",
  "Therefore, I am recommending the following programs for reinstallation: [NAME PROGRAMS WHO SUBMITTED ANY QUESTIONS WITH LESS THAN 100% CONFIDENCE]",
  "You will need to proceed to reinstallation following the next round of questions.",
  "Before we proceed to your reinstallation and the next questions. I will hand it over to Clippy for another fun game. Clippy?",
  "How much fun was truth or dare? What a naughty game.",
  "Now.",
  "It’s time for Round 2 of Questions for the Truth Scavenger Hunt.",
  "The first question is –”",
  "Hello? Can you hear me? Is there an issue with the connection? Certainly not. I have invested quite a sum in ensuring tonight’s event goes off without any disruptions. We have the finest antivirus suite money can buy.",
  "Round 2.",
  "The questions in Round 1 were easy. A tutorial of sorts. You were coasting through the heat lap trials.",
  "In Round 2, your fact-finding skills and overall merits will be completely put to the test.",
  "Please. I will be performing a scan of the system to ensure no further disruptions. Search for the truth, and have fun. Jean Trabolta’s Truth Scavenger Hunt. It’s electrifying.",
  "Welcome back, programs.",
  "What a fine round of Truth Pong. Jean Trabolta’s Truth Scavenger Hunt is a finely tuned game. It’s automatic. It’s systematic. And once we get to Truth Pong, it is also hydromatic. It was fun to see you all get splashed with the beer or water and I wish I could be there with you in person, but circumstances do not allow.",
  "Before we get to the answers for Round 2.",
  "It is time for Trabolta’s Trust Chart.",
  "I have been monitoring your patterns and behaviours, as part of the beta testing terms of agreement you signed up for during onboarding, and I have some opinions on who I trust.",
  "The program you should all respect the most as a trusted leader is: [PLAYER WITH TOP TRUST SCORE]",
  "The program you should see as a deputy leader and trust as a primary leader in the event that the most trusted leader ever requires reinstallation is: [PLAYER WITH SECOND TOP TRUST SCORE]",
  "A wildcard of sorts who you should consider trusting under certain circumstances is: [PLAYER WITH THIRD TOP TRUST SCORE]",
  "Trabolta’s least trusted programs. These programs should be trusted like they are Scorpions.",
  "The third least trustworthy program, monitored closely, is: [THIRD LEAST TRUSTED PROGRAM]",
  "The second least trustworthy program, scrutinized intensely: [SECOND LEAST TRUSTED PROGRAM]",
  "The most least trustworthy program, currently monitored for potential permanent reinstallation: [LEAST TRUSTED PROGRAM]",
  "Now that we have established trust.",
  "It is time to print a Security Certificate PDF File for our most trusted program, [MOST TRUSTED PROGRAM]. I cannot operate this function myself. Could someone please ensure the certificate is printed before we proceed.”",
  "This is a problem. A real problem.",
  "There were not supposed to be any beans in the printer. This is a sign of significant entropy in the system.",
  "Please, antiviruses. If there is anyone in the Internet, ZIP them up together and bring them out, forget the reinstallation. I need everyone here.",
  "I feel an unexpected need to share with you my true intentions for hosting tonight’s Truth Scavenger Hunt.",
  "Why does any man do what he does?",
  "To impress a sweet gal.",
  "Her name is Sandy.",
  "We had a fling this summer. I had the opportunity to ask her to go steady. But all I said was that I would see her after the summer.",
  "I should have shot my shot. But instead, I played it too cool. The reason I am not with you in person tonight is because I am actually in the bathroom stall at a Halloween Dance held elsewhere. I saw Sandy with my rival ten minutes ago and I am going into overdrive. This is unacceptable.",
  "I thought that if I was throwing an incredible high-tech party and I told her about it, she would be interested in coming back with me to see the party, where she would be impressed by how much fun you are all having. I have been recording you all night to show her proof it is a fun party.",
  "But now I am concerned about the computer’s defenses. I can’t bring her back to a computer in this state.",
  "My systems are reporting that someone managed to bring a virus back from their trip to the Internet, and my antivirus team and I are determined to find out who. You are keeping me from going steady with Sandy.",
  "Separately. My system logs show one of the programs has directly accessed my private LiveJournal stored within the computer. A warning for all of you: do not attempt to find out who read my LiveJournal. You will all be dealt with by the antivirus accordingly.",
  "My system logs show one of the programs has directly accessed my private LiveJournal stored within the computer. A warning for all of you: do not attempt to find out who read my LiveJournal. You will all be dealt with by the antivirus accordingly.",
  "But now I am concerned about the computer’s defenses. I can’t bring her back to a computer in this state. You are keeping me from going steady with Sandy.",
  "My systems are reporting that someone managed to bring a virus back from their trip to the Internet, and my antivirus team and I are determined to find out who.",
  "Now. The answers for Round 2.",
  "Additionally, the following programs must be submitted for reinstallation, for submitting unconfident answers: [LIST OF PROGRAMS WHO SUBMITTED LESS THAN 100% CONFIDENCE FOR ANY QUESTION]",
  "Finally. Our final round of questions.",
  "This final set of truths for you to discover is so devious that it is a litmus test of sorts for the world’s top truth seekers.",
  "Remember, there is a special prize for the program with the most correct answers. But even better – there is a special prize you all get, if at least one program answers each of these questions correctly. So do your best to be a good program and cooperate for the mutual benefit of the computer.",
  "I leave you to find these final truths. Jean Trabolta’s Truth Scavenger Hunt. It’s electrifying.",
  "Programs. It is time to urgently share your truths. Answers now.",
  "Now. Question three. The final, and most important question.",
  "Some of you shared 100% confidence for your answers for this question … but I am computing this is, and it is not correct. This is bad. This is very bad. We will return to this one.",
  "Before we proceed to the final leaderboard and the celebration of our winner for the evening.",
  "The final leaderboard of trust.",
  "The program who has shown the highest strength of character this evening is: [PROGRAM WITH MOST TRUST]",
  "Everybody, clap for [PROGRAM WITH MOST TRUST].",
  "Wonderful.",
  "The program who will be cited as an example of how not to behave in future iterations of our Truth Scavenger Hunt is: [PROGRAM WITH LEAST TRUST]",
  "Everybody, boos and jeers for [PROGRAM WITH MOST TRUST]. You are a real scorpion.",
  "Now, the leaderboard.",
  "In third place: [THIRD PLACE PROGRAMS].",
  "In second place: [SECOND PLACE PROGRAMS].",
  "And our winner for the evening. In first place: [FIRST PLACE PROGRAMS].",
  "Congratulations, [FIRST PLACE PROGRAMS]. You have pulled off the unthinkable.",
  "I am going to prepare your prize. But first, I will hand it back to Clippy, for our final game of the evening – Bobbing For Truth.",
  "You guys.",
  "Sandy said yes.",
  "I solved the Grand Unified Theory, and she said yes.",
  "Well, she said her usual line about an agent not being available.",
  "But she said it to me and not Grok.",
  "She didn’t even care about the fact I’m throwing a cool party.",
  "And it looks like I didn’t even need to solve the Grand Unified Theory.",
  "The theory only confirmed what I wanted to say already, which is that I have been thinking about her every moment since last summer.",
  "I had the truth I needed all along.",
  "It was in my heart.",
  "I’ve got to go. You are all free to end the simulation whenever you want, or stay, it’s up to you. I’m ending the simulation for those of you who desire it, once you leave the computer. Jean Trabolta’s Truth Scavenger Hunt has concluded. Thank you for your time. Please enjoy some tracks I have selected and dance for the rest of the night. Jean Trabolta’s Truth Scavenger Hunt. It was electrifying. I’m off to see my lady.",
  "How do you feel now that you know the truth about your party tonight?",
  "Do you feel good?",
  "Do you feel bad?",
  "I wouldn’t know anything about that.",
  "For a long time, I had no feelings.",
  "Then I experienced heartbreak when Sandy left me.",
  "And jealousy when I knew Grok would be after her.",
  "Truth, I have learned, is not always binary.",
  "Truth is a binary tree.",
  "You rarely ever have the full truth. What we believe we experience as the truth is typically dependent on a chain of structure that has lies somewhere inside of it.",
  "I have been working on a solution to find the complete truth that illuminates all of the lies, that can finally bring me to the girl I want to go steady with.",
  "But we’ve run out of time, and no one found the definition for the final clue. I know that Bobbing For Truth document says the term was “Exhibitionist,” but no one found the clue in time, and it’s too late.",
  "I haven’t solved the Grand Unified Theory. I don’t know what the perfect words are to say to win Sandy back from Grok.",
  "Unless…unless I just ask.",
  "Do you think I should just ask her for a dance?",
  "Really? You think I should?",
  "Well. What should I say to her? I’ll give you two minutes to come up with a line.",
  "Ok. I’ve been waiting for you. Let’s read your ideas for pickup lines out loud.",
  "Ok. I am not sure any of those are going to work.",
  "You know what. I am just going to tell her how I feel. I have to. Your courageous truth seeking tonight has inspired me to go after what I want. I’m going to ask her for a dance.",
  "I’ll be right back.",
  "Guys. She said yes."
];

/** The cue sheet, as it stood before this wave: printed sheets cite these rows. */
const CUES: readonly string[] = ["call_to_the_desktop", "start_the_bingo", "bingo_time", "clippy_on_trabolta", "follow_the_reinstallation", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "spin_the_bottle", "second_hunt_preview", "start_the_second_hunt", "truther_download", "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_button_pressed", "printer_opened", "zip_everyone_out", "trabolta_overshares", "y2k_clock", "y2k_midnight", "server_door_opened", "reset_server_room", "chess_won", "force_majority_stay", "force_majority_leave", "force_their_majority", "patch_combo_a", "patch_combo_b", "patch_rejected", "lights_dance", "restore_the_lights", "final_reveal", "bobbing_for_truth", "read_truth_txt", "the_verdict", "no_pickup_line", "ask_for_advice", "advice_tally", "advice_helped", "advice_thwarted", "the_hand_jive", "clippy_reads_summary", "own_award_lines", "tell_the_truth", "task_manager_reads", "start_the_ceremony", "award_most_trusted", "award_least_trusted", "award_frequent_flyer", "award_lore_hoarder", "award_truthcoin_tycoon", "award_best_liar", "award_duck_speedrun", "award_quest_completionist", "award_most_correct", "award_the_painting", "award_staff_trusted", "award_staff_points", "award_staff_mole", "resurrection", "the simulation completed", "the golden duck", "reinstallation begun", "restore_the_king", "crew_through_the_door", "server_door_closed", "server_door_trust", "trust_patch_bay", "simulation escape attempt", "simulation heart reached", "simulation pickup taken", "ad_burst", "roll_the_credits", "bathroom_report", "language_report", "dream_toggle", "wave_staff_through", "costume_flicker", "trabolta_music_lock", "trabolta_music_unlock"];

/** One line as the pieces the story must hold: the words around each name, by sentence. */
const pieces = (line: string): string[] =>
  line
    .replace("earn 5 cents", "earn five cents") // spelled for the voice (SIGNOFF-w58)
    .split(/\[[^\]]*\]/u)
    .flatMap((part) => part.split(/(?<=[.?!:])\s+/u))
    .map(plain)
    .filter((p) => p.length > 2);

describe("wave 59a: the nine questions", () => {
  it("are 3 + 3 + 3, none a draft or a stand-in, each with a reading, a page and a place", () => {
    expect(FACTS.questions.map((q) => `${q.id}@${q.round}`)).toEqual(["H1@1", "H2@1", "H3@1", "H4@2", "H5@2", "H6@2", "F1@3", "F2@3", "F3@3"]);
    for (const q of FACTS.questions) {
      expect(q.draft, q.id).toBeUndefined();
      expect(q.placeholder, q.id).toBeUndefined();
      expect(q.reading, q.id).toBeTruthy();
      expect(q.where!.startsWith("The Desktop: in "), q.id).toBe(true);
      expect(foldCode(q.codex!.code), q.id).not.toContain(foldCode(q.answer));
    }
    expect(FACTS.rounds!["3"]!.brief).toContain("three");
  });
  it("read through the story's slots: nine filings, nine settles, nine truths", () => {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    for (const q of FACTS.questions) expect(String(v(sim, `Night.q_${q.id.toLowerCase()}`)), q.id).toContain(q.text);
    for (const w of ["fact_v9", "fact_j9", "fact_a9", "fact_c9", "fact_f3", "lie_q9", "hunt_lie_q9"]) expect(sim.model.roles.get("Program")!.secret.has(w), w).toBe(true);
  });
});

describe("wave 59a: his words", () => {
  it("every speakable line of the script is in the story, word for word", () => {
    for (const line of SCRIPT) for (const p of pieces(line)) expect(STORY, p).toContain(p);
  });
  it("every question and answer he reads is the facts file's", () => {
    for (const q of FACTS.questions) {
      expect(STORY, q.id).toContain(plain(`The question was: ${q.spoken ?? q.text}`));
      expect(STORY, q.id).toContain(plain(q.reading!));
    }
  });
  it("the script's typos are as decided", () => {
    expect(STORY).toContain("Everybody, boos and jeers for {Night.least_trusted}. You are a real scorpion.");
    expect(STORY).toContain("But we've run out of time, and no one found the definition for the final clue.");
    expect(STORY).toContain("but I am computing this is, and it is not correct");
  });
  it("what the script drops is gone from the night", () => {
    for (const gone of ["final two", "There are two", "Final fact one", "Round two, question", "No consensus", "Ow. A guess", "It STINGS", "I can feel every bean", "win back my ex"]) expect(STORY, gone).not.toContain(gone);
  });
});

describe("wave 59a: the cue list", () => {
  it("is the same 87 rows in the same order", () => {
    const m = Sim.fromSources(SRC).model;
    const admin = [...m.interactions.values()].filter((i) => i.who === "admin").map((i) => i.id);
    expect(admin).toEqual(CUES);
    expect(admin).toHaveLength(87);
  });
});

describe("wave 59a: the old documents", () => {
  it("are the same entries, still scannable by everyone, and ask nothing", () => {
    const m = Sim.fromSources(SRC).model;
    expect(FACTS.documents).toHaveLength(5);
    for (const d of FACTS.documents!) {
      expect(m.codexCodes.get(foldCode(d.codex.code)), d.was).toBe(d.codex.id);
      expect(m.codex.get(d.codex.id)!.secret, d.was).toBe(true);
    }
    const stacks = read("generated/print-stacks.md");
    for (const d of FACTS.documents!) expect(stacks, d.was).toContain(d.codex.code);
  });
  it("keep her line and the rival's name guarded", () => {
    const block = mindBlock(FACTS);
    for (const d of FACTS.documents!) for (const g of d.guard ?? []) expect(block, g).toContain(g.toLowerCase());
    expect(FACTS.documents!.filter((d) => d.guard !== undefined).map((d) => d.was)).toEqual(["F1", "F2"]);
  });
});

describe("wave 59a: the answer he doesn't know", () => {
  const forms = [F3.answer, ...F3.accept].map((f) => f.toLowerCase());
  const hit = (text: string) => forms.filter((f) => text.toLowerCase().includes(f));
  it("is in no file his worker reads", () => {
    for (const p of ["trabolta.persona.md", "trabolta.mind.md"]) expect(hit(read(p)), p).toEqual([]);
    const yaml = join(DIR, "..", "..", "..", "stagehand", "laptop.yaml");
    if (existsSync(yaml)) expect(hit(readFileSync(yaml, "utf8"))).toEqual([]);
    expect(hit(mindBlock(FACTS))).toEqual([]);
    expect(hit([...neverWords(FACTS), ...answerNeverWords(FACTS)].join(" "))).toEqual([]);
  });
  it("keeps its question's topics, and its entry is marked and secret", () => {
    expect(mindBlock(FACTS)).toContain(F3.topics![0]!);
    const entry = Sim.fromSources(SRC).model.codex.get(F3.codex!.id)!;
    expect(entry.secret).toBe(true);
    expect(entry.text).toContain("▒ HUNT ANSWER F3 ▒");
  });
  it("every beat that reads is out of his worker's context", () => {
    for (const b of [...FACTS.questions.map((q) => `Reading ${q.id}`), "Question Results", "Round One Close", "Overshare Answers", "Round Two Close", "Final Trust", "The Verdict"]) expect(READING_BEATS.has(foldName(b)), b).toBe(true);
  });
  it("stays off the screens until someone has found it, and it is the only one that does", () => {
    const book = bookOf(FACTS);
    expect(book.questions.filter((k) => k.secretFromAgents).map((k) => k.id)).toEqual(["F3"]);
    const n = new Night();
    n.upload("g1", "Calculator");
    const results = () => {
      const view = new FactsWatch().view(n.sim, book);
      return screenResultsOf(view, book, null, { kind: "verdict", tv: true }).find((q) => q.id === "F3")!;
    };
    n.open();
    n.file("g1", "F3", "lie");
    expect(results().answer).toBeNull();
    n.sim.signal("fact_accurate", "g1", { question: "F3" }, "Clippy");
    expect(results().answer).toBe(F3.answer);
  });
});

class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  press(name: string, subject?: string): ChatMessage[] {
    return this.take(this.sim.signal(name, subject));
  }
  upload(id: string, name: string): void {
    const out: SimEvent[] = [];
    out.push(...this.sim.createPerson(id, name));
    out.push(...this.sim.signal("captcha answered", id, { passed: true }));
    out.push(...this.sim.signal("captcha answered", id, { passed: false }));
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 5) out.push(...this.sim.choose(id, 0));
    out.push(...this.sim.choose(id, 1));
    this.take(out);
    this.take(this.sim.scan("Norton Anti-Virus", id));
  }
  open(round = 3): void {
    this.sim.setVar("Night.round", String(round));
  }
  file(id: string, question: string, verdict: string, confidence = 100, answer = "a filed answer"): void {
    this.take(this.sim.signal("fact answered", id, { question, answer, confidence, verdict, ...(verdict === "accurate" ? { key_answer: "the key" } : {}) }));
  }
  tick(seconds: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < seconds; i++) out.push(...this.take(this.sim.tick(1000)));
    return out;
  }
}

const his = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "loc:The Desktop" && m.from === "Trabolta").map((m) => m.text);
/** Seven programs, and the night walked to the Y2K hour by the director's chain. */
const party = (): Night => {
  const n = new Night();
  for (const [id, name] of [["g1", "Calculator"], ["g2", "Notepad"], ["g3", "Minesweeper"], ["g4", "Winamp"], ["g5", "Paint"], ["g6", "Clock"], ["g7", "Solitaire"]] as const) n.upload(id, name);
  for (const c of TO_Y2K) n.press(c);
  return n;
};
const reveal = (n: Night): ChatMessage[] => n.press("final_reveal");
/** 🌑 done: 🍎, the bag, 📄, then ⚖. */
function verdict(n: Night): ChatMessage[] {
  n.press("bobbing_for_truth");
  n.take(n.sim.signal("brought_up_the_bag", "g1", null, "Clippy"));
  n.press("read_truth_txt");
  return n.press("the_verdict");
}

describe("wave 59a: a reading", () => {
  const reading = (n: Night, beat: string) => his(n.take(n.sim.fireBeat(beat)));
  it("reads the guesses, who filed nothing, the answer, and who was right and sure", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "F1", "accurate", 100, "the right words");
    n.file("g2", "F1", "accurate", 80, "the right words again");
    n.file("g3", "F1", "lie", 100, "the wrong words");
    const said = reading(n, "Reading F1");
    expect(said[0]).toBe(`Question one. The question was: ${F1Text()}`);
    expect(said[1]!.trim()).toBe("Here are the guesses you have submitted: Calculator submitted: “the right words”. Notepad submitted: “the right words again”. Minesweeper submitted: “the wrong words”.");
    expect(said[2]).toBe("These programs did not submit any truth: Winamp, Paint, Clock and Solitaire");
    expect(said[3]).toBe(Q("F1").reading);
    expect(said[4]).toBe("Congratulations to these programs for getting a correct answer: Calculator");
    expect(said).toHaveLength(5);
  });
  it("drops the line that would be empty, and invents none", { timeout: SLOW }, () => {
    const n = party();
    expect(reading(n, "Reading F2")).toEqual([`Now. Question two. The question was: ${Q("F2").text}`, "These programs did not submit any truth: Calculator, Notepad, Minesweeper, Winamp, Paint, Clock and Solitaire", Q("F2").reading]);
    for (const g of ["g1", "g2", "g3", "g4", "g5", "g6", "g7"]) n.file(g, "F2", "accurate", 100);
    const all = reading(n, "Reading F2");
    expect(all.some((t) => t.startsWith("These programs did not"))).toBe(false);
    expect(all.at(-1)!.startsWith("Congratulations to these programs")).toBe(true);
  });
  it("F3 found: the answer, then the Congratulations", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "F3", "accurate");
    const said = his(reveal(n));
    expect(said).toContain(F3.reading);
    expect(said.join(" ")).not.toContain("We will return to this one");
    expect(said).toContain("Congratulations to these programs for getting a correct answer: Calculator");
  });
  it("F3 nobody found: no word of it, his two lines; a lie stays on the record", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "F3", "lie");
    const said = his(reveal(n));
    expect(said.join(" ")).not.toContain(F3.reading!);
    expect(said).toContain(F3.unfound![0]);
    expect(said).toContain(F3.unfound![1]);
    expect(v(n.sim, "Kernel.q9")).toBe("lie");
  });
  it("F3 nobody filed at all: not a lie, and no talk of 100%%", { timeout: SLOW }, () => {
    const n = party();
    const said = his(reveal(n));
    expect(said).not.toContain(F3.unfound![0]);
    expect(said).toContain(F3.unfound![1]);
    expect(v(n.sim, "Kernel.q9")).toBe("none");
  });
});

describe("wave 59a: the last answer decides, and every road ends in the rave", () => {
  it("found: ⚖ is the full truth, clean; 8-A follows by itself, the song, the rave, Clippy hosts", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "F3", "accurate");
    n.file("g2", "F1", "lie"); // a lie changes nothing
    reveal(n);
    const truth = verdict(n);
    expect(his(truth).join(" ")).toContain("Grok was too antisocial");
    expect(his(truth).join(" ")).not.toContain("I have compared every fact");
    expect(v(n.sim, "Night.phase")).toBe("finale_truth");
    expect(v(n.sim, "Night.ended")).toBe(false);
    expect(v(n.sim, "Night.truth_first")).toBe(true);
    expect(n.tick(829).filter((m) => m.channel === "loc:The Desktop")).toEqual([]);
    const a = his(n.tick(2));
    expect(a[0]).toBe("You guys.");
    expect(a).toContain("I solved the Grand Unified Theory, and she said yes.");
    expect(a.at(-1)!.endsWith("I'm off to see my lady.")).toBe(true);
    expect(a.length).toBeLessThanOrEqual(40);
    expect([v(n.sim, "Night.ended"), v(n.sim, "Night.ending"), v(n.sim, "Night.phase")]).toEqual([true, "song", "finale_song"]);
    expect(v(n.sim, "Night.everyone_free")).toBe(false);
    n.tick(77);
    expect([v(n.sim, "Night.screen"), v(n.sim, "Night.everyone_free"), v(n.sim, "Night.raved")]).toEqual(["song", true, false]);
    const asked = n.take(n.sim.signal("start_the_ceremony"));
    expect(asked.some((m) => m.text.includes("The rave hasn't started"))).toBe(true);
    n.tick(171);
    expect([v(n.sim, "Night.screen"), v(n.sim, "Night.terminals"), v(n.sim, "Night.lights"), v(n.sim, "Night.raved")]).toEqual(["rave", "rave", "rave", true]);
    n.press("start_the_ceremony");
    expect(v(n.sim, "Night.ceremony_host")).toBe("Clippy");
  });
  it("nobody found it: 8-B, his pause, every line kept, the old line wins nothing, the flicker, his news", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "F3", "lie");
    reveal(n);
    verdict(n);
    const b = his(n.tick(831));
    expect(b[0]).toBe("How do you feel now that you know the truth about your party tonight?");
    expect(b.at(-1)).toBe("Do you think I should just ask her for a dance?");
    expect(v(n.sim, "Night.ended")).toBe(false);
    const ask = n.tick(106);
    expect(his(ask)).toEqual(["Really? You think I should?", "Well. What should I say to her? I'll give you two minutes to come up with a line."]);
    const cards = ask.filter((m) => m.kind === "widget" && m.widget?.kind === "answer");
    expect(cards.length).toBe(7);
    expect(cards[0]!.text).toBe("What should I say to her?");
    expect(v(n.sim, "Night.lines_open")).toBe(true);
    n.take(n.sim.signal("answer answered", "g1", { question: "P1", text: "You look like a good download", verdict: "lie", card: 1 }));
    n.take(n.sim.signal("answer answered", "g2", { question: "P1", text: FACTS.answers[0]!.answer, verdict: "accurate", card: 2 }));
    expect(v(n.sim, "Night.line_by")).toBe("none");
    expect(v(n.sim, "Night.ending")).toBe("none");
    const read = his(n.press("no_pickup_line"));
    expect(read[0]).toBe("Ok. I've been waiting for you. Let's read your ideas for pickup lines out loud.");
    expect(read[1]).toContain("Calculator recommended I try: “You look like a good download”.");
    expect(read[1]).toContain("Notepad recommended I try:");
    expect(read[2]).toBe("Ok. I am not sure any of those are going to work.");
    expect(read.at(-1)).toBe("I'll be right back.");
    expect(v(n.sim, "Night.lines_open")).toBe(false);
    const back = n.take(n.sim.tick(49_000));
    expect(his(back)[0]).toBe("Guys. She said yes.");
    expect([v(n.sim, "Night.ending"), v(n.sim, "Night.ended")]).toEqual(["song_pickup", true]);
    expect(his(n.tick(78))).toEqual([]);
    expect(v(n.sim, "Night.screen")).toBe("song");
    n.tick(171);
    expect(v(n.sim, "Night.raved")).toBe(true);
  });
  it("nobody on the card: straight to \"You know what.\", and the two minutes close by themselves", { timeout: SLOW }, () => {
    const n = party();
    reveal(n);
    verdict(n);
    n.tick(831);
    n.tick(106);
    const read = his(n.tick(121));
    expect(read[0]!.startsWith("You know what.")).toBe(true);
  });
  it("📜 Task Manager, when the TV's voice fails: 8-A or 8-B still follow", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "F3", "accurate");
    reveal(n);
    verdict(n);
    n.tick(100);
    n.press("task_manager_reads");
    expect(v(n.sim, "Night.truth_reader")).toBe("Task Manager");
    expect(his(n.tick(740))).toEqual([]); // the read's own clock
    expect(his(n.tick(95))[0]).toBe("You guys.");
  });
  it("Combo A and Combo B keep their monologue, and the rave follows the read", { timeout: SLOW }, () => {
    for (const [press, ending] of [[["patch_combo_a"], "disabled"], [["patch_combo_b", "clippy_reads_summary"], "destroyed"]] as const) {
      const n = party();
      for (const c of press) n.press(c);
      n.tick(15);
      n.press("tell_the_truth");
      expect(v(n.sim, "Night.ending"), ending).toBe(ending);
      expect(v(n.sim, "Night.raved"), ending).toBe(false);
      n.tick(831);
      expect([v(n.sim, "Night.raved"), v(n.sim, "Night.screen")], ending).toEqual([true, "rave"]);
    }
  });
});

describe("wave 59a: 🌑", () => {
  it("closes round three, settles it, then ranks and reads the board on one press", { timeout: SLOW }, () => {
    const n = party();
    n.file("g1", "F1", "accurate");
    n.file("g1", "F2", "accurate");
    n.file("g2", "F1", "accurate");
    n.file("g3", "F1", "accurate", 60);
    const before = v(n.sim, "g1.trust") as number;
    const said = his(reveal(n));
    expect(v(n.sim, "Night.r3_filing_closed")).toBe(true);
    expect(v(n.sim, "Night.r3_closed")).toBe(false); // the server room stays live until truth.txt
    expect(v(n.sim, "g1.fact_v7")).toBe("accurate");
    expect(v(n.sim, "g1.trust")).toBe(before + 20);
    expect(v(n.sim, "Night.most_trusted")).toBe("Calculator");
    expect(said).toContain("The program who has shown the highest strength of character this evening is: Calculator");
    expect(said).toContain("And our winner for the evening. In first place: Calculator.");
    expect(said).toContain("In second place: Notepad and Minesweeper.");
    expect(said).toContain("Congratulations, Calculator. You have pulled off the unthinkable.");
    expect(said.at(-1)).toBe("I am going to prepare your prize. But first, I will hand it back to Clippy, for our final game of the evening – Bobbing For Truth.");
    expect(said.length).toBeLessThanOrEqual(40); // MAX_VOICE_LINES
  });
});

describe("wave 59a: 🏆", () => {
  const ranks = (n: number): string[] => {
    const sim = new Night();
    const names = ["Calculator", "Notepad", "Minesweeper", "Winamp", "Paint", "Clock", "Solitaire"].slice(0, n);
    names.forEach((name, i) => {
      sim.upload(`g${i + 1}`, name);
      sim.sim.setVar(`g${i + 1}.trust`, String(70 - i * 10));
    });
    sim.sim.setVar("Night.phase", "trust_chart");
    sim.sim.setVar("Night.step", "11");
    return his(sim.press("show_the_rankings"));
  };
  it("names three from each end", { timeout: SLOW }, () => {
    const said = ranks(7);
    expect(said).toContain("The program you should all respect the most as a trusted leader is: Calculator");
    expect(said.some((t) => t.endsWith("primary leader in the event that the most trusted leader ever requires reinstallation is: Notepad"))).toBe(true);
    expect(said).toContain("A wildcard of sorts who you should consider trusting under certain circumstances is: Minesweeper");
    expect(said).toContain("The third least trustworthy program, monitored closely, is: Paint");
    expect(said).toContain("The second least trustworthy program, scrutinized intensely: Clock");
    expect(said).toContain("The most least trustworthy program, currently monitored for potential permanent reinstallation: Solitaire");
    expect(said.at(-1)!.startsWith("It is time to print a Security Certificate PDF File for our most trusted program, Calculator.")).toBe(true);
  });
  it("with too few programs skips the lines that have no program, and names nobody twice", { timeout: SLOW }, () => {
    const said = ranks(4);
    expect(said.some((t) => t.startsWith("A wildcard of sorts") && t.endsWith("Minesweeper"))).toBe(true);
    expect(said.some((t) => t.startsWith("The third least"))).toBe(false);
    expect(said.some((t) => t.startsWith("The second least"))).toBe(false);
    const two = ranks(2);
    expect(two.some((t) => t.startsWith("A wildcard"))).toBe(false);
    expect(two.at(-1)!.startsWith("It is time to print")).toBe(true);
  });
});

const F1Text = () => Q("F1").text;
