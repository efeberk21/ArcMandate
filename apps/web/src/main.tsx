import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme-night.css';
import { installSpotlight } from './lib/spotlight';

installSpotlight();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
