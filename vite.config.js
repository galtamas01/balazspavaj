import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // Ide fel kell sorolnunk az összes HTML fájlodat!
        main: resolve(__dirname, 'index.html'),
        produs: resolve(__dirname, 'produse/produs.html'),
        checkout: resolve(__dirname, 'checkout/checkout.html'),
        succes: resolve(__dirname, 'checkout/succes.html')
        // Ha van még más HTML fájlod (pl. kategóriák), azokat is add hozzá ugyanígy!
      }
    }
  }
});