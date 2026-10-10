/**
 * popup.ts — Main UI controller for the Word to LaTeX extension popup.
 * Supports:
 * 1. .docx file upload
 * 2. Rich-text / plain-text paste
 * 3. Offline Image to LaTeX recognition (text, equations, tables)
 */

import { convertToLatex, convertDocxToLatex, lastDocxPreprocessMetadata } from './pandocWasm.js';
import { cleanupLatex, wrapCompleteDocument, sanitizeFilename, type WrapCompleteDocumentOptions } from './cleanup.js';
import {
  analyzeDocxConversion,
  analyzePasteConversion,
  analyzeImageConversion,
  type ConversionMetadata,
} from './conversionStats.js';
import { detectPastedFormat, DetectedInput } from './clipboardDetect.js';
import {
  validateImageFile,
  fileToDataUrl,
  loadImage,
  preprocessCanvas,
} from './imageOcr/imagePreprocess.js';
import { convertImageToLatex } from './imageOcr/ocrEngine.js';

// DOM elements — Tabs
const tabUpload = document.getElementById('tab-upload') as HTMLButtonElement;
const tabPaste = document.getElementById('tab-paste') as HTMLButtonElement;
const tabImage = document.getElementById('tab-image') as HTMLButtonElement;
const panelUpload = document.getElementById('panel-upload') as HTMLDivElement;
const panelPaste = document.getElementById('panel-paste') as HTMLDivElement;
const panelImage = document.getElementById('panel-image') as HTMLDivElement;

// DOM elements — Upload mode
const fileInput = document.getElementById('docx-file') as HTMLInputElement;
const fileName = document.getElementById('file-name') as HTMLSpanElement;
const fileLabel = document.querySelector('.file-label') as HTMLLabelElement;
const clearFileBtn = document.getElementById('clear-file-btn') as HTMLButtonElement | null;
const checkApproxPageBreaks = document.getElementById('check-approx-page-breaks') as HTMLInputElement | null;
const convertBtn = document.getElementById('convert-btn') as HTMLButtonElement;
const uploadBtnText = convertBtn.querySelector('.btn-text') as HTMLSpanElement;
const uploadBtnSpinner = convertBtn.querySelector('.btn-spinner') as HTMLSpanElement;

// DOM elements — Paste mode
const pasteInput = document.getElementById('paste-input') as HTMLDivElement;
const convertPasteBtn = document.getElementById('convert-paste-btn') as HTMLButtonElement;
const pasteBtnText = convertPasteBtn.querySelector('.btn-text') as HTMLSpanElement;
const pasteBtnSpinner = convertPasteBtn.querySelector('.btn-spinner') as HTMLSpanElement;

// DOM elements — Image mode
const imageDropzone = document.getElementById('image-dropzone') as HTMLDivElement;
const imageFileInput = document.getElementById('image-file') as HTMLInputElement;
const dropzonePrompt = document.getElementById('dropzone-prompt') as HTMLDivElement;
const imagePreviewCard = document.getElementById('image-preview-card') as HTMLDivElement;
const imagePreviewImg = document.getElementById('image-preview') as HTMLImageElement;
const imageName = document.getElementById('image-name') as HTMLSpanElement;
const imageInfo = document.getElementById('image-info') as HTMLSpanElement;
const clearImageBtn = document.getElementById('clear-image-btn') as HTMLButtonElement | null;
const btnModeFragment = document.getElementById('btn-mode-fragment') as HTMLButtonElement;
const btnModeDocument = document.getElementById('btn-mode-document') as HTMLButtonElement;
const checkEmbedFigure = document.getElementById('check-embed-figure') as HTMLInputElement;
const convertImageBtn = document.getElementById('convert-image-btn') as HTMLButtonElement;
const imageBtnText = convertImageBtn.querySelector('.btn-text') as HTMLSpanElement;
const imageBtnSpinner = convertImageBtn.querySelector('.btn-spinner') as HTMLSpanElement;

