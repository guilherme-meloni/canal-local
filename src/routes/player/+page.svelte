<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import type { PlaylistItem, GradeUpdatePayload } from '$lib/types';
	import { config } from '$lib/config';

	// Estado Geral
	let videoPlayer: HTMLVideoElement;
	let userHasInteracted = false;
	let isLoading = true;

	// Estado do Modo VOD (Video on Demand)
	let isVodMode = false;
	let vodInfo = { src: '', title: 'Episódio' };

	// Estado do Modo TV Ao Vivo
	let currentItem: PlaylistItem | null = null;
	let playlist: PlaylistItem[] = [];
	let currentItemIndex = -1;
	let itemStartTime = 0;
	let socket: WebSocket;
	let reconnectAttempts = 0;
	const maxReconnectAttempts = 12;
	let connectionStatus = 'Conectando ao servidor...';
	let currentTime = new Date();
	let currentChannel = 'main';
	let availableChannels: GradeUpdatePayload['availableChannels'] = [];
	let isChannelSelectorOpen = false;
	let selectedItemForModal: PlaylistItem | null = null;
	let heartbeatIntervalId: NodeJS.Timeout;
	let clockIntervalId: NodeJS.Timeout;
	let upNextCheckInterval: NodeJS.Timeout;
	let showUpNextReminder = false;
	let upNextItem: PlaylistItem | null = null;

	onMount(() => {
		if (!browser) return;

		const playFromUrl = $page.url.searchParams.get('play');
		const titleFromUrl = $page.url.searchParams.get('title');
		const channelFromUrl = $page.url.searchParams.get('channel');

		if (playFromUrl) {
			// --- MODO VOD ---
			isVodMode = true;
			isLoading = false;
			vodInfo = {
				src: `${config.SERVER_URL}/midia/${playFromUrl}`,
				title: titleFromUrl || 'Episódio'
			};
		} else {
			// --- MODO TV AO VIVO ---
			isVodMode = false;
			connectToEmissora(channelFromUrl);
		}

		if (!isVodMode) {
			clockIntervalId = setInterval(() => (currentTime = new Date()), 30000);
			setupUpNextCheck();
		}

		return () => {
			if (socket) socket.close();
			if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
			if (clockIntervalId) clearInterval(clockIntervalId);
			if (upNextCheckInterval) clearInterval(upNextCheckInterval);
		};
	});

	function connectToEmissora(channelFromUrl: string | null) {
		if (socket && socket.readyState === WebSocket.OPEN) return;
		isLoading = true;
		connectionStatus = `Conectando...`;

		const wsUrl = new URL(config.WS_URL);
		if (config.CONTROL_TOKEN) {
			wsUrl.searchParams.set('token', config.CONTROL_TOKEN);
		}

		socket = new WebSocket(wsUrl.toString());
		socket.onopen = () => {
			reconnectAttempts = 0;
			isLoading = false;
			connectionStatus = 'Conectado';
			if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
			heartbeatIntervalId = setInterval(() => {
				if (socket && socket.readyState === WebSocket.OPEN) {
					socket.send(JSON.stringify({ type: 'PING' }));
				}
			}, 20000);

			if (channelFromUrl) {
				switchChannel(channelFromUrl);
				// Limpa o parâmetro da URL para não trocar de canal ao recarregar a página
				const url = new URL(window.location.href);
				url.searchParams.delete('channel');
				history.replaceState({}, '', url);
			}
		};
		socket.onmessage = (event) => {
			const message = JSON.parse(event.data);
			if (message.type === 'GRADE_UPDATE') {
				handleGradeUpdate(message.payload);
			} else if (message.type === 'ERROR' && message.message === 'Token inválido') {
				connectionStatus = 'Erro de Autenticação. Token inválido.';
				socket.close();
			}
		};
		socket.onclose = () => {
			isLoading = true;
			if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
			if (reconnectAttempts < maxReconnectAttempts) {
				reconnectAttempts++;
				const delay = 5000 + reconnectAttempts * 1000;
				connectionStatus = `Reconectando em ${delay / 1000}s...`;
				setTimeout(() => connectToEmissora(null), delay);
			} else {
				connectionStatus = 'Falha ao conectar. Verifique o servidor.';
			}
		};
		socket.onerror = () => {
			connectionStatus = 'Erro de conexão.';
		};
	}

	function handleGradeUpdate(payload: GradeUpdatePayload) {
		const itemChanged = payload.currentItemIndex !== currentItemIndex;
		playlist = payload.grade || [];
		currentItemIndex = payload.currentItemIndex;
		itemStartTime = payload.itemStartTime;
		currentChannel = payload.channelMode || 'main';
		availableChannels = payload.availableChannels || [];
		if (userHasInteracted && currentItemIndex >= 0) {
			applyUpdateToPlayer(itemChanged);
		}
	}

	function applyUpdateToPlayer(itemChanged = false) {
		if (isVodMode || !videoPlayer || currentItemIndex < 0 || !playlist[currentItemIndex]) return;
		const newItem = playlist[currentItemIndex];
		const srcChanged = currentItem?.src !== newItem.src;
		currentItem = newItem;
		if (srcChanged || itemChanged) videoPlayer.src = currentItem.src;
		const serverElapsed = (Date.now() - itemStartTime) / 1000;
		let targetTime = Math.max(0, serverElapsed - 8); // Ajuste de buffer
		if (currentItem.start) targetTime += currentItem.start;
		const seek = () => {
			if (Math.abs(videoPlayer.currentTime - targetTime) > 1.5) {
				videoPlayer.currentTime = targetTime;
			}
			videoPlayer.play().catch(() => {});
		};
		if (videoPlayer.readyState >= 2) seek();
		else videoPlayer.onloadeddata = seek;
	}

	function handleFirstInteraction() {
		if (userHasInteracted) return;
		userHasInteracted = true;
		if (videoPlayer) {
			videoPlayer.muted = false;
			if (isVodMode) {
				videoPlayer.play().catch(() => {});
			} else {
				applyUpdateToPlayer(true);
			}
		}
	}

	function sendCommand(command: string, data = {}) {
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'COMMAND', command, ...data, token: config.CONTROL_TOKEN }));
		}
	}

	function switchChannel(channelCode: string) {
		sendCommand('SWITCH_CHANNEL', { channel: channelCode });
		isChannelSelectorOpen = false;
	}

	function setupUpNextCheck() {
		if (upNextCheckInterval) clearInterval(upNextCheckInterval);
		upNextCheckInterval = setInterval(() => {
			if (isVodMode || !currentItem || !itemStartTime || currentItem.tipo !== 'desenho') {
				if (showUpNextReminder) showUpNextReminder = false;
				return;
			}
			const elapsedSeconds = (Date.now() - itemStartTime) / 1000;
			const totalDuration = currentItem.duration;
			const timeLeft = totalDuration - elapsedSeconds;

			if (timeLeft <= 60 && timeLeft > 5) {
				if (!showUpNextReminder) {
					const nextCartoon = playlist
						.slice(currentItemIndex + 1)
						.find((item) => item.tipo === 'desenho');
					if (nextCartoon) {
						upNextItem = nextCartoon;
						showUpNextReminder = true;
					}
				}
			} else {
				if (showUpNextReminder) showUpNextReminder = false;
			}
		}, 1000);
	}

	const formatTime = (date: Date) =>
		date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

	const formatDuration = (seconds: number) => {
		if (!seconds || seconds < 60) return `${Math.round(seconds || 0)}s`;
		return `${Math.round(seconds / 60)}min`;
	};

	$: proximosDesenhos = playlist
		.slice(currentItemIndex + 1)
		.filter((item) => item && item.tipo === 'desenho')
		.slice(0, 5);
