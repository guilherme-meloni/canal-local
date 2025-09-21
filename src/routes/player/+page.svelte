<script lang="ts">
	// Imports do Svelte e SvelteKit
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { fade, fly } from 'svelte/transition';

	// Imports dos nossos stores globais
	import { serverIp } from '$lib/stores/settings';
	import { userHasInteracted } from '$lib/stores/playerState'; // Store para o estado de interação
	import type { PlaylistItem, GradeUpdatePayload } from '$lib/types';

	// --- ESTADO DO COMPONENTE ---

	// NOVO: Controle para evitar 'flicker' na renderização. A página só será exibida quando isReady = true.
	let isReady = false;

	// Variáveis do Player
	let videoPlayer: HTMLVideoElement;
	let currentItem: PlaylistItem | null = null;
	let playlist: PlaylistItem[] = [];
	let currentItemIndex = -1;
	let itemStartTime = 0;

	// Variáveis de Conexão e UI
	let socket: WebSocket;
	let isLoading = true;
	let connectionStatus = 'Aguardando interação...';
	let isChannelSelectorOpen = false;
	let selectedItemForModal: PlaylistItem | null = null;
	let currentTime = new Date();
	let currentChannel = 'main';
	let availableChannels: GradeUpdatePayload['availableChannels'] = [];

	// --- CICLO DE VIDA ---
	onMount(() => {
		// Toda a lógica abaixo só roda no navegador, nunca no servidor.
		if (!browser) return;

		// Ao montar o componente no navegador, marcamos como pronto para renderizar.
		isReady = true;

		// Se o usuário já interagiu antes, tentamos conectar imediatamente.
		if ($userHasInteracted) {
			connectToEmissora();
		}

		const clockIntervalId = setInterval(() => {
			currentTime = new Date();
		}, 30000);

		// Função de limpeza
		return () => {
			if (socket) socket.close();
			clearInterval(clockIntervalId);
		};
	});

	// --- LÓGICA PRINCIPAL ---

	function connectToEmissora() {
		// Garante que o IP está definido antes de conectar
		const currentIp = $serverIp;
		if (!currentIp) {
			goto('/');
			return;
		}

		if (socket && socket.readyState === WebSocket.OPEN) return;

		const WS_URL = `ws://${currentIp}:3000`;
		isLoading = true;
		connectionStatus = `Conectando a ${currentIp}...`;
		socket = new WebSocket(WS_URL);

		socket.onopen = () => {
			isLoading = false;
			connectionStatus = 'Conectado';
		};

		socket.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				if (message.type === 'GRADE_UPDATE') {
					handleGradeUpdate(message.payload);
				}
			} catch (e) { /* Ignora mensagens malformadas */ }
		};

		socket.onclose = () => {
			isLoading = true;
			connectionStatus = 'Desconectado. Tentando reconectar...';
			setTimeout(connectToEmissora, 5000); // Tenta reconectar após 5s
		};

		socket.onerror = (error) => {
			console.error('[WS] Erro de WebSocket:', error);
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
		if ($userHasInteracted && currentItemIndex >= 0) {
			applyUpdateToPlayer(itemChanged);
		}
	}

	function applyUpdateToPlayer(itemChanged = false) {
		if (!videoPlayer || currentItemIndex < 0 || !playlist[currentItemIndex]) return;
		const newItem = playlist[currentItemIndex];
		const srcChanged = currentItem?.src !== newItem.src;
		currentItem = newItem;
		if (srcChanged || itemChanged) videoPlayer.src = currentItem.src;
		const serverElapsed = (Date.now() - itemStartTime) / 1000;
		let targetTime = Math.max(0, serverElapsed - 8); // Latency Buffer
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
		if ($userHasInteracted) return;
		$userHasInteracted = true; // Define o estado global de interação
		if (videoPlayer) videoPlayer.muted = false;
		connectToEmissora(); // Inicia a conexão na primeira interação
		applyUpdateToPlayer(true);
	}

	function sendCommand(command: string, data = {}) {
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'COMMAND', command, ...data }));
		}
	}

	function switchChannel(channelCode: string) {
		sendCommand('SWITCH_CHANNEL', { channel: channelCode });
		isChannelSelectorOpen = false;
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

{#if isReady}
	<main class="h-screen w-screen overflow-hidden font-sans text-white/90">
		{#if !$userHasInteracted}
			<div
				class="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-background"
				on:click={handleFirstInteraction}
				role="button"
				tabindex="0"
			>
				<div class="text-center">
					<div class="text-6xl">📼</div>
					<h1 class="font-display mt-4 text-4xl font-extrabold">Canal Nostalgia</h1>
					<p class="mt-2 text-lg text-subtle">Sua central de desenhos 24h.</p>
					<button
						class="mt-8 inline-flex items-center gap-3 rounded-full bg-primary px-8 py-4 font-display text-lg font-bold text-white transition-all hover:scale-105 hover:bg-primary-hover active:scale-100"
					>
						<svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
						Assistir Agora
					</button>
					<div class="mt-8 flex items-center justify-center gap-2 text-subtle">
						<span
							class="h-2 w-2 rounded-full {isLoading && $userHasInteracted
								? 'animate-pulse bg-yellow-400'
								: 'bg-gray-500'}"
						/>
						{connectionStatus}
					</div>
				</div>
			</div>
		{/if}

		{#if $userHasInteracted}
			<div class="grid h-full grid-cols-1 md:grid-cols-[1fr_384px]">
				<div class="group relative flex items-center justify-center bg-black">
					<video
						bind:this={videoPlayer}
						class="h-full w-full object-contain"
						autoplay
						muted
						playsinline
						controls
					/>
					<div
						class="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full bg-black/50 p-2 backdrop-blur-md opacity-0 transition-opacity group-hover:opacity-100"
					>
						<button on:click={() => sendCommand('REGENERATE_TODAY')} title="Recriar Grade" class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"><svg class="h-6 w-6 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" /></svg></button>
						<button on:click={() => sendCommand('NEXT')} title="Pular" class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"><svg class="h-6 w-6 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg></button>
						<button on:click={() => (isChannelSelectorOpen = true)} title="Trocar Canal" class="flex h-11 w-11 items-center justify-center rounded-full bg-primary transition-opacity hover:opacity-90"><svg class="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5.22c-1.25 0-2.5 1.06-4 1.06-1.5 0-2.75-1.06-4-1.06-3 0-6 8-6 12.22A4.91 4.91 0 0 0 7 19.78c1.25 0 2.5-1.06 4-1.06z" /><path d="M12 2v2.5" /></svg></button>
						<a href="/settings" title="Configurações" class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"><svg class="h-6 w-6 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></a>
					</div>
				</div>

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
							{:else} <p class="text-sm text-subtle">Carregando programação...</p>
							{/each}
						</div>
					</div>
				</aside>
			</div>
			<div class="fixed bottom-0 left-0 z-30 grid w-full grid-cols-5 items-center border-t border-on-subtle bg-surface/[.95] p-1 backdrop-blur-sm md:hidden">
				<button on:click={() => (isChannelSelectorOpen = true)} class="flex flex-col items-center rounded-lg px-2 py-1 text-primary transition-colors hover:bg-white/10"><svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5.22c-1.25 0-2.5 1.06-4 1.06-1.5 0-2.75-1.06-4-1.06-3 0-6 8-6 12.22A4.91 4.91 0 0 0 7 19.78c1.25 0 2.5-1.06 4-1.06z" /><path d="M12 2v2.5" /></svg><span class="text-xs">Canais</span></button>
				<button on:click={() => sendCommand('NEXT')} class="flex flex-col items-center rounded-lg px-2 py-1 text-subtle transition-colors hover:bg-white/10"><svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg><span class="text-xs">Pular</span></button>
				<button on:click={() => sendCommand('REGENERATE_TODAY')} class="flex flex-col items-center rounded-lg px-2 py-1 text-subtle transition-colors hover:bg-white/10"><svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" /></svg><span class="text-xs">Recriar</span></button>
				<a href="/settings" class="flex flex-col items-center rounded-lg px-2 py-1 text-subtle transition-colors hover:bg-white/10"><svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg><span class="text-xs">Ajustes</span></a>
				<div class="flex flex-col items-center px-2 py-1"><span class="text-sm font-bold">{formatTime(currentTime)}</span></div>
			</div>
		{/if}

		{#if selectedItemForModal}
			<div transition:fade={{ duration: 200 }} class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm" on:click={() => (selectedItemForModal = null)} role="dialog">
				<div transition:fly={{ y: 20, duration: 300 }} class="flex w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-2xl border border-on-subtle bg-surface md:flex-row" on:click|stopPropagation>
					<img src={selectedItemForModal.meta?.poster} alt="Poster" class="h-64 w-full object-cover md:h-auto md:w-56" />
					<div class="flex flex-col p-6">
						<h2 class="font-display text-2xl font-bold">{selectedItemForModal.nome}</h2>
						{#if selectedItemForModal.meta?.tituloEpisodio}<p class="font-semibold text-primary">{selectedItemForModal.meta.tituloEpisodio}</p>{/if}
						<p class="mt-4 flex-grow text-subtle">{selectedItemForModal.meta?.descricao || 'Nenhuma descrição disponível.'}</p>
						<div class="mt-4 text-xs text-subtle">
							<span>{selectedItemForModal.meta?.ano || '----'}</span><span class="mx-2">•</span><span>{selectedItemForModal.meta?.genero || 'Desconhecido'}</span>
						</div>
					</div>
				</div>
			</div>
		{/if}
		{#if isChannelSelectorOpen}
			<div transition:fade={{ duration: 200 }} on:click={() => (isChannelSelectorOpen = false)} class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" role="dialog">
				<div transition:fly={{ y: 20, duration: 300 }} on:click|stopPropagation class="w-full max-w-md rounded-t-2xl border-t border-on-subtle bg-surface sm:rounded-2xl sm:border">
					<div class="flex items-center justify-between border-b border-on-subtle p-4">
						<h2 class="font-display text-lg font-bold">Mudar de Canal</h2>
						<button on:click={() => (isChannelSelectorOpen = false)} class="text-2xl text-subtle">&times;</button>
					</div>
					<div class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4">
						<button on:click={() => switchChannel('main')} class="flex w-full items-center gap-4 rounded-lg p-3 text-left transition-colors {currentChannel === 'main' ? 'bg-primary/20 text-primary' : 'hover:bg-white/10'}"><span class="text-2xl">📺</span><div><p class="font-bold">Canal Principal</p><p class="text-sm text-subtle">Programação variada</p></div></button>
						{#each availableChannels as channel (channel.code)}
							<button on:click={() => switchChannel(channel.code)} class="flex w-full items-center gap-4 rounded-lg p-3 text-left transition-colors {currentChannel === channel.code ? 'bg-primary/20 text-primary' : 'hover:bg-white/10'}"><span class="text-2xl">🎬</span><div><p class="font-bold">{channel.nome}</p><p class="text-sm text-subtle">{channel.totalEpisodios} episódios</p></div></button>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</main>
{/if}
