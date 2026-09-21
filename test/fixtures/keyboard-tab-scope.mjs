// Synthetic only: no product markup, credentials, state or native bridge.
export function keyboardTabScopeHtml(mode) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>Sequential focus scope fixture</title>
<style>
body { margin: 16px; color: #111; background: #fff; font: 16px/1.5 sans-serif; }
button { min-height: 44px; color: #111; background: #fff; padding: 8px; }
dialog { color: #111; background: #fff; max-width: calc(100vw - 64px); }
:focus-visible { outline: 3px solid #175cd3; }
label { display: inline-block; padding: 8px; }
</style></head><body><main><h1>Sequential focus scope</h1>
<button id="outside">Outside</button><div id="holder"></div>
<script>
const mode = ${JSON.stringify(mode)};
const holder = document.getElementById('holder');
const choices = '<label><input id="choice-a" type="radio" name="choice">A</label>' +
  '<label><input id="choice-b" type="radio" name="choice" checked>B</label>' +
  '<label><input id="choice-c" type="radio" name="choice">C</label>';
const trap = element => element.addEventListener('keydown', event => {
  if (event.key === 'Tab') event.preventDefault();
});
if (mode.startsWith('modal') || mode === 'modeless' || mode === 'aria-modal') {
  const root = mode === 'modal-shadow' ? holder.attachShadow({mode: 'open'}) : holder;
  const tag = mode === 'aria-modal' ? 'section role="dialog" aria-modal="true"' : 'dialog';
  const closing = mode === 'aria-modal' ? 'section' : 'dialog';
  root.innerHTML = '<' + tag + ' id="scope" aria-label="Scope"><button id="first">First</button>' +
    '<fieldset><legend>Choice</legend>' + choices + '</fieldset><button id="last">Last</button></' + closing + '>';
  const dialog = root.querySelector('#scope');
  if (mode === 'modal-stack') {
    // Open in the opposite order to DOM order; the last DOM dialog is NOT topmost.
    const lower = document.createElement('dialog');
    lower.id = 'lower'; lower.innerHTML = '<button id="lower-action">Lower modal</button>';
    document.body.append(lower); lower.showModal();
  }
  if (mode === 'modal-inert-ancestor') holder.inert = true;
  if (mode.startsWith('modal')) dialog.showModal();
  else if (mode === 'modeless') dialog.show();
  if (mode === 'modal-trap') trap(root.querySelector('#first'));
} else {
  holder.innerHTML = '<button id="before">Before groups</button><fieldset><legend>Choice</legend>' +
    choices + '</fieldset><button id="last">Last</button>';
  if (mode.startsWith('radio-unchecked')) holder.querySelector('#choice-b').checked = false;
  if (mode.endsWith('-trap')) trap(holder.querySelector('#before'));
  if (mode === 'radio-groups') {
    holder.querySelector('fieldset').remove();
    const group = (prefix, name) => '<label><input id="' + prefix + '-a" type="radio" name="' + name + '">A</label>' +
      '<label><input id="' + prefix + '-b" type="radio" name="' + name + '" checked>B</label>';
    holder.insertAdjacentHTML('beforeend', '<form id="form-a">' + group('form-a', 'shared') + '</form>' +
      '<form id="form-b">' + group('form-b', 'shared') + '</form>' +
      '<label><input id="external-form-a" form="form-a" type="radio" name="shared">External form A member</label>' +
      group('upper', 'Case') + group('lower', 'case') +
      '<label><input id="unnamed-a" type="radio">Unnamed A</label><label><input id="unnamed-b" type="radio">Unnamed B</label>' +
      '<div id="root-a"></div><div id="root-b"></div>' +
      '<fieldset disabled><legend><button id="legend-action">Enabled legend</button></legend>' +
      '<button id="fieldset-disabled" tabindex="0">Disabled by fieldset</button></fieldset>' +
      '<button id="disabled" disabled tabindex="0">Disabled explicitly</button><button id="negative" tabindex="-2">Not sequential</button>' +
      '<div id="custom-a" role="radio" aria-checked="true" tabindex="0">Custom A</div>' +
      '<div id="custom-b" role="radio" aria-checked="false" tabindex="0">Custom B</div>');
    for (const id of ['root-a', 'root-b']) {
      document.getElementById(id).attachShadow({mode: 'open'}).innerHTML = group('shadow', 'shared');
    }
  }
}
</script></main></body></html>`;
}
