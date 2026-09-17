import { Suspense, lazy } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { PublicDocs, PublicLanding } from './PublicSite';

const ProductApp = lazy(() => import('./App').then((module) => ({ default: module.MainApp })));

function RoutedRoot() {
  const { pathname } = useLocation();
  if (pathname === '/') return <PublicLanding />;
  if (pathname === '/docs') return <PublicDocs />;
  return <Suspense fallback={<main className="app-loading">Loading verification workspace…</main>}><ProductApp /></Suspense>;
}

export default function Root() {
  return <BrowserRouter><RoutedRoot /></BrowserRouter>;
}