// DOM elements — Shared Output & Status
const statusEl = document.getElementById('status') as HTMLDivElement;
const outputWrapper = document.getElementById('output-wrapper') as HTMLDivElement;
const outputTextarea = document.getElementById('output') as HTMLTextAreaElement;
const sourceIndicator = document.getElementById('source-indicator') as HTMLSpanElement;
const conversionInfoCard = document.getElementById('conversion-info-card') as HTMLDivElement;
const conversionStatsEl = document.getElementById('conversion-stats') as HTMLSpanElement;
const conversionWarningsEl = document.getElementById('conversion-warnings') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const copiedToast = document.getElementById('copied-toast') as HTMLDivElement;

// State
let selectedFile: File | null = null;
let lastPastedData: DetectedInput | null = null;
let selectedImageFile: File | null = null;
let selectedImageDataUrl: string | null = null;
let outputMode: 'fragment' | 'document' = 'fragment';
let isConverting = false;
let lastCleanLatexFragment: string | null = null;
let lastSourceDesc = '';
let currentDocName = 'converted';
let lastMetadata: ConversionMetadata | null = null;
let lastDocxGeometry: WrapCompleteDocumentOptions['geometry'] | undefined = undefined;

// --- Tab Switching ---
tabUpload.addEventListener('click', () => switchTab('upload'));
tabPaste.addEventListener('click', () => switchTab('paste'));
tabImage.addEventListener('click', () => switchTab('image'));

function switchTab(mode: 'upload' | 'paste' | 'image') {
  if (isConverting) return;

  // Deactivate all
  tabUpload.classList.remove('active');
  tabPaste.classList.remove('active');
  tabImage.classList.remove('active');
  panelUpload.hidden = true;
  panelPaste.hidden = true;
  panelImage.hidden = true;

  if (mode === 'upload') {
    tabUpload.classList.add('active');
    panelUpload.hidden = false;
    setUploadLoading(false);
  } else if (mode === 'paste') {
    tabPaste.classList.add('active');
    panelPaste.hidden = false;
    setPasteLoading(false);
    pasteInput.focus();
  } else {
    tabImage.classList.add('active');
    panelImage.hidden = false;
    setImageLoading(false);
  }
}

// --- Upload Mode: File selection and removal ---
function handleFileSelected(file: File | undefined) {
  if (!file) {
    clearSelectedFile();
    return;
  }

  // Validate format
  if (!file.name.toLowerCase().endsWith('.docx')) {
    clearSelectedFile();
    showStatus('Please select a valid .docx Word document.', 'error');
    return;
  }

  // Validate file size (25MB limit)
  const MAX_SIZE_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_SIZE_BYTES) {
    clearSelectedFile();
    showStatus('File is too large (>25MB). Please choose a smaller document.', 'error');
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileLabel.classList.add('has-file');
  if (clearFileBtn) clearFileBtn.hidden = false;
  convertBtn.disabled = false;
  hideStatus();
}

function clearSelectedFile() {
  selectedFile = null;
  fileInput.value = '';
  fileName.textContent = 'Choose a .docx file…';
  fileLabel.classList.remove('has-file');
  if (clearFileBtn) clearFileBtn.hidden = true;
  convertBtn.disabled = true;
  setUploadLoading(false);
}

fileInput.addEventListener('change', () => {
  handleFileSelected(fileInput.files?.[0]);
});

if (clearFileBtn) {
  clearFileBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearSelectedFile();
    hideStatus();
  });
}

// --- Upload Mode: Conversion ---
convertBtn.addEventListener('click', async () => {
  if (isConverting || !selectedFile) return;

  isConverting = true;
  setUploadLoading(true);
  hideStatus();

  try {
    const arrayBuffer = await selectedFile.arrayBuffer();
    const approxBreaks = Boolean(checkApproxPageBreaks?.checked);
    const rawLatex = await convertDocxToLatex(arrayBuffer, { approximatePageBreaks: approxBreaks });
    const cleanLatex = cleanupLatex(rawLatex);
    lastCleanLatexFragment = cleanLatex;
    lastSourceDesc = 'docx file';
    currentDocName = selectedFile.name;
    lastDocxGeometry = lastDocxPreprocessMetadata?.geometry;
    const finalLatex = outputMode === 'document' ? wrapCompleteDocument(cleanLatex, { geometry: lastDocxGeometry }) : cleanLatex;

    const meta = analyzeDocxConversion(rawLatex, cleanLatex, undefined, {
      approximatePageBreaks: approxBreaks,
      foundApproximateBreaks: lastDocxPreprocessMetadata?.foundApproximateBreaks ?? false,
    });
    lastMetadata = meta;
    renderOutput(finalLatex, 'docx file', meta);
    await copyToClipboard(finalLatex);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`Conversion failed: ${message}`, 'error');
    console.error('[Word to LaTeX] File conversion error:', err);
  } finally {
    isConverting = false;
    setUploadLoading(false);
  }
});

