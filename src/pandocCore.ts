/**
 * pandocCore.ts — Core conversion logic and type contracts.
 * Framework-agnostic and free of direct package exports/DOM dependencies.
 */

export interface PandocInstance {
  convert: (
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, Blob | string>
  ) => Promise<{
    stdout: string;
    stderr: string;
    warnings: unknown[];
    files: Record<string, Blob>;
    mediaFiles: Record<string, Blob>;
  }>;
  query: (options: Record<string, unknown>) => Promise<unknown>;
  pandoc: (args_str: string, inData: unknown, resources: unknown[]) => Promise<unknown>;
}

import {
  preprocessDocx,
  type DocxPreprocessOptions,
  type DocxPreprocessMetadata,
} from './docxPreprocess.ts';

export type { DocxPreprocessOptions, DocxPreprocessMetadata };

export let lastDocxPreprocessMetadata: DocxPreprocessMetadata | null = null;

export type ConvertInput =
  | { format: 'docx'; bytes: ArrayBuffer; filename?: string; options?: DocxPreprocessOptions }
  | { format: 'html' | 'markdown'; text: string };

/**
 * Executes conversion given an initialized pandoc instance.
 */
export async function runPandocConvert(
  pandoc: Pick<PandocInstance, 'convert'>,
  input: ConvertInput
): Promise<string> {
  let result;

  if (input.format === 'docx') {
    const filename = input.filename || `input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.docx`;
    const arrayBuffer = input.bytes instanceof ArrayBuffer
      ? input.bytes
      : (input.bytes as any).buffer
        ? (input.bytes as any).buffer.slice(
            (input.bytes as any).byteOffset || 0,
            ((input.bytes as any).byteOffset || 0) + ((input.bytes as any).byteLength || 0)
          )
        : input.bytes;

    const preprocessed = preprocessDocx(arrayBuffer, input.options);
    lastDocxPreprocessMetadata = preprocessed.metadata;

    const blob = new Blob([preprocessed.bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    result = await pandoc.convert(
      {
        from: 'docx',
        to: 'latex',
        wrap: 'none',
        'input-files': [filename],
      },
      null,
      { [filename]: blob }
    );
  } else {
    // format is 'html' or 'markdown'
    // Disable native_spans and native_divs to prevent Pandoc from generating
    // redundant \foreignlanguage wrappers and nested grouping braces for Word styling spans
    const fromFormat = input.format === 'html'
      ? 'html-native_spans-native_divs'
      : 'markdown-native_spans-native_divs';

    result = await pandoc.convert(
      {
        from: fromFormat,
        to: 'latex',
        wrap: 'none',
      },
      input.text,
      {}
    );
  }

  if (result.stderr) {
    console.warn('[pandoc-wasm stderr]', result.stderr);
  }

  // Check if conversion succeeded
  if (!result.stdout && result.stderr) {
    throw new Error(`Pandoc error: ${result.stderr}`);
  }

  return result.stdout;
}
