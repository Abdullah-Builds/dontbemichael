# Don't Be Michael: features and changes

Everything the app does today, and every release that got it here (0.0.1 to 0.2.4). Part 1 is
written to be lifted onto the GitHub page and the website as it is; Part 2 is the full list, release
by release.

## Part 1: Feature highlights

**One line:** An AI office for your small business. Talk to Michael, your office manager, and a
team of AI employees does the work on your computer.

**Short pitch:** Pick your kind of business and your team. Every team member is an AI agent with a
job, its own folder, its own mailbox and its own memory. Michael hands out the work, keeps the team
moving, and brings you only the decisions that need you.

### 1. Michael runs the office
- You talk to one person. Michael sends each job to whoever's job it is, runs an hourly standup,
  keeps the task board right and brings you only what needs you.
- Only Michael assigns work. When one team member needs another to do something, it goes through
  Michael, so work never bounces between two agents. Teammates can still ask each other questions.
- Michael decides the team's day to day requests himself, such as a new schedule, and asks you only
  when the facts can't settle it, sources disagree, or it is sensitive.
- Your answer to a question becomes Michael's work: he routes it and closes it, and the Tasks view
  shows which cards sit with him. Blocked always means waiting on you, Waiting shows who a card
  waits on, and a card ends only as Done. A Done card shows the first line of Michael's result,
  and the whole result leads its details. Only you reopen a Done card, with a short reason.
- Michael alone keeps the task board. Team members file what their work needs once, in a queue
  only he sees, and he works it in order: answers it, folds it into a card, or puts it on Ask me.
  One activity's questions arrive as one ask: choices show as rows you pick with a click, with
  Michael's recommendation tagged, and several questions get a line each. You never have to
  answer them all: what you leave blank goes back through Michael to whoever asked, and comes
  back to you only if they still need it.
- A To do card shows when its next step is due, in your local time, and its person is reminded
  then, even after the app was closed.
- A question stays on Ask me until you answer it, Michael withdraws it, or you delete the team
  member who asked, and your answer goes only to Michael.
- A file Michael names in a reply, an Ask me card or a task shows as a chip. Markdown, text, JSON,
  CSV and pictures open in an office tab beside Who talks to whom and refresh when the file
  changes; PDF and Office files open in their own app. Only files in the office and team folders
  open.
- Ask Michael anything from the Talk to Michael box: he answers in a conversation that opens above
  it, and each question shows where it stands until it is answered. Scheduled outcomes, such as a
  weekly summary, arrive on Ask me as quiet Report cards you clear with Got it.
- Only Michael sends you desktop notifications. Talk 1:1 with any team member when you want to.

### 2. Hire the right person in four steps
- Who, Job, Role, Finalize. Pick a character from The Office and they bring a real job: the one a
  teammate already does, the one written for your kind of business, or any job from another
  business. Or write a new one.
- No two teammates do the same work. The app checks every new job against the team by what each
  one handles; an overlap has to be tied to its own mailbox or topic before you can hire.
- The work style is in plain words you can edit, or Suggest me writes a first one for you. The app
  turns it into the agent's instructions.
- A new hire's one time first job is a card Michael hands out, not a line in their work style.
- Every hire gets its own private folder and starts working.
- Delete a team member for good from the Danger zone in Edit agent: they stop, their schedules
  pause, work they took goes back to the teammates it came from, and Michael gets their open
  cards to hand on. Michael, his assistant and Pete can't be deleted.

### 3. A mailbox for every job
- Connect as many mailboxes as your business runs on: Gmail, Google Workspace, iCloud, Yahoo, Zoho
  or any IMAP mailbox. Passwords stay encrypted on your computer.
- Give each team member the one mailbox that fits its job: the Admin watches the CEO's inbox,
  Support answers support@, Sales follows up from sales@. One team member per mailbox.
- Choose Can send, Send on approval or Draft only for each one. Send on approval puts each email on Needs you to edit and approve; the team member then sends exactly what you approved. Can send never puts an email on Needs you, and moving a team member to it hands back the emails still waiting there, unless it sends only from a mailbox nobody on the team watches right now. A team member can't reach a mailbox you didn't give it.
- When you keep approving the same kind of email unchanged, the team member can offer to send that
  kind without asking. You tick it on the card and can revoke it on its Access tab; a separate quick
  check reads each such email first, and anything that doesn't fit comes to you.
- Let one more team member send from a mailbox without reading it (Send only), with its own Sending choice: Sales sends outreach from the CEO's address while the Admin keeps that inbox.
- The Executive Admin keeps the inbox at zero: every email is routed, tracked, filed or cleared and
  leaves the inbox. Archiving, marking read and marking junk never delete anything.

