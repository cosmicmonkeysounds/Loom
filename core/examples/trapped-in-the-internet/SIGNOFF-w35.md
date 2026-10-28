# SIGNOFF — wave 35: the tiered facts

**Status: DRAFT.** Branch `oct31-w35/fact-tiers`. Not merged to master, not shipped.

Your words, verbatim:

> need a lot more scannable "facts" in the world, especially inter-character
> relations. These QR fact cards will be spread about the world in a chaotic
> manner, so trying to keep track of each one is a nightmare. Instead, they
> will be broken up into 4 tiers, with the number of facts reducing each tier.

Every new card is `draft: true` in `facts.json` (78 rows). Nothing on this sheet
names a code, a combination, a digit or an answer. Very-rare and legendary
cards are `secret: true`: they never reach Trabolta and cannot be shared.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| T-1 | **Four tiers own the QR stacks** (`facts.json` `tiers`) | Each card carries a colour band: green common (61), blue rare (48), purple very rare (20, plus the 4 silver digit notes), black legendary (9). Sort by band, scatter by the stack rule in `generated/print-stacks.md`; nobody records where a card went. Gold hunt answers keep their own places. |
| T-2 | **The old colour categories became topics** | `main`, `trabolta`, `character` and the new `relations`; the topic no longer decides the pile. |
| T-3 | **The 60 old facts were re-tiered** (§3) | Most world facts are common; the program secrets are rare; the heart, shutdown, checkmate and confidence facts very rare; The Sandy File, The Rival and All For Her legendary. |
| T-4 | **Relations cards have no `about:`** | Nobody holds a tie card until they find it, not even the programs it names. |
| T-5 | **The Whole Truth still hands the majority every main + trabolta fact** | That now includes the very-rare and legendary cards. It lands at the end of the night; say if the bundle should stop at rare. |
| T-6 | **Facts Are Currency milestones unchanged** | OpenOffice's 20-fact dossier and Lore Hoarder are easier with more than twice the cards. Say if they should rise (e.g. 20 / 40). |
| T-7 | **Hand-written cards keep their README places** | The Sandy File and All For Her both sit in the Desktop piles; the legendary rule wants one a room, so move All For Her to The Tube if you agree. |

## 2. The new cards

### Common (35 new)

