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
      @media (max-width: 32rem) { main { width: min(100% - 1rem, 72rem); padding-top: 1rem; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Evidence fixture</h1>
      <p>Deterministic local content for the official browser adapter.</p>
      <button id="toggle" type="button" aria-expanded="false" aria-controls="details">Show details</button>
      <section id="details" class="panel" aria-labelledby="details-heading" hidden>
        <h2 id="details-heading">Verified state</h2>
        <p>The interaction state is visible.</p>
      </section>
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
  if (request.url === "/" || request.url === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
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
