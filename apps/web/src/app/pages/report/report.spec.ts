import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ReportPage, extractCode } from './report';

const settle = () => new Promise((resolve) => setTimeout(resolve));

let backend: HttpTestingController;

async function render(inputs: Record<string, string> = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  backend = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(ReportPage);
  const element: HTMLElement = fixture.nativeElement;

  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();

  return {
    element,
    text: () => element.textContent?.replace(/\s+/g, ' ') ?? '',
    type(selector: string, value: string) {
      const field = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;

      field.value = value;
      field.dispatchEvent(new Event('input'));
    },
    choose(value: string) {
      const radio = element.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;

      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    },
    async submit() {
      element.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
      fixture.detectChanges();
    },
    async refresh() {
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
    },
  };
}

describe('extractCode', () => {
  it('takes the code from a full short link, keeping its case', () => {
    expect(extractCode('https://shortlist.example/r/AbC123?utm=x#top')).toBe('AbC123');
    expect(extractCode('  localhost:4200/r/my-alias  ')).toBe('my-alias');
    expect(extractCode('AbC123')).toBe('AbC123');
    expect(extractCode('https://x/r/bad%E0%A4')).toBe('bad%E0%A4');
  });
});

describe('ReportPage', () => {
  it('asks for the link and a category before sending', async () => {
    const page = await render();

    await page.submit();

    expect(page.text()).toContain('Enter the short link or its code.');
    expect(page.text()).toContain('Choose what is wrong with the link.');
    backend.expectNone('/api/v1/reports');
  });

  it('sends the code, category and trimmed details, then shows the same confirmation for any link', async () => {
    const page = await render();

    page.type('#report-link', 'https://shortlist.example/r/Abc123');
    page.choose('phishing');
    page.type('#report-details', '  Fake bank login page.  ');
    await page.submit();

    const request = backend.expectOne('/api/v1/reports');

    expect(request.request.body).toEqual({ code: 'Abc123', category: 'phishing', details: 'Fake bank login page.' });
    request.flush({ status: 'accepted' }, { status: 202, statusText: 'Accepted' });
    await page.refresh();

    expect(page.text()).toContain('Thanks for your report');
    expect(page.text()).toContain('If the link exists, our team will review it.');
    expect(document.activeElement?.textContent).toBe('Thanks for your report');
  });

  it('leaves out empty details', async () => {
    const page = await render();

    page.type('#report-link', 'Abc123');
    page.choose('spam');
    page.type('#report-details', '   ');
    await page.submit();

    expect(backend.expectOne('/api/v1/reports').request.body).toEqual({ code: 'Abc123', category: 'spam' });
  });

  it('keeps everything typed when the quota is reached, and says how long to wait', async () => {
    const page = await render();

    page.type('#report-link', 'Abc123');
    page.choose('malware');
    page.type('#report-details', 'Downloads an .exe');
    await page.submit();
    backend.expectOne('/api/v1/reports').flush({ error: { code: 'RATE_LIMITED', message: 'x' } }, { status: 429, statusText: 'x', headers: { 'Retry-After': '1200' } });
    await page.refresh();

    expect(page.text()).toContain('Please try again in about 20 minutes.');
    expect(page.element.querySelector<HTMLInputElement>('#report-link')!.value).toBe('Abc123');
    expect(page.element.querySelector<HTMLInputElement>('input[value="malware"]')!.checked).toBe(true);
    expect(page.element.querySelector<HTMLTextAreaElement>('#report-details')!.value).toBe('Downloads an .exe');
  });

  it('is prefilled from ?code=', async () => {
    const page = await render({ code: 'Abc123' });

    expect(page.element.querySelector<HTMLInputElement>('#report-link')!.value).toBe('Abc123');
  });
});
