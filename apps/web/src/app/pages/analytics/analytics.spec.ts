import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Link, LinkAnalytics } from '@shortlist/contracts';

import { AnalyticsPage } from './analytics';
import { countryLabel, describeRange, formatCount, parseRange, rangeFor, referrerLabel, timeAgo } from './format';

const LINK: Link = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'launch',
  shortUrl: 'http://localhost:4200/r/launch',
  destinationUrl: 'https://example.com/launch',
  expiresAt: null,
  enabled: true,
  effectiveStatus: 'active',
  version: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
};

function stats(overrides: Partial<LinkAnalytics> = {}): LinkAnalytics {
  return {
    linkId: LINK.id,
    from: '2026-10-27',
    to: '2026-10-30',
    timezone: 'UTC',
    totalClicks: '9007199254740993',
    rangeClicks: '12',
    daily: [
      { date: '2026-10-27', clicks: '2' },
      { date: '2026-10-28', clicks: '0' },
      { date: '2026-10-29', clicks: '10' },
    ],
    countries: [{ country: 'EG', clicks: '9' }, { country: 'unknown', clicks: '3' }],
    devices: [{ device: 'mobile', clicks: '12' }],
    referrers: [{ host: 'direct_or_unknown', clicks: '12' }],
    lastUpdatedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    pipeline: { status: 'healthy', heartbeatAt: new Date().toISOString(), oldestPendingAt: null },
    approximate: true,
    ...overrides,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('analytics formatting', () => {
  it('formats bigint counters exactly', () => {
    expect(formatCount('9007199254740993')).toBe('9,007,199,254,740,993');
  });

  it('builds UTC ranges that end today and match the API (to exclusive)', () => {
    const now = Date.UTC(2026, 9, 29, 23, 30);

    expect(rangeFor(7, now)).toEqual({ from: '2026-10-23', to: '2026-10-30' });
    expect(rangeFor(90, now)).toEqual({ from: '2026-08-01', to: '2026-10-30' }); // exactly the 90-day maximum
    expect(describeRange('2026-10-23', '2026-10-30')).toBe('23 October 2026 – 29 October 2026');
  });

  it('accepts only the offered ranges', () => {
    expect(parseRange('7')).toBe(7);
    expect(parseRange('365')).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });

  it('labels unknown values honestly', () => {
    expect(countryLabel('EG')).toBe('Egypt');
    expect(countryLabel('unknown')).toBe('Unknown');
    expect(referrerLabel('direct_or_unknown')).toBe('Direct or unknown');
    expect(referrerLabel('other')).toBe('Other sites');
  });

  it('describes how long ago', () => {
    const now = Date.UTC(2026, 9, 29, 12);

    expect(timeAgo(new Date(now - 10_000).toISOString(), now)).toBe('just now');
    expect(timeAgo(new Date(now - 60_000).toISOString(), now)).toBe('1 minute ago');
    expect(timeAgo(new Date(now - 5 * 3600_000).toISOString(), now)).toBe('5 hours ago');
  });
});

describe('AnalyticsPage', () => {
  let backend: HttpTestingController;

  async function render(inputs: Record<string, string> = {}, links: Link[] = [LINK]) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    backend = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(AnalyticsPage);

    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    backend.expectOne((request) => request.url === '/api/v1/links').flush({ items: links, nextCursor: null });
    await settle();
    fixture.detectChanges();

    const refresh = async () => {
      await settle();
      fixture.detectChanges();
    };

    return { fixture, refresh, text: () => (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '', element: fixture.nativeElement as HTMLElement };
  }

  const analyticsRequest = () => backend.expectOne((request) => request.url.endsWith('/analytics'));

  it('asks for the selected period as explicit UTC dates and shows the API numbers', async () => {
    const page = await render({ range: '7' });
    const request = analyticsRequest();

    expect(request.request.url).toBe(`/api/v1/links/${LINK.id}/analytics`);
    expect(request.request.params.keys()).toEqual(['from', 'to']);
    request.flush(stats());
    await page.refresh();

    expect(page.text()).toContain('12'); // rangeClicks
    expect(page.text()).toContain('9,007,199,254,740,993 since the link was created');
    expect(page.text()).toContain('27 October 2026 – 29 October 2026');
    expect(page.text()).toContain('Egypt');
    expect(page.text()).toContain('Unknown');
    expect(page.text()).toContain('Direct or unknown');
    expect(page.text()).toContain('Live.');
    expect(page.text()).toContain('4 minutes ago');
    expect(page.text()).toContain('not unique visitors');
  });

  it('describes the chart for screen readers and lists every day in a table', async () => {
    const page = await render();

    analyticsRequest().flush(stats());
    await page.refresh();

    expect(page.element.querySelector('.bars')!.getAttribute('aria-label')).toContain('Busiest day 29 Oct with 10 clicks');
    expect(page.element.querySelectorAll('.bar')).toHaveLength(3);
    expect(page.element.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('shows a zero state for a link nobody has opened yet', async () => {
    const page = await render();

    analyticsRequest().flush(stats({ totalClicks: '0', rangeClicks: '0', countries: [], devices: [], referrers: [], lastUpdatedAt: null }));
    await page.refresh();

    expect(page.text()).toContain('No clicks yet');
    expect(page.element.querySelector('.bars')).toBeNull();
  });

  it('says when processing is delayed, separately from zero and unavailable', async () => {
    const page = await render();

    analyticsRequest().flush(stats({ pipeline: { status: 'delayed', heartbeatAt: null, oldestPendingAt: null } }));
    await page.refresh();

    expect(page.text()).toContain('Updates are running behind');
    expect(page.text()).not.toContain('Analytics unavailable');
  });

  it('shows an unavailable state with a retry when analytics cannot be loaded', async () => {
    const page = await render();

    analyticsRequest().flush({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } }, { status: 503, statusText: 'x' });
    await page.refresh();

    expect(page.text()).toContain('Analytics unavailable');

    [...page.element.querySelectorAll('button')].find((button) => button.textContent?.includes('Try again'))!.click();
    await settle();
    analyticsRequest().flush(stats());
    await page.refresh();

    expect(page.text()).toContain('Clicks in this period');
  });

  it('points to the links page when there are no links', async () => {
    const page = await render({}, []);

    expect(page.text()).toContain('No links yet');
    backend.expectNone((request) => request.url.endsWith('/analytics'));
  });

  it('polls while visible and keeps the last numbers if a refresh fails', async () => {
    const page = await render();

    analyticsRequest().flush(stats());
    await settle();
    // Fake timers only now, after the first answer scheduled nothing yet (it schedules on flush).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      page.fixture.componentInstance['schedule']();
      page.fixture.detectChanges();

      // Timers are fake here, so let promises settle with microtasks only.
      const microtasks = async () => {
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
        page.fixture.detectChanges();
      };

      vi.advanceTimersByTime(15_000);
      analyticsRequest().flush({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } }, { status: 503, statusText: 'x' });
      await microtasks();

      expect(page.text()).toContain("Couldn't refresh; showing the last numbers.");
      expect(page.text()).toContain('Clicks in this period');

      vi.advanceTimersByTime(60_000);
      backend.expectNone((request) => request.url.endsWith('/analytics'));
    } finally {
      vi.useRealTimers();
    }
  });
});
