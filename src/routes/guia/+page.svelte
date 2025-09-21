<script lang="ts">
	import { onMount } from 'svelte';
	import { serverIp } from '$lib/stores/settings';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { PlaylistItem } from '$lib/types';
	import { fade } from 'svelte/transition';

	let playlist: PlaylistItem[] = [];
	let currentItemIndex = -1;
	let itemStartTime = 0;
	let isLoading = true;
	let connectionStatus = 'Buscando sinal da emissora...';

	type ScheduledItem = PlaylistItem & { horarioInicio: Date };

	onMount(() => {
		if (!browser) return;
		const unsubscribe = serverIp.subscribe((ip) => {
			if (!ip) {
				goto('/');
			} else {
				fetchGrade(ip);
			}
		});
		return () => {
			unsubscribe();
		};
	});

	async function fetchGrade(ip: string) {
		isLoading = true;
		connectionStatus = `Conectando a http://${ip}:3000...`;
		try {
			const response = await fetch(`http://${ip}:3000/control/grade`);
			if (!response.ok) {
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
		} catch (error) {
			console.error('Falha ao buscar a grade:', error);
			connectionStatus = 'Falha ao obter a programação. Tente recarregar a página.';
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

		const processed = new Array<ScheduledItem>(playlist.length);
		let lastEndTime = itemStartTime;

		for (let i = currentItemIndex; i < playlist.length; i++) {
			const item = playlist[i];
			const durationMs = item.duration * 1000;
			processed[i] = { ...item, horarioInicio: new Date(lastEndTime) };
			lastEndTime += durationMs;
		}

		let nextStartTime = itemStartTime;
		for (let i = currentItemIndex - 1; i >= 0; i--) {
			const item = playlist[i];
			const durationMs = item.duration * 1000;
			const startTime = nextStartTime - durationMs;
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
			<div class="flex flex-col items-center justify-center rounded-lg bg-surface p-12 text-center">
				<div class="text-4xl">📡</div>
				<p class="mt-4 font-semibold">Buscando sinal...</p>
				<p class="text-sm text-subtle">{connectionStatus}</p>
			</div>
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
			<div class="flex flex-col items-center justify-center rounded-lg bg-surface p-12 text-center">
				<div class="text-4xl">😵</div>
				<p class="mt-4 font-semibold">Não foi possível carregar a grade</p>
				<p class="text-sm text-subtle">{connectionStatus}</p>
			</div>
		{/if}
	</div>
</main>

