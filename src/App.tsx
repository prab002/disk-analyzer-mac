import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import Treemap from "./Treemap";
import type { FileNode } from "./lib/types";
import { formatBytes, LEGEND } from "./lib/format";
import "./App.css";

export default function App() {
  const [root, setRoot] = useState<FileNode | null>(null);
  // Breadcrumb stack: nodes from scanned root down to the zoomed-in folder.
  const [stack, setStack] = useState<FileNode[]>([]);
  const [selected, setSelected] = useState<FileNode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<string>("");

  useEffect(() => {
    invoke<string>("home_dir")
      .then(setHome)
      .catch(() =>
        setError(
          "Not running inside the Tauri app window. Open the native “Disk Analyzer” window that `pnpm tauri dev` launches — not localhost in a browser."
        )
      );
  }, []);

  const current = stack[stack.length - 1] ?? null;

  async function scan(path: string) {
    setScanning(true);
    setError(null);
    setSelected(null);
    try {
      const tree = await invoke<FileNode>("scan_directory", { path });
      setRoot(tree);
      setStack([tree]);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }

  async function pickFolder() {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string") scan(dir);
    } catch (e) {
      setError(`Folder picker failed: ${e}`);
    }
  }

  async function zoom(node: FileNode) {
    setSelected(null);
    // Children present locally → zoom instantly.
    if (node.children && node.children.length > 0) {
      setStack((s) => [...s, node]);
      return;
    }
    // Children were pruned/truncated on the backend to keep memory bounded.
    // Fetch this folder fresh (its own bounded subtree) so we never hold the
    // entire deep tree in memory at once.
    setScanning(true);
    setError(null);
    try {
      const tree = await invoke<FileNode>("scan_directory", { path: node.path });
      setStack((s) => [...s, tree]);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }

  function jumpTo(index: number) {
    setStack((s) => s.slice(0, index + 1));
    setSelected(null);
  }

  // Pop one level back up to the parent folder.
  function goBack() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    setSelected(null);
  }

  // Escape / Backspace go up a level — like the Finder.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Escape" || e.key === "Backspace") && stack.length > 1) {
        // Don't hijack Backspace while typing in an input.
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
        e.preventDefault();
        goBack();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length]);

  async function trashSelected() {
    if (!selected) return;
    const ok = await confirm(
      `Move "${selected.name}" (${formatBytes(selected.size)}) to the Trash?`,
      { title: "Confirm delete", kind: "warning" }
    );
    if (!ok) return;
    try {
      const freed = await invoke<number>("delete_to_trash", {
        paths: [selected.path],
      });
      // Re-scan the original root so sizes/treemap update.
      if (root) await scan(root.path);
      setError(`Freed ${formatBytes(freed)} → moved to Trash.`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function reveal() {
    if (!selected) return;
    await invoke("reveal_in_finder", { path: selected.path });
  }

  return (
    <div className={`app ${scanning ? "busy" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">◧</span> Disk Analyzer
        </div>
        <div className="actions">
          <button className="btn primary" onClick={pickFolder} disabled={scanning}>
            Choose folder…
          </button>
          {home && (
            <button
              className="btn"
              onClick={() => scan(`${home}/Downloads`)}
              disabled={scanning}
            >
              Scan ~/Downloads
            </button>
          )}
          {home && (
            <button
              className="btn"
              onClick={() => scan(home)}
              disabled={scanning}
            >
              Scan Home
            </button>
          )}
        </div>
      </header>

      {/* Breadcrumb */}
      {stack.length > 0 && (
        <nav className="breadcrumb">
          <button
            className="back-btn"
            onClick={goBack}
            disabled={stack.length <= 1}
            title="Back to parent folder (Esc)"
          >
            ‹ Back
          </button>
          <div className="crumbs">
            {stack.map((n, i) => {
              const isLast = i === stack.length - 1;
              return (
                <span key={n.path}>
                  <button
                    className={`crumb ${isLast ? "current" : ""}`}
                    onClick={() => jumpTo(i)}
                    disabled={isLast}
                  >
                    {i === 0 ? n.path : n.name}
                  </button>
                  {!isLast && <span className="sep">›</span>}
                </span>
              );
            })}
          </div>
        </nav>
      )}

      {error && <div className="banner">{error}</div>}

      <main className="content">
        {scanning && (
          <div className="placeholder">
            <div className="spinner" />
            <p>Scanning… walking the filesystem in parallel.</p>
            <div className="scan-bar">
              <span />
            </div>
          </div>
        )}

        {!scanning && !current && (
          <div className="placeholder">
            <p>
              Pick a folder to visualize. Each rectangle is a file or folder;
              its area is its size on disk.
            </p>
            <p className="hint">
              Double-click a folder to zoom in · single-click to select · then
              delete or reveal it.
            </p>
          </div>
        )}

        {!scanning && current && (
          <Treemap
            root={current}
            selectedPath={selected?.path}
            onZoom={zoom}
            onSelect={setSelected}
          />
        )}
      </main>

      {/* Inspector / footer */}
      <footer className="inspector">
        <div className="legend">
          {LEGEND.map((l) => (
            <span key={l.label} className="legend-item">
              <span className="swatch" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>

        <div className="selection">
          {selected ? (
            <>
              <div className="sel-info">
                <strong>{selected.name}</strong>
                <span>{formatBytes(selected.size)}</span>
                <span className="dim">
                  {selected.is_dir
                    ? `${selected.file_count.toLocaleString()} files`
                    : "file"}
                </span>
              </div>
              <div className="sel-actions">
                <button className="btn" onClick={reveal}>
                  Reveal in Finder
                </button>
                <button className="btn danger" onClick={trashSelected}>
                  Move to Trash
                </button>
              </div>
            </>
          ) : (
            <span className="dim">Select an item to act on it.</span>
          )}
        </div>
      </footer>
    </div>
  );
}
