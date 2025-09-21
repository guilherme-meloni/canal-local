<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { serverIp } from '$lib/stores/settings';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { PlaylistItem, GradeUpdatePayload } from '$lib/types';
	import { fade } from 'svelte/transition';

	let isLoading = true;
	let connectionStatus = 'Conectando à emissora para buscar o catálogo...';
	let socket: WebSocket;
	let catalogo = new Map<string, { meta?: PlaylistItem['meta']; code: string; nome: string }>();

	onMount(() => {
		if (!browser) return;
		const unsubscribe = serverIp.subscribe((ip) => {
			if (!ip) {
				goto('/');
			} else {
				connectAndFetchCatalog(ip);
			}
		});

		return () => {
			unsubscribe();
			if (socket && socket.readyState === WebSocket.OPEN) {
				socket.close();
			}
		};
	});

	function connectAndFetchCatalog(ip: string) {
		const WS_URL = `ws://${ip}:3000`;
		socket = new WebSocket(WS_URL);

		socket.onopen = () => {
			connectionStatus = 'Recebendo dados da programação...';
		};

		socket.onmessage = (event) => {
			const message = JSON.parse(event.data);

			if (message.type === 'GRADE_UPDATE') {
				const payload: GradeUpdatePayload = message.payload;

				const codeMap = new Map<string, string>();
				if (payload.availableChannels) {
					for (const channel of payload.availableChannels) {
						codeMap.set(channel.nome, channel.code);
					}
				}

				for (const item of payload.grade) {
					if (item.tipo === 'desenho' && !catalogo.has(item.nome) && codeMap.has(item.nome)) {
						catalogo.set(item.nome, {
							meta: item.meta,
							code: codeMap.get(item.nome)!,
							nome: item.nome
						});
					}
				}
				
				// Força a re-renderização do Svelte
				catalogo = catalogo;

				isLoading = false;
				socket.close(); // Já temos o que precisamos, podemos fechar a conexão.
			}
		};

		socket.onerror = () => {
			isLoading = false;
			connectionStatus = 'Erro ao conectar para obter o catálogo.';
		};

		socket.onclose = () => {
			if (isLoading) {
				isLoading = false;
				connectionStatus = 'Não foi possível obter o catálogo. A conexão foi fechada.';
			}
		};
	}

	// Transforma o Map em um Array para o #each
	$: catalogoArray = Array.from(catalogo.values());
</script>

<main class="min-h-screen bg-background p-4 font-sans text-white/90 md:p-8">
	<div class="mx-auto max-w-7xl">
		<div class="mb-6 flex items-center gap-4">
			<a
				href="/player"
				class="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10"
			>
				<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 19l-7-7 7-7"
					/></svg
				>
			</a>
			<div>
				<h1 class="font-display text-3xl font-bold">Catálogo de Desenhos</h1>
				<p class="text-subtle">Escolha um canal para assistir</p>
			</div>
		</div>

		{#if isLoading}
			<div class="flex flex-col items-center justify-center rounded-lg bg-surface p-12 text-center">
				<div class="text-4xl">📼</div>
				<p class="mt-4 font-semibold">Carregando catálogo...</p>
				<p class="text-sm text-subtle">{connectionStatus}</p>
			</div>
		{:else if catalogoArray.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
				{#each catalogoArray as desenho, i (desenho.code)}
					<div in:fade={{ duration: 300, delay: i * 30 }}>
						<a href="/player?channel={desenho.code}" class="group block space-y-2">
							<div
								class="overflow-hidden rounded-lg border-2 border-transparent bg-surface transition-all group-hover:scale-105 group-hover:border-primary"
							>
								<img
									src={desenho.meta?.poster || 'https://placehold.co/400x600/1a1a1a/ffffff?text=?'}
									alt="Pôster de {desenho.nome}"
									class="aspect-[2/3] w-full object-cover"
								/>
							</div>
							<p class="truncate text-center font-semibold transition-colors group-hover:text-primary">
								{desenho.nome}
							</p>
						</a>
					</div>
				{/each}
			</div>
			<div class="mt-8 text-center text-sm text-subtle">
				<p>
					<b>Nota:</b>
					Clicar em um desenho iniciará a transmissão daquele canal. A opção de escolher episódios
					específicos será adicionada em uma futura atualização.
				</p>
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center rounded-lg bg-surface p-12 text-center">
				<div class="text-4xl">😵</div>
				<p class="mt-4 font-semibold">Não foi possível carregar o catálogo</p>
				<p class="text-sm text-subtle">{connectionStatus}</p>
			</div>
		{/if}
	</div>
</main>
