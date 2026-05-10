import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

let fileEntries = [];
let selectedIndex = -1;

const PREVIEW_WIDTH_KEY = "exif-renamer-preview-width";
const DEFAULT_PREVIEW_WIDTH = 280;
const MIN_PREVIEW_WIDTH = 200;
const MIN_LIST_WIDTH = 400;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function init() {
  bindButtons();
  bindDragDrop();
  bindTableEvents();
  initResizer();
  restorePreviewWidth();
}

function bindButtons() {
  $("#btn-select-files").addEventListener("click", handleSelectFiles);
  $("#btn-select-folder").addEventListener("click", handleSelectFolder);
  $("#btn-refresh").addEventListener("click", handleRefresh);
  $("#btn-rename").addEventListener("click", handleRename);
  $("#btn-undo").addEventListener("click", handleUndo);
  $("#btn-clear").addEventListener("click", handleClear);
  $("#btn-help").addEventListener("click", showHelp);
}

function bindDragDrop() {
  const dropZone = $("#drop-zone");
  let dragCounter = 0;

  dropZone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      dropZone.classList.remove("drag-over");
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove("drag-over");

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const paths = [];
    for (const file of files) {
      if (file.path) {
        paths.push(file.path);
      }
    }

    if (paths.length > 0) {
      await addFilesToApp(paths);
    }
  });
}

function bindTableEvents() {
  $("#file-table-body").addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".btn-delete");
    if (deleteBtn) {
      e.stopPropagation();
      const row = deleteBtn.closest("tr");
      if (!row) return;
      const index = parseInt(row.dataset.index, 10);
      if (isNaN(index)) return;
      handleRemoveFile(index);
      return;
    }

    const row = e.target.closest("tr");
    if (!row) return;
    const index = parseInt(row.dataset.index, 10);
    if (isNaN(index)) return;
    selectFile(index);
  });
}

function initResizer() {
  const resizer = $("#resizer");
  const previewPanel = $("#preview-panel");
  const content = $(".content");
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isResizing = true;
    startX = e.clientX;
    startWidth = previewPanel.offsetWidth;
    resizer.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const dx = startX - e.clientX;
    const contentWidth = content.offsetWidth;
    const newWidth = Math.max(
      MIN_PREVIEW_WIDTH,
      Math.min(startWidth + dx, contentWidth - MIN_LIST_WIDTH - 5)
    );
    previewPanel.style.width = newWidth + "px";
  });

  document.addEventListener("mouseup", () => {
    if (!isResizing) return;
    isResizing = false;
    resizer.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    savePreviewWidth();
  });
}

function restorePreviewWidth() {
  const saved = localStorage.getItem(PREVIEW_WIDTH_KEY);
  const width = saved ? parseInt(saved, 10) : DEFAULT_PREVIEW_WIDTH;
  const clamped = Math.max(MIN_PREVIEW_WIDTH, width);
  $("#preview-panel").style.width = clamped + "px";
}

function savePreviewWidth() {
  const width = $("#preview-panel").offsetWidth;
  localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
}

async function handleSelectFiles() {
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: "图片文件",
        extensions: [
          "jpg", "jpeg", "tiff", "tif", "cr2", "cr3", "arw", "nef",
          "orf", "rw2", "dng", "heic", "heif", "sr2", "srf", "srw",
          "pef", "raf", "3fr", "kdc", "dcr", "erf", "mef", "mrw",
          "nrw", "ptx", "r3d", "rw1", "x3f",
        ],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });

  if (!selected) return;

  const paths = Array.isArray(selected) ? selected : [selected];
  await addFilesToApp(paths);
}

async function handleSelectFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
  });

  if (!selected) return;

  setStatus("正在扫描文件夹...");
  try {
    const entries = await invoke("add_folder", { folderPath: selected });
    fileEntries = await invoke("get_file_list");
    renderTable();
    updateFileCount();
    showToast(`已添加 ${entries.length} 个文件`, "success");
    setStatus(`已加载 ${fileEntries.length} 个文件`);
  } catch (err) {
    showToast(`添加文件夹失败: ${err}`, "error");
    setStatus("就绪");
  }
}

