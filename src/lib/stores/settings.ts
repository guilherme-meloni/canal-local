// src/lib/stores/settings.ts
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// --- Estado do Servidor ---

// O valor inicial é obtido do localStorage se estivermos no navegador,
// caso contrário, é uma string vazia.
const initialServerIp = browser ? window.localStorage.getItem('serverIp') ?? '' : '';

// Criamos um "writable store" que irá guardar o IP do servidor.
export const serverIp = writable<string>(initialServerIp);

// --- Sincronização com o localStorage ---

// Esta parte "escuta" as mudanças no nosso store.
// Sempre que o valor de `serverIp` for alterado no app,
// a função abaixo será executada.
if (browser) {
	serverIp.subscribe((value) => {
		// Salvamos o novo valor no localStorage do navegador.
		window.localStorage.setItem('serverIp', value);
	});
}
