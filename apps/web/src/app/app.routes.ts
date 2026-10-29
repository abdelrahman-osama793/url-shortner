import { Routes } from '@angular/router';

import { AuthLayout } from './layouts/auth-layout';
import { PublicLayout } from './layouts/public-layout';
import { WorkspaceLayout } from './layouts/workspace-layout';
import { ComingSoon } from './pages/coming-soon';
import { Home } from './pages/home';
import { LinksPreview } from './pages/links-preview';
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
          { path: 'login', component: ComingSoon, title: 'Log in · Shortlist', data: { title: 'Welcome back.', description: 'Log in to pick up where you left off.', task: 'T25' } },
          { path: 'signup', component: ComingSoon, title: 'Sign up · Shortlist', data: { title: 'Create your account', description: 'A little more control over everything you share.', task: 'T25' } },
        ],
      },
      { path: 'report', component: ComingSoon, title: 'Report a link · Shortlist', data: { title: 'Report a link', description: 'Help us identify phishing, malware or other harmful content.', task: 'T29' } },
    ],
  },
  {
    path: 'app',
    component: WorkspaceLayout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'links' },
      { path: 'links', component: LinksPreview, title: 'Your links · Shortlist' },
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
