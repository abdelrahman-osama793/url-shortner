import { Routes } from '@angular/router';

import { requireAdmin, requireUser } from './core/auth/guards';
import { PublicLayout } from './layouts/public-layout/public-layout';
import { Home } from './pages/home/home';
import { NotFound } from './pages/not-found/not-found';

// Most visitors are guests who only shorten a link, so the first download holds just the public
// layout and the home page. Sign-in, reporting and the workspace load when first visited.
export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      { path: '', component: Home, title: 'Shortlist — short links you control' },
      {
        path: '',
        loadComponent: () => import('./layouts/auth-layout/auth-layout').then((m) => m.AuthLayout),
        children: [
          { path: 'login', loadComponent: () => import('./pages/auth/login/login').then((m) => m.Login), title: 'Log in · Shortlist' },
          { path: 'signup', loadComponent: () => import('./pages/auth/signup/signup').then((m) => m.Signup), title: 'Sign up · Shortlist' },
          {
            path: 'signup/check-email',
            loadComponent: () => import('./pages/auth/check-email/check-email').then((m) => m.CheckEmail),
            title: 'Verify your email · Shortlist',
          },
          {
            path: 'verify-email',
            loadComponent: () => import('./pages/auth/verify-email/verify-email').then((m) => m.VerifyEmail),
            title: 'Confirm your email · Shortlist',
          },
          {
            path: 'forgot-password',
            loadComponent: () => import('./pages/auth/forgot-password/forgot-password').then((m) => m.ForgotPassword),
            title: 'Forgot password · Shortlist',
          },
          {
            path: 'reset-password',
            loadComponent: () => import('./pages/auth/reset-password/reset-password').then((m) => m.ResetPassword),
            title: 'Choose a new password · Shortlist',
          },
        ],
      },
      { path: 'report', loadComponent: () => import('./pages/report/report').then((m) => m.ReportPage), title: 'Report a link · Shortlist' },
      { path: 'privacy', loadComponent: () => import('./pages/legal/privacy/privacy').then((m) => m.PrivacyPolicy), title: 'Privacy Policy · Shortlist' },
      { path: 'cookies', loadComponent: () => import('./pages/legal/cookies/cookies').then((m) => m.CookiePolicy), title: 'Cookie Policy · Shortlist' },
      { path: 'terms', loadComponent: () => import('./pages/legal/terms/terms').then((m) => m.TermsOfService), title: 'Terms of Service · Shortlist' },
      {
        path: 'acceptable-use',
        loadComponent: () => import('./pages/legal/acceptable-use/acceptable-use').then((m) => m.AcceptableUsePolicy),
        title: 'Acceptable Use Policy · Shortlist',
      },
    ],
  },
  {
    path: 'app',
    loadComponent: () => import('./layouts/workspace-layout/workspace-layout').then((m) => m.WorkspaceLayout),
    canActivate: [requireUser],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'links' },
      { path: 'links', loadComponent: () => import('./pages/links/links').then((m) => m.LinksPage), title: 'Your links · Shortlist' },
      {
        path: 'analytics',
        loadComponent: () => import('./pages/analytics/analytics').then((m) => m.AnalyticsPage),
        title: 'Analytics · Shortlist',
      },
      { path: 'account', loadComponent: () => import('./pages/account/account').then((m) => m.AccountPage), title: 'Account · Shortlist' },
      {
        path: 'admin',
        canActivate: [requireAdmin],
        loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminPage),
        title: 'Moderation · Shortlist',
      },
    ],
  },
  {
    path: '**',
    component: PublicLayout,
    children: [{ path: '', component: NotFound, title: 'Page not found · Shortlist' }],
  },
];
