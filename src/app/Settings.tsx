// Settings: theme, and progress export / import / reset. Destructive actions confirm inline, never with a
// browser dialog.
import { useRef, useState } from "react";
import { progress, useProgress, useSettings, type Theme } from "../progress";
import { Icon, Modal } from "./ui";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="Settings" variant="center" className="settings">
      <SettingsBody onClose={onClose} />
    </Modal>
  );
}

type Status = { kind: "ok" | "error"; text: string } | null;

function SettingsBody({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const data = useProgress();
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const stepsSeen = Object.keys(data.steps).length;
  const checks = Object.values(data.checks);
  const answered = checks.filter((c) => c.result !== "skipped");
  const correct = answered.filter((c) => c.result === "correct").length;

  const exportProgress = () => {
    const blob = new Blob([progress.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mqe-lessons-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus({ kind: "ok", text: "Progress exported." });
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setPendingImport(await f.text());
    setStatus(null);
    if (file.current) file.current.value = "";
  };

  const doImport = () => {
    if (pendingImport === null) return;
    const error = progress.importJson(pendingImport);
    setPendingImport(null);
    setStatus(error ? { kind: "error", text: error } : { kind: "ok", text: "Progress imported." });
  };

  return (
    <>
      <header className="sheet-head">
        <h2>Settings</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
          <Icon name="close" />
        </button>
      </header>
      <div className="settings-body">
        <section className="settings-section">
          <h3>Theme</h3>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.value} type="button" role="radio" aria-checked={settings.theme === t.value} onClick={() => progress.setSettings({ theme: t.value })}>
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Progress</h3>
          <p className="muted">
            {stepsSeen} {stepsSeen === 1 ? "step" : "steps"} seen · {answered.length} {answered.length === 1 ? "checkpoint" : "checkpoints"} answered
            {answered.length ? `, ${correct} correct` : ""}. Progress lives in this browser only; export it to move it to another device.
          </p>
          <div className="button-row">
            <button type="button" className="btn btn-secondary" onClick={exportProgress}>
              <Icon name="download" size={16} /> Export
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => file.current?.click()}>
              <Icon name="upload" size={16} /> Import
            </button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
            {!confirmReset ? (
              <button type="button" className="btn btn-ghost btn-danger" onClick={() => (setConfirmReset(true), setStatus(null))}>
                <Icon name="reset" size={16} /> Reset
              </button>
            ) : null}
          </div>

          {pendingImport !== null ? (
            <div className="confirm" role="alert">
              <p>Importing replaces all progress in this browser with the file’s.</p>
              <div className="button-row">
                <button type="button" className="btn btn-primary" onClick={doImport}>
                  Replace my progress
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setPendingImport(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {confirmReset ? (
            <div className="confirm confirm-danger" role="alert">
              <p>Reset erases every step, checkpoint and goal result. This cannot be undone; export first if you may want it back.</p>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-danger-solid"
                  onClick={() => {
                    progress.reset();
                    setConfirmReset(false);
                    setStatus({ kind: "ok", text: "Progress reset." });
                  }}
                >
                  Erase progress
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {/* Always mounted: a status inserted together with its text is often not announced. */}
          <p className="settings-status" data-kind={status?.kind} role="status">
            {status?.text}
          </p>
        </section>
      </div>
    </>
  );
}
