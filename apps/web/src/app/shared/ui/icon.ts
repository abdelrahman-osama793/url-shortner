import { ChangeDetectionStrategy, Component, ElementRef, Renderer2, effect, inject, input } from '@angular/core';

import { ICONS, type IconName } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Renders a Lucide icon as inline SVG built with the renderer: no innerHTML and no sanitizer
// bypass. Icons are decorative (aria-hidden); the surrounding control carries the label.
@Component({
  selector: 'app-icon',
  template: '',
  styles: ':host { display: inline-flex; flex-shrink: 0; line-height: 0; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(16);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  constructor() {
    effect(() => this.render(this.name(), this.size()));
  }

  private render(name: IconName, size: number): void {
    const host = this.host.nativeElement;
    const svg = this.renderer.createElement('svg', SVG_NS) as SVGElement;

    const attributes: Record<string, string> = {
      xmlns: SVG_NS,
      width: String(size),
      height: String(size),
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    };

    for (const [key, value] of Object.entries(attributes)) this.renderer.setAttribute(svg, key, value);

    for (const [tag, shapeAttributes] of ICONS[name]) {
      const shape = this.renderer.createElement(tag, SVG_NS) as SVGElement;

      for (const [key, value] of Object.entries(shapeAttributes)) this.renderer.setAttribute(shape, key, String(value));

      this.renderer.appendChild(svg, shape);
    }

    host.replaceChildren(svg);
  }
}
