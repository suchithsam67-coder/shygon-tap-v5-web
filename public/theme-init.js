// The saved light/dark choice, applied before the first paint (src/lib/theme.ts).
// A file rather than an inline script, so the Content-Security-Policy can
// refuse every inline script.
try {
  if (localStorage.getItem('shygon_theme') === 'light') {
    document.documentElement.dataset.theme = 'light';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f6f3ec');
  }
} catch (e) {
  // Storage blocked: the default dark theme stands.
}