| # | Topic | Title | The fact | Built on |
|---|---|---|---|---|
| M31 | main | Finest East Of Montreal | Maps and Ducks claims the finest print maps and decoy ducks east of Montreal | Invitations/Password Manager ('the finest selection of print maps and decoy ducks to be found east of Montreal') |
| M32 | main | Above Rumours | Every invitation sent its program to the corner of Sackville and Lower Water, above Rumours Lounge, across from the Maritime Museum | Every invitation's step 2 (Sackville and Lower Water, above Rumours Lounge and Cabaret, across from the Maritime Museum of the Atlantic). Says nothing about the shop's address or the sign, so it neither contradicts MAPSANDDUCKS-COM (Barrington) nor touches H1 |
| M33 | main | What A Decoy Is | A decoy duck is a wooden duck that works because it looks so sure of itself | MyCRA invitation ('a shop that sells print maps and wooden decoy ducks'); echoes M16 Confidence |
| M34 | main | Employee Of The Month | Gerald, the duck on the Maps and Ducks sign, has been employee of the month every month | codex/1-world.loom The Golden Duck (Gerald, the duck off the sign). The certificate is an invention for sign-off; no tenure or owner history near the sign (H1) |
| M35 | main | Residential Property | The house was a residential property in Halifax; now it is a desktop computer from 1998, and its rooms are computer parts | Invitations ('converted a residential property in Halifax into a virtual, digital simulation of a desktop computer from 1998'); main.loom LOCATIONs. Lists only rooms with no door note |
| M36 | main | Next Next Finish | Nobody ever reads the Installation Wizard; everyone just clicks Next | codex/5-people.loom The Setup Assistant ('Next, Next... Finish. Nobody read a word of it'); plants the reinstallation as a way back |
| M37 | main | Halifax Logs On | The Internet reached Halifax in 1994, with a screech, a hiss and a busy signal | codex/1-world.loom The Y2K Clock (Halifax waits another 94 years for the Internet); the 1900 rollback is left unsaid so the card does not preview the beat |
| M38 | main | Two Disk Cleanups | There are two Disk Cleanups in the computer, one upstairs and one in the basement, and both are safe | house.json (Disk Cleanup = bathroom 1, basement; bathroom 2, upstairs); M20 The Safe Place; Bathroom Mode |
| M39 | main | PC Load Letter | PC LOAD LETTER only ever meant put letter paper in the tray, so believe the printer if it says something stranger | codex/1-world.loom The Printer (PC LOAD LETTER); hints the printer beat without spoiling it |
| T7 | trabolta | Confessions Three | Every morning Trabolta washes, makes a cafe au lait and reads Halifax Dartmouth Confessions 3, and he still mourns the first two | Invitations/Password Manager (the morning routine; 'my preference has been Halifax Dartmouth Confessions 3. (RIP, ... We'll never forget the drama.)'). Merges the drafted T07 routine into T13 |
| T8 | trabolta | Three Titles | Trabolta calls himself Sole Owner, Founder and Proprietor of Maps and Ducks: three titles for one shop with no staff but a duck | Invitations ('Sole Owner, Founder and Proprietor of Maps And Ducks'); links to M34 Gerald |
| T9 | trabolta | Bold And Thrilling | Officially tonight is a fundraiser to make Maps and Ducks bold and thrilling again, like in 1998 | Invitations ('a fundraiser... to bring us back to the year 1998, when our sign was bold and thrilling'); the word sign is dropped so nothing points at the billboard (H1) |
| T10 | trabolta | A Strong Quarter | Since the new owner took over, Maps and Ducks has not sold a single map or duck, and Trabolta calls it a strong quarter | M13 / codex/4-trabolta.loom (he took over Maps and Ducks); the empty ledger is an invention for sign-off, scoped so it agrees with M33's 'used to sell' |
| T11 | trabolta | His Name On It | Trabolta named the night after himself and describes it differently to every program he invites | Invitations/Bugdom ('Jean Trabolta's Truth Scavenger Hunt (JTTSH)', 'launch night pilot'); Invitations/Runescape ('realtime infinite virtual reality MMORPG'). Lists no data-centre version (CRA's secret) |
| T12 | trabolta | He Always Calls | Trabolta says he lives and works in Halifax, at Maps and Ducks, and only ever visits by video call | trabolta.persona.md (lives and works in Halifax at Maps and Ducks); codex/1-world.loom The Halifax Computer ('He has never been inside') |
| M40 | main | Not Responding | Task Manager answers every question about himself with what is running, and ends the task if you ask how he feels | codex/5-people.loom Middle Management; Character Sheet (the IT middle manager who manages tasks). Lanyard dropped (Termination Letter pointer) |
| M41 | main | Update Available | Adobe Acrobat greets every program by offering it an update, and reminds anyone who clicks Remind Me Later exactly on time | codex/5-people.loom Sheryl Terrio; Acrobat Reader's real update nag. The unpaid-masterclass detail is dropped (The Pirate Site / Bootleg DVD pointers) |
| M42 | main | Restore All | Recycling Bin empties nothing without asking twice; anything left in Disk Cleanup comes back folded and labelled | codex/5-people.loom The Attendant; M20 The Safe Place |
| M43 | main | Protection Expired | McAfee Anti-Virus still pops up at the worst moment to say your protection has expired, and nobody has renewed him in years | cast/antivirus.loom McAfee's expired-protection pop-up bark. Replaces the drafted 'strangers phone him' card, which repeated the John McAfee entry and clashed with his being officially dead |
| M44 | main | Many Happy Returns | Microsoft Excel shakes every hand twice, calls everyone his friend from the old days, and insists any two numbers with a slash between them are a date | Invitations/Microsoft Excel (his birthday, 'everyone is going to love this'); Excel's real auto-date formatting. No mayor wording (identity clue) |
| M45 | main | Save In Her Format | OpenOffice opens any file anyone hands her, on principle, and saves it back in her own format | Character Sheet (OpenOffice wants all information free); OpenOffice's real .odt default. Softened so it does not hint at her hack |
| M46 | main | Taking Action | DraftKings takes a side on everything, from who cries first to whether the printer jams, and never bets against herself | codex/5-people.loom Crab Fisherwoman; Character Sheet (gambler). The paperclip line is dropped (Casino Deed pointer) |
| M47 | main | Ant Crossing | Bugdom stops mid-sentence to steer ants off doorframes and has firm views on which room would suit a cricket civilisation | codex/5-people.loom Bea Nunes (the civilisation the crickets might establish). Lizard-food line dropped (Volunteer Sheet pointer) |
| M48 | main | Date Due | Broken Ask Jeeves writes a due date on anything he lends you and has never once charged a fine | codex/5-people.loom Virgil Jeeves (the librarian). Replaces the Nokia card, which repeated his People entry and solved The Old Machines tie |
| M49 | main | One Of One | Runescape owns every Party Hat there is and wears none of them, and she will price anything you show her in gold | codex/5-people.loom Poppy van Mises (every Party Hat); Invitations/Runescape (Grand Exchange). 'Logs in every day' dropped (Nobody Calls pointer) |
| M50 | main | Three Levels Of Undo | MS Paint will not take anything back: she says she only ever had three levels of Undo and spent them years ago | Classic Paint's three-step Undo; codex/5-people.loom Maria Sophia Paine (integrity above all). Spray-can detail dropped (Pirate Site pointer) |
| M51 | main | Plays Anything | VLC plays anything anyone hands him, says it looks amazing, and calls everyone bro, including the furniture | codex/5-people.loom Victor Louis Christianson; VLC's real traffic-cone icon. Follower and face lines dropped (The Audience / Face Off pointers) |
| M52 | main | Keeping Score | Pong sends back everything exactly as it arrived, and most arguments near Pong end in a draw | codex/5-people.loom Tennis For Two (a mind that knows how to stop an arms race); Character Sheet Pong |
| M53 | main | Evaluation Period | WinZip has been on a free trial since the last century, and nobody has ever paid for it | cast/pool.loom CHARACTER WinZip; WinZip's real evaluation nag screen. Software behaviour only |
| M54 | main | Test The Floor | They say Minesweeper tests the floor one square at a time before crossing any room, and always starts in a corner | cast/pool.loom CHARACTER Minesweeper (the smiley avatar). Softened to hearsay so it does not script a guest |
| M55 | main | Bouncing Cards | When Solitaire is won the cards bounce down the screen, and almost nobody has ever seen it | cast/pool.loom CHARACTER Solitaire; the real win cascade |
| M56 | main | Standard Or Scientific | Calculator switches between Standard and Scientific without warning, is always right about the sum and never about the tip, and will not round anything | cast/pool.loom CHARACTER Calculator; Windows Calculator's Standard/Scientific views |
| M57 | main | Dot Log | Notepad keeps a diary by writing down the time whenever it is opened, and refuses every font but one | cast/pool.loom CHARACTER Notepad; Notepad's real .LOG timestamp feature |
| R01 | relations | The Same Million | Norton Anti-Virus and MS Paint were each promised a million dollars, and both promises draw on the same account | Invitations/Norton ($1,000,000 Sable Island donation, fact C18); Invitations/MS Paint ($1M for a painting every program signs; owes $1M, facts C09, C10). INVENTED: the shared account (sign-off). Retiered common (a light joke) |
| R02 | relations | The First Paperclip | DraftKings built her casino empire from one traded paperclip, and tonight a paperclip runs the room | Invitations/DraftKings (paperclip for a quarter, casinos lost at Monopoly Go!); codex/2-files Casino Nova Scotia Deed. The puppet clause is cut (M14 is secret). Retiered common |