### 4. Jobs on a clock
- Each team member's schedules sit on its Access tab. Name the job ("Check the support
  inbox"), when, and its focus area, what to concentrate on each run; it does the job the way its
  work style says. A new hire can arrive with its jobs already set, like Inbox to zero.
- One job can run at several times: every 2 hours on weekdays between 8 and 6, plus 2 pm at weekends.
- Run now sends a job at once, exactly as its clock would, so you see it work without waiting. A
  job at set times keeps them; a job that runs every few hours counts again from the run.
- Closing time pauses the office; opening it runs a missed job once, never a backlog.

### 5. Memory that gets better
- Each team member keeps a short list of lasting notes: your preferences and corrections, facts it
  looked up, where things live, and the steps for jobs it repeats. A background tidy up merges and
  updates them instead of letting them pile up.
- Your answers to its questions go straight into its memory, so it doesn't ask again.
- Each team member's memory is its own. Nobody, Michael included, reads or searches another's
  notes: to learn what a teammate knows, they ask that teammate, and Michael reads the task board
  and the work each one hands in. On a Mac, Claude members' shells are walled off from each
  other's notes too.
- Company profile and company knowledge (Word, Excel, PowerPoint, PDF, and scans or photos on a Mac or a Windows PC) are
  shared with the whole team, searchable by meaning. Settings lists every document; open one in
  your own app, save it, and the team searches the new version.
- Company foundations: one document of what each job needs to know about your business (who you
  sell to, how you sound, your financial year), filled by you, the company profile and what the
  team learns. When work needs an empty answer, a card on Needs you asks you once.

### 6. You stay in charge
- Every connector on your Claude account (HubSpot, Google Drive, Gmail, QuickBooks and the rest)
  shows up in Settings by itself, off. Turn one on, then give it to the team members who need it.
  Nobody else can reach it, and your own Claude Code servers stay yours.
- Spending money, deleting things and anything public come to you first, on the Needs you board.
  While anything waits it stays open; when nothing at all waits it gets out of the way and the
  office fills the window.
- Private folders: each team member opens only its own; Michael can read the team's work but not
  change it. Enforced by Claude Code's sandbox on a Mac. On Windows, the app checks Claude's file
  tools, but shell commands are not limited yet.
- House rules for every agent: say where a fact came from, say when it doesn't know, never make up
  people, customers or quotes. A looping agent is steered, then held, then stopped.
- A team member stuck on a prompt only a person could answer is restarted by the app, never
  handed to you for a 1:1. If the restart does not take, or it happens again within half an
  hour, Michael moves their work to a teammate and tells you once.
- One team member on the internet: Pete, the Research team member, is the only one who opens web
  pages or searches, in every office. A trust layer checks every message to Pete against the kinds
  of data you keep private and cleans Pete's answers. Pete is off until you turn them on, and sees
  none of your files. On a Mac nobody else's commands reach the internet.

### 7. An office you can watch
- A pod for each department around Michael's glass office, each with a plate in front of the
  chairs naming its department (Finance, Sales, HR and so on), and every team member with a
  signature prop on their desk and as their avatar. The monitors are clear glass, tinted with
  scrolling lines while someone works. Desks light up as team members clock
  in and go dark at closing time, envelopes fly between pods as work moves, and idle teammates
  trade lines across the office by paper plane. Your message to Michael flies to him as a paper
  plane too.
- Every team member has a Profile, Access, Messages, Memory and Work tab written for owners, not
  developers. Views for the task board and for who talks to whom, over any time from the last hour
  to the last month.
- A person's panel and Edit agent open wide in the center of the window for long reading and
  writing, and leaving Edit with unsaved changes asks first.
- When a team member's AI engine stops reporting to the app, Needs you says so with Restart.
  Michael restarts one that never checked in once on his own, its mail goes to him until it
  reports again, and where nothing else guards its files its terminal is stopped until you
  restart it.
- Pulse shows what the office got done and what each team member costs, as pictures:
  recommendations first (a schedule that mostly finds nothing to do, or a member whose work would
  suit a lighter model), each with its numbers and applied only by your click, with Undo; what got
  done and who did it; Kept safe, what the trust layer kept off the internet, the web answers it
  cleaned of instructions to AI agents, anything held because it could not be checked (open it to
  see what each one was, when and why; open the questions or answers to see each one as written
  and as it went out, with what was taken out marked), and the
  steps your settings stopped; Learning, what the team learned in the period and whether it asks
  you less; your plan use and your time; and Team at work, how busy each member is next to the
  others, and what their work costs. On a Claude plan, costs are the plan's real price
  (found in your Claude account, or the price you set in Settings) split by each member's share
  of the work, with the pay per use figure one click away. Pick Today, This week or This month,
  and turn on Compare to see each figure next to the same days of the day, week or month
  before. It fills in the weeks before it started from what the office already keeps, so it
  never starts at zero.

