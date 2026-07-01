# Setting up Reading Block (Lark version)

This guide gets the extension running in Chrome and booking blocks on your Feishu
(Lark) calendar. You only do this once. Follow it top to bottom.

There are three small parts:
- **Part A** gets `lark-cli` ready (Feishu's command-line tool, which holds your
  Feishu login).
- **Part B** starts the little helper on your Mac.
- **Part C** loads the extension into Chrome.

The extension itself needs no Feishu console setup and no OAuth client to paste
in. The one-time app setup is part of `lark-cli`'s own onboarding (Part A below),
and the helper simply reuses the login `lark-cli` already has.

---

## What you need first

- A Mac with **Node.js** installed. (Check by opening the **Terminal** app and
  typing `node --version`. If you see a version number like `v24.x`, you're set.)
- `lark-cli` set up: installed, connected to a Feishu app, and logged in to your
  Feishu account with calendar permissions. (Check with `lark-cli --version`.)

**Already use `lark-cli` for calendars?** You've done all of this, skip to Part A.
Just make sure your app has the calendar scopes listed in step 3; if a command
later complains about permissions, it returns a link to enable them.

**New to `lark-cli`?** It's a general-purpose Feishu command-line tool, and this
is its normal one-time setup (nothing here is specific to Reading Block):

1. **Install it:**

   ```
   npm install -g @larksuite/cli
   ```

2. **Connect it to a Feishu app.** `lark-cli` talks to Feishu through a "custom
   app" that you own. This step creates or links one and stores its App ID and
   App Secret locally on your Mac:

   ```
   lark-cli config init
   ```

   Add `--new` (`lark-cli config init --new`) to have it walk you through
   creating a brand-new app in the browser. Your App Secret is stored locally
   (in your Mac's keychain); never share it or paste it into a chat.

3. **Authorize your account with the calendar permissions Reading Block needs**
   (this opens a Feishu approval link):

   ```
   lark-cli auth login --scope "calendar:calendar.event:create calendar:calendar.event:read calendar:calendar.event:update calendar:calendar.event:delete calendar:calendar.free_busy:read calendar:calendar:readonly"
   ```

   Follow the link, approve, and you're authenticated.

---

## Part A: Confirm the calendar commands work

In Terminal, run:

```
lark-cli calendar +freebusy --as user
```

If you see a list of your busy times (in JSON), `lark-cli` can reach your
calendar and you're ready. If it complains about permissions, re-run the
`auth login` command above.

---

## Part B: Start the helper

The helper is a tiny program in this project's `helper/` folder. It listens on
your Mac and does the Feishu calendar work for the extension.

The quickest way to start it is:

```
cd helper
npm start
```

Leave that Terminal window open while you use the extension. You can confirm the
helper is alive with:

```
curl -s http://127.0.0.1:8787/health
```

(You should see `{"ok":true,...}`.)

You can also double-click `helper/start.command` in Finder.

---

## Part C: Load the extension into Chrome

1. Open Chrome. In the address bar type `chrome://extensions` and press Enter.
2. Top-right of that page, turn **Developer mode** ON.
3. Click **Load unpacked** (top-left).
4. In the file picker, select **this project's folder** (the one containing
   `manifest.json`), then click Select.
5. A card titled **Reading Block** appears. If the icon is hidden, click the
   puzzle-piece icon in Chrome's toolbar and pin "Reading Block."

There is nothing to paste and no ID to copy. Because the extension only talks to
your local helper, no Feishu console setup is needed.

---

## Part D: First use

1. Open five articles and **left-click the Reading Block icon once** on each. A
   small "Saved" confirmation appears in the corner each time.
2. On the fifth save, the extension asks the helper to book a block. A 30-minute
   **Reading Block** appears on the next free day in your chosen window, with the
   five links in the event notes.
3. Open Feishu and check your calendar. The block should be there.

To change your reading window (days, hours, block length, saves-per-block),
right-click the toolbar icon → **Settings**.

---

## If something goes wrong

- **"Can't reach the Reading Block helper":** the helper isn't running. Start it
  (Part B) and leave its window open, then save again.
- **The toast says "Couldn't book a block yet":** the page saved fine, but
  booking failed. Common causes:
  - The helper isn't running → start it.
  - `lark-cli` lost its login → re-run the `auth login` command in "What you need
    first."
  - **"No free slot found":** your chosen window had no meeting-free block on a
    free day in the lookahead period. Widen the window or days in Settings.
- **Nothing happens on the 5th save:** open `chrome://extensions`, click "service
  worker" under the Reading Block card to see the extension's logs. Errors from
  the helper also print in the helper's Terminal window.
- **A booked block shows the wrong hour:** times like "2pm" follow **your
  computer's timezone**. The block is still at the correct moment relative to your
  other meetings; only the displayed hour follows your Mac's clock.

---

## Optional: auto-start the helper

The helper runs as a macOS launch agent named `com.readingblock.helper`. You
can install the template in `helper/com.readingblock.helper.plist` if you want it
to start automatically when you log in.

Check whether it's running:

```
curl -s http://127.0.0.1:8787/health
launchctl print gui/$(id -u)/com.readingblock.helper | grep state
```

See its logs (useful if booking ever fails):

```
cat ~/Library/Logs/reading-block-helper.log
```

Restart it (e.g. after you edit the helper code):

```
launchctl kickstart -k gui/$(id -u)/com.readingblock.helper
```

Turn it off / on:

```
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.readingblock.helper.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.readingblock.helper.plist
```

Remove it permanently: run the `bootout` line above, then delete
`~/Library/LaunchAgents/com.readingblock.helper.plist`.

### Install auto-start on your Mac

Copy `com.readingblock.helper.plist` (from this project's `helper/` folder, where
a template copy lives) into `~/Library/LaunchAgents/`, edit the paths inside to
match where `node`, `lark-cli`, and this project live on that Mac, then run the
`bootstrap` line above.
