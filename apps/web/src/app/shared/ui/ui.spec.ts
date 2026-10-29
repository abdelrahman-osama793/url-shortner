import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EffectiveStatus } from '@shortlist/contracts';

import { Icon } from './icon';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  const cases: [EffectiveStatus, string][] = [
    ['active', 'Active'],
    ['disabled', 'Disabled'],
    ['expired', 'Expired'],
    ['blocked', 'Blocked'],
    ['ownerSuspended', 'Owner suspended'],
  ];

  for (const [status, label] of cases) {
    it(`shows ${status} as text "${label}"`, () => {
      const fixture = TestBed.createComponent(StatusBadge);

      fixture.componentRef.setInput('status', status);
      fixture.detectChanges();

      const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement;

      expect(badge.textContent?.trim()).toBe(label);
      expect(badge.dataset['status']).toBe(status);
    });
  }
});

@Component({
  imports: [Icon],
  template: `<app-icon [name]="name()" [size]="20" />`,
})
class IconHost {
  readonly name = input<'link' | 'check'>('link');
}

describe('Icon', () => {
  it('renders an accessible-hidden inline SVG and redraws when the name changes', () => {
    const fixture = TestBed.createComponent(IconHost);

    fixture.detectChanges();

    const svg = () => fixture.nativeElement.querySelector('svg') as SVGElement;

    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(svg().getAttribute('width')).toBe('20');
    expect(svg().children.length).toBeGreaterThan(0);

    const before = svg().innerHTML;

    fixture.componentRef.setInput('name', 'check');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('svg').length).toBe(1);
    expect(svg().innerHTML).not.toBe(before);
  });
});
