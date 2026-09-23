// render-pdf: print a session's outputs to PDF with headless Edge (recap.pdf from
// recap-print.html, the rest from their own HTML), count the pages, refuse a PDF that came out
// empty, and write a page-grid preview beside each so every page gets looked at before the files
// go out. The judgment (a heading alone at a page foot, a split table, a near-empty page) is the
// skill's; fix the HTML and render again.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadCampaign, OUTPUTS, resolveSessionDir } from '../campaign.js';
import type { Config } from '../config.js';
import type { Exec } from '../health.js';
import { pdfTargets, printToPdf, writePreview } from '../pdf.js';
import { toInputSchema } from '../utils/schema.js';

const RenderPdfSchema = z.object({
  date: z.string().describe('The session (YYYY-MM-DD or its directory name).'),
  outputs: z
    .array(z.enum(OUTPUTS))
    .optional()
    .describe("Which outputs to print (default: campaign.json's sessions.outputs)."),
  preview: z
    .boolean()
    .default(true)
    .describe('Write a page-grid preview of each PDF under audio/previews/ (gitignored).'),
});

export interface RenderPdfDeps {
  config: Config;
  exec: Exec;
  /** How often to look for Edge's PDF (the tests shorten it). */
  pollMs?: number;
}

export class RenderPdfTool {
  constructor(private readonly deps: RenderPdfDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'render-pdf',
        description:
          "Print a session's outputs to PDF with headless Edge: recap.pdf from recap-print.html " +
          '(never recap.html), the rest from their own HTML. Counts pages, refuses an empty ' +
          'print, and writes a page-grid preview of each to look at every page in the Browser ' +
          'pane.',
        inputSchema: toInputSchema(RenderPdfSchema),
      },
    ];
  }

  async handleRenderPdf(args: unknown) {
    const p = RenderPdfSchema.parse(args ?? {});
    const campaign = loadCampaign(this.deps.config.campaignRepo);
    const sessionDir = resolveSessionDir(campaign, p.date);
    if (!fs.existsSync(this.deps.config.edge)) {
      throw new Error(
        `${this.deps.config.edge} missing: set SCRIBE_EDGE to a Chromium-family browser`
      );
    }
    const targets = pdfTargets(sessionDir, p.outputs ?? campaign.sessions.outputs);
    const missing = targets.filter(t => !fs.existsSync(t.html)).map(t => path.basename(t.html));
    if (missing.length) {
      throw new Error(
        `missing print sources: ${missing.join(', ')}` +
          (missing.includes('recap-print.html')
            ? ' (recap.pdf prints from recap-print.html, never recap.html)'
            : '')
      );
    }
    const previews = path.join(sessionDir, 'audio', 'previews');
    if (p.preview) fs.mkdirSync(previews, { recursive: true });
    const rendered = [];
    for (const t of targets) {
      const { bytes, pages } = await printToPdf(
        this.deps.exec,
        this.deps.config.edge,
        t.html,
        t.pdf,
        this.deps.pollMs ? { pollMs: this.deps.pollMs } : {}
      );
      const preview = p.preview
        ? writePreview(t.pdf, path.join(previews, `${t.output}.preview.html`))
        : undefined;
      rendered.push({
        output: t.output,
        from: path.basename(t.html),
        pdf: t.pdf,
        pages,
        kb: Math.round(bytes / 1024),
        ...(preview ? { preview } : {}),
      });
    }
    return {
      rendered,
      ...(p.preview
        ? {
            look:
              `serve ${previews} on 127.0.0.1 and open each *.preview.html in the Browser pane ` +
              '(wait for <body data-done="1">); they sit under audio/, gitignored, never the record',
          }
        : {}),
    };
  }
}
