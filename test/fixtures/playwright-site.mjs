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
      @media (max-width: 32rem) { main { width: min(100% - 1rem, 72rem); padding-top: 1rem; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Evidence fixture</h1>
      <p>Deterministic local content for the official browser adapter.</p>
      <button id="toggle" type="button" aria-expanded="false" aria-controls="details">Show details</button>
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
