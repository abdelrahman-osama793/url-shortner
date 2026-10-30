import { Routes } from '@angular/router';

import { requireUser } from './core/auth/guards';
import { AuthLayout } from './layouts/auth-layout';
import { PublicLayout } from './layouts/public-layout';
import { WorkspaceLayout } from './layouts/workspace-layout';
import { CheckEmail } from './pages/auth/check-email';
import { ForgotPassword } from './pages/auth/forgot-password';
import { Login } from './pages/auth/login';
import { ResetPassword } from './pages/auth/reset-password';
import { Signup } from './pages/auth/signup';
import { VerifyEmail } from './pages/auth/verify-email';
import { AccountPage } from './pages/account/account';
import { AnalyticsPage } from './pages/analytics/analytics';
import { Home } from './pages/home';
import { LinksPage } from './pages/links/links';
import { NotFound } from './pages/not-found';
import { ReportPage } from './pages/report/report';

export const routes: Routes = [
  {
    path: '',
    component: PublicLayout,
    children: [
      { path: '', component: Home, title: 'Shortlist — short links you control' },
      {
        path: '',
        component: AuthLayout,
        children: [
          { path: 'login', component: Login, title: 'Log in · Shortlist' },
          { path: 'signup', component: Signup, title: 'Sign up · Shortlist' },
          { path: 'signup/check-email', component: CheckEmail, title: 'Verify your email · Shortlist' },
          { path: 'verify-email', component: VerifyEmail, title: 'Confirm your email · Shortlist' },
          { path: 'forgot-password', component: ForgotPassword, title: 'Forgot password · Shortlist' },
          { path: 'reset-password', component: ResetPassword, title: 'Choose a new password · Shortlist' },
        ],
      },
      { path: 'report', component: ReportPage, title: 'Report a link · Shortlist' },
    ],
  },
  {
    path: 'app',
    component: WorkspaceLayout,
    canActivate: [requireUser],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'links' },
      { path: 'links', component: LinksPage, title: 'Your links · Shortlist' },
      { path: 'analytics', component: AnalyticsPage, title: 'Analytics · Shortlist' },
      { path: 'account', component: AccountPage, title: 'Account · Shortlist' },
    ],
  },
  {
    path: '**',
    component: PublicLayout,
    children: [{ path: '', component: NotFound, title: 'Page not found · Shortlist' }],
  },
];
