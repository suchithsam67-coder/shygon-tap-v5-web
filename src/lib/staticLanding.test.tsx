import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import BrandLoader from '../components/BrandLoader';
import { releaseStaticLanding, staticLandingShown, takeOverStaticLanding } from './staticLanding';

/** The landing's static first paint (V01 T-14): shown, then taken over once; loading screens stay out of its way. */

const addCopy = () => {
  const node = document.createElement('div');
  node.id = 'landing-static';
  document.body.prepend(node);
};

afterEach(() => {
  cleanup();
  document.getElementById('landing-static')?.remove();
  releaseStaticLanding();
});

describe('the static landing', () => {
  it('is taken over once: removed, and the page marked so the live hero does not replay its entrance', () => {
    addCopy();
    expect(staticLandingShown()).toBe(true);
    expect(takeOverStaticLanding()).toBe(true);
    expect(staticLandingShown()).toBe(false);
    expect(document.documentElement.dataset.staticLanding).toBe('taken');
    expect(takeOverStaticLanding()).toBe(false);
    releaseStaticLanding();
    expect(document.documentElement.dataset.staticLanding).toBeUndefined();
  });

  it('with no copy on the page, nothing is taken over or marked', () => {
    expect(takeOverStaticLanding()).toBe(false);
    expect(document.documentElement.dataset.staticLanding).toBeUndefined();
  });

  it('the loading screen stays out of the way of the copy, and shows as usual without it', () => {
    addCopy();
    const { container, rerender } = render(<BrandLoader />);
    expect(container.querySelector('.boot')).toBeNull();
    document.getElementById('landing-static')!.remove();
    rerender(<BrandLoader label="Loading again" />);
    expect(container.querySelector('.boot')).not.toBeNull();
  });
});
