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

	// Tipo atualizado para incluir o índice original do item na playlist
	type ScheduledItem = PlaylistItem & { horarioInicio: Date; originalIndex: number };

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

	// Lógica de cálculo refatorada para ser mais robusta
	$: programacaoComHorarios = (() => {
		if (!playlist.length || currentItemIndex < 0 || !itemStartTime) {
			return [];
		}

		const processed = new Array<ScheduledItem>(playlist.length);
		
		// Calcula horários para a frente a partir do item atual
		let lastEndTime = itemStartTime;
		for (let i = currentItemIndex; i < playlist.length; i++) {
			const item = playlist[i];
			processed[i] = { ...item, horarioInicio: new Date(lastEndTime), originalIndex: i };
			lastEndTime += item.duration * 1000;
		}
		
		// Calcula horários para trás a partir do item atual
		let nextStartTime = itemStartTime;
		for (let i = currentItemIndex - 1; i >= 0; i--) {
			const item = playlist[i];
			const startTime = nextStartTime - item.duration * 1000;
			processed[i] = { ...item, horarioInicio: new Date(startTime), originalIndex: i };
			nextStartTime = startTime;
		}

		// Filtra para mostrar apenas desenhos
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
				<div class="text-4xl animate-pulse">📺</div>
				<p class="mt-4 font-semibold">{connectionStatus}</p>
			</div>
		{:else if programacaoComHorarios.length > 0}
			<div class="overflow-hidden rounded-lg border border-white/10 bg-surface/50">
				<ul class="divide-y divide-white/10">
					{#each programacaoComHorarios as item, i (item.src + i)}
						<!-- CORREÇÃO: A verificação de "No Ar" agora usa o índice original, que é 100% fiável -->
						{@const isNoAr = item.originalIndex === currentItemIndex}
						{@const now = new Date()}
						{@const startTime = new Date(item.horarioInicio)}
						{@const endTime = new Date(startTime.getTime() + item.duration * 1000)}
						{@const isPassado = !isNoAr && endTime < now}
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
									alt="Pôster de {item.nome}"
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
				<p class="mt-4 font-semibold">{connectionStatus}</p>
				<button on:click={fetchGrade} class="mt-6 rounded-full bg-primary px-6 py-3 font-bold">Tentar Novamente</button>
			</div>
		{/if}
	</div>
</main>