async function addFilesToApp(paths) {
  setStatus("正在读取EXIF信息...");
  try {
    await invoke("add_files", { paths });
    fileEntries = await invoke("get_file_list");
    renderTable();
    updateFileCount();
    setStatus(`已加载 ${fileEntries.length} 个文件`);
  } catch (err) {
    showToast(`添加文件失败: ${err}`, "error");
    setStatus("就绪");
  }
}

async function handleRefresh() {
  if (fileEntries.length === 0) {
    showToast("文件列表为空", "info");
    return;
  }
  setStatus("正在刷新...");
  try {
    fileEntries = await invoke("refresh_files");
    renderTable();
    if (selectedIndex >= 0 && selectedIndex < fileEntries.length) {
      await loadPreview(selectedIndex);
    }
    setStatus(`已刷新 ${fileEntries.length} 个文件`);
  } catch (err) {
    showToast(`刷新失败: ${err}`, "error");
    setStatus("就绪");
  }
}

async function handleRename() {
  if (fileEntries.length === 0) {
    showToast("请先选择照片文件", "info");
    return;
  }

  const confirmed = await showConfirm("确认重命名", "确定要根据EXIF信息重命名所有文件吗？");
  if (!confirmed) return;

  setStatus("正在重命名...");
  try {
    const results = await invoke("rename_files");
    fileEntries = await invoke("get_file_list");
    renderTable();
    if (selectedIndex >= 0 && selectedIndex < fileEntries.length) {
      await loadPreview(selectedIndex);
    }
    const summary = results["_summary"] || "完成";
    showToast(`重命名完成: ${summary}`, "success");
    setStatus(`重命名完成: ${summary}`);
  } catch (err) {
    showToast(`重命名失败: ${err}`, "error");
    setStatus("就绪");
  }
}

async function handleUndo() {
  if (fileEntries.length === 0) {
    showToast("文件列表为空", "info");
    return;
  }

  const confirmed = await showConfirm("确认撤销", "确定要撤销所有重命名操作吗？\n这将尝试将文件名恢复为原始名称。");
  if (!confirmed) return;

  setStatus("正在撤销...");
  try {
    const results = await invoke("undo_rename");
    fileEntries = await invoke("get_file_list");
    renderTable();
    if (selectedIndex >= 0 && selectedIndex < fileEntries.length) {
      await loadPreview(selectedIndex);
    }
    const summary = results["_summary"] || "完成";
    showToast(`撤销完成: ${summary}`, "success");
    setStatus(`撤销完成: ${summary}`);
  } catch (err) {
    showToast(`撤销失败: ${err}`, "error");
    setStatus("就绪");
  }
}

async function handleClear() {
  if (fileEntries.length === 0) {
    showToast("文件列表已经是空的", "info");
    return;
  }

  const confirmed = await showConfirm("确认清空", "确定要清空文件列表吗？\n这将移除所有已加载的文件。");
  if (!confirmed) return;

  try {
    await invoke("clear_list");
    fileEntries = [];
    selectedIndex = -1;
    renderTable();
    clearPreview();
    updateFileCount();
    setStatus("已清空文件列表");
  } catch (err) {
    showToast(`清空失败: ${err}`, "error");
  }
}

async function handleRemoveFile(index) {
  const entry = fileEntries[index];
  if (!entry) return;

  const confirmed = await showConfirm("确认移除", `确定要从列表中移除文件吗？\n${entry.filename}`);
  if (!confirmed) return;

  try {
    await invoke("remove_file", { index });
    fileEntries = await invoke("get_file_list");

    if (selectedIndex === index) {
      selectedIndex = -1;
      clearPreview();
    } else if (selectedIndex > index) {
      selectedIndex--;
    }

    renderTable();
    updateFileCount();
    showToast("已移除文件", "success");
  } catch (err) {
    showToast(`移除失败: ${err}`, "error");
  }
}

