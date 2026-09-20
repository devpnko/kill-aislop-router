import http from "node:http";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>Playwright evidence fixture</title>
    <style>
      * { box-sizing: border-box; }
      :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; }
      body { margin: 0; color: #111; background: #fff; }
      main { width: min(100% - 2rem, 72rem); margin: 0 auto; padding: 2rem 0; }
      button { min-height: 44px; padding: .625rem 1rem; color: #fff; background: #123a63; border: 2px solid #123a63; border-radius: .375rem; }
      button:focus-visible { outline: 3px solid #d94600; outline-offset: 3px; }
      [hidden] { display: none; }
      .panel { margin-top: 1rem; padding: 1rem; border: 2px solid #123a63; }
      .sponsor-slot { margin-top: 1rem; padding: 1rem; border: 2px dashed #123a63; background: rgb(255, 255, 255); }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      .intentional-overlay { display: grid; width: 8rem; min-height: 2rem; }
      .intentional-overlay > span { grid-area: 1 / 1; }
      .intentional-truncation { display: block; width: 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      [role="tablist"] { display: flex; gap: .5rem; margin-top: 1rem; }
      @media (max-width: 32rem) { main { width: min(100% - 1rem, 72rem); padding-top: 1rem; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Evidence fixture</h1>
      <p>Deterministic local content for the official browser adapter.</p>
      <button id="toggle" type="button" aria-expanded="false" aria-controls="details">Show details</button>
      <div role="tablist" aria-label="Fixture views">
        <button id="active-tab" type="button" role="tab" aria-selected="true" tabindex="0">Overview</button>
        <button id="inactive-tab" type="button" role="tab" aria-selected="false" tabindex="-1">History</button>
      </div>
      <details id="closed-advanced">
        <summary>Advanced controls</summary>
        <button id="closed-action" type="button">Hidden action</button>
      </details>
      <label>Fixture date <input id="fixture-date" type="date"></label>
      <section id="details" class="panel" aria-labelledby="details-heading" hidden>
        <h2 id="details-heading">Verified state <span class="sr-only">with assistive-only context</span></h2>
        <p>The interaction state is visible.</p>
      </section>
      <small class="window-label">Last 60 minutes</small>
      <aside class="sponsor-slot" aria-label="Advertising slot">Advertising slot</aside>
      <div class="intentional-overlay" data-killsloprouter-overlap="allow"><span>Base</span><span>Badge</span></div>
      <a class="intentional-truncation" data-killsloprouter-clipping="allow" href="#details">Approved intentional truncation</a>
    </main>
    <script>
      const button = document.querySelector('#toggle');
      const panel = document.querySelector('#details');
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!expanded));
        button.textContent = expanded ? 'Show details' : 'Hide details';
        panel.hidden = expanded;
      });
    </script>
  </body>
</html>`;

const layoutFailureHtml = html
  .replace("</style>", `
      #collision { display: grid; grid-template-columns: 100px 100px; width: 200px; }
      #collision > span { display: block; padding: .5rem; background: #eef2ff; }
      #collision > span:first-child { width: 150px; }
      #clipped-title { width: 8rem; overflow: hidden; white-space: nowrap; }
      .sponsor-slot { border-style: solid; background: rgb(238, 242, 255); }
    </style>`)
  .replace("</main>", `
      <section aria-labelledby="clipped-title">
        <h2 id="clipped-title">A required title that is visibly clipped</h2>
        <div id="collision"><span>First region</span><span>Second region</span></div>
        <small class="window-label">Last 60 minutes</small>
      </section>
    </main>`);

const keyboardShadowHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>Shadow keyboard fixture</title>
<style>body { margin: 1rem; color: #111; background: #fff; font: 16px/1.5 sans-serif; }
button { min-height: 44px; padding: .5rem; color: #111; background: #fff; }
button:focus-visible { outline: 3px solid #175cd3; }</style></head>
<body><main><h1>Shadow keyboard fixture</h1>
<button id="shared-action">Light action</button>
<div id="component-a"></div><div id="component-b"></div><div id="nested"></div><div id="anonymous"></div>
<div id="slotted"><button id="slotted-action">Slotted action</button></div>
<div id="inert-host" inert></div>
<details><summary>Closed details</summary><div id="closed-host"></div></details>
</main><script>
const shadowStyle = '<style>:host{display:block;margin:.25rem 0}button{min-height:44px;padding:.5rem;color:#111;background:#fff}button:focus-visible{outline:3px solid #175cd3}</style>';
for (const name of ['component-a', 'component-b', 'inert-host', 'closed-host']) {
  const root = document.getElementById(name).attachShadow({mode:'open'});
  root.innerHTML = shadowStyle + '<button id="shared-action">' + name + ' action</button>';
}
const outer = document.getElementById('nested').attachShadow({mode:'open'});
outer.innerHTML = '<div id="inner-host"></div>';
outer.getElementById('inner-host').attachShadow({mode:'open'}).innerHTML = shadowStyle + '<button id="deep-action">Nested action</button>';
outer.getElementById('inner-host').shadowRoot.querySelector('button').addEventListener('click', event => { event.target.textContent = 'Nested selected'; });
document.getElementById('anonymous').attachShadow({mode:'open'}).innerHTML = shadowStyle + '<button>First anonymous action</button><button>Second anonymous action</button>';
document.getElementById('slotted').attachShadow({mode:'open'}).innerHTML = '<slot></slot>';
if (/* TRAP */ false) document.getElementById('component-a').shadowRoot.querySelector('button').addEventListener('keydown', event => {
  if (event.key === 'Tab') event.preventDefault();
});
</script></body></html>`;

const keyboardVisibilityHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>Restored visibility keyboard fixture</title>
<style>body { margin: 1rem; color: #111; background: #fff; font: 16px/1.5 sans-serif; }</style></head>
<body><main></main><script>
const hiddenBody = /* HIDDEN_BODY */ false;
const main = document.querySelector('main');
if (hiddenBody) document.body.style.visibility = 'hidden';
else main.innerHTML = '<button id="before">Before hidden host</button><div id="visibility-host" style="visibility:hidden"></div>';
const container = hiddenBody ? main : document.getElementById('visibility-host').attachShadow({mode:'open'});
container.innerHTML = '<style>button{min-height:44px;padding:.5rem;color:#111;background:#fff}.restored{visibility:visible}button:focus-visible{outline:3px solid #175cd3}</style><button class="restored" id="first">First restored control</button><button class="restored" id="second">Second restored control</button><button id="inherited-hidden">Actually hidden</button>';
if (/* TRAP */ false) container.querySelector('#first').addEventListener('keydown', event => {
  if (event.key === 'Tab') event.preventDefault();
});
</script></body></html>`;

const server = http.createServer((request, response) => {
  if (request.url === "/.well-known/killsloprouter-artifact.json") {
    const artifactDigests = JSON.parse(process.env.KSR_TEST_ARTIFACT_DIGESTS || "{}");
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({
      killsloprouter_browser_attestation_version: 1,
      artifact_digests: artifactDigests
    }));
    return;
  }
  if (["/keyboard-shadow", "/keyboard-shadow-trap"].includes(request.url)) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(keyboardShadowHtml.replace("/* TRAP */ false", String(request.url === "/keyboard-shadow-trap")));
    return;
  }
  if (["/keyboard-visible-body", "/keyboard-visible-body-trap", "/keyboard-visible-host", "/keyboard-visible-host-trap"].includes(request.url)) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(keyboardVisibilityHtml.replace("/* HIDDEN_BODY */ false", String(request.url.includes("-body")))
      .replace("/* TRAP */ false", String(request.url.endsWith("-trap"))));
    return;
  }
  if (["/", "/index.html", "/changed", "/layout-bad"].includes(request.url)) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    if (request.url === "/changed") {
      response.end(html.replace("<h1>Evidence fixture</h1>", "<h1>Materially changed evidence fixture</h1>"));
    } else {
      response.end(request.url === "/layout-bad" ? layoutFailureHtml : html);
    }
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${address.port}` })}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
