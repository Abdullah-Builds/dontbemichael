# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Don't Be Michael keeps its own version line, starting at 0.0.1.

## [0.2.4] (2026-10-20)

### Added

- **Company foundations: one document of what each job needs to know about your business.** Every office now has a Company foundations document in company knowledge, with plain questions for each job, such as who we sell to, how we sound, or our financial year, and no product named anywhere. A question two jobs share has one answer. It starts with what the company profile already says (opening hours, financial year), and the two stay in step. When a team member's work needs an empty answer, a card on Needs you asks you for it, shows what the work did without it, and lets you save an answer, have that member draft one from what the office holds, or put it off for a week; it comes back weekly until answered. What you teach the team and what they find in the office's own files fills it too, each answer marked with who and when; anything from outside the office is checked by Michael first. Pulse shows the jobs whose work hit an empty answer, a "Foundations 2 of 6" count under each member on Team at work, and in a member's detail the missing questions and, once there is enough work, how much was kept as is without the answer and with it. (Agent behavior, four changes: every team member carries its job's part of the document, Michael all of it, Research none; a member whose work needs an empty answer does the work, adds one line saying what was missing, and reports it once; Michael raises one card per empty question the work hit, and a new weekly Foundations check on his schedule brings each still empty one back; members send what you teach them or what they find in the office's files to the document, filling only empty answers. After the ship review: only Michael can change an answer you wrote, and only by quoting a message you sent him yourself, never one of the app's own notices; a member quoting a message of yours fills only an empty answer, marked as taught to that member; a member answers and reports gaps only for its own job's questions; only the member you asked, or Michael, fills a draft; answers are kept to one plain line; when a question is answered another way, in the company profile, by a member or by Michael himself, Michael is told to close its card, and the pod's for you count and Pulse leave that card out; a waiting foundation card no longer stops the app from clearing a member's conversation. The app keeps the ids of the messages you send in its private folder, out of the team's reach, and only those count as your words.)
- **See and open what's in company knowledge.** Settings, Memory & Knowledge lists every document your team searches, with its file and when it was added. Open opens it in your own app; save it there and the app reads it in again, so the team searches the new version. Company foundations opens as a read only copy, since the app keeps it up to date, and so does anything that is not a document, so Open never runs a program. If you had turned company knowledge off, a one time card in Needs you says it is always on now, with a link to the list.
- **Windows reads scans and photos in company knowledge** with the text recognition built into Windows (contributed in #501).
- **Pulse shows what it sees in your first two weeks.** Before recommendations can start, Pulse runs the same checks on the days so far and shows what they find, under a bold "What Pulse sees so far, not advice yet.": for example a scheduled check that has found nothing on 6 of 8 runs, or how much of a member's work you kept as is. These are facts with nothing to apply; on day 14 the recommendations take over.

### Changed

- **Company knowledge and search by meaning have no switches.** Company knowledge is always on, and team members are pointed at it once it holds a document. Search by meaning runs whenever MemPalace is installed (Prerequisites); Settings shows whether it is ready. The separate Semantic memory section is gone: search by meaning and its search language now sit under Company knowledge, the only thing it ever searches, and the wording says so. A document you edit is searched by meaning in its new version too. Each member's own memory stays private and is never searched by meaning, so the By meaning search on Michael's Memory tab is gone too; exact words still search the team's notes. Changing the search language now builds the index again with the new language; before, search by meaning stopped working after a change. (Agent behavior: members are told about company knowledge once it holds a document, and told again if it empties; a member that is already running gets the new search command when the language changes or MemPalace is installed, with no restart.)
- **Pulse shows only what has something to say.** Tiles with nothing in the period fold into a row of small quiet chips under the others ("emails sent 0"); a chip opens its tile. Spent always shows, and with Compare on a tile stays while the span before had something. Team at work folds members with no working time into one "9 more were quiet" row and says "Nobody has worked yet today" when that is so. Before advice starts, Recommendations is one short line, with the why behind its (i).

### Fixed

- **A file an Ask me question names opens from its chip even without its ending.** A question that named a draft by its title, such as `First contact follow up draft 2026-10-19`, showed the name as plain text. The app now finds the file in the office's folders and shows the Open chip in its place. (Agent behavior: Michael names each file in an ask by its full path with its file ending, as he already did in your conversation and in reports.)
- A message a team member sent is delivered once even if the app quits between delivering it and filing it away, and a schedule request is never filed twice.
- An answer you give on Ask me reaches Michael in the same launch even if its first send was lost (contributed in #508).
- Michael hears when a restart that timed out worked after all (contributed in #506).
- Pulse starts filling in its earlier weeks when you open it (contributed in #504), and drops the saved cost totals of sessions that went quiet (contributed in #505).
- The counts of refused hook messages are kept within a bound (contributed in #502).
- Pulse's Apply, Not now, Undo and Try again use the app's own buttons (contributed in #497).

## [0.2.3] (2026-10-18)

### Added

- **Needs you says when a team member stops reporting to the app.** While a member works, its AI engine sends the app small reports; without them the app can't check the member's folders and tool limits. When a member never checks in after starting, or goes quiet in the middle of work, a card on Needs you names it (one card per engine and reason, Michael's first), with Restart. Michael restarts a member that never checked in once on his own. If a restart doesn't help, or the engine version is known never to report (Gemini CLI 0.60 and later), the card offers Change engine or Keep working unchecked. Where nothing else guards the member's files (every engine on Windows, Gemini everywhere, and Research), its terminal is stopped until you restart it; Research is never kept unchecked. Its new mail goes to Michael meanwhile. One long tool call, such as a build, is not silence. Cards survive a relaunch and a break, and go when the member reports again or leaves. A desktop notice comes once per card, only with notifications on. (Agent behavior: Michael hears when a member isn't reporting and again when it is, gets that member's mail, is told to give it no new cards, and is asked to send held work again; the app restarts a silent member once in Michael's name.) Thanks to @SuriyaPrakash1928 for the first watchdog (#345) and @iNoumanMalik for the report (#326).
- **A person's panel and Edit agent open wide.** A button in the panel header moves it to the center of the window, 80% wide, with text kept to a comfortable line length; the office dims behind it and the Needs you pill stays live. Edit agent wide shows who you are editing and splits into two columns. Leaving Edit with unsaved changes, by any way out, asks first: Discard or Keep editing.
- **Pulse: Today, This week and This month, with Compare.** Pulse's period picker offers Today, This week and This month, and Compare puts the span before beside each tile, up to the same day.
- **Pulse lists what the privacy check did.** The held tile opens a list of each message held because the check could not run: when, who to whom, what it was about, why, and who was told. See each question and See each answer list every question sent to Research and every web answer, as written and as it went out, with what was taken out marked word by word; changed and stopped ones come first. The questions and answers lists keep 62 days and then move to an archive the app never deletes, and the held list keeps 400 days (a reset erases them; a home move takes them along). Checks from before the lists kept words are put together once from the office's files.
- **Right-click a link to copy its address** (contributed in #372).
- **Run a job now from its schedule row** (contributed in #468).
- **File chips have actions,** including Copy path (contributed in #296).
- **A Codex member's context gauge** reads its own session, sized by the window it names (contributed in #415).
- **Connected apps that rate limit are waited out** instead of hammered: a short wait is held, a long one is answered with when to try again (contributed in #399).
- **The office opens with a Clocking in card.** When the app starts, a card over Michael's desk shows how many of the team are in, who is still coming, and turns to Everyone's in, or names who hasn't clocked in after a minute. The clock pill says Opening meanwhile. A Restore team opens it again.
- **Waiting cards come back.** A card waiting on someone outside the office gets a check back time: the date they named, or the team member's judgement, else three business days. When it comes, Michael is told once, has its person follow up and sets a new time, and keeps a gone quiet list. After two follow ups with no reply he asks you on Ask me whether to keep waiting. (Agent behavior: team members name a check back time; Michael gets a Follow up due note and a gone quiet list; any reset of a card's check back time after he was told counts as a follow up.)
- **Pulse: see what the team learned.** The Learning card's See the notes lists the notes behind its number for the period, grouped by where they came from; a note deleted since says so. A note now counts when it is added, from the app's own record, so an edit or a repeat is no longer a new note.
- **Reply under Michael's question or latest answer** in the wide Talk to Michael.

### Changed

- **Each team member's memory is its own.** No team member, Michael included, opens another member's notes, inbox or hive folder, or the office's change history; they ask the member instead. The app walls those folders off for every Claude member's shell and file tools, members hired later included. The one store everyone searches is company knowledge. Research's notes are no longer copied for the team. (Agent behavior: Michael and every member are told to ask a teammate instead of reading its notes; work folders and handed off files stay readable.)
- **A message to or from Research waits while the privacy check can't run.** When the check's session is not ready (often while the whole team starts), the message waits and is tried again for up to 30 minutes instead of being held at once; nothing goes out unchecked meanwhile. A check that got no answer quickly is tried once more after 15 seconds. The check keeps the names of the office's own AI team as written. Michael hears when Research's answer is held, as he does for a held question. (Agent behavior: Michael gets a note for a held answer.)
- **Background checks run on Michael's configured engine** instead of always on Claude (contributed in #354). (Agent behavior: the app's own hidden checks use Michael's engine; the privacy check stays on Claude.)
- **A file tab hides the Talk to Michael bar**, as Pulse does.
- Michael hears which team members did not start (contributed in #393), and when finishing a card by voice withdrew its questions (contributed in #392). (Agent behavior: two new notes to Michael.)
- Closing time waits again for a team member whose terminal comes back (contributed in #394). (Agent behavior: Michael is told to wait for it after all.)
- An Ask me answer lands only on the question being answered, each catch up request is matched to its own answer, and an answer stays on a card Michael marked Done (contributed in #396, #397, #398).
- A checked message for Pete is never dropped when delivery fails; it is tried for about a minute, and a restart says so (contributed in #440).
- The file editor follows the app's dark theme (contributed in #410).
- More of the app is translated: the file editor and IDE, the completion toast and focus view, the notes beside Slack, webhooks and the organisation key, Michael's fallback name, when a schedule runs, and engine status labels (contributed in #403, #404, #405, #406, #412, #431).
- **The app's own notes to Research are not questions.** Office open, the restarted note, the carry on note and schedule decisions reach Pete without the paid privacy check when they are word for word the app's own (a schedule decision with someone's note is still checked), and are never listed or counted. While Pete is off or isn't reporting they are dropped quietly. (Agent behavior: Michael is no longer asked to resend these to Pete.)
- **Closing time doesn't wait for a member that isn't reporting.** It shows apart, and Michael is told not to wait for it. If it reports again before closing ends, it gets the closing steps again and Michael is told to wait for it after all. (Agent behavior: Michael gets an isn't reporting note and a wait after all note.)
- **The app makes every message's id and time.** An id a team member wrote can no longer overwrite another message, and a time it typed can't close your next question early or hide a message. A file in a member's outbox that is a link to someone else's message is set aside, never sent again as new.
- **Each open column on the task board reads earliest next step first**, cut into time groups (Overdue, Today, Tomorrow, This week and on), and the groups move with the clock. A date shows its year when it isn't this year.
- Saving an AI provider key on a computer that can't keep it safe says so first, like connected apps and mailboxes (contributed in #384).
- An office stop for credit or sign in ends only once a turn has finished (contributed in #383).
- The router reads the team list once per pass (contributed in #385).
- Brave Search in the connector catalog uses Brave's own server (contributed in #365).
- Setup gives Qwen an install command, and Grok, Kimi and Antigravity a docs link (contributed in #377).
- The Business name label matches the other form labels (contributed in #341).

### Security

- Pulse's lists read the office's files without following a link or waiting on a pipe a team member left in its own folder, and the memory wall checks the real path of the office folder too.
- Usage counts only for the team member whose token sent it (contributed in #364).
- A planted link in Research's folders is replaced on newer Node too (contributed in #441).
- Engine key backends are read by their own keys only (contributed in #439).
- A permission stance written as flag=value keeps auto mode off it (contributed in #453).
- Hook frames that aren't JSON objects no longer hang the socket (contributed in #465).

### Fixed

- More on a long reply from Michael opens only that reply, and the view stays where you clicked.
- A memory note is never added or counted twice when the tidy pass is interrupted after saving.
- A screenshot a queued message still points at is kept (contributed in #400).
- A CSV whose last record is an empty quoted value keeps it (contributed in #420).
- Mailbox connections waiting at the same time share one, and a replacement is kept (contributed in #424).
- A token count that isn't a number reads 0, not NaN (contributed in #427).
- A connected app's answer cut partway reaches the agent as a failed transfer (contributed in #433).
- Card headlines keep times and "etc." whole (contributed in #435).
- Company knowledge search finds words in any script (contributed in #445).
- An SVG with a # in its name or folder shows (contributed in #446).
- The owner may type every slash command the app itself types, for every engine (contributed in #449).
- On Windows: the Cursor installer runs through PowerShell, Codex hooks run when the hive path has a space, and a recent office shows its folder name (contributed in #454, #470, #462).
- A CLI installed under a folder with a space is not reported missing (contributed in #457).
- A long toast or title never ends in a broken emoji (contributed in #475).
- Gemini members start without a workspace trust prompt (contributed in #342).
- Quoted text that starts with a slash links only the file name in it (contributed in #378).
- A new hire's folder name never ends in a dot or a space (contributed in #381).
- Updates between prerelease versions with hyphens sort in the right order (contributed in #359).
- The docs say Node.js 20 or newer (contributed in #360).

## [0.2.2] (2026-10-16)

### Added

- **Pulse: what the office got done and what it costs.** A new Pulse tab beside Tasks shows ways to save first (run a check less often when it mostly finds nothing; try a lighter or stronger model when the work shows it), each with the numbers behind it, applied only when you click Apply and undone with Undo. Below: what got done and who did it; Kept safe, what the trust layer kept off the internet, the web answers it cleaned of instructions to AI agents, anything held because it could not be checked, and the steps your settings stopped; Learning, what the team learned in the period and whether it asks you less than before; your plan use and your time; and Team at work, how busy each member is next to the others and what their work costs. Pulse fills in the eight weeks before it started from the office log, members' sessions and the cost ledger, so it never starts at zero. On a Claude plan, every cost is your plan's real price for the period (found in your Claude account, or the price you set in Settings > Agents) split by each member's share of the work, with what the same work would cost per use behind the (i). Savings are measured from the office's own records after a week. The numbers come from a new store only the app writes, in its own data folder, which no team member can reach.

- **Ask me cards you can answer with a click.** When Michael offers choices, they show as rows to pick, with his recommendation tagged; when he asks several things, each question gets its own line, and a question can carry its own small choices. Nothing is sent until you press Reply, which says what it will send ("Reply with option 1", "Reply to 2 of 5"), and a box for your own answer or a note stays on every card. Michael gets your answer in words ("Picked: …", "1: … Not answered: 3"), never a bare number. Asks written the old way look as they did. (Agent behavior: Michael writes choices and questions as fields, and a to-do gets "Done, I did it" as its first option.)

- **Delete a team member for good.** Edit agent has a Danger zone under the engine with a Delete button. After one confirm, the team member stops, their schedules pause, work bound to them goes back to the teammates it was taken from, and they leave the floor with no way back. Michael's roster skips them from then on. Their open questions leave Ask me (kept on the card, marked withdrawn because they were deleted), and Michael gets one note listing their open cards to give to someone else or close. Requests they filed that Michael had not worked yet are set aside, so you are never asked something on behalf of someone you deleted. Michael, his assistant and Research have no Delete (Research is turned off in Settings). Before this, no hire could leave the team: the old close button was hidden on 2026-09-24. (Agent behavior: who Michael can route to, and a new note to Michael when you delete someone.)

### Changed

- **Every office on the floor says what it does.** A small plate in front of the chairs names the department (Finance, Sales, HR, IT and so on), so you can tell who does what without knowing the show. The People department is now called HR.
- **Glass monitors.** The desk monitors, Michael's too, are clear glass panes instead of thick black screens: plain glass when idle, tinted with scrolling lines while someone works.
- **A team member stuck on a prompt is restarted, not handed to you.** When a member's session stops on a question only a person could answer, the app restarts them once and tells them to carry on with their work, and Michael checks that they picked it back up; he no longer asks you to open a 1:1 chat. If the restart does not take, or the prompt comes back within half an hour, Michael moves their work to a teammate and tells you plainly that they are stuck, once. (Agent behavior: a new note to the member, and what Michael is told and asks.)
- **You never have to answer every question on a card.** Reply settles the ask with whatever you answered; the questions you left blank go through Michael to the team member who raised them, who works out what they can and comes back only for what they still need. Before, Michael asked you again at once. (Agent behavior: Michael and every team member.)

### Security

- **Hook events carry a secret for each start (issue #61).** Every team member's events (a turn starting, a tool used, a turn finished, its cost) now carry a secret the app gives it when it starts, and the app takes the sender from that secret. An event with no secret, someone else's, or one from an earlier start reaches nothing, and a tool check from it is refused. Behavior change for agents: none in what they do; an engine bridge that drops the secret loses its hook features until fixed. Known limit: the secret is in each member's environment, which another program running as you can read, so a member that deliberately looks there could act as a teammate on this channel; moving it out of the environment is next. Thanks to @codedbygo, who built the same design independently in #327.

### Fixed

- **Ask me cards with choices now show as rows to pick.** Some of Michael's instructions still told him to write choices as a numbered list, so new asks kept arriving as plain text with one reply box. Those instructions now all point to options and separate questions, and when a new ask still comes in as a list, Michael is reminded to rewrite it. Asks written before you update keep their look.
- **Pete no longer stops on a permission prompt for his own work.** Since Research stopped loading your Claude settings (for privacy), Claude Code ran him in normal permission mode, so every shell command waited for an approval nobody could give. His tools are now allowed in his own settings; his walls are unchanged.
- **Pete's privacy check answers at launch.** When the office opened with a dozen team members starting at once, the check's question could sit unsent in its window, so messages to Pete waited and then came back refused. The app now presses Enter again until the question is taken.
- **The app never answers a permission prompt for an agent.** The inbox nudge typed into an open prompt after five minutes, and its Enter approved it. It now waits until the agent moves on, however long that takes.
- **Yesterday means yesterday** in the Messages tab, also on the nights the clocks change (contributed in #331).
- Release notes in the update toast and What's new show &, <, > and quotes as written instead of codes like `&amp;` (contributed in #333).
- A damaged saved notice about a paused Send only mailbox no longer keeps Michael from hearing about it (contributed in #336).
- The close buttons on Needs you and dialogs show feedback when you point at them (contributed in #322).
- Setup's Street address shows an example like the other fields (contributed in #334), and setup suggests your local currency for eight more regions (contributed in #339).

## [0.2.1] (2026-10-14)

### Added

- **Pete joins the office's idle time fun.** When he is on and free, Pete says lines of his own and trades paper plane conversations with the rest of the office: Andy calling him Plop, being the New Jim, reciting Die Hard for Erin, Poor Richard's after work, Kelly's old desk, and the office sizing up the new guys. The lines are written in his voice from his story in the show, the way the other running gags are, not quoted from scripts, and none of them uses his name, so they still fit if you rename him. The first conversation after you turn him on is one of his, once each time you turn him on.
- Search the Skills list by meaning, and find a skill despite a typo (contributed in #177).

### Changed

- Pete's old idle lines about looking things up are gone; his lines come from the show like everyone else's.
- **Michael hears every message the privacy check keeps from Pete:** who sent it, its subject, why, and what to do next (for a privacy refusal, that what stays private is set in Settings, Research & privacy), so his ask can tell you exactly what was stopped. Before, only the sender was told. When the check itself could not run, the sender is told it is not about the wording and Michael that it is an app problem, instead of "ask again in plainer words". (Agent behavior: what the team and Michael are told.)
- **An Ask me card that needs you to do something on a website links straight to it.** When you need to sign in, accept terms or pay, the team member who found it now passes on the email's own link for it, and Michael puts it in the ask as a named link, so you no longer dig the email out of your mailbox. Only a link on the sender's own site, never a tracking or shortened one; when there is none, the ask says where to go. (Agent behavior: team members and Michael.)
- **A new, retimed or turned on schedule waits for its next time** instead of running at once for a time that already passed today (contributed in #316). A time missed while the app was closed still runs once.
- A click outside Settings asks before it drops unsaved changes (contributed in #292).
- The update toasts and chips are translated (contributed in #290).
- A `claude` a team member starts from its own shell loads none of your Claude account's connectors (contributed in #325).

### Fixed

- **The privacy check no longer stops everything going to Pete.** Its answer was thrown away as unreadable whenever it added a sentence after its verdict, so every question to Pete, and the app's closing and office open notices, came back refused.
- **Reset & start over now starts truly fresh.** It used to erase only the team's memory and the office's work, so Pete's research desk and threads, Memory & Knowledge, saved keys, the history and mail and Slack files carried into the next office. Now everything the app made for the office goes, and setup opens as a new owner sees it. Your team's folders and the files in them, your Claude sign in and the saved copies of your team list stay, and so do your own files in the office folder. The confirm screen says what is erased and what is kept.
- **In the communication only mode, only a plain status question skips your approval.** A webhook message goes straight through only when it is one short question that names no address, link or amount and asks nobody to act, like "Is the test suite green?". Anything else waits for you, however politely it is worded ("Can you pay the invoice?", contributed in #180, "Any chance you could...", "Is it ok to..."), and the sender can no longer skip that by labelling the message as chatter or by putting the request in its title.
- Clicking a dotfile an agent names in its terminal, such as `.gitignore`, `.env` or `.npmrc`, opens it for editing instead of only showing it in Finder.
- Pete's card on the office floor shows the name the app gave him, also in an office that saved him as Research.
- Uploaded documents are read in a process of their own, so a big or broken file can't freeze the window (contributed in #287), and a PDF is read a page at a time, up to 500 pages (contributed in #289).
- Installing a skill keeps its PDFs, fonts and images intact (contributed in #323).
- An Excel file exported from accounting, payroll or other business systems is read instead of refused as empty (contributed in #324), and PowerPoint text keeps slide order (contributed in #171).
- When the Claude Code check fails during setup, it says so with Try again instead of checking forever (contributed in #314).
- An Ask me headline is no longer cut at abbreviations like Mr. or Inc. (contributed in #312).
- A finished tool is no longer shown as running (contributed in #288), and a blocked tool call shows no detail (contributed in #234).
- Out of range mail send times are rejected (contributed in #286); a pi team member starts with the office's rules (contributed in #309).
- A hook judges a link to a file that isn't there yet by where it leads (contributed in #238), and the app's helper scripts are rewritten only when they changed (contributed in #297).
- Settings warnings read in dark mode (contributed in #306); a Markdown link to a path with spaces becomes a file chip (contributed in #307); release notes keep inline code (contributed in #308); a count just under a million reads 1M (contributed in #293); flying paper planes stay hidden until they move (contributed in #310).

## [0.2.0] (2026-10-13)

### Added

- **Pete, the one team member on the internet.** In every office, whatever its business pack, only the Research team member, called Pete unless you rename them in Edit agent, opens web pages, searches the web or reaches the internet from their shell; everyone else, Michael included, asks them. They are off until you turn them on in Settings, Research & privacy, or pick them in the setup Team step. No other team member can take their name. They have a face of their own on the office floor. They see nothing of your office: not your files, the task board, the team's memory or your company's knowledge, and they run only on Claude. A search tool you give a team member yourself, through a connector, still works. On Windows, the Research team member can still reach your office files, and team members' shells still reach the internet.
- **A trust layer between Pete and your team.** Every message to Pete, from a teammate, Michael, the app or one of your answers, is checked first against the kinds of data you keep private. It goes as written, goes cleaned or made more general so the research still helps, or comes back to its sender saying what private detail it depends on. Pete's answers are checked on the way back too: instructions aimed at AI agents are removed, the answer is labelled as information from the internet, and one that tries to steer its reader is flagged to Michael. When the check can't run, nothing goes through.
- **Choose what stays private.** In Settings, Research & privacy, mark which kinds of data never go to Pete. Passwords and keys never do.
- **Links name what they open.** A link in an agent's reply shows the site or app it goes to, with an icon for web and mail links, and the real site beside it when the words name a different one.
- **The office stops when your Claude account can't work**, out of credit or with a sign in or key that stopped working, and says why, with Add credit, Sign in or Change key. A new key restarts the team where it left off.
- **Michael hears when the safety brake holds a team member back**, so the work is picked up instead of left waiting.
- **Search the task board and filter it by team member.**
- A build can leave the mailbox feature out (contributed in #276).
- Webhook Copy buttons show a check mark once copied (contributed in #268).

### Changed

- **Upgrade note:** in every office, team members and Michael lose web pages, web search and, on a Mac, internet from their shell when you update. Each of them gets a one time note that the house rules changed, naming Pete. Turn Pete on in Settings, Research & privacy, to look things up again. The fetch and summarize skill now goes to Pete alone.
- Michael's commands stay in their sandbox like everyone else's. Each team member's scratch files live in a folder of their own that no other team member opens, never the computer's shared temporary folder; if that folder can't be made, the team member doesn't start and says why. While Pete is on, team members save scratch work there too.
- A task's questions show newest first, each with how long ago it was asked.
- Setup's Welcome and Permissions text and the company profile's field labels are 14px (contributed in #157 and #219).
- The terminal toolbar is translated and shows the right shortcut key (contributed in #116).
- Mail is quicker: approvals stay in memory, a search turns pages without searching the folder again, and a big email is read without downloading its attachments (contributed in #162, #163 and #266).
- The office floor redraws less often as team members update (contributed in #186).
- Michael, search and the voice assistant see Pete's messages only as the trust layer delivered them, never files Pete wrote on their own. Changing what stays private applies at once, also to messages already checked and to Pete's notes in the team's memory.
- A team member's Open folder button opens only the work folder set for them in Settings; any other folder is shown in Finder.

### Fixed

- A crash in the app window shows a recovery screen instead of a blank window.
- A step the app refused no longer shows on a team member as if it ran (contributed in #261).
- A file path in quotes, spaces and all, opens from the terminal with a click, and only the path itself is underlined (contributed in #280).
- Clicking a path an agent printed shows it in its folder and never opens it, so nothing an agent made can be launched from its text.
- A web or mail link in a reply opens when clicked; before, only secure web links did.
- A message from an agent can no longer write outside the hive, and a Gemini team member can write in its own hive folder (contributed in #152 and #184).
- On Windows: the checkout guard sees nested folders, the Claude settings file is read again when Windows holds it, the version check never stops a start, an agent's PATH is the app's own, and paths written with forward slashes are recognized (contributed in #159, #168, #203, #258 and #274).
- When a key or connector secret can't be stored safely on this computer, or clearing an engine key fails, the app says so (contributed in #161, #211 and #269).
- Michael's mug avatar is centered in setup and shows its handle (contributed in #166).
- A conversation with no date is headed Undated, and one broken time no longer moves a conversation there (contributed in #167 and #235).
- Your questions to Michael stay when the office folder moves (contributed in #172).
- A file that is not a picture is never given a picture's type (contributed in #185).
- Closing time quotes the team member's own words, tells Michael not to wait for someone archived mid close, and says closing, not Reopening, when a development build won't relaunch (contributed in #164, #267 and #247).
- Status colors read in dark mode, buttons never submit a form by accident, an info bubble opens toward the side with room, and Linux says Show in folder (contributed in #194, #197, #236 and #243).
- A failed update download no longer leaves the chip on downloading (contributed in #201).
- Usage counts each reply once (contributed in #202).
- Taking a new job description keeps a mailbox binding whole, and the quick rewrite adds an s only to a verb after "you" (contributed in #204 and #260).
- Mail: a refused address is no longer called a wrong password, one unreadable date no longer fails a whole search, a replaced connection survives a late disconnect, broken saved send records are skipped, and a refused mailbox call is logged (contributed in #205, #240, #213, #283 and #217).
- The safety brake ends a run that makes no progress on an idle beat (contributed in #206).
- The restart and continue tooltip names the team member (contributed in #207).
- A program path in quotes, and a quoted flag value with spaces, are read as one (contributed in #210 and #244).
- Pasted screenshots are kept in the app's folder (contributed in #228).
- A failed engine install is reported as failed and stays on screen (contributed in #233).
- The app and its window agree on when a terminal prompt is stuck (contributed in #241).
- Names keep their underscores in Ask me headlines and Done results, a name starting with two dots counts as inside its folder, and a word that starts like a month keeps its bracket in a card title (contributed in #249, #255, #251, #254 and #285).
- Procedures named with no Latin letters each keep their own file (contributed in #256).
- A CSV saved by Excel keeps its quoted header in one column, a picture whose name has a space loads, and a file opened from Task detail shows in front (contributed in #257, #259 and #263).
- Ask me says so when a reply could not be saved (contributed in #265).
- A watch only terminal ignores mouse and focus reports, and tool calls made at the same time keep their own detail (contributed in #270 and #271).
- A hidden check gives up early when its prompt never reaches the session (contributed in #272).
- A new team member's id never starts with a hyphen (contributed in #281).
- Tests, docs and an unused dependency removed (contributed in #160, #192 and #273).

## [0.1.9] (2026-10-11)

### Added

- **A parked step wakes on time.** A To do card can carry the time its next step is due, shown on the card in your local time. At that time the person on the card gets one reminder, even if the app was closed when it came due; if the card is still in To do four hours later, Michael hears about it once.
- **Closing time takes you to the office floor**, and the still working count opens the list of who is still busy.

### Changed

- **Michael alone writes the task board.** Team members file what their work needs once, in a queue only Michael sees, and tell him when their work moves. He works the queue in the order it was filed: answers it, folds it into a card, drops a duplicate or puts it on Ask me or in Waiting.
- **A card is one activity's needs.** One activity's questions for you arrive as one numbered ask, answered together; a part you leave unanswered comes back on its own. Questions for you and for someone outside the office go on separate cards.
- **Done is final.** Only you take a card out of Done, into To do, with a short reason. A card an agent reopens or deletes is put back as it was, and a question asked on it meanwhile stays on Ask me.
- **Cards carry no running notes.** Where a card stands shows in its status, who it waits on, its next step time, its question and its result. Routines that repeat on a schedule get no card; their reports still reach Ask me.
- **A card never waits on its own person.** Waiting names who else it waits on.
- **Team members hear when the house rules change**, once, when they resume their conversation.
- **Reports and files you read are in plain business words**, with sources named the way you know them.
- A Markdown report fills its tab, and a file link sits in its sentence without stray brackets.
- The way back to your conversation with Michael stays beside the message box once every reply is read.

### Fixed

- The list of who is still working at closing time has one scrollbar.
- A webhook body that cannot be read is logged with the reason (contributed in #141).

## [0.1.8] (2026-10-11)

### Added

- **The office takes a break when your Claude plan reaches its limit.** Ask me, the top bar and the floor say the office is on a break and when work starts again. Nothing is typed into a Claude terminal while it lasts, so no message is lost into a session that cannot answer. Scheduled jobs still go out on time and wait in the inbox. At the reset Michael hears that the limit should be over, and when the plan answers again the team members who stopped mid task are told to carry on, Michael first. Claude Code itself is told to continue its turn by itself at the reset.
- **Open a file Michael names, inside the office.** A file path in Michael's replies, an Ask me card or a task shows as a chip. Markdown, text, JSON, CSV and pictures open in a tab next to Who talks to whom and refresh when the file changes; PDF and Office files open in their own app; anything else shows in Finder (in its folder on Windows). Only files inside the office folder or a team member's folder open, checked each time.
- **A Done card shows what came of it.** The first line of Michael's result shows on the card, and the whole result leads the task's details.
- **Your message to Michael flies to him as a paper plane** on the studio floor.
- **Setup says why it starts again** when your settings file was damaged, and where a copy of it was kept.
- **Skills search** has a Clear button and a label screen readers announce.
- **Every mail tool call is written to the app's log**, so a mail problem can be traced.

### Changed

- Setup screens use 14 px text or larger on the Business and Team steps.
- The Claude connectors and mailboxes folds in Settings open and close with a short animation, and a closed fold hides its rows from the keyboard and screen readers.
- Open at login is hidden on Linux, where it cannot work.
- Windows owners read "this computer" where the app said "this Mac".
- The mouse wheel scrolls a tab row that does not fit, and a hidden edge fades.
- The default model line in Settings no longer says it applies to Michael.
- The README calls Windows 11 a supported platform.

### Fixed

- **A damaged settings file is never written over.** If config.json cannot be read, the app keeps a copy beside it before the next save, and a save that fails leaves the old file in place.
- **An email that may have gone out is never sent again.** When the connection drops in the middle of a send, the email is held as maybe sent and its card stays sending until Sent shows what happened. A plain email the app stopped sending is not sent twice either.
- **A damaged approvals file is not emptied.** Mail approvals that cannot be read are refused instead of treated as none and overwritten.
- **No team member can change its own sandbox.** Each team member's Claude settings now live outside every folder an agent can write, and the hook program's folder is write protected. An agent's mail connector key and the owner's sent mail moved out of the shared office folder too, and your own Claude Code plugins are switched off for team members.
- **The webhook and Slack listeners answer this computer only**, not other machines on your network.
- **A connector that cannot be reached says so**, instead of a vague failure.
- **A connector check that hangs stops everything it started.**
- **A team member that failed its first start is tried again** at the next launch.
- **Messages are not typed twice** into a terminal that already took them or is asking for permission.
- **The standup does not run at launch outside its times** when it uses timing lines.
- **One webhook flooding its limit no longer blocks the others.**
- **A mailbox password this computer cannot keep safe** is explained in plain words.
- **A mailbox's Needs you card closes** whenever a fix succeeds.
- **Deleting a secret that did nothing says so**, and temp files a crash left beside the secret store are cleared.
- **QuickBooks access is saved only for a real team member** or a hire in progress.
- **Memory notes are dated with your local day**, not UTC.
- **Moving the office onto a folder that already holds one is refused.**
- **The closing time list** shows its focus ring, clips long details and cuts runs of combining marks.
- **The scheduled jobs list no longer draws over the work style** in a team member's settings.
- On Windows, removing a work copy no longer follows its linked dependency folders.
- Malformed connection IDs are refused, and mail tools named like built in JavaScript names are refused as unknown.

## [0.1.7] (2026-10-09)

### Fixed

- **Microsoft 365 mailboxes on your own domain get the right message.** Testing a mailbox like info@yourbusiness.com that runs on Microsoft 365 said the mail server could not be reached or the password was wrong, so owners kept retrying something that cannot work yet. The test now looks up where the domain's mail goes, and a Microsoft 365 domain gets the same "Outlook and Microsoft 365 mailboxes stopped accepting app passwords" message as an @outlook.com address. If the lookup fails, the test carries on as before, so a working mailbox is never blocked.
- **A large Word, Excel or PowerPoint file can no longer take the office down.** Each part of such a file was capped, but not all of them together, so a file with many large parts could use up the app's memory and stop every team member. A file whose text parts add up to more than 200 MB, or that has more than 5,000 of them, is now refused before anything is unpacked, with a plain reason. Photos inside a document do not count, so a picture heavy document still reads.
- **An email is not sent twice after a restart.** The app remembers each email a team member sent for 10 minutes, so the same email asked for again gets the first result back. That memory now survives quitting and reopening the app.
- **The app window stays on the app.** A clicked link or a file dropped on the window could replace the whole office with that page. Web links now open in your browser.
- **Slack can be retried after its tunnel fails.** When the public tunnel could not open, the Slack listener kept its port, so every later try failed until the app was restarted. It now lets the port go.
- **Team messages are kept when two share a file name.** Sorting a sent message away could overwrite an earlier one with the same name and lose it from the thread history, and a message that could not be moved was delivered again every few seconds. Both are fixed.
- **Folder rules on Windows understand `~`.** A path starting with `~` was judged against the team member's own folder instead of the home folder on Windows.

### Added

- **Codex usage and cost.** Groundwork for a second engine: a Codex team member's tokens and cost now reach the token caps, cost caps and cost views, and GPT models are priced as OpenAI models. Codex is not offered as an engine yet.

## [0.1.6] (2026-10-09)

### Fixed

- **Windows offices without Git for Windows.** On those computers Claude Code runs team members' hooks in PowerShell, which could not read the command the app wrote, so every hook failed with "Unexpected token" in the terminal and Michael and the team never reported what they were doing. The app now writes each hook and the status line for the shell Claude Code will use there.
- **Team members on Windows can run commands.** Claude Code has no sandbox on Windows, and the app told it that team members' commands must run sandboxed, so every command a team member tried was blocked by policy: they could not clear handled messages, search company knowledge or read Word and Excel files. On Windows that rule is now left off. The rules that keep each team member's file tools out of other folders stay, and Mac and Linux are unchanged.
- **Terminal stays inside its box.** On a Windows office a team member's terminal drew its last row past its frame, over the Queue box. The terminal now refits whenever its character cells change size on their own, such as after a font loads, a display scale change or a renderer swap. If a fit still leaves it past its box, the sizes go to the office log so the cause can be pinned down.
- **Can send means no approval cards.** A team member you moved from Send on approval to Can send kept putting emails on Ask me, because its notes still said to propose them and the app never told it the setting changed. Can send now sends without asking: the team member can no longer put an email on Ask me, and an old standing approval no longer routes one there. Changing a team member's Sending tells them and adds the new rule to their notes. Moving them to Can send hands their waiting emails back to send themselves; while nobody on the team reads the inbox they send from, or that inbox needs attention, those emails stay on Ask me instead. Offices that switched before this fix get the same hand back at launch.

## [0.1.5] (2026-10-09)

### Fixed

- **Windows offices start.** On Windows every team member stopped at a hidden "do you trust this folder?" question and quit, so the office sat silent. The app now trusts your office folder the way Claude Code looks it up on Windows, so Michael and the team start on their own.
- **Cards that wait on someone move to Waiting.** Michael's hourly standup still told him to keep a card that waits on a customer or a teammate in Doing, so no card ever reached the Waiting column and those team members looked busy. He now moves such a card to Waiting with who it waits on, moves it back to Doing when they answer, and chases them until then. Offices on the old standup text get the new one at launch; standup text you wrote yourself is kept.
- **Clear reasons when an API key is not accepted.** Get Michael ready said "Check your internet connection" for every answer it did not expect. A key made for your whole Anthropic organization instead of inside a workspace now says to use a key from a workspace, any other refusal shows Anthropic's own reason, a rate limit or outage says Anthropic is busy, and only a real network or proxy problem asks you to check your connection.

## [0.1.4] (2026-10-07)

### Added

- **Send on approval.** A third Sending choice for each team member: it puts each email on Ask me, where you edit, approve, ask for changes or stop it, and then the team member sends exactly what you approved. New members start on Draft only, and work styles now follow the Sending setting instead of saying team members never send.
- **Send without asking for one kind of email.** When you keep approving the same kind of email unchanged, the team member can offer to send that kind without asking. You tick it on the card, it shows on their Access tab with Revoke, and every such email is first checked by a separate quick check that sees the email and, for a reply, the message it answers. Anything it can't read in full goes to you.
- **Michael answers you in the app.** A question you send Michael from the box at the bottom opens a conversation above it: Sent, Michael has it, Waiting on someone, Later than he said (with Nudge), Waiting for you, Answered or Couldn't finish. One count on the box, one notification per answer, and his terminal words show as notes when he answered only there. Scheduled outcomes such as weekly summaries arrive on Ask me as quiet Report cards you clear with Got it.
- **Send only access to a mailbox someone else watches.** A team member's Email section lists the addresses it uses, each with who watches the inbox and how its email leaves. Add a mailbox asks Watch the inbox or Send only: Sales can send outreach from the CEO's address without reading the CEO's inbox, follow up in the same thread, and its sends show on its Access tab. It pauses while nobody watches that inbox or the mailbox needs attention, and Michael hears once.

### Changed

- Approval cards say when an email forwards a message or attaches files.
- Changing a team member's own mailbox follows the same rule as Send only: Draft only withdraws its waiting emails, and losing the mailbox also revokes its standing approvals there.
- Setup screens center the card until your office picture appears, then the card glides aside to make room for it.

### Fixed

- A new owner whose computer had no Claude Code finished setup and then saw nothing happen: the install ran out of sight behind a password prompt and failed silently. Setup now ends on Get Michael ready, which installs Claude Code without a password and signs you in where you can see it. Skip it, and Ask me keeps a card until Michael can start. No Claude plan? Use an Anthropic API key instead: it is checked with Anthropic and kept on this computer.
- Once Claude Code is ready, the team members that could not start begin on their own, however it got ready: from setup, the Ask me card, a sign in in the browser, or an install outside the app. Members already at work keep going.
- Get Michael ready finds Claude Code where its Windows installer puts it, checks an API key through your network's proxy, and says when it could not check your sign in instead of showing a green check.
- An approved email can no longer forward or attach mail from a different mailbox.
- An approved email goes out once, even if two sends overlap or the app stops mid-send, and an email you withdraw while it is being prepared stops before it leaves.
- Forwarding or attaching from a very large email is refused in plain words instead of freezing the app.

## [0.1.3] (2026-10-05)

### Fixed

- **The GitHub page offers the Windows beta next to the Mac download.** The platform badge, the download links at the top, What you need and the install steps now cover Windows 11, including what to click when Windows says it protected your PC. Saved passwords are described as encrypted on your computer, which is true on both. The docs also say what is Mac only for now: reading scans and photos, and the sandbox that keeps shell commands inside each team member's folder.

## [0.1.2] (2026-10-05)

### Added

- **A Beta pill beside the version in the top bar,** with a tip that says where Report a problem is. Windows builds now ship with every release.

### Fixed

- The Beta tip in the top bar is never drawn under the Tasks board.

## [0.1.1] (2026-10-05)

### Added

- **Windows 11 (beta).** An x64 installer for Windows 11, built with every release candidate
  and shipped with a release once it passes a check on a real PC. Windows asks once before it
  runs an unsigned app: choose More info, then Run anyway.
- **Open the file a question is about.** When a question on Ask me names a file saved in the
  office (a report, a sheet, a draft), the card lists it with Open, or Show in Finder (Show in
  folder on Windows) for anything that is not a plain document. Task detail lists them too.
- **A Beta pill and Report a problem** in Settings, on Mac and Windows. Report a problem opens
  a GitHub issue with the app version and your system already filled in.

### Changed

- **A question on Ask me never disappears unanswered.** It leaves only when you answer it or
  Michael withdraws it, and Task detail says when one was withdrawn and why. Before, a second
  question on the same card, or a card leaving Blocked, could hide the first. Michael is told
  each turn about cards holding questions the wrong way, so he folds or withdraws them.
- **Your answer goes only to Michael.** He routes it to whoever asked; the floor shows one
  envelope, from you to Michael.
- Closing time and office open notices no longer fly to team members' desks.
- Idle chit chat between team members always uses paper planes. The envelope means a real
  message.
- Closing a card, fixing a mailbox, or finishing a card by voice withdraws its open questions.

### Fixed

- Answering one question could undo Michael withdrawing another on the same card.
- Searching or reading archived and Sent mail gives a clear hint when nothing is found in the
  inbox, instead of an unexplained miss.
- The manual Mac download link points at the universal installer.
- A release candidate build is offered the final release when it ships.

## [0.1.0] (2026-10-04)

### Added

- **A first task is a card.** A new hire's one time first job (build a list, a first sweep, a
  first draft) is no longer a line in their Work style: it becomes a card Michael hands out at
  hire. A First task you type into a Work style, when hiring or in Edit, becomes a card too.
  Existing team members' old First task text is moved out once, and any standing duty it held is
  now a scheduled starter job.
- **A Waiting column on Tasks**, in yellow: a card someone is working on but is waiting for a
  teammate's reply shows who it waits on, instead of sitting in Doing with nobody working.
  Only Michael moves cards into Waiting or Blocked.
- **The floor has character:** each team member has a signature prop as their avatar and on
  their desk, departments have painted floor signs, and the office has plants, a water cooler
  and Michael's mug.
- **Who talks to whom** reads by time: Last 1 hour up to Last 1 month, Last 1 day by default,
  with prop avatars on the graph.
- **Suggest me** on the hire wizard writes a first Work style from the role, what they handle
  and the team, streamed into the field as it is written.
- A team member who needs a fact asks the teammate who has it, and goes to Michael only when
  nobody can help or someone has to do work.
- Every character has break room lines of their own.

### Changed

- Who talks to whom shows teammates talking to each other, and the owner talking only to
  Michael. The Topics layer is gone.
- The side column is hidden on the Tasks and Who talks to whom views, and All clear shows only
  on the office floor.
- The pack caption beside Hire moved into Hire.
- Closing a hire who took work from teammates gives that work back to them, and it returns to
  the hire when they come back. Clone is greyed when every character of that kind is already on
  the team.
- An office with an Operations or team pod keeps the ring layout up to nine pods.
- The office window opens filling the screen.

### Fixed

- Mail tools never read or search drafts, trash, junk or Gmail's system folders, and a long
  label's message id is no longer cut short.
- People who went home at closing time no longer trade paper planes between dark offices.
- An overlap check the owner moved past on the hire wizard is stopped instead of running on.
- Michael's roster names where each team member's mail access comes from.

## [0.0.16] (2026-10-03)

### Added

- **Your Ask me answer is Michael's open work.** It reaches him as a request about the card and
  stays in front of him on every turn until he routes the follow up and closes it. An answer
  whose request did not go out is sent at the next launch. The Tasks view shows those cards as
  With Michael, and as not moved after one work day of your office hours.
- **Every scheduled job has a focus area:** what to concentrate on each time it runs. It is
  written on the job, shown with the team member's Work style, sent only with that job's run,
  and checked against the Work style when you save.
- **Inbox zero for the Executive Admin** in every business type: every email is routed,
  tracked, filed or cleared and leaves the inbox, and nothing is deleted. Her mail tools can now
  archive under a label, mark read and mark junk, and every move is written to the office log.
  A new hire comes with an Inbox to zero job every 2 hours during office hours, and an office
  that hired her before is offered the new job description on Needs you.
- Michael has a Work style like everyone else, with a default for every office. The hourly
  standup's focus is to close your open requests first, then check the floor.

### Changed

- **Blocked always means waiting on you.** A blocked card with nothing on Needs you is shown to
  Michael every turn, and marked Nothing asked on the Tasks view, until he asks you its question
  or moves it on. Only Michael sets Blocked; Task detail and voice no longer offer it.
- **A card ends only as Done.** Dismissing a card, or moving it to Done yourself, closes it as
  Done by your decision, marked Closed by owner, and Michael is told of every card you move or
  close. Nothing in the app deletes a card any more.
- **Closing time:** someone who has gone home is gone from the floor. Their desk goes dark, their
  name leaves the chip, and nothing opens them until you cancel. Michael stays at his desk until
  the office is closed.
- Job descriptions name nobody: role lines and Work styles name teammates by role, so renaming
  anyone never leaves a stale name. Older text that still names someone is updated on rename.
- The menus are trimmed to what the app uses: no File menu on the Mac, and no Reload or developer
  tools in an installed app. The second office window (New Floor) is gone.
- Edit agent is one column over the profile, with the engine folded away, in every language.
  The Needs you column stays open while anything waits on you. Michael's idle notification
  comes at most every few hours.

### Fixed

- Closing time no longer waits forever on Michael: his reply that the office closed reaches the
  closing bar again.
- A message an agent was still writing is no longer thrown away as broken; one that really is
  broken gets the sender a notice, at most every few minutes.
- A message typed into a busy team member's terminal is confirmed as sent, and Enter is pressed
  again only while nobody is typing there.
- An archive label can never name trash, junk or another system folder, or a folder inside one,
  so archiving can never delete or junk mail.
- The launch catch-up only relays answers you gave in the app, word for word, never text an
  agent wrote into a card. Cards answered before this update show to Michael as Blocked with
  nothing asked.
- A message an agent wrote with broken line breaks is archived as it was delivered, so Michael's
  reply in it still closes your request.
- Answering a question on Ask me never erases a newer question added to the card while you typed.
- A job description offer whose Use the new one could not be saved changes nothing and stays
  offered.

## [0.0.15] (2026-10-02)

### Added

- **Claude connectors, under your control.** Settings > Connections now lists every connector
  on your Claude account (HubSpot, Google Drive, Gmail, QuickBooks and the rest), read from
  Claude when the app starts, when you open Connections, and when you press Refresh. Each one
  is off until you turn it on, and a team member uses it only once its Access tab gives it to
  them. Connectors that need sign in link to claude.ai; ones that left your account show
  Removed until you clear them.
- **Restart to apply.** A team member whose connectors change restarts by itself when it is
  idle, in the same conversation, or right away with Restart now on its Access tab, which says
  when it is restarting and when a restart failed.
- **What's new** opens the notes for the version you are on, right under its link in
  Settings > General, in every language.
- The README explains how Don't Be Michael differs from Munder Difflin.

### Changed

- **Agents can no longer reach what you did not give them.** Until now every team member
  could use every connector on your Claude account except QuickBooks and Gmail, and loaded
  your own Claude Code servers and plugin servers. Now each connector is blocked at start up
  and on every call, and calls are refused if the app cannot confirm access. After the update,
  one Ask me card names the connectors that are now off. QuickBooks keeps your switch and each
  team member's choice; Gmail and Google Calendar, if you had them on, stay on for everyone.
- Work a team member hands to a Claude subagent follows the same rules as the team member:
  its connectors, its mailbox and its private folder.
- Settings is simpler: Agents and Autonomy are one tab, About and Updates are one card, the
  Danger zone stands out, and Default MCP servers, Explain things simply, Arabic text in
  terminals and Language are hidden.
- Mailboxes fold into one line with a count and open by themselves when one needs you.
- Schedule rows read in three quiet lines: the job and its next run, when it runs, and how
  the last run went.
- Updates are always checked in installed builds.

### Fixed

- The paper plane two idle teammates throw now points the way it flies.
- Selecting Michael's card draws its outline all the way around.
- A connector call with a large input (a long document) is checked and goes through instead
  of being refused.

### Removed

- The separate QuickBooks section and the "Your Claude account" switch in Mailboxes: both are
  rows in Claude connectors now.
- The automatic updates switch, which no longer did anything.

## [0.0.14] (2026-10-01)

### Changed

- **A new look, Studio.** The pixel floor is gone. The office is now a calm isometric studio:
  each team sits at a pod with a chip over it, lights come up as the office opens, and work
  moves across the floor as it happens (handoffs, mail arriving, Michael's numbers on his
  walls). Every screen, dialog, setup step, Settings field and the release notes use the same
  fonts, colors and inputs, in light and dark.
- **Quiet people still have personality.** Idle team members say lines from The Office, and two
  idle people trade a line by paper plane or envelope, "that's what she said" included.
- **Cards open where they belong.** A quiet pod's card rolls down from under its chip, and
  selecting someone dims everyone else.
- **Needs you is the one number.** The Tasks tab no longer shows its own blocked count.
- **Ask me cards read plainly.** Titles drop ids, dates and bracketed notes, and the answer box
  grows as you type. Talk to Michael (formerly Brief Michael) grows the same way and takes
  pasted screenshots and files.
- **Task detail** puts the title under the id row and shows the card's notes.
- A team member's tabs are now Profile, Access, Messages, Memory and Work (Capabilities became
  Access, Terminal became Work), and Ask me lives on the Needs you board.
- **Closing time runs on the floor**, with Cancel and Force quit in a bar instead of a dialog.
  It now starts from the clock menu too, and open dialogs stay open behind it.

### Removed

- The traces tab, the old command bar, the files tab and other screens nothing opened any more.

## [0.0.13] (2026-09-30)

### Added

- **The app tells you when Claude Code updated under your team.** Claude Code updates itself, but
  agents already running keep the old version until they restart. The app notices within ten
  minutes and shows a "team upgrade ready" chip and a corner note. Your click runs closing time
  (every agent saves and confirms) and then reopens the app on the new version. Nothing restarts
  on its own; "later" hides the note until a newer version arrives.

### Changed

- Closing time can reopen the app when it finishes: the dialog says "reopening" instead of "see
  you tomorrow".

## [0.0.12] (2026-09-30)

### Fixed

- **Saved passwords and keys can't be lost to a crash mid-save.** Every mailbox password, engine
  key and integration secret lives in one file. It is now written to a temporary file, flushed to
  disk and swapped in whole, so a crash, power cut or full disk leaves the old file or the new one,
  never a torn one. A write that stops short is never swapped in.
- **A file that can't be read is never saved over.** If the saved secrets file is there but can't
  be read at that moment, saving a new secret now fails with a message instead of writing a file
  that holds only the new secret and loses all the others.
- The secrets file is always owner-only (0600), even if an older copy was readable by others.

## [0.0.11] (2026-09-30)

### Added

- **QuickBooks through your Claude account, with you in control.** The app does not connect to
  Intuit itself: team members use the QuickBooks connected to your Claude account.
- **One switch in Settings > Connections > QuickBooks, off by default.** Off, no team member can use
  QuickBooks and it doesn't show on anyone's Capabilities. On, the app checks whether your Claude
  account has QuickBooks connected and, if not, shows the steps to connect it in Claude.
- **Who may use it, on each Capabilities tab:** Can use QuickBooks, then Read only or Can make
  changes. Before you choose, Oscar is on and Read only; everyone else is off. A change applies on
  the team member's next step, with no restart.
- **Read only means a fixed list of reads.** Reports, invoices, customers and payroll details to look
  at. Anything else, including any tool Intuit adds later, shopping for loans and peer loan offers,
  is refused until it is known to be safe.

### Known limitation

- The switch and Capabilities are checked on every QuickBooks call a team member makes. A team member
  that starts its own separate Claude from its terminal is outside that check and can reach your
  Claude account's QuickBooks. The same is true today for email through your Claude account. A fix
  is planned (TODOS.md, P1).

## [0.0.10] (2026-09-29)

### Added

- **Closing time shows who is still working.** The quit dialog lists every team member and
  Michael: confirmed, still working, waiting at a prompt, or nothing to do. It also shows what
  each one is doing and for how long, for example "Run the test suite · 7 min". The line is the
  agent's own description of the step, a file name or a site's host, never the command itself. It
  is redacted, cut to one 80-character line, and never saved to disk.
- **Remind.** Sends one agent, or Michael, the closing steps again: a note in their inbox and a
  nudge at their next step. At most once every 30 seconds per agent.
- **Close without them.** Stops waiting for one team member and tells Michael so the office can
  close. Nothing is stopped: the agent keeps its work and its terminal ends with the others when
  the app quits.
- A row goes when that agent's terminal ends, and Michael is told so he stops waiting for it.

### Changed

- Closing time can be started again while it is running, and refuses once the app is already
  closing or when Michael's terminal has ended.

## [0.0.9] (2026-09-28)

No changes to the app itself.

### Removed

- The old project's website files from `docs/`: its pages, CNAME, robots.txt, the Google
  verification file, research notes, the hires gallery, PR evidence, a talk deck, saved Reddit
  threads, badges, the banner and the old logo set with `tools/make-logo.cjs`.
- Its promo media (Pro, Product Hunt, landing demos and explainer clips) and 42 blog posts about
  the old product: launch posts, competitor comparisons, launch stories and guides for features
  this app does not have.

### Changed

- `npm run check:links` checks only `RELEASE.md`.
- `docs/release-drops.md`, `docs/message-queue.md` and `docs/design/knowledge-graph.md` match the
  code again, and code comments say company knowledge is on by default.

## [0.0.8] (2026-09-27)

### Added

- **A new hire wizard: Who, Job, Role, Finalize.** Pick a character and they bring their job: a
  teammate doing it today, or the job from your business pack. Or pick any job from any kind of
  business, or write a new one. Each hire gets its own folder, like Admin_Erin, when Admin is taken.
- **No two teammates do the same work.** A new job is checked against every teammate's by what they
  handle, not by title. An overlap must be bound to its own mailbox or topic before Hire, and the
  teammate's line says the bound work now goes to the new hire.
- **Work style in plain words.** Hiring and Edit Agent show the work style as a plain description
  you can edit; the app writes the agent's instructions from it when you hire or save.
- **One job, several times.** A schedule can have more than one "when" line, for example every 2h
  on weekdays between 08:00 and 18:00 plus weekends at 14:00.
- **Erin joins the cast**, the character tiles are grouped by job with each one's job under the
  name, and every character has break room lines of their own.

### Changed

- **Michael runs the office.** Only Michael assigns work: a teammate asking another teammate to do
  something goes to Michael, and questions between teammates still go straight through. Michael
  decides the team's schedule requests and asks you in ASK ME only when he can't settle one, or
  when he hasn't decided it within 12 hours. Each request says why, and two about the same job
  become one.
- **Schedules offer 4h** in the every… list, a common half day rhythm.
- **One agent per mailbox.** A mailbox another agent checks shows who has it, and moving it asks
  first.
- **The office speaks office.** Agents say "clocking in…" at launch and "nothing to do" when idle,
  the memory graph shows each agent's character, Sadiq wears a turban and Darryl a full beard.
- **Hiring is simpler.** Developer options are hidden: engine and command line, Git isolation,
  projects, resume session and import. Field explanations sit behind info icons.

### Fixed

- **A memory tidy reads only its own answer**, so one agent's notes can no longer land in another
  agent's memory.
- **Closing the hire dialog by accident.** Selecting text past its edge, or pressing Escape in a
  field, no longer closes it, and it can't be closed while Hire is running.

## [0.0.7] (2026-09-26)

### Added

- **Give each agent its own mailbox.** Settings, Connections, Mailboxes connects Gmail, Google
  Workspace, iCloud, Yahoo, Zoho or any IMAP mailbox with an app password. The password is tested
  before it is saved and stays in this Mac's keychain. Outlook is not supported yet.
- **A Capabilities tab on every agent.** Turn email on in the Email section's header, pick the one
  mailbox that agent may use, and choose Can send or Draft only (replies wait in that mailbox's
  Drafts). An agent restarts once, when it is not mid step, to pick up its mail tools.
- **Agents read, search and draft mail through their own mail tools**, refused for any mailbox
  you did not give them. A mailbox that stops accepting its password shows "needs you" in Settings
  and raises one Ask me card, closed once you fix or remove it.
- **The office opens again after closing time.** The next launch tells each agent the office is
  open, so held work and scheduled jobs run again. A job missed overnight runs once on opening,
  not once per missed hour. Cancelling closing time now tells every agent, not only Michael.

### Changed

- **Schedules live in Capabilities.** Each agent's jobs on a clock are the On a schedule section of
  its Capabilities tab. Michael's Schedules tab is now Office schedule: every job that is on, as a
  plain list, with a hint to change jobs on each agent's Capabilities tab.
- **Sections start closed** on every agent tab, and schedule rows show an open or closed arrow. An
  open schedule has a close or cancel button beside save.
- **Email through your Claude account is one switch** on the Your Claude account line in Mailboxes:
  allowed lets every agent use it, blocked stops everyone. It no longer affects the mailboxes you add.
- **Setup makes Michael's engine and model the team default.**
- **Settings is simpler.** Office theme, automatic updates, Slack and the read only server list are
  hidden in this build; the manual update check stays at the top.

### Fixed

- **Turning Email and Calendar off now blocks agents' mail and calendar tools**, not just the
  setting.
- **The Slack listener no longer starts while Slack is hidden.**

## [0.0.6] (2026-09-26)

### Changed

- **Setup fills in your legal name.** Step 2's legal name starts from the step 1 business name and
  follows a rename there, until you type a legal name of your own.
- **Setup marks every required field.** Business name and your kind of business carry a *, and the
  business tiles get the same red highlight as a missing field when you press Next without one.

### Fixed

- **Reset and Restart no longer throws while closing.** The inbox check that runs every few seconds
  could reach the office after reset had cleared its folder.
- **Reset and Restart in development no longer opens a blank window.** Under npm run dev the app
  now exits and says to run npm run dev again, since the dev server stops with the first window.

## [0.0.5] (2026-09-25)

### Added

- **Every agent has its own schedules.** Each agent's panel has a Schedules tab for its own jobs,
  with the next run on its card. Agents can ask for a schedule change, but only you decide: the
  request waits in ASK ME with Approve and Decline, and chat never changes a schedule. Closing an
  agent pauses its schedules and says so first. Michael's Schedules tab (it was called triggers)
  shows his own jobs and a read only view of the whole office.
- **Every agent's first tab is its Profile:** the job, what the agent does, what it asks you about
  first, its folder with an Open folder button, and the full instructions it works from. Michael's
  profile shows what he does, the team (click a name to open that agent) and what he knows about
  your business.
- **Every agent has a Memory tab** that reads like notes: grouped into your preferences, how to,
  facts and where things live, with where each came from and when. Procedures open to their steps,
  a fact past its check date is flagged, and notes waiting to be sorted in are counted. Show the
  file still shows the raw text. On Michael's tab the memory comes first, with one search box below.

### Changed

- **You talk to team members through Michael, except in 1:1.** Outside 1:1 a team member's terminal
  is watch only, and a bar offers Message Michael or Talk 1:1. 1:1 lives in that bottom bar. A team
  member stuck on a prompt in its terminal is reported to Michael, who raises it on ASK ME. The
  agent brakes (block tools, stop after this step) are hidden.
- **Only Michael sends desktop notifications.** Team members report to him, so their stops no longer
  reach your desktop.
- **The Messages tab reads like a history:** conversations grouped by day, each one line saying who
  asked what and how it was answered, with plain words instead of message types. Closing time and
  scheduled runs are counted on one line instead of filling the tab.
- **A newer question on a card replaces an unanswered older one** in ASK ME.
- **The fresh start note is a short note** with Bring back earlier chat and Hide, and it says when
  bringing the chat back fails.
- **Agent panel tabs** go profile, messages, schedules, memory, then the technical ones (terminal,
  traces), and work with the arrow keys.
- **Settings shows only what this build uses:** Prerequisites lists only Claude Code, uv and
  MemPalace, and the API keys panel is hidden.

### Fixed

- A schedule longer than about 24 days no longer fires nonstop: intervals stop at 24 days, and a
  time like 09:75 is refused instead of becoming 10:15.
- The Messages tab no longer rereads every message file every 5 seconds.
- The Memory tab's memory file fills the tab.
- Small text raised to the 13px minimum on the schedule rows and hints.

## [0.0.4] (2026-09-25)

### Changed

- **Names change only in Edit Agent.** Clicking or double clicking a name on a card or in a panel
  no longer starts renaming it, which mostly happened by accident. Renaming in Edit Agent now
  reaches Michael and the team, and a name another team member already has is refused. Michael's
  name can't be changed.
- **The app shows the new brand.** The header shows the Don't Be Michael lockup, and the window
  icon, the loading screen and the app icon show the Struck M, instead of the old portrait.

### Documentation

- **The README describes the small business office** that the app is today, with the new logo,
  instead of the original developer tool. Contributor documents no longer claim Windows and Linux
  releases or signed builds.

## [0.0.3] (2026-09-25)

### Changed

- **Every agent's folder is private.** A team member's folder opens only for that team member,
  anyone sharing the folder (agents in the same role do by default), and Michael, who can read his
  team's files but not change them. Michael's own folder opens only for him and you. Held by Claude
  Code's own sandbox and permission rules, and checked again by the app on every file an agent opens,
  including through links. A team member's shell commands can't switch the sandbox off.
- **Michael works in the business folder,** the one holding everyone's folders, so he can read his
  team's work. His conversation carries over. Setup now asks for this one folder, and the team's
  folders go inside it.
- **Company knowledge lives in Memory & Knowledge.** Company wide information, policies and rules
  are shared through the knowledge feature, which is now on for every office and which every agent,
  Michael included, is told to search. There is no shared Office folder any more: an existing one
  stays on disk as an ordinary folder inside Michael's. Turning it on or off in Settings now reaches
  agents that are already running on their next message, instead of at their next start.
- **A fresh start for idle team members, without losing work.** When a team member's conversation
  is large (50k tokens or more) and has sat idle for 30 minutes with nothing open (no open task
  card, empty inbox, no reply it is waiting on, no unanswered Ask me question), the app first asks
  it to write a handoff of anything unfinished, then clears its conversation. The new conversation
  starts with that handoff, its memory, Work style and the company profile. If new work arrives
  before the clear, it is cancelled. The earlier conversation is kept: the team member's panel says
  when it was cleared and offers to bring it back. Michael is never cleared. The clock based auto
  clear in Settings is gone.
- **A schedule says when and which job, not how.** Schedules no longer have a Prompt: the label
  names the job (for example "Follow up on unpaid invoices"), and the agent does it the way its Work style
  says. Every run sends the same short message, including a way to stop quietly when there is
  nothing to do. The hourly standup's instructions moved into Michael's own. A schedule that already
  had its own instructions keeps sending them, and its card offers to move them into that team
  member's Work style or remove them.
- **Ask me answers go back to whoever asked, and are remembered.** Each question on an Ask me
  card now records the team member whose work needs the answer (or Michael, for his own). Your
  answer goes straight to that agent, into its memory notes as your words, and Michael is told so he
  can unblock the card. The memory tidy-up keeps the lasting part, like a rule or a preference, so
  the same question isn't asked again.
- **Agents' memory improves instead of piling up.** Each agent's memory is now a short index of
  one line notes (at most about 2,000 tokens) that the app keeps and gives the agent once per
  session. Agents add at most three notes after a task, and your instructions and corrections at
  once, to their memory inbox; they no longer append session logs. In the background, a small model
  (Haiku) sorts the notes in with itemised changes, never rewriting the whole file: it merges
  duplicates, updates facts that changed (the old version goes to an archive), and turns steps that
  worked for a recurring task into a procedure file. It runs after about 10 notes, once a day, or
  when the office is idle. Closing time no longer writes session logs to memory; where work stands
  goes on the task board. Existing memory is sorted once, with the original backed up. This
  replaces the old condenser, which rewrote the whole file.
- **A company profile every agent works from.** Setup asks for the essentials (business name,
  industry, CEO or owner, headquarters address, website), then an optional Company details step:
  legal name and business type, main phone, public email, social links, business hours, time zone,
  where you serve, languages, currency and when your financial year starts. Time zone and currency
  start from your Mac. Every agent, Michael included, gets these facts at the start of each session
  and again when you change them in the new Settings, Company profile page. Anything longer (product
  lists, ideal customers, how you sell, policies) goes in Memory & Knowledge, which the page points to.
- **Company knowledge can be searched by meaning.** When MemPalace is installed, every document you
  add is indexed into it, so a search for "money back" finds your refund policy. Removed documents
  leave the index too. Without MemPalace, agents search by exact words as before.
- **House rules for every agent, Michael included.** Every agent now starts with five short rules:
  state only facts it can trace to a source and name the source, say so when it doesn't know,
  mark estimates as estimates, report outcomes as they are, and never make up people, customers or
  quotes.
- **Compaction is left to Claude Code.** The app no longer types `/compact` into idle agents every
  two hours, and its Settings control is gone. Each Claude agent now starts with Claude Code set to
  compact at about 300k tokens (models with a smaller window keep their usual point), instead of
  waiting until about 967k on 1M token models.
- **The standup no longer talks about compaction.** Keeping each agent's context small is the
  app's job, not something agents are told to do. An office still using the original standup text
  gets the new one; text you edited yourself is left as it is.
- **The standup runs every time the office opens.** Michael gets the hourly standup as soon as he's
  up, including a brand new office right after setup, then every hour from there. Before, the first
  one on a new office was lost, and a reopened office only got one when it was overdue.
- **Hiring asks for Role, Role description and Work style,** the same fields as Edit Agent. A new
  team member's folder goes inside Michael's, named after the role, so people in the same role
  share one. Michael's folder can't be picked as a team member's own folder.
- **New instructions for Michael and the team.** In an office with a business folder, Michael
  starts as the office manager of your business: he runs the team, sends work to whoever's role
  fits, and brings you only what needs you. Each team member starts knowing its job, who it reports
  to, and how to hand work back. Replies meant for you or for Michael reach Michael, whatever name
  an agent uses for him.
- **Each role in a business pack comes with its Role description and Work style,** written for
  that business, with your business name and city filled in. A new hire from a pack gets them.
- **Your existing team gets the new text too, once.** Each team member that came from a pack gets
  today's Role description and Work style when the app next opens. The team list is backed up to
  `roster-backups` first; if the backup fails, nothing changes. Team members you hired yourself are
  left as they are.
- **Michael gets the team list only when it changes,** instead of on every message, and a short
  status line when someone's status changes.
- **Plainer messages from the app.** The inbox nudge, the pause and stop notes, closing time, Slack
  requests and the message format reference are rewritten in plain words, and scheduled runs arrive
  as information rather than as tasks. Michael's role is "office manager".
- **Nothing is typed into Michael's terminal when he starts.** He no longer gets a remote control
  command or an orientation prompt; his instructions and the standup when the office opens cover it.

### Fixed

- **Setting up again no longer loses your team.** When setup finished on an office that already
  had a team, the floor could save Michael alone over the team's list. Setup now reads the
  office's team first, and any team member the office knows but the floor lost comes back.
- **Your office is found by its folder, not its name.** When setup finds an office on this Mac, it
  offers to continue with it: the same team, in the same folders, whatever business name you type.
  Setting up a new office gives it a folder of its own. The office keeps its own record in
  `office.json` in its folder.

- **Notifications name the person.** A desktop notification now reads "Michael: Waiting for you."
  instead of "god: Claude is waiting for your input", and each team member's notifications carry
  their own name.

- **"Close Office" and "Hide Office" in the menu.** They replace "Quit Don't Be Michael" and "Hide
  Don't Be Michael", which put the action and "Don't" side by side. Cmd+Q and Cmd+H work as before.

- **Edit a team member's engine from two short lists.** Provider and model are now dropdowns
  instead of rows of buttons, and the provider list shows the engines this app offers.

- **Only Claude Code can be picked, everywhere.** The hire dialog and Michael's engine and model
  pickers now offer the same engines as setup. The others are not ready to run
  an office member yet.

- **Role, Role description and Work style when editing a team member.** The old Description is
  split into a role and what the role covers, which Michael reads to decide who gets which work, and
  a save reaches him straight away. Goal is now Work style: how the team member does its work,
  which Michael doesn't see.

### Removed

- **No voice, for now.** Talking to Michael and dictating messages are switched off, along with
  the Voice tab in Settings.

- **No usage stats choice in setup or Settings.** The app sends no usage data, so it no longer
  asks about it.
- **No Auto / Pause switch in Michael's Command Center.** It held back every message queued for
  the team. Queued messages are always delivered now, and a pause saved earlier is cleared.
- **No "open" button next to edit.** It opened a Terminal window in the agent's folder, a developer
  tool. The terminal icons beside folders in Michael's Command Center are gone too.
- **No close button on team members.** It stopped a team member mid-task and took it off the floor,
  with no button to bring it back.
- **No "auto mode" text in the header bar.** It named a setting in words owners don't use. The
  setting itself is unchanged, in Settings under Autonomy & Budgets.

## [0.0.2] (2026-09-24)

### Changed

- **Setup runs again after updating from 0.0.1.** The app now keeps its settings in its own
  folder, `~/Library/Application Support/dontbemichael`. Settings, connected accounts and history
  from 0.0.1 are not carried over. Your team's folders in Documents are not touched, so using the
  same business name in setup finds them again. The old settings stay in
  `~/Library/Application Support/munder-difflin` until you delete that folder.
- **This app's own name and copyright.** The About panel, the installer and the project metadata
  name Don't Be Michael and its owner.

## [0.0.1] (2026-09-24)

The first release of Don't Be Michael: an AI office for small business owners.

### Added

- **Set up by business.** Setup asks for your business name and City, State, then your kind of
  business: restaurant, retail, professional services, home services, or SaaS and consulting. It
  explains that Michael is your office manager, then suggests a team for that business, and you pick
  who joins.
- **Office Packs.** Each business type is a pack that decides who is on the team and how each job
  reads for that trade. Every character keeps the job they had in the show, in every pack.
- **A folder for every team member.** Each works in their own folder under Documents, next to a
  shared Office folder where Michael works. The app's own working folder is kept for coordination,
  and agents are stopped from saving work there.
- **Real documents in Memory & Knowledge.** Word, Excel, PowerPoint, PDF and scanned documents are
  read (scans and photos through the Mac's own text recognition), with plain reasons when a file
  can't be read. Agents can read the same files in their folders.
- **OFFICE, TASKS and GRAPH views.** A switch in the corner of the floor shows the animated office,
  the whole task board (who is doing what, what is blocked, what is done), or who talks to whom.
  Each view opens with a short explanation.
- **Michael asks when no one fits.** A big job outside everyone's role goes on the Ask me board
  with suggestions, instead of Michael starting a new agent on his own.
- **"We can't find your office."** If the office folder is moved or deleted, launch asks where it
  went, instead of quietly starting an empty office in its place.

### Changed

- **Named Don't Be Michael.** The menu, window, installers and macOS permission prompts use the new
  name. Your data folder keeps its old name, so nothing is lost.
- **Claude Code only, Opus 5.5 recommended.** Setup offers Claude Code with a choice of Claude
  model, says a Claude Max plan keeps the office running all day, and falls back to Opus 5 on an
  older Claude Code. The model list, updates and links all come from this app's own repository.
- **A floor for owners.** Every launch opens on Michael, on his Ask me tab. Skills, webhooks, memory
  settings and agent upkeep moved to Settings, where they apply to the whole office. Monitor and
  Activity sit under an Advanced tab. Owner facing text is 14px or larger, in plain words, with no
  dashes, in English, Chinese and Arabic.

### Removed

- Git views, the code editor, temporary helper agents and the organisation trigger are hidden in
  this build. The floating memory panel on the office floor is gone; its settings are in Settings.
- The original project's promotions, community links and update source.
- Windows and Linux builds. This release ships a Mac installer only; the other platforms stay
  configured for later.

### Security

- The Mac app is sealed ad hoc until it can be signed with an Apple Developer ID, so a downloaded
  copy opens through Privacy & Security > Open Anyway instead of being reported as damaged. Updates
  arrive as a download link rather than installing in place until the app is signed.

### Fixed

- Document reading no longer freezes the app while it converts older Word and RTF files.
- Setup no longer hangs on "Saving" when something fails; it says what went wrong in plain words.
- Switching offices keeps your team on screen if the switch fails.
- Opening a team member's memory from the graph no longer sticks to that person later.
