/**
 * 画像差分ツールのメインUIコンポーネント
 *
 * ユーザーが2つの画像（またはPDF/TIFF等）を選択し、
 * バックエンドのAPIに送信して差分比較を行うための機能を提供する。
 * 比較結果は「補正B」「差分」「マスク」の各ビューで切り替えて表示できる。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Clipboard, ImageUp, Layers, Loader2, ScanSearch, ZoomIn, ZoomOut } from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002/api";
const CATEGORIES = ["汎用", "図面", "グラフ", "書類"];
const VIEWS = [
  { id: "aligned", label: "補正B" },
  { id: "overlay", label: "差分" },
  { id: "mask", label: "マスク" },
];

function App() {
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [pageA, setPageA] = useState(0);
  const [pageB, setPageB] = useState(0);
  const [category, setCategory] = useState("汎用");
  const [diffThreshold, setDiffThreshold] = useState(0.1);
  const [view, setView] = useState("overlay");
  const [zoom, setZoom] = useState(1);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeSide, setActiveSide] = useState("left");
  const requestIdRef = useRef(0);
  const previewRequestIdRef = useRef({ left: 0, right: 0 });

  const canCompare = Boolean(left?.file && right?.file);
  const rightImage = useMemo(() => {
    if (!result) return null;
    if (view === "aligned") return toDataUri(result.image_b_aligned);
    if (view === "mask") return toDataUri(result.mask);
    return toDataUri(result.overlay);
  }, [result, view]);
  const leftPreviewImage = left?.preview ? toDataUri(left.preview) : null;
  const rightPreviewImage = right?.preview ? toDataUri(right.preview) : null;
  const rightPaneTitle = result
    ? view === "overlay"
      ? "差分オーバーレイ"
      : view === "mask"
        ? "差分マスク"
        : "B 補正済み"
    : "B 比較対象";

  async function loadFile(side, file, attachment = null) {
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const metadata = await postForm("/analyze", form);
      const payload = { file, metadata, attachment };
      if (side === "left") {
        setLeft(payload);
        setPageA(0);
        setActiveSide("right");
      } else {
        setRight(payload);
        setPageB(0);
        setActiveSide("left");
      }
      await loadPreview(side, file, 0);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadPreview(side, file, page) {
    const nextId = previewRequestIdRef.current[side] + 1;
    previewRequestIdRef.current = { ...previewRequestIdRef.current, [side]: nextId };
    const form = new FormData();
    form.append("file", file);
    form.append("page", String(page));
    try {
      const converted = await postForm("/convert", form);
      if (previewRequestIdRef.current[side] !== nextId) return;
      const applyPreview = (current) => (current?.file === file ? { ...current, preview: converted.image } : current);
      if (side === "left") {
        setLeft(applyPreview);
      } else {
        setRight(applyPreview);
      }
    } catch (err) {
      if (previewRequestIdRef.current[side] === nextId) {
        setError(err.message);
      }
    }
  }

  function selectPage(side, nextPage) {
    setResult(null);
    if (side === "left") {
      setPageA(nextPage);
      if (left?.file) loadPreview("left", left.file, nextPage);
    } else {
      setPageB(nextPage);
      if (right?.file) loadPreview("right", right.file, nextPage);
    }
  }

  async function pasteImage(side, event) {
    setActiveSide(side);
    const file = imageFileFromClipboard(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const attachment = await postForm("/attachments", form);
      await loadFile(side, file, attachment);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!result || !canCompare) return undefined;
    const timer = window.setTimeout(() => {
      compare(diffThreshold);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [diffThreshold]);

  async function compare(threshold = diffThreshold) {
    if (!canCompare) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file_a", left.file);
      form.append("file_b", right.file);
      form.append("page_a", String(pageA));
      form.append("page_b", String(pageB));
      form.append("category", category);
      form.append("diff_threshold", String(threshold));
      const nextResult = await postForm("/diff", form);
      if (requestId === requestIdRef.current) {
        setResult(nextResult);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err.message);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setBusy(false);
      }
    }
  }

  return (
    <main>
      <header className="app-header">
        <div>
          <h1>Visual Diff Tool</h1>
          <p>PNG / SVG / PDF / TIFF / Excalidraw</p>
        </div>
      </header>

      <section className="toolbar" aria-label="compare settings">
        <FilePicker
          label="A"
          side="left"
          active={activeSide === "left"}
          data={left}
          page={pageA}
          setPage={(page) => selectPage("left", page)}
          onActivate={setActiveSide}
          onPasteImage={pasteImage}
          onFile={(file) => loadFile("left", file)}
        />
        <FilePicker
          label="B"
          side="right"
          active={activeSide === "right"}
          data={right}
          page={pageB}
          setPage={(page) => selectPage("right", page)}
          onActivate={setActiveSide}
          onPasteImage={pasteImage}
          onFile={(file) => loadFile("right", file)}
        />
        <button className="primary" disabled={!canCompare || busy} onClick={() => compare()}>
          {busy ? <Loader2 className="spin" size={18} /> : <ScanSearch size={18} />}
          比較
        </button>
        <div className="control">
          <span>カテゴリ</span>
          <div className="segmented">
            {CATEGORIES.map((item) => (
              <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="control">
          <span>表示</span>
          <div className="segmented">
            {VIEWS.map((item) => (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <label className="control threshold-control">
          <span>差分しきい値 {diffThreshold.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={diffThreshold}
            onChange={(event) => setDiffThreshold(Number(event.target.value))}
          />
        </label>
        <div className="icon-group" aria-label="zoom">
          <button title="縮小" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}>
            <ZoomOut size={18} />
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button title="拡大" onClick={() => setZoom((value) => Math.min(3, value + 0.1))}>
            <ZoomIn size={18} />
          </button>
        </div>
      </section>

      {error && (
        <div className="notice error">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {result?.alignment?.warning && (
        <div className="notice warning">
          <AlertTriangle size={18} />
          位置合わせ失敗、未補正で表示中: {result.alignment.warning}
        </div>
      )}

      <section className="summary">
        <Stat label="差分ピクセル" value={result ? result.diff_pixels.toLocaleString() : "-"} />
        <Stat label="差分率" value={result ? `${(result.diff_ratio * 100).toFixed(3)}%` : "-"} />
        <Stat label="しきい値" value={result ? result.diff_threshold.toFixed(2) : diffThreshold.toFixed(2)} />
        <Stat label="マッチ数" value={result ? `${result.alignment.matches} / ${result.alignment.inliers}` : "-"} />
        <Stat label="矩形" value={result ? result.diff_rects.length : "-"} />
      </section>

      <section className="viewer">
        <ImagePane
          title="A 基準"
          side="left"
          active={activeSide === "left"}
          subtitle={left?.file?.name}
          image={result ? toDataUri(result.image_a) : leftPreviewImage}
          zoom={zoom}
          onActivate={setActiveSide}
          onPasteImage={pasteImage}
        />
        <ImagePane
          title={rightPaneTitle}
          side="right"
          active={activeSide === "right"}
          subtitle={right?.file?.name}
          image={result ? rightImage : rightPreviewImage}
          zoom={zoom}
          onActivate={setActiveSide}
          onPasteImage={pasteImage}
        />
      </section>
    </main>
  );
}

function FilePicker({ label, side, active, data, page, setPage, onFile, onActivate, onPasteImage }) {
  const pages = data?.metadata?.pages ?? [];
  const pasted = Boolean(data?.attachment);
  return (
    <div
      className={`file-picker ${active ? "active" : ""}`}
      tabIndex={0}
      onFocus={() => onActivate(side)}
      onClick={() => onActivate(side)}
      onPaste={(event) => onPasteImage(side, event)}
    >
      <label className="upload">
        <ImageUp size={18} />
        <span>File {label}</span>
        <input
          type="file"
          onChange={(event) => {
            if (event.target.files?.[0]) {
              onFile(event.target.files[0]);
              event.target.value = "";
            }
          }}
        />
      </label>
      <div className="paste-hint">
        <Clipboard size={16} />
        <span>cmd+V</span>
      </div>
      <div className="file-meta">
        <strong>{data?.file?.name ?? "未選択"}</strong>
        <small>
          {data
            ? `${data.metadata.format.toUpperCase()} / ${data.metadata.page_count} page${pasted ? " / 添付保存済み" : ""}`
            : "ファイル選択または貼り付け"}
        </small>
      </div>
      <label className="page-select">
        <Layers size={16} />
        <select value={page} onChange={(event) => setPage(Number(event.target.value))} disabled={!pages.length}>
          {pages.length ? pages.map((item) => (
            <option key={item.index} value={item.index}>
              {item.index + 1} ({item.width}x{item.height})
            </option>
          )) : <option>Page</option>}
        </select>
      </label>
    </div>
  );
}

function ImagePane({ title, side, active, subtitle, image, zoom, onActivate, onPasteImage }) {
  return (
    <article
      className={`pane ${active ? "active" : ""}`}
      tabIndex={0}
      onFocus={() => onActivate(side)}
      onClick={() => onActivate(side)}
      onPaste={(event) => onPasteImage(side, event)}
    >
      <div className="pane-title">
        <strong>{title}</strong>
        <span>{subtitle ?? "クリックしてcmd+V"}</span>
      </div>
      <div className="canvas">
        {image ? (
          <img src={image} style={{ width: `${zoom * 100}%` }} alt={title} />
        ) : (
          <div className="empty">No image</div>
        )}
      </div>
    </article>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function postForm(path, form) {
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || `API error: ${response.status}`);
  }
  return body;
}

function toDataUri(image) {
  return `data:${image.mime_type};base64,${image.data}`;
}

function imageFileFromClipboard(clipboardData) {
  const items = Array.from(clipboardData?.items ?? []);
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const blob = imageItem?.getAsFile();
  if (!blob) return null;
  const extension = extensionForMime(blob.type);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new File([blob], `clipboard-${timestamp}.${extension}`, { type: blob.type || "image/png" });
}

function extensionForMime(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

createRoot(document.getElementById("root")).render(<App />);
