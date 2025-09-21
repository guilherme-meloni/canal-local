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
		let targetTime = Math.max(0, serverElapsed - 8);
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

	$: proximosDesenhos = playlist
		.slice(currentItemIndex + 1)
		.filter((item) => item && item.tipo === 'desenho')
		.slice(0, 5);
</script>

<main class="h-screen w-screen overflow-hidden font-sans text-white/90">
	{#if isLoading}
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
						<span class="h-2 w-2 rounded-full bg-green-400" />
						{connectionStatus}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="grid h-full grid-cols-1 {isVodMode ? '' : 'md:grid-cols-[1fr_384px]'}">
		<div class="group relative flex flex-col items-center justify-center bg-black">
			{#if isVodMode && userHasInteracted}
				<div class="w-full bg-black p-4 text-center">
					<a href="/catalogo" class="text-sm text-primary hover:underline">← Voltar ao Catálogo</a>
					<h2 class="font-display text-xl font-bold">{vodInfo.title}</h2>
				</div>
			{/if}
			<video
				bind:this={videoPlayer}
				class="h-full w-full object-contain {isVodMode ? 'flex-grow' : ''}"
				src={isVodMode ? vodInfo.src : ''}
				autoplay
				muted
				playsinline
				controls
			/>

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
						<a
							href="/catalogo"
							title="Catálogo de Desenhos"
							class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"
						>
							<svg
								class="h-6 w-6 text-subtle"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Z" /><path
									d="M6 18h2"
								/><path d="M6 14h4" /><path d="M6 10h4" /><path d="M6 6h2" /></svg
							>
						</a>
						<a
							href="/guia"
							title="Guia de Programação"
							class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"
						>
							<svg
								class="h-6 w-6 text-subtle"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 12h18" /><path
									d="M12 3v18"
								/></svg
							>
						</a>
						</div>
				{/if}
			{/if}
		</div>

		{#if !isVodMode}
			<aside class="hidden flex-col gap-6 overflow-y-auto bg-surface p-6 md:flex">
				</aside>
		{/if}
	</div>

	{#if userHasInteracted && !isVodMode}
		<div
			class="fixed bottom-0 left-0 z-30 grid w-full grid-cols-[repeat(6,1fr)_auto] items-center border-t border-on-subtle bg-surface/[.95] p-1 backdrop-blur-sm md:hidden"
		>
			</div>
	{/if}

	{#if !isVodMode && selectedItemForModal}
		{/if}
	{#if !isVodMode && isChannelSelectorOpen}
		{/if}
</main>
```eof

---

### `src/routes/guia/+page.svelte`

A página do guia foi atualizada para fazer a chamada de API de forma segura.

```svelte:Guide Page (Secure):src/routes/guia/+page.svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { PlaylistItem } from '$lib/types';
	import { fade } from 'svelte/transition';
	import { config } from '$lib/config';

	let playlist: PlaylistItem[] = [];
	let currentItemIndex = -1;
	let itemStartTime = 0;
	let isLoading = true;
	let connectionStatus = 'Buscando sinal da emissora...';

	type ScheduledItem = PlaylistItem & { horarioInicio: Date };

	onMount(() => {
		if (!browser) return;
		fetchGrade();
	});

	async function fetchGrade() {
		isLoading = true;
		connectionStatus = `Conectando...`;
		try {
			const response = await fetch(`${config.SERVER_URL}/control/grade`, {
				headers: {
					Authorization: `Bearer ${config.CONTROL_TOKEN}`
				}
			});
			if (!response.ok) {
				if (response.status === 403) throw new Error('Token de acesso inválido ou ausente.');
				throw new Error(`Erro na rede: ${response.statusText}`);
			}
			const data = await response.json();

			if (data.ok && data.grade) {
				playlist = data.grade || [];
				currentItemIndex = data.currentItemIndex;
				itemStartTime = data.itemStartTime;
				connectionStatus = 'Programação recebida!';
			} else {
				throw new Error('A resposta do servidor não continha a grade esperada.');
			}
		} catch (error: any) {
			console.error('Falha ao buscar a grade:', error);
			connectionStatus = `Falha ao obter a programação. ${error.message}`;
		} finally {
			isLoading = false;
		}
	}

	const formatTime = (date: Date) =>
		date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

	$: programacaoComHorarios = (() => {
		if (!playlist.length || currentItemIndex < 0 || !itemStartTime) {
			return [];
		}
		// ... (lógica de cálculo de horários)
		const processed = new Array<ScheduledItem>(playlist.length);
		let lastEndTime = itemStartTime;
		for (let i = currentItemIndex; i < playlist.length; i++) {
			const item = playlist[i];
			processed[i] = { ...item, horarioInicio: new Date(lastEndTime) };
			lastEndTime += item.duration * 1000;
		}
		let nextStartTime = itemStartTime;
		for (let i = currentItemIndex - 1; i >= 0; i--) {
			const item = playlist[i];
			const startTime = nextStartTime - item.duration * 1000;
			processed[i] = { ...item, horarioInicio: new Date(startTime) };
			nextStartTime = startTime;
		}
		return processed.filter((p) => p && p.tipo === 'desenho');
	})();
</script>

<main class="min-h-screen bg-background p-4 font-sans text-white/90 md:p-8">
	<div class="mx-auto max-w-4xl">
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
				<h1 class="font-display text-3xl font-bold">Guia de Programação</h1>
				<p class="text-subtle">A grade de hoje para o Canal Principal</p>
			</div>
		</div>

		{#if isLoading}
			{:else if programacaoComHorarios.length > 0}
			<div class="overflow-hidden rounded-lg border border-white/10 bg-surface/50">
				<ul class="divide-y divide-white/10">
					{#each programacaoComHorarios as item, i (item.src + i)}
						{@const isNoAr = playlist[currentItemIndex]?.src === item.src}
						{@const isPassado = !isNoAr && new Date(item.horarioInicio).getTime() < Date.now()}
						<li
							in:fade={{ duration: 300, delay: i * 20 }}
							class="grid grid-cols-[50px_1fr] items-start gap-x-4 p-3 transition-all sm:grid-cols-[65px_1fr] sm:p-4
                            {isNoAr ? 'bg-primary/10 scale-[1.01]' : ''}
                            {isPassado ? 'opacity-60 hover:opacity-100' : ''}"
						>
							<time
								class="font-display text-sm font-bold text-right pt-1 {isNoAr
									? 'text-primary'
									: 'text-subtle'}"
							>
								{formatTime(item.horarioInicio)}
							</time>
							<div class="flex min-w-0 items-start gap-4">
								<img
									src={item.meta?.poster}
									alt="Pôster"
									class="h-20 w-14 flex-shrink-0 rounded-md bg-background object-cover sm:h-24 sm:w-16"
								/>
								<div class="min-w-0 flex-grow pt-1">
									<p class="truncate font-bold text-white sm:text-lg">{item.nome}</p>
									<p class="truncate text-sm text-subtle">{item.meta?.tituloEpisodio || ' '}</p>
								</div>
								{#if isNoAr}
									<div class="flex-shrink-0 pt-1.5">
										<span
											class="ml-auto hidden rounded-full bg-primary px-3 py-1 font-display text-xs font-bold uppercase text-white sm:block"
										>
											No Ar
										</span>
									</div>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			{/if}
	</div>
</main>
```eof

---

### `src/routes/catalogo/+page.svelte`

A página principal do catálogo, que agora leva para a página de detalhes de cada desenho.

```svelte:Catalog Page (Secure):src/routes/catalogo/+page.svelte
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { PlaylistItem, GradeUpdatePayload } from '$lib/types';
	import { fade } from 'svelte/transition';
	import { config } from '$lib/config';

	let isLoading = true;
	let connectionStatus = 'Buscando catálogo...';
	let socket: WebSocket;
	let catalogo = new Map<string, { meta?: PlaylistItem['meta']; code: string; nome: string }>();

	onMount(() => {
		if (!browser) return;
		connectAndFetchCatalog();
		return () => {
			if (socket && socket.readyState === WebSocket.OPEN) {
				socket.close();
			}
		};
	});

	function connectAndFetchCatalog() {
		const wsUrl = new URL(config.WS_URL);
		if (config.CONTROL_TOKEN) {
			wsUrl.searchParams.set('token', config.CONTROL_TOKEN);
		}
		socket = new WebSocket(wsUrl.toString());

		socket.onmessage = (event) => {
			const message = JSON.parse(event.data);

			if (message.type === 'GRADE_UPDATE') {
				const payload: GradeUpdatePayload = message.payload;
				const codeMap = new Map(payload.availableChannels.map(c => [c.nome, c.code]));
				
				for (const item of payload.grade) {
					if (item.tipo === 'desenho' && !catalogo.has(item.nome) && codeMap.has(item.nome)) {
						catalogo.set(item.nome, {
							meta: item.meta,
							code: codeMap.get(item.nome)!,
							nome: item.nome
						});
					}
				}
				catalogo = catalogo; // Força re-renderização
				isLoading = false;
				socket.close();
			} else if (message.type === 'ERROR' && message.message === 'Token inválido') {
				connectionStatus = 'Erro de Autenticação. Token inválido.';
				isLoading = false;
				socket.close();
			}
		};

		socket.onerror = () => {
			isLoading = false;
			connectionStatus = 'Erro ao conectar para obter o catálogo.';
		};
	}

	$: catalogoArray = Array.from(catalogo.values());
</script>

<main class="min-h-screen bg-background p-4 font-sans text-white/90 md:p-8">
	<div class="mx-auto max-w-7xl">
		<div class="mb-6 flex items-center gap-4">
			<a href="/player" class="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10">
				<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
			</a>
			<div>
				<h1 class="font-display text-3xl font-bold">Catálogo de Desenhos</h1>
				<p class="text-subtle">Escolha um desenho para ver os detalhes</p>
			</div>
		</div>

		{#if isLoading}
			{:else if catalogoArray.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
				{#each catalogoArray as desenho, i (desenho.code)}
					<div in:fade={{ duration: 300, delay: i * 30 }}>
						<a href="/catalogo/{desenho.code}" class="group block space-y-2">
							<div class="overflow-hidden rounded-lg border-2 border-transparent bg-surface transition-all group-hover:scale-105 group-hover:border-primary">
								<img
									src={desenho.meta?.poster || 'https://placehold.co/400x600/1a1a1a/ffffff?text=?'}
									alt="Pôster de {desenho.nome}"
									class="aspect-[2/3] w-full object-cover"
									loading="lazy"
								/>
							</div>
							<p class="truncate text-center font-semibold transition-colors group-hover:text-primary">
								{desenho.nome}
							</p>
						</a>
					</div>
				{/each}
			</div>
		{:else}
			{/if}
	</div>
</main>
```eof

---

### `src/routes/catalogo/[code]/+page.svelte`

A nova página de detalhes do desenho, que busca e exibe as temporadas e episódios.

```svelte:Cartoon Details (Secure):src/routes/catalogo/[code]/+page.svelte
<script lang="ts">
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { config } from '$lib/config';

	interface Episode {
		season: string;
		titulo: string;
		sinopse: string;
		arquivoRelativo: string;
	}

	interface CartoonInfo {
		nomeReal?: string;
		descricao?: string;
		poster?: string;
		ano?: number;
		genero?: string;
	}

	let episodesBySeason = new Map<string, Episode[]>();
	let cartoonInfo: CartoonInfo | null = null;
	let isLoading = true;
	let status = 'Carregando informações do desenho...';
	const { code } = $page.params;

	onMount(() => {
		if (browser) {
			fetchEpisodeList();
		}
	});

	async function fetchEpisodeList() {
		try {
			const response = await fetch(`${config.SERVER_URL}/api/catalogo/${code}`, {
				headers: {
					Authorization: `Bearer ${config.CONTROL_TOKEN}`
				}
			});
			if (!response.ok) {
				if (response.status === 403) throw new Error('Token de acesso inválido ou ausente.');
				throw new Error(`Falha na comunicação com o servidor: ${response.statusText}`);
			}
			const data = await response.json();
			if (!data.ok) {
				throw new Error(data.message || 'O servidor retornou um erro.');
			}
			cartoonInfo = data.info;
			const seasons = new Map<string, Episode[]>();
			for (const ep of data.episodes as Episode[]) {
				const seasonNum = ep.season || 'Extras';
				if (!seasons.has(seasonNum)) {
					seasons.set(seasonNum, []);
				}
				seasons.get(seasonNum)?.push(ep);
			}
			episodesBySeason = seasons;
		} catch (e: any) {
			console.error('Erro ao buscar episódios:', e);
			status = `Falha ao carregar episódios. ${e.message}`;
		} finally {
			isLoading = false;
		}
	}

	$: randomEpisodeLink = (() => {
		if (episodesBySeason.size === 0) return '#';
		const allEpisodes = Array.from(episodesBySeason.values()).flat();
		if (allEpisodes.length === 0) return '#';
		const randomEp = allEpisodes[Math.floor(Math.random() * allEpisodes.length)];
		const title = `${cartoonInfo?.nomeReal || 'Episódio'} - ${randomEp.titulo}`;
		return `/player?play=${randomEp.arquivoRelativo}&title=${encodeURIComponent(title)}`;
	})();

	$: sortedSeasons = Array.from(episodesBySeason.keys()).sort((a, b) => {
		const numA = parseInt(a.replace(/[^0-9]/g, ''), 10);
		const numB = parseInt(b.replace(/[^0-9]/g, ''), 10);
		if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
		return a.localeCompare(b);
	});
</script>

<main class="min-h-screen bg-background p-4 font-sans text-white/90 md:p-8">
	<div class="mx-auto max-w-7xl">
		{#if isLoading}
			{:else if cartoonInfo}
			<div class="mb-8 grid grid-cols-1 items-start gap-6 md:grid-cols-[240px_1fr] md:gap-8">
				<img
					src={cartoonInfo.poster || 'https://placehold.co/400x600/1a1a1a/ffffff?text=?'}
					alt="Pôster de {cartoonInfo.nomeReal}"
					class="aspect-[2/3] w-full max-w-[240px] justify-self-center rounded-lg bg-surface object-cover"
				/>
				<div class="flex flex-col gap-4">
					<div>
						<a href="/catalogo" class="text-sm text-primary hover:underline">← Voltar ao Catálogo</a>
						<h1 class="font-display text-4xl font-extrabold md:text-5xl">
							{cartoonInfo.nomeReal || 'Desenho Desconhecido'}
						</h1>
						<div class="mt-1 flex items-center gap-2 text-sm text-subtle">
							{#if cartoonInfo.ano}<span>{cartoonInfo.ano}</span>{/if}
							{#if cartoonInfo.genero}<span>• {cartoonInfo.genero}</span>{/if}
						</div>
					</div>
					<p class="text-subtle">{cartoonInfo.descricao || 'Nenhuma descrição disponível.'}</p>
					<div class="flex flex-wrap gap-3">
						<a
							href="/player?channel={code}"
							class="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-display font-bold text-white transition-transform hover:scale-105"
						>
							<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"
								><path d="M8 5v14l11-7z" /></svg
							>
							Assistir Canal
						</a>
						<a
							href={randomEpisodeLink}
							class="inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 font-display font-bold text-white transition-colors hover:bg-white/20"
						>
							<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a2 2 0 0 1-2-2V3a2 2 0 0 1 4 0v4a2 2 0 0 1-2 2Z" /><path d="M12 12a2 2 0 0 0-2 2v3a2 2 0 0 0 4 0v-3a2 2 0 0 0-2-2Z" /><path d="M8 9H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z" /><path d="M20 9h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z" /></svg>
							Episódio Aleatório
						</a>
					</div>
				</div>
			</div>

			<div class="space-y-6">
				{#each sortedSeasons as seasonName (seasonName)}
					<div in:fade={{ duration: 400 }}>
						<h2 class="font-display mb-3 text-2xl font-bold">{seasonName.replace('_', ' ')}</h2>
						<div class="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-surface/50">
							{#each episodesBySeason.get(seasonName) || [] as ep, i (ep.arquivoRelativo)}
								{@const title = `${cartoonInfo?.nomeReal || 'Episódio'} - ${ep.titulo}`}
								<a
									href="/player?play={ep.arquivoRelativo}&title={encodeURIComponent(title)}"
									class="block p-4 transition-colors hover:bg-primary/10"
								>
									<p class="font-bold text-white">{i + 1}. {ep.titulo}</p>
									{#if ep.sinopse}
										<p class="mt-1 text-sm text-subtle">{ep.sinopse}</p>
									{/if}
								</a>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center rounded-lg bg-surface p-12 text-center">
				<div class="text-4xl">😵</div>
				<p class="mt-4 font-semibold">{status}</p>
				<a href="/catalogo" class="mt-6 rounded-full bg-primary px-6 py-3 font-bold">Voltar ao Catálogo</a>
			</div>
		{/if}
	</div>
</main>

