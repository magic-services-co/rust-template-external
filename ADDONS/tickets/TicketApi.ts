import config from "../../config.json";

export interface SupportField {
    id: number | string;
    label: string;
    key: string;
    type: string;
    required: boolean;
    order: number;
    stepId: number | string;
    options?: Record<string, unknown> | null;
}

export interface SupportStep {
    id: number | string;
    name: string;
    order: number;
    categoryId: string;
    fields: SupportField[];
}

export interface SupportCategory {
    slug: string;
    name: string;
    description: string | null;
    icon: string | null;
    order: number | null;
    maxTicketsPerUser?: number | null;
    ticketCooldownMinutes?: number | null;
    maxTicketsPerCooldown?: number | null;
    steps: SupportStep[];
}

export interface CreateTicketRequest {
    categorySlug: string;
    discordUserId: string;
    guildId: string;
    channelId: string;
    answers?: Record<string, string>;
}

export interface CreateTicketResponse {
    id?: string | number;
    ticketId?: string | number;
    slug?: string;
}

export interface TicketMessagePayload {
    content: string;
    discordUserId: string;
    attachments?: string[];
    metadata?: Record<string, unknown>;
}

export interface CloseTicketResult {
    success: boolean;
}

const SUPPORT_ENDPOINT = cleanJoin(config.API_ENDPOINT, "/support");
const TICKET_MESSAGES_BASE = cleanJoin(config.API_ENDPOINT, "/bot/tickets");
const ADMIN_TICKET_STATUS_ENDPOINT = cleanJoin(config.API_ENDPOINT, "/admin/tickets");

function cleanJoin(base: string, path: string): string {
    return `${base.replace(/\/$/, "")}${path}`;
}

function jsonHeaders(includeContentType = true): Headers {
    const headers = new Headers();
    headers.set("x-api-key", config.API_KEY);
    if (includeContentType) {
        headers.set("Content-Type", "application/json");
    }
    return headers;
}

export class TicketApi {
    private static categoryCache: {
        fetchedAt: number;
        categories: SupportCategory[];
    } | null = null;

    static async fetchCategories(force = false): Promise<SupportCategory[]> {
        if (!force && this.categoryCache && Date.now() - this.categoryCache.fetchedAt < 60_000) {
            return this.categoryCache.categories;
        }

        try {
            const res = await fetch(SUPPORT_ENDPOINT, {
                method: "GET",
                headers: jsonHeaders(false),
            });

            if (!res.ok) {
                console.error(
                    `[${new Date().toISOString()}] Failed to fetch support categories: ${res.status} ${res.statusText}`,
                );
                return [];
            }

            const categories = (await res.json()) as SupportCategory[];
            if (!Array.isArray(categories)) {
                console.error(`[${new Date().toISOString()}] Invalid categories payload from /support`, categories);
                return [];
            }

            this.categoryCache = {
                fetchedAt: Date.now(),
                categories,
            };

            return categories;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error fetching support categories`, error);
            return [];
        }
    }

    static async createTicket(request: CreateTicketRequest): Promise<string | null> {
        try {
            const payload = {
                categoryId: request.categorySlug,
                discordUserId: request.discordUserId,
                content: {
                    summary: "Submitted via Discord bot",
                    guildId: request.guildId,
                    channelId: request.channelId,
                    ...(request.answers ?? {}),
                },
            };

            const res = await fetch(SUPPORT_ENDPOINT, {
                method: "POST",
                headers: jsonHeaders(true),
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                console.error(
                    `[${new Date().toISOString()}] Failed to create ticket for ${request.discordUserId}: ${res.status} ${res.statusText}`,
                );
                return null;
            }

            const responseBody = (await res.json().catch(() => null)) as CreateTicketResponse | null;
            const ticketId = responseBody?.ticketId ?? responseBody?.id;
            return ticketId ? String(ticketId) : null;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error creating ticket for ${request.discordUserId}`, error);
            return null;
        }
    }

    static async postMessage(ticketId: string, payload: TicketMessagePayload): Promise<void> {
        if (!ticketId) {
            return;
        }

        try {
            const body = {
                ...payload,
                metadata: {
                    ...(payload.metadata ?? {}),
                    discordUserId: payload.discordUserId,
                },
            };

            const endpoint = cleanJoin(TICKET_MESSAGES_BASE, `/${encodeURIComponent(ticketId)}/messages`);
            const res = await fetch(endpoint, {
                method: "POST",
                headers: jsonHeaders(true),
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                console.error(
                    `[${new Date().toISOString()}] Failed to post ticket message for ${ticketId}: ${res.status} ${res.statusText}`,
                );
            }
        } catch (error) {
            console.error(
                `[${new Date().toISOString()}] Error posting ticket message for ${ticketId}`,
                error,
            );
        }
    }

    static async closeTicket(ticketId: string | null | undefined): Promise<CloseTicketResult> {
        if (!ticketId) {
            return { success: false };
        }

        try {
            const endpoint = cleanJoin(
                ADMIN_TICKET_STATUS_ENDPOINT,
                `/${encodeURIComponent(ticketId)}/status`,
            );

            const res = await fetch(endpoint, {
                method: "PATCH",
                headers: jsonHeaders(true),
                body: JSON.stringify({ status: "closed" }),
            });

            if (!res.ok) {
                console.error(
                    `[${new Date().toISOString()}] Failed to close ticket ${ticketId} on website: ${res.status} ${res.statusText}`,
                );
                return { success: false };
            }

            return { success: true };
        } catch (error) {
            console.error(
                `[${new Date().toISOString()}] Error closing ticket ${ticketId} on website`,
                error,
            );
            return { success: false };
        }
    }
}