### 8. Built for small business owners
- Setup by kind of business: restaurant and food, retail, professional services, home services,
  SaaS and consulting, or anything else. Each comes with a suggested team.
- Runs on your computer with the Claude plan you already have. Plain words, no developer settings.
  A Windows 11 (x64) build ships with every release.
- When your Claude plan reaches its usage limit, the office takes a break. Ask me, the top bar and
  the floor say when work starts again. Nothing is typed into a Claude terminal meanwhile, and
  scheduled jobs still go out on time and wait in the inbox. At the reset the team carries on by
  itself.
- Setup ends on Get Michael ready: it installs Claude Code and signs you in where you can see it,
  or takes an Anthropic API key instead. Skip it, and Ask me keeps a card until Michael can start.
- If your settings file was damaged, setup says that is why it starts again and where a copy of
  the file was kept.

## Part 2: Every change, release by release

### 0.2.4 (2026-10-20)
- Company foundations: one document in company knowledge with plain questions for each job, one
  answer per shared question, in step with the company profile. Work that hits an empty answer
  raises one card on Needs you; answer it, have the member draft it, or put it off a week. Pulse
  shows the jobs that hit an empty answer and a Foundations count under each member.
- Settings lists every company knowledge document with Open in your own app; a save there is read
  in again. Company knowledge and search by meaning have no switches, and search by meaning
  follows your edits.
- Pulse folds quiet tiles into chips and, in the first two weeks, shows what it sees so far.
- A file an Ask me question names without its ending opens from its chip.
- Contributor fixes: scans and photos read on Windows, a lost answer to Michael sent again, a late
  restart reported, Pulse buttons, its backfill on open and stale cost totals, bounded hook counters.

### 0.2.3 (2026-10-18)
- The office opens with a Clocking in card over Michael's desk: how many are in, who is still
  coming, then Everyone's in or who hasn't clocked in after a minute. The clock pill says Opening.
- Waiting cards come back: a check back time per card (a date named, the member's judgement, else
  three business days), one Follow up due note to Michael, a gone quiet list, and after two follow
  ups with no reply a question for you on Ask me.
- Pulse's Learning card lists its notes, counted when a note is added.
- Needs you says when a team member stops reporting to the app, with Restart; Michael restarts a
  member that never checked in once. Each member's notes, inbox and hive folder are its own.
- A person's panel and Edit agent open wide; Pulse has Today, This week and This month with
  Compare, and lists what the privacy check did.
- Closing time doesn't wait on a member that isn't reporting. The app's own notes to Pete are not
  questions. The app makes every message's id and time.
- Run a scheduled job now, file chip actions, a Codex context gauge, connected apps waited out when
  they rate limit, and about 40 more contributor fixes and translations.

### 0.2.2 (2026-10-16)
- Pulse, a new tab beside Tasks: recommendations to save (a check run less often, a lighter or
  stronger model) applied only on Apply and undone with Undo; what got done; what was kept safe;
  what the team learned and whether it asks you less; what was spent and your time; and Team at
  work. It fills in the eight weeks before it started. On a Claude plan, cost is your plan's real
  price split by each member's share of the work, with a price you can set in Settings.
- Ask me cards with choices as rows to pick and a line per question; you never have to answer
  every question, and what you leave blank goes back through Michael to whoever asked.
