// server.js — the Reading Block "helper" that runs on YOUR Mac.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Chrome extension lives inside the browser's sandbox. It can talk to the
// public internet, but it cannot run programs on your computer, and it cannot
// safely hold the secret key your Feishu app needs. Feishu (unlike Google) has
// no built-in browser login.
//
// So we split the work in two:
//   - The EXTENSION (in the browser) decides WHEN to book and WHAT to book.
//   - This HELPER (a tiny program on your Mac) does the actual Feishu calendar
//     work, by handing requests to `lark-cli`, which is already logged in to
//     your Feishu account.
//
// The extension whispers to this helper over localhost (a private phone line
// that never leaves your machine). Your Feishu login and app secret stay safely
// inside lark-cli's config on your Mac — they never enter the browser.
//
// This file has NO external dependencies — it only uses things that ship with
// Node.js — so there is nothing to `npm install`.
// ---------------------------------------------------------------------------

import http from "node:http";
import { execFile } from "node:child_process";

// The private phone line. 127.0.0.1 means "this machine only" — no other
// computer on your network (or the internet) can reach it.
const HOST = "127.0.0.1";
const PORT = 8787;

// Where to find lark-cli. It's normally on your PATH, so just "lark-cli" works.
// You can override it by setting the LARK_CLI environment variable if needed.
const LARK_CLI = process.env.LARK_CLI || "lark-cli";

// ---------------------------------------------------------------------------
// Talking to lark-cli
// ---------------------------------------------------------------------------