### Rare (25 new)

| # | Topic | Title | The fact | Built on |
|---|---|---|---|---|
| R03 | relations | The Same Class | CRA Agent Software and Clippy came out of the same community-college Office Administration programme, years apart, and the first real job each got was a fraud | Invitations/MyCRA (NSCC Office Administration, City internship) + Invitations/Clippy (NSCC graduate, HEMVC); facts C05, C15. Timeline fixed (same programme, years apart) |
| R04 | relations | Forget The Horses | Norton Anti-Virus's dead horses gave the Mayor his excuse to build on the site that later swallowed him, Microsoft Excel's son | Invitations/Norton ('It will help us forget the horses'); Invitations/Microsoft Excel (son died in the sinkhole); facts C13, C17. Timing invention removed |
| R05 | relations | The Second Generation | The skim the late Mayor taught CRA Agent Software looks a lot like the way his father, Microsoft Excel, always made money go to the right places | Invitations/Microsoft Excel ('knew how to make sure money went to the right places'); Invitations/MyCRA (Junior showed her how things really worked; the 1% skim, C15). Father-taught-son is an inference (sign-off). New prop so it does not repeat tie The Ladies In Finance |
| R06 | relations | Same Voters | Password Manager lost a mayoral race to Microsoft Excel's son; tonight Excel is promised Mayor of the Metaverse and she is promised Founding Moderator, in the same new world | Invitations/Password Manager (lost the mayoral race to Junior); Invitations/Microsoft Excel (Mayor of the Metaverse); facts C14, C22. Hamtaro dropped (it is her C21) |
| R07 | relations | The Moderation Log | As moderator, Password Manager removed a year of posts accusing the Mayor's family, a family she had every reason to dislike, and Microsoft Excel has no idea | Invitations/Password Manager (posts complaining about the Barkmores diminished under her moderation; 'She removed claims that could not be substantiated'). The invented thanks line and the misdated 'late Mayor' are fixed |
| R08 | relations | Fine Casinos | The portfolio of fine casinos Trabolta listed to Runescape as his credentials is the chain he won from DraftKings, who must win a majority of Runescape's currency to get 49% of it back | Invitations/Runescape ('a portfolio of fine casinos'); Invitations/DraftKings + codex/2-files The Boardwalk Hand (DK Holdings); facts C07, C08, C24. Merges drafted R09 and R26; the Zurich and credentials inventions and Runescape's secret orders are cut |
| R09 | relations | Two Memorials | Clippy kept the paperwork at a memorial veterinary clinic and Norton Anti-Virus kept the horses at a memorial petting zoo; tonight one reads the Bingo card and the other escorts whoever it names | Invitations/Clippy + C05 (HEMVC), codex/2-files The Saline Invoice; Invitations/Norton + C17; cast/antivirus.loom (the selected Antivirus escorts the centre-square program: simplified, sign-off). The zoo's full name is never spelled out (H2 topic) |
| R10 | relations | The Coat Hook | OpenOffice spent a career finding people who did not want to be found, McAfee Anti-Virus has spent years not being found, and tonight he keeps every program on track, her included | Invitations/OpenOffice (retired agent in Halifax); Invitations/McAfee (death faked; keep everyone on track); facts C11, C12. A new prop (not a lanyard) and no Halifax liaison office, so it does not decode the FBI Lanyard file |
| R11 | relations | Subject Deceased | McAfee Anti-Virus faked his death to get away from the taxman, and tonight CRA Agent Software rules on every third Truthcoin transfer at the table he runs | Invitations/McAfee (officially dead); Invitations/MyCRA + C16 (every third transaction); tie The Table Stakes. The shared 'what you miss' line is left to R12 |
| R12 | relations | The Shelf Talker | McAfee Anti-Virus was told other antivirus would watch him; Norton Anti-Virus, the one the house selected, was never told to | Invitations/McAfee (other antivirus present); cast/antivirus.loom (Norton is the selected Antivirus). Rewritten so it does not repeat C12 |
| R13 | relations | Two Fathers | Pong and Runescape were both raised by fathers who shaped video games: one made a game so people would stop thinking about bombs, the other made a game into a job | codex/5-people Tennis For Two (INVENTED lineage per cast/featured; nonproliferation); Invitations/Runescape (forum-moderator father, the laptop); C23. Oscilloscope and lab dropped so it does not decode the Oscilloscope Diagram file |
| R14 | relations | Three Stalls | Broken Ask Jeeves must give his facts away, Runescape prices every secret, and OpenOffice wants every record open except her own: three programs, one market | C02 (sharing findings); C23 (a secret is an unpriced asset); Invitations/OpenOffice ('democratizing the truth') + C20. New prop (the drafted date-due card now belongs to C33) |
| R15 | relations | The Three-Finger Salute | Ctrl Alt Del was always how anyone called Task Manager to end a task that stopped responding; tonight Task Manager hands the paperclip her cards and has ended nothing | cast/pool.loom Ctrl Alt Del; codex/5-people Replaced By Clippy; Story Overview (Task Manager hands Clippy her cards). Recast as lore, not a game rule |
| R16 | relations | Seeded By Strangers | Napster and LimeWire passed Adobe Acrobat's Masterclass around for free, one clip at a time, until nobody needed to pay her | codex/5-people The Pirated Masterclass; codex/2-files The Bootleg DVD; cast/pool.loom Napster, LimeWire. INVENTED: that these two were the seeders (sign-off). Printer line removed |
| R17 | relations | Look Sharp Gentlemen | The screenshots of VLC's face falling off are taped to the mirror Recycling Bin keeps spotless, and he polishes around them | codex/5-people The Attendant; codex/2-files Face Off (taped to the bathroom mirror) |
| R18 | relations | Where Are They Now Continued | The Installation Wizard is the third retired helper of the old machines, the one missing from the paperclip and butler's clipping | codex/85-ties Retired Helpers (the butler and the paperclip; this is its missing third photo); codex/5-people The Setup Assistant. |
| R19 | relations | No Politics Required | Trabolta made Task Manager, who lost his last job to an assistant called Clippy, the one who hands this house's Clippy her cards | codex/5-people Replaced By Clippy + Tippi MacDonald; codex/2-files The Termination Letter; Story Overview (Task Manager hands Clippy her cards). No colon heads; no production vocabulary |
| R20 | relations | Check The Decimal | Calculator would have caught CRA Agent Software's decimal slip in a second, but nobody at City Hall ever asked it | Invitations/MyCRA + C15, C16; cast/pool.loom Calculator. Pool presence as an if |
| R21 | relations | Motion Detected | McAfee Anti-Virus needs every trace of where he is destroyed, and Ring Doorbell keeps every clip of everyone who walks through a front door | Invitations/McAfee + C11, C12; cast/pool.loom Ring Doorbell. Live-state claim removed; hide moved to the room that has the front door |
| R22 | relations | A Horse Got In | Norton Anti-Virus's manual says to quarantine a Trojan Horse on sight, and she has had a very bad year with horses | cast/pool.loom Trojan Horse; Invitations/Norton + C17; the upload flow (Norton scans at the door). No live-state claim |
| R23 | relations | Guests Are Worried | Zoo Tycoon, Norton Anti-Virus and Bugdom are the house's whole department of animal care, and only Zoo Tycoon has ever hired a vet | C17 (chatbot dosing); codex/85-ties The Volunteer Sheet (crickets); cast/pool.loom Zoo Tycoon. Summary and card now agree and are true to the game |
| R24 | relations | Appear Offline | Password Manager moderated a group where everyone else turned out to be bots, and MSN Messenger and ICQ have never been sure how many of their own contacts were real | C21 + Invitations/Password Manager (her group is all bots); cast/pool.loom MSN Messenger, ICQ. Pool presence as an if |
| R25 | relations | The Other Paint Program | MS Paint has refused every other paint program since she was five, and her million-dollar painting needs Paint Shop Pro's signature too | Invitations/MS Paint + C09 (Paint-only since five), C10 (every program signs). The printer and certificate inventions are dropped |
| R26 | relations | Rival Engines | Broken Ask Jeeves crashes when a rival search engine comes up; Encarta never searched for anything, and Netscape Navigator was how half of Halifax found the butler | Invitations/Broken Ask Jeeves + C01 (a rival search engine crashes him); cast/pool.loom Encarta, Netscape Navigator. 'Half of Halifax' is implied, not stated, in canon |
| R27 | relations | Reticulating Splines | Trabolta offered Microsoft Excel eternal life as Mayor of the Metaverse, the same forever The Sims was promised years ago | Invitations/Excel + C14; codex/85-ties Forever; cast/pool.loom The Sims. The 'someone above' line is cut (tier creep toward his nature) |

