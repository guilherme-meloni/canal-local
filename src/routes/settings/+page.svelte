<script lang="ts">
	import { serverIp } from '$lib/stores/settings';
	import { goto } from '$app/navigation';
	import { fade } from 'svelte/transition';
    import { onMount } from 'svelte';

	// Variáveis para guardar as estatísticas do servidor
	let cpuLoad = 0;
	let memUsed = 0;
	let memTotal = 1; // Evitar divisão por zero
	let cpuTemp: number | null = null;
    
    // Recriamos uma conexão WebSocket SÓ para esta página
    let socket: WebSocket;

    onMount(() => {
        const unsubscribe = serverIp.subscribe(ip => {
            if (ip) {
                const WS_URL = `ws://${ip}:3000`;
                socket = new WebSocket(WS_URL);

                socket.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    if (message.type === 'STATS_UPDATE') {
                        const { payload } = message;
                        cpuLoad = parseFloat(payload.cpuLoad);
                        memUsed = parseInt(payload.memUsed, 10);
                        memTotal = parseInt(payload.memTotal, 10);
                        cpuTemp = payload.cpuTemp;
                    }
                };
            }
        });

        return () => {
            if (socket) socket.close();
            unsubscribe();
        }
    });

	function disconnect() {
		serverIp.set('');
		goto('/');
	}
</script>

<main in:fade class="flex min-h-screen w-full flex-col items-center bg-background p-4 py-10">
	<div class="w-full max-w-2xl">
		<a href="/player" class="mb-8 inline-flex items-center gap-2 text-subtle transition-colors hover:text-white">
			<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
			Voltar ao Player
		</a>
		<h1 class="font-display text-4xl font-bold">Configurações</h1>

        <div class="mt-8 rounded-xl border border-on-subtle bg-surface p-6">
			<h2 class="font-display text-xl font-semibold">Status do Servidor</h2>
            <div class="mt-4 space-y-4">
                <div>
                    <div class="flex justify-between text-sm">
                        <span class="font-semibold">CPU</span>
                        <span class="text-subtle">{cpuLoad}%</span>
                    </div>
                    <div class="mt-1 h-2 w-full rounded-full bg-background">
                        <div class="h-2 rounded-full bg-primary" style="width: {cpuLoad}%" />
                    </div>
                </div>
                <div>
                    <div class="flex justify-between text-sm">
                        <span class="font-semibold">Memória</span>
                        <span class="text-subtle">{memUsed} MB / {memTotal} MB</span>
                    </div>
                    <div class="mt-1 h-2 w-full rounded-full bg-background">
                        <div class="h-2 rounded-full bg-primary" style="width: {(memUsed / memTotal) * 100}%" />
                    </div>
                </div>
                {#if cpuTemp !== null}
                    <div>
                        <div class="flex justify-between text-sm">
                            <span class="font-semibold">Temperatura</span>
                            <span class="text-subtle">{cpuTemp}°C</span>
                        </div>
                        </div>
                {/if}
            </div>
        </div>

		<div class="mt-6 rounded-xl border border-on-subtle bg-surface p-6">
			<h2 class="font-display text-xl font-semibold">Conexão</h2>
			<div class="mt-4 flex items-center justify-between rounded-lg bg-background p-4">
				<div>
					<span class="text-xs text-subtle">Conectado a</span>
					<p class="font-mono text-white">{$serverIp}</p>
				</div>
				<button on:click={disconnect} class="rounded-lg bg-red-600/80 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500">
					Desconectar
				</button>
			</div>
		</div>

        </div>
</main>
