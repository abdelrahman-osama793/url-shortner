import { Routes } from '@angular/router';

import { requireUser } from './core/auth/guards';
import { PublicLayout } from './layouts/public-layout';
import { Home } from './pages/home';
import { NotFound } from './pages/not-found';

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
        loadComponent: () => import('./layouts/auth-layout').then((m) => m.AuthLayout),
        children: [
          { path: 'login', loadComponent: () => import('./pages/auth/login').then((m) => m.Login), title: 'Log in · Shortlist' },
          { path: 'signup', loadComponent: () => import('./pages/auth/signup').then((m) => m.Signup), title: 'Sign up · Shortlist' },
          {
            path: 'signup/check-email',
            loadComponent: () => import('./pages/auth/check-email').then((m) => m.CheckEmail),
            title: 'Verify your email · Shortlist',
          },
          {
            path: 'verify-email',
            loadComponent: () => import('./pages/auth/verify-email').then((m) => m.VerifyEmail),
            title: 'Confirm your email · Shortlist',
          },
          {
            path: 'forgot-password',
            loadComponent: () => import('./pages/auth/forgot-password').then((m) => m.ForgotPassword),
            title: 'Forgot password · Shortlist',
          },
          {
            path: 'reset-password',
            loadComponent: () => import('./pages/auth/reset-password').then((m) => m.ResetPassword),
            title: 'Choose a new password · Shortlist',
          },
        ],
      },
      { path: 'report', loadComponent: () => import('./pages/report/report').then((m) => m.ReportPage), title: 'Report a link · Shortlist' },
    ],
  },
  {
    path: 'app',
    loadComponent: () => import('./layouts/workspace-layout').then((m) => m.WorkspaceLayout),
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
    ],
  },
  {
    path: '**',
    component: PublicLayout,
    children: [{ path: '', component: NotFound, title: 'Page not found · Shortlist' }],
  },
];