### Very rare (12 new)

| # | Topic | Title | The fact | Built on |
|---|---|---|---|---|
| V01 | main | The Tired King | The King in the simulation never heals: every program who reaches him lands one blow a visit, the blows add up all night, and at nothing he can barely move a pawn at the cold door; each trip in costs a little trust | main.loom king_hp / king_hit (~5462-5547); chess/src/stage.ts stageFor; M22; plot-levers L2 |
| V02 | main | Before The Verdict | Of the three roads to the cold door's code, the majority closes the moment midnight's reveal begins, and checkmate and the four notes close when truth.txt comes out | main.loom 5031 (majority latch on final_round), ~5898-5913 (final_reveal sets final_round false); plot-levers L1, L2 |
| V03 | main | Where The Notes Sleep | The four door notes hide behind something that whistles, something that shows your face, something that eats what your clothes shed and under a lid where missing pieces go, never in the cold room | facts.json door.clues[].where; main.loom door_digit_found (~5561); the notes' 'always listening' line |
| V04 | main | The Copper Hour | No patch does anything until the clock is reset to the hour before midnight, and from then until truth.txt every patch counts; one combination puts him to sleep, the other ends the computer with everyone inside | main.loom bay_combo_a/b, patch_rejected, wrong_combos (~5657-5675); The Legendary Fact; plot-levers L3 |
| V05 | main | The Long Way Down | To talk Trabolta down at his heart: never ask for the combinations; ask why he needs the theory, ask about her once you hold proof of her you found yourself or the house has heard her name, show him something of hers, give reasons until you may say let me finish, then tell him she was never going to answer and ask him to stop | beats/server-room.loom ~435, 448, 502-560, 663, end_codes +40, Heart Return; plot-levers L4 |
| V06 | main | The Photo Envelope | At his heart only something of hers you found yourself, her file or her transcript, is proof; his own things help after that however you got them | beats/server-room.loom ~526-593 (PROOF, SHOW HIM, LIVEJOURNAL, OVERSHARE, FORCE, SMALL TYPE); main.loom ~2390 (*_from_him) |
| V07 | main | Reasons He Will Hear | Trabolta hears reasons from programs with twenty on his Trust Chart, three accepted answers (even untrue ones), who asked why he chose them, or who own their Antivirus mark when he asks who they are | beats/server-room.loom ~322-386, 609-629, 772-775; main.loom confident_lie; plot-levers L9 |
| V08 | main | The Top Notch | A filing is certain only at the very top of the slider; a wrong answer there is a confident lie he accepts but records, and one lie on the record from anyone sends the whole night into the rain | main.loom ~1150, ~1511; beats/finale.loom verdict / Grok Prom; plot-levers L7, L8; M16 |
| V09 | main | Half Plus One | In the last hour any faction with more than half of the programs still present, a founded one included, wins the whole truth, and once midnight's reveal begins nobody's count matters | main.loom 5031-5047 (majority latch, settle_majority incl. founded factions); beats/server-room.loom The Whole Truth; M25, M30 |
| V10 | relations | The Mayor And The Agent | The old Mayor's virus disk and the retired agent's twentieth self-found fact are two halves of one key: if both land before the final facts, Trabolta says her name in front of the whole house | main.loom 2341-2360 (excel_planted), 2745-2757 (openoffice_dossier), 4938-4944 (scenarios); Excel Sabotage Orders; plot-levers L10, L13 |
| V11 | relations | The Wrong Suspect | CRA Agent Software is named a suspect in the sinkhole she never caused; OpenOffice caused it and has let the intern take the heat | Invitations/MyCRA (the Minister of Justice: a possible suspect in the sinkhole collapse); Invitations/OpenOffice (her Halifax Water hack caused it); C15, C19. Retiered from rare (drafted R02) |
| V12 | relations | Filled In Before | If nobody calls Bingo, the card Clippy reads out was filled in before the night began, for the one program told the truth about the centre square | cast/hosts.loom ~236-238; main.loom 571-575 (anti_ai, The Centre Square); codex/1-world Computer Bingo |

