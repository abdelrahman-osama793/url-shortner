import { DOCUMENT, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Link, LinkAnalytics } from '@shortlist/contracts';

import { Analytics } from '../../core/api/analytics';
import { Links } from '../../core/api/links';
import { type ApiError, commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

import {
  RANGES,
  type RangeDays,
  countryLabel,
  describeRange,
  deviceLabel,
  formatCount,
  parseRange,
  rangeFor,
  referrerLabel,
  share,
  shortDay,
  timeAgo,
} from './format';

// Polling: often enough to see clicks arrive (the worker usually needs under a second), rare
// enough for the 120/min read limit, and only while the tab is visible. It stops after ten
// minutes so a forgotten tab does not poll forever; "Refresh" starts it again.
const POLL_MS = 15_000;
const MAX_POLLS = 40;

const SELECTOR_LIMIT = 100;

interface Breakdown {
  title: string;
  rows: { label: string; clicks: string; share: number }[];
}

// One link's clicks (UI_HANDOFF "Analytics"): lifetime total, the selected range's daily chart,
// and country/device/referrer breakdowns. Loading, no clicks, delayed processing and
// unavailable analytics each look different. Counts are clicks, never "visitors".
@Component({
  selector: 'app-analytics',
  imports: [DecimalPipe, RouterLink, Icon],
  templateUrl: './analytics.html',
  styleUrl: './analytics.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsPage {
  private readonly links = inject(Links);
  private readonly analytics = inject(Analytics);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  // ?link=<id>&range=7|30|90
  readonly link = input<string>();
  readonly range = input<string>();

  protected readonly ranges = RANGES;
  protected readonly format = formatCount;
  protected readonly shortDay = shortDay;

  protected readonly ownLinks = signal<Link[] | null>(null);
  protected readonly linksError = signal<string | null>(null);
  protected readonly data = signal<LinkAnalytics | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly refreshFailed = signal(false);
  protected readonly paused = signal(false);
  protected readonly now = signal(Date.now());

  protected readonly days = computed<RangeDays>(() => parseRange(this.range()));
  protected readonly selectedId = computed(() => this.link() ?? this.ownLinks()?.[0]?.id ?? null);
  protected readonly selected = computed(() => this.ownLinks()?.find((link) => link.id === this.selectedId()) ?? null);

  protected readonly rangeLabel = computed(() => {
    const data = this.data();

    return data ? describeRange(data.from, data.to) : '';
  });

  protected readonly chart = computed(() => {
    const daily = this.data()?.daily ?? [];
    const top = daily.reduce((max, day) => (BigInt(day.clicks) > max ? BigInt(day.clicks) : max), 0n);
    const scale = niceMax(top);

    return {
      scale,
      bars: daily.map((day) => ({ ...day, height: (Number(day.clicks) / Number(scale)) * 100 })),
      labels: daily.length > 0 ? [daily[0], daily[Math.floor(daily.length / 2)], daily[daily.length - 1]] : [],
      busiest: daily.find((day) => BigInt(day.clicks) === top && top > 0n) ?? null,
    };
  });

  protected readonly breakdowns = computed<Breakdown[]>(() => {
    const data = this.data();

    if (!data) return [];

    const rows = <T>(items: T[], label: (item: T) => string, clicks: (item: T) => string) =>
      items.map((item) => ({ label: label(item), clicks: clicks(item), share: share(clicks(item), data.rangeClicks) }));

    return [
      { title: 'Countries', rows: rows(data.countries, (item) => countryLabel(item.country), (item) => item.clicks) },
      { title: 'Devices', rows: rows(data.devices, (item) => deviceLabel(item.device), (item) => item.clicks) },
      { title: 'Referring sites', rows: rows(data.referrers, (item) => referrerLabel(item.host), (item) => item.clicks) },
    ];
  });

  protected readonly updated = computed(() => {
    const at = this.data()?.lastUpdatedAt;

    return at ? timeAgo(at, this.now()) : null;
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private polls = 0;
  // Answers for an earlier link or range are ignored if they arrive late.
  private sequence = 0;

  constructor() {
    this.loadLinks().catch(() => null);

    effect(() => {
      const id = this.selectedId();
      const days = this.days();

      if (id) this.restart(id, days);
    });

    const onVisibility = () => {
      if (this.document.visibilityState === 'visible' && this.data() && !this.paused()) this.schedule(0);
    };

    this.document.addEventListener('visibilitychange', onVisibility);

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  protected choose(changes: { link?: string; range?: number }): void {
    this.router.navigate([], { queryParams: changes, queryParamsHandling: 'merge', replaceUrl: true }).catch(() => false);
  }

  protected refresh(): void {
    const id = this.selectedId();

    if (id) this.restart(id, this.days());
  }

  private async loadLinks(): Promise<void> {
    try {
      const { items } = await this.links.list(null, SELECTOR_LIMIT);
      const wanted = this.link();

      // A link from ?link= that is beyond the first page still belongs in the selector.
      if (wanted && !items.some((item) => item.id === wanted)) {
        items.push(await this.links.get(wanted));
      }

      this.ownLinks.set(items);
    } catch (error) {
      this.linksError.set(commonMessage(toApiError(error)));
      this.ownLinks.set(this.ownLinks() ?? []);
    }
  }

  private restart(id: string, days: RangeDays): void {
    clearTimeout(this.timer);
    this.polls = 0;
    this.paused.set(false);
    this.data.set(null);
    this.loadError.set(null);
    this.refreshFailed.set(false);
    this.fetch(id, days).catch(() => null);
  }

  private schedule(delay = POLL_MS): void {
    clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      const id = this.selectedId();

      if (!id || this.document.visibilityState !== 'visible') return;

      if (this.polls >= MAX_POLLS) {
        this.paused.set(true);
        return;
      }

      this.polls += 1;
      this.fetch(id, this.days()).catch(() => null);
    }, delay);
  }

  private async fetch(id: string, days: RangeDays): Promise<void> {
    const sequence = ++this.sequence;

    try {
      const data = await this.analytics.forLink(id, rangeFor(days));

      if (sequence !== this.sequence) return;

      this.data.set(data);
      this.refreshFailed.set(false);
      this.now.set(Date.now());
      this.schedule();
    } catch (error) {
      if (sequence !== this.sequence) return;

      // Keep showing the last good numbers if a refresh fails; say so, and stop polling.
      if (this.data()) this.refreshFailed.set(true);
      else this.loadError.set(errorMessage(toApiError(error)));
    }
  }
}

function errorMessage(error: ApiError): string {
  if (error.code === 'NOT_FOUND') return "This link doesn't exist or isn't yours.";
  if (error.status === 0 || error.status >= 500) return 'Analytics are unavailable right now. Your links still work; please try again shortly.';

  return commonMessage(error);
}

// The top of the chart's scale: 1, 2 or 5 × a power of ten, at least the busiest day.
function niceMax(max: bigint): bigint {
  if (max <= 1n) return 1n;

  let step = 1n;

  while (step * 10n < max) step *= 10n;

  for (const factor of [1n, 2n, 5n, 10n]) {
    if (step * factor >= max) return step * factor;
  }

  return step * 10n;
}
