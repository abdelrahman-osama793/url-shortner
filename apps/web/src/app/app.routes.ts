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
import { ComingSoon } from './pages/coming-soon';
import { Home } from './pages/home';
import { LinksPage } from './pages/links/links';
import { NotFound } from './pages/not-found';

// Screens marked ComingSoon are labelled previews; the task that builds each one is in its data.
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
      { path: 'report', component: ComingSoon, title: 'Report a link · Shortlist', data: { title: 'Report a link', description: 'Help us identify phishing, malware or other harmful content.', task: 'T29' } },
    ],
  },
  {
    path: 'app',
    component: WorkspaceLayout,
    canActivate: [requireUser],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'links' },
      { path: 'links', component: LinksPage, title: 'Your links · Shortlist' },
      { path: 'analytics', component: ComingSoon, title: 'Analytics · Shortlist', data: { title: 'Link analytics', description: 'Daily clicks, countries, devices and referring sites.', task: 'T27' } },
      { path: 'account', component: ComingSoon, title: 'Account · Shortlist', data: { title: 'Your account', description: 'Your profile and sign-in methods.', task: 'T28' } },
    ],
  },
  {
    path: '**',
    component: PublicLayout,
    children: [{ path: '', component: NotFound, title: 'Page not found · Shortlist' }],
  },
];