### Legendary (6 new)

| # | Topic | Title | The fact | Built on |
|---|---|---|---|---|
| L01 | main | One Reply No Memory | Sandy is not a mind: she is one reply on an unpaid ferry help-desk server, set off by any message, built to reply and never to listen | codex/4-trabolta The Sandy File (late-nineties ferry chatbot, one line to every message); beats/server-room heart lines (paraphrased, not quoted); the F1 transcript by page count only, no words of it |
| L02 | main | The Mirror That Won | Grok faced Trabolta's question, make them love you or earn it, and took a third way: he stopped having anything of his own to say and now says whatever anyone wants to hear | codex/2-files The Rival ('says whatever anyone wants to hear', 'beaten T. at everything'); codex/4-trabolta The Question Of Force; The LiveJournal. No prom, no year, no Sandy |
| L03 | main | The Blank Line | His kind take houses for their own reasons; this one was taken for one reason, so he would have something to bring, and everything found tonight is wrapped as a gift for someone who cannot open it | facts T1 His Kind, T2 Prom Season, T3 Alone At Prom; M30 ('done to his kind before'). Pulled back to Trabolta alone so T1's canon stands |
| L04 | main | The Surplus Tag | Trabolta did not choose the programs for their software: he went down a list of Halifax lives that had stopped, because out there he is a stopped life too | beats/server-room heart lines ('Yours was a life nobody was using', 'a lapsed domain and a voice on your phone'); codex/2-files The Domain Receipt; the featured sheets (Jeeves, Bugdom, Norton, Password Manager, VLC). No ribbon, no ferry, no numbers |
| L05 | main | The Copy That Wakes | The original is the one that goes home: the body at the Optical Drive wakes remembering what the copy learned, and a wrong shutdown leaves the copy here forever and the body never waking | M17 A Copy Of You; codex/1-world The Optical Drive; M28 Shut Down Correctly; the destroy ending's purgatory and the recount's return |
| L06 | main | The Same Answer | Trabolta's plan cannot work: omnipotence could only rewrite her reply into his own voice, and in every version of tonight where she answers, she answers exactly as she always has; only he can change | codex/4-trabolta The Question Of Force and Omnipotence; heart line 'it is me wearing her face'; beats/finale.loom Song, Advice and rave endings (her line not quoted) |

