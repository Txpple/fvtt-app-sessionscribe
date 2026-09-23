// The session's PDFs: each output's HTML printed by headless Edge (Chromium's print CSS: the
// templates' @page footers and keep-together rules), counted, sanity-checked, and given a
// page-grid preview to look at every page in the Browser pane before the files go out.
//
// The one rule that is not "X.html → X.pdf": recap.pdf prints from recap-print.html, NEVER from
// recap.html — recap.html is the email body, a table layout, and Chrome splits text inside table
// cells across printed pages.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Output } from './campaign.js';
import type { Exec } from './health.js';

/** Below this, the page did not load (an empty print is about 1 KB). */
export const MIN_PDF_BYTES = 2_000;
const EDGE_TIMEOUT_MS = 180_000;
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

export interface PdfTarget {
  output: Output;
  html: string;
  pdf: string;
}

/** The print source and PDF for each output, in the session directory. */
export function pdfTargets(sessionDir: string, outputs: readonly Output[]): PdfTarget[] {
  return outputs.map(output => {
    const source = output === 'recap' ? 'recap-print.html' : `${output}.html`;
    return {
      output,
      html: path.join(sessionDir, source),
      pdf: path.join(sessionDir, `${output}.pdf`),
    };
  });
}

/** Pages in a Chromium (Skia) PDF: its page objects, which the page tree's root /Count matches. */
export function countPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

/**
 * Wait for a file to appear and stop growing. msedge.exe is a launcher: it hands the job to a
 * browser process and exits in ~50 ms, and that process writes the PDF seconds later (measured
 * 2026-09-23), so the launcher's exit says nothing about the file.
 */
async function settled(file: string, timeoutMs: number, pollMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let steady = 0;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > 0 && size === last) {
        if (++steady >= 2) return true;
      } else {
        steady = 0;
      }
      last = size;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return fs.existsSync(file);
}

export async function printToPdf(
  exec: Exec,
  edge: string,
  html: string,
  pdf: string,
  opts: { pollMs?: number } = {}
): Promise<{ bytes: number; pages: number }> {
  // Its own profile, so a running Edge window is never touched and never adopts the job.
  const profile = path.join(os.tmpdir(), 'scribe-edge-profile');
  fs.rmSync(pdf, { force: true });
  const r = await exec(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdf}`,
      pathToFileURL(html).href,
    ],
    EDGE_TIMEOUT_MS
  );
  if (!(await settled(pdf, EDGE_TIMEOUT_MS, opts.pollMs ?? 250))) {
    throw new Error(
      `Edge wrote no PDF for ${path.basename(html)}: ${(r.stderr || r.stdout).trim()}`
    );
  }
  const buf = fs.readFileSync(pdf);
  if (buf.length < MIN_PDF_BYTES) {
    throw new Error(
      `${path.basename(pdf)} is ${buf.length} bytes: the page did not load (check its images and paths)`
    );
  }
  return { bytes: buf.length, pages: countPages(buf) };
}

/**
 * A self-contained page-grid viewer for a PDF (headless Edge prints PDFs but will not rasterise
 * one, and the Browser pane has no PDF viewer): the PDF inlined as base64, drawn by pdf.js into
 * numbered canvases; <body data-done="1"> when every page is drawn. Serve its folder on
 * localhost and open it in the Browser pane.
 */
export function writePreview(pdf: string, out: string, cols = 2, width = 306): string {
  const b64 = fs.readFileSync(pdf).toString('base64');
  fs.writeFileSync(
    out,
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>loading</title><style>
body{margin:0;background:#666;font-family:sans-serif}
#g{display:grid;grid-template-columns:repeat(${cols},${width}px);gap:8px;padding:6px}
.pg{background:#fff;position:relative}.pg canvas{display:block;width:${width}px;height:auto}
.pg span{position:absolute;top:2px;right:4px;font-size:14px;color:#c00;font-weight:bold}</style>
<script src="${PDFJS}/pdf.min.js"></script></head><body><div id="g"></div><script>
pdfjsLib.GlobalWorkerOptions.workerSrc='${PDFJS}/pdf.worker.min.js';
const raw=atob("${b64}");const u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);
(async()=>{const doc=await pdfjsLib.getDocument({data:u}).promise;document.title='pages:'+doc.numPages;
for(let n=1;n<=doc.numPages;n++){const pg=await doc.getPage(n);const vp=pg.getViewport({scale:1.5});
const d=document.createElement('div');d.className='pg';const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
d.appendChild(c);const s=document.createElement('span');s.textContent=n;d.appendChild(s);document.getElementById('g').appendChild(d);
await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;}
document.body.setAttribute('data-done','1');})();</script></body></html>`
  );
  return out;
}
