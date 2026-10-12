import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Gallery } from './Gallery';
import { isMock } from './api';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMock && new URLSearchParams(location.search).has('gallery') ? <Gallery /> : <App />}
  </StrictMode>,
);