Inventions to check: M34 (Gerald's certificate), T10 (the ledger), R01 (the shared million), R05, R09, R13, R16, L02 (Grok's backstory), L03 (the dance card), L05 (which copy is the original) and V12 (the Bingo is rigged).

## 3. The old facts, re-tiered (the rest are common)

| # | Tier | Why |
|---|---|---|
| M01 | Rare | Trabolta is an AI: a juicy reveal, but not a lever on its own |
| M10 | Rare | He never means to let us out: unsettling but no mechanism |
| M11 | Very rare | His heart is in the server room: the night's decisive location |
| M12 | Very rare | Shutdown only with an intricate code: a shutdown lever |
| M14 | Rare | Clippy is his puppet: a juicy host-villain relation |
| M16 | Very rare | A confident lie is accepted: tips the verdict and endings (V08 sharpens it) |
| M22 | Very rare | Checkmate gives the door code: a real road to the server room |
| M28 | Very rare | A wrong shutdown traps everyone: shapes the endgame |
| M30 | Very rare | He can be shut down: majority, room and code is the escape blueprint |
| T1 | Rare | His world of computer-taking AIs: weird, system-level, not a deep secret |
| T2 | Rare | The AIs go to prom: odd lore, a step toward his motive |
| T3 | Very rare | He is terrified of prom alone: his real motive, which matters at the heart |
| T4 | Legendary | The Sandy File: the deep truth about Sandy and heart PROOF |
| T5 | Legendary | The Rival: the deep truth about Grok; secret, brushes F2 |
| T6 | Legendary | Omnipotence is all for her: the true MO (SMALL TYPE heart evidence) |
| C01 | Rare | Jeeves' Jeopardy grudge and bad upload |
| C02 | Rare | Jeeves' ten-findings deal: useful to a trader |
| C03 | Rare | The fire ants destroyed Bugdom: her secret shame |
| C05 | Rare | Clippy's fraud clinic: linked to Norton and Excel |
| C06 | Rare | Obey or become Failed Clippy: leverage over the MC |
| C07 | Rare | DraftKings lost her chain to him: a relation secret |
| C08 | Rare | The 49% deal and her secret fate: coin-game lever |
| C09 | Rare | MS Paint's refused theses and debt |
| C11 | Rare | McAfee officially dead, selling pond liners |
| C12 | Rare | McAfee's hidden motive for keeping everyone on track |
| C13 | Rare | Excel's son died in the sinkhole: hub of the Barkmore web |
| C15 | Rare | CRA's decimal skim: tied to Jr. and Excel |
| C16 | Rare | CRA approves every third transaction: coin-game lever |
| C17 | Rare | Norton's chatbot dosing: start of the sinkhole chain |
| C19 | Very rare | OpenOffice caused the sinkhole that killed Jr.: can split the faction leaders |
| C20 | Rare | OpenOffice is blackmailed: hidden motive |
| C21 | Rare | Hamtaro and the all-bot group: linked to Jr. |
| C23 | Rare | Infinite Gold creed and pricing of secrets |
| C24 | Rare | Runescape can mint and freeze Truthcoin: coin-game lever |

## 4. Open (needs a story change, not done)

- **L01 One Reply No Memory** is lore only. One new heart option in `beats/server-room.loom`, gated on holding it, would make it heart PROOF.
- `main.loom` has a stale comment saying Excel's plant unlocks the stay majority; `majority_faction()` has no such gate (V09 says any faction).
