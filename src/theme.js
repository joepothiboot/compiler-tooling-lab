// Progressive enhancement: a dark-theme switch in the header. Light is the
// default; the choice is remembered per browser. The saved theme is applied
// before first paint by the inline snippet in each page's <head>.
const root = document.documentElement;
const header = document.querySelector("header.site");
if (header) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-switch";
  button.setAttribute("role", "switch");
  button.innerHTML =
    '<span class="label">Dark</span><span class="track" aria-hidden="true"><span class="thumb"></span></span>';
  button.setAttribute("aria-label", "Dark theme");
  const sync = () =>
    button.setAttribute("aria-checked", String(root.dataset.theme === "dark"));
  button.addEventListener("click", () => {
    const dark = root.dataset.theme !== "dark";
    if (dark) root.dataset.theme = "dark";
    else delete root.dataset.theme;
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // Storage can be blocked; the switch still works for this page view.
    }
    sync();
  });
  sync();
  header.append(button);
}

// Loaded as an ES module so each script keeps its own scope.
export {};
