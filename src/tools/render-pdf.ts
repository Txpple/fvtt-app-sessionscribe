// render-pdf: print a session's outputs to PDF with headless Edge (recap.pdf from
// recap-print.html, the rest from their own HTML), count the pages, refuse a PDF that came out
// empty, and write every page as a JPEG under audio/previews/ so every page gets looked at
// before the files go out. The judgment (a heading alone at a page foot, a split table, a
// near-empty page) is the skill's; fix the HTML and render again.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { loadCampaign, OUTPUTS, resolveSessionDir } from '../campaign.js';
import type { Config } from '../config.js';
import type { Exec } from '../health.js';
import {
  type PageGrabber,
  pdfTargets,
  playwrightGrabber,
  printToPdf,
  writePageImages,
  writePreview,
} from '../pdf.js';
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
    .describe('Write every page of each PDF as a JPEG under audio/previews/ (gitignored).'),
});

export interface RenderPdfDeps {
  config: Config;
  exec: Exec;
  /** How often to look for Edge's PDF (the tests shorten it). */
  pollMs?: number;
  /** Rasterises a preview page (the tests inject a fake; the default is headless Chromium). */
  grab?: PageGrabber;
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
          'print, and writes every page as a JPEG under audio/previews/ so each one can be ' +
          'looked at before the files go out.',
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
    const grab = this.deps.grab ?? playwrightGrabber;
    const rendered = [];
    for (const t of targets) {
      const { bytes, pages } = await printToPdf(
        this.deps.exec,
        this.deps.config.edge,
        t.html,
        t.pdf,
        this.deps.pollMs ? { pollMs: this.deps.pollMs } : {}
      );
      let images: string[] | undefined;
      if (p.preview) {
        const preview = writePreview(t.pdf, path.join(previews, `${t.output}.preview.html`));
        images = writePageImages(await grab(preview), previews, t.output);
        if (images.length !== pages) {
          throw new Error(
            `${t.output}.pdf has ${pages} pages but the preview drew ${images.length}: ` +
              'the page images cannot be trusted (is pdf.js reachable?)'
          );
        }
      }
      rendered.push({
        output: t.output,
        from: path.basename(t.html),
        pdf: t.pdf,
        pages,
        kb: Math.round(bytes / 1024),
        ...(images ? { images } : {}),
      });
    }
    return {
      rendered,
      ...(p.preview
        ? {
            look:
              'read every page image (<output>-NN.jpg, in order) before the files go out; ' +
              'they sit under audio/, gitignored, never the record',
          }
        : {}),
    };
  }
}
