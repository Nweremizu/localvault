import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { App } from './App';
import './index.css';

// Follow the Windows light/dark setting. Transitions are suppressed for one frame so the swap snaps instead of smearing.
const scheme = matchMedia('(prefers-color-scheme: dark)');
const applyScheme = (animate: boolean) => {
  const style = animate ? null : document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '*,*::before,*::after{transition:none!important}' }));
  document.documentElement.classList.toggle('dark', scheme.matches);
  document.documentElement.style.colorScheme = scheme.matches ? 'dark' : 'light';
  if (style) { void document.body?.offsetHeight; requestAnimationFrame(() => style.remove()); }
};
applyScheme(true);
scheme.addEventListener('change', () => applyScheme(false));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={400}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
