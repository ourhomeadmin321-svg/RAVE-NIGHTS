#!/usr/bin/env node
/**
 * Drives the built app in a real browser and captures a screenshot of every
 * room, plus one per genre, all taken during a drop.
 *
 * This is the only check that actually proves the shaders compile and the rig
 * renders — the unit tests cover the logic but never touch WebGL.
 *
 *   npm run build && npm run shots
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);
const URL = `http://localhost:${PORT}/`;
const OUT = 'shots';

const SCENES = ['mainstage', 'cathedral', 'clubroom'];
const GENRES = ['house', 'techno', 'trance', 'dubstep', 'dnb', 'breakbeat'];

/** Poll the preview server until it answers. */
async function waitForServer(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`preview server did not start at ${url}`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Spawn the binary directly and detached: going through `npx` leaves an
  // intermediate process that swallows the signal, so the server outlives the
  // script and the run never exits.
  const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: true,
  });
  const shutdown = () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  };
  process.on('exit', shutdown);
  process.on('SIGINT', () => {
    shutdown();
    process.exit(1);
  });

  try {
    await waitForServer(URL);

    const browser = await chromium.launch({
      // Chromium ships here already; never download another copy.
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      args: [
        // Headless has no GPU, so force the software GL backend on.
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
      ],
    });

    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'ENTER THE ROOM' }).click();

    // Fail loudly if the gate refused to start (a shader link error lands here).
    const failure = await page.locator('.gate .fail').textContent().catch(() => null);
    if (failure) throw new Error(`app failed to start: ${failure}`);
    await page.waitForFunction(() => 'raveNights' in window, null, { timeout: 15_000 });

    // Software rendering is slow; pin quality low so frames still land.
    await page.evaluate(() => {
      const app = window.raveNights;
      app.setAdaptiveQuality(false);
      app.setQuality('low');
      app.setCameraMode('crowd');
    });

    const shot = async (name, setup) => {
      await page.evaluate(setup);
      // Let the arrangement reach the drop and the fixtures ease into position.
      await page.waitForTimeout(4500);
      await page.screenshot({ path: `${OUT}/${name}.png` });
      console.log(`captured ${name}`);
    };

    for (const scene of SCENES) {
      await shot(`scene-${scene}`, `(() => {
        const app = window.raveNights;
        app.setScene(${JSON.stringify(scene)});
        app.forceSection('drop');
      })()`);
    }

    await page.evaluate(`window.raveNights.setScene('mainstage')`);
    for (const genre of GENRES) {
      await shot(`genre-${genre}`, `(() => {
        const app = window.raveNights;
        app.setGenre(${JSON.stringify(genre)});
        app.forceSection('drop');
      })()`);
    }

    // A breakdown, to prove the low-energy look reads differently.
    await shot('mood-breakdown', `(() => {
      const app = window.raveNights;
      app.setScene('cathedral');
      app.setGenre('techno');
      app.forceSection('breakdown');
    })()`);

    await browser.close();

    if (errors.length > 0) {
      console.error(`\n${errors.length} console/page error(s):`);
      for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
      process.exitCode = 1;
    } else {
      console.log(`\nall clean — screenshots in ./${OUT}`);
    }
  } finally {
    shutdown();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
