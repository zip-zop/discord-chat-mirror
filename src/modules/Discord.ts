import { WebhookClient, Client, GatewayIntentBits, GatewayReceivePayload, GatewayDispatchEvents, GatewayOpcodes } from "discord.js";
import { channels, discordToken, serverId } from "../util/env.js";
import { Channel, Things, WebsocketTypes } from "../typings/index.js";
import fetch, { HeadersInit } from "node-fetch";
import Websocket from "ws";
import { RawAttachmentData, RawStickerData } from "discord.js/typings/rawDataTypes.js";

export const executeWebhook = (things: Things, webhookUrl: string): void => {
    const wsClient = new WebhookClient({ url: webhookUrl }); // Now dynamically using the passed URL
    wsClient.send(things).catch((e: any) => console.error(e));
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
            parentId, // It's okay to directly use snake_case here as it's a property name in the request body, not subject to naming conventions
            position: pos
        }),
        headers: effectiveHeaders,
        method: "POST"
    }).then(res => res.json()) as Promise<Channel>;
};

export const listen = (): void => {
    new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent
        ],
        closeTimeout: 6000
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const ws: WebsocketTypes = new Websocket("wss://gateway.discord.gg/?v=10&encoding=json");
    let authenticated = false;

    ws.on("open", () => {
        console.log("Connected to the Discord API.");
    });
    ws.on("message", (data: [any]) => {
        const payload: GatewayReceivePayload = JSON.parse(data.toString());
        const { op, d, s, t } = payload;

        switch (op) {
            case GatewayOpcodes.Hello:
                try {
                    ws.send(
                        JSON.stringify({
                            op: 1,
                            d: s
                        })
                    );
                    setInterval(() => {
                        ws.send(
                            JSON.stringify({
                                op: 1,
                                d: s
                            })
                        );
                    }, d.heartbeat_interval);
                } catch (e) {
                    console.log(e);
                }
                break;
            case GatewayOpcodes.HeartbeatAck:
                if (!authenticated) {
                    authenticated = true;
                    ws.send(
                        JSON.stringify({
                            op: 2,
                            d: {
                                token: discordToken,
                                properties: {
                                    $os: "linux",
                                    $browser: "test",
                                    $device: "test"
                                }
                            }
                        })
                    );
                }
                break;
            case GatewayOpcodes.Dispatch:
                console.log("t: ", t);
                if (
                    (t === GatewayDispatchEvents.MessageCreate) &&
                    d.guild_id === serverId &&
                    d.channel_id in channels
                ) {
                    const webhookUrl: string = channels[d.channel_id];
                    let ext = "jpg";
                    let ub = " [USER]";

                    const {
                        content,
                        attachments,
                        embeds,
                        sticker_items,
                        author
                    } = d;
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
                            (a: RawStickerData) => `https://media.discordapp.net/stickers/${a.id}.webp`
                        );
                    } else if (attachments[0]) {
                        const fileSizeInBytes = Math.max(...attachments.map((a: RawAttachmentData) => a.size));
                        const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
                        if (fileSizeInMegabytes < 8) {
                            things.files = attachments.map((a: RawAttachmentData) => a.url);
                        } else {
                            things.content += attachments.map((a: RawAttachmentData) => a.url).join("\n");
                        }
                    }
                    executeWebhook(things, webhookUrl);
                }
                break;
            default:
                break;
        }
    });
};