#!/usr/bin/env node
/**
 * Inlines the Vite build into one self-contained HTML file.
 *
 * The whole app is 128KB across exactly two assets and makes no network
 * requests at runtime, so it collapses into a single page cleanly. That page
 * can be opened straight off disk, emailed, dropped on any static host, or
 * published somewhere with a strict content-security policy that forbids
 * external hosts.
 *
 * Emits two variants:
 *   dist/rave-nights.html    complete standalone document
 *   dist/artifact-body.html  same content minus the doctype/html/head/body
 *                            wrapper, for hosts that supply their own
 *
 *   npm run build:single
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';

/**
 * A closing tag inside a JavaScript string literal ends the surrounding
 * `<script>` element — the parser does not care that it is quoted. Today's
 * bundle contains none, but a future shader string could, and the failure mode
 * is a silently truncated page rather than an error.
 */
function escapeForScript(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

function escapeForStyle(css) {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

async function main() {
  const html = await readFile(join(DIST, 'index.html'), 'utf8');
  const assets = await readdir(join(DIST, 'assets'));

  const jsName = assets.find((f) => f.endsWith('.js'));
  const cssName = assets.find((f) => f.endsWith('.css'));
  if (!jsName) throw new Error('no JS bundle in dist/assets — run `npm run build` first');

  const js = await readFile(join(DIST, 'assets', jsName), 'utf8');
  const css = cssName ? await readFile(join(DIST, 'assets', cssName), 'utf8') : '';

  let out = html;

  // Swap the emitted <script src> for the bundle itself. Still a module: the
  // bundle is a single ES module with no remaining imports.
  const scriptTag = new RegExp(`<script[^>]*src="[^"]*${jsName}"[^>]*>\\s*</script>`);
  if (!scriptTag.test(out)) throw new Error(`could not find the <script> tag for ${jsName}`);
  out = out.replace(scriptTag, `<script type="module">\n${escapeForScript(js)}\n</script>`);

  if (cssName) {
    const linkTag = new RegExp(`<link[^>]*href="[^"]*${cssName}"[^>]*>`);
    if (!linkTag.test(out)) throw new Error(`could not find the <link> tag for ${cssName}`);
    out = out.replace(linkTag, `<style>\n${escapeForStyle(css)}\n</style>`);
  }

  await writeFile(join(DIST, 'rave-nights.html'), out);

  // Body-only variant: keep the <style>, the markup and the <script>, drop the
  // document scaffolding so a host can supply its own.
  //
  // Vite emits the module script into <head>, so it has to be lifted out
  // explicitly — taking only what is between the <body> tags yields a page with
  // markup and no application.
  const bodyMatch = out.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) throw new Error('could not locate <body> in the built page');
  const styleMatch = out.match(/<style>[\s\S]*?<\/style>/i);
  const inlineScript = out.match(/<script type="module">[\s\S]*?<\/script>/i);
  if (!inlineScript) throw new Error('could not locate the inlined module script');

  // Script last so the elements it looks up already exist, regardless of
  // whether the host preserves module defer semantics.
  const markup = bodyMatch[1].replace(/<script type="module">[\s\S]*?<\/script>/i, '').trim();
  const body = [styleMatch?.[0], markup, inlineScript[0]].filter(Boolean).join('\n') + '\n';
  await writeFile(join(DIST, 'artifact-body.html'), body);

  if (Buffer.byteLength(body) < Buffer.byteLength(js)) {
    throw new Error('body-only variant is smaller than the bundle — the script was dropped');
  }

  // Fail loudly rather than shipping a page that silently reaches off-host.
  const external = out.match(/(?:src|href)="(?!data:)(?:https?:)?\/\/[^"]*"/gi);
  if (external) {
    throw new Error(`inlined page still references external resources:\n  ${external.join('\n  ')}`);
  }
  if (/(?:src|href)="\.?\/?assets\//i.test(out)) {
    throw new Error('inlined page still references dist/assets');
  }

  const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)}KB`;
  console.log(`dist/rave-nights.html     ${kb(out)}  (self-contained)`);
  console.log(`dist/artifact-body.html   ${kb(body)}  (no document wrapper)`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
