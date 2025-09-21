// src/lib/config.ts
// Este ficheiro lê as variáveis de ambiente da Vercel (ou usa valores padrão)
// e as disponibiliza para a sua aplicação de forma segura.

import { PUBLIC_SERVER_URL, PUBLIC_CONTROL_TOKEN } from '$env/static/public';

export const config = {
	// A URL HTTP do seu servidor (ex: https://meu-tunel.ngrok-free.app)
	SERVER_URL: PUBLIC_SERVER_URL || 'http://127.0.0.1:3000',

	// A URL WebSocket, que é derivada da URL HTTP
	WS_URL: PUBLIC_SERVER_URL
		? PUBLIC_SERVER_URL.replace(/^http/, 'ws')
		: 'ws://127.0.0.1:3000',

	// O token secreto para autenticação
	CONTROL_TOKEN: PUBLIC_CONTROL_TOKEN || null
};

