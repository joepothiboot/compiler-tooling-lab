// Progressive enhancement: links to a note (#note-…) open it in a scrollable
// modal dialog over the article instead of jumping to the appendix. Without
// JS the appendix stays visible and the links are ordinary in-page anchors.

const appendix = document.getElementById("notes");
if (appendix && typeof HTMLDialogElement === "function") {
  const dialog = document.createElement("dialog");
  dialog.className = "note-dialog";
  const bar = document.createElement("div");
  bar.className = "note-bar";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "note-close";
  close.setAttribute("aria-label", "Close");
  close.innerHTML = '<span aria-hidden="true">×</span>';
  close.addEventListener("click", () => dialog.close());
  bar.append(close);
  const body = document.createElement("div");
  body.className = "note-body";
  dialog.append(bar, body);
  document.body.append(dialog);
  appendix.hidden = true;

  /** Where the open note came from, so it can go back on close. */
  const home = document.createComment("note");
  /** @type {HTMLElement | null} */
  let trigger = null;

  const noteFor = (/** @type {string} */ hash) => {
    const id = decodeURIComponent(hash.slice(1));
    const n = id ? document.getElementById(id) : null;
    return n?.classList.contains("note") ? n : null;
  };

  const restore = () => {
    const note = body.firstElementChild;
    if (note) home.replaceWith(note);
  };

  const open = (/** @type {HTMLElement} */ note) => {
    restore();
    note.replaceWith(home);
    body.replaceChildren(note);
    dialog.setAttribute("aria-labelledby", `${note.id}-h`);
    dialog.classList.toggle("wide", note.hasAttribute("data-wide"));
    history.replaceState(null, "", `#${note.id}`);
    if (!dialog.open) dialog.showModal();
    body.scrollTop = 0;
    close.focus();
  };

  dialog.addEventListener("close", () => {
    restore();
    history.replaceState(null, "", location.pathname + location.search);
    trigger?.focus({ preventScroll: true });
    trigger = null;
  });
  // A click on the backdrop lands on the dialog itself; content sits inside.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.addEventListener("click", (e) => {
    const a = /** @type {HTMLElement} */ (e.target).closest?.("a[href^='#']");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const note = noteFor(/** @type {string} */ (a.getAttribute("href")));
    if (!note) return;
    e.preventDefault();
    trigger = /** @type {HTMLElement} */ (a);
    open(note);
  });

  const fromHash = () => {
    const note = noteFor(location.hash);
    if (note) open(note);
  };
  addEventListener("hashchange", fromHash);
  fromHash();
}

// Loaded as an ES module so each script keeps its own scope.
export {};