function selectFile(index) {
  selectedIndex = index;
  renderTableSelection();
  loadPreview(index);
}

async function loadPreview(index) {
  const entry = fileEntries[index];
  if (!entry) return;

  try {
    const data = await invoke("get_preview", { filePath: entry.path });
    renderPreview(data);
  } catch (err) {
    renderPreviewError(err);
  }
}

function renderTable() {
  const tbody = $("#file-table-body");
  const emptyState = $("#empty-state");

  if (fileEntries.length === 0) {
    tbody.innerHTML = "";
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";

  tbody.innerHTML = fileEntries
    .map(
      (entry, i) => `
    <tr data-index="${i}" class="${i === selectedIndex ? "selected" : ""}">
      <td class="col-idx">${i + 1}</td>
      <td title="${escapeHtml(entry.filename)}">${escapeHtml(entry.filename)}</td>
      <td>${escapeHtml(entry.shooting_time)}</td>
      <td class="col-camera" title="${escapeHtml(entry.camera_model)}&#10;镜头: ${escapeHtml(entry.lens)}">${escapeHtml(entry.camera_model)}</td>
      <td title="${escapeHtml(entry.new_filename !== entry.final_filename ? entry.final_filename : entry.new_filename)}">${renderNewFilename(entry)}</td>
      <td>${renderStatus(entry.status)}</td>
      <td class="col-action">
        <button class="btn-delete" title="移除此文件">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

function renderTableSelection() {
  const rows = $$("#file-table-body tr");
  rows.forEach((row, i) => {
    row.classList.toggle("selected", i === selectedIndex);
  });
}

function renderStatus(status) {
  let cls = "status-waiting";
  if (status.includes("成功") || status.includes("已符合")) cls = "status-success";
  else if (status.includes("失败")) cls = "status-fail";
  else if (status.includes("撤销") || status.includes("无需")) cls = "status-undo";
  return `<span class="status-badge ${cls}">${escapeHtml(status)}</span>`;
}

function renderNewFilename(entry) {
  if (entry.new_filename !== entry.final_filename) {
    return `<span class="newname-duplicate">${escapeHtml(entry.final_filename)}</span>`;
  }
  return escapeHtml(entry.new_filename);
}

function renderPreview(data) {
  const previewImg = $("#preview-image");
  const noPreview = $("#no-preview");

  if (data.preview_type === "asset" && data.asset_url) {
    previewImg.src = data.asset_url;
    previewImg.style.display = "block";
    noPreview.style.display = "none";
  } else if (data.image_base64) {
    previewImg.src = `data:image/jpeg;base64,${data.image_base64}`;
    previewImg.style.display = "block";
    noPreview.style.display = "none";
  } else {
    previewImg.style.display = "none";
    noPreview.style.display = "flex";
  }

  const fileInfo = data.file_info;
  if (fileInfo) {
    $("#file-info-content").innerHTML = `
      <div class="info-row"><span class="info-label">文件名</span><span class="info-value">${escapeHtml(fileInfo.filename)}</span></div>
      <div class="info-row"><span class="info-label">创建日期</span><span class="info-value">${escapeHtml(fileInfo.created_date)}</span></div>
      <div class="info-row"><span class="info-label">文件大小</span><span class="info-value">${formatSize(fileInfo.file_size)}</span></div>
      <div class="info-row"><span class="info-label">文件路径</span><span class="info-value" title="${escapeHtml(fileInfo.file_dir)}">${escapeHtml(truncatePath(fileInfo.file_dir))}</span></div>
    `;
  }

  const exif = data.exif_detail;
  if (exif) {
    const fields = [
      ["拍摄日期", exif.shooting_date],
      ["制造商", exif.manufacturer],
      ["相机", exif.camera],
      ["镜头", exif.lens],
      ["焦距", exif.focal_length],
      ["光圈", exif.aperture],
      ["快门", exif.shutter],
      ["ISO", exif.iso],
    ];
    $("#exif-info-content").innerHTML = fields
      .map(
        ([label, value]) =>
          `<div class="info-row"><span class="info-label">${label}</span><span class="info-value">${escapeHtml(value || "无信息")}</span></div>`
      )
      .join("");
  }
}

function renderPreviewError(err) {
  const previewImg = $("#preview-image");
  const noPreview = $("#no-preview");
  previewImg.style.display = "none";
  noPreview.style.display = "flex";
  noPreview.innerHTML = `<p>无法加载预览: ${escapeHtml(String(err))}</p>`;
}

function clearPreview() {
  const previewImg = $("#preview-image");
  const noPreview = $("#no-preview");
  previewImg.style.display = "none";
  noPreview.style.display = "flex";
  noPreview.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    <p>选择文件以预览</p>
  `;
  $("#file-info-content").innerHTML = '<p class="no-info">选择文件查看信息</p>';
  $("#exif-info-content").innerHTML = '<p class="no-info">选择文件查看EXIF信息</p>';
}

function updateFileCount() {
  $("#file-count").textContent = `${fileEntries.length} 个文件`;
}

function setStatus(text) {
  const el = $("#status-text");
  el.textContent = text;
  el.className = text.includes("正在") ? "processing" : "";
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-dialog-overlay";
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
        <div class="dialog-buttons">
          <button class="btn btn-secondary" id="dialog-cancel">取消</button>
          <button class="btn btn-accent" id="dialog-confirm">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector("#dialog-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector("#dialog-confirm").addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

function showHelp() {
  const overlay = document.createElement("div");
  overlay.className = "help-overlay";
  overlay.innerHTML = `
    <div class="help-dialog">
      <div class="help-header">
        <h2>照片EXIF重命名工具 - 帮助文档</h2>
        <button class="help-close" id="help-close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="help-tabs">
        <button class="help-tab active" data-tab="overview">概述</button>
        <button class="help-tab" data-tab="usage">使用指南</button>
        <button class="help-tab" data-tab="features">功能详解</button>
        <button class="help-tab" data-tab="troubleshoot">常见问题</button>
        <button class="help-tab" data-tab="glossary">术语表</button>
      </div>
      <div class="help-body">

        <div class="help-section active" id="help-overview">
          <h3>程序简介</h3>
          <p>照片EXIF重命名工具是一款基于照片EXIF元数据自动重命名文件的桌面应用程序。它能够读取照片中嵌入的拍摄日期、时间等信息，将文件名统一重命名为 <code>YYYY-MM-DD HH-MM-SS.扩展名</code> 格式，方便照片的整理和归档。</p>

          <h3>核心特性</h3>
          <ul>
            <li><strong>EXIF智能读取</strong> — 自动从照片文件中提取拍摄日期时间，支持多级回退策略（EXIF原始日期 → EXIF日期 → 文件修改时间）</li>
            <li><strong>广泛的格式支持</strong> — 支持 JPEG、TIFF 等常见格式，以及 Sony ARW、Canon CR2/CR3、Nikon NEF、Olympus ORF、Panasonic RW2、Adobe DNG 等 20+ 种 RAW 格式</li>
            <li><strong>实时预览</strong> — 点击文件即可查看缩略图预览和完整EXIF信息</li>
            <li><strong>重复文件名处理</strong> — 自动检测重复文件名并添加序号后缀（如 <code>_1</code>、<code>_2</code>），以橙色高亮标识</li>
            <li><strong>撤销操作</strong> — 支持一键撤销重命名，恢复原始文件名</li>
            <li><strong>拖放支持</strong> — 可直接拖放文件或文件夹到界面中</li>
          </ul>

          <h3>重命名格式</h3>
          <p>文件将按以下格式重命名：</p>
          <table>
            <tr><th>元素</th><th>格式</th><th>示例</th></tr>
            <tr><td>年</td><td>YYYY</td><td>2024</td></tr>
            <tr><td>月</td><td>MM</td><td>01-12</td></tr>
            <tr><td>日</td><td>DD</td><td>01-31</td></tr>
            <tr><td>时</td><td>HH</td><td>00-23</td></tr>
            <tr><td>分</td><td>MM</td><td>00-59</td></tr>
            <tr><td>秒</td><td>SS</td><td>00-59</td></tr>
          </table>
          <p>完整格式：<code>2024-06-15 14-30-25.jpg</code></p>
          <p>重复文件：<code>2024-06-15 14-30-25_1.jpg</code>、<code>2024-06-15 14-30-25_2.jpg</code></p>

          <h3>支持的文件格式</h3>
          <table>
            <tr><th>类别</th><th>扩展名</th></tr>
            <tr><td>常见格式</td><td>JPG, JPEG, TIFF, TIF, HEIC, HEIF</td></tr>
            <tr><td>Sony</td><td>ARW, SR2, SRF</td></tr>
            <tr><td>Canon</td><td>CR2, CR3</td></tr>
            <tr><td>Nikon</td><td>NEF, NRW</td></tr>
            <tr><td>Olympus</td><td>ORF</td></tr>
            <tr><td>Panasonic</td><td>RW2, RW1</td></tr>
            <tr><td>Pentax</td><td>PEF</td></tr>
            <tr><td>Fujifilm</td><td>RAF</td></tr>
            <tr><td>Adobe</td><td>DNG</td></tr>
            <tr><td>其他</td><td>3FR, KDC, DCR, ERF, MEF, MRW, PTX, R3D, X3F, SRW</td></tr>
          </table>
        </div>

        <div class="help-section" id="help-usage">
          <h3>基本使用流程</h3>
          <ol>
            <li><strong>添加文件</strong> — 点击工具栏"选择文件"或"选择文件夹"按钮，或者直接拖放文件到列表区域</li>
            <li><strong>查看预览</strong> — 点击列表中的文件行，右侧预览面板将显示缩略图、文件信息和EXIF详情</li>
            <li><strong>确认新文件名</strong> — 检查"新文件名"列，确认系统生成的新文件名是否正确。重复文件名会以橙色显示实际重命名结果</li>
            <li><strong>执行重命名</strong> — 点击"EXIF重命名"按钮，确认后批量重命名所有文件</li>
            <li><strong>撤销（可选）</strong> — 如需恢复原始文件名，点击"撤销"按钮</li>
          </ol>

          <h3>工具栏按钮说明</h3>
          <table>
            <tr><th>按钮</th><th>功能</th><th>说明</th></tr>
            <tr><td>选择文件</td><td>添加照片文件</td><td>打开文件选择对话框，支持多选，仅显示支持的图片格式</td></tr>
            <tr><td>选择文件夹</td><td>添加整个文件夹</td><td>扫描选中文件夹及其子文件夹中的所有照片文件</td></tr>
            <tr><td>刷新</td><td>重新读取文件信息</td><td>从磁盘重新读取所有文件的当前文件名和EXIF数据，更新列表显示</td></tr>
            <tr><td>EXIF重命名</td><td>执行批量重命名</td><td>根据EXIF拍摄时间重命名所有文件，操作前需确认</td></tr>
            <tr><td>撤销</td><td>恢复原始文件名</td><td>将已重命名的文件恢复为操作前的原始名称</td></tr>
            <tr><td>清空</td><td>清空文件列表</td><td>移除列表中的所有文件条目，不会删除磁盘上的文件</td></tr>
          </table>

          <h3>列表操作</h3>
          <ul>
            <li><strong>选择文件</strong> — 点击列表行，右侧预览面板显示该文件的缩略图和详细信息</li>
            <li><strong>删除单个文件</strong> — 点击行末的 ✕ 按钮，确认后从列表中移除该文件（不会删除磁盘文件）</li>
            <li><strong>悬浮提示</strong> — 将鼠标悬停在"相机型号"列上，会显示相机型号全称和镜头信息；悬停在"文件名"或"新文件名"列上，会显示完整文件名</li>
          </ul>

          <h3>调整预览面板宽度</h3>
          <p>文件列表和预览面板之间有一个分隔条，拖动该分隔条可以自由调整两侧的宽度比例。调整后的宽度会自动保存，下次打开时恢复。</p>
        </div>

        <div class="help-section" id="help-features">
          <h3>EXIF信息读取策略</h3>
          <p>程序采用多级回退策略确保尽可能获取准确的拍摄时间：</p>
          <ol>
            <li><strong>EXIF DateTimeOriginal</strong> — 优先读取EXIF中的原始拍摄日期时间标签</li>
            <li><strong>EXIF DateTime</strong> — 若无原始日期，读取EXIF中的修改日期时间标签</li>
            <li><strong>文件修改时间</strong> — 若EXIF信息完全缺失，使用文件的最后修改时间作为回退，并在拍摄时间列标注"使用文件修改时间"</li>
          </ol>

          <h3>RAW文件处理</h3>
          <p>对于RAW格式文件，程序采用特殊处理方式：</p>
          <ul>
            <li><strong>EXIF读取</strong> — RAW文件内部包含TIFF/EXIF结构，程序直接解析其中的元数据标签</li>
            <li><strong>预览图生成</strong> — 从RAW文件中提取内嵌的JPEG缩略图（所有RAW文件都包含嵌入式预览图），而非解码完整RAW数据，确保预览速度</li>
          </ul>

          <h3>重复文件名处理</h3>
          <p>当多个文件具有相同的拍摄时间时，系统会自动处理重复：</p>
          <ul>
            <li>所有重复文件均添加序号后缀，从 <code>_1</code> 开始递增</li>
            <li>例如：3张同时拍摄的照片将分别命名为 <code>2024-06-15 14-30-25_1.jpg</code>、<code>2024-06-15 14-30-25_2.jpg</code>、<code>2024-06-15 14-30-25_3.jpg</code></li>
            <li>重复文件名在列表中以橙色显示实际重命名结果</li>
          </ul>

          <h3>预览面板信息</h3>
          <p>右侧预览面板包含三个区域：</p>
          <ul>
            <li><strong>预览</strong> — 显示照片缩略图。JPEG/TIFF等格式直接加载，RAW格式提取内嵌预览图</li>
            <li><strong>文件信息</strong> — 显示文件名、创建日期、文件大小、文件路径</li>
            <li><strong>EXIF信息</strong> — 显示拍摄日期、制造商、相机型号、镜头、焦距、光圈、快门速度、ISO感光度</li>
          </ul>

          <h3>撤销机制</h3>
          <p>程序在内部记录每个文件的原始名称。执行撤销时，会将文件名恢复为首次添加时的名称。注意：</p>
          <div class="help-warning">
            <p>撤销操作仅能恢复上一次重命名前的文件名。如果原始文件名已被其他文件占用，撤销将失败。</p>
          </div>
        </div>

        <div class="help-section" id="help-troubleshoot">
          <h3>文件无法添加到列表</h3>
          <ul>
            <li>确认文件格式在支持列表中（参见"概述"选项卡的格式列表）</li>
            <li>确认文件未被其他程序锁定</li>
            <li>确认文件路径不包含特殊字符</li>
          </ul>

          <h3>EXIF信息显示"未知型号"或"使用文件修改时间"</h3>
          <ul>
            <li>部分图片编辑软件在导出时会剥离EXIF数据，导致信息丢失</li>
            <li>截图、网络下载的图片通常不包含EXIF信息</li>
            <li>某些手机拍摄的照片可能将EXIF信息存储在非标准标签中</li>
          </ul>

          <h3>RAW文件预览无法显示</h3>
          <ul>
            <li>极少数RAW格式可能不包含内嵌JPEG预览图</li>
            <li>如果RAW文件损坏，预览可能无法加载</li>
          </ul>

          <h3>重命名失败</h3>
          <ul>
            <li>确认文件未被其他程序打开或锁定</li>
            <li>确认对文件所在目录有写入权限</li>
            <li>确认目标文件名不存在同名文件冲突</li>
            <li>如果磁盘空间不足，重命名操作可能失败</li>
          </ul>

          <h3>撤销失败</h3>
          <ul>
            <li>如果原始文件名已被其他文件占用，撤销无法覆盖现有文件</li>
            <li>撤销仅记录首次添加时的文件名，多次重命名后只能恢复到最初状态</li>
          </ul>

          <h3>界面显示异常</h3>
          <ul>
            <li>尝试点击"刷新"按钮重新加载文件信息</li>
            <li>如果预览面板宽度异常，拖动分隔条重新调整即可</li>
          </ul>
        </div>

        <div class="help-section" id="help-glossary">
          <h3>EXIF</h3>
          <p>Exchangeable Image File Format，可交换图像文件格式。是专门为数码相机的照片设定的标准，包含拍摄时的各种参数信息，如拍摄日期、相机型号、曝光参数等。</p>

          <h3>RAW</h3>
          <p>数码相机的原始数据格式，记录了传感器捕捉的未处理图像数据。不同厂商使用不同的RAW格式扩展名（如 Sony 的 .ARW、Canon 的 .CR2/.CR3、Nikon 的 .NEF 等）。RAW文件通常体积较大，但保留了最完整的图像信息和元数据。</p>

          <h3>DateTimeOriginal</h3>
          <p>EXIF标签之一，记录照片的原始拍摄日期和时间。这是重命名工具优先使用的时间来源，通常最为准确。</p>

          <h3>焦距（Focal Length）</h3>
          <p>镜头的光学中心到图像传感器之间的距离，以毫米（mm）为单位。焦距决定了镜头的视角和放大倍率。</p>

          <h3>光圈（Aperture / F-Number）</h3>
          <p>镜头通光孔径的大小，用 f/N 表示（如 f/2.8）。数值越小表示光圈越大，进光量越多，景深越浅。</p>

          <h3>快门速度（Shutter Speed / Exposure Time）</h3>
          <p>相机传感器曝光的时间长度。常用分数表示（如 1/200 秒），也可用小数表示（如 0.5 秒）。</p>

          <h3>ISO感光度</h3>
          <p>图像传感器对光的敏感程度。ISO值越高，传感器对光越敏感，适合暗光环境拍摄，但图像噪点也会增加。</p>

          <h3>TIFF</h3>
          <p>Tagged Image File Format，标签图像文件格式。一种灵活的位图格式，广泛用于图像处理和印刷领域。RAW文件内部通常使用TIFF结构存储元数据。</p>

          <h3>DNG</h3>
          <p>Digital Negative，数字负片格式。由Adobe创建的开放标准RAW格式，旨在提供通用的RAW文件存档格式。</p>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#help-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelectorAll(".help-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      overlay.querySelectorAll(".help-tab").forEach((t) => t.classList.remove("active"));
      overlay.querySelectorAll(".help-section").forEach((s) => s.classList.remove("active"));
      tab.classList.add("active");
      const section = overlay.querySelector(`#help-${tab.dataset.tab}`);
      if (section) section.classList.add("active");
    });
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function truncatePath(path) {
  if (!path || path.length <= 40) return path;
  return "..." + path.slice(path.length - 37);
}

document.addEventListener("DOMContentLoaded", init);