</script>

<main class="h-screen w-screen overflow-hidden font-sans text-white/90">
	{#if !isVodMode && isLoading}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-background">
			<div class="text-center">
				<div class="text-6xl animate-pulse">📼</div>
				<h1 class="font-display mt-4 text-4xl font-extrabold">Canal Nostalgia</h1>
				<p class="mt-2 text-lg text-subtle">{connectionStatus}</p>
			</div>
		</div>
	{:else if !userHasInteracted}
		<div
			class="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-background"
			on:click={handleFirstInteraction}
			role="button"
			tabindex="0"
		>
			<div class="text-center">
				<div class="text-6xl">📼</div>
				<h1 class="font-display mt-4 text-4xl font-extrabold">Canal Nostalgia</h1>
				<p class="mt-2 text-lg text-subtle">
					{#if isVodMode}
						{vodInfo.title}
					{:else}
						Sua central de desenhos 24h.
					{/if}
				</p>
				<button
					class="mt-8 inline-flex items-center gap-3 rounded-full bg-primary px-8 py-4 font-display text-lg font-bold text-white transition-all hover:scale-105 hover:bg-primary-hover active:scale-100"
				>
					<svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
					Assistir Agora
				</button>
				{#if !isVodMode}
					<div class="mt-8 flex items-center justify-center gap-2 text-subtle">
						<span class="h-2 w-2 rounded-full {isLoading ? 'animate-pulse bg-yellow-400' : 'bg-green-400'}" />
						{connectionStatus}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="grid h-full grid-cols-1 {isVodMode ? '' : 'md:grid-cols-[1fr_384px]'}">
		<div class="group relative flex flex-col items-center justify-center bg-black">
			{#if isVodMode && userHasInteracted}
				<div class="absolute left-0 top-0 z-20 w-full bg-gradient-to-b from-black/70 to-transparent p-4 text-left opacity-0 transition-opacity group-hover:opacity-100">
					<a href="/catalogo" class="inline-flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm text-white backdrop-blur-md hover:bg-white/20">
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
						Voltar ao Catálogo
					</a>
				</div>
			{/if}
			<video
				bind:this={videoPlayer}
				class="h-full w-full object-contain"
				src={isVodMode ? vodInfo.src : ''}
				autoplay
				muted
				playsinline
				controls
			/>

			<!-- Overlay para Modo TV -->
			{#if !isVodMode}
				{#if showUpNextReminder && upNextItem}
					<div
						transition:fly={{ y: 20, duration: 500 }}
						class="pointer-events-none absolute bottom-24 left-4 z-20 rounded-lg bg-black/70 px-4 py-2 text-sm backdrop-blur-md"
					>
						<p class="font-display text-xs font-bold uppercase text-primary">A Seguir</p>
						<p class="font-bold">{upNextItem.nome}</p>
					</div>
				{/if}

				{#if userHasInteracted}
					<div
						class="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full bg-black/50 p-2 backdrop-blur-md opacity-0 transition-opacity group-hover:opacity-100"
					>
						<a href="/catalogo" title="Catálogo de Desenhos" class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10">
							<svg class="h-6 w-6 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Z" /><path d="M6 18h2"/><path d="M6 14h4" /><path d="M6 10h4" /><path d="M6 6h2" /></svg>
						</a>
						<a href="/guia" title="Guia de Programação" class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10">
							<svg class="h-6 w-6 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 12h18" /><path d="M12 3v18"/></svg>
						</a>
						<button on:click={() => sendCommand('REGENERATE_TODAY')} title="Recriar Grade" class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"><svg class="h-6 w-6 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" /></svg></button>
						<button on:click={() => sendCommand('NEXT')} title="Pular" class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"><svg class="h-6 w-6 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg></button>
						<button on:click={() => (isChannelSelectorOpen = true)} title="Trocar Canal" class="flex h-11 w-11 items-center justify-center rounded-full bg-primary transition-opacity hover:opacity-90"><svg class="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5.22c-1.25 0-2.5 1.06-4 1.06-1.5 0-2.75-1.06-4-1.06-3 0-6 8-6 12.22A4.91 4.91 0 0 0 7 19.78c1.25 0 2.5-1.06 4-1.06z" /><path d="M12 2v2.5" /></svg></button>
					</div>
				{/if}
			{/if}
		</div>

		{#if !isVodMode}
			<aside class="hidden flex-col gap-6 overflow-y-auto bg-surface p-6 md:flex">
				{#if currentItem}
					<button on:click={() => (selectedItemForModal = currentItem)} class="group/card block rounded-xl bg-surface p-4 text-left transition-colors hover:bg-on-subtle/30">
						<div class="flex gap-4">
							<img src={currentItem.meta?.poster} alt="Pôster" class="h-32 w-20 flex-shrink-0 rounded-md bg-background object-cover" />
							<div class="min-w-0">
								<span class="font-display text-xs font-bold uppercase text-primary">NO AR</span>
								<h2 class="font-display truncate text-xl font-bold">{currentItem.nome}</h2>
								<p class="truncate text-sm text-subtle">{currentItem.meta?.tituloEpisodio || ' '}</p>
								<div class="mt-2 flex gap-2 text-xs text-subtle">
									<span>{currentItem.tipo?.toUpperCase()}</span><span>•</span><span>{formatDuration(currentItem.duration)}</span>
								</div>
							</div>
						</div>
					</button>
				{/if}
				<div>
					<h3 class="font-display mb-4 border-b border-on-subtle pb-2 text-sm font-bold uppercase tracking-wider text-subtle">A Seguir</h3>
					<div class="flex flex-col gap-2">
						{#each proximosDesenhos as item}
							<button on:click={() => (selectedItemForModal = item)} class="group/card flex items-center gap-4 rounded-lg p-2 text-left transition-colors hover:bg-on-subtle/30">
								<img src={item.meta?.poster} alt="Pôster" class="h-16 w-28 flex-shrink-0 rounded-md bg-background object-cover" />
								<div>
									<p class="font-semibold">{item.nome}</p>
									<span class="text-xs text-primary">{formatDuration(item.duration)}</span>
								</div>
							</button>
						{:else}
							<p class="text-sm text-subtle">Carregando programação...</p>
						{/each}
					</div>
				</div>
			</aside>
		{/if}
	</div>

	{#if userHasInteracted && !isVodMode}
		<div class="fixed bottom-0 left-0 z-30 grid w-full grid-cols-[repeat(6,1fr)_auto] items-center border-t border-on-subtle bg-surface/[.95] p-1 backdrop-blur-sm md:hidden">
			<a href="/guia" class="flex flex-col items-center rounded-lg px-2 py-1 text-subtle transition-colors hover:bg-white/10">
				<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 12h18" /><path d="M12 3v18" /></svg>
				<span class="text-xs">Guia</span>
			</a>
			<a href="/catalogo" class="flex flex-col items-center rounded-lg px-2 py-1 text-subtle transition-colors hover:bg-white/10">
				<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Z" /><path d="M6 18h2" /><path d="M6 14h4" /><path d="M6 10h4" /><path d="M6 6h2" /></svg>
				<span class="text-xs">Catálogo</span>
			</a>
			<button on:click={() => (isChannelSelectorOpen = true)} class="flex flex-col items-center rounded-lg px-2 py-1 text-primary transition-colors hover:bg-white/10">
				<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5.22c-1.25 0-2.5 1.06-4 1.06-1.5 0-2.75-1.06-4-1.06-3 0-6 8-6 12.22A4.91 4.91 0 0 0 7 19.78c1.25 0 2.5-1.06 4-1.06z" /><path d="M12 2v2.5" /></svg>
				<span class="text-xs">Canais</span>
			</button>
			<button on:click={() => sendCommand('NEXT')} class="flex flex-col items-center rounded-lg px-2 py-1 text-subtle transition-colors hover:bg-white/10">
				<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>
				<span class="text-xs">Pular</span>
			</button>
			<button on:click={() => sendCommand('REGENERATE_TODAY')} class="flex flex-col items-center rounded-lg px-2 py-1 text-subtle transition-colors hover:bg-white/10">
				<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" /></svg>
				<span class="text-xs">Recriar</span>
			</button>
			<div class="flex flex-col items-center px-2 py-1">
				<span class="text-sm font-bold">{formatTime(currentTime)}</span>
			</div>
		</div>
	{/if}

	{#if !isVodMode && selectedItemForModal}
		<div
			transition:fade={{ duration: 200 }}
			class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
			on:click={() => (selectedItemForModal = null)} role="dialog"
		>
			<div
				transition:fly={{ y: 20, duration: 300 }}
				class="flex w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-2xl border border-on-subtle bg-surface md:flex-row"
				on:click|stopPropagation
			>
				<img src={selectedItemForModal.meta?.poster} alt="Poster" class="h-64 w-full object-cover md:h-auto md:w-56" />
				<div class="flex flex-col p-6">
					<h2 class="font-display text-2xl font-bold">{selectedItemForModal.nome}</h2>
					{#if selectedItemForModal.meta?.tituloEpisodio}
						<p class="font-semibold text-primary">{selectedItemForModal.meta.tituloEpisodio}</p>
					{/if}
					<p class="mt-4 flex-grow text-subtle">{selectedItemForModal.meta?.descricao || 'Nenhuma descrição disponível.'}</p>
					<div class="mt-4 text-xs text-subtle">
						<span>{selectedItemForModal.meta?.ano || '----'}</span>
						<span class="mx-2">•</span>
						<span>{selectedItemForModal.meta?.genero || 'Desconhecido'}</span>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if !isVodMode && isChannelSelectorOpen}
		<div transition:fade={{ duration: 200 }} on:click={() => isChannelSelectorOpen = false} class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" role="dialog">
			<div transition:fly={{ y: 20, duration: 300 }} on:click|stopPropagation class="w-full max-w-md rounded-t-2xl border-t border-on-subtle bg-surface sm:rounded-2xl sm:border">
				<div class="flex items-center justify-between border-b border-on-subtle p-4">
					<h2 class="font-display text-lg font-bold">Mudar de Canal</h2>
					<button on:click={() => isChannelSelectorOpen = false} class="text-2xl text-subtle">&times;</button>
				</div>
				<div class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4">
					<button on:click={() => switchChannel('main')} class="flex w-full items-center gap-4 rounded-lg p-3 text-left transition-colors {currentChannel === 'main' ? 'bg-primary/20 text-primary' : 'hover:bg-white/10'}">
						<span class="text-2xl">📺</span>
						<div><p class="font-bold">Canal Principal</p><p class="text-sm text-subtle">Programação variada</p></div>
					</button>
					{#each availableChannels as channel (channel.code)}
						<button on:click={() => switchChannel(channel.code)} class="flex w-full items-center gap-4 rounded-lg p-3 text-left transition-colors {currentChannel === channel.code ? 'bg-primary/20 text-primary' : 'hover:bg-white/10'}">
							<span class="text-2xl">🎬</span>
							<div><p class="font-bold">{channel.nome}</p><p class="text-sm text-subtle">{channel.totalEpisodios} episódios</p></div>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</main>

