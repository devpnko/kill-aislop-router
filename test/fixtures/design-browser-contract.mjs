// Deliberately synthetic protocol fixture, not a design-quality benchmark.
export function designScenarios(states = ["default", "error"], locales = ["en-US", "ko-KR"]) {
  return locales.flatMap((locale) => states.map((state) => ({
    id: `${state}.${locale}`,
    path: "/",
    design: { state, locale },
    actions: [
      { type: "click", locator: `[data-test-locale="${locale}"]` },
      ...(state === "default" ? [] : [{ type: "click", locator: `[data-test-state="${state}"]` }])
    ],
    assertions: [{ type: "visible", locator: `[data-killsloprouter-state="${state}"]` }]
  })));
}

export function designPrototype({
  states = ["default", "error"],
  locales = ["en-US", "ko-KR"],
  title = "Design state fixture",
  extra = "",
  extraHead = "",
  extraCss = "",
  brokenState = "",
  brokenLocale = "",
  allStatesVisible = false
} = {}) {
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width"><title>${title}</title>
<style>body{margin:0;color:#0f172a;background:#fff;font:16px sans-serif}main{padding:24px}
button{color:#fff;background:#1d4ed8;border:2px solid #1d4ed8;padding:12px;margin:4px}
${extraCss}</style>${extraHead}</head><body><main>
<h1>${title}</h1>
<nav aria-label="Fixture languages">${locales.map((locale) =>
    `<button data-test-locale="${locale}">${locale}</button>`).join("")}</nav>
<nav aria-label="Fixture states">${states.map((state) =>
    `<button data-test-state="${state}">${state}</button>`).join("")}</nav>
${states.map((state) => `<section data-killsloprouter-state="${state}"${
    state === "default" || allStatesVisible ? "" : " hidden"}><h2>${state}</h2>
<p data-state-copy>Review state: ${state}</p></section>`).join("")}
${extra}</main><script>
const brokenState = ${JSON.stringify(brokenState)};
const brokenLocale = ${JSON.stringify(brokenLocale)};
document.querySelectorAll('[data-test-state]').forEach(button => {
  button.addEventListener('click', () => {
    if (button.dataset.testState === brokenState) return;
    document.querySelectorAll('[data-killsloprouter-state]').forEach(section => {
      section.hidden = section.dataset.killsloprouterState !== button.dataset.testState;
    });
  });
});
document.querySelectorAll('[data-test-locale]').forEach(button => {
  button.addEventListener('click', () => {
    const locale = button.dataset.testLocale;
    if (locale === brokenLocale) return;
    document.documentElement.lang = locale;
    document.querySelectorAll('[data-state-copy]').forEach(copy => {
      copy.textContent = locale === 'ko-KR' ? '검토 상태를 확인하세요.' : 'Review the current state.';
    });
  });
});
</script></body></html>`;
}
