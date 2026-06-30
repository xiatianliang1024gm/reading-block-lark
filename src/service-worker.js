// service-worker.js
// ---------------------------------------------------------------------------
// The background brain. It does three jobs now:
//   1. Left-click on the toolbar icon  -> save the current page instantly.
//   2. Right-click on the toolbar icon -> a menu to open the dashboard
//      (your reading list and settings, in a full browser tab).
//   3. When a save completes a batch of five, book the reading block.
//
// There's no popup, so saving is a single click. Feedback is a small toast we
// inject onto the page itself (top-right), with Undo. When a save completes a
// batch of five, the toast also tells you the reading block was booked.
// ---------------------------------------------------------------------------

import {
  getItems,
  getSettings,
  addItem,
  markBatched,
  clearBatched,
  deleteItem,
  addReview,
  removeReview,
} from "./lib/storage.js";
import { nextBatch } from "./lib/batch.js";
import { scheduleReadingBlock, deleteReadingEvent } from "./lib/calendar.js";

const DASHBOARD = "src/options.html";
const REVIEW_ALARM_PREFIX = "review:";

// --- Right-click menu on the toolbar icon -----------------------------------
// Context menus are registered once, when the extension installs or updates.
chrome.runtime.onInstalled.addListener(() => {
  // Clear first so reloading the extension never errors on duplicate ids.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "open-list",
      title: "Reading list",
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: "open-settings",
      title: "Settings",
      contexts: ["action"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  // Both items open the same dashboard tab; the hash tells it where to scroll.
  const hash = info.menuItemId === "open-settings" ? "#settings" : "#reading-list";
  chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD) + hash });
});

// --- When a reading block ends: pop up the review checklist ------------------
chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(REVIEW_ALARM_PREFIX)) return;
  const reviewId = alarm.name.slice(REVIEW_ALARM_PREFIX.length);
  // Open a small popup window with the "what did you finish?" checklist.
  chrome.windows.create({
    url: chrome.runtime.getURL(`src/review.html?rid=${encodeURIComponent(reviewId)}`),
    type: "popup",
    width: 440,
    height: 600,
  });
});

// --- Left-click on the icon: save the current page --------------------------
chrome.action.onClicked.addListener((tab) => {
  saveCurrentTab(tab).catch((err) => console.error("Reading Block:", err));
});

async function saveCurrentTab(tab) {
  const url = tab?.url || "";
  // Only normal web pages can be saved (not chrome:// pages, the dashboard, the
  // new-tab page, etc.). On those there's nothing to do and the browser won't let
  // us draw our in-page toast either, so we quietly do nothing.
  if (!/^https?:/i.test(url)) return;

  // 1. Save the page right away, and work out whether this completes a batch.
  const item = await addItem({ url, title: tab.title });
  const [items, settings] = await Promise.all([getItems(), getSettings()]);
  const { ready, batch } = nextBatch(items, settings.batchSize);

  if (tab.id == null) return;

  // 2a. An ordinary save: confirm instantly, with Undo.
  if (!ready) {
    showInPageToast(tab.id, { mode: "saved", savedId: item.id });
    return;
  }

  // 2b. This save completes a batch of five. Booking talks to the helper and
  //     Feishu, which takes a few seconds, so we show an instant "booking…"
  //     message FIRST (so you're never left staring at nothing), then replace it
  //     with the real result once Feishu answers.
  showInPageToast(tab.id, { mode: "pending" });

  const batchIds = batch.map((b) => b.id);
  try {
    const { slot, event } = await scheduleReadingBlock(batch, settings);
    await markBatched(batchIds, slot.start.toISOString());

    // Schedule the after-block review (the "what did you finish?" checklist).
    const reviewId = event?.id || `r${slot.start.getTime()}`;
    await addReview({ id: reviewId, itemIds: batchIds, endsAt: slot.end.getTime() });
    chrome.alarms.create(REVIEW_ALARM_PREFIX + reviewId, { when: slot.end.getTime() });

    // Swap the "booking…" toast for the booked confirmation (Undo reverses the
    // whole booking).
    showInPageToast(tab.id, {
      mode: "booked",
      when: formatWhen(slot.start),
      savedId: item.id,
      eventId: event?.id || null,
      batchIds,
    });
  } catch (err) {
    // The page is saved; only the booking failed. Say so in the toast, and log
    // the details to the service worker console for debugging.
    console.error("Reading Block: booking failed —", err);
    showInPageToast(tab.id, {
      mode: "saved",
      savedId: item.id,
      note: "Couldn't book a block: " + (err?.message || "unknown error"),
    });
  }
}

// --- Undo (from the in-page toast) ------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "UNDO_SAVE") {
    deleteItem(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "UNDO_BOOKING") {
    undoBooking(message)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

// Reverse a booking completely: delete the calendar event, put those reads back
// to "waiting", and remove the page that was just saved.
async function undoBooking({ savedId, eventId, batchIds }) {
  const settings = await getSettings();
  if (eventId) {
    try {
      await deleteReadingEvent(eventId, settings);
    } catch (_) {
      /* event may already be gone; carry on cleaning up locally */
    }
    // Cancel the pending after-block review for this booking too.
    chrome.alarms.clear(REVIEW_ALARM_PREFIX + eventId);
    await removeReview(eventId);
  }
  if (Array.isArray(batchIds) && batchIds.length) await clearBatched(batchIds);
  if (savedId) await deleteItem(savedId);
}

// Inject the confirmation toast into the page the user just saved.
async function showInPageToast(tabId, opts) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: deepreadToast,
      args: [opts],
    });
  } catch (_) {
    // Some pages forbid injection (e.g. the Chrome Web Store). Saving still
    // worked; we just couldn't show the in-page confirmation.
  }
}

