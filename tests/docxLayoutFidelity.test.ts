/**
 * docxLayoutFidelity.test.ts — Verification of layout fidelity transformations:
 * 1. Alignment (centered and right-aligned paragraphs preserve center/flushright; table cells & lists uncorrupted).
 * 2. Page breaks (w:br type=page and pageBreakBefore honored as \newpage; optional lastRenderedPageBreak default OFF).
 * 3. Text boxes (de-duplicate mc:AlternateContent Choice/Fallback; wrap in labeled flushright minipage with \\).
 * 4. Plain documents byte-identical before and after preprocessing (invariance).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore
import { createPandocInstance } from '../node_modules/pandoc-wasm/src/core.js';
import { runPandocConvert } from '../src/pandocCore.ts';
import { cleanupLatex, wrapCompleteDocument } from '../src/cleanup.ts';
import { preprocessDocx } from '../src/docxPreprocess.ts';
import { analyzeDocxConversion } from '../src/conversionStats.ts';
import { zipSync, strToU8 } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createSyntheticDocx(
  bodyXml: string,
  options?: { sectPrXml?: string; stylesXml?: string }
): ArrayBuffer {
  const sectPr = options?.sectPrXml ? `<w:sectPr>${options.sectPrXml}</w:sectPr>` : '';
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            xmlns:v="urn:schemas-microsoft-com:vml">
  <w:body>${bodyXml}${sectPr}</w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const zipFiles: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(docXml),
  };
  if (options?.stylesXml) {
    zipFiles['word/styles.xml'] = strToU8(options.stylesXml);
  }
  const zip = zipSync(zipFiles);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

describe('DOCX Layout Fidelity (Step 6.1)', () => {
  let pandoc: any;
  const fixturePath = path.resolve(__dirname, 'fixtures/anonymized_discharge_summary.docx');
  const plainDocxPath = path.resolve(__dirname, 'fixtures/headings_bold_italic.docx');

  before(async () => {
    const wasmPath = path.resolve(__dirname, '../node_modules/pandoc-wasm/src/pandoc.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    pandoc = await createPandocInstance(wasmBuffer);
  });

  it('1. Alignment: preserves centered paragraph as \\begin{center}...\\end{center}', async () => {
    const bytes = fs.readFileSync(fixturePath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    assert.ok(
      clean.includes('\\begin{center}\n\\textbf{CENTRE MEDICAL DE TEST SYNTHETIQUE}\n\\end{center}'),
      'Centered heading must be wrapped in \\begin{center} and \\end{center}'
    );
  });

  it('2. Alignment: preserves right-aligned paragraph as \\begin{flushright}...\\end{flushright}', async () => {
    const bytes = fs.readFileSync(fixturePath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    assert.ok(
      clean.includes('\\begin{flushright}\nDossier No: REF-9942 - Date: 10/10/2026\n\\end{flushright}'),
      'Right-aligned paragraph must be wrapped in \\begin{flushright} and \\end{flushright}'
    );
  });

  it('3. Alignment isolation: does not wrap table cells or list items in \\begin{center}', async () => {
    const bytes = fs.readFileSync(fixturePath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    // Table cell text must not be preceded by \begin{center}
    assert.ok(!clean.includes('\\begin{center}\nCellule tableau centree'), 'Table cell must not be wrapped in center');
    // List item must not be preceded by \begin{center}
    assert.ok(!clean.includes('\\begin{center}\nElement de liste'), 'List item must not be wrapped in center');
  });

  it('4. Hard page breaks: honors w:br type=page and pageBreakBefore as \\newpage', async () => {
    const bytes = fs.readFileSync(fixturePath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes('Fin de la premiere page.\\newpage'), 'w:br type=page must produce \\newpage');
    assert.ok(clean.includes('\\newpage\nTitre page trois avec saut avant.'), 'pageBreakBefore must produce \\newpage');
  });

  it('5. Approximate page breaks: user override OFF does not insert \\newpage for lastRenderedPageBreak', async () => {
    const bytes = fs.readFileSync(fixturePath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab, options: { approximatePageBreaks: false } });
    const clean = cleanupLatex(raw);

    // Without approximate page breaks, "Suite du dossier medical sur page 4." is NOT preceded by \newpage
    const idx = clean.indexOf('Suite du dossier medical sur page 4.');
    const precedingChunk = clean.substring(Math.max(0, idx - 20), idx);
    assert.ok(!precedingChunk.includes('\\newpage'), 'lastRenderedPageBreak must not emit \\newpage when user override is OFF');
  });

  it('6. Approximate page breaks: default ON when document contains lastRenderedPageBreak', async () => {
    const bytes = fs.readFileSync(fixturePath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    // Calling without options: defaults to ON because fixture has lastRenderedPageBreak
    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    assert.ok(
      clean.includes('\\newpage\nSuite du dossier medical sur page 4.'),
      'lastRenderedPageBreak must emit \\newpage by default when present in document'
    );

    const meta = analyzeDocxConversion(raw, clean);
    const note = meta.warnings.find((w) => w.message.includes("Page breaks follow Word's last saved layout"));
    assert.ok(note, 'Review banner note must be added when approximate page breaks are active');
  });

  it('6b. Approximate page breaks: OFF without markers (document without lastRenderedPageBreak)', () => {
    const bytes = fs.readFileSync(plainDocxPath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const result = preprocessDocx(ab);
    assert.equal(result.metadata.foundApproximateBreaks, false, 'Plain document without markers must have foundApproximateBreaks false');
  });

  it('7. Text boxes: de-duplicates mc:AlternateContent (Choice kept, Fallback discarded, appears once)', async () => {
    const bytes = fs.readFileSync(fixturePath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    const matches = clean.match(/Signature et cachet/g) || [];
    assert.equal(matches.length, 1, 'Text box content must appear exactly once, not duplicated');

    assert.ok(
      clean.includes(
        '% Text box\n\\begin{flushright}\n\\begin{minipage}{0.48\\linewidth}\\raggedright\nSignature et cachet\\\\\nDr J. Martin, Medecin Specialiste\n\\end{minipage}\n\\end{flushright}'
      ),
      'Text box must be wrapped in % Text box + flushright minipage with \\\\ line breaks'
    );

    const meta = analyzeDocxConversion(raw, clean);
    const boxWarning = meta.warnings.find((w) => w.message.includes('Floating text boxes were moved into the flow'));
    assert.ok(boxWarning, 'Review warning must be generated when floating text boxes are present');
  });

  it('8. Invariance: plain document without layout features is returned byte-identical', () => {
    const bytes = fs.readFileSync(plainDocxPath);
    const originalAb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const result = preprocessDocx(originalAb);
    assert.equal(result.metadata.modified, false, 'Plain document must not be modified');
    assert.equal(result.bytes.byteLength, originalAb.byteLength, 'Byte length must match exactly');

    const origU8 = new Uint8Array(originalAb);
    const resU8 = new Uint8Array(result.bytes);
    assert.deepEqual(resU8, origU8, 'Plain document must be byte-identical');
  });

  it('9. Consecutive centered paragraphs: merged into a single \\begin{center} with \\\\ line breaks', async () => {
    const bodyXml = `
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Hopital General</w:t></w:r></w:p>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Service de Gynecologie</w:t></w:r></w:p>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Rapport Medical</w:t></w:r></w:p>
    `;
    const ab = createSyntheticDocx(bodyXml);
    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    assert.equal((clean.match(/\\begin\{center\}/g) || []).length, 1, 'Consecutive centered paragraphs must be merged into 1 center environment');
    assert.ok(clean.includes('Hopital General\\\\\nService de Gynecologie\\\\\nRapport Medical'), 'Merged center must separate lines with \\\\');
  });

  it('10. Text box horizontal anchors: selects flushleft, center, or flushright based on anchor position', async () => {
    const bodyXml = `
      <w:p>
        <w:r><w:t>Introductory paragraph</w:t></w:r>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing>
                <wp:anchor>
                  <wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>
                  <wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Left Box Content</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
                </wp:anchor>
              </w:drawing>
            </mc:Choice>
            <mc:Fallback/>
          </mc:AlternateContent>
        </w:r>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing>
                <wp:anchor>
                  <wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>
                  <wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Center Box Content</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
                </wp:anchor>
              </w:drawing>
            </mc:Choice>
            <mc:Fallback/>
          </mc:AlternateContent>
        </w:r>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing>
                <wp:anchor>
                  <wp:positionH relativeFrom="column"><wp:posOffset>5000000</wp:posOffset></wp:positionH>
                  <wp:extent cx="1500000" cy="500000"/>
                  <wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Right Box Content</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
                </wp:anchor>
              </w:drawing>
            </mc:Choice>
            <mc:Fallback/>
          </mc:AlternateContent>
        </w:r>
      </w:p>
    `;
    const ab = createSyntheticDocx(bodyXml);
    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    assert.ok(
      clean.includes('% Text box\n\\begin{flushleft}\n\\begin{minipage}{0.48\\linewidth}\\raggedright\nLeft Box Content\n\\end{minipage}\n\\end{flushleft}'),
      'Left anchor must map to flushleft minipage'
    );
    assert.ok(
      clean.includes('% Text box\n\\begin{center}\n\\begin{minipage}{0.48\\linewidth}\\centering\nCenter Box Content\n\\end{minipage}\n\\end{center}'),
      'Center anchor must map to center minipage'
    );
    assert.ok(
      clean.includes('% Text box\n\\begin{flushright}\n\\begin{minipage}{0.25\\linewidth}\\raggedright\nRight Box Content\n\\end{minipage}\n\\end{flushright}'),
      'Right anchor must map to flushright minipage with proportional clamped width'
    );
  });

  it('11. Layout geometry: extracts synthetic pgSz, pgMar, and base font size and emits matching preamble', async () => {
    // US Letter: 12240 x 15840 twips = 215.9mm x 279.4mm
    // Margins: 1440 twips = 25.4mm (1 inch)
    const sectPrXml = `
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/>
    `;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:docDefaults>
          <w:rPrDefault>
            <w:rPr>
              <w:sz w:val="24"/>
            </w:rPr>
          </w:rPrDefault>
        </w:docDefaults>
      </w:styles>
    `;
    const bodyXml = `
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Title on US Letter</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body paragraph with 1-inch margins and 12pt font.</w:t></w:r></w:p>
    `;
    const ab = createSyntheticDocx(bodyXml, { sectPrXml, stylesXml });
    const preprocessed = preprocessDocx(ab);
    assert.ok(preprocessed.metadata.geometry, 'Geometry must be extracted');
    assert.equal(preprocessed.metadata.geometry.paperWidthMm, 215.9);
    assert.equal(preprocessed.metadata.geometry.paperHeightMm, 279.4);
    assert.equal(preprocessed.metadata.geometry.topMm, 25.4);
    assert.equal(preprocessed.metadata.geometry.bottomMm, 25.4);
    assert.equal(preprocessed.metadata.geometry.leftMm, 25.4);
    assert.equal(preprocessed.metadata.geometry.rightMm, 25.4);
    assert.equal(preprocessed.metadata.geometry.baseFontSizePt, 12);

    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);
    const completeDoc = wrapCompleteDocument(clean, { geometry: preprocessed.metadata.geometry });

    assert.ok(completeDoc.startsWith('\\documentclass[12pt,a4paper]{article}'), 'Emitted documentclass must have 12pt base font');
    assert.ok(
      completeDoc.includes('\\usepackage[paperwidth=215.9mm,paperheight=279.4mm,top=25.4mm,bottom=25.4mm,left=25.4mm,right=25.4mm]{geometry}'),
      'Emitted preamble must contain matching geometry specification'
    );
  });

  it('12. Text box width: converts extent cx to clamped fraction of column width (0.25-0.90)', async () => {
    // Page: 11906 twips, Margins: 720 on each side -> columnWidth = 10466 twips * 635 = 6,645,910 EMU
    // cx = 2278380 EMU -> 2278380 / 6645910 = 0.3428 -> 0.34
    // cx = 1000000 EMU -> 1000000 / 6645910 = 0.1505 -> clamped min 0.25
    // cx = 6500000 EMU -> 6500000 / 6645910 = 0.9780 -> clamped max 0.90
    const bodyXml = `
      <w:p>
        <w:r><w:t>Intro</w:t></w:r>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing>
                <wp:anchor>
                  <wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>
                  <wp:extent cx="2278380" cy="500000"/>
                  <wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Proportional Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
                </wp:anchor>
              </w:drawing>
            </mc:Choice>
            <mc:Fallback/>
          </mc:AlternateContent>
        </w:r>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing>
                <wp:anchor>
                  <wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>
                  <wp:extent cx="1000000" cy="500000"/>
                  <wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Min Clamped Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
                </wp:anchor>
              </w:drawing>
            </mc:Choice>
            <mc:Fallback/>
          </mc:AlternateContent>
        </w:r>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing>
                <wp:anchor>
                  <wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>
                  <wp:extent cx="6500000" cy="500000"/>
                  <wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Max Clamped Box</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
                </wp:anchor>
              </w:drawing>
            </mc:Choice>
            <mc:Fallback/>
          </mc:AlternateContent>
        </w:r>
      </w:p>
    `;
    const ab = createSyntheticDocx(bodyXml);
    const raw = await runPandocConvert(pandoc, { format: 'docx', bytes: ab });
    const clean = cleanupLatex(raw);

    assert.ok(clean.includes('\\begin{minipage}{0.34\\linewidth}'), 'cx=2278380 must map to 0.34\\linewidth');
    assert.ok(clean.includes('\\begin{minipage}{0.25\\linewidth}'), 'Narrow box must clamp to 0.25\\linewidth min');
    assert.ok(clean.includes('\\begin{minipage}{0.90\\linewidth}'), 'Wide box must clamp to 0.90\\linewidth max');
  });
});