- Delete a team member for good from the Danger zone in Edit agent.
- Every office on the floor names its department on a plate, and the desk monitors are glass.
- A team member stuck on a prompt is restarted and told to carry on, never handed to you.
- Hook events carry a secret for each start, so a frame with no secret or an old one reaches
  nothing (issue #61).
- Pete's privacy check answers at launch, Pete no longer stops on permission prompts, and the app
  never answers a permission prompt for an agent.
- Six contributor fixes: Yesterday across clock changes, release notes with &, <, >, a damaged
  pause notice, close button feedback, a street address example and more local currencies.

### 0.2.1 (2026-10-14)
- Reset & start over starts truly fresh: it erases everything the app made for the office (the
  team, memory, settings, Memory & Knowledge, saved keys, history, agents' worktrees) and keeps
  your team's folders, your own files and your Claude sign in.
- Michael hears every message the privacy check keeps from Pete, with who, what, why and what to
  do next; a check that could not run says so instead of asking for plainer words.
- An Ask me card that needs you to sign in, accept terms or pay on a website links straight to it.
- In the communication only mode, a webhook message skips your approval only when it is one short
  plain status question; a label or a title can't skip it.
- Pete joins the office's idle chatter with lines of his own and a first day welcome.
- A new, retimed or turned on schedule waits for its next time instead of running at once.
- About twenty contributor fixes: documents read in their own process, PDFs up to 500 pages,
  Excel files from business systems, skill installs, setup retry, Ask me headlines, dark mode
  warnings, and more (CHANGELOG).

### 0.2.0 (2026-10-13)
- Pete, the Research team member, is the one way to the internet in every office: nobody else
  opens web pages, searches or, on a Mac, reaches the internet from a command. Off until you turn
  them on in Settings, Research & privacy, or in the setup Team step; renamable; their own face.
- A trust layer checks every message to Pete against the kinds of data you mark private (passwords
  and keys never go), cleans Pete's answers of instructions, and flags a steering answer to
  Michael. A change to your privacy settings applies at once.
- Pete sees none of your files, the task board, memory or company knowledge, and the app treats
  what Pete writes in their own folders as untrusted.
- The office stops when your Claude account runs out of credit or its sign in or key stops
  working, and says why, with Add credit, Sign in or Change key.
- Links name the site or app they open; web and mail links in replies open with a click. Search
  the task board and filter it by team member; a task's questions show newest first.
- Michael hears when the safety brake holds a team member back; a crash shows a recovery screen.
- About sixty contributor fixes: Windows paths and starts, mail speed and errors, closing time,
  dark mode colors, file tabs, names with underscores or two dots, and more (CHANGELOG).

### 0.1.9 (2026-10-11)
- Michael alone writes the task board. Team members file what their work needs once, in a queue
  only he sees, and tell him when their work moves; he works the queue in filing order.
- A card is one activity's needs: its questions for you are one numbered ask, answered together,
  and a part left unanswered comes back. Questions for you and for someone outside the office go
  on separate cards.
- Done is final: only you take a card out of Done, into To do, with a short reason. A card an
  agent reopens or deletes is put back as it was, and Michael is told.
- A To do card can carry the time its next step is due. Its person is reminded at that time, also
  after a restart, and Michael hears once if the card is still in To do four hours later.
- Cards carry no running notes, routines on a schedule get no card, and a card never waits on its
  own person.
- Team members hear when the house rules change, and reports read in plain business words.
- Closing time switches to the office floor and its still working count is a button with one
  scrollbar; a Markdown report fills its tab; file chips sit in their sentence; the way back to
  your conversation with Michael stays beside the message box.
- Contributor fix: a webhook body that cannot be read is logged with the reason.

### 0.1.8 (2026-10-11)
- Office break: when the Claude plan reaches its usage limit, Ask me, the top bar and the floor say
  so and when work starts again. Nothing is typed into a Claude terminal meanwhile; scheduled jobs
  still go out on time and wait in the inbox. At the reset Michael is told, and the team members
  who stopped mid task carry on once a turn goes through.
- Files Michael names in replies, Ask me cards and tasks are chips. Markdown, text, JSON, CSV and
  pictures open in an office tab that refreshes on change; PDF and Office files open in their own
  app. Only files in the office and team folders open.
- A Done card shows the first line of Michael's result; the owner's message flies to Michael as a
  paper plane; setup says why it starts again when the settings file was damaged.
- No team member, Michael included, can change the hook program or any agent's settings. The
  webhook and Slack listeners answer this computer only.
- Mail: a send that may have gone out is held, never sent twice; a server never reached reads Not
  sent; a damaged approvals file is refused, not emptied.
- A config.json that cannot be read is copied aside before any save, and a failed save keeps the
  old file.
- Contributor fixes: connectors say when they cannot be reached and stop everything a hung check
  started; team members that failed their first start are tried again; messages are not typed
  twice; the standup keeps to its times at launch; one webhook cannot use up the others' limit;
  memory notes use your local day; setup text is 14 px or larger; Settings folds animate; Open at
  login is hidden on Linux; Windows reads "this computer"; tab rows scroll with the wheel; Skills
  search has a Clear button; and smaller fixes to secrets, QuickBooks access and the closing time
  list.

### 0.1.7 (2026-10-09)
- Microsoft 365 on your own domain: testing such a mailbox looks up where the domain's mail goes and
  says Microsoft 365 cannot be connected yet, instead of a server or password error. A failed lookup
  never blocks a working mailbox.
- Large Office files: a Word, Excel or PowerPoint file whose text parts add up to more than 200 MB,
  or more than 5,000 parts, is refused before anything is unpacked. Photos do not count.
- An email asked for twice within 10 minutes is sent once, even across a restart.
- Links and dropped files no longer replace the app window; web links open in your browser.
- Slack can be retried after its tunnel fails; sent team messages with the same file name are both
  kept; folder rules on Windows read `~` as the home folder.
- Groundwork for Codex: its usage and cost reach the caps and cost views (not offered yet).

### 0.1.6 (2026-10-09)
- Can send means no approval cards: a team member on Can send sends without asking, and moving one
  there hands its waiting emails back, unless nobody on the team reads the inbox it sends from.
  Every Sending change tells the team member and goes into its notes.
- Windows offices without Git for Windows: Claude Code runs team members' hooks in PowerShell
  there, and the app now writes them for that shell, so team members report their work again.
- Team members on Windows can run commands again; their file tools still stay out of other
  folders.
- The terminal refits when its text size changes on its own, and logs its sizes when it still runs
  past its box.

### 0.1.5 (2026-10-09)
- Windows offices start: the app trusts your office folder the way Claude Code looks it up on
  Windows, so team members no longer stop at a hidden trust question and quit.
- Cards that wait on a customer or teammate move to Waiting, back to Doing when they answer, and
  Michael chases them until then. Offices on the old standup text get the new one at launch.
- Get Michael ready says why an API key was not accepted: a key made outside a workspace,
  Anthropic's own reason, Anthropic busy, or a real network or proxy problem.

### 0.1.4 (2026-10-07)
- Send on approval: a third Sending choice puts each email on Ask me, where you edit, approve,
  ask for changes or stop it. You can let a team member send one kind of email without asking,
  and revoke that on its Access tab.
- Michael answers you in the app: each question you send shows Sent, Michael has it, Waiting on
  someone, Waiting for you, Answered or Couldn't finish. Scheduled reports arrive as Report cards.
- Send only access to a mailbox someone else watches, with each address's watcher and sending
  route on the team member's Email section.
- Setup screens center the card until your office picture appears.
- Get Michael ready: setup installs Claude Code without a password and signs you in where you can
  see it, or takes an Anthropic API key. Team members that could not start begin once it is ready.

### 0.1.3 (2026-10-05)
- The GitHub page offers the Windows 11 beta beside the Mac download: platform badge, download
  link, what you need and install steps, including Run anyway when Windows protects your PC.
- The docs say what is Mac only for now: reading scans and photos, and the sandbox that keeps
  shell commands inside each team member's folder. Saved passwords are described as encrypted on
  your computer.

### 0.1.2 (2026-10-05)
- The Windows 11 (x64) beta installer ships with every release, beside the Mac download.
- A Beta pill sits beside the version in the top bar, with a tip that says where Report a
  problem is; its tip opens above the Tasks board.

### 0.1.1 (2026-10-05)
- A question on Ask me never disappears unanswered: it leaves only when you answer it or Michael
  withdraws it, and Task detail says when one was withdrawn and why. Each open question has its
  own row. Michael is told each turn about cards holding questions the wrong way.
- Your answer goes only to Michael, who routes it. Closing a card, fixing a mailbox or finishing
  a card by voice withdraws its open questions.
- A question that names a file saved in the office lists it with Open, or Show in Finder (Show in
  folder on Windows). Only files in the office and team folders count.
- Closing time and office open notices no longer fly to desks; idle chit chat is paper planes.
- A Beta pill and Report a problem in Settings. Archive and Sent mail searches explain a miss.
- Windows 11 (x64) beta, on the 0.1.1 release and every release after it.

### 0.1.0 (2026-10-04)
- A new hire's one time first task is a card Michael hands out at hire, not a line in their Work
  style. A First task you type into a Work style, when hiring or in Edit, becomes a card too.
  Existing team members' old First task text is moved out once, and any standing duty it held
  is now a scheduled starter job.
- The Tasks view has a yellow Waiting column: a card someone is working on but waiting for a
  teammate's reply shows who it waits on. Only Michael moves cards into Waiting or Blocked.
- The floor has character: each team member has a signature prop as their avatar and on their
  desk, departments have painted floor signs, and the office has plants, a water cooler and
  Michael's mug. An office keeps the ring layout up to nine pods.
- Who talks to whom reads by time, from the last hour to the last month, shows teammates talking
  to each other, and connects you only to Michael. The Topics layer is gone.
- Suggest me on the hire wizard writes a first Work style, streamed into the field as it is
  written. Closing a hire who took work from teammates gives it back, and it returns with them.
- Mail tools search sent mail, the archive and labels, and never read drafts, trash or junk.
- A team member who needs a fact asks the teammate who has it before Michael. Every character
  has break room lines of their own, and the office window opens filling the screen.

### 0.0.16 (2026-10-03)
- Your Ask me answer is now Michael's open work. It reaches him as a request about the card, stays
  in front of him on every turn until he routes the follow up and closes it, and one whose request
  did not go out is sent at the next launch. The Tasks view shows those cards as With Michael, and
  as not moved after one work day of your office hours.
- Blocked now always means waiting on you. A blocked card with nothing on Needs you is shown to
  Michael every turn, and marked Nothing asked on the Tasks view, until he asks you its question
  or moves it to Doing with who it waits on.
- A card ends only as Done. Dismissing a card, or moving it to Done yourself, closes it as Done by
  your decision, marked Closed by owner, instead of deleting it, and Michael is told of every card
  you move or close.
- Every scheduled job has a focus area: what to concentrate on each time it runs. It is written on
  the job, shown with the team member's Work style, sent only with that job's run, and checked
  against the Work style when you save. Older jobs keep running and show No focus area until
  you add one on the job.
- The Executive Admin works to inbox zero in every business type: every email is routed, tracked,
  filed or cleared and leaves the inbox, and nothing is deleted. Her mail tools can now archive
  under a label, mark read and mark junk. A new hire comes with an Inbox to zero job every 2 hours
  during office hours, and an office that hired her before is offered the new job description on
  Needs you.
- At closing time, someone who has gone home is gone from the floor: their desk goes dark, their
  name leaves the chip, and nothing opens them until you cancel. Michael stays at his desk until
  the office is closed.
- Job descriptions name nobody: a team member's role line and Work style say what the job is, and
  teammates are named by role, so renaming anyone never leaves a stale name. Text from older hires
  that still names someone is updated when that person is renamed.
- Michael has a Work style like everyone else, with a default for every office, and the hourly
  standup's focus is to close your open requests first, then check the floor.
- The Needs you column stays open while anything waits on you and gets out of the way when nothing
  does. Edit agent is one column over the profile, with the engine folded away. Profiles list only
  the connections a team member really has. Every agent reports what its tools cannot do instead
  of working around it. Michael's idle notification is a light reminder at most every few hours.
- Only Michael sets a card to Blocked; Task detail and voice offer To do, Doing and Done. Nothing
  in the app deletes a card any more.
- An archive label can never name trash, junk or another system folder, or a folder inside one,
  and every mail move an agent makes is written to the office log. The launch catch-up relays
  only answers you gave in the app, word for word; cards answered before this update show to
  Michael as Blocked with nothing asked.
- Closing time no longer hangs on Michael, a message an agent is still writing is never thrown
  away, and a message typed into a busy terminal is confirmed as sent.
- The menus are trimmed: no File menu on the Mac, no Reload or developer tools in an installed
  app, and the second office window (New Floor) is gone.

### 0.0.15 (2026-10-02)
- Claude connectors. Settings > Connections lists every connector on your Claude account, read
  from Claude when the app starts, when you open Connections and when you press Refresh. Each one
  is off until you turn it on, and a team member uses it only once its Access tab gives it.
  Connectors that need sign in link to claude.ai; ones that left your account show Removed.
- Until now every team member could reach every connector except QuickBooks and Gmail. After the
  update the others are off, and one Ask me card names them. QuickBooks keeps your switch and each
  team member's choice; Gmail and Google Calendar, if you had them on, stay on for everyone.
- Team members no longer load your own Claude Code servers or plugin servers. A team member whose
  connectors change restarts when it is idle, in the same conversation, or right away with
  Restart now on its Access tab.
- Settings is simpler: Agents and Autonomy are one Agents tab, About and Updates are one card
  whose What's new opens the notes for the version you are on, and Mailboxes fold into one line
  that opens by itself when one needs you. Default MCP servers, Explain things simply, Arabic
  text in terminals and Language are hidden, and updates are always checked.
- Schedule rows read in three quiet lines: the job and its next run, when it runs, and how the
  last run went.

### 0.0.14 (2026-10-01)
- A new look, Studio. The pixel floor is gone: the office is a calm isometric studio with a pod
  and a chip for each team, lights that come up as the office opens, and handoffs, mail and
  Michael's numbers drawn from real events. Every screen, dialog, setup step and Settings field
  uses the same fonts, colors and inputs, in light and dark.
- Idle team members say lines from The Office, and two of them trade a line by paper plane or
  envelope. A quiet pod's card rolls down from under its chip, and selecting someone dims the rest.
- Needs you is the one count. Ask me cards have plain titles, the answer box and Talk to Michael
  grow as you type, and Talk to Michael takes pasted screenshots and files. Task detail shows the
  card's notes.
- Closing time runs on the floor with Cancel and Force quit, starts from the clock menu too, and
  leaves open dialogs as they were. A team member's tabs are Profile, Access, Messages, Memory
  and Work.

### 0.0.13 (2026-09-30)
- Claude Code updates itself, but team members already running keep the old version until they
  restart. The app notices within ten minutes and shows a "team upgrade ready" chip in the title
  bar and a note in the corner.
- One click closes the office the safe way (every agent saves and confirms), then the app reopens
  on the new version; the closing time dialog says "reopening". Nothing restarts on its own, and
  "later" hides the note until a newer version arrives.

### 0.0.12 (2026-09-30)
- Saved passwords and keys (mailboxes, engines, integrations) can't be lost to a crash mid-save:
  the secrets file is swapped in whole, so a crash, power cut or full disk leaves the old file or
  the new one, never a torn one.
- A secrets file that is there but can't be read is never saved over; saving a new secret fails
  with a message instead of erasing the others. The file is always owner-only.

### 0.0.11 (2026-09-30)
- QuickBooks through your Claude account; the app does not connect to Intuit itself. One switch
  in Settings > Connections > QuickBooks, off by default. On, it shows whether your Claude account
  has QuickBooks connected, or the steps to connect it.
- Each Capabilities tab: Can use QuickBooks, then Read only or Can make changes. Oscar starts on
  and Read only; everyone else starts off. A change applies on the next step, with no restart.
- Read only is a fixed list of reads; anything else, loan shopping and peer loan offers included,
  is refused. Known limit: a separate Claude started from a team member's terminal is outside
  the check; a fix is planned.

### 0.0.10 (2026-09-29)
- Closing time shows who is still working: every team member and Michael, confirmed, still
  working, waiting at a prompt or nothing to do, with what each is doing and for how long.
- Remind sends one agent the closing steps again; Close without them stops waiting for one team
  member. Nothing is stopped, and a row goes when that agent's terminal ends.

### 0.0.9 (2026-09-28)
- No app changes. The old project's website files, promo media and 42 of its blog posts left the
  repo; the release drops, message queue and company knowledge docs match the app again.

### 0.0.8 (2026-09-27)
- New hire wizard: Who, Job, Role, Finalize. Jobs come from a teammate, your business pack, any
  other business, or a new one; lists open on the character's own kind of job.
- Distinct job check against every teammate (by what they handle, never the title); an overlap
  must be bound to its own mailbox or topic, and the teammate's line hands that work over.
- Work style in plain words, turned into instructions when you hire or save (Edit Agent too).
- Own folder per hire (Admin_Erin when Admin is taken); model picked from a list that starts on
  your default; developer options hidden; explanations behind info icons.
- Only Michael assigns work; the asker is told; a runaway message tells Michael.
- Michael decides schedule requests and escalates only what he can't settle, or anything left
  undecided for 12 hours. Each request says why; two about the same job become one.
- One agent per mailbox, with a confirm before moving one.
- Several "when" lines per schedule; a day an "every" line runs on belongs to it alone; 4h added.
- Erin joins the cast; character tiles grouped by job; Sadiq and Darryl redrawn; break room lines
  for every character; "clocking in…" and "nothing to do" in the office; the memory graph shows
  each agent's character.
- Fixed: one agent's memory tidy could read another agent's answer; the hire dialog closing by
  accident.

### 0.0.7 (2026-09-26)
- A mailbox for each agent (Gmail, Google Workspace, iCloud, Yahoo, Zoho, IMAP), tested and kept
  in the keychain; Can send or Draft only.
- Capabilities tab on every agent: email and schedules in one place.
- The office opens again after closing time; a missed job runs once, not once per missed hour.
- Michael's Office schedule lists every job that is on. Sections start closed. Settings simpler.
- The Email and Calendar switch now really blocks those tools.

### 0.0.6 (2026-09-26)
- Setup fills in your legal name and marks every required field.
- Reset and Restart fixes.

### 0.0.5 (2026-09-25)
- Every agent has its own schedules; agents ask for changes instead of making them.
- Profile tab first on every agent: the job, what it does, what it asks first, its folder and
  instructions. Memory tab that reads like notes.
- You talk to team members through Michael, or 1:1. Only Michael notifies you.
- Messages tab as a day by day history.

### 0.0.4 (2026-09-25)
- Names change only in Edit Agent and reach the whole team; duplicates refused.
- The new brand: Don't Be Michael lockup and the Struck M icon.

### 0.0.3 (2026-09-25)
- Private folders, enforced by the sandbox and the app. Michael works in the business folder.
- Company profile and company knowledge (searchable by meaning with MemPalace).
- Memory that improves: short notes, a background tidy up, procedures for repeated jobs.
- A fresh start for idle team members after a written handoff; the old conversation can come back.
- Schedules name the job, not a prompt. Ask me answers go back to whoever asked and are remembered.
- House rules for every agent. New instructions for Michael and the team from each business pack.
- Plainer app messages; notifications name the person; developer surfaces removed.

### 0.0.2 (2026-09-24)
- The app keeps its settings in its own folder and carries its own name and copyright.

### 0.0.1 (2026-09-24)
- First release: set up by kind of business with Office Packs, a folder for every team member,
  real documents in Memory & Knowledge, Office, Tasks and Graph views, Michael asking when no one
  fits, and a floor built for owners in English, Chinese and Arabic.

## Send on approval (2026-10-05)

- A third Sending choice on a team member's Access tab, Send on approval: each email waits on Ask me with From, To, Subject and Message. Edit it, then Approve, Ask for changes with a note, or Don't send; the team member sends exactly the version you approved, which the app keeps.
- New team members start on Draft only. Work styles follow the Sending setting instead of saying team members never send.
- When you keep approving the same kind of email unchanged, the team member can offer to send that kind without asking. Tick the offer on the card (you can narrow its words first); it shows under Sends without asking on the Access tab, with Revoke. A separate quick check reads each such email, and for a reply the message it answers, before it goes; anything that doesn't fit, or that it can't read in full, comes to you.
- An approved email goes out once, even if two sends overlap or the app stops mid send, and one withdrawn while it is being prepared stops before it leaves.

## Michael answers in the app (2026-10-06)

- Every question you send Michael from the Talk to Michael box is tracked: it goes to him like an Ask me answer, typed with its own id when he is free, and he answers it in a conversation that opens above the box. Your message shows Sent, Michael has it, Waiting on someone, Later than he said (with Nudge), Waiting for you, Answered or Couldn't finish.
- His answer comes first, files as rows to open; long answers fold to four lines with More. One count on the box: indigo for new replies, coral while he waits on you. One desktop notification per final answer or question, never for "still working on it".
- Commands such as /clear and /compact still go straight to his terminal.
- Scheduled outcomes, such as the weekly money summary, arrive on Ask me as quiet Report cards you clear with Got it; they never turn Needs you coral.

## Send only from another team member's mailbox (2026-10-07)

- A team member's Email section is now the list of addresses it uses. Each shows who watches its inbox and how email from it leaves. Add a mailbox asks Watch the inbox (one each) or Send only (one each), and greys a choice it can't make, with the reason.
- Send only lets a team member send from a mailbox another team member watches, with its own Can send, Send on approval or Draft only (Draft only first).
- A Send only team member can draft, propose and send from that address, and can't read, search, file, forward or attach from it. Its follow ups stay in the same thread, built from its own sent emails only.
- While nobody on the team watches that mailbox, the team member's email from there waits, the tab says Paused, and Michael hears once.
- The mailbox's own team member and Settings, Mailboxes show who else sends from it. Removing the access withdraws its waiting emails and its standing approvals there.
- Michael's team list says who may send from which address, so outreach goes to the right team member.
- Approval cards say when an email forwards a message or attaches files, and an approved email can no longer forward mail from another mailbox.

## Get Michael ready (2026-10-07)

- Setup ends on a Ready step when Michael runs on Claude: a missing Claude Code installs with Claude's own installer, with no password, and Sign in opens the browser and notices when you are done. A new owner whose computer had no Claude Code is no longer left on a silent office.
- No Claude plan? Use an API key beside Sign in. The key is checked with Anthropic and kept on this computer, and every Claude start uses it.
- Set up later opens the office anyway, and Ask me keeps a "Michael can't start yet" card that opens the same step ("Some of your team can't start yet" when only team members on Claude are stuck).
- Once Claude is ready, however it got ready, the team members that could not start begin on their own; members already at work keep going.
- Claude Code is found where its Windows installer puts it, the key check follows your network's proxy, and a sign in that can't be read says so instead of showing a green check.
- Setup screens center the card until your office picture appears, then the card glides aside to make room for it.