// --- Paste Mode: Intercept Paste ---
pasteInput.addEventListener('paste', (event: ClipboardEvent) => {
  event.preventDefault();

  const clipboardData = event.clipboardData;
  if (!clipboardData) return;

  const html = clipboardData.getData('text/html');
  const text = clipboardData.getData('text/plain');

  const detected = detectPastedFormat({ html, text });
  lastPastedData = detected;

  if (detected.format === 'html') {
    pasteInput.innerHTML = detected.content;
  } else {
    pasteInput.innerText = detected.content;
  }

  updatePasteButtonState();
});

pasteInput.addEventListener('input', () => {
  lastPastedData = null;
  updatePasteButtonState();
});

function updatePasteButtonState() {
  const hasContent = Boolean(pasteInput.innerText.trim() || pasteInput.innerHTML.trim());
  convertPasteBtn.disabled = !hasContent || isConverting;
}

// --- Paste Mode: Conversion ---
convertPasteBtn.addEventListener('click', async () => {
  if (isConverting) return;

  const currentText = pasteInput.innerText.trim();
  const currentHtml = pasteInput.innerHTML.trim();

  if (!currentText && !currentHtml) return;

  isConverting = true;
  setPasteLoading(true);
  hideStatus();

  try {
    let inputFormat: 'html' | 'markdown' = 'markdown';
    let inputContent: string = currentText;
    let sourceDesc = 'pasted plain text';

    if (lastPastedData && lastPastedData.content) {
      inputFormat = lastPastedData.format;
      inputContent = lastPastedData.content;
      sourceDesc = lastPastedData.sourceDescription;
    } else {
      const hasMarkup = /<[a-z][\s\S]*>/i.test(currentHtml);
      if (hasMarkup && currentHtml !== currentText) {
        inputFormat = 'html';
        inputContent = currentHtml;
        sourceDesc = 'rich text / HTML';
      } else {
        inputFormat = 'markdown';
        inputContent = currentText;
        sourceDesc = 'typed / plain text';
      }
    }

    const rawLatex = await convertToLatex({
      format: inputFormat,
      text: inputContent,
    });
    const cleanLatex = cleanupLatex(rawLatex);
    lastCleanLatexFragment = cleanLatex;
    lastSourceDesc = sourceDesc;
    currentDocName = 'pasted_content';
    lastDocxGeometry = undefined;
    const finalLatex = outputMode === 'document' ? wrapCompleteDocument(cleanLatex) : cleanLatex;

    const meta = analyzePasteConversion(inputFormat, inputContent, cleanLatex);
    lastMetadata = meta;
    renderOutput(finalLatex, sourceDesc, meta);
    await copyToClipboard(finalLatex);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`Conversion failed: ${message}`, 'error');
    console.error('[Word to LaTeX] Paste conversion error:', err);
  } finally {
    isConverting = false;
    setPasteLoading(false);
  }
});

// --- Image Mode: File selection, dropzone, and clipboard paste ---
async function handleImageSelected(file: File | undefined) {
  if (!file) {
    clearSelectedImage();
    return;
  }

  const validation = validateImageFile(file);
  if (!validation.valid) {
    clearSelectedImage();
    showStatus(validation.error || 'Invalid image file.', 'error');
    return;
  }

  try {
    selectedImageFile = file;
    const dataUrl = await fileToDataUrl(file);
    selectedImageDataUrl = dataUrl;

    // Load into preview image to extract dimensions
    const img = await loadImage(dataUrl);
    imagePreviewImg.src = dataUrl;
    imageName.textContent = file.name;
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    imageInfo.textContent = `${img.naturalWidth}×${img.naturalHeight}px • ${sizeMb} MB`;

    dropzonePrompt.hidden = true;
    imagePreviewCard.hidden = false;
    if (clearImageBtn) clearImageBtn.hidden = false;
    convertImageBtn.disabled = false;
    hideStatus();
  } catch (err) {
    clearSelectedImage();
    showStatus('Failed to read image preview.', 'error');
  }
}

