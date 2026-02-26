import { mount } from 'svelte';
import App from './App.svelte';
import '../renderer/style.css';
import { initializeAppMeta } from './services/appMetaService';
import { initializeDialogApi } from './services/dialogService';

mount(App, {
  target: document.getElementById('app'),
});

initializeDialogApi();
initializeAppMeta();
