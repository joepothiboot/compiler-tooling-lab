// Progressive enhancement: a "Copy" button on code blocks marked data-copy.
// Pages are fully usable without it.
for (const pre of document.querySelectorAll("pre[data-copy]")) {
  if (!navigator.clipboard) break;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.textContent = "Copy";
  button.setAttribute(
    "aria-label",
    `Copy ${pre.getAttribute("aria-label") ?? "code"}`,
  );
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        pre.querySelector("code")?.textContent ?? "",
      );
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
  pre.before(button);
}