function clearSelectedImage() {
  selectedImageFile = null;
  selectedImageDataUrl = null;
  imageFileInput.value = '';
  imagePreviewImg.src = '';
  imagePreviewCard.hidden = true;
  if (clearImageBtn) clearImageBtn.hidden = true;
  dropzonePrompt.hidden = false;
  convertImageBtn.disabled = true;
  setImageLoading(false);
}

imageFileInput.addEventListener('change', () => {
  handleImageSelected(imageFileInput.files?.[0]);
});

if (clearImageBtn) {
  clearImageBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearSelectedImage();
    hideStatus();
  });
}

// Drag & drop handlers
imageDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  imageDropzone.classList.add('dragover');
});

imageDropzone.addEventListener('dragleave', () => {
  imageDropzone.classList.remove('dragover');
});

imageDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  imageDropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    handleImageSelected(file);
  }
});

// Clipboard image paste support (when Image tab is active)
window.addEventListener('paste', async (e: ClipboardEvent) => {
  if (panelImage.hidden) return; // Only trigger if Image tab is active

  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      const file = items[i].getAsFile();
      if (file) {
        e.preventDefault();
        await handleImageSelected(file);
        break;
      }
    }
  }
});

// Output mode buttons
btnModeFragment.addEventListener('click', () => {
  outputMode = 'fragment';
  btnModeFragment.classList.add('active');
  btnModeDocument.classList.remove('active');
  if (lastCleanLatexFragment && !outputWrapper.hidden) {
    renderOutput(lastCleanLatexFragment, lastSourceDesc, lastMetadata);
  }
});

btnModeDocument.addEventListener('click', () => {
  outputMode = 'document';
  btnModeDocument.classList.add('active');
  btnModeFragment.classList.remove('active');
  if (lastCleanLatexFragment && !outputWrapper.hidden) {
    const fullDoc = wrapCompleteDocument(lastCleanLatexFragment, { hasFrench: true, geometry: lastDocxGeometry });
    renderOutput(fullDoc, lastSourceDesc, lastMetadata);
  }
});

// --- Image Mode: Conversion ---
convertImageBtn.addEventListener('click', async () => {
  if (isConverting || !selectedImageFile || !selectedImageDataUrl) return;

  isConverting = true;
  setImageLoading(true);
  hideStatus();

  try {
    showStatus('Preparing image and recognizing text/equations...', 'info');

    // Preprocess image on canvas
    const img = await loadImage(selectedImageDataUrl);
    const canvas = preprocessCanvas(img);

    const result = await convertImageToLatex(canvas, {
      mode: 'fragment',
      embedFigure: checkEmbedFigure.checked,
      imageFileName: selectedImageFile.name,
      hasFrench: true,
      onProgress: (phase) => {
        showStatus(phase, 'info');
      },
    });

    lastCleanLatexFragment = result.latex;
    lastSourceDesc = `image (${selectedImageFile.name})`;
    currentDocName = selectedImageFile.name;
    lastDocxGeometry = undefined;
    const finalLatex = outputMode === 'document' ? wrapCompleteDocument(result.latex, { hasFrench: true }) : result.latex;

    const meta = analyzeImageConversion(result, result.latex);
    lastMetadata = meta;
    renderOutput(finalLatex, `image (${selectedImageFile.name})`, meta);
    if (result.quality === 'uncertain' || result.quality === 'low') {
      showStatus(`Conversion complete (${result.confidence}% confidence). Review and edit formulas in the output box below before copying.`, 'info');
    } else if (result.hasMath) {
      showStatus('Conversion complete with experimental math recognition. You can edit expressions below before copying.', 'info');
    } else {
      hideStatus();
    }
    await copyToClipboard(finalLatex);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`Image conversion failed: ${message}`, 'error');
    console.error('[Word to LaTeX] Image conversion error:', err);
  } finally {
    isConverting = false;
    setImageLoading(false);
  }
});

