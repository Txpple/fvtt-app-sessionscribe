import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { Exec } from '../health.js';
import { countPages, pdfTargets } from '../pdf.js';
import { CAMPAIGN_JSON, makeTempRepo, removeTempRepo } from '../testing/campaign-fixture.js';
import { RenderPdfTool } from './render-pdf.js';

/** A Skia-shaped PDF body with `n` page objects under a two-level page tree. */
const fakePdf = (n: number): string =>
  `%PDF-1.4\n1 0 obj << /Type /Pages /Count ${n} /Kids [2 0 R] >> endobj\n` +
  `2 0 obj << /Type /Pages /Count ${n} >> endobj\n` +
  Array.from({ length: n }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj`).join(
    '\n'
  ) +
  `\n${'x'.repeat(3000)}\n%%EOF`;

/** A fake headless Edge: prints `pages` pages for every URL. */
function fakeEdge(calls: string[][], pages = 3): Exec {
  return async (_file, args) => {
    calls.push(args);
    const out = (args.find(a => a.startsWith('--print-to-pdf=')) ?? '').slice(
      '--print-to-pdf='.length
    );
    fs.writeFileSync(out, fakePdf(pages));
    return { code: 0, stdout: '', stderr: '' };
  };
}

const S = 'sessions/2026-01-06';
const HTML = Object.fromEntries(
  ['recap-print', 'recap', 'combat-log', 'gm-notes-story', 'gm-notes-mechanics'].map(n => [
    `${S}/${n}.html`,
    '<p>x</p>',
  ])
);

const roots: string[] = [];
function setup(files: Record<string, string>, pages = 3, exec?: Exec) {
  const root = makeTempRepo({ 'campaign.json': CAMPAIGN_JSON, 'edge/msedge.exe': '', ...files });
  roots.push(root);
  const calls: string[][] = [];
  const grabbed: string[] = [];
  const tool = new RenderPdfTool({
    config: loadConfig({
      SCRIBE_CAMPAIGN_REPO: root,
      SCRIBE_EDGE: path.join(root, 'edge', 'msedge.exe'),
    }),
    exec: exec ?? fakeEdge(calls, pages),
    pollMs: 1,
    // a fake rasteriser: one JPEG-shaped buffer per page the fake Edge printed
    grab: async preview => {
      grabbed.push(preview);
      return Array.from({ length: pages }, (_, i) => Buffer.from(`jpeg page ${i + 1}`));
    },
  });
  return { root, tool, calls, grabbed, dir: path.join(root, S) };
}
afterEach(() => {
  for (const r of roots.splice(0)) removeTempRepo(r);
});

describe('render-pdf', () => {
  it('prints recap.pdf from recap-print.html and the rest from their own HTML, with page images', async () => {
    const { tool, calls, grabbed, dir } = setup(HTML, 4);
    // a stale page from a longer earlier render must not survive
    const previews = path.join(dir, 'audio', 'previews');
    fs.mkdirSync(previews, { recursive: true });
    fs.writeFileSync(path.join(previews, 'recap-05.jpg'), 'stale');
    const out = await tool.handleRenderPdf({ date: '2026-01-06' });
    expect(out.rendered.map(r => [r.output, r.from, r.pages])).toEqual([
      ['recap', 'recap-print.html', 4],
      ['combat-log', 'combat-log.html', 4],
      ['gm-notes-story', 'gm-notes-story.html', 4],
      ['gm-notes-mechanics', 'gm-notes-mechanics.html', 4],
    ]);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        '--headless=new',
        '--no-pdf-header-footer',
        `--print-to-pdf=${path.join(dir, 'recap.pdf')}`,
      ])
    );
    expect(calls[0]?.at(-1)).toMatch(/^file:\/\/\/.*recap-print\.html$/);
    const preview = path.join(previews, 'recap.preview.html');
    expect(grabbed[0]).toBe(preview);
    expect(fs.readFileSync(preview, 'utf8')).toContain('pdfjsLib.getDocument');
    expect(out.rendered[0]?.images).toEqual(
      [1, 2, 3, 4].map(n => path.join(previews, `recap-0${n}.jpg`))
    );
    expect(fs.readFileSync(path.join(previews, 'recap-03.jpg'), 'utf8')).toBe('jpeg page 3');
    expect(fs.existsSync(path.join(previews, 'recap-05.jpg'))).toBe(false);
    expect(out.look).toMatch(/read every page image/);
  });

  it('refuses page images that do not match the page count', async () => {
    const { root } = setup(HTML, 3);
    const tool = new RenderPdfTool({
      config: loadConfig({
        SCRIBE_CAMPAIGN_REPO: root,
        SCRIBE_EDGE: path.join(root, 'edge', 'msedge.exe'),
      }),
      exec: fakeEdge([], 3),
      pollMs: 1,
      grab: async () => [Buffer.from('only one')],
    });
    await expect(
      tool.handleRenderPdf({ date: '2026-01-06', outputs: ['combat-log'] })
    ).rejects.toThrow(/3 pages but the preview drew 1/);
  });

  it('prints a chosen subset without previews', async () => {
    const { tool, calls } = setup(HTML);
    const out = await tool.handleRenderPdf({
      date: '2026-01-06',
      outputs: ['combat-log'],
      preview: false,
    });
    expect(out.rendered).toHaveLength(1);
    expect(out.rendered[0]).not.toHaveProperty('images');
    expect(calls).toHaveLength(1);
    expect(out).not.toHaveProperty('look');
  });

  it('refuses a missing print source, naming the recap rule, and an empty print', async () => {
    const { [`${S}/recap-print.html`]: _gone, ...noPrint } = HTML;
    await expect(setup(noPrint).tool.handleRenderPdf({ date: '2026-01-06' })).rejects.toThrow(
      /recap-print\.html \(recap\.pdf prints from recap-print\.html, never recap\.html\)/
    );
    // an Edge that printed a page which never loaded: a ~1 KB PDF
    const emptyPrint: Exec = async (_f, args) => {
      const out = (args.find(a => a.startsWith('--print-to-pdf=')) ?? '').slice(15);
      fs.writeFileSync(out, '%PDF tiny');
      return { code: 0, stdout: '', stderr: '' };
    };
    const { tool } = setup(HTML, 0, emptyPrint);
    await expect(
      tool.handleRenderPdf({ date: '2026-01-06', outputs: ['combat-log'] })
    ).rejects.toThrow(/did not load/);
  });
});

describe('pdf helpers', () => {
  it('counts page objects, not page-tree nodes', () => {
    expect(countPages(Buffer.from(fakePdf(13)))).toBe(13);
    expect(countPages(Buffer.from('no pages'))).toBe(0);
  });

  it('maps outputs to their print sources', () => {
    expect(
      pdfTargets('D', ['recap', 'gm-notes']).map(t => [path.basename(t.html), path.basename(t.pdf)])
    ).toEqual([
      ['recap-print.html', 'recap.pdf'],
      ['gm-notes.html', 'gm-notes.pdf'],
    ]);
  });
});
