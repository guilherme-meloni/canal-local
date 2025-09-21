// src/lib/types.ts

// Descreve os metadados de um item da playlist (ex: pôster, título do episódio)
export interface PlaylistItemMeta {
	poster?: string;
	nomeReal?: string;
	tituloEpisodio?: string;
	descricao?: string;
	ano?: number;
	genero?: string;
}

// Descreve um item individual na grade de programação
export interface PlaylistItem {
	src: string;
	nome: string;
	tipo: 'desenho' | 'bumper' | 'entrada' | 'saida';
	duration: number;
	start?: number;
	meta?: PlaylistItemMeta;
}

// Descreve a estrutura da mensagem que o servidor envia
export interface GradeUpdatePayload {
	grade: PlaylistItem[];
	currentItemIndex: number;
	itemStartTime: number;
	channelMode: string;
	availableChannels: { code: string; nome: string; totalEpisodios: number }[];
}
