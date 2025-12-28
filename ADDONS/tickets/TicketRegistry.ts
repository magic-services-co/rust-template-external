import Conf from "conf";

export interface StoredTicket {
    channelId: string;
    guildId: string;
    ownerId: string;
    categorySlug: string;
    ticketId: string | null;
    createdAt: number;
    closedAt?: number;
}

interface TicketStoreSchema {
    tickets: StoredTicket[];
}

const store = new Conf<TicketStoreSchema>({
    projectName: "Linking-bot-ticket-addon",
    defaults: {
        tickets: [],
    },
});

let tickets = store.get("tickets") ?? [];
const openTickets = new Map<string, StoredTicket>();

for (const ticket of tickets) {
    if (!ticket.closedAt) {
        openTickets.set(ticket.channelId, ticket);
    }
}

function persist(): void {
    store.set("tickets", tickets);
}

export class TicketRegistry {
    static getByChannel(channelId: string): StoredTicket | null {
        return openTickets.get(channelId) ?? null;
    }

    static add(ticket: StoredTicket): void {
        tickets.push(ticket);
        openTickets.set(ticket.channelId, ticket);
        persist();
    }

    static close(channelId: string): StoredTicket | null {
        const idx = tickets.findIndex((t) => t.channelId === channelId && !t.closedAt);
        if (idx === -1) {
            openTickets.delete(channelId);
            return null;
        }

        const updated = { ...tickets[idx], closedAt: Date.now() };
        tickets[idx] = updated;
        openTickets.delete(channelId);
        persist();
        return updated;
    }

    static remove(channelId: string): void {
        tickets = tickets.filter((t) => t.channelId !== channelId);
        openTickets.delete(channelId);
        persist();
    }

    static getOpenTicketsForUser(userId: string, categorySlug?: string): StoredTicket[] {
        return [...openTickets.values()].filter((ticket) => {
            if (ticket.ownerId !== userId) {
                return false;
            }
            if (categorySlug) {
                return ticket.categorySlug === categorySlug;
            }
            return true;
        });
    }

    static getRecentTicketsForUser(userId: string, categorySlug: string, cooldownMinutes: number): StoredTicket[] {
        const cutoff = Date.now() - cooldownMinutes * 60_000;
        return tickets.filter((ticket) => {
            if (ticket.ownerId !== userId || ticket.categorySlug !== categorySlug) {
                return false;
            }
            return ticket.createdAt >= cutoff;
        });
    }
}

