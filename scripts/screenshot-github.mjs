#!/usr/bin/env node
/**
 * Take screenshots of GitHub repo page and git log for LinkedIn posts.
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const OUTDIR = '/Users/gaca/output/personal/linkedin-mcp';
mkdirSync(OUTDIR, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({ headless: true });

  // Post 6: GitHub repo page
  const page1 = await browser.newPage();
  await page1.setViewport({ width: 1200, height: 627 });
  await page1.goto('https://github.com/gacabartosz/linkedin-mcp-server', { waitUntil: 'networkidle2', timeout: 30000 });
  await page1.screenshot({ path: `${OUTDIR}/post6-github.png`, type: 'png' });
  console.log(`Generated: ${OUTDIR}/post6-github.png`);

  await browser.close();
}

main().catch(console.error);
