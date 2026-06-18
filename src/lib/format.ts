// Formatting + color helpers shared across the UI.

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

// Map a file extension to a category + color, so the treemap reads like a
// heatmap by file type. Directories get a neutral slate.
const CATEGORY_COLORS: Record<string, string> = {
  video: "#ef4444",
  image: "#f59e0b",
  audio: "#ec4899",
  archive: "#8b5cf6",
  code: "#3b82f6",
  document: "#10b981",
  app: "#06b6d4",
  other: "#64748b",
  dir: "#334155",
};

const EXT_MAP: Record<string, string> = {
  // video
  mp4: "video", mov: "video", mkv: "video", avi: "video", webm: "video", m4v: "video",
  // image
  jpg: "image", jpeg: "image", png: "image", gif: "image", heic: "image", webp: "image", svg: "image", tiff: "image", raw: "image",
  // audio
  mp3: "audio", wav: "audio", flac: "audio", aac: "audio", m4a: "audio",
  // archive
  zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive", dmg: "archive", pkg: "archive",
  // code
  js: "code", ts: "code", tsx: "code", jsx: "code", rs: "code", py: "code", go: "code", java: "code", c: "code", cpp: "code", h: "code", json: "code", html: "code", css: "code",
  // document
  pdf: "document", doc: "document", docx: "document", xls: "document", xlsx: "document", ppt: "document", pptx: "document", txt: "document", md: "document", csv: "document",
  // app
  app: "app", exe: "app",
};

export function categoryFor(name: string, isDir: boolean): string {
  if (isDir) return "dir";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "other";
}

export function colorFor(name: string, isDir: boolean): string {
  return CATEGORY_COLORS[categoryFor(name, isDir)];
}

export const LEGEND: { label: string; color: string }[] = [
  { label: "Video", color: CATEGORY_COLORS.video },
  { label: "Image", color: CATEGORY_COLORS.image },
  { label: "Audio", color: CATEGORY_COLORS.audio },
  { label: "Archive", color: CATEGORY_COLORS.archive },
  { label: "Code", color: CATEGORY_COLORS.code },
  { label: "Document", color: CATEGORY_COLORS.document },
  { label: "App", color: CATEGORY_COLORS.app },
  { label: "Other", color: CATEGORY_COLORS.other },
];
