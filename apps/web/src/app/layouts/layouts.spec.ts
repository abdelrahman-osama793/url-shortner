import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PublicLayout } from './public-layout';
import { WorkspaceLayout } from './workspace-layout';

function linkTexts(element: HTMLElement): string[] {
  return [...element.querySelectorAll('a')].map((link) => link.textContent?.trim() ?? '');
}

describe('PublicLayout', () => {
  it('always offers Log in, Sign up, a skip link and Report abuse', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });

    const fixture = TestBed.createComponent(PublicLayout);

    fixture.detectChanges();

    const texts = linkTexts(fixture.nativeElement);

    expect(texts).toContain('Log in');
    expect(texts.some((text) => text.startsWith('Sign up'))).toBe(true);
    expect(texts).toContain('Skip to content');
    expect(texts.some((text) => text.startsWith('Report abuse'))).toBe(true);
  });
});

describe('WorkspaceLayout', () => {
  function render(isAdmin: boolean): string[] {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });

    const fixture = TestBed.createComponent(WorkspaceLayout);

    fixture.componentRef.setInput('isAdmin', isAdmin);
    fixture.detectChanges();

    return [...fixture.nativeElement.querySelectorAll('nav[aria-label="Workspace"] a')].map((link: Element) => link.textContent?.trim() ?? '');
  }

  it('shows the member sections and hides administration from non-admins', () => {
    expect(render(false)).toEqual(['Your links', 'Analytics', 'Account']);
  });

  it('adds administration for admins', () => {
    expect(render(true)).toContain('Administration');
  });
});