// --- Output Presentation, Copy, and Download ---
function renderOutput(latex: string, source: string, metadata?: ConversionMetadata | null) {
  outputTextarea.value = latex;
  sourceIndicator.textContent = `Converted from: ${source}`;

  if (metadata !== undefined) {
    lastMetadata = metadata;
  }

  if (lastMetadata && lastMetadata.formattedStats) {
    conversionStatsEl.textContent = lastMetadata.formattedStats;

    if (lastMetadata.warnings && lastMetadata.warnings.length > 0) {
      conversionWarningsEl.innerHTML = '';
      for (const w of lastMetadata.warnings) {
        const item = document.createElement('div');
        item.className = `warning-item severity-${w.severity}`;

        const badge = document.createElement('span');
        badge.className = 'warning-badge';
        badge.textContent = w.severity === 'info' ? 'Note' : w.severity === 'warning' ? 'Warning' : 'Review';

        const content = document.createElement('div');
        content.className = 'warning-msg';
        content.textContent = w.message;

        if (w.suggestion) {
          const sugg = document.createElement('span');
          sugg.className = 'warning-suggestion';
          sugg.textContent = `Tip: ${w.suggestion}`;
          content.appendChild(sugg);
        }

        item.appendChild(badge);
        item.appendChild(content);
        conversionWarningsEl.appendChild(item);
      }
      conversionWarningsEl.hidden = false;
    } else {
      conversionWarningsEl.innerHTML = '';
      conversionWarningsEl.hidden = true;
    }

    conversionInfoCard.hidden = false;
  } else {
    conversionInfoCard.hidden = true;
  }

  outputWrapper.hidden = false;
}

/**
 * Triggers a browser download of the given LaTeX content as a .tex file.
 */
export function downloadTexFile(content: string, filename: string): void {
  try {
    const cleanBase = sanitizeFilename(filename);
    const targetFilename = `${cleanBase}.tex`;

    const blob = new Blob([content], { type: 'text/x-tex;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = targetFilename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);

    showToast('✓ Downloaded .tex!');
  } catch (err) {
    console.error('[Word to LaTeX] Download error:', err);
    showStatus('Could not download the file.', 'error');
  }
}

copyBtn.addEventListener('click', async () => {
  const text = outputTextarea.value;
  if (text) {
    await copyToClipboard(text);
  }
});

downloadBtn.addEventListener('click', () => {
  const text = outputTextarea.value;
  if (text) {
    downloadTexFile(text, currentDocName);
  }
});

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast('✓ Copied!');
      return;
    }
    throw new Error('Clipboard API unavailable');
  } catch (err) {
    try {
      outputTextarea.select();
      const success = document.execCommand('copy');
      if (success) {
        showToast('✓ Copied!');
        return;
      }
    } catch {}
    console.warn('[Word to LaTeX] Clipboard write failed:', err);
    outputTextarea.select();
    showStatus('Could not copy. Please select and copy the output manually.', 'error');
  }
}

function showToast(message = '✓ Copied!') {
  copiedToast.textContent = message;
  copiedToast.hidden = false;
  setTimeout(() => {
    copiedToast.hidden = true;
  }, 2000);
}

function setUploadLoading(loading: boolean) {
  convertBtn.disabled = loading || !selectedFile;
  uploadBtnText.hidden = loading;
  uploadBtnSpinner.hidden = !loading;
}

function setPasteLoading(loading: boolean) {
  const hasContent = Boolean(pasteInput.innerText.trim() || pasteInput.innerHTML.trim());
  convertPasteBtn.disabled = loading || !hasContent;
  pasteBtnText.hidden = loading;
  pasteBtnSpinner.hidden = !loading;
}

function setImageLoading(loading: boolean) {
  convertImageBtn.disabled = loading || !selectedImageFile;
  imageBtnText.hidden = loading;
  imageBtnSpinner.hidden = !loading;
}

function showStatus(message: string, type: 'error' | 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
}

// Initial state setup: Idle, no spinners, buttons disabled until input provided
setUploadLoading(false);
setPasteLoading(false);
setImageLoading(false);
if (clearFileBtn) clearFileBtn.hidden = true;
if (clearImageBtn) clearImageBtn.hidden = true;
