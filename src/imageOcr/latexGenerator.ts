import { wrapCompleteDocument } from '../cleanup.ts';

export interface LatexGenerationOptions {
  mode: 'fragment' | 'document';
  embedFigure?: boolean;
  imageFileName?: string;
  hasFrench?: boolean;
}

/**
 * Wraps generated LaTeX content according to user-selected options.
 */
export function formatLatexOutput(
  content: string,
  options: LatexGenerationOptions
): string {
  let body = content.trim();

  // If user requested image figure embedding
  if (options.embedFigure) {
    const filename = options.imageFileName || 'image.png';
    const figureSnippet = [
      '\\begin{figure}[htbp]',
      '\\centering',
      `\\includegraphics[width=0.8\\linewidth]{${filename}}`,
      `\\caption{Image: ${filename}}`,
      '\\label{fig:recognized-image}',
      '\\end{figure}',
    ].join('\n');

    body = figureSnippet + '\n\n' + body;
  }

  if (options.mode === 'fragment') {
    return body;
  }

  return wrapCompleteDocument(body, { hasFrench: options.hasFrench });
}
