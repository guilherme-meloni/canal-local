// tailwind.config.ts (VERSÃO ATUALIZADA)
import type { Config } from 'tailwindcss';

const config: Config = {
	content: ['./src/**/*.{html,js,svelte,ts}'],

	theme: {
		extend: {
			// NOVA PALETA DE CORES
			colors: {
				background: '#121218', // Um preto mais suave
				surface: '#181820', // Cor dos cards e modais
				primary: '#8B5CF6', // Roxo/Índigo como cor de destaque
				'primary-hover': '#7C3AED',
				subtle: '#A1A1AA', // Texto secundário, ícones
				'on-subtle': '#3F3F46' // Borda sutil
			},
			// NOVAS FONTES
			fontFamily: {
				sans: ['Poppins', 'sans-serif'], // Fonte principal para o corpo do texto
				display: ['Lexend', 'sans-serif'] // Fonte de destaque para títulos
			}
		}
	},

	plugins: []
};

export default config;
