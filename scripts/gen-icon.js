// gen-icon.js — render the app icon (a gold calligraphy nib on ink) to assets/icon.png
// by screenshotting an SVG with headless Chromium. No image tooling required.
const { chromium } = require('playwright-core');
const path = require('path');

const SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="112" fill="#221B13"/>
  <rect x="18" y="18" width="476" height="476" rx="96" fill="none" stroke="#D7A64A" stroke-opacity="0.28" stroke-width="3"/>
  <defs>
    <linearGradient id="g" x1="0" y1="-160" x2="0" y2="200" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#EACB86"/><stop offset="0.55" stop-color="#C08E2E"/><stop offset="1" stop-color="#8A5E16"/>
    </linearGradient>
  </defs>
  <g transform="translate(256 256)">
    <path d="M0,-158 L58,-28 L58,120 L0,196 L-58,120 L-58,-28 Z" fill="url(#g)"/>
    <line x1="0" y1="-30" x2="0" y2="158" stroke="#221B13" stroke-width="11" stroke-linecap="round"/>
    <circle cx="0" cy="-6" r="22" fill="#221B13"/>
    <circle cx="0" cy="-6" r="9" fill="#E7C787"/>
  </g>
</svg>`;

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 512, height: 512 } });
  await p.setContent(`<!doctype html><html><body style="margin:0;padding:0">${SVG}</body></html>`);
  await p.screenshot({ path: path.join(__dirname, '..', 'assets', 'icon.png') });
  await b.close();
  console.log('assets/icon.png written (512×512)');
})();
