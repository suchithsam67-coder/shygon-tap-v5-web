// jsdom implements no scrolling; ScrollToTop calls window.scrollTo on every
// navigation. A no-op keeps the component tests' output to real failures.
window.scrollTo = (() => {}) as typeof window.scrollTo;
