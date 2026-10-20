import { configure } from '@testing-library/react';

// jsdom implements no scrolling; ScrollToTop calls window.scrollTo on every
// navigation. A no-op keeps the component tests' output to real failures.
window.scrollTo = (() => {}) as typeof window.scrollTo;

// The public Tap's AAROH experience is a lazy chunk. The first test in a file
// that waits for it also waits for Vitest to transform that chunk, which on a
// loaded machine takes longer than Testing Library's default one second
// (observed: 1.25 s). Waiting longer changes no assertion; it only stops a
// cold transform from reading as a failure.
configure({ asyncUtilTimeout: 5000 });
