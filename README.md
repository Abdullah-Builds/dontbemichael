<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./branding/logo/lockup/dbm-lockup-horizontal-dark.svg">
  <img src="./branding/logo/lockup/dbm-lockup-horizontal-light.svg" alt="Don't Be Michael" width="420">
</picture>

### An AI office for your small business

**[dontbemichael.com](https://dontbemichael.com)**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./branding/reference/studio/home-dark.png">
  <img src="./branding/reference/studio/home-light.png" alt="The office: a pod for each department around Michael's glass office, and the Needs you board on the right with what waits on you" width="1240">
</picture>

Pick your kind of business and choose your team. Michael, your office manager, runs the office
while you run the business.

Every team member is an AI agent with a clear job, its own folder, and its own memory. Everything
runs on your computer.

<p>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-FF6B6B.svg?style=flat-square&labelColor=1A1320"></a>
  <img alt="Status: early release" src="https://img.shields.io/badge/status-early%20release-FFFDF5.svg?style=flat-square&labelColor=1A1320">
  <img alt="Platform: macOS and Windows 11" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%2011-FFFDF5.svg?style=flat-square&labelColor=1A1320">
  <a href="https://dontbemichael.com"><img alt="Website: dontbemichael.com" src="https://img.shields.io/badge/web-dontbemichael.com-FF6B6B.svg?style=flat-square&labelColor=1A1320"></a>
</p>

<br>

**[Download for Mac](https://github.com/agentvivekkumar/dontbemichael/releases/latest)** · **[Download for Windows](https://github.com/agentvivekkumar/dontbemichael/releases/latest)**

</div>

---

> [!NOTE]
> **Talk to Michael. Let the office do the rest.**
> Tell Michael what you need. He hands the work to whoever's job it is, keeps the team moving, and
> brings you only the calls that need you.

> [!TIP]
> **New in 0.2.4: Company foundations, and company knowledge you can open.**
> One document holds what each job needs to know about your business; when work needs an empty
> answer, a card asks you once. Settings lists every document your team searches, and you can open
> and edit one in your own app. In 0.2.3, the office clocks in and Waiting cards come back.

## Contents

- [What it is](#what-it-is)
- [Your team](#your-team)
- [A mailbox for every job](#a-mailbox-for-every-job)
- [What the office does](#what-the-office-does)
- [Getting started](#getting-started)
- [Your data](#your-data)
- [For developers](#for-developers)
- [Contributing](#contributing)
- [Where it came from](#where-it-came-from)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## What it is

Don't Be Michael is a desktop app that runs a small office of AI team members for your business.

Each team member is a [Claude Code](https://claude.com/claude-code) agent with a specific role
(finance, customer support, sales, marketing, and more). Michael is the office manager. You talk
to him. He routes the work, answers the team's questions, and only brings you the decisions that
need your attention.

Everything runs on your computer, on the Claude plan you already have. Each team member has a
desk in an office you can watch, with a pod for each department around Michael's glass office, so
you can see who is working on what.

## Your team

During setup, you tell the app your business name and the kind of business you run. It then
suggests a starting team from that business type's Office Pack. You choose who joins, and you can
hire more team members later.

| Kind of business | Suggested team |
|---|---|
| Restaurant & Food | Finance, Executive Admin, Customer Support, Marketing, Quality Control, Supply Chain, HR Manager |
| Retail Shop | Finance, Executive Admin, Customer Support, Inventory & Shipping, Marketing, Supply Chain, Sales Director |
| Pro Services | Finance, Executive Admin, Customer Support, Sales Director, Marketing, IT Security |
| Home Services | Finance, Executive Admin, Customer Support, Sales Director, Inventory & Shipping, Supply Chain, Marketing |
| SaaS/Consulting | Finance, Executive Admin, HR Manager, Customer Support, Sales Director, Marketing, IT Engineer, IT Security |
| Something else | Pick from the core roles |

Each role comes with a Role description, which tells Michael what work to send there, and a Work
style, which tells the team member how to do its job at your business. You can change both in
Edit Agent.

## A mailbox for every job

Most AI assistants read one inbox: yours. Don't Be Michael connects as many mailboxes as your
business runs on, and each team member works from the one that matches its job.

| Team member | Watches | Can it send? |
|---|---|---|
| Pam, Executive Admin | ceo@yourbusiness.com | Send on approval: you approve each email in Needs you, then Pam sends it |
| Kelly, Customer Support | support@yourbusiness.com | Can send |
| Dwight, Sales Director | sales@yourbusiness.com | Can send |

- **Connect once.** In Settings, Connections, Mailboxes, add Gmail, Google Workspace, iCloud,
  Yahoo, Zoho or any other IMAP mailbox with an app password. The login is tested before it is
  saved, and the password stays encrypted on your computer, never in a file an agent can read.
- **Hand it out per team member.** On a team member's Access tab, under Email, choose **Add a
  mailbox**, pick it, choose **Watch the inbox**, and set **Can send**, **Send on approval** or **Draft only**. Nobody gets a mailbox until you give it one,
  and each mailbox is watched by one team member: moving it to another asks you first.
- **Let another team member send from it.** Add a mailbox someone else watches and choose
  **Send only**, with its own Can send, Send on approval or Draft only.
  Sales can send outreach from the CEO's address without reading the CEO's inbox: replies land
  with the mailbox's own team member, who passes them on. The mailbox shows who else sends from it.
- **You choose how mail leaves.** Can send goes out at once. Send on approval puts each email on
  Needs you, where you can edit it, approve it, ask for changes or stop it; the team member sends
  what you approved and learns from your edits. Draft only saves replies in the mailbox's Drafts
  for you to send.
- **Approve a kind of email once.** When you keep approving the same kind of email unchanged, the
  team member can offer to send that kind without asking. Tick the offer on the card, and it shows
  under Sends without asking on its Access tab, with Revoke. A separate quick check reads each such
  email first, and anything that doesn't fit comes to you.
- **Each one stays in its lane.** A team member reads, searches, files (archive, mark read, mark
  junk), drafts and sends only as you allowed, in the mailbox you gave it, and cannot forward or
  attach mail from another one. Nothing it does deletes mail.
- **Put it on a clock.** Add a schedule like "Check the support inbox" every hour in the same tab,
  with a focus area for each run, and the team member sorts new mail, answers it as its Sending
  setting allows and tells Michael what needs you. A new Executive Admin arrives with an Inbox to zero job already set.
- **You hear when it breaks.** If a provider stops accepting the password, the mailbox shows
  "needs you" and Michael asks you to fix it once, on the Needs you board.

Outlook and Microsoft 365 are not supported yet. The Gmail and Calendar connected to your Claude
account are separate: they are listed under Claude connectors in Settings, off until you turn them
on and give them to a team member.

## What the office does

<table>
<tr>
<td width="50%" valign="middle">

### Talk to Michael, not the whole team

Michael is the one you talk to. He sends each job to the team member whose role fits, keeps an eye
on the task board, and brings you only what needs you. He is the only one who hands out work: when
one team member needs another to do something, the request goes to Michael and he decides who
does it. Team members can still ask each other questions directly. When you answer a question, the
answer becomes his work until he routes it and closes it. Once an hour he runs a standup with the
team. He is the only one who sends you desktop notifications. To speak with one team member
directly, open it and choose **Talk 1:1**; Michael sends it no work until you end the 1:1.

</td>
<td width="50%">
  <img src="./branding/reference/studio/michael-office-schedule.png" alt="Michael selected: his card in the office and his Office schedule, every job on a clock across the team" width="100%">
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Hire a team member

The hire wizard has four steps: Who, Job, Role and Finalize. Pick a character and it brings a
job: one a teammate does today, one from your Office Pack, one from any other kind of business, or
a new one you write. Before you hire, the app checks the new job against every teammate's so no
two do the same work; an overlap has to be tied to its own mailbox or topic first. The work style
is plain words you can edit. Each hire gets its own folder inside your business folder and starts
working. To let someone go, Delete in the Danger zone of Edit agent removes them for good, and
Michael hands on their open work.

</td>
<td width="50%">
  <img src="./branding/reference/studio/hire.png" alt="The hire wizard: pick a character, then their job, role and work style" width="100%">
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Memory that improves

Each team member keeps a short list of lasting notes: your preferences and corrections, facts it
looked up, where things live, and the steps for tasks it does again. A tidy up in the background
merges and updates them, so memory gets better instead of piling up.

</td>
<td width="50%">
  <img src="./branding/reference/studio/kelly-memory.png" alt="Kelly's Memory tab: her preferences, facts, where things live and the steps she knows" width="100%">
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### You stay in charge

Spending money, deleting things and changes of scope come to you. A team member that loops or
keeps failing is steered, then held, then stopped, and one stuck on a prompt is restarted by the
app instead of handed to you. Each one works under house rules: state only
what it can trace to a source, say when it doesn't know, and never make up people, customers or
quotes.

</td>
<td width="50%">
  <img src="./branding/reference/studio/settings-autonomy.png" alt="Settings, Agents: the default model, approvals and the circuit breaker" width="100%">
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Watch the office work

Desks light up as team members clock in and go dark at closing time. Envelopes fly between pods
as work moves, Michael points before he hands a job out, scheduled jobs ring his wall clock, and
idle teammates trade lines across the office. A plate in front of each pod names its department,
and the monitors are clear glass that tint while someone works. Click any pod to see that team
member's work live.

</td>
<td width="50%">
  <img src="./branding/reference/studio/kelly-work.png" alt="Kelly selected: her pod in the office and her Work tab, her session live" width="100%">
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Set up once

Setup asks for your business name, your kind of business, the owner and your headquarters
address. Contact details, hours and prices are optional and can wait for Settings. Michael then
shows you around the office and suggests a starter team: you pick who joins and where each one
works. The last step, Get Michael ready, installs Claude Code if your computer doesn't have it
and signs you in where you can see it, or takes an Anthropic API key instead.

</td>
<td width="50%">
  <img src="./branding/reference/studio/onboarding-business.png" alt="Setup step 1: your business name, kind of business, owner and headquarters address" width="100%">
</td>
</tr>
<tr>
<td width="50%">
  <img src="./branding/reference/studio/onboarding-meet.png" alt="Setup step 3: Michael explains the starter team, how he runs the office, memory and approvals" width="100%">
</td>
<td width="50%">
  <img src="./branding/reference/studio/onboarding-team.png" alt="Setup step 4: pick your starter team; the office fills with a pod for each person picked" width="100%">
</td>
</tr>
</table>

**Running the office**
- **Needs you.** When the team needs a decision, Michael puts it on the Needs you board. Your answer goes back to whoever asked, and they remember it. Michael gets it too, as work he routes and then closes. Choices show as rows you pick with a click, and several questions get a line each; answer only some, and the rest go back to whoever asked.
- **Michael answers in the app.** A question you type in the Talk to Michael box opens a conversation above it. Each question shows where it stands, such as Michael has it, Waiting for you or Answered, and his reply arrives under it, with one count on the box and one notification per answer. Commands such as /clear still go straight to his terminal. Scheduled outcomes, such as a weekly summary, arrive on Needs you as quiet Report cards you clear with Got it.
- **Schedules.** Each team member's jobs on a clock live in the On a schedule section of its Access tab. Say when and which job ("Follow up on unpaid invoices", every weekday at 9), and the team member does it the way its Work style says. One job can have several "when" lines, like every 2 hours on weekdays plus 2 pm on weekends. A team member can ask for a schedule change; Michael decides it, and asks you on Needs you only when he can't settle it. Michael's Office schedule tab lists every job that is on.
- **A mailbox for each team member.** Connect Gmail, Google Workspace, iCloud, Yahoo, Zoho or any other IMAP mailbox with an app password in Settings, Connections, Mailboxes. The password is tested before it is saved and stays encrypted on your computer. Then add it on a team member's Access tab to watch its inbox, and choose Can send, Send on approval or Draft only. Each mailbox has one team member watching it; others can be added to send only from it. Outlook is not supported yet.
- **Claude connectors.** Settings, Connections, Claude connectors lists every connector on your Claude account (HubSpot, Google Drive, Gmail, QuickBooks and the rest), read from Claude by itself. Each is off until you turn it on; then give it to the team members who need it on their Access tab. QuickBooks keeps Read only or Can make changes, and Oscar starts on and Read only. Your own Claude Code servers, plugin servers included, never reach the team.
- **Every team member's panel.** Profile first (the job, its folder and the instructions it works from), then Access (email, Claude connectors, and schedules), Messages as a day by day history, Memory as readable notes, and Work, its session live.
- **Office, Tasks, Pulse, Who talks to whom.** Tabs in the top bar switch between the office, the whole task board, Pulse (what the office got done and what each team member costs, with ways to save that change nothing until you click Apply), and who talks to whom. A file Michael names shows as a chip; open it, and Markdown, text, JSON, CSV and pictures get a tab of their own beside these, while PDF and Office files open in their own app.
- **Webhooks.** Another app sends a webhook (set it up in Settings, Connections) and Michael picks it up; the sender can check on the work and get its result.
- **A fresh start without losing work.** A team member that has sat idle with a long conversation writes a handoff of anything unfinished, then starts fresh. You can bring the old conversation back.

**Your business, known to everyone**
- **Company profile.** Your business name, owner, address, hours, time zone, currency and more, given to every team member. Change it in Settings.
- **Company knowledge.** Add your documents and policies in Memory & Knowledge: Word, Excel, PowerPoint, PDF, and scans or photos (on a Mac or a Windows PC). Every team member can search them by words, and by meaning when MemPalace is installed, so "money back" finds your refund policy. Open one to read or change it in your own app; when you save, the team searches the new version.
- **Company foundations.** One document of what each job needs to know about your business, such as who you sell to or your financial year. When a team member's work needs an answer that is still empty, Michael asks you for it on Needs you, weekly until it is answered, and what you teach the team fills it in too.

**Private folders**
- Michael works in your business folder, and each team member works in its own folder inside it.
- A team member opens only its own folder. Michael can read his team's folders but not change them. On a Mac, Claude Code's sandbox and the app both enforce this. On Windows, the app checks Claude's file tools, but shell commands are not limited yet.

**Also**
- **Updates.** The app tells you when a new version is out and links to the download.
- **Claude Code updates.** When Claude Code updates itself, team members already running stay on the old version until they restart. A "team upgrade ready" chip and note offer to close the office the safe way (everyone saves first) and reopen on the new version. Nothing restarts until you click.

<div align="right">(<a href="#what-it-is">↑ back to top</a>)</div>

## Getting started

### What you need

- A Mac with Apple Silicon or Intel, or a Windows 11 PC (x64).
- [Claude Code](https://claude.com/claude-code), signed in to your Claude plan. A Claude Max plan
  keeps the office running all day; smaller plans reach their usage limit during the day, and the
  office takes a break until it resets, while scheduled jobs still go out on time and wait in the
  inbox. No Claude plan? An Anthropic API key works too, billed to your
  Anthropic account. You don't need to install anything first: setup ends on **Get Michael
  ready**, which installs Claude Code and signs you in. Skip it, and Needs you keeps a card that
  opens the same step until Michael can start.

### Install

**On a Mac**

1. Download the `.dmg` from the [latest release](https://github.com/agentvivekkumar/dontbemichael/releases/latest).
2. Open it and drag **Don't Be Michael** into your Applications folder.
3. Open it from Applications. The first time, macOS says it could not verify the app. Click
   **Done**, then open **System Settings → Privacy & Security**, scroll to the message about Don't
   Be Michael and click **Open Anyway**.

You only do step 3 once. macOS asks because this early build is not yet signed with an Apple
Developer ID. Setup takes it from there.

**On Windows 11**

1. Download the file ending in `-win-x64-setup.exe` from the same [latest release](https://github.com/agentvivekkumar/dontbemichael/releases/latest).
2. Open it. The first time, Windows says **Windows protected your PC**. Click **More info**, then
   **Run anyway**.

You only do step 2 once. Windows asks because this build is not yet signed with a Microsoft
certificate. It runs on Windows 11 PCs with x64 processors; ARM PCs aren't supported. Linux will
follow.

## Your data

- **It stays on your computer.** Your team's work, memory and files live in folders on your
  computer. The team members themselves run through your own Claude Code and Claude plan, or
  your Anthropic API key.
- **Only the Research team member goes online.** In every office, one team member, Pete unless
  you rename them, does the web research. Nobody else, Michael included, opens web pages, searches
  the web or reaches the internet from a command (on a Mac). Every message to them first passes a
  trust layer that keeps out the kinds of data you mark private in Settings, Research & privacy,
  and their answers are cleaned of instructions before your team reads them. They see none of your
  files, and they are off until you turn them on. On Windows, they can still reach your office files.
- **No usage data.** The app sends nothing about how you use it. See [`TELEMETRY.md`](./TELEMETRY.md).

## For developers

Don't Be Michael is an Electron app (React, TypeScript, xterm.js, node-pty). Each team
member is a real Claude Code process in its own terminal. The team coordinates through the hive,
a folder of plain files with a mailbox, memory and a task board per agent; only the app commits to
it.

### Build from source

You need Node.js 20 or newer, npm, and a C/C++ toolchain for `node-pty` (on a Mac:
`xcode-select --install`; on Windows, [`node-pty`'s prerequisites](https://github.com/microsoft/node-pty#dependencies)).

```bash
git clone https://github.com/agentvivekkumar/dontbemichael.git
cd dontbemichael
npm install        # also rebuilds node-pty for Electron
npm run dev        # the app with hot reload
```

```bash
npm run typecheck     # main, preload and renderer
npm run test:focused  # the node:test suite in test/
npm run build         # production build
npm run dist:mac      # the Mac installer, in dist/
npm run dist:win      # the Windows installer, in dist/
```

If `node-pty` fails to load after an Electron upgrade, run `npm install` again.

### Where to read next

- [`docs/FEATURES.md`](./docs/FEATURES.md): every feature, and every change release by release.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): diagrams and the module map.
- [`HIVE.md`](./HIVE.md): how agents coordinate.
- [`SPEC.md`](./SPEC.md): the original spec. Its terminal and event planes still hold; the pixel canvas and command bar it describes were replaced by the Studio.
- [`branding/DESIGN.md`](./branding/DESIGN.md): the design system, for any new UI.

### What this build leaves out

Setup offers only Claude Code, signed in with a Claude account or an Anthropic API key. The code
still carries presets for other agent CLIs (Codex, Gemini, Antigravity, Grok, Kimi, Qwen, OpenCode, Crush, pi,
Copilot and Cursor), API keys for other providers and local models,
but this build doesn't offer them. Some developer features are switched off because business
owners don't use them: git views, the built in code editor, temporary helper agents, voice, and
opening a Terminal in an agent's folder. Each one has a switch in
[`src/shared/buildFeatures.ts`](./src/shared/buildFeatures.ts).

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md). Found a bug or have an
idea? [Open an issue](https://github.com/agentvivekkumar/dontbemichael/issues).
[`CONTRIBUTORS.md`](./CONTRIBUTORS.md) lists everyone with a merged pull request. Changes are in
[`CHANGELOG.md`](./CHANGELOG.md).

## Where it came from

Don't Be Michael started as a fork of [Munder Difflin](https://github.com/chaitanyagiri/munder-difflin),
an agent harness for developers by Chaitanya Giri. It has since grown into its own project, built
for business owners rather than developers, and is developed independently.

## License

The **source code** is licensed under the **MIT License**. See [`LICENSE`](./LICENSE). The original
copyright notice of Munder Difflin, the project this grew out of, is kept in `LICENSE`, as the
MIT license requires.

*Don't Be Michael* is not affiliated with NBC, *The Office*, or Dunder Mifflin.

## Acknowledgements

- [Munder Difflin](https://github.com/chaitanyagiri/munder-difflin) by Chaitanya Giri and its contributors, the open-source project this product grew out of.
- [xterm.js](https://xtermjs.org/) · [node-pty](https://github.com/microsoft/node-pty) · [electron-vite](https://electron-vite.org/) · [CodeMirror](https://codemirror.net/) for the libraries this is built on.
