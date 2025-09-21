// src/lib/stores/theme.ts
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'default' | 'nostalgia' | 'matrix';

const initialTheme: Theme = browser 
    ? (localStorage.getItem('theme') as Theme) || 'default' 
    : 'default';

export const theme = writable<Theme>(initialTheme);

if (browser) {
    theme.subscribe((value) => {
        localStorage.setItem('theme', value);
    });
}
