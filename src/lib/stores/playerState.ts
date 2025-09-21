// src/lib/stores/playerState.ts
import { writable } from 'svelte/store';

/**
 * Controla se o usuário já fez a primeira interação com o player.
 * Isso evita que a tela de "Assistir Agora" reapareça ao navegar
 * entre as páginas.
 */
export const userHasInteracted = writable<boolean>(false);
