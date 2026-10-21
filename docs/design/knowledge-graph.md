# Company knowledge (the `kg` store)

**Config:** `knowledgeGraph` (`{ enabled?, rootPath? }`). **Always on, with no switch**, since
2026-10-19 (owner). `enabled` is no longer read, except that an owner who had set it to false gets
one Needs you card saying company knowledge is always on now, once the store holds a document of
theirs (`kg:notice`, `knowledgeOnNoticeSeen`).
**Code:** `src/main/kg-core.cjs` (store, shared by everything), `resources/kg.cjs` (agent CLI),
`src/main/knowledge.ts` (`KnowledgeManager`), `src/main/docText.ts` (file to text),
`src/main/knowledgeEdits.ts` (documents opened from Settings, read in again on save),
`src/main/memory.ts` (search by meaning), `companyKnowledgeLine` in `src/main/hive.ts` (what agents are told),
`src/renderer/src/components/KnowledgeDocList.tsx` (the list in Settings).
**Tests:** `test/kg-core.test.cjs`, `test/doc-text.test.cjs`, `test/knowledge-docs.test.cjs`,
`test/knowledge-live.test.cjs`, `test/knowledge-meaning.test.cjs`.

> **Naming.** This is not `MEMORY_GRAPH_SPEC.md`, which is the message graph view. This is
> the company knowledge store: documents the owner adds (policies, rules, prices, locations,
> how the business works) that every agent, Michael included, searches before relying on
> memory or the internet. Config key `knowledgeGraph`, manager `KnowledgeManager`, CLI `kg`.

---

## 1. Shape

1. **Ingest (in app).** The owner adds files in Settings. Main converts each one to text
   (`docText.ts`), chunks it and writes it to a local, file backed store (`kg-core.cjs`).
2. **Retrieve (agents).** Agents search it two ways from their shell:
   - **exact words:** `node kg.cjs search "<words>"`, keyword scoring over the store;
   - **by meaning:** MemPalace, `search "<question>" --wing company`, when MemPalace is installed.
     It finds passages that say the same thing in other words, and each hit carries the document id.

Agents only read the store. The owner adds documents, and can edit one by opening it from
Settings (section 6). The app keeps one document of its own there: the Company foundations copy
(tag `foundations`, docs/designs/office-foundations.md), replaced whenever its record changes.

---

## 2. Why these choices

### 2.1 Access: a CLI run from the shell, not MCP, not a skill

- **Works for every engine.** Claude, Codex, Gemini, Crush and the rest all have a shell, so
  one prompt line covers all of them with no per engine setup. This is the same pattern as
  MemPalace and `md-slack-reply.cjs`.
- **MCP was rejected** because it means writing a server entry into every agent's settings,
  running a transport, and it only reaches engines that speak MCP. It could sit behind the same
  store later without changing what agents are told.
- **A skill file** would just be documentation pointing at the CLI, and only Claude reads skills.

### 2.2 Store: plain files, not SQLite

The CLI runs out of process under plain `node`. `better-sqlite3` is a native module rebuilt for
Electron's ABI, so a plain `node` loading it fails on user machines. A store the CLI reads with
only `node:fs` avoids that entirely, and matches how agents already read `memory.md`,
`tasks.json` and inboxes as plain files. The app reads the same files over IPC.

### 2.3 Search: keyword in the store, meaning through MemPalace

Keyword scoring needs no dependencies, is deterministic and easy to test, and works well when
people search with their own documents' words. Search by meaning reuses MemPalace, the local
vector store the app already ran for agents' memory, instead of adding a second embedder.
Since 2026-10-16 the palace holds company knowledge only: each agent's memory is private to it
and is never mined (`src/main/memory.ts`).
The agent contract (`search`, `list`, `get`) stays the same whichever index answers it.

---

## 3. On disk

The store root is `<userData>/knowledge` unless `knowledgeGraph.rootPath` overrides it.

