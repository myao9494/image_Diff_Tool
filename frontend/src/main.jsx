/**
 * 画像差分ツールのメインUIコンポーネント
 *
 * ユーザーが2つの画像（またはPDF/TIFF等）を選択し、
 * バックエンドのAPIに送信して差分比較を行うための機能を提供する。
 * 比較結果は「元画像」「補正B」「差分」「マスク」の各ビューで切り替えて表示できる。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BookOpenText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  FolderGit2,
  FolderOpen,
  ImageUp,
  Layers,
  Loader2,
  Menu,
  MessageSquarePlus,
  MousePointer2,
  PanelTopOpen,
  RefreshCw,
  ScanSearch,
  Settings2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const CATEGORIES = ["汎用", "図面", "グラフ", "書類"];
const VIEWS = [
  { id: "original", label: "元画像" },
  { id: "aligned", label: "補正B" },
  { id: "overlay", label: "差分" },
  { id: "mask", label: "マスク" },
];
const TAB_TOGGLE_VIEWS = ["aligned", "overlay"];
const MEMO_DB_NAME = "visual-diff-memo";
const MEMO_DB_STORE = "payloads";
const MEMO_STORAGE_KEY = "visual-diff-memo-fallback";
const CLIPBOARD_IMAGE_SCALE = 2;
const DEFAULT_TEXT_EXTENSIONS = [".md", ".txt", ".csv", ".json", ".yaml", ".yml"];
const GIT_EXTENSION_STORAGE_KEY = "visual-diff-git-text-extensions";
const GIT_TEXT_MEMO_STORAGE_KEY = "visual-diff-git-text-memos";
const GIT_FOLDER_HISTORY_STORAGE_KEY = "visual-diff-git-folder-history";
const MEMO_DEFAULTS = {
  text: "めも",
  opacity: 60,
  fontSize: 15,
  width: 180,
  height: 52,
  autoSize: true,
  leaderX: 18,
  leaderY: 46,
  leaderEndX: -73,
  leaderEndY: 163,
};
const MEMO_EXTRA_LEADER_DEFAULT = {
  leaderX: 162,
  leaderY: 46,
  leaderEndX: 275,
  leaderEndY: 163,
};

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [extensionSettingsOpen, setExtensionSettingsOpen] = useState(false);
  const [textExtensions, setTextExtensions] = useState(loadTextExtensions);
  const [extensionDraft, setExtensionDraft] = useState(() => loadTextExtensions().join(", "));
  const [activeTab, setActiveTab] = useState("files");
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
  const [gitFolder, setGitFolder] = useState(loadLastGitFolder);
  const [gitFolderHistory, setGitFolderHistory] = useState(loadGitFolderHistory);
  const [gitInfo, setGitInfo] = useState(null);
  const [gitIndex, setGitIndex] = useState(0);
  const [gitResult, setGitResult] = useState(null);
  const [gitItem, setGitItem] = useState(null);
  const [gitTextMemos, setGitTextMemos] = useState(loadGitTextMemos);
  const [gitExportExcluded, setGitExportExcluded] = useState([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [exportSelectionOpen, setExportSelectionOpen] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitError, setGitError] = useState("");
  const requestIdRef = useRef(0);
  const gitRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef({ left: 0, right: 0 });

  const canCompare = Boolean(left?.file instanceof File && right?.file instanceof File);
  const comparableGitFiles = useMemo(() => (gitInfo?.files ?? []).filter((file) => file.comparable), [gitInfo]);
  const exportableGitFiles = useMemo(
    () => comparableGitFiles.filter((file) => !gitExportExcluded.includes(file.path)),
    [comparableGitFiles, gitExportExcluded],
  );
  const currentGitFile = comparableGitFiles[gitIndex] ?? null;
  const currentTextMemoKey = currentGitFile && gitInfo ? gitMemoKey(gitInfo.repo_root, currentGitFile.path) : "";
  const currentTextMemo = currentTextMemoKey ? gitTextMemos[currentTextMemoKey] ?? "" : "";
  const activeResult = activeTab === "git" ? gitResult : result;
  const leftPreviewImage = left?.preview ? toDataUri(left.preview) : null;
  const rightPreviewImage = right?.preview ? toDataUri(right.preview) : null;
  const rightImage = useMemo(() => {
    if (!activeResult) return null;
    if (view === "original") return toDataUri(activeResult.image_b_original ?? activeResult.image_b_aligned);
    if (view === "aligned") return toDataUri(activeResult.image_b_aligned);
    if (view === "mask") return toDataUri(activeResult.mask);
    return toDataUri(activeResult.overlay);
  }, [activeResult, view]);
  const leftImage = useMemo(() => {
    if (!activeResult) return activeTab === "git" ? (gitItem?.image_head ? toDataUri(gitItem.image_head) : null) : leftPreviewImage;
    if (view === "original") return toDataUri(activeResult.image_a_original ?? activeResult.image_a);
    return toDataUri(activeResult.image_a);
  }, [activeResult, activeTab, gitItem, leftPreviewImage, view]);
  const rightPaneTitle = activeResult
    ? view === "original"
      ? "B 元画像"
      : view === "overlay"
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
    const resultId = externalResultIdFromLocation();
    if (!resultId) return;
    setActiveTab("files");
    setBusy(true);
    setError("");
    getJson(`/diff/${encodeURIComponent(resultId)}?diff_threshold=${encodeURIComponent(diffThreshold)}`)
      .then((cachedResult) => {
        setResult(cachedResult);
        setLeft(externalFileData("A", cachedResult));
        setRight(externalFileData("B", cachedResult));
        setPageA(cachedResult.page_a ?? 0);
        setPageB(cachedResult.page_b ?? 0);
        setCategory(cachedResult.category ?? "汎用");
        setView("overlay");
      })
      .catch((err) => {
        setError(err.status === 404 ? "差分結果のキャッシュが見つかりません。もう一度 /api/diff を実行してください。" : err.message);
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  useEffect(() => {
    if (activeTab === "files" && (!result || (!canCompare && result.alignment?.method !== "cached") || result.diff_threshold === diffThreshold)) return undefined;
    if (activeTab === "git" && (!gitResult || gitResult.diff_threshold === diffThreshold)) return undefined;
    const timer = window.setTimeout(() => {
      rethreshold(diffThreshold, activeTab);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [diffThreshold, result, gitResult, canCompare, activeTab]);

  useEffect(() => {
    function handleGitKeys(event) {
      if (activeTab !== "git" || isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectGitIndex(gitIndex - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        selectGitIndex(gitIndex + 1);
      }
    }
    window.addEventListener("keydown", handleGitKeys);
    return () => window.removeEventListener("keydown", handleGitKeys);
  }, [activeTab, gitIndex, comparableGitFiles]);

  useEffect(() => {
    function handleResultViewKeys(event) {
      if (!activeResult || isTypingTarget(event.target) || event.key !== "Tab") return;
      event.preventDefault();
      setView((currentView) => {
        const currentIndex = TAB_TOGGLE_VIEWS.indexOf(currentView);
        if (event.shiftKey) {
          return currentIndex === 0 ? TAB_TOGGLE_VIEWS[1] : TAB_TOGGLE_VIEWS[0];
        }
        return currentIndex === 1 ? TAB_TOGGLE_VIEWS[0] : TAB_TOGGLE_VIEWS[1];
      });
    }
    window.addEventListener("keydown", handleResultViewKeys);
    return () => window.removeEventListener("keydown", handleResultViewKeys);
  }, [activeResult]);

  useEffect(() => {
    persistLocalStorage(GIT_EXTENSION_STORAGE_KEY, textExtensions);
  }, [textExtensions]);

  useEffect(() => {
    persistLocalStorage(GIT_FOLDER_HISTORY_STORAGE_KEY, gitFolderHistory);
  }, [gitFolderHistory]);

  useEffect(() => {
    persistLocalStorage(GIT_TEXT_MEMO_STORAGE_KEY, gitTextMemos);
  }, [gitTextMemos]);

  function selectCategory(nextCategory) {
    setCategory(nextCategory);
    invalidateComparison();
    if (activeTab === "git" && currentGitFile?.kind === "image" && currentGitFile.diffable) {
      const requestId = gitRequestIdRef.current + 1;
      gitRequestIdRef.current = requestId;
      setGitResult(null);
      setGitItem(null);
      setGitBusy(true);
      setGitError("");
      compareGitFile(currentGitFile, requestId, nextCategory)
        .catch((err) => {
          if (requestId === gitRequestIdRef.current) setGitError(err.message);
        })
        .finally(() => {
          if (requestId === gitRequestIdRef.current) setGitBusy(false);
        });
    } else {
      setGitResult(null);
    }
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

  async function rethreshold(threshold, target = "files") {
    const sourceResult = target === "git" ? gitResult : result;
    if (!sourceResult) return;
    const requestId = target === "git" ? gitRequestIdRef.current + 1 : requestIdRef.current + 1;
    if (target === "git") {
      gitRequestIdRef.current = requestId;
      setGitBusy(true);
      setGitError("");
    } else {
      requestIdRef.current = requestId;
      setBusy(true);
      setError("");
    }
    try {
      const payload = sourceResult.result_id
        ? { result_id: sourceResult.result_id, diff_threshold: threshold }
        : {
            image_a: sourceResult.image_a,
            image_b_aligned: sourceResult.image_b_aligned,
            diff_threshold: threshold,
          };
      let nextDiff;
      try {
        nextDiff = await postJson("/rediff", payload);
      } catch (err) {
        if (err.status !== 404 || !sourceResult.image_a || !sourceResult.image_b_aligned) throw err;
        nextDiff = await postJson("/rediff", {
          image_a: sourceResult.image_a,
          image_b_aligned: sourceResult.image_b_aligned,
          diff_threshold: threshold,
        });
      }
      if (target === "git" && requestId === gitRequestIdRef.current) {
        setGitResult((current) => (current ? { ...current, ...nextDiff } : current));
      }
      if (target === "files" && requestId === requestIdRef.current) {
        setResult((current) => (current ? { ...current, ...nextDiff } : current));
      }
    } catch (err) {
      if (target === "git" && requestId === gitRequestIdRef.current) {
        setGitError(err.message);
      }
      if (target === "files" && requestId === requestIdRef.current) {
        setError(err.message);
      }
    } finally {
      if (target === "git" && requestId === gitRequestIdRef.current) {
        setGitBusy(false);
      }
      if (target === "files" && requestId === requestIdRef.current) {
        setBusy(false);
      }
    }
  }

  return (
    <main className={activeTab === "git" && currentGitFile?.kind === "text" ? "text-diff-mode" : ""}>
      <header className="app-header">
        <div className="header-main">
          <h1>Visual Diff Tool</h1>
          <nav className="mode-tabs" aria-label="diff mode">
            <button className={activeTab === "files" ? "active" : ""} onClick={() => setActiveTab("files")}>
              <ImageUp size={18} />
              ファイル差分
            </button>
            <button className={activeTab === "git" ? "active" : ""} onClick={() => setActiveTab("git")}>
              <FolderGit2 size={18} />
              git差分
            </button>
          </nav>
        </div>
        <div className="header-menu">
          <button className="menu-button" type="button" aria-label="メニュー" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <Menu size={22} />
          </button>
          {menuOpen && (
            <div className="hamburger-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => setExtensionSettingsOpen((open) => !open)}
              >
                <Settings2 size={18} />
                Git対象拡張子
                <span>{extensionSettingsOpen ? "閉じる" : "設定"}</span>
              </button>
              {extensionSettingsOpen && (
                <div className="extension-settings">
                  <label>
                    <span>テキスト拡張子（カンマ区切り）</span>
                    <textarea value={extensionDraft} onChange={(event) => setExtensionDraft(event.target.value)} />
                  </label>
                  <small>画像形式は常に対象です。設定はこのブラウザに保存されます。</small>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = normalizeTextExtensions(extensionDraft);
                        setTextExtensions(next);
                        setExtensionDraft(next.join(", "));
                        setGitInfo(null);
                        setGitResult(null);
                        setGitItem(null);
                      }}
                    >
                      適用
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExtensionDraft(DEFAULT_TEXT_EXTENSIONS.join(", "));
                        setTextExtensions(DEFAULT_TEXT_EXTENSIONS);
                      }}
                    >
                      初期値
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  window.open("/api-guide", "_blank", "noopener,noreferrer");
                }}
              >
                <BookOpenText size={18} />
                APIエンドポイント説明
                <ExternalLink size={16} />
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="toolbar" aria-label="compare settings">
        {activeTab === "files" ? (
          <>
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
              onDropFile={(file) => loadFile("left", file)}
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
              onDropFile={(file) => loadFile("right", file)}
            />
            <button className="primary" disabled={!canCompare || busy} onClick={() => compare()}>
              {busy ? <Loader2 className="spin" size={18} /> : <ScanSearch size={18} />}
              比較
            </button>
            <button className="primary secondary" disabled={!result} onClick={() => openDiffMemoTab(result, left, right, setError)}>
              <PanelTopOpen size={18} />
              差分メモ
            </button>
          </>
        ) : (
          <GitToolbar
            folder={gitFolder}
            folderHistory={gitFolderHistory}
            setFolder={(value) => {
              gitRequestIdRef.current += 1;
              setGitFolder(value);
              setGitInfo(null);
              setGitIndex(0);
              setGitResult(null);
              setGitItem(null);
              setGitExportExcluded([]);
              setGitError("");
              setExportNotice("");
              setGitBusy(false);
            }}
            info={gitInfo}
            files={comparableGitFiles}
            currentFile={currentGitFile}
            index={gitIndex}
            busy={gitBusy}
            onLoad={loadGitImages}
            onPrevious={() => selectGitIndex(gitIndex - 1)}
            onNext={() => selectGitIndex(gitIndex + 1)}
            onSelect={(index) => selectGitIndex(index)}
            onSelectFolder={(value) => {
              gitRequestIdRef.current += 1;
              setGitFolder(value);
              setGitInfo(null);
              setGitIndex(0);
              setGitResult(null);
              setGitItem(null);
              setGitExportExcluded([]);
              setGitError("");
              setExportNotice("");
              setGitBusy(false);
            }}
            onMemo={() => openGitMemo()}
            canMemo={currentGitFile?.kind === "image" && Boolean(gitResult || gitItem?.image_head || gitItem?.image_current)}
            onExport={exportGitHtml}
            canExport={Boolean(exportableGitFiles.length)}
            exportBusy={exportBusy}
            onOpenExportSelection={() => setExportSelectionOpen(true)}
            exportCount={exportableGitFiles.length}
          />
        )}
        {activeTab === "git" && exportSelectionOpen && (
          <ExportSelectionModal
            files={comparableGitFiles}
            excludedPaths={gitExportExcluded}
            busy={gitBusy || exportBusy}
            onToggle={(path, included) => setGitExportExcluded((paths) => included
              ? paths.filter((item) => item !== path)
              : [...new Set([...paths, path])])}
            onIncludeAll={() => setGitExportExcluded([])}
            onExcludeAll={() => setGitExportExcluded(comparableGitFiles.map((file) => file.path))}
            onClose={() => setExportSelectionOpen(false)}
          />
        )}
        {(activeTab === "files" || currentGitFile?.kind === "image") && <div className="control">
          <span>カテゴリ</span>
          <div className="segmented">
            {CATEGORIES.map((item) => (
              <button key={item} className={category === item ? "active" : ""} onClick={() => selectCategory(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>}
        {(activeTab === "files" || currentGitFile?.kind === "image") && <div className="control">
          <span>表示</span>
          <div className="segmented">
            {VIEWS.map((item) => (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>}
        {(activeTab === "files" || currentGitFile?.kind === "image") && <label className="control threshold-control">
          <span>差分しきい値 {diffThreshold.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={diffThreshold}
            onChange={(event) => setDiffThreshold(Number(event.target.value))}
          />
        </label>}
        {activeTab === "files" && <div className="control anchor-control">
          <span>基準領域</span>
          <button className={`anchor-status ${anchorRegion ? "selected" : ""}`} disabled={!left?.regions?.length} onClick={clearAnchorRegion}>
            {anchorRegion ? <X size={16} /> : <MousePointer2 size={16} />}
            {anchorRegion ? `${anchorRegion.label}を使用` : `${left?.regions?.length ?? 0}候補`}
          </button>
        </div>}
        {(activeTab === "files" || currentGitFile?.kind === "image") && <div className="icon-group" aria-label="zoom">
          <button title="縮小" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}>
            <ZoomOut size={18} />
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button title="拡大" onClick={() => setZoom((value) => Math.min(3, value + 0.1))}>
            <ZoomIn size={18} />
          </button>
        </div>}
      </section>

      {exportNotice && <div className="notice success">{exportNotice}</div>}

      {(activeTab === "git" ? gitError : error) && (
        <div className="notice error">
          <AlertTriangle size={18} />
          {activeTab === "git" ? gitError : error}
        </div>
      )}

      {activeResult?.alignment?.warning && (
        <div className="notice warning">
          <AlertTriangle size={18} />
          位置合わせ失敗、未補正で表示中: {activeResult.alignment.warning}
        </div>
      )}

      {activeResult?.conversion_warnings?.length > 0 && (
        <div className="notice warning">
          <AlertTriangle size={18} />
          変換時の注意: {activeResult.conversion_warnings.join(" / ")}
        </div>
      )}

      {(activeTab === "files" || currentGitFile?.kind === "image") && <section className="summary">
        <Stat label="差分ピクセル" value={activeResult ? activeResult.diff_pixels.toLocaleString() : "-"} />
        <Stat label="差分率" value={activeResult ? `${(activeResult.diff_ratio * 100).toFixed(3)}%` : "-"} />
        <Stat label="しきい値" value={activeResult ? activeResult.diff_threshold.toFixed(2) : diffThreshold.toFixed(2)} />
        <Stat label="マッチ数" value={activeResult ? `${activeResult.alignment.matches} / ${activeResult.alignment.inliers}` : "-"} />
        <Stat label="矩形" value={activeResult ? activeResult.diff_rects.length : "-"} />
      </section>}

      {activeTab === "git" && currentGitFile?.kind === "text" ? (
        <TextDiffView
          file={currentGitFile}
          item={gitItem}
          memo={currentTextMemo}
          onMemoChange={(value) => setGitTextMemos((current) => ({ ...current, [currentTextMemoKey]: value }))}
        />
      ) : <section className="viewer">
        <ImagePane
          title={activeTab === "git" ? "HEAD" : "A 基準"}
          side="left"
          active={activeSide === "left"}
          subtitle={activeTab === "git" ? currentGitFile?.head_path : left?.file?.name}
          image={leftImage}
          zoom={zoom}
          regions={activeTab === "git" || (activeResult && view !== "original") ? [] : left?.regions ?? []}
          selectedRegion={anchorRegion}
          onSelectRegion={selectAnchorRegion}
          onActivate={setActiveSide}
          onPasteImage={pasteImage}
          onDropFile={(file) => loadFile("left", file)}
        />
        <ImagePane
          title={rightPaneTitle}
          side="right"
          active={activeSide === "right"}
          subtitle={activeTab === "git" ? currentGitFile?.path : right?.file?.name}
          image={activeResult ? rightImage : activeTab === "git" ? (gitItem?.image_current ? toDataUri(gitItem.image_current) : null) : rightPreviewImage}
          zoom={zoom}
          regions={[]}
          selectedRegion={null}
          onActivate={setActiveSide}
          onPasteImage={pasteImage}
          onDropFile={(file) => loadFile("right", file)}
        />
      </section>}
    </main>
  );

  async function loadGitImages() {
    const requestId = gitRequestIdRef.current + 1;
    gitRequestIdRef.current = requestId;
    setGitBusy(true);
    setGitError("");
    setGitResult(null);
    setGitItem(null);
    try {
      const info = await postJson("/git/files", { folder: gitFolder, text_extensions: textExtensions });
      if (requestId !== gitRequestIdRef.current) return;
      setGitInfo(info);
      const normalizedFolder = gitFolder.trim();
      if (normalizedFolder) {
        setGitFolderHistory((history) => [normalizedFolder, ...history.filter((item) => item !== normalizedFolder)].slice(0, 12));
      }
      setGitExportExcluded([]);
      const nextFiles = (info.files ?? []).filter((file) => file.comparable);
      setGitIndex(0);
      if (nextFiles[0]) {
        await loadGitFile(nextFiles[0], requestId);
      }
    } catch (err) {
      if (requestId === gitRequestIdRef.current) setGitError(err.message);
    } finally {
      if (requestId === gitRequestIdRef.current) setGitBusy(false);
    }
  }

  async function selectGitIndex(nextIndex) {
    if (!comparableGitFiles.length) return;
    const wrappedIndex = (nextIndex + comparableGitFiles.length) % comparableGitFiles.length;
    setGitIndex(wrappedIndex);
    const requestId = gitRequestIdRef.current + 1;
    gitRequestIdRef.current = requestId;
    setGitBusy(true);
    setGitError("");
    setGitResult(null);
    setGitItem(null);
    try {
      await loadGitFile(comparableGitFiles[wrappedIndex], requestId);
    } catch (err) {
      if (requestId === gitRequestIdRef.current) setGitError(err.message);
    } finally {
      if (requestId === gitRequestIdRef.current) setGitBusy(false);
    }
  }

  async function compareGitFile(file, requestId = gitRequestIdRef.current, selectedCategory = category) {
    const nextResult = await postJson("/git/diff", {
      folder: gitFolder,
      path: file.path,
      head_path: file.head_path,
      category: selectedCategory,
      diff_threshold: diffThreshold,
    });
    if (requestId === gitRequestIdRef.current) {
      setGitResult(nextResult);
    }
  }

  async function loadGitFile(file, requestId = gitRequestIdRef.current) {
    if (file.kind === "image" && file.diffable) {
      await compareGitFile(file, requestId);
      return;
    }
    const nextItem = await postJson("/git/item", {
      folder: gitFolder,
      text_extensions: textExtensions,
      include_text: false,
      ...file,
    });
    if (requestId === gitRequestIdRef.current) setGitItem(nextItem);
  }

  async function openGitMemo() {
    if (!currentGitFile || !gitInfo) return;
    const fallbackImage = gitItem?.image_head ?? gitItem?.image_current;
    const memoResult = gitResult ?? (fallbackImage ? {
      image_a: gitItem?.image_head ?? fallbackImage,
      image_b_aligned: gitItem?.image_current ?? fallbackImage,
    } : null);
    if (!memoResult) return;
    const id = gitImageMemoId(gitInfo.repo_root, currentGitFile.path);
    await openDiffMemoTab(
      memoResult,
      { file: { name: `HEAD:${currentGitFile.head_path}` } },
      { file: { name: currentGitFile.path } },
      setGitError,
      id,
    );
  }

  async function exportGitHtml() {
    if (!gitInfo || !exportableGitFiles.length) return;
    setExportBusy(true);
    setExportNotice("");
    setGitError("");
    try {
      const entries = [];
      for (const file of exportableGitFiles) {
        let data;
        const isCurrent = file.path === currentGitFile?.path;
        if (isCurrent && file.kind === "image" && file.diffable && gitResult) {
          data = gitResult;
        } else if (isCurrent && gitItem) {
          data = gitItem;
        } else if (file.kind === "image" && file.diffable) {
          data = await postJson("/git/diff", {
            folder: gitFolder,
            path: file.path,
            head_path: file.head_path,
            category,
            diff_threshold: diffThreshold,
          });
        } else {
          data = await postJson("/git/item", {
            folder: gitFolder,
            text_extensions: textExtensions,
            include_text: false,
            ...file,
          });
        }
        let memo = "";
        let imageMemo = null;
        if (file.kind === "text") {
          memo = gitTextMemos[gitMemoKey(gitInfo.repo_root, file.path)] ?? "";
        } else {
          imageMemo = await readMemoPayload(gitImageMemoId(gitInfo.repo_root, file.path));
        }
        entries.push({ file, data, memo, imageMemo });
      }
      const html = await buildStandaloneGitReport(gitInfo, entries);
      downloadTextFile(html, gitReportFilename(gitInfo.repo_root), "text/html;charset=utf-8");
      setExportNotice(`HTMLを保存しました（${entries.length}件、外部接続なしで閲覧できます）`);
    } catch (err) {
      setGitError(`HTML出力に失敗しました: ${err.message}`);
    } finally {
      setExportBusy(false);
    }
  }
}

function ApiGuideApp() {
  return (
    <main className="api-guide-page">
      <header className="api-guide-header">
        <div>
          <h1>Visual Diff Tool API Guide</h1>
          <p>外部アプリやAIエージェントが本アプリのAPIを呼び出すための実装仕様</p>
        </div>
        <a className="primary secondary api-guide-openapi" href="/docs" target="_blank" rel="noreferrer">
          <ExternalLink size={18} />
          FastAPI docs
        </a>
      </header>

      <section className="api-guide-content">
        <ApiGuideSection title="基本情報">
          <ul>
            <li>Application Base URL: <code>http://127.0.0.1:8078/</code></li>
            <li>API Base URL: <code>http://127.0.0.1:8078/api</code>。各エンドポイントはこのURLに <code>/health</code>, <code>/diff</code> などを連結して呼び出す。</li>
            <li>画像データはレスポンス内で <code>{"{ mime_type: \"image/png\", data: \"...\" }"}</code> の形で返る。<code>data</code> は data URI prefix を含まないPNGのBase64文字列。</li>
            <li>アップロード上限は1ファイルあたりバックエンド設定の <code>MAX_UPLOAD_BYTES</code> に従う。上限超過時は <code>413</code>。</li>
            <li>対応入力形式: PNG, JPG/JPEG, WebP, BMP, GIF, TIFF/TIF, SVG, PDF, Excalidraw。</li>
            <li>ページ番号は0始まり。PDF/TIFFなど複数ページ形式は <code>/analyze</code> でページ一覧を取得し、選択したページを <code>page</code>, <code>page_a</code>, <code>page_b</code> に指定する。</li>
            <li>エラーは主に <code>{"{ detail: \"message\" }"}</code> 形式で返る。クライアントはHTTPステータスと <code>detail</code> を表示またはログ化する。</li>
          </ul>
        </ApiGuideSection>

        <ApiEndpoint
          method="GET"
          path="/api/health"
          purpose="バックエンドが起動してAPIを受け付けられるか確認する。"
          request="リクエストボディなし。"
          response={`{ "status": "ok" }`}
          notes="外部アプリは初期化時にこのエンドポイントを呼び、200以外ならAPI未起動として扱う。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/analyze"
          purpose="アップロードファイルの形式、ページ数、各ページのサイズ、変換時の注意を取得する。比較前の事前検査に使う。"
          request={`Content-Type: multipart/form-data
file: 対象ファイル`}
          response={`{
  "filename": "drawing.pdf",
  "format": "pdf",
  "page_count": 2,
  "pages": [
    { "index": 0, "width": 1240, "height": 1754, "warnings": [] }
  ],
  "warnings": []
}`}
          notes="Excalidrawでは未対応表現がwarningsに入る。UIや外部アプリは警告をユーザーに見せるとよい。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/convert"
          purpose="指定ページをPNG相当にラスタライズし、プレビュー画像と基準領域候補を取得する。"
          request={`Content-Type: multipart/form-data
file: 対象ファイル
page: 0始まりのページ番号。省略時は0`}
          response={`{
  "filename": "drawing.svg",
  "format": "svg",
  "page": 0,
  "width": 800,
  "height": 600,
  "image": { "mime_type": "image/png", "data": "base64..." },
  "regions": [
    { "x": 10, "y": 20, "width": 300, "height": 200, "label": "枠線候補" }
  ],
  "warnings": []
}`}
          notes="regionsは後続の/api/diffでanchor_regionとして使える。画像表示時は data:image/png;base64, をprefixとして付ける。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/diff"
          purpose="2つのファイルを指定ページで比較し、位置合わせ済み画像、差分オーバーレイ、マスク、差分矩形、差分率を返す。"
          request={`Content-Type: multipart/form-data
file_a: 基準ファイル
file_b: 比較対象ファイル
page_a: 基準ファイルのページ番号。省略時0
page_b: 比較対象ファイルのページ番号。省略時0
category: 汎用 | 図面 | グラフ | 書類。省略時 汎用
diff_threshold: 0.0から1.0の差分しきい値。省略時0.1
anchor_region: 任意。JSON文字列。例 {"x":0,"y":0,"width":800,"height":600,"label":"全体枠候補"}`}
          response={`{
  "result_id": "cache-id",
  "filename_a": "drawing-before.png",
  "filename_b": "clipboard.png",
  "page_a": 0,
  "page_b": 0,
  "category": "図面",
  "width": 800,
  "height": 600,
  "alignment": {
    "success": true,
    "method": "ORB homography",
    "warning": null,
    "matches": 120,
    "inliers": 88,
    "matrix": [[1,0,0],[0,1,0],[0,0,1]]
  },
  "image_a": { "mime_type": "image/png", "data": "base64..." },
  "image_a_original": { "mime_type": "image/png", "data": "base64..." },
  "image_b_original": { "mime_type": "image/png", "data": "base64..." },
  "image_b_aligned": { "mime_type": "image/png", "data": "base64..." },
  "overlay": { "mime_type": "image/png", "data": "base64..." },
  "mask": { "mime_type": "image/png", "data": "base64..." },
  "diff_rects": [{ "x": 100, "y": 80, "width": 40, "height": 20, "area": 800 }],
  "diff_pixels": 1234,
  "diff_ratio": 0.00257,
  "diff_threshold": 0.1,
  "conversion_warnings": []
}`}
          notes="AIや外部アプリが最初に使う中心API。result_idが返り、localhost/127.0.0.1で呼ばれた場合は、成功後にWebアプリも http://127.0.0.1:8078/?result_id=... 形式で自動表示する。巨大ペアがキャッシュ上限を超える場合、result_idはnull。差分の可視化はoverlay、二値的な差分抽出はmask、機械判定はdiff_ratioとdiff_rectsを見る。"
        />

        <ApiEndpoint
          method="GET"
          path="/api/diff/{result_id}"
          purpose="/api/diffで作成済みの短期キャッシュ結果を取得し、外部アプリからWeb画面表示へつなぐ。"
          request={`Query:
diff_threshold: 0.0から1.0の差分しきい値。省略時0.1`}
          response="/api/diff と同じ DiffResponse。"
          notes="外部アプリは /api/diff 成功後に http://127.0.0.1:8078/?result_id=cache-id を開くと、このエンドポイント経由でWebアプリが結果を表示する。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/rediff"
          purpose="位置合わせ済みの比較結果に対して、しきい値だけを変えて差分を再計算する。再アップロードや再位置合わせを避けるために使う。"
          request={`Content-Type: application/json
{
  "result_id": "/api/diffで返ったID",
  "diff_threshold": 0.4
}

cacheが失効した場合のfallback:
{
  "image_a": { "mime_type": "image/png", "data": "base64..." },
  "image_b_aligned": { "mime_type": "image/png", "data": "base64..." },
  "diff_threshold": 0.4
}`}
          response={`{
  "result_id": "cache-id",
  "overlay": { "mime_type": "image/png", "data": "base64..." },
  "mask": { "mime_type": "image/png", "data": "base64..." },
  "diff_rects": [],
  "diff_pixels": 0,
  "diff_ratio": 0,
  "diff_threshold": 0.4
}`}
          notes="404 Diff result cache expired が返った場合はfallback形式でimage_aとimage_b_alignedを送る。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/attachments"
          purpose="クリップボード由来などの一時画像をバックエンド側に保存する。比較そのものには必須ではない。"
          request={`Content-Type: multipart/form-data
file: 保存したい添付ファイル`}
          response={`{
  "filename": "clipboard.png",
  "stored_as": "generated-name.png",
  "size": 12345,
  "retention_days": 3,
  "deleted_expired": 0
}`}
          notes="保存ファイルは保持期限後にcleanup対象になる。外部アプリが一時添付の追跡をしたい場合に使う。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/git/images"
          purpose="互換用API。指定フォルダのGit差分から変更画像を一覧する。"
          request={`Content-Type: application/json
{ "folder": "/absolute/path/to/repo/or/subfolder" }`}
          response={`{
  "folder": "/absolute/path/to/repo",
  "repo_root": "/absolute/path/to/repo",
  "files": [
    {
      "path": "new.png",
      "head_path": "old.png",
      "status": "R",
      "comparable": true,
      "reason": null
    }
  ]
}`}
          notes="追加・削除など両側がそろわない画像はcomparable=falseになる。新しいUIでは画像とテキストを扱う/api/git/filesを使用する。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/git/files"
          purpose="設定された拡張子に従い、変更画像と変更テキストを追加・削除・未追跡も含めて一覧する。"
          request={`Content-Type: application/json
{ "folder": "/absolute/path/to/repo", "text_extensions": [".md", ".txt"] }`}
          response={`{
  "repo_root": "/absolute/path/to/repo",
  "files": [{
    "path": "guide.md", "head_path": "guide.md", "kind": "text",
    "change_type": "modified", "has_head": true, "has_current": true,
    "diffable": true, "comparable": true
  }]
}`}
          notes="画像拡張子は常に対象。text_extensionsは最大50件で、先頭のドットは省略できる。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/git/item"
          purpose="Git変更ファイルのHEAD側と作業フォルダ側を取得する。テキストでは左右差分行、画像ではPNGプレビューを返す。"
          request={`Content-Type: application/json
{
  "folder": "/absolute/path/to/repo", "path": "guide.md", "head_path": "guide.md",
  "kind": "text", "has_head": true, "has_current": true,
  "text_extensions": [".md", ".txt"]
}`}
          response="テキストはtext_head、text_current、rows。画像はimage_head、image_currentを返す。"
          notes="テキストはUTF-8/CP932を読み取り、5 MB・30,000行/片側を上限とする。include_text=falseなら全文フィールドを省略できる。バイナリ内容はテキストとして返さない。"
        />

        <ApiEndpoint
          method="POST"
          path="/api/git/diff"
          purpose="git管理下の現在ファイルとHEAD側画像を比較する。リネーム時は現在パスとHEAD側パスを分けて指定する。"
          request={`Content-Type: application/json
{
  "folder": "/absolute/path/to/repo/or/subfolder",
  "path": "current/path.png",
  "head_path": "head/path.png",
  "category": "汎用",
  "diff_threshold": 0.1
}`}
          response="/api/diff と同じ DiffResponse。page_a と page_b は0。"
          notes="pathとhead_pathはリポジトリ相対パス。絶対パスや..を含むパスは拒否される。"
        />

        <ApiGuideSection title="外部アプリ向け推奨フロー">
          <ol>
            <li><code>GET /api/health</code> で起動確認をする。</li>
            <li>ユーザーが通常ファイルを比較する場合は、両ファイルに <code>/api/analyze</code> を実行してページ数と警告を取得する。</li>
            <li>必要なら <code>/api/convert</code> でプレビューと <code>regions</code> を取得し、ユーザーが基準領域を選べるようにする。</li>
            <li><code>/api/diff</code> に2ファイル、ページ番号、カテゴリ、しきい値、任意の <code>anchor_region</code> を送る。</li>
            <li>結果表示には <code>image_a</code> と <code>overlay</code> または <code>image_b_aligned</code> を使う。自動判定には <code>diff_ratio</code>, <code>diff_pixels</code>, <code>diff_rects</code> を使う。</li>
            <li>しきい値だけ変更する場合は <code>/api/rediff</code> を使う。</li>
          </ol>
        </ApiGuideSection>
      </section>
    </main>
  );
}

function ApiGuideSection({ title, children }) {
  return (
    <section className="api-guide-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ApiEndpoint({ method, path, purpose, request, response, notes }) {
  return (
    <section className="api-endpoint">
      <div className="api-endpoint-title">
        <span className="api-method">{method}</span>
        <code>{path}</code>
      </div>
      <p>{purpose}</p>
      <h3>Request</h3>
      <pre>{request}</pre>
      <h3>Response</h3>
      <pre>{response}</pre>
      <h3>Notes for AI clients</h3>
      <p>{notes}</p>
    </section>
  );
}

function GitToolbar({
  folder,
  folderHistory,
  setFolder,
  onSelectFolder,
  info,
  files,
  currentFile,
  index,
  busy,
  onLoad,
  onPrevious,
  onNext,
  onSelect,
  onMemo,
  canMemo,
  onExport,
  canExport,
  exportBusy,
  onOpenExportSelection,
  exportCount,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      <label className="git-folder">
        <span>フォルダ</span>
        <div className="git-folder-input-row">
          <input
            type="text"
            value={folder}
            placeholder="/path/to/git/repo/or/subfolder"
            onChange={(event) => setFolder(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onLoad();
            }}
          />
          <button
            type="button"
            className="git-folder-history-toggle"
            title="最近使ったフォルダ"
            aria-label="最近使ったフォルダ"
            aria-expanded={historyOpen}
            disabled={!folderHistory.length}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <ChevronDown size={16} />
          </button>
          {historyOpen && folderHistory.length > 0 && (
            <div className="git-folder-history" role="listbox" aria-label="最近使ったフォルダ">
              {folderHistory.map((item) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={item === folder}
                  key={item}
                  title={item}
                  onClick={() => {
                    onSelectFolder(item);
                    setHistoryOpen(false);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      </label>
      <button className="primary" disabled={!folder || busy} onClick={onLoad}>
        {busy ? <Loader2 className="spin" size={18} /> : <FolderOpen size={18} />}
        読み込み
      </button>
      <div className="git-nav">
        <button title="前のファイル" disabled={!files.length || busy} onClick={onPrevious}>
          <ChevronLeft size={18} />
        </button>
        <select value={files.length ? index : ""} disabled={!files.length || busy} onChange={(event) => onSelect(Number(event.target.value))}>
          {files.length ? (
            files.map((file, fileIndex) => (
              <option key={file.path} value={fileIndex}>
                {fileIndex + 1}. {file.path}
              </option>
            ))
          ) : (
            <option value="">対象ファイルなし</option>
          )}
        </select>
        <button title="次のファイル" disabled={!files.length || busy} onClick={onNext}>
          <ChevronRight size={18} />
        </button>
        <button title="再読み込み" disabled={!folder || busy} onClick={onLoad}>
          <RefreshCw size={18} />
        </button>
      </div>
      <button className="primary secondary" disabled={!canMemo || busy} onClick={onMemo}>
        <MessageSquarePlus size={18} />
        画像メモ
      </button>
      <button className="primary report-button" disabled={!canExport || busy || exportBusy} onClick={onExport}>
        {exportBusy ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
        HTML保存
      </button>
      <button className="primary secondary export-selection-button" disabled={!files.length || busy || exportBusy} onClick={onOpenExportSelection}>
        HTML出力対象 ({exportCount}/{files.length})
      </button>
      <div className="git-meta">
        <strong>{currentFile?.path ?? "未選択"}</strong>
        <small>
          {info ? `${files.length}件の変更 / HTML出力 ${exportCount}件` : "git管理フォルダを指定"}
        </small>
      </div>
    </>
  );
}

function ExportSelectionModal({ files, excludedPaths, busy, onToggle, onIncludeAll, onExcludeAll, onClose }) {
  return (
    <div className="export-selection-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="export-selection-modal" role="dialog" aria-modal="true" aria-labelledby="export-selection-title">
        <header>
          <div>
            <h2 id="export-selection-title">HTML出力対象</h2>
            <p>HTMLに含める変更ファイルを選択してください。</p>
          </div>
          <button type="button" className="modal-close-button" aria-label="閉じる" onClick={onClose}>×</button>
        </header>
        <div className="export-selection-list">
          {files.length ? files.map((file) => {
            const included = !excludedPaths.includes(file.path);
            return (
              <label className="export-selection-item" key={file.path}>
                <input
                  type="checkbox"
                  checked={included}
                  disabled={busy}
                  onChange={(event) => onToggle(file.path, event.target.checked)}
                />
                <span>
                  <strong>{file.path}</strong>
                  <small>{file.kind === "text" ? "テキスト差分" : "画像差分"}</small>
                </span>
                <b className={included ? "included" : "excluded"}>{included ? "ON" : "OFF"}</b>
              </label>
            );
          }) : <p className="export-selection-empty">対象ファイルがありません。</p>}
        </div>
        <footer>
          <button type="button" onClick={onIncludeAll} disabled={busy || !files.length}>すべてON</button>
          <button type="button" onClick={onExcludeAll} disabled={busy || !files.length}>すべてOFF</button>
          <button type="button" className="primary" onClick={onClose}>閉じる</button>
        </footer>
      </section>
    </div>
  );
}

function TextDiffView({ file, item, memo, onMemoChange }) {
  return (
    <section className="text-diff-section">
      <div className="text-diff-heading">
        <div>
          <FileText size={20} />
          <strong>{file.path}</strong>
          <span className={`change-badge ${file.change_type}`}>{changeTypeLabel(file.change_type)}</span>
        </div>
        <label>
          <textarea
            aria-label="このファイルのメモ（HTMLへ出力）"
            title="このファイルのメモ（HTMLへ出力）"
            value={memo}
            placeholder="確認事項や変更理由を入力"
            onChange={(event) => onMemoChange(event.target.value)}
          />
        </label>
      </div>
      <div className="text-diff-columns" aria-label="テキスト差分">
        <div className="text-column-title">HEAD: {file.head_path}</div>
        <div className="text-column-title">作業フォルダ: {file.path}</div>
        {(item?.rows ?? []).map((row, index) => (
          <React.Fragment key={`${row.old_number ?? "x"}-${row.new_number ?? "x"}-${index}`}>
            <DiffCodeCell side="old" row={row} />
            <DiffCodeCell side="new" row={row} />
          </React.Fragment>
        ))}
        {!item && <div className="text-diff-empty">差分を読み込んでいます。</div>}
      </div>
    </section>
  );
}

function DiffCodeCell({ side, row }) {
  const number = side === "old" ? row.old_number : row.new_number;
  const text = side === "old" ? row.old : row.new;
  const segments = side === "old" ? row.old_segments : row.new_segments;
  const className = side === "old"
    ? row.kind === "delete" || row.kind === "replace" ? "removed" : row.kind === "insert" ? "added-gap" : ""
    : row.kind === "insert" || row.kind === "replace" ? "added" : row.kind === "delete" ? "removed-gap" : "";
  return (
    <div className={`diff-code-cell ${className}`}>
      <span className="line-number">{number ?? ""}</span>
      <code>{segments ? segments.map((segment, index) => (
        <mark key={index} className={segment.changed ? "changed" : ""}>{segment.text}</mark>
      )) : row.kind === "insert" || row.kind === "delete" ? <mark className="changed">{text ?? ""}</mark> : text ?? ""}</code>
    </div>
  );
}

function MemoDiffApp() {
  const [payload, setPayload] = useState(null);
  const [loadingPayload, setLoadingPayload] = useState(true);
  const [slider, setSlider] = useState(50);
  const [memoZoom, setMemoZoom] = useState(100);
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [notice, setNotice] = useState("");
  const [panning, setPanning] = useState(false);
  const stageRef = useRef(null);
  const stageWrapRef = useRef(null);
  const imageARef = useRef(null);
  const dragRef = useRef(null);
  const leaderDragRef = useRef(null);
  const sliderDragRef = useRef(false);
  const panDragRef = useRef(null);
  const safeNotes = normalizeMemoNotes(notes);
  const selectedNote = safeNotes.find((note) => note.id === selectedNoteId) ?? null;

  useEffect(() => {
    let cancelled = false;
    readMemoPayload(memoPayloadIdFromHash()).then((nextPayload) => {
      if (cancelled) return;
      setPayload(nextPayload);
      setNotes(normalizeMemoNotes(nextPayload?.notes));
      setLoadingPayload(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!payload) return undefined;
    const timer = window.setTimeout(() => {
      const rect = stageRef.current?.getBoundingClientRect();
      storeMemoPayload(memoPayloadIdFromHash(), {
        ...payload,
        notes: normalizeMemoNotes(notes),
        stageSize: rect ? { width: rect.width, height: rect.height } : payload.stageSize ?? null,
      }).catch(() => setNotice("メモをブラウザに保存できませんでした"));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [payload, notes]);

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    function handleShortcut(event) {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== "t" && key !== "l") return;
      event.preventDefault();
      if (key === "l") {
        addLeaderLine();
      } else {
        addNote();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [selectedNoteId]);

  useEffect(() => {
    function moveNote(event) {
      if (sliderDragRef.current) {
        updateSliderFromPointer(event);
      }
      if (panDragRef.current && stageWrapRef.current) {
        const { startX, startY, startLeft, startTop } = panDragRef.current;
        stageWrapRef.current.scrollLeft = startLeft - (event.clientX - startX);
        stageWrapRef.current.scrollTop = startTop - (event.clientY - startY);
        return;
      }
      if (leaderDragRef.current) {
        const { id, lineId, rect, point } = leaderDragRef.current;
        const x = clamp(event.clientX - rect.left, -420, 620);
        const y = clamp(event.clientY - rect.top, -240, 520);
        const start = snapMemoLeaderPoint({ x, y }, { width: rect.width, height: rect.height });
        setNotes((items) => normalizeMemoNotes(items).map((item) => updateMemoLeader(item, id, lineId, point, { start, end: { x, y } })));
        return;
      }
      if (!dragRef.current || !stageRef.current) return;
      const draggedNoteId = dragRef.current.id;
      const { offsetX, offsetY } = dragRef.current;
      const rect = stageRef.current.getBoundingClientRect();
      const x = clamp(((event.clientX - rect.left - offsetX) / rect.width) * 100, 0, 88);
      const y = clamp(((event.clientY - rect.top - offsetY) / rect.height) * 100, 0, 82);
      setNotes((items) => normalizeMemoNotes(items).map((item) => (item.id === draggedNoteId ? { ...item, x, y } : item)));
    }
    function stopDrag() {
      dragRef.current = null;
      leaderDragRef.current = null;
      sliderDragRef.current = false;
      if (panDragRef.current) {
        panDragRef.current = null;
        setPanning(false);
      }
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
    const next = { id, ...MEMO_DEFAULTS, x: 42, y: 12 };
    setNotes((items) => [...normalizeMemoNotes(items), next]);
    setSelectedNoteId(id);
  }

  function addLeaderLine() {
    if (!selectedNoteId) {
      const id = crypto.randomUUID?.() ?? String(Date.now());
      const lineId = crypto.randomUUID?.() ?? `${id}-line`;
      const next = {
        id,
        ...MEMO_DEFAULTS,
        x: 42,
        y: 12,
        extraLeaders: [{ id: lineId, ...MEMO_EXTRA_LEADER_DEFAULT }],
      };
      setNotes((items) => [...normalizeMemoNotes(items), next]);
      setSelectedNoteId(id);
      return;
    }
    const lineId = crypto.randomUUID?.() ?? `${selectedNoteId}-line-${Date.now()}`;
    setNotes((items) => normalizeMemoNotes(items).map((item) => (
      item.id === selectedNoteId
        ? { ...item, extraLeaders: [...item.extraLeaders, { id: lineId, ...nextExtraLeader(item.extraLeaders.length) }] }
        : item
    )));
  }

  function updateNote(id, text) {
    setNotes((items) => normalizeMemoNotes(items).map((item) => (item.id === id ? { ...item, text } : item)));
  }

  function updateNoteFields(id, fields) {
    setNotes((items) => normalizeMemoNotes(items).map((item) => (item.id === id ? { ...item, ...fields } : item)));
  }

  function deleteNote(id) {
    setNotes((items) => normalizeMemoNotes(items).filter((item) => item.id !== id));
    setSelectedNoteId((current) => (current === id ? null : current));
  }

  function startDrag(event, note) {
    if (event.target.closest("button, input, .memo-leader-handle")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { id: note.id, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setSelectedNoteId(note.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function startLeaderDrag(event, note, point) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.closest(".memo-note")?.getBoundingClientRect();
    if (!rect) return;
    leaderDragRef.current = { id: note.id, lineId: event.currentTarget.dataset.lineId ?? "primary", rect, point };
    setSelectedNoteId(note.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function startSliderDrag(event) {
    sliderDragRef.current = true;
    updateSliderFromPointer(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function startPan(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest(".memo-note, .comparison-handle, button, textarea, input, select")) return;
    if (!stageWrapRef.current) return;
    event.preventDefault();
    panDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: stageWrapRef.current.scrollLeft,
      startTop: stageWrapRef.current.scrollTop,
    };
    setPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updateSliderFromPointer(event) {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setSlider(Math.round(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100)));
  }

  function zoomMemoWithWheel(event) {
    if (event.target.closest("textarea, input, button, select")) return;
    // macOS trackpad pinch is delivered as a wheel event with ctrl/meta/alt.
    // A normal wheel event is intentionally left to the scroll container so
    // two-finger swipes pan the image instead of changing its zoom.
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setMemoZoom((current) => clamp(current + direction * 5, 10, 300));
  }

  function fitMemoToViewport() {
    const image = imageARef.current;
    const wrap = stageWrapRef.current;
    if (!image?.naturalWidth || !image?.naturalHeight || !wrap) {
      setMemoZoom(100);
      return;
    }
    const styles = window.getComputedStyle(wrap);
    const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const availableWidth = Math.max(1, wrap.clientWidth - horizontalPadding);
    const availableHeight = Math.max(1, wrap.clientHeight - verticalPadding);
    const baseWidth = availableWidth;
    const baseHeight = baseWidth * (image.naturalHeight / image.naturalWidth);
    const fitPercent = Math.min(100, (availableHeight / baseHeight) * 100);
    setMemoZoom(Math.round(clamp(fitPercent, 10, 100)));
    window.requestAnimationFrame(() => {
      if (stageWrapRef.current) {
        stageWrapRef.current.scrollLeft = 0;
        stageWrapRef.current.scrollTop = 0;
      }
    });
  }

  async function copyMemoImage(side) {
    try {
      if (side === "pair") {
        await copySideBySideImageWithNotes(imageA, imageB, safeNotes, getMemoStageSize());
      } else {
        await copyImageWithNotes(side === "a" ? imageA : imageB, safeNotes, getMemoStageSize());
      }
      setContextMenu(null);
      setNotice(side === "pair" ? "元データ / 変更後を左右配置でクリップボードに保存しました" : `画像${side.toUpperCase()}をメモ付きでクリップボードに保存しました`);
      window.setTimeout(() => setNotice(""), 2400);
    } catch (err) {
      setContextMenu(null);
      setNotice(err.message);
    }
  }

  function getMemoStageSize() {
    if (!stageRef.current) return null;
    const rect = stageRef.current.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
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
        <label className="control slider-control">
          <span>表示サイズ {memoZoom}%</span>
          <input type="range" min="10" max="300" value={memoZoom} onChange={(event) => setMemoZoom(Number(event.target.value))} />
        </label>
        <button type="button" className="memo-fit-button" onClick={fitMemoToViewport}>
          画面に合わせる
        </button>
        {notice && <span className="copy-notice">{notice}</span>}
      </section>

      {selectedNote && (
        <section className="memo-editor" aria-label="選択中メモの編集">
          <label className="control memo-text-control">
            <span>メモ本文</span>
            <textarea value={selectedNote.text} onChange={(event) => updateNote(selectedNote.id, event.target.value)} />
          </label>
          <label className="control compact-control">
            <span>メモ透過率 {selectedNote.opacity}%</span>
            <input
              type="range"
              min="20"
              max="100"
              value={selectedNote.opacity}
              onChange={(event) => updateNoteFields(selectedNote.id, { opacity: Number(event.target.value) })}
            />
          </label>
          <label className="control compact-control">
            <span>文字サイズ {selectedNote.fontSize}px</span>
            <input
              type="range"
              min="12"
              max="48"
              value={selectedNote.fontSize}
              onChange={(event) => updateNoteFields(selectedNote.id, { fontSize: Number(event.target.value) })}
            />
          </label>
          <label className="check-control">
            <input
              type="checkbox"
              checked={selectedNote.autoSize}
              onChange={(event) => updateNoteFields(selectedNote.id, { autoSize: event.target.checked })}
            />
            <span>文字数に合わせて自動調整</span>
          </label>
          <label className="control number-control">
            <span>幅</span>
            <input
              type="number"
              min="100"
              max="520"
              value={selectedNote.width}
              disabled={selectedNote.autoSize}
              onChange={(event) => updateNoteFields(selectedNote.id, { width: clamp(Number(event.target.value), 100, 520) })}
            />
          </label>
          <label className="control number-control">
            <span>高さ</span>
            <input
              type="number"
              min="44"
              max="320"
              value={selectedNote.height}
              disabled={selectedNote.autoSize}
              onChange={(event) => updateNoteFields(selectedNote.id, { height: clamp(Number(event.target.value), 44, 320) })}
            />
          </label>
          <label className="control number-control">
            <span>起点X</span>
            <input
              type="number"
              min="-420"
              max="620"
              value={Math.round(memoLeaderStart(selectedNote).x)}
              onChange={(event) => {
                const start = snapMemoLeaderPoint({ x: Number(event.target.value), y: selectedNote.leaderY }, memoSize(selectedNote));
                updateNoteFields(selectedNote.id, { leaderX: start.x, leaderY: start.y });
              }}
            />
          </label>
          <label className="control number-control">
            <span>起点Y</span>
            <input
              type="number"
              min="-240"
              max="520"
              value={Math.round(memoLeaderStart(selectedNote).y)}
              onChange={(event) => {
                const start = snapMemoLeaderPoint({ x: selectedNote.leaderX, y: Number(event.target.value) }, memoSize(selectedNote));
                updateNoteFields(selectedNote.id, { leaderX: start.x, leaderY: start.y });
              }}
            />
          </label>
          <label className="control number-control">
            <span>終点X</span>
            <input
              type="number"
              min="-420"
              max="620"
              value={Math.round(selectedNote.leaderEndX)}
              onChange={(event) => updateNoteFields(selectedNote.id, { leaderEndX: clamp(Number(event.target.value), -420, 620) })}
            />
          </label>
          <label className="control number-control">
            <span>終点Y</span>
            <input
              type="number"
              min="-240"
              max="520"
              value={Math.round(selectedNote.leaderEndY)}
              onChange={(event) => updateNoteFields(selectedNote.id, { leaderEndY: clamp(Number(event.target.value), -240, 520) })}
            />
          </label>
          <button type="button" onClick={addLeaderLine}>
            LINE追加 (L)
          </button>
        </section>
      )}

      <section className="memo-stage-wrap" ref={stageWrapRef} onWheel={zoomMemoWithWheel}>
        <div className={`memo-stage ${panning ? "panning" : ""}`} ref={stageRef} onPointerDown={startPan} style={{ width: `${memoZoom}%` }}>
          <img className="memo-image memo-image-a" ref={imageARef} src={imageA} alt="画像A" draggable="false" />
          <div className="memo-image-b-clip" style={{ clipPath: `inset(0 0 0 ${slider}%)` }}>
            <img className="memo-image" src={imageB} alt="画像B" draggable="false" />
          </div>
          <div className="comparison-handle" style={{ left: `${slider}%` }} onPointerDown={startSliderDrag}>
            <span>A</span>
            <span>B</span>
          </div>
          {safeNotes.map((note) => {
            const leaders = memoNoteLeaders(note);
            return (
              <div
                key={note.id}
                className={`memo-note ${selectedNoteId === note.id ? "selected" : ""}`}
                style={{
                  ...memoBoxStyle(note),
                  left: `${note.x}%`,
                  top: `${note.y}%`,
                  "--memo-alpha": note.opacity / 100,
                  "--memo-font-size": `${note.fontSize}px`,
                }}
                onPointerDown={(event) => startDrag(event, note)}
              >
                <svg className="memo-leader" viewBox="-420 -240 1040 760" aria-hidden="true">
                  {leaders.map((leader) => (
                    <line key={leader.id} x1={leader.start.x} y1={leader.start.y} x2={leader.endX} y2={leader.endY} />
                  ))}
                </svg>
                {leaders.map((leader, index) => (
                  <React.Fragment key={leader.id}>
                    <button
                      type="button"
                      className={`memo-leader-handle ${index > 0 ? "extra" : ""}`}
                      title="引出線の起点をドラッグ"
                      data-line-id={leader.id}
                      style={{ left: `${leader.start.x}px`, top: `${leader.start.y}px` }}
                      onPointerDown={(event) => startLeaderDrag(event, note, "start")}
                    />
                    <button
                      type="button"
                      className={`memo-leader-handle end ${index > 0 ? "extra" : ""}`}
                      title="引出線の終点をドラッグ"
                      data-line-id={leader.id}
                      style={{ left: `${leader.endX}px`, top: `${leader.endY}px` }}
                      onPointerDown={(event) => startLeaderDrag(event, note, "end")}
                    />
                  </React.Fragment>
                ))}
                <textarea
                  value={note.text}
                  aria-label="メモ本文"
                  onFocus={() => setSelectedNoteId(note.id)}
                  onChange={(event) => updateNote(note.id, event.target.value)}
                />
                <button className="memo-delete" title="メモ削除" onClick={() => deleteNote(note.id)}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button onClick={() => copyMemoImage("pair")}>元データ / 変更後を左右配置でコピー</button>
          <button onClick={() => copyMemoImage("a")}>画像Aをメモ付きでクリップボードに保存</button>
          <button onClick={() => copyMemoImage("b")}>画像Bをメモ付きでクリップボードに保存</button>
        </div>
      )}
    </main>
  );
}

function FilePicker({ label, side, active, data, page, setPage, onFile, onActivate, onPasteImage, onDropFile }) {
  const pages = data?.metadata?.pages ?? [];
  const pasted = Boolean(data?.attachment);
  const [dragging, setDragging] = useState(false);

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    onActivate(side);
    const file = firstDroppedFile(event.dataTransfer);
    if (file) onDropFile(file);
  }

  return (
    <div
      className={`file-picker ${active ? "active" : ""} ${dragging ? "dragging" : ""}`}
      tabIndex={0}
      onFocus={() => onActivate(side)}
      onClick={() => onActivate(side)}
      onPaste={(event) => onPasteImage(side, event)}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
        onActivate(side);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={handleDrop}
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
            : "選択 / ドロップ / 貼り付け"}
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
  onDropFile,
}) {
  const [imageSize, setImageSize] = useState(null);
  useEffect(() => {
    setImageSize(null);
  }, [image]);

  const [dragging, setDragging] = useState(false);

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    onActivate(side);
    const file = firstDroppedFile(event.dataTransfer);
    if (file) onDropFile?.(file);
  }

  return (
    <article
      className={`pane ${active ? "active" : ""} ${dragging ? "dragging" : ""}`}
      tabIndex={0}
      onFocus={() => onActivate(side)}
      onClick={() => onActivate(side)}
      onPaste={(event) => onPasteImage(side, event)}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
        onActivate(side);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div className="pane-title">
        <strong>{title}</strong>
        <span>{subtitle ?? "クリックしてcmd+V / ドロップ"}</span>
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

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
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

function firstDroppedFile(dataTransfer) {
  return Array.from(dataTransfer?.files ?? []).find((file) => file.size > 0) ?? null;
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

async function openDiffMemoTab(result, left, right, onError, fixedId = null) {
  const id = fixedId ?? (crypto.randomUUID?.() ?? String(Date.now()));
  const existing = fixedId ? await readMemoPayload(id) : null;
  const payload = {
    imageA: result.image_a,
    imageB: result.image_b_aligned,
    nameA: left?.file?.name,
    nameB: right?.file?.name,
    notes: existing?.notes ?? [],
    stageSize: existing?.stageSize ?? null,
  };
  try {
    await storeMemoPayload(id, payload);
    window.open(`${window.location.origin}${window.location.pathname}#diff-memo/${id}`, "_blank", "noopener,noreferrer");
  } catch (err) {
    onError?.(`差分メモを開けませんでした: ${err.message}`);
  }
}

function loadTextExtensions() {
  try {
    return normalizeTextExtensions(JSON.parse(localStorage.getItem(GIT_EXTENSION_STORAGE_KEY) || "null") ?? DEFAULT_TEXT_EXTENSIONS);
  } catch {
    return [...DEFAULT_TEXT_EXTENSIONS];
  }
}

function normalizeTextExtensions(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  return [...new Set(items.map((item) => String(item).trim().toLowerCase()).filter(Boolean).map((item) => item.startsWith(".") ? item : `.${item}`)
    .filter((item) => /^\.[a-z0-9][a-z0-9._+-]{0,15}$/.test(item)))].slice(0, 50);
}

function loadGitTextMemos() {
  try {
    const value = JSON.parse(localStorage.getItem(GIT_TEXT_MEMO_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function loadGitFolderHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(GIT_FOLDER_HISTORY_STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 12);
  } catch {
    return [];
  }
}

function loadLastGitFolder() {
  return loadGitFolderHistory()[0] ?? "";
}

function persistLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function gitMemoKey(repo, path) {
  return `${repo || "repo"}::${path}`;
}

function gitImageMemoId(repo, path) {
  const source = gitMemoKey(repo, path);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `git-image-${(hash >>> 0).toString(16)}`;
}

function changeTypeLabel(type) {
  return ({ modified: "変更", added: "追加", deleted: "削除", untracked: "未追跡", renamed: "名前変更", copied: "コピー" })[type] ?? type;
}

function gitReportFilename(repo) {
  const name = String(repo || "repository").split(/[\\/]/).filter(Boolean).pop() || "repository";
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${name}-diff-${stamp}.html`;
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildStandaloneGitReport(info, entries) {
  const sections = [];
  for (const entry of entries) {
    sections.push(entry.file.kind === "text" ? buildTextReportSection(entry) : await buildImageReportSection(entry));
  }
  const generated = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeStyle: "medium" }).format(new Date());
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>差分レポート - ${escapeHtml(info.repo_root)}</title><style>${standaloneReportCss()}</style></head>
<body><header><h1>差分レポート</h1><dl><div><dt>リポジトリ</dt><dd>${escapeHtml(info.repo_root)}</dd></div><div><dt>出力日時</dt><dd>${escapeHtml(generated)}</dd></div><div><dt>変更ファイル</dt><dd>${entries.length}件</dd></div></dl></header>
<main>${sections.join("\n")}</main><footer>Visual Diff Tool — このHTMLは画像・CSSを内包した自己完結ファイルです。</footer></body></html>`;
}

function buildTextReportSection({ file, data, memo }) {
  const rows = (data.rows ?? []).map((row) => `<div class="code-cell ${oldCellClass(row)}"${reportGapStyle(row, "old")}><span>${row.old_number ?? ""}</span><code>${reportLineHtml(row, "old")}</code></div><div class="code-cell ${newCellClass(row)}"${reportGapStyle(row, "new")}><span>${row.new_number ?? ""}</span><code>${reportLineHtml(row, "new")}</code></div>`).join("");
  return `<section><h2>${escapeHtml(file.path)} <b class="badge ${escapeHtml(file.change_type)}">${escapeHtml(changeTypeLabel(file.change_type))}</b></h2>${memo.trim() ? `<aside><strong>メモ</strong><p>${escapeHtml(memo).replaceAll("\n", "<br>")}</p></aside>` : ""}<div class="diff-grid"><h3>HEAD: ${escapeHtml(file.head_path)}</h3><h3>作業フォルダ: ${escapeHtml(file.path)}</h3>${rows || '<p class="empty-report">差分行はありません。</p>'}</div></section>`;
}

async function buildImageReportSection({ file, data, imageMemo }) {
  const head = data.image_a ?? data.image_head ?? null;
  const current = data.image_b_aligned ?? data.image_current ?? null;
  const notes = normalizeMemoNotes(imageMemo?.notes);
  const annotateHead = !current && Boolean(head);
  const headSrc = head ? (annotateHead && notes.length ? await renderImageWithNotesDataUri(toDataUri(head), notes, imageMemo?.stageSize) : toDataUri(head)) : null;
  const currentSrc = current ? (notes.length ? await renderImageWithNotesDataUri(toDataUri(current), notes, imageMemo?.stageSize) : toDataUri(current)) : null;
  const panels = [
    ["HEAD", headSrc],
    ["作業フォルダ", currentSrc],
    ["差分オーバーレイ", data.overlay ? toDataUri(data.overlay) : null],
  ].filter(([, src]) => src).map(([label, src]) => `<figure><figcaption>${label}</figcaption><img src="${src}" alt="${label}"></figure>`).join("");
  const memoList = notes.length ? `<aside><strong>画像メモ</strong><ol>${notes.map((note) => `<li>${escapeHtml(note.text)}</li>`).join("")}</ol></aside>` : "";
  return `<section><h2>${escapeHtml(file.path)} <b class="badge ${escapeHtml(file.change_type)}">${escapeHtml(changeTypeLabel(file.change_type))}</b></h2>${memoList}<div class="image-grid">${panels || '<p class="empty-report">表示できる画像がありません。</p>'}</div></section>`;
}

function oldCellClass(row) {
  return row.kind === "delete" || row.kind === "replace" ? "removed" : row.kind === "insert" ? "added-gap" : "";
}

function newCellClass(row) {
  return row.kind === "insert" || row.kind === "replace" ? "added" : row.kind === "delete" ? "removed-gap" : "";
}

function reportGapStyle(row, side) {
  if (side === "old" && row.kind === "insert") {
    return ' style="background:repeating-linear-gradient(135deg,#fff 0,#fff 6px,#dcfce7 6px,#dcfce7 12px)"';
  }
  if (side === "new" && row.kind === "delete") {
    return ' style="background:repeating-linear-gradient(135deg,#fff 0,#fff 6px,#fee2e2 6px,#fee2e2 12px)"';
  }
  return "";
}

function reportLineHtml(row, side) {
  const segments = side === "old" ? row.old_segments : row.new_segments;
  if (segments) return segments.map((segment) => segment.changed ? `<mark>${escapeHtml(segment.text)}</mark>` : escapeHtml(segment.text)).join("");
  const text = side === "old" ? row.old ?? "" : row.new ?? "";
  return row.kind === "insert" || row.kind === "delete" ? `<mark>${escapeHtml(text)}</mark>` : escapeHtml(text);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function standaloneReportCss() {
  return `:root{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#172033;background:#f1f5f9}*{box-sizing:border-box}body{margin:0}header,footer{padding:24px 5vw;background:#172033;color:#fff}header h1{margin:0 0 16px}dl{margin:0;display:flex;gap:28px;flex-wrap:wrap}dl div{display:flex;gap:8px}dt{color:#a8b3c7}dd{margin:0}main{width:min(1500px,94vw);margin:24px auto}section{margin:0 0 28px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;page-break-inside:avoid}h2{margin:0;padding:14px 18px;background:#e2e8f0;font-size:18px}.badge{margin-left:8px;padding:3px 8px;border-radius:99px;background:#64748b;color:#fff;font-size:12px}.badge.added,.badge.untracked{background:#16803b}.badge.deleted{background:#b42318}aside{margin:14px 18px;padding:12px 14px;border-left:5px solid #eab308;background:#fefce8}aside p,aside ol{margin:6px 0 0}.diff-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);overflow:auto}.diff-grid h3{position:sticky;top:0;margin:0;padding:10px 12px;background:#172033;color:#fff;font-size:13px}.code-cell{min-width:460px;display:grid;grid-template-columns:52px 1fr;border-bottom:1px solid #e2e8f0;background:#fff}.code-cell>span{padding:2px 8px;background:#f8fafc;border-right:1px solid #e2e8f0;text-align:right;color:#64748b;user-select:none}.code-cell code{padding:2px 8px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}.code-cell.removed{background:#ffebe9}.code-cell.added{background:#dafbe1}.code-cell mark{padding:0;background:#f7a8a8}.code-cell.added mark{background:#83d997}.image-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;padding:16px;background:#e2e8f0}.image-grid figure{margin:0;background:#fff;border:1px solid #94a3b8}.image-grid figcaption{padding:8px 10px;background:#172033;color:#fff;font-weight:700}.image-grid img{display:block;width:100%;height:auto}.empty-report{padding:18px}footer{text-align:center;color:#cbd5e1;font-size:12px}@media print{header{background:#fff;color:#000;border-bottom:2px solid #000}main{width:100%;margin:12px 0}.diff-grid{font-size:9px}.image-grid{grid-template-columns:1fr 1fr}footer{display:none}}`;
}

async function renderImageWithNotesDataUri(imageSrc, notes, stageSize = null) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  drawNotes(ctx, notes, canvas.width, canvas.height, stageSize);
  return canvas.toDataURL("image/png");
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

function externalResultIdFromLocation() {
  return new URLSearchParams(window.location.search).get("result_id");
}

function externalFileData(side, result) {
  const filename = side === "A" ? result.filename_a : result.filename_b;
  const page = side === "A" ? result.page_a : result.page_b;
  return {
    file: { name: filename || `API File ${side}` },
    metadata: {
      format: extensionForFilename(filename),
      page_count: Math.max(1, Number(page ?? 0) + 1),
      pages: [
        {
          index: Number(page ?? 0),
          width: result.width,
          height: result.height,
          warnings: [],
        },
      ],
      warnings: [],
    },
    external: true,
  };
}

function extensionForFilename(filename) {
  const extension = String(filename || "").split(".").pop()?.toLowerCase();
  return extension && extension !== filename ? extension : "png";
}

function isTypingTarget(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function normalizeMemoNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note) => note && typeof note === "object")
    .map((note, index) => ({
      id: note.id ? String(note.id) : `recovered-${Date.now()}-${index}`,
      text: typeof note.text === "string" ? note.text : MEMO_DEFAULTS.text,
      x: Number.isFinite(Number(note.x)) ? clamp(Number(note.x), 0, 88) : 42,
      y: Number.isFinite(Number(note.y)) ? clamp(Number(note.y), 0, 82) : 12,
      opacity: Number.isFinite(Number(note.opacity)) ? clamp(Number(note.opacity), 20, 100) : MEMO_DEFAULTS.opacity,
      fontSize: Number.isFinite(Number(note.fontSize)) ? clamp(Number(note.fontSize), 12, 48) : MEMO_DEFAULTS.fontSize,
      width: Number.isFinite(Number(note.width)) ? clamp(Number(note.width), 100, 520) : MEMO_DEFAULTS.width,
      height: Number.isFinite(Number(note.height)) ? clamp(Number(note.height), 44, 320) : MEMO_DEFAULTS.height,
      autoSize: typeof note.autoSize === "boolean" ? note.autoSize : MEMO_DEFAULTS.autoSize,
      leaderX: Number.isFinite(Number(note.leaderX)) ? clamp(Number(note.leaderX), -420, 620) : MEMO_DEFAULTS.leaderX,
      leaderY: Number.isFinite(Number(note.leaderY)) ? clamp(Number(note.leaderY), -240, 520) : MEMO_DEFAULTS.leaderY,
      leaderEndX: Number.isFinite(Number(note.leaderEndX)) ? clamp(Number(note.leaderEndX), -420, 620) : MEMO_DEFAULTS.leaderEndX,
      leaderEndY: Number.isFinite(Number(note.leaderEndY)) ? clamp(Number(note.leaderEndY), -240, 520) : MEMO_DEFAULTS.leaderEndY,
      extraLeaders: normalizeExtraMemoLeaders(note.extraLeaders),
    }));
}

function normalizeExtraMemoLeaders(leaders) {
  if (!Array.isArray(leaders)) return [];
  return leaders
    .filter((leader) => leader && typeof leader === "object")
    .map((leader, index) => ({
      id: leader.id ? String(leader.id) : `line-${Date.now()}-${index}`,
      leaderX: Number.isFinite(Number(leader.leaderX)) ? clamp(Number(leader.leaderX), -420, 620) : MEMO_EXTRA_LEADER_DEFAULT.leaderX,
      leaderY: Number.isFinite(Number(leader.leaderY)) ? clamp(Number(leader.leaderY), -240, 520) : MEMO_EXTRA_LEADER_DEFAULT.leaderY,
      leaderEndX: Number.isFinite(Number(leader.leaderEndX)) ? clamp(Number(leader.leaderEndX), -420, 620) : MEMO_EXTRA_LEADER_DEFAULT.leaderEndX,
      leaderEndY: Number.isFinite(Number(leader.leaderEndY)) ? clamp(Number(leader.leaderEndY), -240, 520) : MEMO_EXTRA_LEADER_DEFAULT.leaderEndY,
    }));
}

function memoBoxStyle(note) {
  const size = memoSize(note);
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
  };
}

function memoSize(note) {
  return note.autoSize ? calculateMemoAutoSize(note) : { width: note.width, height: note.height };
}

function memoLeaderStart(note) {
  return snapMemoLeaderPoint({ x: note.leaderX, y: note.leaderY }, memoSize(note));
}

function memoNoteLeaders(note) {
  const size = memoSize(note);
  return [
    {
      id: "primary",
      start: snapMemoLeaderPoint({ x: note.leaderX, y: note.leaderY }, size),
      endX: note.leaderEndX,
      endY: note.leaderEndY,
    },
    ...note.extraLeaders.map((leader) => ({
      id: leader.id,
      start: snapMemoLeaderPoint({ x: leader.leaderX, y: leader.leaderY }, size),
      endX: leader.leaderEndX,
      endY: leader.leaderEndY,
    })),
  ];
}

function updateMemoLeader(note, noteId, lineId, point, points) {
  if (note.id !== noteId) return note;
  const fields = point === "end"
    ? { leaderEndX: points.end.x, leaderEndY: points.end.y }
    : { leaderX: points.start.x, leaderY: points.start.y };
  if (lineId === "primary") return { ...note, ...fields };
  return {
    ...note,
    extraLeaders: note.extraLeaders.map((leader) => (leader.id === lineId ? { ...leader, ...fields } : leader)),
  };
}

function nextExtraLeader(index) {
  const offset = index * 28;
  return {
    ...MEMO_EXTRA_LEADER_DEFAULT,
    leaderY: clamp(MEMO_EXTRA_LEADER_DEFAULT.leaderY + offset, -240, 520),
    leaderEndY: clamp(MEMO_EXTRA_LEADER_DEFAULT.leaderEndY + offset, -240, 520),
  };
}

function snapMemoLeaderPoint(point, size) {
  const x = clamp(point.x, 0, size.width);
  const y = clamp(point.y, 0, size.height);
  const distances = [
    { edge: "left", value: x },
    { edge: "right", value: size.width - x },
    { edge: "top", value: y },
    { edge: "bottom", value: size.height - y },
  ];
  const nearest = distances.reduce((best, item) => (item.value < best.value ? item : best), distances[0]).edge;
  if (nearest === "left") return { x: 0, y };
  if (nearest === "right") return { x: size.width, y };
  if (nearest === "top") return { x, y: 0 };
  return { x, y: size.height };
}

function calculateMemoAutoSize(note) {
  const lines = String(note.text || MEMO_DEFAULTS.text).split("\n");
  const longestLine = Math.max(...lines.map((line) => Array.from(line || " ").length), 1);
  const width = clamp(Math.round(longestLine * note.fontSize * 0.72 + 34), 120, 420);
  const usableChars = Math.max(1, Math.floor((width - 28) / (note.fontSize * 0.72)));
  const lineCount = lines.reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line || " ").length / usableChars)), 0);
  const height = clamp(Math.round(lineCount * note.fontSize * 1.18 + 24), 44, 260);
  return { width, height };
}

async function copyImageWithNotes(imageSrc, notes, stageSize = null) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("このブラウザでは画像のクリップボード保存に対応していません");
  }
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * CLIPBOARD_IMAGE_SCALE;
  canvas.height = image.naturalHeight * CLIPBOARD_IMAGE_SCALE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawNotes(ctx, notes, canvas.width, canvas.height, stageSize);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("メモ付き画像を作成できませんでした");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

async function copySideBySideImageWithNotes(imageASrc, imageBSrc, notes, stageSize = null) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("このブラウザでは画像のクリップボード保存に対応していません");
  }
  const [imageA, imageB] = await Promise.all([loadImage(imageASrc), loadImage(imageBSrc)]);
  const padding = 24;
  const gap = 24;
  const labelHeight = 56;
  const imageTop = padding + labelHeight;
  const scaledPadding = padding * CLIPBOARD_IMAGE_SCALE;
  const scaledGap = gap * CLIPBOARD_IMAGE_SCALE;
  const scaledLabelHeight = labelHeight * CLIPBOARD_IMAGE_SCALE;
  const scaledImageTop = imageTop * CLIPBOARD_IMAGE_SCALE;
  const imageAWidth = imageA.naturalWidth * CLIPBOARD_IMAGE_SCALE;
  const imageAHeight = imageA.naturalHeight * CLIPBOARD_IMAGE_SCALE;
  const imageBWidth = imageB.naturalWidth * CLIPBOARD_IMAGE_SCALE;
  const imageBHeight = imageB.naturalHeight * CLIPBOARD_IMAGE_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = scaledPadding * 2 + imageAWidth + scaledGap + imageBWidth;
  canvas.height = scaledPadding * 2 + scaledLabelHeight + Math.max(imageAHeight, imageBHeight);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const leftX = scaledPadding;
  const rightX = scaledPadding + imageAWidth + scaledGap;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawCopyPanelLabel(ctx, "元データ", leftX, scaledPadding, imageAWidth, scaledLabelHeight);
  drawCopyPanelLabel(ctx, "変更後", rightX, scaledPadding, imageBWidth, scaledLabelHeight);
  ctx.drawImage(imageA, leftX, scaledImageTop, imageAWidth, imageAHeight);
  ctx.drawImage(imageB, rightX, scaledImageTop, imageBWidth, imageBHeight);
  ctx.save();
  ctx.translate(rightX, scaledImageTop);
  drawNotes(ctx, notes, imageBWidth, imageBHeight, stageSize);
  ctx.restore();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("左右配置の画像を作成できませんでした");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function drawCopyPanelLabel(ctx, label, x, y, width, height) {
  ctx.save();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#0f172a";
  ctx.font = `700 ${Math.max(24, Math.round(height * 0.43))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + width / 2, y + height / 2);
  ctx.restore();
}

function drawNotes(ctx, notes, width, height, stageSize = null) {
  notes.forEach((note) => {
    const text = note.text.trim() || "めも";
    const scale = stageSize?.width ? width / stageSize.width : Math.max(1, Math.min(width, height) / 900);
    const x = (note.x / 100) * width;
    const y = (note.y / 100) * height;
    const noteSize = memoSize(note);
    const leaders = memoNoteLeaders(note);
    ctx.save();
    ctx.font = `700 ${note.fontSize * scale}px sans-serif`;
    const labelWidth = noteSize.width * scale;
    const lines = wrapCanvasText(ctx, text, labelWidth - 28 * scale);
    const labelHeight = noteSize.height * scale;
    const memoAlpha = note.opacity / 100;
    ctx.fillStyle = `rgba(255, 29, 20, ${memoAlpha})`;
    ctx.strokeStyle = `rgba(255, 29, 20, ${memoAlpha})`;
    ctx.lineWidth = 6 * scale;
    ctx.lineCap = "butt";
    leaders.forEach((leader) => {
      ctx.beginPath();
      ctx.moveTo(x + leader.start.x * scale, y + leader.start.y * scale);
      ctx.lineTo(x + leader.endX * scale, y + leader.endY * scale);
      ctx.stroke();
    });
    roundedRect(ctx, x, y, labelWidth, labelHeight, 10 * scale);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(line, x + labelWidth / 2, y + 12 * scale + index * note.fontSize * 1.18 * scale, labelWidth - 24 * scale);
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
  const [route, setRoute] = useState({ hash: window.location.hash, pathname: window.location.pathname });
  useEffect(() => {
    const updateRoute = () => setRoute({ hash: window.location.hash, pathname: window.location.pathname });
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function pushState(...args) {
      originalPushState.apply(this, args);
      updateRoute();
    };
    window.history.replaceState = function replaceState(...args) {
      originalReplaceState.apply(this, args);
      updateRoute();
    };
    const onHashChange = updateRoute;
    const onPopState = updateRoute;
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
  if (route.pathname === "/api-guide") return <ApiGuideApp />;
  return route.hash.startsWith("#diff-memo") ? <MemoDiffApp /> : <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
