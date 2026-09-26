// Progressive enhancement: turns long pages into compact, paged views.
// - `.tabbed > [data-tab]` panels become tabs (project pages).
// - `ol.tour > li.step` becomes a one-step-at-a-time pager (tour pages).
// Without JS every panel and step stays visible, so pages remain complete.

// CSS counters skip hidden elements, so freeze the numbering first.
const freeze = (/** @type {string} */ sel) => {
  document.querySelectorAll(sel).forEach((el, i) => {
    /** @type {HTMLElement} */ (el).dataset.n = String(i + 1);
  });
};
freeze(".artifact-title");
freeze("main caption");
freeze(".sec > h2");

/** Show the panel/step that contains the element named by the URL hash. */
const hashTarget = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  return id ? document.getElementById(id) : null;
};

/**
 * Links to a whole panel or step land on the controls above it; links to
 * something inside one scroll to that element.
 * @param {HTMLElement[]} items
 * @param {(i: number) => void} show
 * @param {HTMLElement} controls
 */
const openFromHash = (items, show, controls) => {
  const t = hashTarget();
  const i = t ? items.findIndex((x) => x.contains(t)) : -1;
  show(i >= 0 ? i : 0);
  if (i >= 0 && t) (t === items[i] ? controls : t).scrollIntoView();
};

// ---------------------------------------------------------------------------
// Tabs

for (const box of document.querySelectorAll(".tabbed")) {
  const panels = /** @type {HTMLElement[]} */ ([
    ...box.querySelectorAll(":scope > [data-tab]"),
  ]);
  if (panels.length < 2) continue;
  const list = document.createElement("div");
  list.className = "tablist";
  list.setAttribute("role", "tablist");
  const tabs = panels.map((panel, i) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.id = `tab-${panel.id}`;
    tab.textContent = panel.dataset.tab ?? `Tab ${i + 1}`;
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    tab.addEventListener("click", () => {
      show(i);
      history.replaceState(null, "", `#${panel.id}`);
    });
    tab.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const j = (i + d + panels.length) % panels.length;
      tabs[j].click();
      tabs[j].focus();
    });
    list.append(tab);
    return tab;
  });
  const show = (/** @type {number} */ n) =>
    panels.forEach((p, i) => {
      p.hidden = i !== n;
      tabs[i].setAttribute("aria-selected", String(i === n));
      tabs[i].tabIndex = i === n ? 0 : -1;
    });
  box.prepend(list);
  box.classList.add("is-tabbed");
  openFromHash(panels, show, list);
  addEventListener("hashchange", () => openFromHash(panels, show, list));
}

// ---------------------------------------------------------------------------
// Tour pager

const tour = document.querySelector("ol.tour");
const steps = /** @type {HTMLLIElement[]} */ (
  tour ? [...tour.querySelectorAll(":scope > li.step")] : []
);
if (tour && steps.length > 1) {
  steps.forEach((s, i) => (s.value = i + 1));
  let current = 0;

  const index = document.createElement("nav");
  index.className = "stepper";
  index.setAttribute("aria-label", "Tour steps");
  const dots = steps.map((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(i + 1);
    b.title = s.querySelector("h2")?.textContent ?? "";
    b.setAttribute("aria-label", `Step ${i + 1}: ${b.title}`);
    b.addEventListener("click", () => go(i));
    index.append(b);
    return b;
  });

  const pager = document.createElement("div");
  pager.className = "pager";
  const prev = document.createElement("button");
  const next = document.createElement("button");
  const where = document.createElement("span");
  prev.type = next.type = "button";
  prev.addEventListener("click", () => go(current - 1));
  next.addEventListener("click", () => go(current + 1));
  where.setAttribute("aria-live", "polite");
  pager.append(prev, where, next);

  const show = (/** @type {number} */ n) => {
    current = n;
    steps.forEach((s, i) => (s.hidden = i !== n));
    dots.forEach((d, i) =>
      i === n
        ? d.setAttribute("aria-current", "step")
        : d.removeAttribute("aria-current"),
    );
    where.textContent = `Step ${n + 1} of ${steps.length}`;
    prev.disabled = n === 0;
    next.disabled = n === steps.length - 1;
    prev.textContent = "← Previous";
    next.textContent = "Next →";
  };
  const go = (/** @type {number} */ n) => {
    if (n < 0 || n >= steps.length) return;
    show(n);
    history.replaceState(null, "", `#${steps[n].id}`);
    index.scrollIntoView({ block: "nearest" });
  };

  tour.before(index);
  tour.after(pager);
  tour.classList.add("is-paged");
  openFromHash(steps, show, index);
  addEventListener("hashchange", () => openFromHash(steps, show, index));
  addEventListener("keydown", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      t.closest("input, textarea, select, pre, .table-wrap, .term")
    )
      return;
    if (e.key === "ArrowRight") go(current + 1);
    if (e.key === "ArrowLeft") go(current - 1);
  });
}
