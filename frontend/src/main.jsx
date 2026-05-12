/**
 * 画像差分ツールのメインUIコンポーネント
 *
 * ユーザーが2つの画像（またはPDF/TIFF等）を選択し、
 * バックエンドのAPIに送信して差分比較を行うための機能を提供する。
 * 比較結果は「補正B」「差分」「マスク」の各ビューで切り替えて表示できる。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Clipboard,
  ImageUp,
  Layers,
  Loader2,
  MessageSquarePlus,
  MousePointer2,
  PanelTopOpen,
  ScanSearch,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002/api";
const CATEGORIES = ["汎用", "図面", "グラフ", "書類"];
const VIEWS = [
  { id: "aligned", label: "補正B" },
  { id: "overlay", label: "差分" },
  { id: "mask", label: "マスク" },
];
const MEMO_DB_NAME = "visual-diff-memo";
const MEMO_DB_STORE = "payloads";
const MEMO_STORAGE_KEY = "visual-diff-memo-fallback";

function App() {
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [pageA, setPageA] = useState(0);
  const [pageB, setPageB] = useState(0);
  const [category, setCategory] = useState("汎用");
  const [diffThreshold, setDiffThreshold] = useState(0.1);
  const [view, setView] = useState("overlay");
  const [zoom, setZoom] = useState(1);
  const [anchorRegion, setAnchorRegion] = useState(null);
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

  function invalidateComparison() {
    requestIdRef.current += 1;
    setResult(null);
    setBusy(false);
  }

  async function loadFile(side, file, attachment = null) {
    setError("");
    invalidateComparison();
    if (side === "left") setAnchorRegion(null);
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
      const applyPreview = (current) =>
        current?.file === file ? { ...current, preview: converted.image, regions: converted.regions ?? [] } : current;
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
    invalidateComparison();
    if (side === "left") {
      setAnchorRegion(null);
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
    if (!result || !canCompare || result.diff_threshold === diffThreshold) return undefined;
    const timer = window.setTimeout(() => {
      rethreshold(diffThreshold);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [diffThreshold, result, canCompare]);

  function selectCategory(nextCategory) {
    setCategory(nextCategory);
    invalidateComparison();
  }

  function selectAnchorRegion(region) {
    setAnchorRegion(region);
    invalidateComparison();
  }

  function clearAnchorRegion() {
    setAnchorRegion(null);
    invalidateComparison();
  }

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
      if (anchorRegion) {
        form.append("anchor_region", JSON.stringify(anchorRegion));
      }
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

  async function rethreshold(threshold) {
    if (!result) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBusy(true);
    setError("");
    try {
      const payload = result.result_id
        ? { result_id: result.result_id, diff_threshold: threshold }
        : {
            image_a: result.image_a,
            image_b_aligned: result.image_b_aligned,
            diff_threshold: threshold,
          };
      let nextDiff;
      try {
        nextDiff = await postJson("/rediff", payload);
      } catch (err) {
        if (err.status !== 404 || !result.image_a || !result.image_b_aligned) throw err;
        nextDiff = await postJson("/rediff", {
          image_a: result.image_a,
          image_b_aligned: result.image_b_aligned,
          diff_threshold: threshold,
        });
      }
      if (requestId === requestIdRef.current) {
        setResult((current) => (current ? { ...current, ...nextDiff } : current));
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
        <button className="primary secondary" disabled={!result} onClick={() => openDiffMemoTab(result, left, right, setError)}>
          <PanelTopOpen size={18} />
          差分メモ
        </button>
        <div className="control">
          <span>カテゴリ</span>
          <div className="segmented">
            {CATEGORIES.map((item) => (
              <button key={item} className={category === item ? "active" : ""} onClick={() => selectCategory(item)}>
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
        <div className="control anchor-control">
          <span>基準領域</span>
          <button className={`anchor-status ${anchorRegion ? "selected" : ""}`} disabled={!left?.regions?.length} onClick={clearAnchorRegion}>
            {anchorRegion ? <X size={16} /> : <MousePointer2 size={16} />}
            {anchorRegion ? `${anchorRegion.label}を使用` : `${left?.regions?.length ?? 0}候補`}
          </button>
        </div>
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
          regions={left?.regions ?? []}
          selectedRegion={anchorRegion}
          onSelectRegion={selectAnchorRegion}
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
          regions={[]}
          selectedRegion={null}
          onActivate={setActiveSide}
          onPasteImage={pasteImage}
        />
      </section>
    </main>
  );
}

function MemoDiffApp() {
  const [payload, setPayload] = useState(null);
  const [loadingPayload, setLoadingPayload] = useState(true);
  const [slider, setSlider] = useState(50);
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [notice, setNotice] = useState("");
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const sliderDragRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readMemoPayload(memoPayloadIdFromHash()).then((nextPayload) => {
      if (cancelled) return;
      setPayload(nextPayload);
      setLoadingPayload(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    function moveNote(event) {
      if (sliderDragRef.current) {
        updateSliderFromPointer(event);
      }
      if (!dragRef.current || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const x = clamp(((event.clientX - rect.left - dragRef.current.offsetX) / rect.width) * 100, 0, 88);
      const y = clamp(((event.clientY - rect.top - dragRef.current.offsetY) / rect.height) * 100, 0, 82);
      setNotes((items) => items.map((item) => (item.id === dragRef.current.id ? { ...item, x, y } : item)));
    }
    function stopDrag() {
      dragRef.current = null;
      sliderDragRef.current = false;
    }
    window.addEventListener("pointermove", moveNote);
    window.addEventListener("pointerup", stopDrag);
    return () => {
      window.removeEventListener("pointermove", moveNote);
      window.removeEventListener("pointerup", stopDrag);
    };
  }, []);

  if (loadingPayload || !payload) {
    return (
      <main className="memo-page">
        <div className="memo-empty">
          <h1>差分メモ</h1>
          <p>{loadingPayload ? "比較結果を読み込んでいます。" : "比較結果が見つかりません。元の画面で比較してから「差分メモ」を開いてください。"}</p>
        </div>
      </main>
    );
  }

  const imageA = toDataUri(payload.imageA);
  const imageB = toDataUri(payload.imageB);

  function addNote() {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    const next = { id, text: "めも", x: 42, y: 12 };
    setNotes((items) => [...items, next]);
    setSelectedNoteId(id);
  }

  function updateNote(id, text) {
    setNotes((items) => items.map((item) => (item.id === id ? { ...item, text } : item)));
  }

  function deleteNote(id) {
    setNotes((items) => items.filter((item) => item.id !== id));
    setSelectedNoteId((current) => (current === id ? null : current));
  }

  function startDrag(event, note) {
    if (event.target.tagName === "TEXTAREA" || event.target.tagName === "BUTTON") return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { id: note.id, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setSelectedNoteId(note.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function startSliderDrag(event) {
    if (event.target.closest(".memo-note")) return;
    sliderDragRef.current = true;
    updateSliderFromPointer(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updateSliderFromPointer(event) {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setSlider(Math.round(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100)));
  }

  async function copyMemoImage(side) {
    try {
      await copyImageWithNotes(side === "a" ? imageA : imageB, notes);
      setContextMenu(null);
      setNotice(`画像${side.toUpperCase()}をメモ付きでクリップボードに保存しました`);
      window.setTimeout(() => setNotice(""), 2400);
    } catch (err) {
      setContextMenu(null);
      setNotice(err.message);
    }
  }

  return (
    <main className="memo-page" onContextMenu={(event) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    }}>
      <header className="memo-header">
        <div>
          <h1>差分メモ</h1>
          <p>{payload.nameA ?? "画像A"} / {payload.nameB ?? "画像B"}</p>
        </div>
        <button className="primary" onClick={addNote}>
          <MessageSquarePlus size={18} />
          メモ追加
        </button>
      </header>

      <section className="memo-toolbar">
        <label className="control slider-control">
          <span>A / B {slider}%</span>
          <input type="range" min="0" max="100" value={slider} onChange={(event) => setSlider(Number(event.target.value))} />
        </label>
        {notice && <span className="copy-notice">{notice}</span>}
      </section>

      <section className="memo-stage-wrap">
        <div className="memo-stage" ref={stageRef} onPointerDown={startSliderDrag}>
          <img className="memo-image memo-image-a" src={imageA} alt="画像A" draggable="false" />
          <div className="memo-image-b-clip" style={{ clipPath: `inset(0 0 0 ${slider}%)` }}>
            <img className="memo-image" src={imageB} alt="画像B" draggable="false" />
          </div>
          <div className="comparison-handle" style={{ left: `${slider}%` }}>
            <span>A</span>
            <span>B</span>
          </div>
          {notes.map((note) => (
            <div
              key={note.id}
              className={`memo-note ${selectedNoteId === note.id ? "selected" : ""}`}
              style={{ left: `${note.x}%`, top: `${note.y}%` }}
              onPointerDown={(event) => startDrag(event, note)}
            >
              <textarea
                value={note.text}
                aria-label="メモ本文"
                onFocus={() => setSelectedNoteId(note.id)}
                onChange={(event) => updateNote(note.id, event.target.value)}
              />
              <button title="メモ削除" onClick={() => deleteNote(note.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button onClick={() => copyMemoImage("a")}>画像Aをメモ付きでクリップボードに保存</button>
          <button onClick={() => copyMemoImage("b")}>画像Bをメモ付きでクリップボードに保存</button>
        </div>
      )}
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

function ImagePane({
  title,
  side,
  active,
  subtitle,
  image,
  zoom,
  regions = [],
  selectedRegion,
  onSelectRegion,
  onActivate,
  onPasteImage,
}) {
  const [imageSize, setImageSize] = useState(null);
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
          <div className="image-stage" style={{ width: `${zoom * 100}%` }}>
            <img
              src={image}
              alt={title}
              onLoad={(event) =>
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
            {imageSize && regions.length > 0 && (
              <div className="region-layer" aria-label="基準領域候補">
                {regions.map((region, index) => (
                  <button
                    key={`${region.x}-${region.y}-${region.width}-${region.height}-${index}`}
                    className={`region-box ${isSameRegion(region, selectedRegion) ? "selected" : ""}`}
                    title={`${region.label} (${region.width}x${region.height})`}
                    style={regionStyle(region, imageSize)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectRegion?.(region);
                    }}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
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
    throw apiError(body.detail || `API error: ${response.status}`, response.status);
  }
  return body;
}

async function postJson(path, payload) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw apiError(body.detail || `API error: ${response.status}`, response.status);
  }
  return body;
}

function apiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
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

function regionStyle(region, imageSize) {
  return {
    left: `${(region.x / imageSize.width) * 100}%`,
    top: `${(region.y / imageSize.height) * 100}%`,
    width: `${(region.width / imageSize.width) * 100}%`,
    height: `${(region.height / imageSize.height) * 100}%`,
  };
}

function isSameRegion(a, b) {
  return Boolean(
    a &&
      b &&
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height &&
      a.label === b.label,
  );
}

async function openDiffMemoTab(result, left, right, onError) {
  const payload = {
    imageA: result.image_a,
    imageB: result.image_b_aligned,
    nameA: left?.file?.name,
    nameB: right?.file?.name,
  };
  const id = crypto.randomUUID?.() ?? String(Date.now());
  try {
    await storeMemoPayload(id, payload);
    window.open(`${window.location.origin}${window.location.pathname}#diff-memo/${id}`, "_blank", "noopener,noreferrer");
  } catch (err) {
    onError?.(`差分メモを開けませんでした: ${err.message}`);
  }
}

async function storeMemoPayload(id, payload) {
  try {
    const db = await openMemoDb();
    await idbRequest(db.transaction(MEMO_DB_STORE, "readwrite").objectStore(MEMO_DB_STORE).put({ id, payload, createdAt: Date.now() }));
  } catch {
    localStorage.setItem(`${MEMO_STORAGE_KEY}:${id}`, JSON.stringify(payload));
  }
}

async function readMemoPayload(id) {
  if (!id) return null;
  try {
    const db = await openMemoDb();
    const record = await idbRequest(db.transaction(MEMO_DB_STORE, "readonly").objectStore(MEMO_DB_STORE).get(id));
    if (record?.payload) return record.payload;
  } catch {
    // Fall back to localStorage below.
  }
  try {
    const raw = localStorage.getItem(`${MEMO_STORAGE_KEY}:${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function openMemoDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(MEMO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(MEMO_DB_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open memo storage"));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Memo storage request failed"));
  });
}

function memoPayloadIdFromHash() {
  const [, id] = window.location.hash.match(/^#diff-memo\/(.+)$/) ?? [];
  return id ? decodeURIComponent(id) : null;
}

async function copyImageWithNotes(imageSrc, notes) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("このブラウザでは画像のクリップボード保存に対応していません");
  }
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  drawNotes(ctx, notes, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("メモ付き画像を作成できませんでした");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function drawNotes(ctx, notes, width, height) {
  notes.forEach((note) => {
    const text = note.text.trim() || "めも";
    const scale = Math.max(1, Math.min(width, height) / 900);
    const x = (note.x / 100) * width;
    const y = (note.y / 100) * height;
    ctx.save();
    ctx.font = `700 ${24 * scale}px sans-serif`;
    const labelWidth = 180 * scale;
    const lines = wrapCanvasText(ctx, text, labelWidth - 28 * scale);
    const labelHeight = Math.max(52 * scale, (lines.length * 28 + 24) * scale);
    ctx.fillStyle = "#ff1d14";
    roundedRect(ctx, x, y, labelWidth, labelHeight, 10 * scale);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + labelWidth * 0.46, y + labelHeight - 2 * scale);
    ctx.lineTo(x - 92 * scale, y + 205 * scale);
    ctx.lineTo(x + labelWidth * 0.68, y + labelHeight - 2 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(line, x + labelWidth / 2, y + 13 * scale + index * 28 * scale, labelWidth - 24 * scale);
    });
    ctx.restore();
  });
}

function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of Array.from(paragraph || " ")) {
      const candidate = `${line}${char}`;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした"));
    image.src = src;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function Root() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route.startsWith("#diff-memo") ? <MemoDiffApp /> : <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