```
<root>/
  index.jsonl            # the keyword index: one JSON line per chunk
  docs/
    <docId>/
      meta.json          # document metadata
      original.<ext>     # the file as added, kept byte for byte
      text.md            # the full extracted text (what `kg get` prints)
  meaning/
    <docId>.md           # mirror for MemPalace: "Title:" and "Document id:" on top, then the text
```

- `index.jsonl` is rebuildable from `docs/*/text.md` and `meta.json`. Removing a document
  deletes its folder and filters its lines out of the index.
- `meaning/` is kept in step by `KnowledgeManager.meaningMirror()`: missing and edited files
  written, removed documents' files deleted. `MemoryManager` indexes it into the palace's
  `company` wing, again only when a document is added, removed or edited (a signature of each
  id with its added or edited time).
- Changing the search language in Settings clears the palace, and company knowledge is indexed
  again with the new model (`MemoryManager.modelChanged`).

**Chunk record** (one line of `index.jsonl`):

```jsonc
{ "docId": "k7f3…", "title": "Refund Policy", "source": "refund-policy.docx",
  "modality": "doc", "chunkIdx": 0, "text": "Customers may request a full refund within 30 days…" }
```

**Document metadata** (`meta.json`): `id`, `title`, `source`, `modality`, `mime`, `origExt`,
`bytes`, `tags`, `caption`, `chunkCount`, `addedAt`, `extractor` (which reader produced
`text.md`, for provenance), `truncated`, and `updatedAt` once an edit the owner saved was read in.

Document ids are generated by the app, never taken from a file name, so a hostile file name
cannot write outside the store.

---

## 4. Ingest: file to text

`KnowledgeManager.ingestFile` runs `extractDocumentText` first. A file it cannot read is
**refused with a plain reason**, never stored as junk (that is how a `.docx` once got indexed
as zip bytes and reported success).

| Kind | How it becomes text | `extractor` |
|---|---|---|
| Word, PowerPoint, Excel (`.docx`, `.pptx`, `.xlsx` and relatives) | read the XML inside the zip | `docx-xml@1`, `pptx-xml@1`, `xlsx-xml@1` |
| PDF with a text layer | bundled PDF.js, no `pdftotext` needed | `pdfjs@1` |
| Scanned PDF | macOS Vision OCR, first 50 pages (`MAX_OCR_PAGES`), with a note when cut short | `vision-ocr@1` |
| Images | macOS Vision OCR; with no text found (or off macOS), kept and searchable by title, caption, tags and file name | `vision-ocr@1`, else `image-meta@1` |
| `.doc`, `.rtf`, `.odt`, `.webarchive` | macOS `textutil` (Mac only; elsewhere the owner is asked to save as .docx or PDF) | |
| Plain text, markdown, code, CSV, JSON and the like | read as UTF-8 by `kg-core` | |
| Old `.xls` and similar | refused with advice on what to save it as | |

Then `kg-core` copies the original, writes `text.md`, splits the text into about 1,200
character chunks on paragraph and line boundaries (150 characters of overlap), and appends
one index line per chunk.

**Size limits:** files over 100 MB are refused. Text past 5 MB per document is left out of the
index and the document is marked `truncated`.

---

## 5. Agents

### 5.1 The CLI

```
kg search "<words>" [--limit N] [--json] [--root <dir>]   ranked passages (default 8)
kg list   [--json] [--root <dir>]                         every document: title, kind, id, tags
kg get <docId> [--json] [--root <dir>]                    one document's full text
kg stats  [--json] [--root <dir>]                         document and chunk counts
```

The store comes from `--root`, else `KG_ROOT`. `kg-core.cjs` is found through `KG_CORE`, then
beside the CLI (packaged), then the repo layout (dev). With no store configured it prints one
line and exits 0.

**Scoring (`scoreChunk`):** the query is lowercased and tokenized, stop words dropped. For each
query term found in a chunk, add `1 + ln(1 + count)`; add 2 when the term is in the title; add
0.5 per distinct term matched; add 5 when the whole query appears as written. Results come back
highest first with a snippet around the first hit. The app's own search calls the same code, so
results match what agents see.

### 5.2 What agents are told

