/* eslint-disable @typescript-eslint/naming-convention */
import { WebhookClient, GatewayReceivePayload, GatewayDispatchEvents, GatewayOpcodes } from "discord.js";
import { channels, discordToken, serverId } from "../util/env.js";
import { Channel, Things } from "../typings/index.js";
import fetch, { HeadersInit } from "node-fetch";
import Websocket, { WebSocket, MessageEvent } from "ws";
import { RawAttachmentData, RawStickerData } from "discord.js/typings/rawDataTypes.js";

// Define proper types for attachment and sticker data
type ProperAttachmentData = {
  url: string;
  size: number;
};

type ProperStickerData = {
  id: string;
};

export const executeWebhook = (things: Things, webhookUrl: string): void => {
    const wsClient = new WebhookClient({ url: webhookUrl }); // Now dynamically using the passed URL
    wsClient.send(things).catch((e: unknown) => console.error(e));
};

export const createChannel = async (
    name: string,
    newId: string,
    pos: number,
    parentId?: string
): Promise<Channel> => {
    const effectiveHeaders: HeadersInit = {
        "Content-Type": "application/json"
    };

    if (discordToken) { // Only add Authorization header if discordToken is not undefined
        effectiveHeaders["Authorization"] = discordToken;
    }

    return fetch(`https://discord.com/api/v10/guilds/${newId}/channels`, {
        body: JSON.stringify({
            name,
            parent_id: parentId, // Fix for snake_case
            position: pos
        }),
        headers: effectiveHeaders,
        method: "POST"
    }).then(res => res.json()) as Promise<Channel>;
};

const parseEventData = (event: MessageEvent): string => {
    if (typeof event.data === "string") {
        return event.data;
    } else if (event.data instanceof ArrayBuffer) {
        // Handle ArrayBuffer if necessary
        return String.fromCharCode.apply(null, new Uint8Array(event.data));
    }
    // Handle other data types
    return JSON.stringify(event.data);
};

export const listenToWebSocket = (ws: WebSocket): void => {
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let lastHeartbeatAck: number | null = null;
    let authenticated = false;

    ws.onopen = () => {
        console.log("Connected to the Discord API.");
    };

    ws.onmessage = (event: MessageEvent) => {
        const dataString = parseEventData(event);
        const payload: GatewayReceivePayload = JSON.parse(dataString);
        const { op, d, s, t } = payload;

        switch (op) {
            case GatewayOpcodes.Hello:
                try {
                    // Start sending heartbeats
                    heartbeatInterval = setInterval(() => {
                        ws.send(JSON.stringify({ op: GatewayOpcodes.Heartbeat, d: s }));

                        // Check for unresponsive connection
                        const currentTime = Date.now();
                        if (lastHeartbeatAck && currentTime - lastHeartbeatAck > 15000) {
                            console.log("Connection to Discord gateway is unresponsive.");
                        }
                    }, d.heartbeat_interval);

                    // Authenticate with the Discord API
                    if (!authenticated) {
                        authenticated = true;
                        ws.send(JSON.stringify({
                            op: GatewayOpcodes.Identify,
                            d: {
                                token: discordToken,
                                properties: {
                                    $os: "linux",
                                    $browser: "test",
                                    $device: "test"
                                }
                            }
                        }));
                    }
                } catch (e) {
                    console.error("Error sending heartbeat or identifying:", e);
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                }
                break;
            case GatewayOpcodes.HeartbeatAck:
                // Update last heartbeat acknowledgement time
                lastHeartbeatAck = Date.now();
                break;
            case GatewayOpcodes.Dispatch:
                if (
                    (t === GatewayDispatchEvents.MessageCreate) &&
                    d.guild_id === serverId &&
                    d.channel_id in channels
                ) {
                    const {
                        content,
                        attachments,
                        embeds,
                        sticker_items,
                        author
                    } = d;
                    const webhookUrl: string = channels[d.channel_id];
                    let ext = "jpg";
                    let ub = " [USER]";
                    const { avatar, username, discriminator: discriminatorRaw, id } = author;
                    let discriminator: string | null = discriminatorRaw;
                    if (discriminator === "0") {
                        discriminator = null;
                    } else {
                        discriminator = `#${discriminator}`;
                    }

                    if (avatar?.startsWith("a_")) ext = "gif";
                    if (author.bot) ub = " [BOT]";

                    const things: Things = {
                        avatarURL: avatar
                            ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}`
                            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`,
                        content: content ? content : "** **\n",
                        url: webhookUrl,
                        username: `${username}${discriminator ?? ""}${ub}`
                    };

                    if (embeds[0]) {
                        things.embeds = embeds;
                    } else if (sticker_items) {
                        things.files = sticker_items.map(
                            (a: ProperStickerData) => `https://media.discordapp.net/stickers/${a.id}.webp`
                        );
                    } else if (attachments[0]) {
                        const fileSizeInBytes = Math.max(...attachments.map((a: ProperAttachmentData) => a.size));
                        const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
                        if (fileSizeInMegabytes < 8) {
                            things.files = attachments.map((a: ProperAttachmentData) => a.url);
                        } else {
                            things.content += attachments.map((a: ProperAttachmentData) => a.url).join("\n");
                        }
                    }
                    console.log("Message: ", things);
                    executeWebhook(things, webhookUrl);
                }
                break;
            default:
                break;
        }
    };

    ws.onclose = () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        reconnect(); // Attempt to reconnect
    };
};

function reconnect(): void {
    // Attempt to reconnect after a delay (e.g., 5 seconds)
    setTimeout(() => {
        const ws: WebSocket = new Websocket("wss://gateway.discord.gg/?v=10&encoding=json");
        listenToWebSocket(ws); // Reattach event listeners
        console.log("~~~~RECONNECTED~~~~");
    }, 5000); // Adjust the delay as needed
}

export const initialWS: WebSocket = new Websocket("wss://gateway.discord.gg/?v=10&encoding=json");
