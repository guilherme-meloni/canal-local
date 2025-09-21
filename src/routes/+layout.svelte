<script lang="ts">
	import '../app.css';
    import { theme } from '$lib/stores/theme';
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Lexend:wght@700;800&family=Poppins:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<svelte:document html:data-theme={$theme === 'default' ? null : $theme} />

<slot />