// Run a lark-cli command and return its parsed JSON output.
//
// SECURITY NOTE: we use execFile with an ARRAY of arguments (not a single
// string fed to a shell). That means things like article titles or URLs are
// passed as plain data and can never be interpreted as commands — there is no
// shell to trick. This is the safe way to call an external program.
function lark(args) {
  return new Promise((resolve, reject) => {
    // Every call runs as the logged-in user and asks for machine-readable JSON.
    const fullArgs = [...args, "--as", "user", "--format", "json"];
    execFile(
      LARK_CLI,
      fullArgs,
      { maxBuffer: 10 * 1024 * 1024 }, // allow up to 10MB of output (calendars can be chatty)
      (err, stdout, stderr) => {
        // execFile errors when lark-cli exits non-zero. Surface a useful message.
        if (err && !stdout) {
          reject(new Error(`lark-cli failed: ${stderr || err.message}`));
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch (_) {
          reject(new Error(`Could not understand lark-cli output: ${stdout.slice(0, 300)}`));
          return;
        }
        // lark-cli marks failures with ok:false and an error object.
        if (parsed && parsed.ok === false) {
          const msg = parsed.error?.message || JSON.stringify(parsed.error || parsed);
          reject(new Error(`Feishu error: ${msg}`));
          return;
        }
        resolve(parsed);
      }
    );
  });
}

// Feishu's "primary" calendar has a real ID that looks like an email
// (e.g. you@company.com). The extension just says "primary"; we translate that
// into the real ID once and remember it for as long as the helper runs.
let cachedPrimaryId = null;
async function resolveCalendarId(calendarId) {
  // If the user pasted a real ID (anything that isn't the word "primary"), use it.
  if (calendarId && calendarId !== "primary") return calendarId;
  if (cachedPrimaryId) return cachedPrimaryId;

  const res = await lark(["calendar", "calendars", "primary"]);
  // Shape: { data: { calendars: [ { calendar: { calendar_id, ... } } ] } }
  const entry = res?.data?.calendars?.[0];
  const id = entry?.calendar?.calendar_id || entry?.calendar_id;
  if (!id) throw new Error("Couldn't find your primary Feishu calendar.");
  cachedPrimaryId = id;
  return id;
}

// Turn an ISO time string (what the browser sends) into Unix SECONDS as a
// string, which is what Feishu's event API wants. Date.parse understands the
// browser's ISO strings exactly, so this conversion is precise.
function isoToUnixSeconds(iso) {
  return String(Math.floor(new Date(iso).getTime() / 1000));
}

// ---------------------------------------------------------------------------
// The four jobs the extension asks for
// ---------------------------------------------------------------------------

// 1. When am I busy between two times? (so we can find a free slot)
async function getFreeBusy({ start, end }) {
  const res = await lark(["calendar", "+freebusy", "--start", start, "--end", end]);
  const busy = (res.data || []).map((b) => ({
    start: b.start_time,
    end: b.end_time,
  }));
  return { busy };
}

// 2. Which events do I already have in this window? (so we never book two
//    reading blocks on the same day). We return title + start + id; the
//    extension filters to the ones that are actually OUR reading blocks.
async function getEvents({ start, end }) {
  const res = await lark(["calendar", "+agenda", "--start", start, "--end", end]);
  const events = (res.data || []).map((ev) => ({
    summary: ev.summary || "",
    // agenda gives start_time as { datetime, timezone }; datetime is a real
    // ISO timestamp we can compare directly.
    start: ev.start_time?.datetime || ev.start_time || null,
    eventId: ev.event_id || null,
  }));
  return { events };
}

// 3. Create the reading block. We use the full event API (rather than the
//    +create shortcut) on purpose: it lets us mark the time as "busy", set a
//    10-minute reminder, and — importantly — NOT attach a video call, which
//    the shortcut would do. A solo reading block needs no meeting room.
async function createEvent({ summary, description, start, end, calendarId, reminderMinutes }) {
  const calId = await resolveCalendarId(calendarId);
  const data = {
    summary: summary || "Reading Block",
    description: description || "",
    start_time: { timestamp: isoToUnixSeconds(start) },
    end_time: { timestamp: isoToUnixSeconds(end) },
    free_busy_status: "busy",
    reminders: [{ minutes: typeof reminderMinutes === "number" ? reminderMinutes : 10 }],
  };
  const res = await lark([
    "calendar",
    "events",
    "create",
    "--params",
    JSON.stringify({ calendar_id: calId }),
    "--data",
    JSON.stringify(data),
  ]);
  // Shape: { data: { event: { event_id } } } (sometimes { data: { event_id } })
  const eventId = res?.data?.event?.event_id || res?.data?.event_id || null;
  if (!eventId) throw new Error("Feishu created the event but returned no ID.");
  return { eventId };
}

// 4. Delete a reading block (used when you click "Undo" on a booking).
async function deleteEvent({ eventId, calendarId }) {
  const calId = await resolveCalendarId(calendarId);
  await lark([
    "calendar",
    "events",
    "delete",
    "--params",
    JSON.stringify({ calendar_id: calId, event_id: eventId, need_notification: false }),
  ]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The little web server that the extension talks to
// ---------------------------------------------------------------------------

// Only our own browser extension (or a local tool like curl with no Origin)
// may use this helper. A normal website's request carries an https:// Origin,
// which we reject — so no random page you visit can quietly book calendar
// events through this helper.
function isAllowedOrigin(origin) {
  if (!origin) return true; // e.g. curl / health checks from your own terminal
  return origin.startsWith("chrome-extension://");
}

function setCors(res, origin) {
  // Echo back the caller's origin only if we trust it.
  res.setHeader("Access-Control-Allow-Origin", origin && origin.startsWith("chrome-extension://") ? origin : "null");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJSON(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

// Read the full request body and parse it as JSON.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Request body was not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

// Map each URL path to the function that handles it.
const ROUTES = {
  "/freebusy": getFreeBusy,
  "/events": getEvents,
  "/create": createEvent,
  "/delete": deleteEvent,
};

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);

  // Browsers send a preflight OPTIONS request before a real POST. Answer it.
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // A simple "are you alive?" check the extension can use.
  if (req.url === "/health") {
    sendJSON(res, 200, { ok: true, service: "reading-block-helper", port: PORT });
    return;
  }

  if (!isAllowedOrigin(origin)) {
    sendJSON(res, 403, { ok: false, error: "Only the Reading Block extension may use this helper." });
    return;
  }

  const handler = ROUTES[req.url];
  if (!handler || req.method !== "POST") {
    sendJSON(res, 404, { ok: false, error: `Unknown request: ${req.method} ${req.url}` });
    return;
  }

  try {
    const body = await readBody(req);
    const result = await handler(body);
    sendJSON(res, 200, { ok: true, ...result });
  } catch (err) {
    // Log on the helper side (visible in the terminal) and tell the extension.
    console.error(`[reading-block-helper] ${req.url} error:`, err.message);
    sendJSON(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Reading Block helper is running.`);
  console.log(`  Listening on http://${HOST}:${PORT}`);
  console.log(`  It uses lark-cli ("${LARK_CLI}") to reach your Feishu calendar.`);
  console.log(`  Leave this window open while you use the extension. Press Ctrl+C to stop.\n`);
});

// If the port is already taken, it almost always means the helper is already
// running in another window — say so plainly instead of crashing cryptically.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} is already in use.\n` +
        `  The Reading Block helper is probably already running in another window.\n` +
        `  You don't need to start it twice.\n`
    );
    process.exit(1);
  }
  throw err;
});
