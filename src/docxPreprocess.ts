/**
 * docxPreprocess.ts — Preprocess DOCX document.xml for layout fidelity:
 * 1. Alignment (preserve center and flushright on body paragraphs; skip table cells and list items).
 * 2. Page breaks (honor w:br type=page, pageBreakBefore, and section breaks as \newpage; optional approximate page breaks).
 * 3. Text boxes (de-duplicate mc:AlternateContent, extract Choice text box once at anchor, wrapped in flushright minipage).
 * 4. Invariance (if document has no layout markers, return original ArrayBuffer byte-identical).
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export interface DocxGeometry {
  paperWidthMm?: number;
  paperHeightMm?: number;
  topMm?: number;
  bottomMm?: number;
  leftMm?: number;
  rightMm?: number;
  baseFontSizePt?: number;
}

export interface DocxPreprocessOptions {
  approximatePageBreaks?: boolean;
}

export interface DocxPreprocessMetadata {
  modified: boolean;
  foundFloatingTextBoxes: boolean;
  foundApproximateBreaks: boolean;
  centeredParagraphsCount: number;
  rightAlignedParagraphsCount: number;
  hardPageBreaksCount: number;
  geometry?: DocxGeometry;
}

export interface DocxPreprocessResult {
  bytes: ArrayBuffer;
  metadata: DocxPreprocessMetadata;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getTextBoxAlignment(
  block: string,
  pageWidthEmu: number,
  columnWidthEmu: number
): 'left' | 'center' | 'right' {
  const alignMatch = block.match(/<wp:align>([a-zA-Z]+)<\/wp:align>/);
  if (alignMatch) {
    const val = alignMatch[1].toLowerCase();
    if (val === 'left' || val === 'center' || val === 'right') {
      return val as 'left' | 'center' | 'right';
    }
  }

  const posHMatch = block.match(/<wp:positionH\s+relativeFrom="([^"]+)">([\s\S]*?)<\/wp:positionH>/);
  if (posHMatch) {
    const relFrom = posHMatch[1].toLowerCase();
    const posHContent = posHMatch[2];
    const offsetMatch = posHContent.match(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/);
    const extentMatch = block.match(/<wp:extent\s+cx="(\d+)"/);
    const cx = extentMatch ? parseInt(extentMatch[1], 10) : 0;

    if (offsetMatch) {
      const offset = parseInt(offsetMatch[1], 10);
      const boxCenter = offset + cx / 2;
      const total = relFrom === 'page' ? pageWidthEmu : columnWidthEmu;
      if (total > 0) {
        const ratio = boxCenter / total;
        if (ratio < 0.35) return 'left';
        if (ratio <= 0.65) return 'center';
        return 'right';
      }
    }
  }

  const vmlStyleMatch = block.match(/style="[^"]*left:\s*(-?\d+(?:\.\d+)?)(pt|in|mm|cm)?/i);
  if (vmlStyleMatch) {
    const val = parseFloat(vmlStyleMatch[1]);
    const unit = (vmlStyleMatch[2] || 'pt').toLowerCase();
    let ptVal = val;
    if (unit === 'in') ptVal = val * 72;
    else if (unit === 'mm') ptVal = (val / 25.4) * 72;
    else if (unit === 'cm') ptVal = (val / 2.54) * 72;
    const ratio = ptVal / 530;
    if (ratio < 0.35) return 'left';
    if (ratio <= 0.65) return 'center';
    return 'right';
  }

  return 'right';
}

function getTextBoxWidthFraction(block: string, columnWidthEmu: number): string {
  const extentMatch = block.match(/<wp:extent\s+cx="(\d+)"/);
  if (extentMatch && columnWidthEmu > 0) {
    const cx = parseInt(extentMatch[1], 10);
    const fraction = cx / columnWidthEmu;
    const clamped = Math.max(0.25, Math.min(0.9, fraction));
    return clamped.toFixed(2);
  }

  const vmlStyleMatch = block.match(/style="[^"]*width:\s*(-?\d+(?:\.\d+)?)(pt|in|mm|cm)?/i);
  if (vmlStyleMatch && columnWidthEmu > 0) {
    const val = parseFloat(vmlStyleMatch[1]);
    const unit = (vmlStyleMatch[2] || 'pt').toLowerCase();
    let ptVal = val;
    if (unit === 'in') ptVal = val * 72;
    else if (unit === 'mm') ptVal = (val / 25.4) * 72;
    else if (unit === 'cm') ptVal = (val / 2.54) * 72;
    const emuVal = ptVal * 12700;
    const fraction = emuVal / columnWidthEmu;
    const clamped = Math.max(0.25, Math.min(0.9, fraction));
    return clamped.toFixed(2);
  }

  return '0.48';
}

function twipsToMm(twips: number): number {
  const mm = (twips * 25.4) / 1440;
  if (Math.abs(mm - Math.round(mm)) < 0.05) return Math.round(mm);
  return Math.round(mm * 10) / 10;
}

function extractDocxGeometry(docXml: string, stylesXml?: string): DocxGeometry {
  const geo: DocxGeometry = {};
  const pgSzMatch = docXml.match(/<w:pgSz\b([^>]*)\/?>/);
  if (pgSzMatch) {
    const w = pgSzMatch[1].match(/w:w="(\d+)"/);
    const h = pgSzMatch[1].match(/w:h="(\d+)"/);
    if (w) geo.paperWidthMm = twipsToMm(parseInt(w[1], 10));
    if (h) geo.paperHeightMm = twipsToMm(parseInt(h[1], 10));
  }

  const pgMarMatch = docXml.match(/<w:pgMar\b([^>]*)\/?>/);
  if (pgMarMatch) {
    const t = pgMarMatch[1].match(/w:top="(\d+)"/);
    const b = pgMarMatch[1].match(/w:bottom="(\d+)"/);
    const l = pgMarMatch[1].match(/w:left="(\d+)"/);
    const r = pgMarMatch[1].match(/w:right="(\d+)"/);
    if (t) geo.topMm = twipsToMm(parseInt(t[1], 10));
    if (b) geo.bottomMm = twipsToMm(parseInt(b[1], 10));
    if (l) geo.leftMm = twipsToMm(parseInt(l[1], 10));
    if (r) geo.rightMm = twipsToMm(parseInt(r[1], 10));
  }

  if (stylesXml) {
    const docDefaultsMatch = stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/);
    if (docDefaultsMatch) {
      const sz = docDefaultsMatch[0].match(/<w:sz\s[^>]*w:val="(\d+)"/);
      if (sz) geo.baseFontSizePt = Math.round(parseInt(sz[1], 10) / 2);
    }
    if (!geo.baseFontSizePt) {
      const normalMatch = stylesXml.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/);
      if (normalMatch) {
        const sz = normalMatch[0].match(/<w:sz\s[^>]*w:val="(\d+)"/);
        if (sz) geo.baseFontSizePt = Math.round(parseInt(sz[1], 10) / 2);
      }
    }
  }

  return geo;
}

export function preprocessDocx(
  buffer: ArrayBuffer | Uint8Array,
  options?: DocxPreprocessOptions
): DocxPreprocessResult {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const toArrayBuffer = (b: ArrayBuffer | Uint8Array): ArrayBuffer => {
    return b instanceof ArrayBuffer
      ? b
      : (b.buffer as ArrayBuffer).slice(b.byteOffset, b.byteOffset + b.byteLength);
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(u8);
  } catch {
    return {
      bytes: toArrayBuffer(buffer),
      metadata: {
        modified: false,
        foundFloatingTextBoxes: false,
        foundApproximateBreaks: false,
        centeredParagraphsCount: 0,
        rightAlignedParagraphsCount: 0,
        hardPageBreaksCount: 0,
      },
    };
  }

  if (!files['word/document.xml']) {
    return {
      bytes: toArrayBuffer(buffer),
      metadata: {
        modified: false,
        foundFloatingTextBoxes: false,
        foundApproximateBreaks: false,
        centeredParagraphsCount: 0,
        rightAlignedParagraphsCount: 0,
        hardPageBreaksCount: 0,
      },
    };
  }

  const originalXml = strFromU8(files['word/document.xml']);
  const stylesXml = files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : undefined;
  const geometry = extractDocxGeometry(originalXml, stylesXml);

  const hasCenter = /<w:jc\s[^>]*w:val="center"/i.test(originalXml);
  const hasRight = /<w:jc\s[^>]*w:val="right"/i.test(originalXml);
  const hasPageBr = /<w:br\s[^>]*w:type="page"/i.test(originalXml);
  const hasPageBreakBefore = /<w:pageBreakBefore\b/i.test(originalXml);
  const hasSectPrBreak = /<w:pPr>[\s\S]*?<w:sectPr\b/i.test(originalXml);
  const hasTextBox = /<w:txbxContent\b/i.test(originalXml);
  const hasLastRendered = /<w:lastRenderedPageBreak\b/i.test(originalXml);

  // Approximate page breaks: default ON when document contains markers, user can turn off
  const enableApproxBreaks =
    options?.approximatePageBreaks !== undefined
      ? Boolean(options.approximatePageBreaks)
      : hasLastRendered;

  // Invariance check: if no layout features need preprocessing, return exact original buffer
  if (
    !hasCenter &&
    !hasRight &&
    !hasPageBr &&
    !hasPageBreakBefore &&
    !hasSectPrBreak &&
    !hasTextBox &&
    (!enableApproxBreaks || !hasLastRendered)
  ) {
    return {
      bytes: toArrayBuffer(buffer),
      metadata: {
        modified: false,
        foundFloatingTextBoxes: false,
        foundApproximateBreaks: false,
        centeredParagraphsCount: 0,
        rightAlignedParagraphsCount: 0,
        hardPageBreaksCount: 0,
        geometry,
      },
    };
  }

  // Page dimensions in EMUs
  const pgSzMatch = originalXml.match(/<w:pgSz\s[^>]*w:w="(\d+)"/);
  const pageWTwips = pgSzMatch ? parseInt(pgSzMatch[1], 10) : 11906;
  const pageWidthEmu = pageWTwips * 635;

  const pgMarMatch = originalXml.match(/<w:pgMar\s[^>]*w:left="(\d+)"[^>]*w:right="(\d+)"/);
  const lMarTwips = pgMarMatch ? parseInt(pgMarMatch[1], 10) : 720;
  const rMarTwips = pgMarMatch ? parseInt(pgMarMatch[2], 10) : 720;
  const columnWidthEmu = (pageWTwips - lMarTwips - rMarTwips) * 635;

  let xml = originalXml;
  let foundFloatingTextBoxes = false;
  let foundApproximateBreaks = false;
  let centeredCount = 0;
  let rightCount = 0;
  let hardPageBreaksCount = 0;

  // 1. Text boxes & AlternateContent de-duplication with horizontal alignment and width
  if (hasTextBox) {
    xml = xml.replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/g, (block) => {
      if (!block.includes('w:txbxContent')) return block;
      foundFloatingTextBoxes = true;
      const align = getTextBoxAlignment(block, pageWidthEmu, columnWidthEmu);
      const width = getTextBoxWidthFraction(block, columnWidthEmu);
      const choiceMatch = block.match(/<mc:Choice[\s\S]*?<\/mc:Choice>/);
      const target = choiceMatch ? choiceMatch[0] : block;
      const pMatches = target.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
      const lines: string[] = [];
      for (const p of pMatches) {
        const tMatches = p.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) || [];
        const text = tMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();
        if (text) lines.push(text);
      }
      const runs = lines.map((l) => `<w:t>${escapeXml(l)}</w:t>`).join('<w:br/>');
      const startMarker = `%%LATEX_TEXTBOX_${align.toUpperCase()}_WIDTH_${width}_START%%`;
      return `<w:t>${startMarker}</w:t>${runs}<w:t>%%LATEX_TEXTBOX_END%%</w:t>`;
    });

    // Standalone drawings/picts containing txbxContent (not wrapped in mc:AlternateContent)
    xml = xml.replace(/<(?:w:drawing|w:pict)[\s\S]*?<\/w:(?:drawing|pict)>/g, (block) => {
      if (!block.includes('w:txbxContent')) return block;
      foundFloatingTextBoxes = true;
      const align = getTextBoxAlignment(block, pageWidthEmu, columnWidthEmu);
      const width = getTextBoxWidthFraction(block, columnWidthEmu);
      const pMatches = block.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
      const lines: string[] = [];
      for (const p of pMatches) {
        const tMatches = p.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) || [];
        const text = tMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();
        if (text) lines.push(text);
      }
      const runs = lines.map((l) => `<w:t>${escapeXml(l)}</w:t>`).join('<w:br/>');
      const startMarker = `%%LATEX_TEXTBOX_${align.toUpperCase()}_WIDTH_${width}_START%%`;
      return `<w:t>${startMarker}</w:t>${runs}<w:t>%%LATEX_TEXTBOX_END%%</w:t>`;
    });
  }

  // 2. Hard page breaks
  xml = xml.replace(/<w:br\b[^>]*w:type="page"[^>]*\/?>/g, () => {
    hardPageBreaksCount++;
    return '<w:t>%%LATEX_NEWPAGE%%</w:t>';
  });

  xml = xml.replace(
    /<w:pPr>([\s\S]*?)<w:pageBreakBefore\b[^>]*\/?>([\s\S]*?)<\/w:pPr>/g,
    (_, before, after) => {
      hardPageBreaksCount++;
      return `<w:pPr>${before}${after}</w:pPr><w:r><w:t>%%LATEX_NEWPAGE%%</w:t></w:r>`;
    }
  );

  xml = xml.replace(
    /<w:pPr>([\s\S]*?)<w:sectPr\b[\s\S]*?<\/w:sectPr>([\s\S]*?)<\/w:pPr>/g,
    (_, before, after) => {
      hardPageBreaksCount++;
      return `<w:pPr>${before}${after}</w:pPr><w:r><w:t>%%LATEX_NEWPAGE%%</w:t></w:r>`;
    }
  );

  // 3. Approximate page breaks
  if (enableApproxBreaks) {
    xml = xml.replace(/<w:lastRenderedPageBreak\b[^>]*\/?>/g, () => {
      foundApproximateBreaks = true;
      return '<w:t>%%LATEX_NEWPAGE%%</w:t>';
    });
  }

  // 4. Alignment: mask tables first
  const tableBlocks: string[] = [];
  xml = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tbl) => {
    tableBlocks.push(tbl);
    return `<!--__DOCX_TBL_MASK_${tableBlocks.length - 1}__-->`;
  });

  // Process paragraphs
  xml = xml.replace(/<w:p\b([\s\S]*?)<\/w:p>/g, (pBlock) => {
    if (/<w:numPr\b/i.test(pBlock)) {
      return pBlock;
    }
    const isCenter = /<w:jc\b[^>]*w:val="center"/i.test(pBlock);
    const isRight = /<w:jc\b[^>]*w:val="right"/i.test(pBlock);
    if (!isCenter && !isRight) {
      return pBlock;
    }

    // Ignore empty paragraphs
    const textMatches = pBlock.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) || [];
    const hasText = textMatches.some((t) => t.replace(/<[^>]+>/g, '').trim().length > 0);
    if (!hasText) {
      return pBlock;
    }

    const startMarker = isCenter ? '%%LATEX_CENTER_START%%' : '%%LATEX_FLUSHRIGHT_START%%';
    const endMarker = isCenter ? '%%LATEX_CENTER_END%%' : '%%LATEX_FLUSHRIGHT_END%%';
    if (isCenter) centeredCount++;
    else rightCount++;

    let modifiedP = pBlock;
    if (/<\/w:pPr>/i.test(modifiedP)) {
      modifiedP = modifiedP.replace(/(<\/w:pPr>)/i, `$1<w:r><w:t>${startMarker}</w:t></w:r>`);
    } else {
      modifiedP = modifiedP.replace(/(<w:p\b[^>]*>)/i, `$1<w:r><w:t>${startMarker}</w:t></w:r>`);
    }
    modifiedP = modifiedP.replace(/(<\/w:p>)$/i, `<w:r><w:t>${endMarker}</w:t></w:r>$1`);
    return modifiedP;
  });

  // Restore masked tables
  for (let i = 0; i < tableBlocks.length; i++) {
    xml = xml.replace(`<!--__DOCX_TBL_MASK_${i}__-->`, tableBlocks[i]);
  }

  files['word/document.xml'] = strToU8(xml);
  const newZip = zipSync(files);
  const finalBuffer = newZip.buffer.slice(
    newZip.byteOffset,
    newZip.byteOffset + newZip.byteLength
  );

  return {
    bytes: finalBuffer,
    metadata: {
      modified: true,
      foundFloatingTextBoxes,
      foundApproximateBreaks,
      centeredParagraphsCount: centeredCount,
      rightAlignedParagraphsCount: rightCount,
      hardPageBreaksCount,
      geometry,
    },
  };
}
