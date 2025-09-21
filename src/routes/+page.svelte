<script lang="ts">
	import { serverIp } from '$lib/stores/settings';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let currentIp = '';
	let errorMessage = '';

	// Quando o componente é montado, inscrevemos para receber o valor do store.
	const unsubscribe = serverIp.subscribe((value) => {
		currentIp = value;
	});

	onMount(() => {
		// Se já existir um IP salvo, tentamos redirecionar o usuário para a tela do player.
		if (currentIp) {
			goto('/player');
		}
		// É importante desinscrever do store quando o componente for destruído para evitar memory leaks.
		return unsubscribe;
	});

	function connect() {
		// Validação simples do IP
		if (!currentIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(currentIp)) {
			errorMessage = 'Por favor, insira um endereço de IP válido.';
			return;
		}

		// Se o IP for válido, atualizamos nosso store.
		// A sincronização com o localStorage é automática graças ao código em settings.ts
		serverIp.set(currentIp);

		// Redirecionamos o usuário para a página do player.
		goto('/player');
	}
</script>

<main class="flex h-full w-full flex-col items-center justify-center bg-background p-4">
	<div class="w-full max-w-sm text-center">
		<div class="mb-6 text-6xl">📼</div>
		<h1 class="font-display mb-2 text-3xl font-bold text-white">Canal Nostalgia</h1>
		<p class="mb-8 text-subtle">Sua central de desenhos 24h.</p>

		<form on:submit|preventDefault={connect} class="flex flex-col gap-4">
			<div>
				<label for="ip-address" class="sr-only">Endereço IP do Servidor</label>
				<input
					id="ip-address"
					bind:value={currentIp}
					type="text"
					placeholder="Ex: 192.168.0.1"
					class="w-full rounded-lg border-2 border-surface bg-surface px-4 py-3 text-center text-lg text-white/90 transition-colors duration-200 focus:border-primary focus:outline-none focus:ring-0"
				/>
			</div>

			{#if errorMessage}
				<p class="text-sm text-red-400">{errorMessage}</p>
			{/if}

			<button
				type="submit"
				class="rounded-lg bg-primary px-4 py-3 font-display text-lg font-bold text-white transition-transform duration-200 hover:scale-105 hover:bg-primary-hover active:scale-100"
			>
				Conectar
			</button>
		</form>
	</div>
</main>