`companyKnowledgeLine` adds one `COMPANY KNOWLEDGE:` paragraph to the injected system prompt
once the store holds a document (`KnowledgeManager.hasDocuments`), so nobody spends a step
searching an empty store. It tells the agent to search the store before relying on memory or
the internet, and to follow what it says. It gives:

- the exact words search, `list` and `get` commands, with **absolute paths** to Node, the CLI and
  `--root`. Environment variables are not used in the prompt, because `$KG_CLI` expands to
  nothing under Windows `cmd.exe`, and bare `node` may not be on the agent's PATH;
- the search by meaning command, with the search language's model and absolute paths to
  MemPalace and the palace, when MemPalace is installed.

The same absolute paths also go into the spawn environment (`KG_ROOT`, `KG_CLI`, `KG_CORE`) of
every member but Research, for anything that wants them.

### 5.3 Telling agents that are already running

A change reaches running agents without a restart. `HiveManager.knowledgeUpdate` remembers
what each agent was last told: whether the store holds a document, and how it searches by
meaning (MemPalace, the palace and the model). On the agent's next `SessionStart` or
`UserPromptSubmit` hook, a change adds the new `COMPANY KNOWLEDGE` paragraph, or
`COMPANY_KNOWLEDGE_OFF` once the store is empty, as hook context (`src/main/hooks.ts`). So the
first document, an empty store, MemPalace being installed and a new search language all reach
running agents. That is why the CLI takes `--root`: the paragraph names the store's folder
itself. Adding, removing or editing a document, or moving the store (`rootPath`), also
re-indexes the `company` wing right away (`memory.companyKnowledgeChanged`).

---

## 6. In the app

- **Settings** (Memory & Knowledge, Company knowledge): no switch. The document count and an
  "Add files" button (OS file picker); each file reports whether it was added or why not. Then
  the Documents list: each document's title, its file, when it was added or updated, and Open.
  Under it, search by meaning: whether it is ready (Ready, Getting ready, or Not set up with a
  way to Prerequisites) and the search language (Fast or Multilingual). There is no separate
  Semantic memory section (branding/DESIGN.md 7.26).
- **Open and read in again** (`src/main/knowledgeEdits.ts`): Open opens the store's copy of a
  document type (`OPEN_EXTENSIONS`) in the owner's own app and watches it. A save with new
  content is read in again after 3 s of quiet (Word, Excel, PowerPoint and PDF converted as at
  ingest, then `kg-core` `reindex`), and the window says it was read in, or why it could not be.
  At most 25 documents are watched at once. The Company foundations copy, and anything that is
  not a document type, opens as a read only text copy in a fresh temp folder
  (`company-knowledge-*`), never watched; those copies are removed at launch and at quit. Open
  never runs a file.
- **IPC** (`src/main/index.ts`): `kg:status`, `kg:list`, `kg:search`, `kg:get`, `kg:remove`,
  `kg:ingestFiles`, `kg:addFiles`, `kg:open`, `kg:notice`, `kg:noticeSeen`, exposed on
  `window.cth` as `kgStatus`, `kgList` and so on, and the `kg:changed` event (`onKgChanged`).

---

## 7. Safety

- **Local only.** The store lives under `userData`; nothing is uploaded. OCR is the macOS
  Vision framework on the machine.
- **Read only for agents.** The CLI has no write commands.
- **No secrets.** The store needs no tokens and the CLI needs no auth.
- **Paths.** Ids are app generated; originals are copied into `docs/<docId>/`.
- **When empty:** no prompt paragraph, and running agents are told the store is empty. Research
  never gets the paragraph or the environment variables.

---

## 8. Not built yet

- Removing a document from Settings: `kg:remove` exists, but the list offers only Open.
- Editing the Company foundations document in place: it opens read only, and the owner's form
  comes in a later release (docs/designs/office-foundations.md).
- OCR off macOS (images and scans are metadata only there).
- Typed relations between documents (the "graph" part of the name): `tags`, `source` and
  `modality` are the edges it would start from.