// This function is serialized and run INSIDE the saved page. It must be fully
// self-contained (no outside variables) and uses inline styles inside a shadow
// root so the host page's CSS can't touch it and its CSS can't touch the page.
// `opts` is { mode:'saved'|'booked', savedId, note?, when?, eventId?, batchIds? }.
function deepreadToast(opts) {
  const HOST_ID = "__readingblock_toast__";
  const old = document.getElementById(HOST_ID);
  if (old) old.remove();

  const booked = opts.mode === "booked";
  // "pending" is the brief "Saved · booking your reading block…" state shown
  // while we talk to Feishu. It has no Undo and never auto-closes; it stays put
  // until the booked (or failed) toast replaces it.
  const pending = opts.mode === "pending";

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Top-right corner, just under the toolbar, so Undo is right below the icon
  // you just clicked (minimal mouse travel).
  host.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });

  const box = document.createElement("div");
  box.style.cssText =
    "display:flex;align-items:center;gap:11px;padding:11px 13px 11px 15px;" +
    "border-radius:12px;background:#f7f1e4;color:#241d13;border:1px solid #d8cbae;" +
    "box-shadow:0 12px 32px -12px rgba(40,30,12,.5);" +
    "font-family:'Avenir Next',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
    "font-size:14px;line-height:1.3;opacity:0;transform:translateY(-10px);" +
    "transition:opacity .22s ease,transform .22s ease;";

  const dot = document.createElement("span");
  // No align-self/margin override here: the box centers its children, so the dot
  // stays vertically centered against the text in every state (one line or two).
  dot.style.cssText =
    "width:8px;height:8px;border-radius:50%;flex:0 0 auto;" +
    // A warm amber while booking is in progress; the usual green otherwise.
    (pending ? "background:#c98a1a;" : "background:#1c6b54;");

  const text = document.createElement("div");
  if (pending) {
    const line1 = document.createElement("div");
    line1.textContent = "Saved to Reading Block";
    line1.style.cssText = "font-weight:600;";
    const line2 = document.createElement("div");
    line2.textContent = "Booking your reading block…";
    line2.style.cssText = "color:#6d6049;margin-top:2px;font-size:13px;";
    text.append(line1, line2);
  } else if (booked) {
    const line1 = document.createElement("div");
    line1.textContent = "Reading block booked";
    line1.style.cssText = "font-weight:700;";
    const line2 = document.createElement("div");
    line2.textContent = opts.when || "";
    line2.style.cssText = "color:#6d6049;margin-top:2px;";
    text.append(line1, line2);
  } else {
    const line1 = document.createElement("div");
    line1.textContent = "Saved to Reading Block";
    line1.style.cssText = "font-weight:500;";
    text.append(line1);
    if (opts.note) {
      const line2 = document.createElement("div");
      line2.textContent = opts.note;
      line2.style.cssText = "color:#6d6049;margin-top:2px;font-size:13px;";
      text.append(line2);
    }
  }

  const undo = document.createElement("button");
  undo.textContent = "Undo";
  undo.style.cssText =
    "background:none;border:none;color:#1c6b54;font-weight:700;font-family:inherit;" +
    "font-size:14px;cursor:pointer;padding:4px 6px;border-radius:6px;margin-left:2px;align-self:center;";
  undo.addEventListener("mouseenter", () => (undo.style.background = "rgba(28,107,84,.10)"));
  undo.addEventListener("mouseleave", () => (undo.style.background = "none"));

  // The "booking…" state has no Undo button (there's nothing to undo yet).
  if (pending) box.append(dot, text);
  else box.append(dot, text, undo);
  shadow.append(box);
  document.body.appendChild(host);

  requestAnimationFrame(() => {
    box.style.opacity = "1";
    box.style.transform = "translateY(0)";
  });

  function close() {
    box.style.opacity = "0";
    box.style.transform = "translateY(-10px)";
    setTimeout(() => host.remove(), 260);
  }
  // The "booking…" toast stays until the booked/failed toast replaces it; the
  // others auto-dismiss (booked confirmations linger a little longer to read).
  let timer = pending ? null : setTimeout(close, booked ? 5000 : 3000);

  if (!pending)
    undo.addEventListener("click", () => {
    clearTimeout(timer);
    try {
      if (booked) {
        chrome.runtime.sendMessage({
          type: "UNDO_BOOKING",
          savedId: opts.savedId,
          eventId: opts.eventId,
          batchIds: opts.batchIds,
        });
      } else {
        chrome.runtime.sendMessage({ type: "UNDO_SAVE", id: opts.savedId });
      }
    } catch (_) {}
    text.replaceChildren(document.createTextNode(booked ? "Booking undone" : "Removed"));
    undo.remove();
    timer = setTimeout(close, 1300);
  });
}

// --- Small helpers ----------------------------------------------------------

// Friendly date like "Mon, Jun 29 at 2:00 PM" in the machine's local time.
function formatWhen(date) {
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}
