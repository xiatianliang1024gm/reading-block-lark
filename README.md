# Reading Block (Lark version)

[English](README.md) | [简体中文](README.zh-CN.md)

**Save articles with one click. Every five saves, your browser books you a quiet
30-minute reading block on your Feishu (Lark) calendar so you actually read
them.**

📺 [Watch the demo video (2 minutes)](https://www.youtube.com/watch?v=Q8g1hod552g)

Reading Block is a Chrome extension for people who save a lot of "I'll read this
later" links and never get back to them. Instead of another list that grows
forever, it turns your saved reading into real appointments with yourself.

> This is the **Feishu (Lark)** edition. It books blocks on your Feishu calendar
> through a tiny helper that runs on your own Mac and uses `lark-cli`. If you
> prefer Google Calendar, check out the
> [Google Calendar version](https://github.com/zarazhangrui/reading-block).

---

## Why use it

We all collect links. Long articles, essays, videos, threads. They pile up in
tabs and bookmarks and read-it-later apps, and "later" never comes, because
nothing ever puts that reading on your actual schedule.

Reading Block fixes the missing step: it books the time. Save five things, and it
finds a free slot on a day and time you choose (say, weekday afternoons) and puts
a 30-minute **Reading Block** on your calendar with those five links in the
event. When the block ends, it asks what you finished, and quietly rolls anything
you didn't into your next session.

It's simple on purpose. No account to create, no app to open, no list to manage.

---

## What it does

- **One-click save.** Click the toolbar icon on any article to save it. A small
  "Saved" confirmation appears in the corner of the page, with an **Undo**.
- **Automatic scheduling.** Every five saves, it finds the next free slot inside
  your preferred days and hours and books a 30-minute reading block, with the
  five links in the event notes. It only books at least two hours from now, and
  at most one block per day.
- **A reading dashboard.** Right-click the icon to open a full page with your
  reading list (open, mark read, delete) and your settings.
- **End-of-block check-in.** When a block ends, a little checklist pops up. Tick
  what you finished; anything left over goes back into your list for next time.

Your reading list lives **locally in your browser**. There's no cloud server and
no sign-up. The only thing it talks to is the small helper on your own Mac, which
in turn talks to your own Feishu calendar.

## Setup

Two halves: get the helper running on your Mac, then load the extension into
Chrome. **Full step-by-step instructions are in [SETUP.md](SETUP.md)** and are
written for non-technical readers.

The short version:

1. **Install and log in to `lark-cli`** (Feishu's command-line tool). If you've
   already used it, you're done with this step.
2. **Start the helper.** In the `helper/` folder, run `npm start` (or
   double-click `helper/start.command`). Leave that window open.
3. **Load the extension.** In Chrome, go to `chrome://extensions`, turn on
   **Developer mode**, click **Load unpacked**, and select this project folder.

That's it. No Feishu developer console clicks, no OAuth client to create.

---

## Using it

- **Save a page:** left-click the toolbar icon. (Watch for the corner toast.)
- **See your list or change settings:** right-click the toolbar icon → **Reading
  list** or **Settings**.
- **Adjust your reading window:** in Settings, pick the days, the time window
  (default weekday 2–6pm), the block length, and how many saves trigger a block.

> Times like "2pm" are interpreted in **your computer's timezone**. Blocks are
> placed at the correct moment in time regardless, so they'll never collide with
> existing meetings; just note the wall-clock hour follows your Mac's clock.

---

## Privacy

- Your reading list never leaves your browser; it's stored locally.
- The extension only talks to the helper on your own Mac (over localhost). The
  helper only talks to your own Feishu account, through your own `lark-cli`
  login.
- The helper refuses requests from normal websites — only the Reading Block
  extension (or your own terminal) can use it.
- There is no analytics, no cloud server, and no third party involved.

---

## License

MIT. See [LICENSE](LICENSE).
