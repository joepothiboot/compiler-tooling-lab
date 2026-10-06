import { THEME_KEY } from "./constants.js";

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
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {}

    sync();
  });

  sync();
  header.append(button);
}

export {};
