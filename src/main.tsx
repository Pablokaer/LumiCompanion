import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import QuickCapture from './QuickCapture';
import { Gallery } from './Gallery';
import { isMock } from './api';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMock && new URLSearchParams(location.search).has('gallery') ? <Gallery /> : location.hash === '#quick' ? <QuickCapture /> : <App />}
  </StrictMode>,
);
