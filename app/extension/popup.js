const status = document.querySelector("#status");
const toggle = document.querySelector("#toggle");
const ws = document.querySelector("#ws");
const sample = document.querySelector("#sample");
const recognition = document.querySelector("#recognition");

function render(items) {
  const enabled = items.enabled === true;
  toggle.textContent = enabled ? "On" : "Off";
  toggle.setAttribute("aria-pressed", String(enabled));
  ws.value = typeof items.wsUrl === "string" ? items.wsUrl : "";
  sample.checked = items.allowSimulation === true;
  if (!enabled) status.textContent = "Off";
  else if (sample.checked) status.textContent = "Sample data";
  else if (ws.value) status.textContent = "Live link configured";
  else status.textContent = "Setup needed";
  recognition.textContent = sample.checked
    ? "Sample phrases only. This is not sign recognition."
    : ws.value
      ? "Waiting for the server."
      : "No recognition service is connected.";
}

chrome.storage.local.get(["enabled", "wsUrl", "allowSimulation"], render);

toggle.addEventListener("click", () => {
  const enabled = toggle.getAttribute("aria-pressed") !== "true";
  chrome.storage.local.set({ enabled });
  render({ enabled, wsUrl: ws.value, allowSimulation: sample.checked });
});

document.querySelector("#save").addEventListener("click", () => {
  chrome.storage.local.set({
    wsUrl: ws.value.trim(),
    allowSimulation: sample.checked,
  });
  status.textContent = "Saved";
});
